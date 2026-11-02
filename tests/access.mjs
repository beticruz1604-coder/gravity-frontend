// Control de acceso: el menú muestra solo las secciones que el backend devuelve para el rol, «Usuarios» es solo de Admin y
// quien no tiene rol (o no hay sesión) ve la pantalla de entrada. Sirve dist/ y simula la API de Backstage.
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
  .listen(5198);

const ALL = ["Resumen", "Catálogo", "Repositories", "Pipelines", "Usuarios"];
const roles = {
  sections: ALL,
  roles: [
    { id: "scm", name: "Ingeniero SCM", description: "Ramas", group: "group:default/scm", admin: false, sections: ["Resumen", "Repositories"] },
    { id: "admin", name: "Admin (Full Access)", group: "group:default/admin", admin: true, sections: ALL }
  ]
};
const users = { users: [
  { entityRef: "user:default/ana", name: "Ana Pérez", email: "ana@x.com", groups: ["group:default/scm"], roles: [{ id: "scm", name: "Ingeniero SCM" }], admin: false },
  { entityRef: "user:default/luis.lopez", username: "luis.lopez", name: "Luis Lopez", email: "luis@x.com", groups: ["group:default/scm"], roles: [{ id: "scm", name: "Ingeniero SCM" }], admin: false, managed: true, active: true }
] };

const fallos = [];
const altas = [];
const bajas = [];
const espera = (cond, msg) => cond || fallos.push(msg);

const browser = await chromium.launch();

async function abrir(me) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.route("**/backstage/**", (route) => {
    const url = route.request().url();
    if (url.includes("/api/access/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) });
    if (url.includes("/api/access/roles")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(roles) });
    if (url.includes("/api/access/users") && route.request().method() === "POST") {
      const alta = route.request().postDataJSON();
      altas.push(alta);
      const respuesta = alta.email
        ? { user: { username: alta.username }, emailSent: true, email: alta.email }
        : { user: { username: alta.username }, emailSent: false, temporaryPassword: "TempoClave23456x" };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(respuesta) });
    }
    if (url.includes("/api/access/users/") && route.request().method() === "DELETE") {
      bajas.push(url.split("/api/access/users/")[1]);
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.includes("/api/access/users")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(users) });
    if (url.includes("/api/auth/")) return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
    const lista = /entities|tasks|pipelines|agent-pools|branches|policies|repositories|items|components|baseline|clusters/.test(url);
    return route.fulfill({ status: 200, contentType: "application/json", body: lista ? "[]" : "{}" });
  });
  await page.goto("http://localhost:5198/");
  await page.waitForTimeout(1500);
  return { page, errores };
}

// 1. Ingeniero SCM: solo dos secciones, sin «Usuarios».
{
  const { page, errores } = await abrir({ authenticated: true, roles: [{ id: "scm", name: "Ingeniero SCM" }], sections: ["Resumen", "Repositories"], admin: false });
  const menu = (await page.locator(".sidebar nav button").allInnerTexts()).map((t) => t.trim());
  espera(JSON.stringify(menu) === JSON.stringify(["Resumen", "Repositories"]), `SCM: el menú debía ser Resumen y Repositories y fue ${JSON.stringify(menu)}`);
  espera((await page.locator(".sidebar").innerText()).includes("Ingeniero SCM"), "SCM: no se muestra el rol en la barra lateral");
  espera(errores.length === 0, `SCM: errores no controlados: ${errores.join("; ")}`);
}

