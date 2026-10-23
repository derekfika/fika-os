const projectId = process.env.FIREBASE_PROJECT_ID;
const host = process.env.FIRESTORE_EMULATOR_HOST;
const loopbackHost = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;

if (projectId !== "demo-fika-os" || !loopbackHost.test(host || "") || (process.env.FIKA_RUNTIME_MODE && process.env.FIKA_RUNTIME_MODE !== "local")) {
  console.error("Hub tests require FIREBASE_PROJECT_ID=demo-fika-os and a loopback Firestore emulator in local runtime mode.");
  process.exit(1);
}

try {
  const response = await fetch(`http://${host}/`, { signal: AbortSignal.timeout(1_000) });
  if (response.status >= 500) throw new Error(`Firestore emulator returned HTTP ${response.status}.`);
} catch (error) {
  console.error(`Hub tests require a reachable Firestore emulator at ${host}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
