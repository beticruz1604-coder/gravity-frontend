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
    const response = await fetch(`${BACKSTAGE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
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

/** Estados que indican que el túnel hacia Backstage se cayó un momento (502/503/504 de nginx y 530 de Cloudflare). */
const TRANSIENT = [502, 503, 504, 530];

/** Las lecturas se reintentan una vez ante una caída breve; las escrituras nunca, para no ejecutar algo dos veces. */
async function request(path, options = {}) {
  try {
    return await requestOnce(path, options);
  } catch (err) {
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
  events: (id, after = 0) =>
    request(`/api/scaffolder/v2/tasks/${enc(id)}/events?after=${after}`),
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

/** URL pública de la interfaz de Backstage, para los enlaces "Abrir en Backstage". */
export const BACKSTAGE_UI_URL =
  import.meta.env.VITE_BACKSTAGE_UI_URL ?? "https://backstage.backstage-lab.com";

export function backstageEntityUrl(entity, path = "") {
  const { kind, metadata } = entity;
  return `${BACKSTAGE_UI_URL}/catalog/${metadata.namespace ?? "default"}/${kind.toLowerCase()}/${metadata.name}${path}`;
}

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
