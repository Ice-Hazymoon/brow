import { spawn, spawnSync, type SpawnOptions } from "child_process";

interface RunOptions {
  stdout?: "inherit" | "ignore";
  stderr?: "inherit" | "ignore";
  stdin?: "inherit" | "ignore";
}

export function run(
  cmd: string[],
  opts: RunOptions = {}
): { exited: Promise<number>; unref: () => void } {
  const proc = spawn(cmd[0], cmd.slice(1), {
    stdio: [
      opts.stdin ?? "inherit",
      opts.stdout ?? "inherit",
      opts.stderr ?? "inherit",
    ],
  } as SpawnOptions);

  const exited = new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", () => resolve(1));
  });

  return { exited, unref: () => proc.unref() };
}

export function runDetached(cmd: string[]): void {
  const proc = spawn(cmd[0], cmd.slice(1), {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
}

export function runSync(cmd: string[]): { stdout: string; exitCode: number } {
  const result = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf-8" });
  return {
    stdout: result.stdout ?? "",
    exitCode: result.status ?? 1,
  };
}
