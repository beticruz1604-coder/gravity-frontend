import React from "react";
import { dump, load } from "js-yaml";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search
} from "lucide-react";

import {
  branching,
  catalog,
  homologation,
  kubernetes,
  scorecards,
  techdocs,
  annotation,
  backstageEntityUrl,
  entityRef,
  formatDate
} from "./backstage";
import { useNav } from "./nav";
import { PipelineStatus, StatusPill } from "./status";

/*
 * Catálogo de Backstage dentro de GRAVITY: explorador de entidades, detalle por entidad (resumen, relaciones, CI/CD,
 * despliegues, calidad, API, docs, Kubernetes y YAML), grafo y organización.
 */

/* ------------------------------------------------------------- Utilidades */

let entitiesCache;

/** Entidades del catálogo (una sola consulta compartida entre pantallas). */
export function useEntities() {
  const [state, setState] = React.useState({ loading: !entitiesCache, data: entitiesCache, error: "" });

  const load = React.useCallback(async (force = false) => {
    if (!force && entitiesCache) {
      setState({ loading: false, data: entitiesCache, error: "" });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      entitiesCache = await catalog.all();
      setState({ loading: false, data: entitiesCache, error: "" });
    } catch (err) {
      setState((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, []);

  React.useEffect(() => {
    load(true);
  }, [load]);

  return { ...state, reload: () => load(true) };
}

/** Recarga el catálogo cada `ms` mientras la pantalla está abierta. */
function useAutoRefresh(reload, ms = 60000) {
  const ref = React.useRef(reload);
  ref.current = reload;
  React.useEffect(() => {
    const timer = setInterval(() => ref.current(), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

function useAsync(loader, deps) {
  const [state, setState] = React.useState({ loading: true });
  React.useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    loader()
      .then((data) => !cancelled && setState({ data }))
      .catch((error) => !cancelled && setState({ error: error.message, status: error.status }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

const shortRef = (ref = "") => ref.replace(/^[a-z]+:default\//i, "");

/** Nombre visible de una entidad: el de perfil (grupos), el título o, en su defecto, el identificador. */
const displayName = (entity) => entity.spec?.profile?.displayName ?? entity.metadata.title ?? entity.metadata.name;

/**
 * Nombre del propietario tal como se muestra: el nombre visible del grupo (p. ej. "Cadena de Suministro"), no su
 * identificador técnico (`development`). Si el grupo no está en el catálogo, se usa el identificador.
 */
export function ownerLabel(entity, entities = []) {
  const ref = (entity.relations ?? []).find((r) => r.type === "ownedBy")?.targetRef ?? entity.spec?.owner;
  if (!ref) return "—";
  const full = String(ref).includes(":") ? String(ref) : `group:default/${ref}`;
  const group = findByRef(entities, full);
  return group?.spec?.profile?.displayName ?? group?.metadata?.title ?? shortRef(full);
}

/** "Sí" / "No" a partir de la anotación ("true", "false", "sí", "no"…); undefined si no está definida. */
export function yesNo(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return ["true", "si", "sí", "yes", "1"].includes(String(value).trim().toLowerCase()) ? "Sí" : "No";
}

/**
 * Clasificación de negocio de una entidad, leída de las anotaciones del catalog-info.yaml:
 *   devops.lab/division (OMS, TMS, WMS o Digital) · devops.lab/initiative (sistema o iniciativa) · devops.lab/legacy · devops.lab/critical
 */
export function classification(entity) {
  return {
    division: annotation(entity, "devops.lab/division"),
    initiative: annotation(entity, "devops.lab/initiative") || undefined,
    legacy: yesNo(annotation(entity, "devops.lab/legacy")),
    critical: yesNo(annotation(entity, "devops.lab/critical"))
  };
}

function YesNo({ value }) {
  if (value === "Sí") return <StatusPill tone="warning">Sí</StatusPill>;
  if (value === "No") return <span className="status-text status-none">No</span>;
  return <span className="status-text status-none">—</span>;
}

function findByRef(entities, ref) {
  const [kindPart, rest] = ref.split(":");
  const [namespace, name] = rest.includes("/") ? rest.split("/") : ["default", rest];
  return entities.find(
    (e) =>
      e.kind.toLowerCase() === kindPart.toLowerCase() &&
      (e.metadata.namespace ?? "default") === namespace &&
      e.metadata.name === name
  );
}

function Loading({ children = "Consultando información..." }) {
  return (
    <div className="runner-loading">
      <Loader2 size={18} className="spin" /> {children}
    </div>
  );
}

function ErrorBox({ message }) {
  return message ? (
    <div className="module-error">
      <AlertTriangle size={16} />
      {message}
    </div>
  ) : null;
}

function Notice({ children }) {
  return <div className="demo-notice"><span className="demo-indicator" />{children}</div>;
}

function ExternalA({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-link">
      {children} <ExternalLink size={11} />
    </a>
  );
}

function EntityLink({ entities, refText }) {
  const { openEntity } = useNav();
  const entity = entities ? findByRef(entities, refText) : undefined;
  if (!entity) {
    return <span>{shortRef(refText)}</span>;
  }
  return (
    <button className="link-button" onClick={() => openEntity(entityRef(entity))}>
      {displayName(entity)}
    </button>
  );
}

/** Categorías que se clasifican por División / Torre, Sistema / Iniciativa, Legado y Crítico. */
const CLASSIFIED_KINDS = ["Component", "API", "Resource", "System", "Domain"];

const KINDS = ["Component", "API", "Resource", "System", "Domain", "Group", "User", "Template"];
const KIND_LABEL = {
  Component: "Componentes",
  API: "APIs",
  Resource: "Recursos",
  System: "Sistemas",
  Domain: "Dominios",
  Group: "Grupos",
  User: "Usuarios",
  Template: "Plantillas"
};

/* ----------------------------------------------------------------- Grafo */

const GRAPH_COLUMNS = ["Group", "System", "Component", "API", "Resource"];
const GRAPH_RELATIONS = ["dependsOn", "providesApi", "consumesApi", "partOf", "ownedBy"];
const KIND_COLOR = {
  Group: "#8d9ab0",
  System: "#b58cff",
  Component: "#5797ff",
  API: "#f2c76e",
  Resource: "#6de0b0"
};

/** Grafo de relaciones: todo el catálogo, o una entidad y sus vecinas si se indica `focus`. */
export function RelationGraph({ entities, focus, showOwners }) {
  const { openEntity } = useNav();
  const [hover, setHover] = React.useState(null);

  const edges = [];
  for (const entity of entities) {
    for (const relation of entity.relations ?? []) {
      if (GRAPH_RELATIONS.includes(relation.type)) {
        const target = findByRef(entities, relation.targetRef);
        if (target) {
          edges.push({ from: entityRef(entity), to: entityRef(target), type: relation.type });
        }
      }
    }
  }

  let visible = entities.filter((e) => GRAPH_COLUMNS.includes(e.kind) && (showOwners || e.kind !== "Group"));
  let shownEdges = edges;

  if (focus) {
    const ref = entityRef(focus);
    const near = new Set([ref]);
    edges.forEach((edge) => {
      if (edge.from === ref) near.add(edge.to);
      if (edge.to === ref) near.add(edge.from);
    });
    visible = visible.filter((e) => near.has(entityRef(e)));
    shownEdges = edges.filter((edge) => near.has(edge.from) && near.has(edge.to));
  }

  const columns = GRAPH_COLUMNS.filter((kind) => visible.some((e) => e.kind === kind));
  const spacingX = 230;
  const spacingY = 56;
  const positions = {};
  let height = 80;

  columns.forEach((kind, col) => {
    const list = visible.filter((e) => e.kind === kind);
    list.forEach((entity, row) => {
      positions[entityRef(entity)] = { x: 40 + col * spacingX, y: 50 + row * spacingY, entity };
    });
    height = Math.max(height, 50 + list.length * spacingY + 20);
  });

  const width = 80 + columns.length * spacingX;
  const drawn = shownEdges.filter((edge) => positions[edge.from] && positions[edge.to]);

  if (visible.length === 0) {
    return <div className="empty-table">No hay entidades para dibujar.</div>;
  }

  return (
    <div className="graph-wrap">
      <svg width={width} height={height} className="graph-svg">
        {columns.map((kind, col) => (
          <text key={kind} x={40 + col * spacingX} y={22} className="graph-column">
            {KIND_LABEL[kind]}
          </text>
        ))}

        {drawn.map((edge, i) => {
          const a = positions[edge.from];
          const b = positions[edge.to];
          const x1 = a.x + 170;
          const x2 = b.x;
          const same = a.x === b.x;
          const path = same
            ? `M ${a.x + 85} ${a.y + 18} C ${a.x + 150} ${a.y + 30}, ${b.x + 150} ${b.y - 10}, ${b.x + 85} ${b.y}`
            : x2 > x1
              ? `M ${x1} ${a.y + 14} C ${x1 + 40} ${a.y + 14}, ${x2 - 40} ${b.y + 14}, ${x2} ${b.y + 14}`
              : `M ${a.x} ${a.y + 14} C ${a.x - 40} ${a.y + 14}, ${b.x + 210} ${b.y + 14}, ${b.x + 170} ${b.y + 14}`;
          const active = hover && (hover === edge.from || hover === edge.to);
          return (
            <path
              key={`${edge.from}-${edge.to}-${edge.type}-${i}`}
              d={path}
              className={`graph-edge ${active ? "graph-edge-active" : ""}`}
            >
              <title>{`${shortRef(edge.from)} ${edge.type} ${shortRef(edge.to)}`}</title>
            </path>
          );
        })}

        {Object.entries(positions).map(([ref, { x, y, entity }]) => (
          <g
            key={ref}
            className={`graph-node ${focus && entityRef(focus) === ref ? "graph-node-focus" : ""}`}
            transform={`translate(${x}, ${y})`}
            onClick={() => openEntity(ref)}
            onMouseEnter={() => setHover(ref)}
            onMouseLeave={() => setHover(null)}
          >
            <rect width="170" height="28" rx="6" style={{ stroke: KIND_COLOR[entity.kind] }} />
            <text x="10" y="18">{displayName(entity).slice(0, 24)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------- Catálogo */

export function CatalogPage() {
  const { openEntity } = useNav();
  const loader = useEntities();
  useAutoRefresh(loader.reload);
  const [kind, setKind] = React.useState("Component");
  const [search, setSearch] = React.useState("");
  const [type, setType] = React.useState("Todos");
  const [showOwners, setShowOwners] = React.useState(false);

  const entities = loader.data ?? [];
  const classified = CLASSIFIED_KINDS.includes(kind);
  const ofKind = entities.filter((e) => e.kind === kind);
  const types = [...new Set(ofKind.map((e) => e.spec?.type).filter(Boolean))];
  const rows = ofKind.filter((e) => {
    const c = classification(e);
    const text = `${e.metadata.name} ${e.metadata.title ?? ""} ${e.metadata.description ?? ""} ${(e.metadata.tags ?? []).join(" ")} ${ownerLabel(e, entities)} ${c.division ?? ""} ${c.initiative ?? ""}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (type === "Todos" || e.spec?.type === type);
  });

  return (
    <section className="module-page">
      <div className="module-heading">
        <div>
          <span className="module-eyebrow">CATÁLOGO</span>
          <h1>Catálogo</h1>
          <p>Todas las entidades registradas en Backstage: componentes, APIs, recursos, sistemas, grupos, usuarios y plantillas.</p>
        </div>
      </div>

      <div className="homologation-stats">
        {["Component", "API", "Resource", "System"].map((k) => (
          <div className="homologation-stat" key={k}>
            <span>{KIND_LABEL[k]}</span>
            <strong>{entities.filter((e) => e.kind === k).length}</strong>
          </div>
        ))}
      </div>

      <div className="module-panel">
        <div className="homologation-tabs">
          {KINDS.map((k) => (
            <button key={k} className={kind === k ? "selected" : ""} onClick={() => { setKind(k); setType("Todos"); }}>
              {KIND_LABEL[k]}
            </button>
          ))}
          <button className={kind === "graph" ? "selected" : ""} onClick={() => setKind("graph")}>Grafo</button>
        </div>

        {kind !== "graph" && (
          <div className="pipeline-toolbar">
            <div className="search-input-wrapper">
              <Search size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, descripción o etiqueta..." />
            </div>
            {types.length > 0 && (
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option>Todos</option>
                {types.map((t) => <option key={t}>{t}</option>)}
              </select>
            )}
            <button className="refresh-module-button" onClick={loader.reload} disabled={loader.loading} title="Actualizar información">
              <RefreshCw size={16} className={loader.loading ? "spin" : ""} />
            </button>
          </div>
        )}

        <ErrorBox message={loader.error && `No fue posible consultar el catálogo. ${loader.error}`} />

        {kind === "graph" ? (
          <>
            <div className="pipeline-toolbar">
              <label className="inline-check">
                <input type="checkbox" checked={showOwners} onChange={(e) => setShowOwners(e.target.checked)} />
                Mostrar propietarios (grupos)
              </label>
            </div>
            <RelationGraph entities={entities} showOwners={showOwners} />
          </>
        ) : kind === "Group" || kind === "User" ? (
          <OrganizationTable entities={entities} kind={kind} rows={rows} />
        ) : (
          <div className="table-wrapper">
            <table className="pool-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Propietario</th>
                  {classified && (
                    <>
                      <th>División / Torre</th>
                      <th>Sistema / Iniciativa</th>
                      <th>Legado</th>
                      <th>Crítico</th>
                    </>
                  )}
                  <th>Etiquetas</th>
                  <th>Descripción</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={classified ? 9 : 5} className="empty-table">{loader.loading ? "Consultando información..." : "Sin entidades."}</td></tr>
                )}
                {rows.map((e) => {
                  const c = classification(e);
                  return (
                    <tr key={entityRef(e)}>
                      <td><button className="link-button" onClick={() => openEntity(entityRef(e))}>{e.metadata.title ?? e.metadata.name}</button></td>
                      <td>{e.spec?.type ?? "—"}</td>
                      <td>{ownerLabel(e, entities)}</td>
                      {classified && (
                        <>
                          <td>{c.division ?? "—"}</td>
                          <td>{c.initiative ?? "—"}</td>
                          <td><YesNo value={c.legacy} /></td>
                          <td><YesNo value={c.critical} /></td>
                        </>
                      )}
                      <td>{(e.metadata.tags ?? []).slice(0, 4).join(", ")}</td>
                      <td>{e.metadata.description ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="module-footer-info"><span>{rows.length} de {ofKind.length}</span><span>Backstage · /api/catalog</span></div>
      </div>
    </section>
  );
}

function OrganizationTable({ entities, kind, rows }) {
  const { openEntity } = useNav();
  const membersOf = (group) =>
    (group.relations ?? []).filter((r) => r.type === "hasMember").map((r) => shortRef(r.targetRef));

  return (
    <div className="table-wrapper">
      <table className="pool-table">
        <thead>
          {kind === "Group" ? (
            <tr><th>Grupo</th><th>Tipo</th><th>Padre</th><th>Miembros</th><th>Descripción</th></tr>
          ) : (
            <tr><th>Usuario</th><th>Nombre</th><th>Correo</th><th>Grupos</th></tr>
          )}
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan="5" className="empty-table">Sin entidades.</td></tr>}
          {rows.map((e) =>
            kind === "Group" ? (
              <tr key={entityRef(e)}>
                <td><button className="link-button" onClick={() => openEntity(entityRef(e))}>{displayName(e)}</button></td>
                <td>{e.spec?.type ?? "—"}</td>
                <td>{e.spec?.parent ?? "—"}</td>
                <td>{membersOf(e).join(", ") || "—"}</td>
                <td>{e.metadata.description ?? "—"}</td>
              </tr>
            ) : (
              <tr key={entityRef(e)}>
                <td><button className="link-button" onClick={() => openEntity(entityRef(e))}>{e.metadata.name}</button></td>
                <td>{e.spec?.profile?.displayName ?? "—"}</td>
                <td>{e.spec?.profile?.email ?? "—"}</td>
                <td>{(e.relations ?? []).filter((r) => r.type === "memberOf").map((r) => shortRef(r.targetRef)).join(", ") || "—"}</td>
              </tr>
            )
          )}
        </tbody>
      </table>
      <span hidden>{entities.length}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- Detalle */

function KeyValues({ rows }) {
  return (
    <div className="kv-grid">
      {rows.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => (
        <div className="kv-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function Overview({ entity, entities }) {
  const m = entity.metadata;
  const annotations = m.annotations ?? {};
  const links = m.links ?? [];
  const ownerRef = (entity.relations ?? []).find((r) => r.type === "ownedBy")?.targetRef;
  const c = classification(entity);
  const partOf = (entity.relations ?? []).filter((r) => r.type === "partOf").map((r) => r.targetRef);

  return (
    <>
      <KeyValues
        rows={[
          ["Tipo", entity.spec?.type],
          ["Ciclo de vida", entity.spec?.lifecycle],
          ["Propietario", ownerRef ? <EntityLink entities={entities} refText={ownerRef} /> : ownerLabel(entity, entities)],
          ["División / Torre", c.division],
          ["Sistema / Iniciativa", c.initiative],
          ["Legado", c.legacy],
          ["Crítico", c.critical],
          ["Sistema", partOf.length ? partOf.map((ref) => <EntityLink key={ref} entities={entities} refText={ref} />) : undefined],
          ["Namespace", m.namespace ?? "default"],
          ["Etiquetas", (m.tags ?? []).join(", ")],
          ["Descripción", m.description]
        ]}
      />

      {(links.length > 0 || annotation(entity, "backstage.io/view-url")) && (
        <div className="panel-block">
          <strong>Enlaces</strong>
          <div className="task-links">
            {annotation(entity, "backstage.io/view-url") && (
              <ExternalA href={annotation(entity, "backstage.io/view-url").replace(/\?path=.*/, "")}>Repositorio</ExternalA>
            )}
            {links.map((link) => <ExternalA key={link.url} href={link.url}>{link.title ?? link.url}</ExternalA>)}
            <ExternalA href={backstageEntityUrl(entity)}>Abrir en Backstage</ExternalA>
          </div>
        </div>
      )}

      <div className="panel-block">
        <strong>Anotaciones</strong>
        <div className="table-wrapper">
          <table className="pool-table">
            <tbody>
              {Object.entries(annotations).length === 0 && <tr><td className="empty-table">Sin anotaciones.</td></tr>}
              {Object.entries(annotations).map(([key, value]) => (
                <tr key={key}><td>{key}</td><td className="wrap">{String(value)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Relations({ entity, entities }) {
  const groups = {};
  for (const relation of entity.relations ?? []) {
    (groups[relation.type] ??= []).push(relation.targetRef);
  }

  return (
    <>
      <RelationGraph entities={entities} focus={entity} showOwners />
      <div className="table-wrapper">
        <table className="pool-table">
          <thead><tr><th>Relación</th><th>Entidades</th></tr></thead>
          <tbody>
            {Object.keys(groups).length === 0 && <tr><td colSpan="2" className="empty-table">Sin relaciones.</td></tr>}
            {Object.entries(groups).map(([type, refs]) => (
              <tr key={type}>
                <td>{type}</td>
                <td className="row-actions">
                  {refs.map((ref) => <EntityLink key={ref} entities={entities} refText={ref} />)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Pipelines({ entity }) {
  const definition = annotation(entity, "dev.azure.com/build-definition");
  const state = useAsync(() => branching.pipelines(), []);

  if (!definition) {
    return <Notice>Este componente no tiene un pipeline de Azure DevOps asociado.</Notice>;
  }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorBox message={state.error} />;

  const mine = state.data.pipelines.filter((p) => p.name === definition || p.name.startsWith(`${entity.metadata.name}`));
  return (
    <div className="table-wrapper">
      <table className="pool-table">
        <thead><tr><th>Pipeline</th><th>Ambiente</th><th>Rama</th><th>Estado</th><th>Última ejecución</th><th>Ejecuciones</th></tr></thead>
        <tbody>
          {mine.length === 0 && <tr><td colSpan="6" className="empty-table">No se encontró el pipeline "{definition}".</td></tr>}
          {mine.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.environment}</td>
              <td>{p.branch}</td>
              <td><PipelineStatus status={p.status} /></td>
              <td>{p.lastRun?.url ? <ExternalA href={p.lastRun.url}>{p.lastRun.number ?? p.lastRun.id}</ExternalA> : "—"} <small>{formatDate(p.lastRun?.finishedAt)}</small></td>
              <td>{p.executions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Deployments({ entity }) {
  const state = useAsync(() => homologation.component(entity.metadata.name), [entity.metadata.name]);
  if (state.loading) return <Loading>Consultando despliegues (puede tardar unos segundos)...</Loading>;
  if (state.error) return <Notice>{state.status === 404 ? "Este componente no tiene pipeline de despliegue." : state.error}</Notice>;
  const data = state.data;
  return (
    <>
      <Notice>{data.detail}</Notice>
      <div className="table-wrapper">
        <table className="pool-table">
          <thead><tr><th>Ambiente</th><th>Versión</th><th>Commit</th><th>Rama</th><th>Ejecución</th><th>Antigüedad</th></tr></thead>
          <tbody>
            {data.environments.map((e) => (
              <tr key={e.environment}>
                <td>{e.environment}{e.optional ? " (opcional)" : ""}</td>
                {e.deployed ? (
                  <>
                    <td>{e.version ?? "sin versión"}</td>
                    <td>{e.commit?.slice(0, 7)}</td>
                    <td>{e.branch}</td>
                    <td>#{e.buildNumber}</td>
                    <td>{e.ageDays} d</td>
                  </>
                ) : (
                  <td colSpan="5">Sin despliegue</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const CHECK_CLASS = { aprobada: "homologation-approved", excepcion: "homologation-approved", "no-aprobada": "homologation-pending", "sin-dato": "homologation-review", "en-revision": "homologation-review" };

function Quality({ entity }) {
  const name = entity.metadata.name;
  const state = useAsync(async () => {
    const [cards, baseline] = await Promise.all([
      scorecards.components().catch(() => []),
      homologation.baselineOf(name).catch(() => null)
    ]);
    return { card: cards.find((c) => c.name === name), baseline };
  }, [name]);

  if (state.loading) return <Loading />;
  const { card, baseline } = state.data ?? {};

  return (
    <>
      <div className="panel-block">
        <strong>Scorecard {card ? `· ${card.score}% (${card.level})` : ""}</strong>
        {card ? (
          <div className="table-wrapper">
            <table className="pool-table">
              <tbody>
                {card.checks.map((c) => (
                  <tr key={c.id}>
                    <td>{c.title}</td>
                    <td><span className={c.pass ? "homologation-approved" : "homologation-pending"}>{c.pass ? "Cumple" : "No cumple"}</span></td>
                    <td>{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Notice>Sin scorecard para esta entidad.</Notice>}
      </div>

      <div className="panel-block">
        <strong>Línea base tecnológica {baseline ? `· ${baseline.status} (${baseline.score}%)` : ""}</strong>
        {baseline?.checks?.length ? (
          <div className="table-wrapper">
            <table className="pool-table">
              <tbody>
                {baseline.checks.map((c) => (
                  <tr key={c.id}>
                    <td>{c.title}</td>
                    <td>{c.value ?? "—"}</td>
                    <td><span className={CHECK_CLASS[c.status] ?? "homologation-review"}>{c.status}</span></td>
                    <td>{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Notice>Sin datos de línea base para esta entidad.</Notice>}
      </div>
    </>
  );
}

/* --------------------------------------------------------- API (OpenAPI) */

const METHOD_CLASS = { get: "homologation-approved", post: "homologation-review", put: "homologation-pending", delete: "homologation-pending", patch: "homologation-pending" };

function ApiDefinition({ entity }) {
  const definition = entity.spec?.definition;
  const [open, setOpen] = React.useState(null);

  if (!definition) {
    return <Notice>La entidad no incluye una definición.</Notice>;
  }

  let spec;
  try {
    spec = typeof definition === "string" ? load(definition) : definition;
  } catch (err) {
    return <ErrorBox message={`No se pudo leer la definición: ${err.message}`} />;
  }

  if (entity.spec?.type !== "openapi" || !spec?.paths) {
    return <pre className="yaml-view">{typeof definition === "string" ? definition : JSON.stringify(definition, null, 2)}</pre>;
  }

  const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item).filter(([method]) => ["get", "post", "put", "patch", "delete", "options", "head"].includes(method))
      .map(([method, op]) => ({ path, method, op }))
  );

  return (
    <>
      <KeyValues rows={[["Título", spec.info?.title], ["Versión", spec.info?.version], ["Especificación", spec.openapi ?? spec.swagger], ["Servidores", (spec.servers ?? []).map((s) => s.url).join(", ")], ["Descripción", spec.info?.description]]} />
      <div className="table-wrapper">
        <table className="pool-table">
          <thead><tr><th>Método</th><th>Ruta</th><th>Resumen</th><th>Respuestas</th></tr></thead>
          <tbody>
            {operations.map(({ path, method, op }) => {
              const key = `${method} ${path}`;
              return (
                <React.Fragment key={key}>
                  <tr className="clickable" onClick={() => setOpen(open === key ? null : key)}>
                    <td><span className={METHOD_CLASS[method] ?? "homologation-review"}>{method.toUpperCase()}</span></td>
                    <td><code>{path}</code></td>
                    <td>{op.summary ?? op.operationId ?? "—"}</td>
                    <td>{Object.keys(op.responses ?? {}).join(", ")}</td>
                  </tr>
                  {open === key && (
                    <tr>
                      <td colSpan="4"><pre className="yaml-view">{dump(op)}</pre></td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Apis({ entity, entities }) {
  const provided = (entity.relations ?? []).filter((r) => r.type === "providesApi").map((r) => r.targetRef);
  const consumed = (entity.relations ?? []).filter((r) => r.type === "consumesApi").map((r) => r.targetRef);
  const [selected, setSelected] = React.useState(provided[0] ?? consumed[0]);
  const refs = [...new Set([...provided, ...consumed])];
  const api = selected ? findByRef(entities, selected) : undefined;

  if (refs.length === 0) {
    return <Notice>Este componente no expone ni consume APIs registradas.</Notice>;
  }
  return (
    <>
      <div className="homologation-tabs">
        {refs.map((ref) => (
          <button key={ref} className={selected === ref ? "selected" : ""} onClick={() => setSelected(ref)}>
            {shortRef(ref)} · {provided.includes(ref) ? "provee" : "consume"}
          </button>
        ))}
      </div>
      {api ? <ApiDefinition entity={api} /> : <Notice>La API {shortRef(selected)} no está en el catálogo.</Notice>}
    </>
  );
}

/* ------------------------------------------------- TechDocs y Kubernetes */

function Docs({ entity }) {
  const ref = annotation(entity, "backstage.io/techdocs-ref");
  const state = useAsync(
    () => (ref ? techdocs.metadata(entity.metadata.namespace ?? "default", entity.metadata.name) : Promise.reject(new Error("sin-ref"))),
    [entity.metadata.name]
  );

  if (!ref) return <Notice>Este componente no tiene documentación configurada (falta la anotación backstage.io/techdocs-ref).</Notice>;
  if (state.loading) return <Loading />;

  return (
    <>
      {state.error ? (
        <Notice>La documentación está configurada pero aún no se ha generado en Backstage. Se genera la primera vez que alguien la abre allí.</Notice>
      ) : (
        <Notice>Documentación disponible{state.data?.build_timestamp ? ` (generada ${formatDate(state.data.build_timestamp * 1000)})` : ""}.</Notice>
      )}
      <div className="task-links">
        <ExternalA href={backstageEntityUrl(entity).replace("/catalog/", "/docs/")}>Abrir documentación en Backstage</ExternalA>
      </div>
    </>
  );
}

function KubernetesView({ entity }) {
  const id = annotation(entity, "backstage.io/kubernetes-id");
  const state = useAsync(async () => {
    const clusters = await kubernetes.clusters();
    if ((clusters.items ?? []).length === 0) {
      return { clusters: [] };
    }
    return { clusters: clusters.items, services: await kubernetes.services(id, entity).catch((e) => ({ error: e.message })) };
  }, [entity.metadata.name]);

  if (!id) return <Notice>Este componente no tiene la anotación backstage.io/kubernetes-id.</Notice>;
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorBox message={state.error} />;
  if (state.data.clusters.length === 0) {
    return <Notice>Backstage no tiene clústeres de Kubernetes configurados (kubernetes.clusterLocatorMethods), así que no hay pods que mostrar.</Notice>;
  }

  const { services } = state.data;
  if (services?.error) return <ErrorBox message={services.error} />;
  const resources = (services?.items ?? []).flatMap((item) => (item.resources ?? []).map((group) => ({ cluster: item.cluster?.name, ...group })));
  const pods = resources.filter((g) => g.type === "pods").flatMap((g) => g.resources.map((r) => ({ cluster: g.cluster, ...r })));
  const deployments = resources.filter((g) => g.type === "deployments").flatMap((g) => g.resources.map((r) => ({ cluster: g.cluster, ...r })));

  return (
    <>
      <div className="panel-block">
        <strong>Deployments</strong>
        <div className="table-wrapper">
          <table className="pool-table">
            <thead><tr><th>Clúster</th><th>Nombre</th><th>Réplicas listas</th></tr></thead>
            <tbody>
              {deployments.length === 0 && <tr><td colSpan="3" className="empty-table">Sin deployments.</td></tr>}
              {deployments.map((d) => (
                <tr key={`${d.cluster}-${d.metadata?.name}`}><td>{d.cluster}</td><td>{d.metadata?.name}</td><td>{d.status?.readyReplicas ?? 0}/{d.spec?.replicas ?? 0}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel-block">
        <strong>Pods</strong>
        <div className="table-wrapper">
          <table className="pool-table">
            <thead><tr><th>Clúster</th><th>Nombre</th><th>Fase</th><th>Reinicios</th></tr></thead>
            <tbody>
              {pods.length === 0 && <tr><td colSpan="4" className="empty-table">Sin pods.</td></tr>}
              {pods.map((p) => (
                <tr key={`${p.cluster}-${p.metadata?.name}`}>
                  <td>{p.cluster}</td>
                  <td>{p.metadata?.name}</td>
                  <td>{p.status?.phase}</td>
                  <td>{(p.status?.containerStatuses ?? []).reduce((sum, c) => sum + (c.restartCount ?? 0), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function RawYaml({ entity }) {
  const { relations: _relations, ...rest } = entity;
  return <pre className="yaml-view">{dump(rest, { lineWidth: 120 })}</pre>;
}

/* ------------------------------------------------------------ Entity page */

export function EntityPage({ reference, onBack }) {
  const loader = useEntities();
  const entities = loader.data ?? [];
  const entity = entities.length ? findByRef(entities, reference) : undefined;
  const [tab, setTab] = React.useState("resumen");

  React.useEffect(() => setTab("resumen"), [reference]);

  if (loader.loading && !entity) {
    return <section className="module-page"><Loading /></section>;
  }

  if (!entity) {
    return (
      <section className="module-page">
        <button className="pipeline-action back-button" onClick={onBack}><ArrowLeft size={14} /> Volver</button>
        <ErrorBox message={loader.error || `No se encontró la entidad ${reference} en el catálogo.`} />
      </section>
    );
  }

  const isComponent = entity.kind === "Component";
  const tabs = [
    ["resumen", "Resumen"],
    ["relaciones", "Relaciones"],
    ...(isComponent
      ? [["cicd", "CI/CD"], ["despliegues", "Despliegues"], ["calidad", "Calidad"], ["apis", "APIs"], ["docs", "Docs"], ["kubernetes", "Kubernetes"]]
      : []),
    ...(entity.kind === "API" ? [["definicion", "Definición"]] : []),
    ["yaml", "YAML"]
  ];

  return (
    <section className="module-page">
      <button className="pipeline-action back-button" onClick={onBack}><ArrowLeft size={14} /> Volver</button>
      <div className="module-heading">
        <div>
          <span className="module-eyebrow">{entity.kind.toUpperCase()}{entity.spec?.type ? ` · ${entity.spec.type}` : ""}</span>
          <h1>{entity.metadata.title ?? entity.metadata.name}</h1>
          <p>{entity.metadata.description ?? "Sin descripción."}</p>
        </div>
      </div>

      <div className="module-panel">
        <div className="homologation-tabs">
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? "selected" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <div className="entity-body">
          {tab === "resumen" && <Overview entity={entity} entities={entities} />}
          {tab === "relaciones" && <Relations entity={entity} entities={entities} />}
          {tab === "cicd" && <Pipelines entity={entity} />}
          {tab === "despliegues" && <Deployments entity={entity} />}
          {tab === "calidad" && <Quality entity={entity} />}
          {tab === "apis" && <Apis entity={entity} entities={entities} />}
          {tab === "definicion" && <ApiDefinition entity={entity} />}
          {tab === "docs" && <Docs entity={entity} />}
          {tab === "kubernetes" && <KubernetesView entity={entity} />}
          {tab === "yaml" && <RawYaml entity={entity} />}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Búsqueda */

export function GlobalSearch() {
  const { openEntity } = useNav();
  const loader = useEntities();
  const [term, setTerm] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const results = term.trim().length < 2
    ? []
    : (loader.data ?? [])
        .filter((e) => `${e.metadata.name} ${e.metadata.title ?? ""} ${e.metadata.description ?? ""} ${(e.metadata.tags ?? []).join(" ")}`.toLowerCase().includes(term.toLowerCase()))
        .slice(0, 8);

  return (
    <div className="global-search">
      <Search size={14} />
      <input
        value={term}
        placeholder="Buscar en el catálogo..."
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((e) => (
            <button key={entityRef(e)} onMouseDown={() => { openEntity(entityRef(e)); setTerm(""); }}>
              <strong>{e.metadata.title ?? e.metadata.name}</strong>
              <small>{e.kind}{e.spec?.type ? ` · ${e.spec.type}` : ""}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
