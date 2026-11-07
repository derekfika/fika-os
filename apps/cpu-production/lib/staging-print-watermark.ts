export const STAGING_PRINT_WARNING = "STAGING / NOT FOR OPERATIONAL USE";

const watermarkStyle = [
  '<style id="fika-staging-print-watermark-style">',
  '@page{margin-top:16mm!important;@top-center{content:"STAGING / NOT FOR OPERATIONAL USE";display:block;box-sizing:border-box;width:100%;padding:1.2mm 2mm;border:.4mm solid #a61b1b;background:#fff;color:#a61b1b;text-align:center;font:700 8pt/1.1 Arial,sans-serif;letter-spacing:.12em;-webkit-print-color-adjust:exact;print-color-adjust:exact}}',
  '.fika-staging-print-watermark{display:none!important}',
  '</style>'
].join("");

export function addStagingPrintWatermark(html: string, runtimeMode?: string) {
  if (runtimeMode !== "staging" || html.includes('id="fika-staging-print-watermark-style"')) return html;
  const headClose = html.search(/<\/head\s*>/i);
  const bodyOpen = html.match(/<body\b[^>]*>/i);
  if (headClose < 0 || !bodyOpen || bodyOpen.index === undefined) {
    throw new Error("Staging print watermark requires a complete HTML document");
  }
  return html.slice(0, headClose) + watermarkStyle + html.slice(headClose);
}
