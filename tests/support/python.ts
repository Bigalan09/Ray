import { execFileSync } from "child_process";
import { resolve } from "path";

function canRunPython(candidate: string): boolean {
  try {
    execFileSync(candidate, [
      "-c",
      "import encodings, sys; raise SystemExit(0 if sys.version_info[:2] < (3, 14) else 1)",
    ], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function resolvePythonBin(): string {
  const candidates = [
    process.env.PYTHON_BIN,
    resolve(__dirname, "../../api/.venv/bin/python"),
    "python3.13",
    "python3.12",
    "python3",
    "python",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (canRunPython(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `No working Python interpreter found. Tried: ${candidates.join(", ")}`,
  );
}
