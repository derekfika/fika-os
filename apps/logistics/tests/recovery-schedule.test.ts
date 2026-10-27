import assert from "node:assert/strict";
import test from "node:test";
import { londonServiceDate } from "../lib/driver-notifications";

// The three Cloud Scheduler jobs all use the IANA zone Europe/London. This models how a cron in that zone fires across the UK
// clock changes by walking real UTC minutes and reading the London wall clock, so the boundary and gap checks hold in both BST and GMT.
const JOBS = {
  day: { cron: "* 6-15 * * *", hours: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15], minutes: (m: number) => true },
  evening: { cron: "*/5 16-17 * * *", hours: [16, 17], minutes: (m: number) => m % 5 === 0 },
  overnight: { cron: "0 18-23,0-5 * * *", hours: [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5], minutes: (m: number) => m === 0 },
} as const;

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function london(instant: number) {
  const parts = Object.fromEntries(clock.formatToParts(instant).map(part => [part.type, part.value]));
  return { hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** Every UTC minute in [from, to) at which at least one job fires, with the job names. */
function firings(from: string, to: string) {
  const result: Array<{ utc: string; local: string; jobs: string[] }> = [];
  for (let t = Date.parse(from); t < Date.parse(to); t += 60_000) {
    const { hour, minute } = london(t);
    const jobs = Object.entries(JOBS).filter(([, job]) => (job.hours as readonly number[]).includes(hour) && job.minutes(minute)).map(([name]) => name);
    if (jobs.length) result.push({ utc: new Date(t).toISOString(), local: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, jobs });
  }
  return result;
}

const windows = [
  { name: "Friday 26 March 2027 (GMT)", from: "2027-03-26T00:00:00Z", to: "2027-03-27T00:00:00Z" },
  { name: "Sunday 28 March 2027 (GMT to BST)", from: "2027-03-28T00:00:00Z", to: "2027-03-29T00:00:00Z" },
  { name: "Monday 29 March 2027 (BST)", from: "2027-03-28T23:00:00Z", to: "2027-03-29T23:00:00Z" },
  { name: "Sunday 31 October 2027 (BST to GMT)", from: "2027-10-30T23:00:00Z", to: "2027-11-01T00:00:00Z" },
  { name: "Monday 1 November 2027 (GMT)", from: "2027-11-01T00:00:00Z", to: "2027-11-02T00:00:00Z" },
];

test("no job overlaps another at a boundary, and each boundary fires exactly once", () => {
  for (const window of windows) for (const firing of firings(window.from, window.to)) assert.equal(firing.jobs.length, 1, `${window.name}: ${firing.local} fired by ${firing.jobs.join("+")}`);
});

test("06:00, 16:00 and 18:00 UK local each begin the right schedule on every transition day", () => {
  for (const window of windows) {
    const local = firings(window.from, window.to).map(item => `${item.local}:${item.jobs[0]}`);
    for (const expected of ["05:00:overnight", "06:00:day", "15:59:day", "16:00:evening", "17:55:evening", "18:00:overnight"]) assert.ok(local.includes(expected), `${window.name}: missing ${expected}`);
    assert.ok(!local.includes("05:01:overnight") && !local.includes("17:56:evening") && !local.includes("16:01:evening"), `${window.name}: unexpected firing`);
  }
});

test("recovery never leaves a gap longer than an hour of real time, including across the missing and repeated 01:00 hour", () => {
  for (const window of windows) {
    const times = firings(window.from, window.to).map(item => Date.parse(item.utc));
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] <= 60 * 60_000, `${window.name}: gap of ${(times[i] - times[i - 1]) / 60_000} minutes before ${new Date(times[i]).toISOString()}`);
  }
});

test("spring forward skips the nonexistent 01:00 hour; autumn back runs the repeated hour (recovery is idempotent, so twice is harmless)", () => {
  const spring = firings("2027-03-28T00:00:00Z", "2027-03-28T03:00:00Z").map(item => `${item.utc.slice(11, 16)}Z=${item.local}`);
  assert.deepEqual(spring, ["00:00Z=00:00", "01:00Z=02:00", "02:00Z=03:00"], "00:00 GMT, then 02:00 BST (01:00Z); no 01:xx local time exists");
  const autumn = firings("2027-10-30T22:30:00Z", "2027-10-31T04:00:00Z").map(item => `${item.utc.slice(11, 16)}Z=${item.local}`);
  assert.deepEqual(autumn, ["23:00Z=00:00", "00:00Z=01:00", "01:00Z=01:00", "02:00Z=02:00", "03:00Z=03:00"], "01:00 occurs twice: 01:00 BST (00:00Z) and 01:00 GMT (01:00Z)");
});

test("expected UTC times either side of both clock changes", () => {
  const at = (from: string, to: string, name: string) => firings(from, to).filter(item => item.jobs[0] === name).map(item => `${item.utc.slice(0, 16)}Z`);
  assert.equal(at("2027-03-26T00:00:00Z", "2027-03-27T00:00:00Z", "day")[0], "2027-03-26T06:00Z", "GMT: 06:00 local is 06:00Z");
  assert.equal(at("2027-03-28T23:00:00Z", "2027-03-29T23:00:00Z", "day")[0], "2027-03-29T05:00Z", "BST: 06:00 local is 05:00Z");
  assert.equal(at("2027-10-30T23:00:00Z", "2027-11-01T00:00:00Z", "day")[0], "2027-10-31T06:00Z", "Sunday 31 Oct: BST ended at 02:00, so 06:00 local is GMT = 06:00Z");
  assert.equal(at("2027-11-01T00:00:00Z", "2027-11-02T00:00:00Z", "day")[0], "2027-11-01T06:00Z", "GMT: 06:00 local is 06:00Z");
});

test("notification eligibility uses the server-side Europe/London date across the clock changes", () => {
  assert.equal(londonServiceDate(new Date("2027-03-27T23:30:00Z")), "2027-03-27", "GMT: 23:30Z is still the 27th");
  assert.equal(londonServiceDate(new Date("2027-03-28T00:30:00Z")), "2027-03-28");
  assert.equal(londonServiceDate(new Date("2027-03-28T23:30:00Z")), "2027-03-29", "BST: 23:30Z on the 28th is 00:30 on the 29th");
  assert.equal(londonServiceDate(new Date("2027-10-30T23:30:00Z")), "2027-10-31", "BST: 23:30Z is already the 31st");
  assert.equal(londonServiceDate(new Date("2027-10-31T23:30:00Z")), "2027-10-31", "GMT again: 23:30Z on the 31st is still the 31st");
  assert.equal(londonServiceDate(new Date("2027-11-01T00:30:00Z")), "2027-11-01");
});
