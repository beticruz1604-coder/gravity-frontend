// Prueba del visor de TechDocs: renderiza páginas de MkDocs, navega entre ellas y elimina todo lo ejecutable o externo.
// Sirve dist/ y simula la API de Backstage con las páginas de tests/fixtures/techdocs.
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve("dist");
const fixtures = path.resolve("tests/fixtures/techdocs");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" };
const server = http
  .createServer((req, res) => {
    let file = path.join(root, req.url.split("?")[0]);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(5198);

const entity = {
  apiVersion: "backstage.io/v1alpha1", kind: "Component",
  metadata: { name: "mi-comp", namespace: "default", annotations: { "backstage.io/techdocs-ref": "url:https://dev.azure.com/o/p/_git/mi-comp", "dev.azure.com/project-repo": "demos/mi-comp", "dev.azure.com/build-definition": "mi-comp-ci" } },
  spec: { type: "service", lifecycle: "production", owner: "group:default/dev" },
};
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const requests = [];
page.on("request", (r) => requests.push(r.url()));
await page.route("**/backstage/**", (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname;
  if (p.includes("/api/auth/")) return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  if (p.endsWith("/api/catalog/entities")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([entity]) });
  if (p.includes("/api/techdocs/metadata/techdocs/default/component/mi-comp")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ build_timestamp: 1792814068814 }) });
  const m = /\/api\/techdocs\/static\/docs\/default\/component\/mi-comp\/(.*)$/.exec(p);
  if (m) {
    const f = path.join(fixtures, m[1]);
    if (fs.existsSync(f)) return route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: fs.readFileSync(f, "utf8") });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: /entities|items|components|tasks|pipelines/.test(p) ? "[]" : "{}" });
});

await page.goto("http://localhost:5198/");
await page.waitForSelector(".sidebar nav button", { timeout: 15000 });
await page.locator(".sidebar nav button", { hasText: "Catálogo" }).first().click();
await page.locator("text=mi-comp").first().click();
await page.getByRole("button", { name: "Docs" }).click();
await page.waitForSelector(".techdocs-content h1", { timeout: 10000 });

check((await page.locator(".techdocs-content h1").innerText()).includes("Mi componente"), "no se muestra el título de la página");
check((await page.locator(".techdocs-nav button").count()) === 2, "la navegación debería tener 2 páginas (sin el ancla #seccion)");
check((await page.evaluate(() => window.pwned)) === undefined, "se ejecutó código de la documentación (window.pwned)");
check((await page.locator(".techdocs-content script, .techdocs-content [onerror]").count()) === 0, "quedaron scripts o manejadores en el contenido");
check((await page.locator('.techdocs-content a[href^="javascript"]').count()) === 0, "quedó un enlace javascript:");
check(!requests.some((u) => u.includes("tracker.example")), "se pidió una imagen externa");
check(requests.some((u) => u.includes("/backstage/api/techdocs/static/docs/default/component/mi-comp/assets/logo.png")), "la imagen relativa no apunta al almacén de la documentación");
check((await page.locator('.techdocs-content a[target="_blank"][rel*="noopener"]').count()) === 1, "el enlace externo debe abrir en otra pestaña con noopener");

await page.locator(".techdocs-content a", { hasText: "enlace a despliegue" }).click();
await page.waitForSelector(".techdocs-content h1:has-text('Despliegue')", { timeout: 10000 });
check((await page.locator(".techdocs-content p").innerText()).includes("Pasos de despliegue"), "no navegó a la página de despliegue");
await page.locator(".techdocs-content a", { hasText: "volver" }).click();
await page.waitForSelector(".techdocs-content h1:has-text('Mi componente')", { timeout: 10000 });

await browser.close();
server.close();
if (failures.length) { console.error("FALLO:\n - " + failures.join("\n - ")); process.exit(1); }
console.log("OK: visor de TechDocs");
