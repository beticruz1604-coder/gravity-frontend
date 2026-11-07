import React from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import { access, branching, catalog } from "./backstage";

/*
 * Selección global de organización y proyecto (encabezado de GRAVITY). Coppel tiene varias organizaciones de Azure DevOps,
 * muchos proyectos y organizaciones de GitHub; cada persona solo ve las de su alcance (lo filtra el backend en
 * /api/branching/repository-targets). La elección se recuerda en el navegador y la usan las pantallas de consulta y los
 * formularios que crean algo nuevo.
 *
 * workspace = { platform: "azure" | "github", organization, project }  (project "" = todos los proyectos)
 */

const KEY = "gravity.workspace";
const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
};
const write = (w) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    /* sin almacenamiento: solo dura la sesión */
  }
};

/** Selección activa, para las consultas que se hacen fuera de React (las pantallas se vuelven a montar al cambiarla). */
let active = { workspace: null, targets: null };

const WorkspaceContext = React.createContext({ workspace: null, targets: null, setWorkspace: () => {} });

/** La selección guardada si sigue dentro del alcance; si no, la primera organización disponible y todos sus proyectos. */
function valid(w, targets, admin) {
  // Admin: «Todas las organizaciones» (todo el catálogo y todas las pantallas sin filtro).
  if (admin && w?.platform === "all") return { platform: "all", organization: "", project: "" };
  const orgs = targets?.azure?.organizations ?? [];
  const owners = targets?.github?.owners ?? [];
  if (w?.platform === "github" && owners.includes(w.organization)) return { platform: "github", organization: w.organization, project: "" };
  const org = orgs.find((o) => o.name === w?.organization);
  if (w?.platform !== "github" && org) {
    return { platform: "azure", organization: org.name, project: org.projects.some((p) => p.name === w.project) ? w.project : "" };
  }
  if (orgs.length) return { platform: "azure", organization: orgs[0].name, project: "" };
  if (owners.length) return { platform: "github", organization: owners[0], project: "" };
  return null;
}

