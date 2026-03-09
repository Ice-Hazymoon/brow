import { join } from "path";
import { homedir } from "os";

export const BROW_HOME = join(homedir(), ".brow");
export const BROWSERS_DIR = join(BROW_HOME, "browsers");
export const PROFILES_DIR = join(BROW_HOME, "profiles");
export const TMP_DIR = join(BROW_HOME, "tmp");
export const CACHE_DIR = join(BROW_HOME, "cache");

export const CHROME_PLATFORM =
  process.arch === "arm64" ? "mac-arm64" : "mac-x64";

// Chromium Snapshots use different platform names
// Mac_Arm only exists from ~Chrome 87+, fall back to Mac (Rosetta)
export const SNAPSHOT_PLATFORMS =
  process.arch === "arm64" ? ["Mac_Arm", "Mac"] : ["Mac"];
