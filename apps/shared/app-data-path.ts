import { basename, join } from "node:path";

/** Resolve app-local operational data consistently whether launched from the app or workspace root. */
export function appDataPath(appName: string, ...parts: string[]) {
  const appRoot = basename(process.cwd()) === appName ? process.cwd() : join(process.cwd(), "apps", appName);
  return join(appRoot, "local-data", ...parts);
}
