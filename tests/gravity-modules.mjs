// Secciones propias de GRAVITY (Soporte DevSecOps, Insights, Error Analytics, Log Analyzer): muestran su descripción
// en lugar de «próximamente». Sirve dist/ y simula la API de Backstage.
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve("dist");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" };
const server = http
  .createServer((req, res) => {
    let file = path.join(root, req.url.split("?")[0]);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(5199);

const MODULES = { "Soporte DevSecOps": "Chatbot", Insights: "Métricas", "Error Analytics": "fallas", "Log Analyzer": "logs" };
const fallos = [];
const espera = (cond, msg) => cond || fallos.push(msg);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errores = [];
page.on("pageerror", (e) => errores.push(e.message));
await page.route("**/backstage/**", (route) => {
  const url = route.request().url();
  if (url.includes("/api/access/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, roles: [{ id: "x", name: "Rol de prueba" }], sections: Object.keys(MODULES), admin: false }) });
  if (url.includes("/api/auth/")) return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  return route.fulfill({ status: 200, contentType: "application/json", body: /entities|tasks|pipelines/.test(url) ? "[]" : "{}" });
});
await page.goto("http://localhost:5199/");
await page.waitForTimeout(1500);

for (const [name, word] of Object.entries(MODULES)) {
  await page.locator(".sidebar nav button", { hasText: name }).click();
  await page.waitForTimeout(400);
  const texto = await page.locator("main").innerText();
  espera(texto.includes(word), `${name}: falta su descripción`);
  espera(!texto.includes("Backstage"), `${name}: la descripción no debe mencionar Backstage`);
  espera(!texto.includes("próximamente"), `${name}: sigue diciendo «próximamente»`);
  if (process.env.SHOT && name === "Soporte DevSecOps") await page.screenshot({ path: process.env.SHOT });
}
espera(errores.length === 0, `Errores no controlados: ${errores.join("; ")}`);

await browser.close();
server.close();
if (fallos.length) {
  console.error(fallos.join("\n"));
  process.exit(1);
}
console.log("OK: secciones de GRAVITY con su descripción");
