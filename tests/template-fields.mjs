// Prueba de los campos de las plantillas en GRAVITY: enlace del componente al catálogo, rama de origen calculada (solo se
// elige cuando hay varias) y producto de la organización con alta desde el formulario. Sirve dist/ y simula la API.
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
  .listen(5199);

const svc = {
  apiVersion: "backstage.io/v1alpha1", kind: "Component",
  metadata: { name: "svc", namespace: "default", title: "Servicio de prueba", description: "Servicio de prueba", annotations: { "dev.azure.com/project-repo": "demos/svc", "dev.azure.com/build-definition": "svc-ci" } },
  spec: { type: "service", lifecycle: "production", owner: "group:default/digital" }, relations: []
};
const template = (name, title, tags = []) => ({ kind: "Template", metadata: { name, title, description: title, tags }, spec: { type: "service" } });
const preview = { title: "Rama que se creará", type: "string", "ui:field": "BranchNamePreview", "ui:options": { project: "demos", repoField: "component", roleField: "role", fromField: "from" } };
const schemas = {
  "crear-rama": {
    title: "Crear una rama",
    steps: [{
      title: "Qué rama crear",
      schema: {
        required: ["component", "role", "from"],
        properties: {
          component: { title: "Componente", type: "string", "ui:field": "ComponentPicker", "ui:options": { catalogLink: true } },
          role: { title: "Tipo de rama", type: "string", enum: ["team", "task-resolution"] },
          from: { title: "Crear a partir de", type: "string", "ui:field": "BranchPicker", "ui:options": { project: "demos", repoField: "component", kind: "base", roleField: "role" } }
        },
        dependencies: {
          role: { oneOf: [
            { properties: { role: { enum: ["team"] }, number: { title: "Consecutivo", type: "string" }, preview }, required: ["number", "preview"] },
            { properties: { role: { enum: ["task-resolution"] }, description: { title: "Descripción breve", type: "string" }, preview }, required: ["description", "preview"] }
          ] }
        }
      }
    }]
  },
  "golden-java": {
    title: "Golden Path: Java",
    steps: [{
      title: "Clasificación de negocio",
      schema: { properties: { initiative: { title: "Producto", type: "string", description: "Producto de la organización.", "ui:field": "ProductPicker" } } }
    }]
  }
};
const products = [{ name: "CEDIS WEB", fixed: true }];
const added = [];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await context.newPage();
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource|status of 4|status of 5/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 160)}`));
};
watch(page);

await context.route("**/backstage/**", (route) => {
  const req = route.request();
  const url = req.url();
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.includes("/api/access/products")) {
    if (req.method() === "POST") {
      const { name } = JSON.parse(req.postData());
      added.push(name);
      return json({ product: { name, fixed: false }, created: true }, 201);
    }
    return json({ products });
  }
  if (url.includes("/api/access/me")) {
    return json({ authenticated: true, roles: [], sections: ["Resumen", "Catálogo", "Pipeline Engine (IDP)"], admin: false });
  }
  if (url.includes("/api/auth/")) return json({}, 403);
  if (url.includes("filter=kind=template")) return json([template("crear-rama", "Crear una rama", ["branching"]), template("golden-java", "Golden Path: Java", ["golden-path"])]);
  if (url.includes("filter=kind=component")) return json([svc]);
  if (/\/api\/catalog\/entities(\?|$)/.test(url) && !url.includes("filter=")) return json([svc]);
  const m = url.match(/template\/([^/]+)\/parameter-schema/);
  if (m) return json(schemas[m[1]]);
  if (url.includes("/api/branching/branches/demos/svc")) {
    return json({ branches: [
      { name: "master", role: "master", deployTo: [], mergeInto: [] },
      { name: "develop", role: "develop", deployTo: [], mergeInto: [] },
      { name: "team/team-001", role: "team", deployTo: [], mergeInto: [] }
    ] });
  }
  if (url.includes("/api/branching/rules")) {
    return json({ branches: [{ id: "team", createdFrom: ["develop"] }, { id: "task-resolution", createdFrom: ["team", "sprint", "develop"] }], deployments: {} });
  }
  if (url.includes("/api/branching/branch-name")) return json({ name: "team/team-001", complete: false, valid: false, exists: false, errors: [] });
  const lista = /entities|tasks|pipelines|agent-pools|branches|policies|repositories|items|components|baseline|clusters/.test(url);
  return json(lista ? [] : {});
});

const fail = (m) => errors.push(`FALLO: ${m}`);
const openTemplate = async (title) => {
  await page.goto("http://localhost:5199/");
  await page.waitForSelector(".sidebar nav button", { timeout: 15000 });
  await page.locator(".sidebar nav button", { hasText: "Pipeline Engine" }).first().click();
  await page.locator("button.create-button", { hasText: "Create" }).click();
  await page.locator(".gallery-card", { hasText: title }).click();
  await page.waitForSelector(".create-step-content select, .create-modal-body select", { timeout: 10000 });
};
const fieldOf = (label) => page.locator(".create-modal-body label", { hasText: label }).first();

// 1) Crear rama: enlace al catálogo y origen calculado.
await openTemplate("Crear una rama");
if (await page.locator('[data-testid="computed-origin"]').count()) fail("sin componente ni tipo no debe mostrarse el origen");
if (await fieldOf("Crear a partir de").count()) fail("sin componente ni tipo no debe mostrarse el selector de origen");
await fieldOf("Componente").locator("select").selectOption("svc");
const link = page.locator('[data-testid="catalog-link"]');
await link.waitFor({ timeout: 5000 }).catch(() => fail("falta el enlace «Ver en el catálogo»"));
if ((await link.getAttribute("href")) !== "#entidad=component%3Adefault%2Fsvc") fail(`enlace al catálogo inesperado: ${await link.getAttribute("href")}`);
if ((await link.getAttribute("target")) !== "_blank") fail("el enlace al catálogo debe abrir otra pestaña");

await fieldOf("Tipo de rama").locator("select").selectOption("team");
const computed = page.locator('[data-testid="computed-origin"]');
await computed.waitFor({ timeout: 5000 }).catch(() => fail("team: el origen debía calcularse solo"));
if (!(await computed.innerText()).includes("develop")) fail("team: el origen calculado debía ser develop");
if (await page.locator(".create-modal-body label", { hasText: "Crear a partir de" }).locator("select").count()) fail("team: no debe mostrarse el selector de origen");

await fieldOf("Tipo de rama").locator("select").selectOption("task-resolution");
await page.waitForTimeout(300);
if (await computed.count()) fail("task-resolution: el origen no se calcula (hay varias ramas posibles)");
const fromSelect = fieldOf("Crear a partir de").locator("select");
if (!(await fromSelect.count())) fail("task-resolution: falta el selector de origen");
else {
  const opts = await fromSelect.locator("option").allInnerTexts();
  if (!opts.some((o) => o.includes("develop")) || !opts.some((o) => o.includes("team/team-001"))) fail(`task-resolution: opciones inesperadas ${opts.join(", ")}`);
}

// 2) El enlace abre la ficha del catálogo en otra pestaña con la sesión copiada.
const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
watch(popup);
await popup.waitForSelector("text=Servicio de prueba", { timeout: 10000 }).catch(async () => fail(`la pestaña nueva no muestra la ficha del componente: ${popup.url()} :: ${(await popup.locator("body").innerText().catch(() => "")).slice(0, 400)}`));
if (popup.url().includes("#entidad=")) fail("el hash debía limpiarse tras abrir la ficha");
await popup.close();

// 3) Producto: lista propia con alta desde el formulario.
await page.locator(".modal-close").click();
await openTemplate("Golden Path: Java");
const product = page.locator('[data-testid="product-select"]');
const options = await product.locator("option").allInnerTexts();
if (!options.includes("CEDIS WEB") || !options.some((o) => o.includes("Agregar producto"))) fail(`producto: opciones inesperadas ${options.join(", ")}`);
await product.selectOption("__agregar__");
await page.locator('[data-testid="product-add"] input').fill("Portal Proveedores");
await page.locator('[data-testid="product-add"] button', { hasText: "Agregar" }).click();
await page.waitForTimeout(300);
if (added[0] !== "Portal Proveedores") fail("producto: no se dio de alta");
if ((await product.inputValue()) !== "Portal Proveedores") fail("producto: el nuevo debía quedar elegido");
if (await page.locator('[data-testid="product-add"]').count()) fail("producto: el cuadro de alta debía cerrarse");

await browser.close();
server.close();
if (errors.length > 0) {
  console.error(`FALLO: ${errors.length} problema(s):\n` + errors.slice(0, 10).join("\n"));
  process.exit(1);
}
console.log("OK: enlace al catálogo, origen de rama calculado y producto con alta desde el formulario");
