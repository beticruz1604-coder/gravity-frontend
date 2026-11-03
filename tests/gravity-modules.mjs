// Secciones propias de GRAVITY (Soporte DevSecOps, Insights, Error Analytics, Log Analyzer): muestran lo que Backstage les da,
// sus fuentes y enlaces solo a las secciones que el rol puede ver. Sirve dist/ y simula la API de Backstage.
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

const MODULES = ["Soporte DevSecOps", "Insights", "Error Analytics", "Log Analyzer"];
const sections = [...MODULES, "Catálogo", "Compliance IQ"];
const fallos = [];
const espera = (cond, msg) => cond || fallos.push(msg);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errores = [];
page.on("pageerror", (e) => errores.push(e.message));
await page.route("**/backstage/**", (route) => {
  const url = route.request().url();
  if (url.includes("/api/access/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, roles: [{ id: "x", name: "Rol de prueba" }], sections, admin: false }) });
  if (url.includes("/api/auth/")) return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  const lista = /entities|tasks|pipelines|agent-pools|branches|policies|repositories|items|components|baseline|clusters|reports/.test(url);
  return route.fulfill({ status: 200, contentType: "application/json", body: lista ? "[]" : "{}" });
});
await page.goto("http://localhost:5199/");
await page.waitForTimeout(1500);

for (const name of MODULES) {
  await page.locator(".sidebar nav button", { hasText: name }).click();
  await page.waitForTimeout(400);
  const texto = await page.locator("main").innerText();
  espera(texto.includes("Lo que Backstage le da a esta sección"), `${name}: falta lo que aporta Backstage`);
  espera(texto.includes("/api/") && texto.includes("Módulo de GRAVITY:"), `${name}: faltan las fuentes o el módulo de GRAVITY`);
  espera(!texto.includes("próximamente"), `${name}: sigue diciendo «próximamente»`);
}
// Insights enlaza a Release Management y Catálogo; el rol no ve Release Management, así que solo aparece Catálogo.
await page.locator(".sidebar nav button", { hasText: "Insights" }).click();
await page.waitForTimeout(300);
const enlaces = (await page.locator("main .gravity-module-links button").allInnerTexts()).map((t) => t.trim());
espera(JSON.stringify(enlaces) === JSON.stringify(["Catálogo"]), `Insights: los enlaces debían ser [Catálogo] y fueron ${JSON.stringify(enlaces)}`);
await page.locator(".sidebar nav button", { hasText: "Soporte DevSecOps" }).click();
await page.waitForTimeout(300);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
await page.locator("main .gravity-module-links button", { hasText: "Compliance IQ" }).click();
await page.waitForTimeout(600);
espera((await page.locator(".sidebar nav button.active").innerText().catch(() => "")).includes("Compliance IQ") || !(await page.locator("main").innerText()).includes("Lo que Backstage le da"), "El enlace a Compliance IQ no navegó");
espera(errores.length === 0, `Errores no controlados: ${errores.join("; ")}`);

await browser.close();
server.close();
if (fallos.length) {
  console.error(fallos.join("\n"));
  process.exit(1);
}
console.log("OK: secciones de GRAVITY con lo que aporta Backstage");
