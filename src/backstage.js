/*
 * Cliente de Backstage (IDP). Todo lo que muestra o hace GRAVITY pasa por aquí:
 *   /api/catalog       componentes, plantillas y recursos registrados
 *   /api/scaffolder    ejecución de plantillas (Golden Paths y operaciones) y sus tareas
 *   /api/branching     reglas, ramas, políticas, pipelines y pools de Azure DevOps
 *   /api/homologation  homologación de infraestructura y componentes
 * En desarrollo y en `vite preview` el prefijo /backstage lo reenvía el proxy de vite.config.js.
 */

export const BACKSTAGE_URL = import.meta.env.VITE_BACKSTAGE_URL ?? "/backstage";
export const PROJECT = import.meta.env.VITE_AZDO_PROJECT ?? "demos";

/*
 * Identidad del usuario. Con el front detrás de Identity-Aware Proxy (IAP), el proxy de nginx reenvía a Backstage la cabecera
 * firmada de IAP y Backstage la valida (proveedor gcpIap) y devuelve un token de ESE usuario; todas las llamadas lo llevan.
 * Si no hay IAP (desarrollo, o antes de activarlo) esa ruta no responde y se trabaja de forma anónima, como hasta ahora.
 */
const IDENTITY_PROVIDER = "gcpIap";
const TOKEN_MARGIN_MS = 2 * 60 * 1000;
const ANONYMOUS_RETRY_MS = 5 * 60 * 1000;

let session = null; // { token, expiresAt, profile, identity }
let anonymousUntil = 0;
let pendingSession = null;

function tokenExpiry(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).exp * 1000;
  } catch {
    return Date.now() + 10 * 60 * 1000;
  }
}

