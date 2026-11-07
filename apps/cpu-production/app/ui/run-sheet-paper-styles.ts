export const paperRunSheetStyles = `
@font-face{font-family:"FIKA Vim";src:url("/fonts/Vim-Heavy.otf") format("opentype");font-weight:900}
@font-face{font-family:"FIKA Gilroy";src:url("/fonts/Gilroy-Regular.ttf") format("truetype");font-weight:400}
@font-face{font-family:"FIKA Gilroy";src:url("/fonts/Gilroy-Bold.ttf") format("truetype");font-weight:700}
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
body{margin:0;background:white;color:var(--fika-text-primary,black);font:10pt/1.25 "FIKA Gilroy",Arial,sans-serif}
.print-page{width:210mm;height:296.8mm;padding:8mm 10mm;display:flex;flex-direction:column;break-after:page}
.print-page:last-child{break-after:auto}
.day-heading{flex:none;border-bottom:1.5pt solid var(--fika-action-primary,currentColor);padding-bottom:2mm;margin-bottom:3mm}
.staging-print-warning{display:none}
html[data-fika-runtime="staging"] .staging-print-warning{display:block;margin:0 0 2mm;padding:1.2mm 2mm;border:.4mm solid #a61b1b;color:#a61b1b;text-align:center;font:700 8pt/1.1 Arial,sans-serif;letter-spacing:.12em}
.brand-lockup{display:flex;align-items:center;gap:4mm}
.wordmark{font:900 24pt/1 "FIKA Vim",Arial,sans-serif;letter-spacing:.01em;border-bottom:2pt solid var(--fika-action-primary,currentColor);padding-bottom:1mm}
.brand{font-size:9pt;font-weight:700;letter-spacing:.07em;color:var(--fika-action-secondary,currentColor)}
.day-heading h1{font:900 22pt/1.12 "FIKA Vim",Arial,sans-serif;margin:0;overflow-wrap:anywhere}
.heading-copy{flex:1;min-width:0;border-left:.6pt solid currentColor;padding-left:4mm}
.day-heading p{margin:0}
.day-heading .heading-date{align-self:center;font-size:12pt;font-weight:700;background:var(--fika-status-info-surface,transparent);padding:2mm 3mm;max-width:38%}
.day-heading .page-scope{font-size:8pt;margin-top:2mm}
.print-warning{font-size:8pt}
.day-heading .stale-warning{border-left:1.5pt solid var(--fika-action-primary,currentColor);background:var(--fika-status-info-surface,transparent);padding:1mm 2mm;margin-top:1.5mm;font-size:8pt}
.page-cards{display:flex;flex:1;min-height:0;flex-direction:column;gap:3mm}
.print-row{display:grid;gap:3mm;align-items:start;flex:none;min-width:0}
.collection{container-type:inline-size;min-width:0;overflow-wrap:anywhere;break-inside:avoid}
.collection-header{border:.6pt solid var(--fika-action-secondary,currentColor);padding:2mm 3mm;margin-bottom:2mm}
.collection-header h2{font-size:12pt;line-height:1.1;margin:0 0 1mm}
.collection-header p{margin:0}
.collection-header .event{font-size:11pt;font-weight:700;margin-bottom:1mm}
.collection-details{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1mm 3mm;margin:0}
.collection-details div{min-width:0;border-left:.5pt solid var(--fika-border-default,currentColor);padding-left:2mm}
.collection-details dt{font-size:7.5pt;font-weight:700;color:var(--fika-action-secondary,currentColor)}
.collection-details dd{margin:0;font-weight:700}
.collection-details .service-window{grid-column:span 2}
.kitchen-instructions{border:.6pt solid var(--fika-status-warning,currentColor);background:var(--fika-status-warning-surface,transparent);padding:1.5mm 2mm;margin:1mm 0 2mm;break-inside:avoid}.kitchen-instructions p{margin:1mm 0 0;white-space:normal}
.continuation{font-size:8pt;font-weight:700;margin-top:1mm!important}
.collection table{width:100%;border-collapse:collapse;table-layout:fixed;border:.6pt solid var(--fika-text-secondary,currentColor)}
.collection th,.collection td{text-align:left;vertical-align:middle;padding:1mm 2mm;border-bottom:.5pt solid var(--fika-border-default,currentColor);font-size:10pt;overflow-wrap:anywhere;white-space:normal}
.collection thead{display:table-header-group}
.collection thead th{font-size:9pt;color:var(--fika-action-secondary,currentColor);border-top:1.2pt solid var(--fika-action-primary,currentColor);border-bottom:1pt solid currentColor}
.collection tr{break-inside:avoid}
.collection .menu-section-row th{padding:1mm 2mm;border:.7pt solid var(--fika-action-secondary,currentColor);background:var(--fika-status-info-surface,transparent);color:var(--fika-action-secondary,currentColor);font-size:9pt;letter-spacing:.035em}
.collection .check{width:15mm;text-align:center}
.collection .category-column{width:23%}
.collection .category{font-weight:700}
.collection .quantity{width:21%;text-align:right;font-variant-numeric:tabular-nums}
.collection .stripe{background:var(--fika-surface-subtle,transparent)}
.collection .core-salad{background:var(--fika-status-success-surface,transparent)}
.core-salad-label{display:inline-block;margin-left:1mm;padding:0 1mm;border:.6pt solid currentColor;border-radius:1mm;color:var(--fika-status-success,currentColor);font-size:7.5pt;font-weight:700;white-space:nowrap}
.box{display:block;width:6mm;height:6mm;border:1pt solid currentColor;border-radius:.35mm;margin:auto}
.handover{margin-top:3mm;border-top:1.2pt solid var(--fika-action-primary,currentColor);padding-top:1.5mm;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1.5mm 4mm;font-size:8pt;font-weight:700;break-inside:avoid}
.handover span{grid-column:span 2;min-height:8mm;border-bottom:.6pt solid currentColor}
.handover .signature,.handover .notes{grid-column:span 3}
.handover .signature{grid-column:1/span 3}
.page-number{flex:none;text-align:right;font-size:8pt;margin:1.5mm 0 0}
#collection-source,#measure-card{position:absolute;left:-10000px;top:0;width:190mm;visibility:hidden}
@container (max-width:120mm){
  .collection-details{grid-template-columns:repeat(2,minmax(0,1fr))}
  .collection th,.collection td{padding:1mm;font-size:9pt}
  .collection .check{width:11mm}
  .collection .quantity{width:23%}
  .handover{gap:1.5mm 2mm}
}
@media screen{.print-page{background:white;margin:0 auto 5mm}}
@media print{
  html{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  #collection-source,#measure-card{display:none!important}
  .print-page{margin:0}
}
`;
