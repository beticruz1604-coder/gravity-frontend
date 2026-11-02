// Inicio de sesión del laboratorio: usuario y contraseña → token de la persona → menú según su rol.
// Requiere un build con VITE_IDENTITY_PROVIDER=lab en dist-lab/ (npm run build -- --outDir dist-lab).
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve("dist-lab");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" };
const server = http
  .createServer((req, res) => {
    let file = path.join(root, req.url.split("?")[0]);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(5199);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (exp) => `${b64({ alg: "none" })}.${b64({ exp })}.x`;
const VALID = Buffer.from("ana:clave-correcta").toString("base64");

const fallos = [];
const espera = (cond, msg) => cond || fallos.push(msg);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errores = [];
page.on("pageerror", (e) => errores.push(e.message));
let intentos = 0;
let sesionRevocada = false;

await page.route("**/backstage/**", (route) => {
  const url = route.request().url();
  const headers = route.request().headers();
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (sesionRevocada) return json(401, { error: { name: "AuthenticationError", message: "Illegal token" } });
  if (url.includes("/api/auth/lab/refresh")) {
    intentos += 1;
    if (headers["x-lab-login"] !== VALID) return json(401, { error: { message: "Usuario o contraseña incorrectos." } });
    return json(200, {
      profile: { displayName: "ana" },
      backstageIdentity: { token: jwt(Math.floor(Date.now() / 1000) + 3600), identity: { userEntityRef: "user:default/ana", ownershipEntityRefs: ["user:default/ana", "group:default/scm"] } }
    });
  }
  if (url.includes("/api/access/me")) {
    return headers.authorization?.startsWith("Bearer ")
      ? json(200, { authenticated: true, roles: [{ id: "scm", name: "Ingeniero SCM" }], sections: ["Resumen", "Repositories"], admin: false })
      : json(401, { error: { name: "AuthenticationError", message: "Missing credentials" } });
  }
  const lista = /entities|tasks|pipelines|agent-pools|branches|policies|repositories|items|components|baseline|clusters/.test(url);
  return json(200, lista ? [] : {});
});

await page.goto("http://localhost:5199/");
// Sin sesión lo primero que se ve es el formulario: ni menú ni secciones, aunque el backend deje leer sin sesión.
await page.waitForSelector("form.login-form", { timeout: 15000 });
espera((await page.locator(".sidebar nav button").count()) === 0, "Sin sesión no debe verse el menú");
espera((await page.locator(".dashboard-content .metric-card").count()) === 0, "Sin sesión no debe verse el tablero");

// 1. Contraseña incorrecta: avisa y no entra.
await page.fill('input[autocomplete="username"]', "ana");
await page.fill('input[type="password"]', "mala");
await page.click('button[type="submit"]');
await page.waitForSelector('[role="alert"]');
espera((await page.locator('[role="alert"]').innerText()).includes("incorrectos"), "Contraseña incorrecta: falta el aviso");
espera((await page.locator("form.login-form").count()) === 1, "Contraseña incorrecta: no debe entrar");

// 2. Contraseña correcta: entra con las secciones de su rol y se ve su rol.
await page.fill('input[type="password"]', "clave-correcta");
await page.click('button[type="submit"]');
await page.waitForSelector("form.login-form", { state: "detached" });
const menu = (await page.locator(".sidebar nav button").allInnerTexts()).map((t) => t.trim()).filter((t) => t !== "Cerrar sesión");
espera(JSON.stringify(menu) === JSON.stringify(["Resumen", "Repositories"]), `Menú del SCM incorrecto: ${JSON.stringify(menu)}`);
espera((await page.locator(".sidebar").innerText()).includes("Ingeniero SCM"), "No se muestra el rol");

// 3. Recargar la página conserva la sesión sin pedir la contraseña (el token vive en la pestaña).
await page.reload();
await page.waitForSelector(".sidebar button:has-text('Cerrar sesión')", { timeout: 15000 });
espera((await page.locator("form.login-form").count()) === 0, "Tras recargar volvió a pedir la contraseña");

// 4. Cerrar sesión vuelve al formulario de inicio de sesión.
await page.locator(".sidebar button", { hasText: "Cerrar sesión" }).click();
await page.waitForSelector("form.login-form");
espera((await page.locator(".sidebar nav button").count()) === 0, "Tras cerrar sesión no debe verse el menú");
espera((await page.locator(".login-error").count()) === 0, "Sin sesión (401) no debe mostrarse como un error");

// 5. Si Backstage deja de reconocer la sesión a media navegación, vuelve al formulario.
await page.fill('input[autocomplete="username"]', "ana");
await page.fill('input[type="password"]', "clave-correcta");
await page.click('button[type="submit"]');
await page.waitForSelector("form.login-form", { state: "detached" });
sesionRevocada = true;
// La app puede volver al formulario antes del clic (una llamada en curso también recibe el 401): el clic es opcional.
await page.locator(".sidebar nav button", { hasText: "Repositories" }).click({ timeout: 3000 }).catch(() => {});
await page.waitForSelector("form.login-form", { timeout: 15000 }).catch(() => espera(false, "Sesión perdida: no volvió al formulario"));

espera(errores.length === 0, `Errores no controlados: ${errores.join("; ")}`);

await browser.close();
server.close();
if (fallos.length > 0) {
  console.error(`FALLO: ${fallos.length}\n` + fallos.join("\n"));
  process.exit(1);
}
console.log("inicio de sesión: 5 escenarios correctos");
