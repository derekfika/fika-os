import { appBaseUrl, assertSha, fetchJson, getLocalGitSha, selectedApps, STAGING_APPS, unavailableSource } from "./common.mjs";

export async function discoverBuilds({ expected, app = "all", env = process.env, fetchImpl = globalThis.fetch, exec = undefined } = {}) {
  const expectedSha = expected ? assertSha(expected, "--expected") : await getLocalGitSha({ exec });
  const apps = await Promise.all(selectedApps(app).map(async (appId) => {
    const config = STAGING_APPS[appId];
    if (!config.buildInfo) return { app: appId, label: config.label, service: config.service, liveSha: null, status: "UNAVAILABLE", source: "no-build-info-endpoint", message: "No canonical public build-info endpoint exists for this app." };
    const response = await fetchJson(`${appBaseUrl(appId, env)}/api/build-info`, { cookie: env.FIKA_UAT_COOKIE, fetchImpl });
    const body = response.body || {};
    const liveSha = typeof body.buildSha === "string" && /^[0-9a-f]{7,64}$/i.test(body.buildSha) ? body.buildSha.toLowerCase() : null;
    if (!response.ok || !liveSha) return { app: appId, label: config.label, service: config.service, liveSha, status: "UNAVAILABLE", source: "api/build-info", ...unavailableSource(appId, response, "The build-info endpoint did not return a usable SHA.") };
    return { app: appId, label: config.label, service: config.service, liveSha, status: expectedSha ? (liveSha.startsWith(expectedSha) || expectedSha.startsWith(liveSha) ? "MATCH" : "DIFFERENT") : "OK", source: "api/build-info", expectedSha };
  }));
  return { generatedAt: new Date().toISOString(), expectedSha: expectedSha || null, expectedSource: expected ? "argument" : "local HEAD", apps };
}

export function formatBuilds(result) {
  const lines = ["FIKA OS STAGING BUILDS", ""];
  for (const item of result.apps) lines.push(`${item.label.padEnd(18)} ${(item.liveSha || "unavailable").padEnd(40)} ${item.status}`);
  lines.push("", `Expected main:    ${result.expectedSha || "unavailable (local HEAD not resolved)"}`);
  const differences = result.apps.filter(item => item.status === "DIFFERENT");
  const unavailable = result.apps.filter(item => item.status === "UNAVAILABLE");
  lines.push("", "Warnings:");
  if (!differences.length && !unavailable.length) lines.push("- all expected builds confirmed");
  for (const item of differences) lines.push(`- ${item.label} differs from expected SHA`);
  for (const item of unavailable) lines.push(`- ${item.label} build provenance unavailable: ${item.message || "endpoint unavailable"}`);
  return lines.join("\n");
}
