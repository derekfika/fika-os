export const STAGING_PRINT_WARNING = "STAGING / NOT FOR OPERATIONAL USE";

const watermarkStyle = [
  '<style id="fika-staging-print-watermark-style">',
  '.fika-staging-print-watermark-row{display:none!important}',
  '@media print{.fika-staging-print-watermark-row{display:table-row!important}.fika-staging-print-watermark-row th{height:auto!important;padding:2mm!important;border:.4mm solid #a61b1b!important;background:#fff!important;color:#a61b1b!important;text-align:center!important;font:700 8pt/1.1 Arial,sans-serif!important;letter-spacing:.12em!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}',
  '</style>'
].join("");

function markStagingRuntime(html: string) {
  const root = html.match(/<html\b[^>]*>/i)?.[0];
  if (!root) throw new Error("Staging print watermark requires a complete HTML document");
  const current = root.match(/\bdata-fika-runtime=["']([^"']+)["']/i)?.[1];
  if (current && current !== "staging") {
    throw new Error("Staging print output has a conflicting runtime marker");
  }
  if (current === "staging") return html;
  return html.replace(root, root.replace(/>$/, ' data-fika-runtime="staging">'));
}

function addWarningToTableHeaders(html: string) {
  let headerCount = 0;
  const withRows = html.replace(/<thead\b([^>]*)>([\s\S]*?)<\/thead\s*>/gi, (_match, attributes: string, contents: string) => {
    headerCount++;
    if (contents.includes("fika-staging-print-watermark-row")) return `<thead${attributes}>${contents}</thead>`;
    const firstRow = contents.match(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/i)?.[0];
    const columns = firstRow?.match(/<th\b/gi)?.length || 0;
    if (!firstRow || !columns) {
      throw new Error("Staging print table header has no readable columns");
    }
    const row = `<tr class="fika-staging-print-watermark-row"><th colspan="${columns}">${STAGING_PRINT_WARNING}</th></tr>`;
    return `<thead${attributes}>${row}${contents}</thead>`;
  });
  if (!headerCount) throw new Error("Staging print output has no repeatable table header");
  return withRows;
}

export function addStagingPrintWatermark(html: string, runtimeMode?: string) {
  if (runtimeMode !== "staging") return html;
  if (html.includes('id="fika-staging-print-watermark-style"')) return html;

  const marked = markStagingRuntime(html);
  // Run sheets are paginated into one explicit section per printed page by the
  // client helper. That helper adds the warning to each section's page heading.
  if (marked.includes('id="day-pages"')) return marked;

  const headClose = marked.search(/<\/head\s*>/i);
  if (headClose < 0) throw new Error("Staging print watermark requires a complete HTML document");
  const withRows = addWarningToTableHeaders(marked);
  return withRows.slice(0, headClose) + watermarkStyle + withRows.slice(headClose);
}
