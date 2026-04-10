import { existsSync, readFileSync } from "fs";

export function loadEnvFile(envFile: string): Record<string, string> {
  const envVars: Record<string, string> = {};

  if (!existsSync(envFile)) {
    return envVars;
  }

  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    envVars[key] = value;
  }

  return envVars;
}


export function loadPreferredEnv(
  overrideEnvFile: string,
  fallbackEnvFile: string,
): Record<string, string> {
  if (existsSync(overrideEnvFile)) {
    return loadEnvFile(overrideEnvFile);
  }

  return loadEnvFile(fallbackEnvFile);
}
