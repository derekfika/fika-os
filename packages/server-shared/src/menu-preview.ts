import type { MenuLayoutPlan, PlanElement } from "./menu-formats";

/**
 * Offline preview of a MenuLayoutPlan as a self-contained HTML page. Lets a
 * layout be inspected (and its text fit measured in a real browser) without
 * Google credentials. It draws exactly the plan's geometry in points; it is a
 * review aid, not the production renderer.
 */

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pt = (value: number) => `${value}pt`;
const box = (rect: { x: number; y: number; w: number; h: number }) => `left:${pt(rect.x)};top:${pt(rect.y)};width:${pt(rect.w)};height:${pt(rect.h)}`;

function renderElement(element: PlanElement, assets: Record<string, string>, fontFamily: string) {
  if (element.type === "rect") return `<div class="el" style="${box(element.rect)};background:${element.fill};${element.stroke ? `outline:${pt(element.stroke.width)} solid ${element.stroke.color};outline-offset:-${pt(element.stroke.width / 2)}` : ""}"></div>`;
  if (element.type === "image") {
    const href = assets[element.asset];
    const rotation = element.rotation ? `transform:rotate(${element.rotation}deg);` : "";
    if (!href) return `<div class="el missing" style="${box(element.rect)};${rotation}" title="missing asset ${esc(element.asset)}"></div>`;
    // The tablet header art is a full-page bitmap clipped to the header band.
    if (element.role === "header-bg") return `<div class="el" style="${box(element.rect)};background:url('${esc(href)}') 0 -3.4pt / ${pt(element.rect.w)} auto no-repeat"></div>`;
    return `<img class="el" style="${box(element.rect)};${rotation}" src="${esc(href)}" alt="" />`;
  }
  if (element.type === "static-text") return `<div class="el" style="${box(element.rect)};display:flex;align-items:center;justify-content:${element.align === "right" ? "flex-end" : element.align === "center" ? "center" : "flex-start"};font:${element.bold ? 700 : 400} ${pt(element.fontPt)} '${fontFamily}',sans-serif;color:${element.color}">${esc(element.text)}</div>`;
  const paragraphs = element.paragraphs.map(paragraph => `<p style="margin:${pt(paragraph.spaceBeforePt)} 0 0;font-size:${pt(paragraph.fontPt)};font-weight:${paragraph.bold ? 700 : 400};font-style:${paragraph.italic ? "italic" : "normal"};color:${paragraph.color}" data-role="${paragraph.role}${paragraph.allergenKind ? `:${paragraph.allergenKind}` : ""}">${esc(paragraph.text)}</p>`).join("");
  // Text area = element rect minus insets, exactly as the Slides box reproduces it.
  return `<div class="el text" data-text-area="${element.rect.w - element.insetX * 2}x${element.rect.h - element.insetY * 2}" style="${box(element.rect)};padding:${pt(element.insetY)} ${pt(element.insetX)};display:flex;flex-direction:column;justify-content:${element.anchor === "middle" ? "center" : "flex-start"};text-align:${element.align};line-height:${element.lineHeight}"><div class="inner">${paragraphs}</div></div>`;
}

export function renderMenuPlanHtml(plan: MenuLayoutPlan, options: { title: string; assets?: Record<string, string> }) {
  const assets = options.assets || {};
  const pages = plan.pages.map(page => `<section><h2>Page ${page.index + 1} of ${plan.pages.length}</h2><div class="page" style="width:${pt(plan.page.w)};height:${pt(plan.page.h)}">${page.elements.map(element => renderElement(element, assets, plan.fontFamily)).join("")}</div></section>`).join("");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(options.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
body{margin:0;padding:16px;background:#e9ecef;font-family:'${plan.fontFamily}',sans-serif}
h1{font:600 16px sans-serif;margin:0 0 4px}h2{font:600 12px sans-serif;margin:16px 0 6px;color:#444}
#summary{font:13px sans-serif;margin:0 0 8px}
.page{position:relative;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.35);overflow:hidden}
.el{position:absolute;box-sizing:border-box}
img.el{object-fit:fill}
.text{overflow:hidden;box-sizing:border-box;font-family:'${plan.fontFamily}',sans-serif}
.text.overflow{outline:2pt solid #f0f !important}
.missing{background:repeating-linear-gradient(45deg,#fcc,#fcc 4px,#fff 4px,#fff 8px)}
</style></head><body>
<h1>${esc(options.title)}</h1><div id="summary">${esc(`${plan.format} · layout master ${plan.masterKey} · ${plan.pages.length} page(s) · ${plan.itemCount} dish(es) · ${plan.capacityPerPage}/page`)} — <span id="fit">measuring…</span></div>
${pages}
<script>
document.fonts.ready.then(()=>{let bad=0,n=0;document.querySelectorAll('.text').forEach(el=>{n++;const cs=getComputedStyle(el);const avail=el.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);const inner=el.firstElementChild;if(inner.scrollHeight>avail+0.5){el.classList.add('overflow');bad++}});
document.getElementById('fit').textContent=bad?bad+' of '+n+' text boxes OVERFLOW in this browser':'all '+n+' text boxes fit in this browser ('+(document.fonts.check('12px Montserrat')?'Montserrat loaded':'Montserrat NOT loaded, fallback font')+')';window.__fit={bad,n}});
</script></body></html>`;
}