export function WorkspaceProvider({ enabled, admin = false, children }) {
  const [targets, setTargets] = React.useState(null);
  const [workspace, setState] = React.useState(read);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    branching
      .repositoryTargets()
      .then((t) => !cancelled && setTargets(t))
      .catch(() => !cancelled && setTargets({ azure: { organizations: [] }, github: { owners: [] }, error: true }));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const current = targets ? valid(workspace, targets, admin) : null;
  active = { workspace: current, targets };
  const setWorkspace = React.useCallback((w) => {
    write(w);
    setState(w);
  }, []);
  const value = React.useMemo(() => ({ workspace: current, targets, setWorkspace, admin }), [current?.platform, current?.organization, current?.project, targets, setWorkspace, admin]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export const useWorkspace = () => React.useContext(WorkspaceContext);

/** Clave de la selección: al cambiar, las pantallas se vuelven a montar y consultan otra vez. */
export const workspaceKey = (w) => (w ? `${w.platform}:${w.organization}:${w.project}` : "sin-seleccion");

/**
 * Organización y proyecto de un componente del catálogo: <organización>:<proyecto> si la ficha dice su organización
 * (dev.azure.com/host-org), o solo el proyecto (organización predeterminada). GitHub: github:<organización>.
 */
export function componentProject(entity) {
  const a = entity?.metadata?.annotations ?? {};
  if (a["github.com/project-slug"]) return `github:${a["github.com/project-slug"].split("/")[0]}`;
  if (!a["dev.azure.com/project-repo"]) return undefined;
  const project = a["dev.azure.com/project-repo"].split("/")[0];
  const org = a["dev.azure.com/host-org"] ? a["dev.azure.com/host-org"].split("/").pop() : "";
  return org ? `${org}:${project}` : project;
}

/** ¿El componente está en la organización y el proyecto elegidos? Los que no son de un repositorio no se filtran. */
export function inWorkspace(entity, workspace, defaultOrganization) {
  if (!workspace || workspace.platform === "all") return true;
  const where = componentProject(entity);
  if (!where) return entity?.kind !== "Component";
  if (where.startsWith("github:")) return workspace.platform === "github" && where.slice(7) === workspace.organization;
  if (workspace.platform !== "azure") return false;
  const [org, project] = where.includes(":") ? where.split(":") : [defaultOrganization, where];
  return org === workspace.organization && (!workspace.project || project === workspace.project);
}

/** Proyectos de la selección como <organización>:<proyecto> (todos los de la organización si no se eligió uno). */
export function workspaceProjects(workspace, targets) {
  if (workspace?.platform === "all") {
    return (targets?.azure?.organizations ?? []).flatMap((o) => o.projects.map((p) => `${o.name}:${p.name}`));
  }
  if (!workspace || workspace.platform !== "azure") return [];
  const org = (targets?.azure?.organizations ?? []).find((o) => o.name === workspace.organization);
  const names = workspace.project ? [workspace.project] : (org?.projects ?? []).map((p) => p.name);
  return names.map((p) => `${workspace.organization}:${p}`);
}

/** Selector del encabezado: organización (Azure DevOps y GitHub) y proyecto (solo Azure DevOps). */
export function WorkspaceSelector() {
  const { workspace, targets, setWorkspace, admin } = useWorkspace();
  if (!targets) return null;
  const orgs = targets.azure?.organizations ?? [];
  const owners = targets.github?.owners ?? [];
  if (!workspace) {
    return (
      <div className="organization">
        <small>ORGANIZACIÓN</small>
        <span className="workspace-empty">Sin organizaciones en tu alcance</span>
      </div>
    );
  }
  const org = orgs.find((o) => o.name === workspace.organization);
  const onOrg = (value) => {
    if (value === "all:") {
      setWorkspace({ platform: "all", organization: "", project: "" });
      return;
    }
    const [platform, ...rest] = value.split(":");
    setWorkspace({ platform, organization: rest.join(":"), project: "" });
  };
  return (
    <div className="workspace">
      <div className="organization">
        <small>ORGANIZACIÓN</small>
        <label className="workspace-select">
          <GitBranch size={13} />
          <select aria-label="Organización" value={`${workspace.platform}:${workspace.organization}`} onChange={(e) => onOrg(e.target.value)}>
            {admin && <option value="all:">Todas las organizaciones</option>}
            {orgs.length > 0 && (
              <optgroup label="Azure DevOps">
                {orgs.map((o) => <option key={o.name} value={`azure:${o.name}`}>{o.name}</option>)}
              </optgroup>
            )}
            {owners.length > 0 && (
              <optgroup label="GitHub">
                {owners.map((o) => <option key={o} value={`github:${o}`}>{o}</option>)}
              </optgroup>
            )}
          </select>
          <ChevronDown size={14} />
        </label>
      </div>
      {workspace.platform === "azure" && (
        <div className="organization">
          <small>PROYECTO</small>
          <label className="workspace-select">
            <select aria-label="Proyecto" value={workspace.project} onChange={(e) => setWorkspace({ ...workspace, project: e.target.value })}>
              <option value="">Todos los proyectos</option>
              {(org?.projects ?? []).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
      )}
    </div>
  );
}

/** Componentes del catálogo de la organización y el proyecto elegidos. */
export async function workspaceComponents() {
  const all = await catalog.components();
  return all.filter((e) => inWorkspace(e, active.workspace, active.targets?.defaultOrganization));
}

/** Filtro para listas de entidades del catálogo ya cargadas (solo decide por la entidad misma; ver scopeToWorkspace). */
export const inActiveWorkspace = (entity) => inWorkspace(entity, active.workspace, active.targets?.defaultOrganization);

const refOf = (e) => `${e.kind.toLowerCase()}:${e.metadata.namespace ?? "default"}/${e.metadata.name}`;
const ann = (e, k) => e?.metadata?.annotations?.[k];
const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Catálogo de la organización y el proyecto elegidos. Los componentes se filtran por su repositorio. Lo que no tiene
 * repositorio se filtra por su relación con esos componentes:
 * - Dominio / Torre y Producto / Sistema: si algún componente del proyecto los usa (devops.lab/division, devops.lab/initiative
 *   o spec.system).
 * - División: si es dueña de algún componente del proyecto.
 * - API y recurso: si un componente del proyecto los provee, consume o depende de ellos, o si son de un sistema y una división
 *   del proyecto.
 * Personas, grupos de roles, plantillas y ubicaciones no se filtran.
 */
export function scopeToWorkspace(entities, workspace = active.workspace, defaultOrganization = active.targets?.defaultOrganization) {
  if (!workspace || workspace.platform === "all") return entities;
  const components = entities.filter((e) => e.kind === "Component" && inWorkspace(e, workspace, defaultOrganization));
  const rel = (e, types) => (e.relations ?? []).filter((r) => types.includes(r.type)).map((r) => r.targetRef);
  const owners = new Set(components.flatMap((c) => rel(c, ["ownedBy"])));
  const systems = new Set(components.flatMap((c) => rel(c, ["partOf"])));
  const used = new Set(components.flatMap((c) => rel(c, ["providesApi", "consumesApi", "dependsOn"])));
  const domains = new Set(components.map((c) => norm(ann(c, "devops.lab/division"))).filter(Boolean));
  const initiatives = new Set(components.map((c) => norm(ann(c, "devops.lab/initiative"))).filter(Boolean));
  const value = (e) => norm(ann(e, "devops.lab/classification-value") ?? e.metadata.title ?? e.metadata.name);
  const keep = (e) => {
    switch (e.kind) {
      case "Component":
        return components.includes(e);
      case "Domain":
        return domains.has(value(e)) || domains.has(norm(e.metadata.name));
      case "System":
        return systems.has(refOf(e)) || initiatives.has(value(e)) || initiatives.has(norm(e.metadata.name));
      case "Group":
        return e.spec?.type !== "business-unit" || owners.has(refOf(e));
      case "API":
      case "Resource":
        return used.has(refOf(e)) || (rel(e, ["partOf"]).some((s) => systems.has(s)) && rel(e, ["ownedBy"]).some((o) => owners.has(o)));
      default:
        return true;
    }
  };
  return entities.filter(keep);
}

/** Pipelines de los proyectos elegidos (todos los de la organización si no se eligió uno), con su proyecto. */
export async function workspacePipelines() {
  const projects = workspaceProjects(active.workspace, active.targets);
  if (!projects.length) return { pipelines: [] };
  const lists = await Promise.all(
    projects.map((p) => branching.pipelines(p).then((r) => (r.pipelines ?? []).map((x) => ({ ...x, project: p.split(":")[1] }))))
  );
  return { pipelines: lists.flat() };
}

/** Pools de agentes de la organización elegida (los pools son de la organización; se consultan por uno de sus proyectos). */
export async function workspaceAgentPools() {
  const [first] = workspaceProjects(active.workspace, active.targets);
  return first ? branching.agentPools(first) : { pools: [] };
}

/** <organización>:<proyecto> del encabezado (GitHub: github:<organización>); undefined si falta elegir un proyecto. */
export function workspaceProjectKey(workspace) {
  if (!workspace) return undefined;
  if (workspace.platform === "github") return `github:${workspace.organization}`;
  if (workspace.platform !== "azure" || !workspace.project) return undefined;
  return `${workspace.organization}:${workspace.project}`;
}

/** Ficha del proyecto del encabezado (división, dominios y productos); null si el proyecto no tiene ficha. */
export function useProjectProfile() {
  const { workspace } = useWorkspace();
  const key = workspaceProjectKey(workspace);
  const [state, setState] = React.useState({ loading: Boolean(key), profile: null, key });
  React.useEffect(() => {
    if (!key) {
      setState({ loading: false, profile: null, key });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, profile: null, key });
    access
      .project(key)
      .then((r) => !cancelled && setState({ loading: false, profile: r.profile, key }))
      .catch((err) => !cancelled && setState({ loading: false, profile: null, key, error: err.status === 404 ? "" : err.message }));
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state;
}
