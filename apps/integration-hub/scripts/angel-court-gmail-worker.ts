import { runAngelCourtGmailScan } from "../lib/angel-court-gmail-runner";

runAngelCourtGmailScan({ force: process.env.ANGEL_COURT_GMAIL_FORCE === "1" })
  .then((result) => console.log(JSON.stringify({ mode: "gmail-local", ...result, collection: "angelCourtInboxCandidates" }, null, 2)))
  .catch((error) => { console.error(error); process.exitCode = 1; });
