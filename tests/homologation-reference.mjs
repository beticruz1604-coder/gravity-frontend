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
  if (url.includes("/api/auth/")) return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  if (url.includes("/api/homologation/items")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, warnings: [] }) });
  const lista = /entities|tasks|pipelines|agent-pools|branches|policies|repositories|items|components|baseline|clusters/.test(url);
  return route.fulfill({ status: 200, contentType: "application/json", body: lista ? "[]" : "{}" });
});

const fail = (m) => errors.push(`FALLO: ${m}`);
await page.goto("http://localhost:5198/");
await page.waitForSelector(".sidebar nav button", { timeout: 15000 });
await page.locator(".sidebar nav button", { hasText: "Homologation Status" }).first().click();

// Infraestructura: la fila de GKE tiene su referencia.
await page.waitForSelector(".pool-table tbody tr", { timeout: 10000 });
if (!(await page.locator(".pool-table th", { hasText: "Homologado con" }).count())) fail("falta la columna «Homologado con»");
const gke = page.locator(".reference-toggle", { hasText: "Versión aprobada: 1.29, 1.30." });
if ((await gke.count()) !== 1) fail("la fila de infraestructura no muestra su referencia");
else {
  if ((await page.locator(".reference-detail").count()) !== 0) fail("el detalle debe empezar cerrado");
  await gke.click();
  if (!(await page.locator(".reference-detail", { hasText: "Política de versiones en develop" }).count())) fail("no se desplegó el detalle de la política");
  if ((await gke.getAttribute("aria-expanded")) !== "true") fail("aria-expanded no refleja que está abierto");
  await gke.click();
  if ((await page.locator(".reference-detail").count()) !== 0) fail("el detalle no se cerró");
}

// Componentes: la tecnología se despliega y se ven las versiones aprobadas.
await page.locator(".homologation-tabs button", { hasText: "Componentes" }).click();
const tech = page.locator(".reference-toggle", { hasText: "Línea base de Node/Express" });
if ((await tech.count()) !== 1) fail("la fila de tecnología no muestra su referencia");
else {
  await tech.click();
  const detail = page.locator(".reference-detail", { hasText: "Versiones aprobadas" });
  if (!(await detail.count())) fail("no se desplegó la línea base");
  else if (!(await detail.innerText()).includes("22 (soporte hasta 2027-04-30)")) fail("el detalle no lista las versiones aprobadas");
}

// Sin referencia o con una incompleta no se rompe nada.
const noRef = await page.locator("tbody tr", { hasText: "Despliegue de svc en qa" }).locator("td").nth(4).innerText();
if (noRef.trim() !== "—") fail(`sin referencia debe verse un guion y se ve «${noRef}»`);
const partial = page.locator(".reference-toggle", { hasText: "Misma versión y mismo código" });
await partial.click();
if ((await page.locator(".reference-detail").count()) < 2) fail("una referencia sin secciones debe poder desplegarse sin romper");

await browser.close();
server.close();
if (errors.length > 0) {
  console.error(`FALLO: ${errors.length} problema(s):\n` + errors.slice(0, 10).join("\n"));
  process.exit(1);
}
console.log("OK: columna «Homologado con» y detalle desplegable");
