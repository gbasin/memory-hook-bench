/**
 * Process runner with timeout support
 */
import { spawn } from "child_process";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stdio?: "pipe" | "inherit";
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export async function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  const { cwd, env, timeoutMs = 120_000, stdio = "pipe" } = opts;
  const start = Date.now();

  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: env ?? process.env,
      stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    if (stdio === "pipe") {
      proc.stdout?.on("data", (data) => (stdout += data.toString()));
      proc.stderr?.on("data", (data) => (stderr += data.toString()));
    }

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - start,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout,
        stderr: stderr + "\n" + err.message,
        timedOut: false,
        durationMs: Date.now() - start,
      });
    });
  });
}
