import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import pc from "picocolors";
import {
  BROWSERS_DIR,
  CHROME_PLATFORM,
  SNAPSHOT_PLATFORMS,
  TMP_DIR,
} from "./config";
import { cachedFetch, cachedFetchAll } from "./cache";
import { run } from "./proc";
import { spin } from "./utils";

export interface ChromeVersion {
  milestone: number;
  version: string;
  date: string;
  /** chromiumdash branch position, needed for snapshot downloads */
  position?: number;
}

// ── Fetch available versions ──

interface DashRelease {
  milestone: number;
  version: string;
  time: number;
  chromium_main_branch_position: number | null;
}

interface DashMilestone {
  milestone: number;
  chromium_main_branch_position: number;
}

interface CfTMilestones {
  milestones: Record<
    string,
    { version: string; downloads: { chrome: { platform: string; url: string }[] } }
  >;
}

export async function fetchVersions(): Promise<ChromeVersion[]> {
  // chromiumdash gives us ALL stable Mac releases with dates
  const releases = await cachedFetchAll<DashRelease>(
    (offset) =>
      `https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac&num=100&offset=${offset}`,
    "chrome-releases"
  );

  // Milestones API has branch positions for Chrome 59+ (releases API often has null)
  const milestones = await cachedFetch<DashMilestone[]>(
    "https://chromiumdash.appspot.com/fetch_milestones?only_branched=true",
    "chrome-milestones"
  );
  const positionMap = new Map<number, number>();
  for (const m of milestones) {
    if (m.chromium_main_branch_position > 0) {
      positionMap.set(m.milestone, m.chromium_main_branch_position);
    }
  }

  // Chrome for Testing milestones (113+) for reliable download URLs
  const cft = await cachedFetch<CfTMilestones>(
    "https://googlechromelabs.github.io/chrome-for-testing/latest-versions-per-milestone-with-downloads.json",
    "chrome-cft"
  );

  // Group by milestone, keep latest version per milestone
  const map = new Map<number, ChromeVersion>();

  for (const r of releases) {
    const existing = map.get(r.milestone);
    if (!existing || r.version > existing.version) {
      map.set(r.milestone, {
        milestone: r.milestone,
        version: r.version,
        date: new Date(r.time).toISOString().split("T")[0],
        // Prefer milestones API position (more reliable), fallback to release position
        position:
          positionMap.get(r.milestone) ??
          (r.chromium_main_branch_position ?? undefined),
      });
    }
  }

  // Overlay CfT versions (more reliable for 113+)
  for (const [ms, data] of Object.entries(cft.milestones)) {
    const m = Number(ms);
    const existing = map.get(m);
    map.set(m, {
      milestone: m,
      version: data.version,
      date: existing?.date ?? "",
      position: existing?.position ?? positionMap.get(m),
    });
  }

  return Array.from(map.values()).sort((a, b) => b.milestone - a.milestone);
}

// ── Resolve version input ──

export async function resolveVersion(input: string): Promise<ChromeVersion> {
  if (input === "latest") {
    const data = await cachedFetch<any>(
      "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json",
      "chrome-latest"
    );
    const s = data.channels.Stable;
    return {
      milestone: Number(s.version.split(".")[0]),
      version: s.version,
      date: "",
    };
  }

  // Milestone number like "120"
  if (!input.includes(".")) {
    const versions = await fetchVersions();
    const found = versions.find((v) => v.milestone === Number(input));
    if (!found) throw new Error(`Chrome milestone ${input} not found.`);
    return found;
  }

  // Full version number
  const ms = Number(input.split(".")[0]);
  const versions = await fetchVersions();
  const byMs = versions.find((v) => v.milestone === ms);
  return {
    milestone: ms,
    version: input,
    date: byMs?.date ?? "",
    position: byMs?.position,
  };
}

// ── Download URL ──

function getCfTDownloadUrl(version: string): string {
  return `https://storage.googleapis.com/chrome-for-testing-public/${version}/${CHROME_PLATFORM}/chrome-${CHROME_PLATFORM}.zip`;
}

async function getCfTDownloadUrlFromMilestone(
  milestone: number
): Promise<string | null> {
  const cft = await cachedFetch<CfTMilestones>(
    "https://googlechromelabs.github.io/chrome-for-testing/latest-versions-per-milestone-with-downloads.json",
    "chrome-cft"
  );
  const ms = cft.milestones[String(milestone)];
  if (!ms) return null;
  const dl = ms.downloads.chrome.find((d) => d.platform === CHROME_PLATFORM);
  return dl?.url ?? null;
}

async function lookupMilestonePosition(milestone: number): Promise<number | undefined> {
  try {
    const milestones = await cachedFetch<DashMilestone[]>(
      "https://chromiumdash.appspot.com/fetch_milestones?only_branched=true",
      "chrome-milestones"
    );
    const found = milestones.find((m) => m.milestone === milestone);
    if (found && found.chromium_main_branch_position > 0) {
      return found.chromium_main_branch_position;
    }
  } catch {}
  return undefined;
}

