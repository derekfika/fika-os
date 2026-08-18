import path from "node:path";
import * as XLSX from "xlsx";
import { assertSafeLocalPath, dataRoot } from "../lib/safety";
import { ensureDataFolders } from "../lib/repository";

ensureDataFolders();
const workbook = XLSX.utils.book_new();
const legends = XLSX.utils.aoa_to_sheet([
  ["Synthetic workforce import — no real people"],
  [],
  ["Employee ID", "Full Name", "Work Email", "Job Title", "Employment State"],
  ["sheet-synthetic-001", "Taylor Example", "taylor@example.invalid", "Hospitality Legend", "Active"],
  ["sheet-synthetic-002", "Morgan Example", "morgan@example.invalid", "Coffee Legend", "Active"],
  ["sheet-synthetic-invalid", "", "invalid-email", "", "Active"],
]);
const sites = XLSX.utils.json_to_sheet([
  { "Site Name": "Synthetic Event Suite", "External Location ID": "site-synthetic-001", Address: "1 Example Street" },
  { "Site Name": "Synthetic Riverside", "External Location ID": "site-synthetic-002", Address: "2 Example Street" },
]);
XLSX.utils.book_append_sheet(workbook, legends, "Legends");
XLSX.utils.book_append_sheet(workbook, sites, "Sites");
const target = assertSafeLocalPath(path.join(dataRoot(), "uploads", "synthetic-multi-tab-workbook.xlsx"));
XLSX.writeFile(workbook, target, { bookType: "xlsx" });
console.log(target);
