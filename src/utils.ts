import pc from "picocolors";
import { runSync } from "./proc";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export async function spin<T>(message: string, fn: () => Promise<T>): Promise<T> {
  let i = 0;
  const timer = setInterval(() => {
    process.stderr.write(`\r${pc.cyan(SPINNER[i++ % SPINNER.length])} ${pc.dim(message)}`);
  }, 80);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    process.stderr.write(`\r\x1b[K`);
  }
}

export function dirSize(path: string): string {
  try {
    const r = runSync(["du", "-sh", path]);
    return r.stdout.split("\t")[0].trim();
  } catch {
    return "?";
  }
}

export function fail(msg: string): never {
  console.error(pc.red(msg));
  process.exit(1);
}
