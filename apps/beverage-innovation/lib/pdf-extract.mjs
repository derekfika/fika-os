// Local subprocess. The caller supplies only bounded bytes via stdin.
const [maxBytes, maxText, maxPages] = process.argv.slice(2).map(Number);

async function extract() {
  const input = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > maxBytes) return { error: "limit" };
    input.push(chunk);
  }

  // PDF diagnostics can contain source content. The parent accepts only this
  // subprocess's bounded result protocol.
  console.log = console.warn = console.error = console.info = () => {};
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(Buffer.concat(input, bytes)),
    verbosity: 0,
    stopAtErrors: true,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isEvalSupported: false,
    enableXfa: false,
  });
  try {
    const document = await loading.promise;
    if (document.numPages > maxPages) return { error: "limit" };
    if (await document.getPermissions() !== null) return { error: "encrypted" };
    const text = [];
    let length = 0;
    const append = value => {
      if (length + value.length > maxText) return false;
      if (value) text.push(value);
      length += value.length;
      return true;
    };
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const reader = page.streamTextContent({ includeMarkedContent: false }).getReader();
      let y;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const item of value.items) {
            if (typeof item.str !== "string") continue;
            const nextY = item.transform?.[5];
            if (Number.isFinite(y) && Number.isFinite(nextY) && Math.abs(y - nextY) > 2 && !append("\n")) return { error: "limit" };
            if (!append(item.str) || (item.hasEOL && !append("\n"))) return { error: "limit" };
            y = item.hasEOL ? undefined : nextY;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        page.cleanup();
      }
      if (text.length && !append("\n")) return { error: "limit" };
    }
    return { text: text.join("") };
  } finally {
    await loading.destroy().catch(() => {});
  }
}

try {
  if (![maxBytes, maxText, maxPages].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Missing parse limits.");
  process.stdout.write(JSON.stringify(await extract()));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error?.name === "PasswordException" ? "encrypted" : "invalid" }));
}
