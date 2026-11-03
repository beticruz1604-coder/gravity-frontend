// Prueba del Catálogo: pestañas (sin Usuarios ni Plantillas), filtros por varias categorías a la vez, clic en los valores de
// la tabla (Dominio / Torre y Producto / Sistema abren su ficha; Legado, Crítico, Tipo y Etiquetas filtran) y la vista que se
// conserva al volver de una ficha. Sirve dist/ y simula la API.
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
  .listen(5198);

const group = (name, title) => ({ apiVersion: "backstage.io/v1alpha1", kind: "Group", metadata: { name, namespace: "default" }, spec: { type: "business-unit", profile: { displayName: title } }, relations: [] });
const component = (name, owner, division, initiative, legacy, critical, type, tags) => ({
  apiVersion: "backstage.io/v1alpha1", kind: "Component",
  metadata: {
    name, namespace: "default", title: name, description: `Servicio ${name}`, tags,
    annotations: { "devops.lab/division": division, "devops.lab/initiative": initiative, "devops.lab/legacy": legacy, "devops.lab/critical": critical }
  },
  spec: { type, lifecycle: "experimental", owner: `group:default/${owner}` },
  relations: [{ type: "ownedBy", targetRef: `group:default/${owner}` }]
});
const classified = (kind, name, value) => ({
  apiVersion: "backstage.io/v1alpha1", kind,
  metadata: { name, namespace: "default", title: value, description: `${kind} ${value}`, annotations: { "devops.lab/classification-value": value } },
  spec: { owner: "group:default/admin" }, relations: []
});
const entities = [
  group("cadena-de-suministro", "Cadena de Suministro"),
  group("digital", "Digital"),
  component("svc-oms", "cadena-de-suministro", "OMS", "CEDIS WEB", "false", "true", "service", ["java", "java-21"]),
  component("svc-wms", "cadena-de-suministro", "WMS", "Test", "true", "true", "service", ["java", "java-17"]),
  component("web-digital", "digital", "Digital", "CEDIS WEB", "false", "false", "website", ["react"]),
  classified("Domain", "oms", "OMS"),
  classified("Domain", "wms", "WMS"),
  classified("Domain", "digital", "Digital"),
  classified("System", "cedis-web", "CEDIS WEB"),
  classified("System", "test", "Test"),
  { apiVersion: "backstage.io/v1alpha1", kind: "User", metadata: { name: "ana", namespace: "default" }, spec: {}, relations: [] },
  { apiVersion: "backstage.io/v1alpha1", kind: "Template", metadata: { name: "golden-java", namespace: "default" }, spec: { type: "service" }, relations: [] }
];

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|status of 4|status of 5/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 160)}`));

await page.route("**/backstage/**", (route) => {
  const url = route.request().url();
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.includes("/api/access/me")) return json({ authenticated: true, roles: [], sections: ["Resumen", "Catálogo"], admin: false });
  if (url.includes("/api/auth/")) return json({}, 403);
  const byName = url.match(/entities\/by-name\/([^/]+)\/default\/([^/?]+)/);
  if (byName) {
    const e = entities.find((x) => x.kind.toLowerCase() === byName[1] && x.metadata.name === decodeURIComponent(byName[2]));
    return e ? json(e) : json({}, 404);
  }
  if (/\/api\/catalog\/entities(\?|$)/.test(url)) {
    const kind = url.match(/filter=kind=([a-z]+)/)?.[1];
    return json(kind ? entities.filter((e) => e.kind.toLowerCase() === kind) : entities);
  }
  return json(/entities|tasks|pipelines|branches|policies|repositories|items|components|baseline|clusters/.test(url) ? [] : {});
});

const fail = (m) => errors.push(`FALLO: ${m}`);
const rowNames = async () => page.locator(".pool-table tbody tr td:first-child").allInnerTexts();
const tab = (label) => page.locator(".homologation-tabs button", { hasText: new RegExp(`^${label}$`) });
const option = (legend, value) => page.locator(".catalog-filter-panel fieldset", { has: page.locator("legend", { hasText: legend }) }).locator("label", { hasText: value }).locator("input");

await page.goto("http://localhost:5198/");
await page.waitForSelector(".sidebar nav button", { timeout: 15000 });
await page.locator(".sidebar nav button", { hasText: "Catálogo" }).first().click();
await page.waitForFunction(() => document.querySelectorAll(".pool-table tbody tr").length >= 3, null, { timeout: 15000 });

// 1) Pestañas: sin Usuarios ni Plantillas.
const tabs = await page.locator(".homologation-tabs button").allInnerTexts();
if (tabs.join("|") !== "Componentes|APIs|Recursos|Sistemas|Dominios|Grupos|Grafo") fail(`pestañas inesperadas: ${tabs.join(", ")}`);

// 2) Tipo en español.
if (!(await page.locator(".pool-table tbody").innerText()).includes("Sitio web")) fail("el tipo website debe verse como «Sitio web»");

// 3) Filtros combinados: dos valores de una categoría se suman; dos categorías deben cumplirse a la vez.
await page.locator('[data-testid="filter-button"]').click();
await option("Dominio / Torre", "OMS").check();
await option("Dominio / Torre", "WMS").check();
if ((await rowNames()).sort().join(",") !== "svc-oms,svc-wms") fail(`OMS o WMS: ${(await rowNames()).join(",")}`);
await option("Legado", "Sí").check();
if ((await rowNames()).join(",") !== "svc-wms") fail(`OMS o WMS, y legado: ${(await rowNames()).join(",")}`);
if ((await page.locator('[data-testid="filter-chips"] .catalog-filter-chip').count()) !== 3) fail("debía haber 3 filtros activos");
if (!(await page.locator('[data-testid="filter-button"]').innerText()).includes("(3)")) fail("el botón debe mostrar cuántos filtros hay");
await page.locator(".catalog-filter-chips .link-button", { hasText: "Limpiar filtros" }).click();
if ((await rowNames()).length !== 3) fail("al limpiar deben volver los 3 componentes");
await page.locator('[data-testid="filter-button"]').click();

// 4) Clic en un valor que filtra (Crítico = No) y en una etiqueta.
await page.locator(".pool-table tbody tr", { hasText: "web-digital" }).locator("td").nth(6).locator("button").click();
if ((await rowNames()).join(",") !== "web-digital") fail(`clic en Crítico = No: ${(await rowNames()).join(",")}`);
await page.locator(".catalog-filter-chips .link-button", { hasText: "Limpiar filtros" }).click();
await page.locator(".pool-table .tag-link", { hasText: "java-17" }).click();
if ((await rowNames()).join(",") !== "svc-wms") fail(`clic en la etiqueta java-17: ${(await rowNames()).join(",")}`);
await page.locator(".catalog-filter-chips .link-button", { hasText: "Limpiar filtros" }).click();

// 5) Clic en el Producto / Sistema abre su ficha con sus componentes; al volver sigue en Componentes con la búsqueda.
await page.locator(".search-input-wrapper input").fill("svc");
await page.locator(".pool-table tbody tr", { hasText: "svc-oms" }).locator("button", { hasText: "CEDIS WEB" }).click();
await page.waitForSelector('[data-testid="member-components"]', { timeout: 10000 }).catch(() => fail("la ficha del sistema no lista sus componentes"));
const members = await page.locator('[data-testid="member-components"] tbody td:first-child').allInnerTexts();
if (members.sort().join(",") !== "svc-oms,web-digital") fail(`componentes de CEDIS WEB: ${members.join(",")}`);
await page.locator(".back-button").click();
await page.waitForSelector(".pool-table tbody tr", { timeout: 10000 });
if (!(await tab("Componentes").getAttribute("class"))?.includes("selected")) fail("al volver debía seguir en Componentes");
if ((await page.locator(".search-input-wrapper input").inputValue()) !== "svc") fail("al volver debía conservarse la búsqueda");
await page.locator(".search-input-wrapper input").fill("");

// 6) Dominio / Torre abre la ficha del dominio.
await page.locator(".pool-table tbody tr", { hasText: "svc-wms" }).locator("button", { hasText: /^WMS$/ }).click();
await page.waitForSelector('[data-testid="member-components"]', { timeout: 10000 });
if (!(await page.locator(".module-eyebrow").first().innerText()).includes("DOMINIO")) fail("la ficha debía ser de un dominio");
await page.locator(".back-button").click();

// 7) Pestaña Dominios: el número de componentes lleva a Componentes filtrado por ese dominio.
await tab("Dominios").click();
const domains = await rowNames();
if (domains.sort().join(",") !== "Digital,OMS,WMS") fail(`dominios: ${domains.join(",")}`);
await page.locator(".pool-table tbody tr", { hasText: "OMS" }).locator("td").nth(2).locator("button").click();
if (!(await tab("Componentes").getAttribute("class"))?.includes("selected")) fail("el número de componentes debía llevar a Componentes");
if ((await rowNames()).join(",") !== "svc-oms") fail(`componentes del dominio OMS: ${(await rowNames()).join(",")}`);

await browser.close();
server.close();
if (errors.length > 0) {
  console.error(`FALLO: ${errors.length} problema(s):\n` + errors.slice(0, 10).join("\n"));
  process.exit(1);
}
console.log("OK: pestañas, filtros combinados, valores con enlace y vista conservada al volver");