// 2. Admin: ve «Usuarios» y la página lista personas y la matriz de roles.
{
  const { page, errores } = await abrir({ authenticated: true, roles: [{ id: "admin", name: "Admin (Full Access)" }], sections: ALL, admin: true });
  const menu = (await page.locator(".sidebar nav button").allInnerTexts()).map((t) => t.trim());
  espera(menu.includes("Usuarios"), "Admin: falta «Usuarios» en el menú");
  await page.locator(".sidebar nav button", { hasText: "Usuarios" }).click();
  await page.waitForTimeout(1000);
  const texto = await page.locator("main").innerText();
  espera(texto.includes("Ana Pérez") && texto.includes("Ingeniero SCM"), "Admin: la tabla de personas no muestra a Ana con su rol");
  espera(texto.includes("Roles y secciones") && texto.includes("Admin (Full Access)"), "Admin: falta la matriz de roles y secciones");
  // Alta: el usuario debe ser nombre.apellido; con uno inválido el botón queda deshabilitado.
  await page.fill('input[placeholder="nombre.apellido"]', "Fidencio Santander");
  espera(await page.locator("button", { hasText: "Crear usuario" }).isDisabled(), "Alta: con usuario inválido se puede crear");
  espera((await page.locator("main").innerText()).includes("nombre.apellido: minúsculas"), "Alta: falta el aviso de formato");
  await page.fill('input[placeholder="nombre.apellido"]', "fidencio.santander");
  await page.locator(".user-form .role-checks label", { hasText: "Ingeniero SCM" }).click();
  await page.locator("button", { hasText: "Crear usuario" }).click();
  await page.waitForSelector(".temp-password", { timeout: 5000 }).catch(() => {});
  espera((await page.locator(".temp-password").innerText().catch(() => "")).includes("TempoClave23456x"), "Alta: no se muestra la contraseña temporal");
  espera(JSON.stringify(altas[0]) === JSON.stringify({ username: "fidencio.santander", displayName: "", email: "", roles: ["scm"] }), `Alta: se envió ${JSON.stringify(altas[0])}`);
  // Alta con correo: se avisa del envío y no se muestra contraseña.
  await page.locator(".temp-password button", { hasText: "Cerrar" }).click();
  await page.fill('input[placeholder="nombre.apellido"]', "maria.lopez");
  await page.fill('input[placeholder="nombre.apellido@empresa.com"]', "maria@x.com");
  await page.locator(".user-form .role-checks label", { hasText: "Ingeniero SCM" }).click();
  await page.locator("button", { hasText: "Crear usuario" }).click();
  await page.waitForSelector(".temp-password", { timeout: 5000 }).catch(() => {});
  const aviso = await page.locator(".temp-password").innerText().catch(() => "");
  espera(aviso.includes("Se envió") && aviso.includes("maria@x.com") && !aviso.includes("TempoClave"), `Alta con correo: aviso incorrecto: ${aviso}`);
  // Borrar: pide confirmación y llama a DELETE; las cuentas fijas no tienen el botón.
  page.once("dialog", (d) => d.accept());
  await page.locator("tr", { hasText: "luis.lopez" }).locator("button", { hasText: "Borrar" }).click();
  await page.waitForTimeout(800);
  espera(JSON.stringify(bajas) === JSON.stringify(["luis.lopez"]), `Borrar: se pidió ${JSON.stringify(bajas)}`);
  espera((await page.locator("tr", { hasText: "Ana Pérez" }).locator("button", { hasText: "Borrar" }).count()) === 0, "Borrar: una cuenta fija no debe tener el botón");
  espera(errores.length === 0, `Admin: errores no controlados: ${errores.join("; ")}`);
}

// 3. Con sesión pero sin rol: pantalla de entrada, sin menú ni páginas.
{
  const { page } = await abrir({ authenticated: true, roles: [], sections: [], admin: false });
  espera((await page.locator(".sidebar nav button").count()) === 0, "Sin rol: no debe haber secciones en el menú");
  espera((await page.locator("main").innerText()).includes("no tiene un rol asignado"), "Sin rol: falta el aviso de que no tiene rol");
}

// 4. Sin sesión: pide iniciar sesión (con IAP como proveedor no hay botón; el aviso sí).
{
  const { page } = await abrir({ authenticated: false, roles: [], sections: [], admin: false });
  espera((await page.locator("main").innerText()).includes("Inicia sesión"), "Sin sesión: falta la pantalla de entrada");
}

await browser.close();
server.close();
if (fallos.length > 0) {
  console.error(`FALLO: ${fallos.length}\n` + fallos.join("\n"));
  process.exit(1);
}
console.log("control de acceso: 4 escenarios correctos");
