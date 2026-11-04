// Prueba de la sección Release Management: historial de informes (filtros que llegan a la API, resultado y envío a Google Chat),
// detalle de una Pre-Validación y de una Pre-Liberación con sus criterios, y enlace directo #informe=<id> desde el mensaje de Chat.
// Sirve dist/ y simula la API.
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
  .listen(5196);

const metrics = { qualityRating: "E", coverage: 92.9, tests: 53, qualityGate: "ERROR", securityRating: "E", critical: 7, high: 23, medium: 18, low: 13, lastScan: "2026-11-03" };
const criteria = [
  { id: "C1", label: "Calificación de calidad ≥ A", passed: false, value: "E" },
  { id: "C2", label: "Cobertura de pruebas unitarias ≥ 85%", passed: true, value: "92.9%" },
  { id: "C3", label: "Pruebas automatizadas exitosas", passed: true, value: "53" },
  { id: "C4", label: "0 vulnerabilidades HIGH, 0 CRÍTICO", passed: false, value: "Críticas 7, altas 23" },
  { id: "C5", label: "Quality y Security Gates aprobados", passed: false, value: "Quality Gate ERROR, Security E" }
];
const base = { project: "demos", repository: "svc", component: "svc", author: { name: "Ana López" }, ticket: "INC-1", metrics, metricsSource: "simulado", criteria, passed: false };
const reports = [
  { ...base, id: "65a1b2c3d4e5f6a7b8c9d0e2", kind: "preliberacion", sourceBranch: "release/1.4.0", targetBranch: "master", sourceRole: "release", targetRole: "master", version: "1.4.0", pullRequestId: 31, pullRequestUrl: "https://dev.azure.com/o/demos/_git/svc/pullrequest/31", createdAt: "2026-11-03T12:00:00Z", result: "No cumple con requisitos para liberación directa: requiere revisión del CAB", notification: { sent: false, error: "Sin webhook de Google Chat" } },
  { ...base, id: "65a1b2c3d4e5f6a7b8c9d0e1", kind: "prevalidacion", component: "web", sourceBranch: "team/team-001", targetBranch: "develop", sourceRole: "team", targetRole: "develop", pullRequestId: 30, createdAt: "2026-11-02T12:00:00Z", result: "No es candidato para liberación directa", notification: { sent: true, at: "2026-11-02T12:00:01Z" } }
];
const queries = [];

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|status of 4|status of 5/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 160)}`));

await page.route("**/backstage/**", (route) => {
  const url = new URL(route.request().url());
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname.endsWith("/api/access/me")) return json({ authenticated: true, roles: [], sections: ["Resumen", "Release Management"], admin: false });
  if (url.pathname.includes("/api/auth/")) return json({}, 403);
  if (url.pathname.endsWith("/api/rm/components")) return json({ components: ["svc", "web"] });
  const one = url.pathname.match(/\/api\/rm\/reports\/([0-9a-f]{24})$/);
  if (one) {
    const r = reports.find((x) => x.id === one[1]);
    return r ? json(r) : json({ error: { message: "no existe" } }, 404);
  }
  if (url.pathname.endsWith("/api/rm/reports")) {
    queries.push(Object.fromEntries(url.searchParams));
    let items = reports;
    const p = url.searchParams;
    if (p.get("kind")) items = items.filter((r) => r.kind === p.get("kind"));
    if (p.get("component")) items = items.filter((r) => r.component === p.get("component"));
    if (p.get("q")) items = items.filter((r) => JSON.stringify(r).includes(p.get("q")));
    return json({ total: items.length, items });
  }
  return json(/entities|tasks|pipelines|branches|policies|repositories|items|components|baseline|clusters/.test(url.pathname) ? [] : {});
});

const fail = (m) => errors.push(`FALLO: ${m}`);
const rows = () => page.locator('[data-testid="rm-table"] tbody tr');

// 1) Historial.
await page.goto("http://localhost:5196/");
await page.locator(".sidebar nav button", { hasText: "Releases" }).first().click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="rm-table"] tbody tr').length >= 2, null, { timeout: 15000 }).catch(() => fail("no aparece el historial"));
const first = await rows().first().innerText();
for (const t of ["Pre-Liberación", "svc", "release/1.4.0 → master", "Ana López", "Requiere CAB", "92.9%", "No enviado"]) if (!first.includes(t)) fail(`fila de Pre-Liberación sin «${t}»: ${first}`);
const second = await rows().nth(1).innerText();
for (const t of ["Pre-Validación", "team/team-001 → develop", "No candidato", "Enviado"]) if (!second.includes(t)) fail(`fila de Pre-Validación sin «${t}»: ${second}`);

// 2) Los filtros llegan a la API.
await page.locator('select[aria-label="Tipo de informe"]').selectOption("prevalidacion");
await page.waitForTimeout(400);
if (queries.at(-1)?.kind !== "prevalidacion") fail(`el filtro de tipo no llegó a la API: ${JSON.stringify(queries.at(-1))}`);
if ((await rows().count()) !== 1) fail("con el filtro de Pre-Validación debía quedar un informe");
await page.locator(".rm-filters .link-button", { hasText: "Limpiar filtros" }).click();
await page.locator(".rm-filters input").first().fill("release/1.4");
await page.waitForTimeout(900);
if (queries.at(-1)?.q !== "release/1.4") fail(`la búsqueda no llegó a la API: ${JSON.stringify(queries.at(-1))}`);
await page.locator(".rm-filters .link-button", { hasText: "Limpiar filtros" }).click();
await page.waitForTimeout(500);

if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/rm-historial.png` });

