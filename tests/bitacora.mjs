// Prueba de la sección Bitácora: une operaciones y eventos, calcula conteos y tiempos, filtra en la API y avisa qué sección
// se abre. Sirve dist/ y simula la API.
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
  .listen(5195);

const hoy = new Date();
const at = (minutes) => new Date(hoy.getTime() - minutes * 60000).toISOString();
const ana = { ref: "user:default/ana", name: "Ana López" };
const leo = { ref: "user:default/leo", name: "Leo Ruiz" };
const events = [
  { id: "e1", at: at(5), user: ana, roles: ["Ingeniero SCM"], kind: "consulta", action: "Simulación de integración", section: "Compliance IQ" },
  { id: "e2", at: at(10), user: leo, roles: ["Líder Técnico"], kind: "negado", action: "Inicio de operación" },
  { id: "e3", at: at(15), user: ana, roles: ["Ingeniero SCM"], kind: "vista", action: "Abrió Pipeline Engine (IDP)", section: "Pipeline Engine (IDP)" }
];
const operations = [
  { id: "t1", template: "crear-rama", title: "Crear una rama", user: ana, status: "completed", createdAt: at(20), finishedAt: at(19), durationMs: 40000, component: "svc" },
  { id: "t2", template: "crear-rama", title: "Crear una rama", user: ana, status: "failed", createdAt: at(30), finishedAt: at(29), durationMs: 20000, component: "web" },
  { id: "t3", template: "integrar-cambios", title: "Integrar cambios", user: leo, status: "completed", createdAt: at(40), finishedAt: at(37), durationMs: 180000, component: "svc" }
];
const queries = [];
const activity = [];
const fallos = [];
const espera = (cond, msg) => cond || fallos.push(msg);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
const errores = [];
page.on("pageerror", (e) => errores.push(e.message));
await page.route("**/backstage/**", async (route) => {
  const url = new URL(route.request().url());
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname.endsWith("/api/access/me")) return json({ authenticated: true, roles: [], sections: ["Resumen", "Bitácora"], admin: false });
  if (url.pathname.includes("/api/auth/")) return json({}, 403);
  if (url.pathname.endsWith("/api/access/activity")) {
    activity.push(JSON.parse(route.request().postData() ?? "{}").section);
    return route.fulfill({ status: 204, body: "" });
  }
  if (url.pathname.endsWith("/api/access/audit/events")) {
    queries.push(Object.fromEntries(url.searchParams));
    const kind = url.searchParams.get("kind");
    const items = kind ? events.filter((e) => e.kind === kind) : events;
    return json({ total: items.length, items, stats: {} });
  }
  if (url.pathname.endsWith("/api/access/audit/operations")) return json({ total: operations.length, items: operations });
  return json(/entities|tasks|pipelines/.test(url.pathname) ? [] : {});
});

await page.goto("http://localhost:5195/");
await page.locator(".sidebar nav button", { hasText: "Bitácora" }).click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="audit-table"] tbody tr').length >= 6, null, { timeout: 15000 }).catch(() => fallos.push("no aparecen las interacciones"));

const stats = await page.locator(".homologation-stats").innerText();
for (const t of ["6", "3", "2", "1 min 20 s", "67%"]) espera(stats.includes(t), `indicadores sin «${t}»: ${stats.replace(/\n/g, " | ")}`);
const ops = await page.locator('[data-testid="audit-operations"] tbody').innerText();
espera(/Crear una rama\s+2\s+1\s+1\s+30 s\s+40 s/.test(ops), `operaciones por tipo: ${ops}`);
espera(/Integrar cambios\s+1\s+1\s+0\s+3 min 0 s/.test(ops), `integrar cambios: ${ops}`);
const people = await page.locator('[data-testid="audit-people"] tbody tr').first().innerText();
espera(people.includes("Ana López") && people.includes("Ingeniero SCM") && /\b4\b/.test(people), `actividad por persona: ${people}`);
const first = await page.locator('[data-testid="audit-table"] tbody tr').first().innerText();
espera(first.includes("Consulta") && first.includes("Simulación de integración") && first.includes("Compliance IQ"), `primera fila: ${first}`);
const tabla = await page.locator('[data-testid="audit-table"]').innerText();
espera(tabla.includes("Autoservicio"), "la sección se muestra con su nombre visible");
espera(tabla.includes("Intento negado") && tabla.includes("Falló"), "faltan el intento negado o la operación fallida");
espera(activity.includes("Resumen") && activity.includes("Bitácora"), `no avisó las secciones abiertas: ${activity}`);
espera(queries[0]?.from?.length === 10, `el periodo por defecto no llegó a la API: ${JSON.stringify(queries[0])}`);

// Filtro por tipo: llega a la API y oculta las operaciones.
await page.locator('select[aria-label="Tipo de interacción"]').selectOption("negado");
await page.waitForFunction(() => document.querySelectorAll('[data-testid="audit-table"] tbody tr').length === 1, null, { timeout: 10000 }).catch(() => fallos.push("el filtro por tipo no se aplicó"));
espera(queries.at(-1)?.kind === "negado", `el tipo no llegó a la API: ${JSON.stringify(queries.at(-1))}`);

// Exportación a Excel.
const [descarga] = await Promise.all([page.waitForEvent("download"), page.locator("button", { hasText: "Exportar Excel" }).click()]);
espera(/^bitacora-\d{4}-\d{2}-\d{2}\.xlsx$/.test(descarga.suggestedFilename()), `nombre del archivo: ${descarga.suggestedFilename()}`);
if (process.env.SHOT) {
  await page.locator('select[aria-label="Tipo de interacción"]').selectOption("");
  await page.waitForTimeout(800);
  await page.screenshot({ path: process.env.SHOT, fullPage: true });
}
espera(errores.length === 0, `errores no controlados: ${errores.join("; ")}`);

await browser.close();
server.close();
if (fallos.length) {
  console.error(fallos.join("\n"));
  process.exit(1);
}
console.log("OK: bitácora con operaciones, eventos, conteos, tiempos, filtros, avisos de sección y exportación");
