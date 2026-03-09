#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import pc from "picocolors";
import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { BROWSERS_DIR, CACHE_DIR, PROFILES_DIR } from "./config";
import { runDetached } from "./proc";
import { spin, dirSize, fail } from "./utils";
import * as chrome from "./chrome";
import * as firefox from "./firefox";

type BrowserName = "chromium" | "firefox";

// ── Alias resolution (before citty sees them) ──

const ALIASES: Record<string, string> = {
  i: "install",
  av: "available",
  ls: "list",
  open: "launch",
  rm: "remove",
  uninstall: "remove",
};
const rawCmd = process.argv[2];
if (rawCmd && ALIASES[rawCmd]) {
  process.argv[2] = ALIASES[rawCmd];
}

// ── Helpers ──

function parseBrowserVersion(raw: string): {
  browser: BrowserName;
  version: string;
} {
  const [b, v] = raw.includes("@") ? raw.split("@", 2) : [raw, ""];
  if (b !== "chromium" && b !== "firefox") {
    fail(`Unknown browser "${b}". Supported: chromium, firefox`);
  }
  return { browser: b, version: v };
}

function resolveInstalled(browser: BrowserName, version: string): string {
  const installed =
    browser === "chromium"
      ? chrome.getInstalledVersions()
      : firefox.getInstalledVersions();
  if (installed.includes(version)) return version;
  const matches = installed.filter((v) => v.startsWith(version));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    fail(
      `Multiple matches for ${browser} ${version}:\n` +
        matches.map((v) => `  ${v}`).join("\n")
    );
  }
  return version;
}

async function selectVersion(browser: BrowserName): Promise<string> {
  type Item = { name: string; value: string; description?: string };
  let items: Item[];

  if (browser === "chromium") {
    const versions = await spin("Fetching versions...", () =>
      chrome.fetchVersions()
    );
    items = versions.map((v) => ({
      name: `Chrome ${String(v.milestone).padStart(3)}  ${v.version}`,
      value: String(v.milestone),
      description: v.date || undefined,
    }));
  } else {
    const versions = await spin("Fetching versions...", () =>
      firefox.fetchVersions()
    );
    items = versions.map((v) => ({
      name: `Firefox ${v.version}`,
      value: v.version,
      description: v.date,
    }));
  }

  const { default: search } = await import("@inquirer/search");
  return search({
    message: `Select ${browser} version (type to filter)`,
    source: (input) => {
      if (!input) return items;
      const term = input.toLowerCase();
      return items.filter(
        (i) =>
          i.name.toLowerCase().includes(term) ||
          (i.description?.includes(term) ?? false)
      );
    },
  });
}

async function selectInstalled(browser: BrowserName): Promise<string> {
  const installed =
    browser === "chromium"
      ? chrome.getInstalledVersions()
      : firefox.getInstalledVersions();

  if (installed.length === 0) {
    fail(`No ${browser} installed. Run: brow install ${browser}`);
  }
  if (installed.length === 1) return installed[0];

  const { default: select } = await import("@inquirer/select");
  return select({
    message: `Select ${browser} version`,
    choices: installed.map((v) => ({ name: v, value: v })),
  });
}

// ── Commands ──

const installCmd = defineCommand({
  meta: { name: "install", description: "Install a browser version" },
  args: {
    target: {
      type: "positional",
      description: "chromium or firefox (optionally with @version)",
      required: true,
    },
    version: {
      type: "positional",
      description: "Version number or 'latest'",
      required: false,
    },
  },
  async run({ args }) {
    try {
      const { browser, version: v1 } = parseBrowserVersion(args.target);
      let version = v1 || args.version;

      // No version → interactive search
      if (!version) {
        version = await selectVersion(browser);
      }

      if (browser === "chromium") {
        await chrome.install(version);
      } else {
        await firefox.install(version);
      }
    } catch (e: any) {
      fail(e.message);
    }
  },
});