// 3) Detalle de una Pre-Liberación.
await rows().first().locator("button").first().click();
await page.waitForSelector('[data-testid="rm-report"]', { timeout: 10000 }).catch(() => fail("no se abre el informe"));
const lib = await page.locator('[data-testid="rm-report"]').innerText();
for (const t of ["Informe de Pre-Liberación de CI de Release", "Resumen ejecutivo", "1.4.0", "requiere revisión del CAB", "Criterios para Cumplimiento para Pasaporte en CI", "Altas: 23", "Quality Gate", "Flujo de cambio", "Métricas de ejemplo", "Sin webhook de Google Chat"]) {
  if (!lib.includes(t)) fail(`al informe de Pre-Liberación le falta «${t}»`);
}
if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/rm-preliberacion.png`, fullPage: true });
const crit = await page.locator('[data-testid="rm-criteria"] tbody tr').allInnerTexts();
if (crit.length !== 5 || !crit[1].includes("Cumple") || !crit[0].includes("No cumple")) fail(`criterios inesperados: ${crit.join(" | ")}`);
await page.locator(".back-button").click();
await rows().first().waitFor({ timeout: 10000 });

// 4) Detalle de una Pre-Validación.
await rows().nth(1).locator("button").first().click();
await page.waitForSelector('[data-testid="rm-report"]', { timeout: 10000 });
const pre = await page.locator('[data-testid="rm-report"]').innerText();
if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/rm-prevalidacion.png`, fullPage: true });
for (const t of ["Informe de Pre-Validación de Pull Request", "Resultado estimado de liberación", "Indicadores en este punto del flujo", "Aclaraciones importantes", "No es candidato para liberación directa"]) {
  if (!pre.includes(t)) fail(`al informe de Pre-Validación le falta «${t}»`);
}

// 5) Enlace directo desde el mensaje de Google Chat.
await page.goto("about:blank");
await page.goto("http://localhost:5196/#informe=65a1b2c3d4e5f6a7b8c9d0e2");
await page.waitForSelector('[data-testid="rm-report"]', { timeout: 15000 }).catch(() => fail("el enlace #informe= no abre el informe"));
if (!(await page.locator('[data-testid="rm-report"]').innerText()).includes("Pre-Liberación")) fail("el enlace abrió otro informe");
if (page.url().includes("#informe=")) fail("el hash debía limpiarse");

await browser.close();
server.close();
if (errors.length > 0) {
  console.error(`FALLO: ${errors.length} problema(s):\n` + errors.slice(0, 10).join("\n"));
  process.exit(1);
}
console.log("OK: historial de Release Management, filtros, detalle de Pre-Validación y Pre-Liberación, y enlace directo");
