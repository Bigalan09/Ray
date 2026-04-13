#!/usr/bin/env bun
import { existsSync } from "fs";
import { rm } from "fs/promises";
import path from "path";

console.log("\nStarting build...\n");

const outdir = path.join(process.cwd(), "dist");
const generatedCss = path.join("src", "index.generated.css");

async function buildCss(minify: boolean) {
  const args = [
    "bun",
    "x",
    "@tailwindcss/cli",
    "-i",
    "./src/index.css",
    "-o",
    `./${generatedCss}`,
  ];

  if (minify) {
    args.push("--minify");
  }

  const proc = Bun.spawn(args, {
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Tailwind CSS build failed with exit code ${exitCode}`);
  }
}

if (existsSync(outdir)) {
  await rm(outdir, { recursive: true, force: true });
}

const start = performance.now();

await buildCss(true);

const entrypoints = [...new Bun.Glob("**.html").scanSync("src")]
  .map(a => path.resolve("src", a))
  .filter(dir => !dir.includes("node_modules"));

const result = await Bun.build({
  entrypoints,
  outdir,
  minify: true,
  target: "browser",
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

const end = performance.now();

const outputTable = result.outputs.map(output => ({
  File: path.relative(process.cwd(), output.path),
  Type: output.kind,
  Size: `${(output.size / 1024).toFixed(1)} KB`,
}));

console.table(outputTable);
console.log(`\nBuild completed in ${(end - start).toFixed(0)}ms\n`);
