// Local, CPU-only micro-benchmark of the work one allergen row action causes today. NOT a staging or tablet measurement.
import { performance } from "node:perf_hooks";
import { allergenMatrixContentHash } from "../../apps/cpu-production/lib/cpu-allergen-release";
import { normaliseOperationalAllergens, deriveNoKeyAllergens } from "../../apps/shared/allergen-contract";

const KEYS = ["peanuts", "tree_nuts", "gluten", "sesame", "molluscs", "fish", "soya", "celery", "shellfish", "eggs", "milk", "mustard", "lupin", "sulphites"];
function order(o: number, lines: number) {
  return Array.from({ length: lines }, (_, i) => ({
    id: `menu-item:order-${o}:${i + 1}`, sourceLineId: `line-${o}-${i}`, name: `Dish ${o}-${i}`, note: "",
    subItems: [{ id: `sub-item:order-${o}:${i + 1}:1`, name: `Dish ${o}-${i}`, quantity: 12, note: "", evidenceStatus: "completed",
      allergens: Object.fromEntries(KEYS.map((k, n) => [k, (n + i) % 5 === 0 ? "contains" : "clear"]).concat([["no_key_allergens", "clear"]])) }],
  }));
}
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { median: s[Math.floor(s.length / 2)], worst: s.at(-1)! }; };
const fmt = (n: number) => n.toFixed(2);

console.log("CPU-only micro-benchmark (this machine, Node, no network, no Firestore). 15 timed runs after 5 warm-ups.");
console.log("orders x lines | rows | whole-day payload | one-order payload | one-row payload | server CPU/click (median, worst ms) | client JSON build (median ms)");
for (const [orders, lines] of [[10, 6], [40, 8], [100, 10]] as const) {
  const all = Array.from({ length: orders }, (_, o) => ({ action: "mark-planned", orderId: `order-${o}`, planningNotes: "CPU Delivered-In allergen review", menuItems: order(o, lines) }));
  const wholeDay = JSON.stringify({ action: "batch-plan", operations: all });
  const oneOrder = JSON.stringify({ action: "batch-plan", operations: [all[0]] });
  const oneRow = JSON.stringify({ action: "mark-planned", orderId: "order-0", menuItems: [all[0].menuItems[0]] });
  const serverWork = () => { for (const op of all) { const items = op.menuItems.map(item => ({ ...item, subItems: item.subItems.map(sub => ({ ...sub, allergens: (() => { const n = normaliseOperationalAllergens(sub.allergens as Record<string, unknown>); delete n.no_key_allergens; return deriveNoKeyAllergens(n); })() })) })); allergenMatrixContentHash(items as never); } };
  const build = () => JSON.stringify({ action: "batch-plan", operations: all });
  for (let i = 0; i < 5; i++) { serverWork(); build(); }
  const server: number[] = []; const client: number[] = [];
  for (let i = 0; i < 15; i++) { let t = performance.now(); serverWork(); server.push(performance.now() - t); t = performance.now(); build(); client.push(performance.now() - t); }
  const s = stats(server), c = stats(client);
  console.log(`${orders}x${lines} | ${orders * lines} | ${(wholeDay.length / 1024).toFixed(1)} KB | ${(oneOrder.length / 1024).toFixed(1)} KB | ${(oneRow.length / 1024).toFixed(2)} KB | ${fmt(s.median)}, ${fmt(s.worst)} | ${fmt(c.median)}`);
}
