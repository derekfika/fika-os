const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const index = fs.readFileSync(path.join(root, "Index.html"), "utf8")
  .replace('<?!= include_("Styles"); ?>', fs.readFileSync(path.join(root, "Styles.html"), "utf8"))
  .replace('<?!= include_("Script"); ?>', fs.readFileSync(path.join(root, "Script.html"), "utf8"))
  .replace("<?= appName ?>", "CPU Production");

http.createServer(function(req, res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(index);
}).listen(4173, "127.0.0.1", function() {
  console.log("CPU dashboard preview: http://127.0.0.1:4173");
});
