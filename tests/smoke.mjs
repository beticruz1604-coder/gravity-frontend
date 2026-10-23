// Prueba de humo: la aplicación arranca y se puede recorrer todo el menú sin errores no controlados.
// Sirve dist/ con un servidor mínimo y simula la API de Backstage (el front se prueba sin ningún servicio detrás).
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve("dist");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http
  .createServer((req, res) => {
    let file = path.join(root, req.url.split("?")[0]);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(5197);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|status of 4|status of 5/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 160)}`));

// API simulada: listas vacías o un objeto vacío; la aplicación debe mostrar estados vacíos o avisos, no romperse.
await page.route("**/backstage/**", (route) => {
  const url = route.request().url();
  if (url.includes("/api/auth/")) return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  const lista = /entities|tasks|pipelines|agent-pools|branches|policies|repositories|items|components|baseline|clusters/.test(url);
  return route.fulfill({ status: 200, contentType: "application/json", body: lista ? "[]" : "{}" });
});

await page.goto("http://localhost:5197/");
await page.waitForSelector(".sidebar nav button", { timeout: 15000 });
const pantallas = await page.locator(".sidebar nav button").allInnerTexts();
for (const nombre of pantallas) {
  await page.locator(".sidebar nav button", { hasText: nombre.trim() }).first().click();
  await page.waitForTimeout(700);
}
console.log(`pantallas recorridas: ${pantallas.length}`);

await browser.close();
server.close();
if (errors.length > 0) {
  console.error(`FALLO: ${errors.length} error(es) no controlado(s):\n` + errors.slice(0, 10).join("\n"));
  process.exit(1);
}
console.log("OK: sin errores no controlados");
