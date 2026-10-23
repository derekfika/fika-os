import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultAppRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function prepareStandaloneAssets({ appRoot = defaultAppRoot } = {}) {
  const standaloneRoot = path.join(appRoot, ".next", "standalone");
  const requiredFiles = [
    path.join(standaloneRoot, "server.js"),
    path.join(standaloneRoot, ".next", "routes-manifest.json"),
    path.join(standaloneRoot, ".next", "BUILD_ID"),
    path.join(standaloneRoot, "node_modules", "firebase-admin", "package.json"),
  ];

  for (const file of requiredFiles) {
    try {
      await access(file);
    } catch {
      throw new Error(`Next standalone output is missing the App Hosting app-root artifact: ${path.relative(appRoot, file)}`);
    }
  }

  const publicSource = path.join(appRoot, "public");
  const publicDestination = path.join(standaloneRoot, "public");
  await mkdir(standaloneRoot, { recursive: true });
  await cp(publicSource, publicDestination, { recursive: true, force: true });

  const staticSource = path.join(appRoot, ".next", "static");
  const staticDestination = path.join(standaloneRoot, ".next", "static");
  let hasStaticAssets = true;
  try {
    await access(staticSource);
  } catch (error) {
    if (error?.code === "ENOENT") hasStaticAssets = false;
    else throw error;
  }
  if (hasStaticAssets) {
    await mkdir(path.dirname(staticDestination), { recursive: true });
    await cp(staticSource, staticDestination, { recursive: true, force: true });
  }

  return { standaloneRoot, requiredFiles, publicDestination, staticDestination };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareStandaloneAssets();
}