async function loadSession() {
  try {
    const response = await fetch(`${BACKSTAGE_URL}/api/auth/${IDENTITY_PROVIDER}/refresh`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const token = data?.backstageIdentity?.token;
    if (!token) {
      return null;
    }
    return {
      token,
      expiresAt: tokenExpiry(token),
      profile: data.profile ?? {},
      identity: data.backstageIdentity.identity ?? {}
    };
  } catch {
    return null;
  }
}

/** Token vigente del usuario (se renueva solo antes de caducar) o undefined si se trabaja sin identidad. */
async function currentToken() {
  if (session && session.expiresAt - Date.now() > TOKEN_MARGIN_MS) {
    return session.token;
  }
  if (!session && Date.now() < anonymousUntil) {
    return undefined;
  }
  pendingSession ??= loadSession().finally(() => {
    pendingSession = null;
  });
  const fresh = await pendingSession;
  if (fresh) {
    session = fresh;
    anonymousUntil = 0;
  } else if (!session || session.expiresAt <= Date.now()) {
    session = null;
    anonymousUntil = Date.now() + ANONYMOUS_RETRY_MS;
  }
  return session?.token;
}

function forgetSession() {
  session = null;
  anonymousUntil = 0;
}

/** Quién está usando GRAVITY: { name, email, entityRef, groups } o null si no hay identidad (modo anónimo). */
export async function whoAmI() {
  await currentToken();
  if (!session) {
    return null;
  }
  const { profile, identity } = session;
  return {
    name: profile.displayName ?? profile.email ?? identity.userEntityRef,
    email: profile.email ?? "",
    entityRef: identity.userEntityRef ?? "",
    groups: (identity.ownershipEntityRefs ?? []).filter((ref) => ref !== identity.userEntityRef)
  };
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function requestOnce(path, { method = "GET", body, timeout = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const token = await currentToken();
    const headers = {};
    if (body) {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${BACKSTAGE_URL}${path}`, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const detail =
        data?.error?.message ?? data?.error ?? data?.message ?? response.statusText;
      throw new ApiError(
        `${typeof detail === "string" ? detail : JSON.stringify(detail)} (HTTP ${response.status})`,
        response.status
      );
    }

    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new ApiError("Backstage no respondió a tiempo.", 0);
    }
    if (err instanceof ApiError) {
      throw err;
    }
    const failure = new ApiError("No se pudo conectar con Backstage.", 0);
    failure.network = true;
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

/** Estados que indican que Backstage no estaba disponible un momento, p. ej. al reiniciarse (502/503/504 de nginx). */
const TRANSIENT = [502, 503, 504];

/** Las lecturas se reintentan una vez ante una caída breve; las escrituras nunca, para no ejecutar algo dos veces. */
async function request(path, options = {}) {
  try {
    return await requestOnce(path, options);
  } catch (err) {
    // 401: el token caducó o se revocó. No se ejecutó nada, así que es seguro renovarlo y repetir una vez (también escrituras).
    if (err.status === 401 && session) {
      forgetSession();
      return requestOnce(path, options);
    }
    const read = (options.method ?? "GET") === "GET";
    const transient = TRANSIENT.includes(err.status) || err.network;
    if (!read || !transient) {
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return requestOnce(path, options);
  }
}

const enc = encodeURIComponent;

/* Catálogo */

export const catalog = {
  all: () => request("/api/catalog/entities"),
  byName: (kind, namespace, name) =>
    request(`/api/catalog/entities/by-name/${enc(kind.toLowerCase())}/${enc(namespace)}/${enc(name)}`),
  components: () => request("/api/catalog/entities?filter=kind=component"),
  templates: () => request("/api/catalog/entities?filter=kind=template"),
  resources: () => request("/api/catalog/entities?filter=kind=resource"),
  groups: () => request("/api/catalog/entities?filter=kind=group"),
  /** Simula el registro de un catalog-info.yaml y devuelve las entidades que se crearían (sin guardar nada). */
  dryRunRegister: (target) =>
    request("/api/catalog/locations?dryRun=true", { method: "POST", body: { type: "url", target } }),
  register: (target) =>
    request("/api/catalog/locations", { method: "POST", body: { type: "url", target } })
};

/* Plantillas y tareas */

export const scaffolder = {
  parameterSchema: (name) =>
    request(`/api/scaffolder/v2/templates/default/template/${enc(name)}/parameter-schema`),
  run: (name, values) =>
    request("/api/scaffolder/v2/tasks", {
      method: "POST",
      body: { templateRef: `template:default/${name}`, values }
    }),
  task: (id) => request(`/api/scaffolder/v2/tasks/${enc(id)}`),
  // Backstage espera hasta ~30 s a que haya eventos nuevos (espera larga): el límite debe ser mayor para no cortarla.
  events: (id, after = 0) =>
    request(`/api/scaffolder/v2/tasks/${enc(id)}/events?after=${after}`, { timeout: 60000 }),
  tasks: (limit = 30) => request(`/api/scaffolder/v2/tasks?limit=${limit}&order=desc:created_at`),
  cancel: (id) => request(`/api/scaffolder/v2/tasks/${enc(id)}/cancel`, { method: "POST" })
};

/* Branching, pipelines y políticas */

export const branching = {
  rules: () => request("/api/branching/rules"),
  branches: (repo, project = PROJECT) =>
    request(`/api/branching/branches/${enc(project)}/${enc(repo)}`),
  repositoryExists: (name, project = PROJECT) =>
    request(`/api/branching/repositories/${enc(project)}/${enc(name)}`),
  pipelines: (project = PROJECT) => request(`/api/branching/pipelines/${enc(project)}`, { timeout: 60000 }),
  agentPools: (project = PROJECT) => request(`/api/branching/agent-pools/${enc(project)}`, { timeout: 60000 }),
  policies: (repo, project = PROJECT) =>
    request(`/api/branching/policies/${enc(project)}/${enc(repo)}`, { timeout: 60000 }),
  preview: (body) => request("/api/branching/preview", { method: "POST", body }),
  /** Nombre final de la rama que se va a crear y si ya existe (formulario de «Crear una rama»). */
  branchName: (body) => request("/api/branching/branch-name", { method: "POST", body }),
  validate: (body) => request("/api/branching/validate", { method: "POST", body }),
  health: () => request("/api/branching/health")
};

/* Homologación */

export const homologation = {
  component: (name) => request(`/api/homologation/components/${enc(name)}`, { timeout: 60000 }),
  baselineOf: (name) => request(`/api/homologation/baseline/${enc(name)}`, { timeout: 60000 }),
  items: () => request("/api/homologation/items", { timeout: 60000 }),
  components: () => request("/api/homologation/components", { timeout: 60000 }),
  baseline: () => request("/api/homologation/baseline", { timeout: 60000 }),
  health: () => request("/api/homologation/health")
};

/* TechDocs y Kubernetes: solo consulta de disponibilidad; el contenido se abre en Backstage. */

export const techdocs = {
  metadata: (namespace, name) =>
    request(`/api/techdocs/metadata/entity/${enc(namespace)}/component/${enc(name)}`)
};

export const kubernetes = {
  clusters: () => request("/api/kubernetes/clusters"),
  services: (serviceId, entity) =>
    request(`/api/kubernetes/services/${enc(serviceId)}`, { method: "POST", body: { entity }, timeout: 60000 })
};

export function entityRef(entity) {
  return `${entity.kind.toLowerCase()}:${entity.metadata.namespace ?? "default"}/${entity.metadata.name}`;
}

/* Indicadores de calidad por componente */

export const scorecards = {
  components: () => request("/api/scorecards/components", { timeout: 60000 })
};

/* Utilidades de presentación */

export function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

export function annotation(entity, key) {
  return entity?.metadata?.annotations?.[key];
}

export function isDeployable(entity) {
  return Boolean(
    annotation(entity, "dev.azure.com/project-repo") &&
      annotation(entity, "dev.azure.com/build-definition")
  );
}

export function repoOf(entity) {
  const value = annotation(entity, "dev.azure.com/project-repo");
  return value ? value.split("/").pop() : entity?.metadata?.name;
}
