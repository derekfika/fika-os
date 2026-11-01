// Test and demonstration fixtures only. Not imported by any route or page: production never renders fixture data.
import type { ExternalEvidence, RawIssue, RawPull } from "./types";

const REPO = "https://github.com/example/fika-fixture";
const sha = (c: string) => c.repeat(40).slice(0, 40);
export const FIXTURE_NOW = new Date("2026-11-01T12:00:00Z");

const issue = (number: number, title: string, o: Partial<RawIssue> = {}): RawIssue => ({ number, title, url: `${REPO}/issues/${number}`, state: "open", labels: [], assignees: [], createdAt: "2026-10-20T09:00:00Z", updatedAt: "2026-10-31T09:00:00Z", ...o });
const pull = (number: number, linked: number[], o: Partial<RawPull> = {}): RawPull => {
  const headSha = o.headSha || sha(String(number % 10));
  return { number, title: `PR ${number}`, url: `${REPO}/pull/${number}`, state: "open", draft: false, merged: false, headSha, headRef: `codex/issue-${linked[0]}`, commitUrl: `${REPO}/commit/${headSha}`, createdAt: "2026-10-25T09:00:00Z", updatedAt: "2026-10-31T10:00:00Z", checks: { state: "success", total: 3, failing: [], url: `${REPO}/actions/runs/${number}`, completedAt: "2026-10-31T10:05:00Z" }, linkedIssues: linked, ...o };
};
const merged = (number: number, linked: number[], mergeChar: string, o: Partial<RawPull> = {}) => pull(number, linked, { state: "closed", merged: true, mergedAt: "2026-10-30T10:00:00Z", mergeCommitSha: sha(mergeChar), mergeCommitUrl: `${REPO}/commit/${sha(mergeChar)}`, ...o });

export const fixtureIssues: RawIssue[] = [
  issue(101, "[Logistics] Merged, never deployed"),
  issue(102, "[Hub] On staging, UAT failed"),
  issue(103, "[CPU] On staging, awaiting UAT"),
  issue(104, "[Menu] Live and closed", { state: "closed", stateReason: "completed", closedAt: "2026-10-31T08:00:00Z" }),
  issue(105, "[Hub] Closed with no production evidence", { state: "closed", stateReason: "completed", closedAt: "2026-10-31T08:00:00Z" }),
  issue(106, "[Hub] CI failing"),
  issue(107, "[Hub] Blocked", { labels: ["blocked", "severity:high", "workstream:Food Delivery"], assignees: ["agent-a"] }),
  issue(108, "[Hub] Not started"),
  issue(109, "[Hub] UAT recorded on an older build", { updatedAt: "2026-09-01T09:00:00Z" }),
];
export const fixturePulls: RawPull[] = [
  merged(201, [101], "a"),
  merged(202, [102], "b"),
  merged(203, [103], "c"),
  merged(204, [104], "d"),
  merged(205, [105], "e"),
  pull(206, [106], { checks: { state: "failure", total: 3, failing: ["Workflow / merge-gate"], url: `${REPO}/actions/runs/206` } }),
  pull(207, [107], { draft: true }),
  merged(209, [109], "f"),
  merged(210, [109], "f", { mergedAt: "2026-10-29T10:00:00Z", headSha: sha("9") }),
];

const deployed = (app: string, environment: "staging" | "production", mergeChar: string, status: "serving" | "submitted" | "failed" = "serving") => ({ app, environment, sourceSha: sha(mergeChar), buildId: `build-${mergeChar}`, deployedAt: "2026-10-31T11:00:00Z", status, source: "fixture release journal", evidenceUrl: `${REPO}/releases/${mergeChar}` });
export const fixtureExternal: ExternalEvidence = {
  deployments: { connected: true, records: [deployed("Hub", "staging", "b"), deployed("CPU", "staging", "c"), deployed("Menu", "staging", "d"), deployed("Menu", "production", "d"), deployed("Hub", "staging", "f")] },
  uat: {
    connected: true,
    records: [
      { issueNumber: 102, sourceSha: sha("b"), buildId: "build-b", result: "failed", recordedAt: "2026-10-31T11:30:00Z", recordedBy: "owner", evidenceUrl: `${REPO}/uat/102` },
      { issueNumber: 104, sourceSha: sha("d"), buildId: "build-d", result: "accepted", recordedAt: "2026-10-31T11:30:00Z", recordedBy: "owner" },
      { issueNumber: 109, sourceSha: sha("0"), result: "accepted", recordedAt: "2026-10-30T11:30:00Z", recordedBy: "owner" },
    ],
  },
  workspaces: { connected: false, records: [] },
};
