import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import pc from "picocolors";
import { BROWSERS_DIR, TMP_DIR } from "./config";
import { cachedFetch } from "./cache";
import { run } from "./proc";
import { spin } from "./utils";

export interface FirefoxVersion {
  version: string;
  date: string;
}

// ── Fetch available versions ──

export async function fetchVersions(): Promise<FirefoxVersion[]> {
  const major = await cachedFetch<Record<string, string>>(
    "https://product-details.mozilla.org/1.0/firefox_history_major_releases.json",
    "firefox-major"
  );

  const stability = await cachedFetch<Record<string, string>>(
    "https://product-details.mozilla.org/1.0/firefox_history_stability_releases.json",
    "firefox-stability"
  );

  const all = new Map<string, string>();
  for (const [v, d] of Object.entries(major)) all.set(v, d);
  for (const [v, d] of Object.entries(stability)) all.set(v, d);

  return Array.from(all.entries())
    .map(([version, date]) => ({ version, date }))
    .sort((a, b) => compareFirefoxVersions(b.version, a.version));
}

function compareFirefoxVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── Resolve ──

export async function resolveVersion(
  input: string
): Promise<{ version: string }> {
  if (input === "latest") {
    const data = await cachedFetch<any>(
      "https://product-details.mozilla.org/1.0/firefox_versions.json",
      "firefox-current"
    );
    return { version: data.LATEST_FIREFOX_VERSION };
  }

  if (!input.includes(".")) {
    const versions = await fetchVersions();
    const found = versions.find((v) => v.version.split(".")[0] === input);
    if (!found) throw new Error(`Firefox ${input} not found.`);
    return { version: found.version };
  }

  return { version: input };
}

// ── Install ──

function downloadUrl(version: string): string {
  return `https://archive.mozilla.org/pub/firefox/releases/${version}/mac/en-US/Firefox%20${version}.dmg`;
}

export async function install(input: string) {
  const { version } = await spin("Resolving version...", () =>
    resolveVersion(input)
  );
  const destDir = join(BROWSERS_DIR, `firefox-${version}`);

  if (existsSync(destDir)) {
    console.log(pc.yellow(`Firefox ${version} is already installed.`));
    console.log(pc.dim(`  brow launch firefox ${version}`));
    return;
  }

  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(destDir, { recursive: true });

  const tempDmg = join(TMP_DIR, `firefox-${version}.dmg`);
  const url = downloadUrl(version);

  console.log(`Downloading Firefox ${pc.bold(version)}...`);
  const dl = run(["curl", "-L", "-#", "-f", "-o", tempDmg, url]);
  if ((await dl.exited) !== 0) {
    rmSync(destDir, { recursive: true, force: true });
    rmSync(tempDmg, { force: true });
    throw new Error(
      `Download failed. Firefox ${version} may not exist.\n` +
        `Run ${pc.dim("brow available firefox")} to see versions.`
    );
  }

  const mountPoint = `/tmp/brow-firefox-${version}`;

  console.log("Extracting...");
  const mount = run(
    ["hdiutil", "attach", tempDmg, "-nobrowse", "-readonly", "-mountpoint", mountPoint],
    { stdout: "ignore" }
  );
  if ((await mount.exited) !== 0) {
    rmSync(destDir, { recursive: true, force: true });
    rmSync(tempDmg, { force: true });
    throw new Error("Failed to mount dmg.");
  }

  await run(["cp", "-R", join(mountPoint, "Firefox.app"), destDir]).exited;

  await run(["hdiutil", "detach", mountPoint, "-quiet"], {
    stdout: "ignore",
    stderr: "ignore",
  }).exited;

  rmSync(tempDmg, { force: true });
  console.log(pc.green(`✓ Firefox ${version} installed.`));
  console.log(pc.dim(`  brow launch firefox ${version}`));
}

// ── Exec path ──

export function getExecPath(version: string): string {
  return join(
    BROWSERS_DIR,
    `firefox-${version}`,
    "Firefox.app",
    "Contents",
    "MacOS",
    "firefox"
  );
}

// ── Installed ──

export function getInstalledVersions(): string[] {
  if (!existsSync(BROWSERS_DIR)) return [];
  return readdirSync(BROWSERS_DIR)
    .filter((d) => d.startsWith("firefox-"))
    .map((d) => d.slice("firefox-".length))
    .sort((a, b) => compareFirefoxVersions(b, a));
}
