import { existsSync, readFileSync } from "fs";

export function loadDefaultModel(
  configFile: string,
  fallbackModel = "gpt-5.4-mini",
): string {
  if (!existsSync(configFile)) {
    return fallbackModel;
  }

  const match = readFileSync(configFile, "utf-8").match(/^\s*default_model:\s*(\S+)/m);
  return match?.[1]?.trim() || fallbackModel;
}
