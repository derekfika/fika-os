import { randomBytes, scryptSync } from "node:crypto";

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
  console.error("Run this utility in an interactive terminal so the PIN is not echoed.");
  process.exit(1);
}

process.stdout.write("Gallagher PIN (4–12 digits; input hidden): ");
process.stdin.setRawMode(true);
process.stdin.resume();
let input = "";
process.stdin.on("data", (chunk) => {
  for (const char of chunk.toString("utf8")) {
    if (char === "\u0003") { process.stdout.write("\nCancelled.\n"); process.exit(130); }
    if (char === "\r" || char === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (!/^\d{4,12}$/.test(input)) {
        console.error("Use a PIN containing 4–12 digits.");
        process.exit(1);
      }
      const salt = randomBytes(16);
      const hash = scryptSync(input, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
      input = "";
      console.log(`scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`);
      return;
    }
    if (char === "\u007f" || char === "\b") input = input.slice(0, -1);
    else if (/^\d$/.test(char) && input.length < 12) input += char;
  }
});
