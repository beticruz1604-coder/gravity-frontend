// Prueba de la pantalla Homologation Status: la columna «Homologado con» y la ventana desplegable con la referencia
// (política, línea base o comparación entre ambientes). Sirve dist/ y simula la API de Backstage.
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

const items = [
  {
    id: "tecnologia:svc:node", category: "componente", scope: "tecnologia", name: "svc · Node.js", type: "Tecnología", version: "22", environment: "todos",
    status: "en-revision", description: "Node.js (node)", reason: "22: el soporte termina el 2027-04-30",
    reference: {
      kind: "linea-base", summary: "Línea base de Node/Express: 24, 22.",
      sections: [
        { title: "Versiones aprobadas", items: ["24", "22 (soporte hasta 2027-04-30)"] },
        { title: "Este componente", items: ["Valor encontrado: 22 (en Dockerfile)."] }
      ]
    }
  },
  {
    id: "despliegue:svc:qa", category: "componente", scope: "despliegue", name: "svc", type: "Componente", version: "1.0.0", environment: "qa",
    status: "homologado", description: "Despliegue de svc en qa", reason: "Misma versión",
    // Sin referencia (backend antiguo): la celda debe mostrar un guion y no romper nada.
  },
  {
    id: "despliegue:svc:develop", category: "componente", scope: "despliegue", name: "svc", type: "Componente", version: "1.0.0", environment: "develop",
    status: "homologado", description: "Despliegue de svc en develop", reason: "Misma versión",
    // Referencia incompleta: sin secciones.
    reference: { kind: "paridad", summary: "Misma versión y mismo código en todos los ambientes." }
  },
  {
    id: "recurso:gke", category: "infraestructura", scope: "recurso", name: "cluster-dev", type: "GKE", version: "1.29", environment: "develop",
    status: "homologado", description: "GKE", reason: "ok",
    checks: [
      { title: "Versión aprobada para este ambiente", result: "cumple", detail: "La versión 1.29 está aprobada para este ambiente." },
      { title: "Igual entre ambientes (GKE)", result: "no-cumple", detail: "qa va en 1.28" }
    ],
    reference: { kind: "politica", summary: "Versión aprobada: 1.29, 1.30.", sections: [{ title: "Política de versiones en develop", items: ["Versión aprobada: 1.29, 1.30."] }] }
  }
];

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|status of 4|status of 5/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 160)}`));

await page.route("**/backstage/**", (route) => {
  const url = route.request().url();
  if (url.includes("/api/access/me")) {
    const secciones = ["Resumen", "Catálogo", "Soporte DevSecOps", "Insights", "Repositories", "Pipelines", "Releases", "TechDebt", "Pool de Agentes", "Compliance IQ", "Error Analytics", "Tools Health", "Log Analyzer", "Homologation Status", "Pipeline Engine (IDP)", "Usuarios"];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, roles: [], sections: secciones, admin: true }) });
  }
  if (url.includes("/api/auth/")) return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  if (url.includes("/api/homologation/requirements")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      infrastructure: { environments: ["develop", "qa"], optionalEnvironments: [], perResource: [{ type: "GKE", rules: ["Versión aprobada: 1.29, 1.30."] }], betweenEnvironments: [{ id: "gke", title: "GKE", compares: "la versión", rule: "Misma versión en todos los ambientes." }] },
      components: { environments: ["develop", "qa"], deployment: ["Misma versión en todos los ambientes."], technologies: [{ id: "node", title: "Node/Express", detect: "package.json", checks: [{ title: "Node.js", required: true, approved: ["24", "22"], review: [] }] }] }
    }) });
  }
  if (url.includes("/api/homologation/items")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, warnings: [] }) });
  const lista = /entities|tasks|pipelines|agent-pools|branches|policies|repositories|items|components|baseline|clusters/.test(url);
  return route.fulfill({ status: 200, contentType: "application/json", body: lista ? "[]" : "{}" });
});

const fail = (m) => errors.push(`FALLO: ${m}`);
await page.goto("http://localhost:5198/");
await page.waitForSelector(".sidebar nav button", { timeout: 15000 });
await page.locator(".sidebar nav button", { hasText: "Homologation Status" }).first().click();

// Infraestructura: sin columna de motivo; el registro se despliega y muestra qué cumple y qué no.
await page.waitForSelector(".pool-table tbody tr", { timeout: 10000 });
if (!(await page.locator(".pool-table th", { hasText: "Homologado con" }).count())) fail("falta la columna «Homologado con»");
if (await page.locator(".pool-table th", { hasText: "Motivo" }).count()) fail("la columna de motivo debía quitarse");
if (!(await page.locator("tbody tr", { hasText: "cluster-dev" }).innerText()).includes("Versión aprobada: 1.29, 1.30.")) fail("la fila de infraestructura no muestra su referencia");
const gke = page.locator(".reference-toggle", { hasText: "cluster-dev" });
if ((await page.locator(".reference-detail").count()) !== 0) fail("el detalle debe empezar cerrado");
if (!(await page.locator("tbody tr", { hasText: "cluster-dev" }).innerText()).includes("1 de 2 sin cumplir")) fail("falta el resumen de requisitos sin cumplir");
await gke.click();
const det = page.locator(".reference-detail");
const texto = (await det.innerText().catch(() => "")) || "";
if (!texto.includes("Qué cumple y qué no")) fail("el detalle no muestra qué cumple y qué no");
if ((await det.locator(".check-ok").count()) !== 1 || (await det.locator(".check-fail").count()) !== 1) fail("el detalle no marca un requisito cumplido y uno sin cumplir");
if (!texto.includes("qa va en 1.28")) fail("el detalle no explica el requisito sin cumplir");
if (!texto.includes("Política de versiones en develop")) fail("el detalle no conserva contra qué se mide");
if ((await gke.getAttribute("aria-expanded")) !== "true") fail("aria-expanded no refleja que está abierto");
await gke.click();
if ((await page.locator(".reference-detail").count()) !== 0) fail("el detalle no se cerró");

// Componentes: sin comprobaciones (backend antiguo) el detalle usa el motivo y la referencia, sin romper.
await page.locator(".homologation-tabs button", { hasText: "Componentes" }).click();
await page.locator(".reference-toggle", { hasText: "svc · Node.js" }).click();
const tdet = await page.locator(".reference-detail").innerText().catch(() => "");
if (!tdet.includes("22: el soporte termina") || !tdet.includes("22 (soporte hasta 2027-04-30)")) fail("el detalle de la tecnología no muestra el motivo y las versiones aprobadas");
const noRef = await page.locator("tbody tr", { hasText: "Despliegue de svc en qa" }).locator("td").nth(4).innerText();
if (noRef.trim() !== "—") fail(`sin referencia debe verse un guion y se ve «${noRef}»`);

// Requisitos: una pestaña más con las reglas de infraestructura y de componentes.
await page.locator(".homologation-tabs button", { hasText: "Requisitos" }).click();
await page.waitForSelector(".requirements-view", { timeout: 5000 }).catch(() => {});
const req = await page.locator(".requirements-view").innerText().catch(() => "");
for (const t of ["Infraestructura", "Componentes", "Versión aprobada: 1.29, 1.30.", "Misma versión en todos los ambientes.", "Node/Express", "Línea base", "Entre ambientes"]) if (!req.includes(t)) fail(`Requisitos: falta «${t}»`);
// Mismo diseño que las otras pestañas: tabla con buscador, filtro de ámbito y filas desplegables.
if ((await page.locator(".requirements-table tbody tr").count()) !== 4) fail("Requisitos: debía haber 4 grupos (política, entre ambientes, despliegue y línea base)");
if (!(await page.locator(".homologation-stat", { hasText: "Requisitos" }).count())) fail("Requisitos: los contadores deben ser de requisitos");
await page.locator(".requirements-view .reference-toggle", { hasText: "Node/Express" }).click();
const chips = await page.locator(".requirement-detail .version-ok").allInnerTexts();
if (!chips.includes("24") || !chips.includes("22")) fail(`Requisitos: la línea base debía mostrar las versiones aprobadas (${chips.join(", ")})`);
await page.locator(".requirements-view select").selectOption("Infraestructura");
if ((await page.locator(".requirements-table tbody tr:not(.reference-row)").count()) !== 2) fail("Requisitos: el filtro de ámbito no filtra");
await page.locator(".requirements-view select").selectOption("Todos los ámbitos");
await page.locator(".requirements-view input").fill("1.30");
if ((await page.locator(".requirements-table tbody tr:not(.reference-row)").count()) !== 1) fail("Requisitos: el buscador no encuentra por versión");
await page.locator(".requirements-view input").fill("");

// Exportar: Excel con tres hojas y CSV con BOM y cabecera.
const bajar = async (texto) => {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.locator("button", { hasText: texto }).click()]);
  return { name: d.suggestedFilename(), data: fs.readFileSync(await d.path()) };
};
const x = await bajar("Exportar Excel");
const raw = x.data.toString("latin1");
if (!x.name.endsWith(".xlsx") || x.data.readUInt32LE(0) !== 0x04034b50) fail("el Excel no es un archivo .xlsx (ZIP)");
for (const t of ["Homologaci", "Comprobaciones", "Requisitos", "cluster-dev", "qa va en 1.28"]) if (!raw.includes(t)) fail(`Excel: falta «${t}»`);
const c = await bajar("Exportar CSV");
const csv = c.data.toString("utf8");
if (!c.name.endsWith(".csv") || !csv.startsWith("\ufeffCategoría,Elemento,Tipo")) fail("el CSV no trae BOM y cabecera");
if (csv.split("\r\n").length !== items.length + 1) fail(`el CSV debía tener ${items.length} registros`);

await browser.close();
server.close();
if (errors.length > 0) {
  console.error(`FALLO: ${errors.length} problema(s):\n` + errors.slice(0, 10).join("\n"));
  process.exit(1);
}
console.log("OK: detalle de qué cumple y qué no, pestaña Requisitos y exportación a Excel y CSV");