async function findSnapshotUrl(
  position: number,
  milestone: number
): Promise<string | null> {
  // Mac_Arm snapshots only exist from ~Chrome 87+ (Apple Silicon era)
  const platforms = milestone >= 87 ? SNAPSHOT_PLATFORMS : ["Mac"];

  for (const platform of platforms) {
    // Use GCS listing API to find nearest snapshot at or after this position
    const listUrl =
      `https://www.googleapis.com/storage/v1/b/chromium-browser-snapshots/o` +
      `?prefix=${platform}/&delimiter=/&startOffset=${platform}/${position}/&maxResults=1`;
    try {
      const resp = await fetch(listUrl);
      if (!resp.ok) continue;
      const data: any = await resp.json();
      const prefix = data.prefixes?.[0]; // e.g. "Mac/665002/"
      if (!prefix) continue;

      const snapshotPos = prefix.split("/")[1];
      const zipUrl = `https://storage.googleapis.com/chromium-browser-snapshots/${platform}/${snapshotPos}/chrome-mac.zip`;
      const head = await fetch(zipUrl, { method: "HEAD" });
      if (head.ok) return zipUrl;
    } catch {
      continue;
    }
  }
  return null;
}

// ── Install ──

export async function install(input: string) {
  const resolved = await spin("Resolving version...", () => resolveVersion(input));
  const destDir = join(BROWSERS_DIR, `chromium-${resolved.version}`);

  if (existsSync(destDir)) {
    console.log(pc.yellow(`Chromium ${resolved.version} is already installed.`));
    console.log(pc.dim(`  brow launch chromium ${resolved.milestone}`));
    return;
  }

  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(destDir, { recursive: true });

  let downloadUrl: string | null = null;
  let isSnapshot = false;

  if (resolved.milestone >= 113) {
    downloadUrl =
      (await getCfTDownloadUrlFromMilestone(resolved.milestone)) ??
      getCfTDownloadUrl(resolved.version);
  } else {
    if (!resolved.position) {
      resolved.position = await lookupMilestonePosition(resolved.milestone);
    }
    if (!resolved.position) {
      rmSync(destDir, { recursive: true, force: true });
      throw new Error(
        `Chrome ${resolved.milestone} is too old — snapshots are available for Chrome 59+.`
      );
    }
    downloadUrl = await spin("Locating Chromium snapshot...", () =>
      findSnapshotUrl(resolved.position!, resolved.milestone)
    );
    isSnapshot = true;
    if (!downloadUrl) {
      rmSync(destDir, { recursive: true, force: true });
      throw new Error(
        `No Chromium snapshot found for Chrome ${resolved.version}.`
      );
    }
  }

  const tempZip = join(TMP_DIR, `chrome-${resolved.version}.zip`);
  const label = isSnapshot ? "Chromium (snapshot)" : "Chrome";

  console.log(`Downloading ${label} ${pc.bold(resolved.version)}...`);
  const dl = run(["curl", "-L", "-#", "-f", "-o", tempZip, downloadUrl]);
  if ((await dl.exited) !== 0) {
    rmSync(destDir, { recursive: true, force: true });
    rmSync(tempZip, { force: true });
    throw new Error("Download failed.");
  }

  console.log("Extracting...");
  const ex = run(["unzip", "-q", tempZip, "-d", destDir]);
  if ((await ex.exited) !== 0) {
    rmSync(destDir, { recursive: true, force: true });
    rmSync(tempZip, { force: true });
    throw new Error("Extraction failed.");
  }

  rmSync(tempZip, { force: true });
  console.log(pc.green(`✓ Chromium ${resolved.version} installed.`));
  console.log(pc.dim(`  brow launch chromium ${resolved.milestone}`));
}

// ── Exec path ──

export function getExecPath(version: string): string {
  const dir = join(BROWSERS_DIR, `chromium-${version}`);

  // Chrome for Testing (113+)
  const cftPath = join(
    dir,
    `chrome-${CHROME_PLATFORM}`,
    "Google Chrome for Testing.app",
    "Contents",
    "MacOS",
    "Google Chrome for Testing"
  );
  if (existsSync(cftPath)) return cftPath;

  // Chromium snapshot (older, arm64)
  const snapArmPath = join(
    dir,
    "chrome-mac",
    "Chromium.app",
    "Contents",
    "MacOS",
    "Chromium"
  );
  if (existsSync(snapArmPath)) return snapArmPath;

  // Chromium snapshot (older, x64 naming variant)
  const snapX64Path = join(
    dir,
    "chrome-mac",
    "Google Chrome.app",
    "Contents",
    "MacOS",
    "Google Chrome"
  );
  if (existsSync(snapX64Path)) return snapX64Path;

  return cftPath; // default, will fail later
}

// ── Installed ──

export function getInstalledVersions(): string[] {
  if (!existsSync(BROWSERS_DIR)) return [];
  return readdirSync(BROWSERS_DIR)
    .filter((d) => d.startsWith("chromium-"))
    .map((d) => d.slice("chromium-".length))
    .sort();
}
