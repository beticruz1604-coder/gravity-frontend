import React from "react";
import { dump, load } from "js-yaml";
import DOMPurify from "dompurify";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  X
} from "lucide-react";

import {
  branching,
  catalog,
  homologation,
  kubernetes,
  scorecards,
  techdocs,
  annotation,
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
 *   devops.lab/division (OMS, TMS, WMS o Digital) · devops.lab/initiative (producto de la organización) · devops.lab/legacy · devops.lab/critical
 */
export function classification(entity) {
  return {
    division: annotation(entity, "devops.lab/division"),
    initiative: annotation(entity, "devops.lab/initiative") || undefined,
    legacy: yesNo(annotation(entity, "devops.lab/legacy")),
    critical: yesNo(annotation(entity, "devops.lab/critical"))
  };
}

/**
 * "Sí" / "No" como insignia de color. Sin `noTone`, el «No» se muestra como texto gris (Legado: solo resalta el «Sí»).
 * Con `noTone`, los dos valores se resaltan, cada uno con su color (Crítico: Sí en rojo y No en verde).
 */
function YesNo({ value, yesTone = "warning", noTone }) {
  if (value === "Sí") return <StatusPill tone={yesTone}>Sí</StatusPill>;
  if (value === "No") {
    return noTone ? <StatusPill tone={noTone}>No</StatusPill> : <span className="status-text status-none">No</span>;
  }
  return <span className="status-text status-none">—</span>;
}

const LegacyValue = ({ value }) => <YesNo value={value} />;
const CriticalValue = ({ value }) => <YesNo value={value} yesTone="failed" noTone="success" />;

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

/** Categorías que se clasifican por Dominio / Torre, Producto / Sistema, Legado y Crítico. */
const CLASSIFIED_KINDS = ["Component", "API", "Resource"];

/**
 * Pestañas del catálogo, con los nombres de los campos de las plantillas: División (grupos de tipo unidad de negocio), Dominio /
 * Torre (Domain) y Producto / Sistema (System). Usuarios, Plantillas y los grupos de roles no van aquí: se gestionan en Usuarios
 * y en Pipeline Engine.
 */
const KINDS = ["Component", "API", "Resource", "Division", "Domain", "System"];
const isDivision = (e) => e.kind === "Group" && e.spec?.type === "business-unit";
const ofTab = (tab) => (e) => (tab === "Division" ? isDivision(e) : e.kind === tab);
const KIND_LABEL = {
  Component: "Componentes",
  API: "APIs",
  Resource: "Recursos",
  Division: "División",
  Domain: "Dominio / Torre",
  System: "Producto / Sistema",
  Group: "Grupos",
  User: "Usuarios",
  Template: "Plantillas"
};

const KIND_SINGULAR = {
  Component: "Componente",
  API: "API",
  Resource: "Recurso",
  System: "Producto / Sistema",
  Domain: "Dominio / Torre",
  Group: "Grupo",
  User: "Usuario",
  Template: "Plantilla",
  Location: "Ubicación"
};
/** Nombre de la clase de una entidad; un grupo de tipo unidad de negocio es una División. */
const kindName = (e) => (isDivision(e) ? "División" : KIND_SINGULAR[e.kind] ?? e.kind);

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

/** Nombre en español del tipo (spec.type); un tipo que no está aquí se muestra tal cual. */
const TYPE_LABEL = {
  service: "Servicio",
  website: "Sitio web",
  library: "Librería",
  openapi: "OpenAPI",
  asyncapi: "AsyncAPI",
  graphql: "GraphQL",
  grpc: "gRPC",
  "storage-bucket": "Bucket",
  "container-registry": "Registro de contenedores",
  network: "Red",
  subnet: "Subred",
  database: "Base de datos",
  team: "Equipo",
  "business-unit": "Unidad de negocio"
};
export const typeLabel = (type) => (type ? TYPE_LABEL[type] ?? type : undefined);

/** Entidad Domain o System que corresponde a un valor de la clasificación (Dominio / Torre o Producto / Sistema). */
function classificationEntity(entities, kind, value) {
  if (!value) return undefined;
  const v = String(value).trim().toLowerCase();
  return entities.find(
    (e) =>
      e.kind === kind &&
      [annotation(e, "devops.lab/classification-value"), e.metadata.title, e.metadata.name]
        .filter(Boolean)
        .some((x) => String(x).trim().toLowerCase() === v)
  );
}

/**
 * Componentes de una División (los que son suyos), de un Domain (por su Dominio / Torre) o de un System (por su Producto /
 * Sistema o por spec.system).
 */
function componentsOf(entity, entities) {
  if (entity.kind === "Group") {
    return entities.filter((e) => e.kind === "Component" && (e.relations ?? []).some((r) => r.type === "ownedBy" && r.targetRef === entityRef(entity)));
  }
  const value = (annotation(entity, "devops.lab/classification-value") ?? entity.metadata.title ?? entity.metadata.name).toLowerCase();
  const key = entity.kind === "Domain" ? "division" : "initiative";
  return entities.filter(
    (e) =>
      e.kind === "Component" &&
      ((classification(e)[key] ?? "").trim().toLowerCase() === value ||
        (entity.kind === "System" && (e.relations ?? []).some((r) => r.type === "partOf" && r.targetRef === entityRef(entity))))
  );
}

/**
 * Categorías por las que se puede filtrar una pestaña. Cada una devuelve los valores de una entidad (una lista: las etiquetas
 * son varias). Dentro de una categoría se suman los valores elegidos; entre categorías deben cumplirse todas.
 */
function filterCategories(kind, entities) {
  const type = { id: "type", label: "Tipo", values: (e) => [typeLabel(e.spec?.type) ?? "—"] };
  const owner = { id: "owner", label: "División", values: (e) => [ownerLabel(e, entities)] };
  const tags = { id: "tags", label: "Etiquetas", values: (e) => e.metadata.tags ?? [] };
  if (kind === "Division") return [];
  if (!CLASSIFIED_KINDS.includes(kind)) return [owner];
  return [
    type,
    owner,
    { id: "division", label: "Dominio / Torre", values: (e) => [classification(e).division ?? "—"] },
    { id: "initiative", label: "Producto / Sistema", values: (e) => [classification(e).initiative ?? "—"] },
    { id: "legacy", label: "Legado", values: (e) => [classification(e).legacy ?? "—"] },
    { id: "critical", label: "Crítico", values: (e) => [classification(e).critical ?? "—"] },
    tags
  ];
}

/** La pestaña, la búsqueda y los filtros se conservan al abrir una ficha y volver. */
const catalogView = { kind: "Component", search: "", filters: {} };

function FilterPanel({ categories, options, filters, onToggle }) {
  return (
    <div className="catalog-filter-panel" data-testid="filter-panel">
      {categories.map((c) =>
        options[c.id].length === 0 ? null : (
          <fieldset key={c.id}>
            <legend>{c.label}</legend>
            {options[c.id].map(([value, count]) => (
              <label key={value} className="inline-check">
                <input type="checkbox" checked={(filters[c.id] ?? []).includes(value)} onChange={() => onToggle(c.id, value)} />
                {value} <small>{count}</small>
              </label>
            ))}
          </fieldset>
        )
      )}
    </div>
  );
}

export function CatalogPage() {
  const { openEntity } = useNav();
  const loader = useEntities();
  useAutoRefresh(loader.reload);
  const [kind, setKindState] = React.useState(catalogView.kind);
  const [search, setSearchState] = React.useState(catalogView.search);
  const [filters, setFiltersState] = React.useState(catalogView.filters);
  const [showFilters, setShowFilters] = React.useState(false);
  const [showOwners, setShowOwners] = React.useState(false);
  const setKind = (k) => { catalogView.kind = k; setKindState(k); };
  const setSearch = (s) => { catalogView.search = s; setSearchState(s); };
  const setFilters = (f) => { catalogView.filters = f; setFiltersState(f); };

  const entities = loader.data ?? [];
  const classified = CLASSIFIED_KINDS.includes(kind);
  const grouping = kind === "Division" || kind === "Domain" || kind === "System";
  const ofKind = entities.filter(ofTab(kind));
  const categories = filterCategories(kind, entities);
  const matches = (e, except) =>
    categories.every((c) => c.id === except || !(filters[c.id]?.length) || c.values(e).some((v) => filters[c.id].includes(v)));
  const textOf = (e) => {
    const c = classification(e);
    return `${e.metadata.name} ${e.metadata.title ?? ""} ${e.metadata.description ?? ""} ${(e.metadata.tags ?? []).join(" ")} ${ownerLabel(e, entities)} ${c.division ?? ""} ${c.initiative ?? ""} ${typeLabel(e.spec?.type) ?? ""}`.toLowerCase();
  };
  const searched = ofKind.filter((e) => textOf(e).includes(search.toLowerCase()));
  const rows = searched.filter((e) => matches(e));
  // Opciones de cada categoría con cuántas entidades quedarían, teniendo en cuenta los demás filtros.
  const options = Object.fromEntries(
    categories.map((c) => {
      const counts = new Map();
      for (const e of searched.filter((x) => matches(x, c.id))) for (const v of new Set(c.values(e))) counts.set(v, (counts.get(v) ?? 0) + 1);
      for (const v of filters[c.id] ?? []) if (!counts.has(v)) counts.set(v, 0);
      return [c.id, [...counts.entries()].sort((a, b) => (a[0] === "—") - (b[0] === "—") || a[0].localeCompare(b[0], "es"))];
    })
  );
  const active = categories.flatMap((c) => (filters[c.id] ?? []).map((v) => [c, v]));
  const toggle = (id, value) => {
    const current = filters[id] ?? [];
    setFilters({ ...filters, [id]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  };
  /** Clic en un valor de la tabla: deja solo ese valor en su categoría. */
  const only = (id, value) => setFilters({ ...filters, [id]: [value] });
  const changeKind = (k, f = {}) => { setKind(k); setFilters(f); };

  const FilterValue = ({ id, value, children }) =>
    value === undefined || value === null || value === "—" ? (children ?? <span>—</span>) : (
      <button className="link-button" title="Filtrar por este valor" onClick={() => only(id, value)}>{children ?? value}</button>
    );
  const ClassificationLink = ({ entityKind, value, filterId }) => {
    const target = classificationEntity(entities, entityKind, value);
    if (target) return <button className="link-button" onClick={() => openEntity(entityRef(target))}>{value}</button>;
    return <FilterValue id={filterId} value={value} />;
  };
  const OwnerLink = ({ e }) => {
    const ref = (e.relations ?? []).find((r) => r.type === "ownedBy")?.targetRef;
    return ref ? <EntityLink entities={entities} refText={ref} /> : <span>{ownerLabel(e, entities)}</span>;
  };

  return (
    <section className="module-page">
      <div className="module-heading">
        <div>
          <span className="module-eyebrow">CATÁLOGO</span>
          <h1>Catálogo</h1>
          <p>Todas las entidades registradas en Backstage: componentes, APIs, recursos, divisiones, dominios / torres y productos / sistemas.</p>
        </div>
      </div>

      <div className="homologation-stats">
        {KINDS.map((k) => (
          <div className="homologation-stat" key={k}>
            <span>{KIND_LABEL[k]}</span>
            <strong>{entities.filter(ofTab(k)).length}</strong>
          </div>
        ))}
      </div>

      <div className="module-panel">
        <div className="homologation-tabs">
          {KINDS.map((k) => (
            <button key={k} className={kind === k ? "selected" : ""} onClick={() => changeKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
          <button className={kind === "graph" ? "selected" : ""} onClick={() => setKind("graph")}>Grafo</button>
        </div>

        {kind !== "graph" && (
          <>
            <div className="pipeline-toolbar">
              <div className="search-input-wrapper">
                <Search size={16} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, descripción o etiqueta..." />
              </div>
              {categories.length > 0 && <button
                className={`catalog-filter-button${showFilters ? " open" : ""}`}
                onClick={() => setShowFilters(!showFilters)}
                aria-expanded={showFilters}
                data-testid="filter-button"
              >
                <Filter size={16} /> Filtros{active.length ? ` (${active.length})` : ""}
              </button>}
              <button className="refresh-module-button" onClick={loader.reload} disabled={loader.loading} title="Actualizar información">
                <RefreshCw size={16} className={loader.loading ? "spin" : ""} />
              </button>
            </div>
            {showFilters && categories.length > 0 && <FilterPanel categories={categories} options={options} filters={filters} onToggle={toggle} />}
            {active.length > 0 && (
              <div className="catalog-filter-chips" data-testid="filter-chips">
                {active.map(([c, v]) => (
                  <button key={`${c.id}:${v}`} className="catalog-filter-chip" onClick={() => toggle(c.id, v)} title="Quitar filtro">
                    <span>{c.label}:</span> {v} <X size={12} />
                  </button>
                ))}
                <button className="link-button" onClick={() => setFilters({})}>Limpiar filtros</button>
              </div>
            )}
          </>
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
        ) : (
          <div className="table-wrapper">
            <table className="pool-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  {!grouping && <th>Tipo</th>}
                  {kind !== "Division" && <th>División</th>}
                  {classified && (
                    <>
                      <th>Dominio / Torre</th>
                      <th>Producto / Sistema</th>
                      <th>Legado</th>
                      <th>Crítico</th>
                    </>
                  )}
                  {grouping && <th>Componentes</th>}
                  {!grouping && <th>Etiquetas</th>}
                  <th>Descripción</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={9} className="empty-table">{loader.loading ? "Consultando información..." : "Sin entidades."}</td></tr>
                )}
                {rows.map((e) => {
                  const c = classification(e);
                  const members = grouping ? componentsOf(e, entities) : [];
                  const value = annotation(e, "devops.lab/classification-value") ?? e.metadata.title ?? e.metadata.name;
                  return (
                    <tr key={entityRef(e)}>
                      <td><button className="link-button" onClick={() => openEntity(entityRef(e))}>{displayName(e)}</button></td>
                      {!grouping && <td><FilterValue id="type" value={typeLabel(e.spec?.type)} /></td>}
                      {kind !== "Division" && <td><OwnerLink e={e} /></td>}
                      {classified && (
                        <>
                          <td><ClassificationLink entityKind="Domain" value={c.division} filterId="division" /></td>
                          <td><ClassificationLink entityKind="System" value={c.initiative} filterId="initiative" /></td>
                          <td><FilterValue id="legacy" value={c.legacy}><LegacyValue value={c.legacy} /></FilterValue></td>
                          <td><FilterValue id="critical" value={c.critical}><CriticalValue value={c.critical} /></FilterValue></td>
                        </>
                      )}
                      {grouping && (
                        <td>
                          {members.length ? (
                            <button
                              className="link-button"
                              title="Ver estos componentes"
                              onClick={() =>
                                changeKind("Component", kind === "Division" ? { owner: [ownerLabel({ spec: { owner: entityRef(e) } }, entities)] } : { [kind === "Domain" ? "division" : "initiative"]: [value] })
                              }
                            >
                              {members.length}
                            </button>
                          ) : "0"}
                        </td>
                      )}
                      {!grouping && (
                        <td className="tag-cell">
                          {(e.metadata.tags ?? []).slice(0, 4).map((t) => (
                            <button key={t} className="link-button tag-link" onClick={() => only("tags", t)}>{t}</button>
                          ))}
                        </td>
                      )}
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
          ["Tipo", typeLabel(entity.spec?.type)],
          ["Ciclo de vida", entity.spec?.lifecycle],
          ["División", ownerRef ? <EntityLink entities={entities} refText={ownerRef} /> : ownerLabel(entity, entities)],
          ["Dominio / Torre", c.division && <ClassificationRef entities={entities} kind="Domain" value={c.division} />],
          ["Producto / Sistema", c.initiative && <ClassificationRef entities={entities} kind="System" value={c.initiative} />],
          ["Legado", c.legacy && <LegacyValue value={c.legacy} />],
          ["Crítico", c.critical && <CriticalValue value={c.critical} />],
          ["Sistema", partOf.length && !c.initiative ? partOf.map((ref) => <EntityLink key={ref} entities={entities} refText={ref} />) : undefined],
          ["Namespace", m.namespace ?? "default"],
          ["Etiquetas", (m.tags ?? []).join(", ")],
          ["Descripción", m.description]
        ]}
      />

      {(entity.kind === "Domain" || entity.kind === "System" || isDivision(entity)) && <MemberComponents entity={entity} entities={entities} />}

      {(links.length > 0 || annotation(entity, "backstage.io/view-url")) && (
        <div className="panel-block">
          <strong>Enlaces</strong>
          <div className="task-links">
            {annotation(entity, "backstage.io/view-url") && (
              <ExternalA href={annotation(entity, "backstage.io/view-url").replace(/\?path=.*/, "")}>Repositorio</ExternalA>
            )}
            {links.map((link) => <ExternalA key={link.url} href={link.url}>{link.title ?? link.url}</ExternalA>)}
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

/** Dominio / Torre o Producto / Sistema de un componente: enlace a su ficha si existe en el catálogo. */
function ClassificationRef({ entities, kind, value }) {
  const { openEntity } = useNav();
  const target = classificationEntity(entities, kind, value);
  return target ? <button className="link-button" onClick={() => openEntity(entityRef(target))}>{value}</button> : <span>{value}</span>;
}

/** Componentes que pertenecen a una División, a un Dominio / Torre o a un Producto / Sistema. */
function MemberComponents({ entity, entities }) {
  const { openEntity } = useNav();
  const members = componentsOf(entity, entities);
  return (
    <div className="panel-block" data-testid="member-components">
      <strong>Componentes ({members.length})</strong>
      <div className="table-wrapper">
        <table className="pool-table">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>División</th><th>Descripción</th></tr></thead>
          <tbody>
            {members.length === 0 && <tr><td colSpan="4" className="empty-table">Ningún componente pertenece todavía.</td></tr>}
            {members.map((e) => (
              <tr key={entityRef(e)}>
                <td><button className="link-button" onClick={() => openEntity(entityRef(e))}>{e.metadata.title ?? e.metadata.name}</button></td>
                <td>{typeLabel(e.spec?.type) ?? "—"}</td>
                <td>{ownerLabel(e, entities)}</td>
                <td>{e.metadata.description ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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

/** Convierte una página generada por MkDocs en contenido seguro: solo el artículo, sin scripts, con enlaces e imágenes reescritos. */
function parseDocPage(html, base, currentPath) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const article = doc.querySelector("article");
  const nav = [];
  const seen = new Set();
  doc.querySelectorAll("nav.md-nav--primary a.md-nav__link").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (!href || href.startsWith("#") || /^[a-z]+:/i.test(href) || seen.has(href)) return;
    seen.add(href);
    nav.push({ title: a.textContent.trim(), path: resolveDocPath(currentPath, href) });
  });
  const clean = DOMPurify.sanitize(article ? article.innerHTML : "", {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"]
  });
  // Documento inerte: un <div> desacoplado ya empezaría a descargar las imágenes (también las externas que se quitan abajo).
  const holder = new DOMParser().parseFromString(`<body>${clean}</body>`, "text/html").body;
  holder.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (/^[a-z]+:|^\/\//i.test(src)) img.remove();
    else img.setAttribute("src", base + resolveDocPath(currentPath, src));
  });
  holder.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (href.startsWith("#")) return;
    if (/^https?:/i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else if (!/^[a-z]+:/i.test(href)) {
      a.setAttribute("data-doc-path", resolveDocPath(currentPath, href.split("#")[0]));
      a.setAttribute("href", "#");
    } else {
      a.removeAttribute("href");
    }
  });
  return { html: holder.innerHTML, nav };
}

/** Resuelve un enlace relativo de MkDocs ("../despliegue/", "despliegue/") contra la página actual; devuelve una ruta tipo "despliegue/". */
function resolveDocPath(currentPath, href) {
  const parts = currentPath.split("/").filter(Boolean);
  for (const seg of href.split("#")[0].split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else if (/\.html?$/i.test(seg)) { if (seg !== "index.html") parts.push(seg.replace(/\.html?$/i, "")); }
    else parts.push(seg);
  }
  return parts.length ? `${parts.join("/")}/` : "";
}

function DocsViewer({ namespace, name }) {
  const [path, setPath] = React.useState("");
  const base = techdocs.staticBase(namespace, name);
  const page = useAsync(() => techdocs.page(namespace, name, path), [namespace, name, path]);
  const parsed = React.useMemo(
    () => (typeof page.data === "string" ? parseDocPage(page.data, base, path) : null),
    [page.data, base, path]
  );
  const onClick = (event) => {
    const link = event.target.closest?.("a[data-doc-path]");
    if (!link) return;
    event.preventDefault();
    setPath(link.getAttribute("data-doc-path"));
  };

  if (page.loading && !parsed) return <Loading />;
  if (page.error) return <Notice>No se pudo leer esta página de la documentación ({String(page.error.message ?? page.error)}).</Notice>;
  if (!parsed) return null;
  return (
    <div className="techdocs">
      {parsed.nav.length > 1 && (
        <nav className="techdocs-nav" aria-label="Páginas de la documentación">
          {parsed.nav.map((item) => (
            <button key={item.path || "inicio"} className={item.path === path ? "selected" : ""} onClick={() => setPath(item.path)}>
              {item.title}
            </button>
          ))}
        </nav>
      )}
      <div className="techdocs-content" onClick={onClick} dangerouslySetInnerHTML={{ __html: parsed.html }} />
    </div>
  );
}

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
        <Notice>La documentación está configurada pero aún no se ha publicado. Se genera y publica cada hora desde el repositorio del componente (debe tener mkdocs.yml).</Notice>
      ) : (
        <>
          <Notice>Documentación publicada{state.data?.build_timestamp ? ` (generada ${formatDate(state.data.build_timestamp)})` : ""}.</Notice>
          <DocsViewer namespace={entity.metadata.namespace ?? "default"} name={entity.metadata.name} />
        </>
      )}
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
          <span className="module-eyebrow">{kindName(entity).toUpperCase()}{entity.spec?.type ? ` · ${typeLabel(entity.spec.type)}` : ""}</span>
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
              <small>{kindName(e)}{e.spec?.type ? ` · ${typeLabel(e.spec.type)}` : ""}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