const availableCmd = defineCommand({
  meta: {
    name: "available",
    description: "Browse & search available versions",
  },
  args: {
    browser: {
      type: "positional",
      description: "chromium or firefox",
      required: true,
    },
  },
  async run({ args }) {
    try {
      const { browser } = parseBrowserVersion(args.browser);
      const selected = await selectVersion(browser);

      const { default: confirm } = await import("@inquirer/confirm");
      const ok = await confirm({
        message: `Install ${browser} ${selected}?`,
        default: true,
      });

      if (ok) {
        if (browser === "chromium") {
          await chrome.install(selected);
        } else {
          await firefox.install(selected);
        }
      }
    } catch (e: any) {
      fail(e.message);
    }
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List installed browsers" },
  run() {
    const chromeVersions = chrome.getInstalledVersions();
    const firefoxVersions = firefox.getInstalledVersions();

    if (chromeVersions.length === 0 && firefoxVersions.length === 0) {
      console.log(pc.dim("No browsers installed."));
      console.log(pc.dim("Run: brow install <chromium|firefox>"));
      return;
    }

    if (chromeVersions.length > 0) {
      console.log(pc.bold("\nChromium"));
      for (const v of chromeVersions) {
        const ms = v.split(".")[0];
        const dir = join(BROWSERS_DIR, `chromium-${v}`);
        const size = dirSize(dir);
        console.log(
          `  ${pc.cyan(v.padEnd(20))} ${pc.dim(`Chrome ${ms}`.padEnd(12))} ${pc.dim(size)}`
        );
      }
    }

    if (firefoxVersions.length > 0) {
      console.log(pc.bold("\nFirefox"));
      for (const v of firefoxVersions) {
        const dir = join(BROWSERS_DIR, `firefox-${v}`);
        const size = dirSize(dir);
        console.log(`  ${pc.cyan(v.padEnd(20))} ${pc.dim(size)}`);
      }
    }
    console.log();
  },
});

const launchCmd = defineCommand({
  meta: { name: "launch", description: "Launch an installed browser" },
  args: {
    target: {
      type: "positional",
      description: "Browser (optionally with @version)",
      required: true,
    },
    version: {
      type: "positional",
      description: "Version",
      required: false,
    },
    profile: {
      type: "string",
      description: "Profile name",
      default: "default",
    },
  },
  async run({ args }) {
    try {
      const { browser, version: v1 } = parseBrowserVersion(args.target);
      let versionArg = v1 || args.version || "";
      if (versionArg.startsWith("-")) versionArg = "";

      // Resolve version: interactive if multiple, auto if single
      const version = versionArg
        ? resolveInstalled(browser, versionArg)
        : await selectInstalled(browser);

      const execPath =
        browser === "chromium"
          ? chrome.getExecPath(version)
          : firefox.getExecPath(version);

      if (!existsSync(execPath)) fail(`${browser} ${version} executable not found.`);

      const profileName = args.profile || "default";
      const profileDir = join(PROFILES_DIR, browser, profileName);
      mkdirSync(profileDir, { recursive: true });

      const launchArgs: string[] = [];
      if (browser === "chromium") {
        launchArgs.push(
          `--user-data-dir=${profileDir}`,
          "--no-first-run",
          "--no-default-browser-check"
        );
      } else {
        launchArgs.push("-profile", profileDir, "-no-remote");
      }

      console.log(
        `Launching ${pc.bold(browser)} ${pc.cyan(version)} ${pc.dim(`(profile: ${profileName})`)}`
      );
      runDetached([execPath, ...launchArgs]);
      process.exit(0);
    } catch (e: any) {
      fail(e.message);
    }
  },
});

const removeCmd = defineCommand({
  meta: { name: "remove", description: "Remove an installed browser" },
  args: {
    target: {
      type: "positional",
      description: "Browser (optionally with @version)",
      required: true,
    },
    version: {
      type: "positional",
      description: "Version",
      required: false,
    },
  },
  async run({ args }) {
    try {
      const { browser, version: v1 } = parseBrowserVersion(args.target);
      let versionArg = v1 || args.version || "";

      const version = versionArg
        ? resolveInstalled(browser, versionArg)
        : await selectInstalled(browser);

      const dir = join(BROWSERS_DIR, `${browser}-${version}`);
      if (!existsSync(dir)) fail(`${browser} ${version} is not installed.`);

      const size = dirSize(dir);
      const { default: confirm } = await import("@inquirer/confirm");
      const ok = await confirm({
        message: `Remove ${browser} ${version}? (${size})`,
        default: false,
      });

      if (!ok) return;
      rmSync(dir, { recursive: true, force: true });
      console.log(pc.green(`✓ ${browser} ${version} removed.`));
    } catch (e: any) {
      fail(e.message);
    }
  },
});

const profilesCmd = defineCommand({
  meta: { name: "profiles", description: "List browser profiles" },
  args: {
    browser: {
      type: "positional",
      description: "Filter by browser",
      required: false,
    },
  },
  run({ args }) {
    const browsers: BrowserName[] = args.browser
      ? [parseBrowserVersion(args.browser).browser]
      : ["chromium", "firefox"];

    let found = false;
    for (const b of browsers) {
      const dir = join(PROFILES_DIR, b);
      if (!existsSync(dir)) continue;
      const profs = readdirSync(dir).filter((p) => !p.startsWith("."));
      if (profs.length === 0) continue;
      found = true;
      console.log(pc.bold(b));
      for (const p of profs) {
        const size = dirSize(join(dir, p));
        console.log(`  ${p.padEnd(20)} ${pc.dim(size)}`);
      }
    }

    if (!found) console.log(pc.dim("No profiles yet."));
  },
});

const profileCmd = defineCommand({
  meta: { name: "profile", description: "Manage profiles" },
  args: {
    action: {
      type: "positional",
      description: "rm",
      required: true,
    },
    browser: {
      type: "positional",
      description: "Browser name",
      required: true,
    },
    name: {
      type: "positional",
      description: "Profile name",
      required: true,
    },
  },
  run({ args }) {
    if (args.action !== "rm") {
      fail("Usage: brow profile rm <browser> <name>");
    }
    const { browser } = parseBrowserVersion(args.browser);
    const profileDir = join(PROFILES_DIR, browser, args.name);
    if (!existsSync(profileDir)) {
      fail(`Profile "${args.name}" not found for ${browser}.`);
    }
    rmSync(profileDir, { recursive: true, force: true });
    console.log(pc.green(`✓ Profile "${args.name}" removed for ${browser}.`));
  },
});

const cacheCmd = defineCommand({
  meta: { name: "cache", description: "Manage version cache" },
  args: {
    action: {
      type: "positional",
      description: "clear",
      required: true,
    },
  },
  run({ args }) {
    if (args.action !== "clear") {
      fail("Usage: brow cache clear");
    }
    if (existsSync(CACHE_DIR)) {
      rmSync(CACHE_DIR, { recursive: true, force: true });
    }
    console.log(pc.green("✓ Cache cleared."));
  },
});

// ── Help ──

function showHelp() {
  console.log(`
${pc.bold("brow")} ${pc.dim("— Browser manager for web compatibility testing")}

${pc.bold("Commands")}
  ${pc.cyan("install")} <browser> [version]   Install a browser          ${pc.dim("(i)")}
  ${pc.cyan("available")} <browser>            Search & install versions  ${pc.dim("(av)")}
  ${pc.cyan("list")}                           List installed browsers    ${pc.dim("(ls)")}
  ${pc.cyan("launch")} <browser> [version]     Launch a browser           ${pc.dim("(open)")}
  ${pc.cyan("remove")} <browser> [version]     Remove a browser           ${pc.dim("(rm)")}
  ${pc.cyan("profiles")} [browser]             List profiles
  ${pc.cyan("profile rm")} <browser> <name>    Remove a profile
  ${pc.cyan("cache clear")}                    Clear version cache

${pc.bold("Examples")}
  ${pc.dim("$")} brow install chromium 120
  ${pc.dim("$")} brow install firefox 128.0
  ${pc.dim("$")} brow install chromium          ${pc.dim("# interactive version search")}
  ${pc.dim("$")} brow launch chromium --profile dev
  ${pc.dim("$")} brow available firefox

${pc.bold("Browsers")}  chromium ${pc.dim("(59+)")}, firefox ${pc.dim("(1.0+)")}
${pc.bold("Data")}      ~/.brow/
`);
}

// ── Main ──

if (
  !process.argv[2] ||
  process.argv[2] === "--help" ||
  process.argv[2] === "-h"
) {
  showHelp();
  process.exit(0);
}

const main = defineCommand({
  meta: {
    name: "brow",
    version: "0.1.0",
    description: "Browser manager for web compatibility testing",
  },
  subCommands: {
    install: installCmd,
    available: availableCmd,
    list: listCmd,
    launch: launchCmd,
    remove: removeCmd,
    profiles: profilesCmd,
    profile: profileCmd,
    cache: cacheCmd,
  },
});

runMain(main);
