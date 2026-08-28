import http from "node:http";
import { MAX_BODY_BYTES, renderPdf } from "./renderer.mjs";

const token = process.env.FIKA_PDF_RENDERER_TOKEN?.trim();
const port = Number(process.env.PORT || 8080);


function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    request.setEncoding("utf8");
    request.on("data", chunk => { size += Buffer.byteLength(chunk); if (size > MAX_BODY_BYTES) reject(new Error("request exceeds the limit")); else body += chunk; });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/render/pdf") { response.writeHead(404).end(); return; }
  if (!token) { response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "renderer authentication is not configured" })); return; }
  if (request.headers["x-fika-renderer-token"] !== token) { response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "renderer authentication failed" })); return; }
  try {
    const input = JSON.parse(await readBody(request));
    const pdf = await renderPdf(input.html, input.options);
    if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("renderer produced invalid PDF bytes");
    response.writeHead(200, { "content-type": "application/pdf", "cache-control": "no-store", "content-length": pdf.length }).end(pdf);
  } catch (error) {
    response.writeHead(422, { "content-type": "application/json" }).end(JSON.stringify({ error: `PDF_RENDERER_ERROR: ${error.message}` }));
  }
});

server.listen(port, "0.0.0.0");
