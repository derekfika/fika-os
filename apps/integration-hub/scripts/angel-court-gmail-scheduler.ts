import { londonScanSlot, londonScanWindow, runAngelCourtGmailScan } from "../lib/angel-court-gmail-runner";

let lastSlot = "";
let running = false;
async function tick() {
  const now = new Date();
  const slot = londonScanSlot(now);
  const minute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", minute: "2-digit" }).format(now));
  // Polling is deliberately frequent, but a scheduled run is only admitted
  // on the quarter-hour boundary (07:00, 07:15, …, 17:00 London time).
  if (!londonScanWindow(now) || minute % 15 !== 0 || running || slot === lastSlot) return;
  lastSlot = slot;
  running = true;
  try { console.log(JSON.stringify({ scheduled: true, slot, result: await runAngelCourtGmailScan() })); }
  catch (error) { console.error("Angel Court Gmail scheduled scan failed", error); }
  finally { running = false; }
}

void tick();
setInterval(() => void tick(), 60_000);
console.log("Angel Court Gmail scheduler active: weekdays 07:00–17:00 Europe/London, every 15 minutes.");
