#!/usr/bin/env bun

type ManagedProcess = ReturnType<typeof Bun.spawn>;

const cwd = process.cwd();

function runCssBuild(watch: boolean) {
  const args = [
    "bun",
    "x",
    "@tailwindcss/cli",
    "-i",
    "./src/index.css",
    "-o",
    "./src/index.generated.css",
  ];

  if (watch) {
    args.push("--watch");
  }

  return Bun.spawn(args, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
}

function stopProcess(proc: ManagedProcess) {
  if (proc.exitCode === null) {
    proc.kill();
  }
}

const initialCssBuild = runCssBuild(false);
const initialCssExitCode = await initialCssBuild.exited;

if (initialCssExitCode !== 0) {
  process.exit(initialCssExitCode);
}

const cssWatcher = runCssBuild(true);
const appServer = Bun.spawn(["bun", "--hot", "src/index.tsx"], {
  cwd,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const shutdown = () => {
  stopProcess(cssWatcher);
  stopProcess(appServer);
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown();
    process.exit(0);
  });
}

const exitCode = await Promise.race([cssWatcher.exited, appServer.exited]);
shutdown();
process.exit(exitCode);
