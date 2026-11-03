import React from "react";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  ExternalLink,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  ArrowLeft
} from "lucide-react";

import {
  PROJECT,
  access,
  branching,
  catalog,
  homologation,
  rm,
  scaffolder,
  scorecards,
  annotation,
  formatDate,
  isDeployable,
  repoOf
} from "./backstage";
import { TemplateButton } from "./TemplateRunner";
import { useNav } from "./nav";
import { PipelineStatus, Percent } from "./status";
import { ownerLabel } from "./catalog";
import { csvBlob, download, xlsxBlob } from "./export";

/*
 * Páginas de GRAVITY alimentadas por Backstage. Cada una reutiliza las clases de App.css (module-page, module-panel,
 * homologation-stat, pool-table…) para conservar el aspecto del portal.
 */

/* ------------------------------------------------------------- Utilidades */

/** Carga datos al montar, con recarga manual y automática. */
function useData(loader, { interval = 0 } = {}) {
  const [state, setState] = React.useState({ loading: true, data: undefined, error: "", updated: null });
  const loaderRef = React.useRef(loader);
  loaderRef.current = loader;

  const reload = React.useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const data = await loaderRef.current();
      setState({ loading: false, data, error: "", updated: new Date() });
    } catch (err) {
      setState((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, []);

  React.useEffect(() => {
    reload();
    if (!interval) {
      return undefined;
    }
    const timer = setInterval(reload, interval);
    return () => clearInterval(timer);
  }, [reload, interval]);

  return { ...state, reload };
}

const STATUS = {
  homologado: ["Homologado", "homologation-approved"],
  pendiente: ["Pendiente", "homologation-pending"],
  "en-revision": ["En revisión", "homologation-review"],
  conforme: ["Conforme", "homologation-approved"],
  incompleto: ["Incompleto", "homologation-pending"],
  "sin-version": ["Sin versión", "homologation-review"]
};

function StatusBadge({ status }) {
  const [text, className] = STATUS[status] ?? [status ?? "—", "homologation-review"];
  return <span className={className}>{text}</span>;
}

function Heading({ eyebrow, title, description, actions }) {
  return (
    <div className="module-heading">
      <div>
        <span className="module-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="pipeline-header-actions">{actions}</div>}
    </div>
  );
}

function Stats({ items }) {
  return (
    <div className="homologation-stats">
      {items.map(([label, value]) => (
        <div className="homologation-stat" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function Refresh({ loader }) {
  return (
    <button className="refresh-module-button" onClick={loader.reload} disabled={loader.loading} title="Actualizar información">
      <RefreshCw size={16} className={loader.loading ? "spin" : ""} />
    </button>
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

function Footer({ loader, source }) {
  return (
    <div className="module-footer-info">
      <span>
        Última actualización: {loader.updated ? loader.updated.toLocaleTimeString("es-MX") : "Sin actualización"}
      </span>
      <span>{source}</span>
    </div>
  );
}

function EmptyRow({ colSpan, loading, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="empty-table">
        {loading ? (
          <>
            <Loader2 size={18} className="spin" /> Consultando información...
          </>
        ) : (
          children
        )}
      </td>
    </tr>
  );
}

function Link({ href, children }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="inline-link">
      {children} <ExternalLink size={11} />
    </a>
  ) : (
    <>{children}</>
  );
}

function runLink(run) {
  return run?.url ? <Link href={run.url}>{run.number ?? run.id}</Link> : "—";
}

/* ------------------------------------------------------------ Homologation */

const HOMOLOGATION_STATUS = ["Todos", "Homologado", "Pendiente", "En revisión"];
const STATUS_ID = { Homologado: "homologado", Pendiente: "pendiente", "En revisión": "en-revision" };

function List({ items }) {
  return <ul className="requirements-list">{items.map((t) => <li key={t}>{t}</li>)}</ul>;
}

/** Normaliza los requisitos (la respuesta puede llegar incompleta con un backend antiguo o tras un error). */
function normalizeRequirements(raw) {
  if (!raw || typeof raw !== "object" || !raw.infrastructure || !raw.components) return null;
  return {
    governance: raw.governance && typeof raw.governance === "object" ? raw.governance : null,
    infrastructure: {
      environments: raw.infrastructure.environments ?? [],
      optionalEnvironments: raw.infrastructure.optionalEnvironments ?? [],
      perResource: raw.infrastructure.perResource ?? [],
      betweenEnvironments: raw.infrastructure.betweenEnvironments ?? []
    },
    components: {
      environments: raw.components.environments ?? [],
      deployment: raw.components.deployment ?? [],
      technologies: raw.components.technologies ?? []
    }
  };
}

const technologyRule = (c) =>
  `${c.title}${c.required ? "" : " (informativo)"}: aprobadas ${c.approved.join(", ") || "—"}${c.review.length ? ` · en revisión ${c.review.join(", ")}` : ""}`;

/** Todas las reglas de homologación en filas planas: [ámbito, grupo, regla]. Se usa en la pestaña Requisitos y al exportar. */
function requirementRows(r) {
  if (!r) return [];
  const rows = [];
  for (const x of r.infrastructure.perResource) for (const rule of x.rules) rows.push(["Infraestructura", `Política de versiones · ${x.type}`, rule]);
  const order = `Orden de los ambientes: ${r.infrastructure.environments.join(" → ") || "—"}${r.infrastructure.optionalEnvironments.length ? ` (opcionales mientras no existan: ${r.infrastructure.optionalEnvironments.join(", ")})` : ""}.`;
  rows.push(["Infraestructura", "Entre ambientes", order]);
  for (const g of r.infrastructure.betweenEnvironments) rows.push(["Infraestructura", `Entre ambientes · ${g.title}`, g.rule ?? `Debe tener ${g.compares} igual en todos los ambientes.`]);
  for (const d of r.components.deployment) rows.push(["Componentes", `Despliegue entre ambientes (${r.components.environments.join(" → ")})`, d]);
  for (const t of r.components.technologies) for (const c of t.checks) rows.push(["Componentes", `Línea base · ${t.title} (se detecta por ${t.detect})`, technologyRule(c)]);
  return rows;
}

/**
 * Requisitos agrupados como filas de tabla (igual que Infraestructura y Componentes): cada grupo es una política, una
 * comparación entre ambientes, las reglas de despliegue o la línea base de una tecnología, con sus reglas al desplegarlo.
 */
function requirementGroups(r) {
  if (!r) return [];
  const infraOrder = r.infrastructure.environments.join(" → ") || "—";
  const optional = r.infrastructure.optionalEnvironments.length
    ? `Opcionales mientras no existan: ${r.infrastructure.optionalEnvironments.join(", ")}.`
    : null;
  return [
    ...r.infrastructure.perResource.map((x, i) => ({
      id: `politica-${i}`,
      scope: "Infraestructura",
      kind: "Política de versiones",
      title: x.type,
      appliesTo: x.environment ?? "Todos los ambientes",
      summary: x.rules[0] ?? "—",
      rules: x.rules.map((text) => ({ text }))
    })),
    ...r.infrastructure.betweenEnvironments.map((g) => ({
      id: `paridad-${g.id ?? g.title}`,
      scope: "Infraestructura",
      kind: "Entre ambientes",
      title: g.title,
      appliesTo: infraOrder,
      summary: g.rule ?? `Debe tener ${g.compares} igual en todos los ambientes.`,
      rules: [
        { text: `Compara ${g.compares} de los recursos del grupo en cada ambiente.` },
        { text: g.rule ?? `Debe tener ${g.compares} igual en todos los ambientes.` },
        { text: `Orden de comparación: ${infraOrder}.` },
        ...(optional ? [{ text: optional }] : [])
      ]
    })),
    ...(r.components.deployment.length
      ? [{
          id: "despliegue",
          scope: "Componentes",
          kind: "Despliegue",
          title: "Despliegue entre ambientes",
          appliesTo: r.components.environments.join(" → ") || "—",
          summary: r.components.deployment[0],
          rules: r.components.deployment.map((text) => ({ text }))
        }]
      : []),
    ...r.components.technologies.map((t) => ({
      id: `tecnologia-${t.id}`,
      scope: "Componentes",
      kind: "Línea base",
      title: t.title,
      appliesTo: `Componentes con ${t.detect}`,
      summary: t.checks.map((c) => `${c.title}: ${c.approved.join(", ") || "—"}`).join(" · ") || "—",
      rules: t.checks.map((c) => ({ text: c.title, required: c.required, approved: c.approved, review: c.review }))
    }))
  ];
}

const REQUIREMENT_SCOPES = ["Todos los ámbitos", "Infraestructura", "Componentes"];

/** Reglas de un grupo desplegado: frases o, en la línea base, versiones aprobadas y en revisión por tecnología. */
function RequirementDetail({ group }) {
  return (
    <div className="reference-detail requirement-detail">
      <strong>{group.kind} · {group.title}</strong>
      <ul className="check-list">
        {group.rules.map((rule) => (
          <li key={rule.text}>
            {rule.approved ? (
              <>
                <span className={`check-badge ${rule.required ? "check-info" : "check-neutral"}`}>{rule.required ? "Obligatorio" : "Informativo"}</span>
                <span className="requirement-versions">
                  <strong>{rule.text}</strong>
                  <span className="version-chips">
                    {rule.approved.map((v) => <span className="version-chip version-ok" key={`a-${v}`} title="Aprobada">{v}</span>)}
                    {rule.review.map((v) => <span className="version-chip version-review" key={`r-${v}`} title="En revisión: aún válida, hay que planear la salida">{v}</span>)}
                    {rule.approved.length + rule.review.length === 0 && <span className="status-text status-none">Sin versiones aprobadas</span>}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className="check-badge check-info">Regla</span>
                <span>{rule.text}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      {group.kind === "Línea base" && (
        <p className="requirement-legend">
          <span className="version-chip version-ok">aprobada</span> se homologa ·
          <span className="version-chip version-review">en revisión</span> aún válida, hay que planear la salida · cualquier otra queda pendiente.
        </p>
      )}
    </div>
  );
}

/** Pestaña Requisitos: todas las reglas de homologación, de infraestructura y de componentes. */
function RequirementsView({ loader, groups }) {
  const [search, setSearch] = React.useState("");
  const [scope, setScope] = React.useState(REQUIREMENT_SCOPES[0]);
  const [expanded, setExpanded] = React.useState(() => new Set());
  const toggle = (id) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const governance = normalizeRequirements(loader.data)?.governance;
  const filtered = groups.filter((g) => {
    const text = `${g.title} ${g.kind} ${g.appliesTo} ${g.rules.map((r) => `${r.text} ${(r.approved ?? []).join(" ")}`).join(" ")}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (scope === REQUIREMENT_SCOPES[0] || g.scope === scope);
  });

  return (
    <div className="requirements-view">
      <div className="homologation-toolbar">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar requisito, tecnología o versión..." />
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          {REQUIREMENT_SCOPES.map((option) => <option key={option}>{option}</option>)}
        </select>
        <Refresh loader={loader} />
      </div>

      <ErrorBox message={loader.error && `No fue posible consultar los requisitos. ${loader.error}`} />

      <div className="table-wrapper">
        <table className="pool-table requirements-table">
          <thead>
            <tr>
              <th>Requisito</th>
              <th>Ámbito</th>
              <th>Tipo</th>
              <th>Se aplica a</th>
              <th>Criterio</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <EmptyRow colSpan={5} loading={loader.loading && !loader.data}>
                {groups.length === 0 ? "No hay requisitos configurados." : "Ningún requisito coincide con la búsqueda."}
              </EmptyRow>
            )}
            {filtered.map((g) => {
              const open = expanded.has(g.id);
              return (
                <React.Fragment key={g.id}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        className="reference-toggle"
                        aria-expanded={open}
                        title={open ? "Ocultar las reglas" : "Ver todas las reglas"}
                        onClick={() => toggle(g.id)}
                      >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span>{g.title}</span>
                      </button>
                    </td>
                    <td><span className={`scope-badge scope-${g.scope === "Infraestructura" ? "infra" : "comp"}`}>{g.scope}</span></td>
                    <td>{g.kind}</td>
                    <td>{g.appliesTo}</td>
                    <td className="wrap">
                      {g.summary}
                      {g.rules.length > 1 && <small className="check-count"> · {g.rules.length} reglas</small>}
                    </td>
                  </tr>
                  {open && (
                    <tr className="reference-row">
                      <td colSpan={5}><RequirementDetail group={g} /></td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {governance?.detail && <p className="requirements-governance">{governance.detail}</p>}
    </div>
  );
}

const CHECK_LABEL = { cumple: ["Cumple", "check-ok"], "no-cumple": ["No cumple", "check-fail"], "en-revision": ["En revisión", "check-review"] };
const checksOf = (item) => (Array.isArray(item?.checks) ? item.checks.filter((c) => c && typeof c.title === "string") : []);

/** Detalle desplegable de un registro: qué requisitos cumple y cuáles no, y contra qué se mide. */
function HomologationDetail({ item }) {
  const checks = checksOf(item);
  const reference = referenceOf(item);
  return (
    <div className="reference-detail">
      <strong>Qué cumple y qué no</strong>
      {checks.length === 0 ? (
        <p>{item.reason ?? "Sin detalle."}</p>
      ) : (
        <ul className="check-list">
          {checks.map((c) => {
            const [label, className] = CHECK_LABEL[c.result] ?? [c.result, "check-review"];
            return (
              <li key={c.title}>
                <span className={`check-badge ${className}`}>{label}</span>
                <span><strong>{c.title}.</strong> {c.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
      {reference && (
        <>
          <strong>{REFERENCE_KIND[reference.kind] ?? "Referencia"}</strong>
          {reference.sections.map((section) => (
            <div key={section.title}>
              <h5>{section.title}</h5>
              <List items={section.items} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const STATUS_TEXT = { homologado: "Homologado", pendiente: "Pendiente", "en-revision": "En revisión" };
const EXPORT_COLUMNS = ["Categoría", "Elemento", "Tipo", "Versión", "Ambiente", "Estado", "Cumple", "No cumple", "En revisión", "Homologado con", "Descripción"];

/** Una fila por registro para exportar, con los requisitos agrupados por resultado. */
function exportRow(item) {
  const checks = checksOf(item);
  const by = (result) => checks.filter((c) => c.result === result).map((c) => `${c.title}: ${c.detail}`).join(" | ");
  return [
    item.category === "infraestructura" ? "Infraestructura" : "Componentes",
    item.name,
    item.type,
    item.version ?? "",
    item.environment,
    STATUS_TEXT[item.status] ?? item.status,
    by("cumple"),
    checks.length ? by("no-cumple") : item.status === "homologado" ? "" : (item.reason ?? ""),
    by("en-revision"),
    referenceOf(item)?.summary ?? "",
    item.description ?? ""
  ];
}

const REFERENCE_KIND = { politica: "Política de versiones", "linea-base": "Línea base de la tecnología", paridad: "Entre ambientes" };

/** Normaliza la referencia que entrega Backstage (puede faltar o venir incompleta con un backend antiguo). */
function referenceOf(item) {
  const r = item?.reference;
  if (!r || typeof r !== "object" || typeof r.summary !== "string") return null;
  const sections = Array.isArray(r.sections)
    ? r.sections
        .filter((s) => s && typeof s.title === "string")
        .map((s) => ({ title: s.title, items: Array.isArray(s.items) ? s.items.map(String) : [] }))
    : [];
  return { kind: r.kind, summary: r.summary, sections };
}

/** Celda «Homologado con»: contra qué se mide el elemento, con un botón para desplegar el detalle. */

/** Ventana desplegable bajo la fila: la política, la línea base o la comparación entre ambientes con la que se mide. */

export function HomologationPage() {
  const [tab, setTab] = React.useState("infraestructura");
  const [expanded, setExpanded] = React.useState(() => new Set());
  const toggle = (id) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("Todos");
  const loader = useData(() => homologation.items(), { interval: 60000 });
  const requirements = useData(() => homologation.requirements(), { interval: 300000 });

  const items = loader.data?.items ?? [];
  const records = items.filter((item) => (tab === "infraestructura" ? item.category === "infraestructura" : item.category === "componente"));
  const filtered = records.filter((item) => {
    const text = `${item.name} ${item.type} ${item.version ?? ""} ${item.environment}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (status === "Todos" || item.status === STATUS_ID[status]);
  });
  const groups = requirementGroups(normalizeRequirements(requirements.data));

  const fecha = new Date().toISOString().slice(0, 10);
  const exportar = (format) => {
    const rows = items.map(exportRow);
    if (format === "csv") {
      download(csvBlob({ columns: EXPORT_COLUMNS, rows }), `homologacion-${fecha}.csv`);
      return;
    }
    const checks = items.flatMap((item) =>
      checksOf(item).map((c) => [item.category === "infraestructura" ? "Infraestructura" : "Componentes", item.name, item.environment, c.title, CHECK_LABEL[c.result]?.[0] ?? c.result, c.detail])
    );
    download(
      xlsxBlob([
        { name: "Homologación", columns: EXPORT_COLUMNS, rows },
        { name: "Comprobaciones", columns: ["Categoría", "Elemento", "Ambiente", "Requisito", "Resultado", "Detalle"], rows: checks },
        { name: "Requisitos", columns: ["Ámbito", "Grupo", "Regla"], rows: requirementRows(normalizeRequirements(requirements.data)) }
      ]),
      `homologacion-${fecha}.xlsx`
    );
  };

  return (
    <section className="module-page">
      <Heading
        eyebrow="HOMOLOGACIÓN"
        title="Homologation Status"
        description="Estado de homologación de infraestructura (GCP) y de los componentes: línea base tecnológica y paridad entre ambientes."
        actions={
          <div className="export-actions">
            <button type="button" className="create-button" disabled={!items.length} onClick={() => exportar("xlsx")}>Exportar Excel</button>
            <button type="button" className="create-button" disabled={!items.length} onClick={() => exportar("csv")}>Exportar CSV</button>
          </div>
        }
      />

      <Stats
        items={
          tab === "requisitos"
            ? [
                ["Requisitos", groups.length],
                ["De infraestructura", groups.filter((g) => g.scope === "Infraestructura").length],
                ["De componentes", groups.filter((g) => g.scope === "Componentes").length],
                ["Reglas", groups.reduce((n, g) => n + g.rules.length, 0)]
              ]
            : [
                ["Elementos registrados", records.length],
                ["Homologados", records.filter((x) => x.status === "homologado").length],
                ["Pendientes", records.filter((x) => x.status === "pendiente").length],
                ["En revisión", records.filter((x) => x.status === "en-revision").length]
              ]
        }
      />

      <div className="module-panel">
        <div className="homologation-tabs">
          <button className={tab === "infraestructura" ? "selected" : ""} onClick={() => setTab("infraestructura")}>Infraestructura</button>
          <button className={tab === "componentes" ? "selected" : ""} onClick={() => setTab("componentes")}>Componentes</button>
          <button className={tab === "requisitos" ? "selected" : ""} onClick={() => setTab("requisitos")}>Requisitos</button>
        </div>

        {tab === "requisitos" ? (
          <RequirementsView loader={requirements} groups={groups} />
        ) : (
          <>
            <div className="homologation-toolbar">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar elemento..." />
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {HOMOLOGATION_STATUS.map((option) => <option key={option}>{option}</option>)}
              </select>
              <Refresh loader={loader} />
            </div>

            <ErrorBox message={loader.error && `No fue posible consultar la homologación. ${loader.error}`} />
            {(loader.data?.warnings ?? []).map((warning) => (
              <div className="module-error" key={warning}><AlertTriangle size={16} />{warning}</div>
            ))}

            <div className="table-wrapper">
              <table className="pool-table">
                <thead>
                  <tr>
                    <th>Elemento</th>
                    <th>Versión / Tipo</th>
                    <th>Ambiente</th>
                    <th>Estado</th>
                    <th>Homologado con</th>
                    <th>Descripción</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <EmptyRow colSpan={6} loading={loader.loading && !loader.data}>No hay información disponible.</EmptyRow>
                  )}
                  {filtered.map((item) => {
                    const open = expanded.has(item.id);
                    const checks = checksOf(item);
                    const failing = checks.filter((c) => c.result !== "cumple").length;
                    return (
                      <React.Fragment key={item.id}>
                        <tr>
                          <td>
                            <button
                              type="button"
                              className="reference-toggle"
                              aria-expanded={open}
                              title={open ? "Ocultar el detalle" : "Ver qué cumple y qué no"}
                              onClick={() => toggle(item.id)}
                            >
                              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span>{item.name}</span>
                            </button>
                          </td>
                          <td>{[item.type, item.version].filter(Boolean).join(" · ")}</td>
                          <td>{item.environment}</td>
                          <td>
                            <StatusBadge status={item.status} />
                            {checks.length > 0 && <small className="check-count">{failing ? ` ${failing} de ${checks.length} sin cumplir` : ` ${checks.length} de ${checks.length} cumplidos`}</small>}
                          </td>
                          <td className="wrap">{referenceOf(item)?.summary ?? <span className="status-text status-none">—</span>}</td>
                          <td>{item.description ?? "—"}</td>
                        </tr>
                        {open && (
                          <tr className="reference-row">
                            <td colSpan={6}><HomologationDetail item={item} /></td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Footer loader={tab === "requisitos" ? requirements : loader} source={tab === "requisitos" ? "Backstage · /api/homologation/requirements" : "Backstage · /api/homologation"} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Repositories */

export function RepositoriesPage() {
  const { openEntity } = useNav();
  const loader = useData(async () => {
    const [components, groups, rules, parity, baseline] = await Promise.all([
      catalog.components(),
      catalog.groups().catch(() => []),
      branching.rules(),
      homologation.components().catch(() => ({ items: [] })),
      homologation.baseline().catch(() => ({ items: [] }))
    ]);
    return { components, groups, rules, parity: parity.items, baseline: baseline.items };
  }, { interval: 60000 });
  const [search, setSearch] = React.useState("");

  const { components = [], groups = [], rules, parity = [], baseline = [] } = loader.data ?? {};
  const rows = components
    .filter((entity) => annotation(entity, "dev.azure.com/project-repo"))
    .filter((entity) => entity.metadata.name.toLowerCase().includes(search.toLowerCase()))
    .map((entity) => {
      const name = entity.metadata.name;
      const repo = repoOf(entity);
      return {
        entity,
        name,
        repo,
        level: rules?.repositoryLevels?.[repo] ?? rules?.defaultLevel ?? "—",
        parity: parity.find((p) => p.component === name),
        baseline: baseline.find((b) => b.component === name)
      };
    });

  return (
    <section className="module-page">
      <Heading
        eyebrow="CÓDIGO"
        title="Repositories"
        description="Componentes del catálogo con su repositorio de Azure DevOps, nivel de criticidad, línea base y estado de despliegue."
        actions={<TemplateButton template="crear-rama" label="Crear rama" className="create-button" onFinished={loader.reload} />}
      />

      <Stats
        items={[
          ["Repositorios", rows.length],
          ["Con línea base conforme", rows.filter((r) => r.baseline?.status === "conforme").length],
          ["Nivel core", rows.filter((r) => r.level === "core").length],
          ["Golden Path", rows.filter((r) => annotation(r.entity, "devops.lab/golden-path")).length]
        ]}
      />

      <div className="module-panel">
        <div className="pipeline-toolbar">
          <div className="search-input-wrapper">
            <Search size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar repositorio..." />
          </div>
          <Refresh loader={loader} />
        </div>
        <ErrorBox message={loader.error && `No fue posible consultar el catálogo. ${loader.error}`} />

        <div className="table-wrapper">
          <table className="pool-table">
            <thead>
              <tr>
                <th>Componente</th>
                <th>Tipo</th>
                <th>División</th>
                <th>Nivel</th>
                <th>Línea base</th>
                <th>Paridad</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={7} loading={loader.loading && !loader.data}>No hay repositorios registrados.</EmptyRow>}
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>
                    <button className="link-button" onClick={() => openEntity(`component:default/${row.name}`)}>{row.entity.metadata.title ?? row.name}</button>
                  </td>
                  <td>{row.entity.spec?.type ?? "—"}</td>
                  <td>{ownerLabel(row.entity, groups)}</td>
                  <td>{row.level}</td>
                  <td>{row.baseline ? <StatusBadge status={row.baseline.status === "conforme" ? "homologado" : "en-revision"} /> : "—"}</td>
                  <td>{row.parity ? <StatusBadge status={row.parity.status} /> : "—"}</td>
                  <td className="row-actions">
                    <TemplateButton template="integrar-cambios" preset={{ component: row.name }} label="Integrar" onFinished={loader.reload} />
                    <TemplateButton template="crear-rama" preset={{ component: row.name }} label="Rama" onFinished={loader.reload} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Footer loader={loader} source="Backstage · catálogo + Azure DevOps" />
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Pipelines */

export function PipelinesPage() {
  const loader = useData(() => branching.pipelines(), { interval: 30000 });
  const [search, setSearch] = React.useState("");
  const pipelines = (loader.data?.pipelines ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  const all = loader.data?.pipelines ?? [];
  const runs = all.reduce((sum, p) => sum + p.executions, 0);
  const succeeded = all.reduce((sum, p) => sum + p.succeeded, 0);

  return (
    <section className="module-page">
      <Heading
        eyebrow="AUTOMATIZACIÓN"
        title="Pipelines"
        description="Pipelines de Azure DevOps del proyecto, su última ejecución y el porcentaje de éxito."
      />
      <Stats
        items={[
          ["Pipelines", all.length],
          ["Ejecuciones", runs],
          ["Tasa de éxito", <Percent key="rate" value={runs ? Math.round((succeeded / runs) * 100) : null} />],
          ["Última ejecución fallida", <span key="failed" className={all.some((p) => p.status === "Fallida") ? "status-text status-failed" : ""}>{all.filter((p) => p.status === "Fallida").length}</span>]
        ]}
      />
      <div className="module-panel">
        <div className="pipeline-toolbar">
          <div className="search-input-wrapper">
            <Search size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pipeline..." />
          </div>
          <Refresh loader={loader} />
        </div>
        <ErrorBox message={loader.error && `No fue posible consultar los pipelines. ${loader.error}`} />
        <div className="table-wrapper">
          <table className="pool-table">
            <thead>
              <tr>
                <th>Pipeline</th>
                <th>Tipo</th>
                <th>Ambiente</th>
                <th>Rama</th>
                <th>Estado</th>
                <th>Última ejecución</th>
                <th>Ejecuciones</th>
                <th>Éxito</th>
              </tr>
            </thead>
            <tbody>
              {pipelines.length === 0 && <EmptyRow colSpan={8} loading={loader.loading && !loader.data}>No hay pipelines disponibles.</EmptyRow>}
              {pipelines.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.type}</td>
                  <td>{p.environment}</td>
                  <td>{p.branch}</td>
                  <td><PipelineStatus status={p.status} /></td>
                  <td>{runLink(p.lastRun)} <small>{formatDate(p.lastRun?.finishedAt ?? p.lastRun?.startedAt)}</small></td>
                  <td>{p.executions}</td>
                  <td><Percent value={p.executions ? Math.round((p.succeeded / p.executions) * 100) : null} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Footer loader={loader} source="Backstage · /api/branching/pipelines" />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Releases */

export function ReleasesPage() {
  const loader = useData(async () => {
    const [parity, components] = await Promise.all([homologation.components(), catalog.components().catch(() => [])]);
    // El plugin de homologación devuelve el identificador del componente; se muestra su nombre visible si lo tiene.
    const titles = Object.fromEntries(components.filter((c) => c.metadata.title).map((c) => [c.metadata.name, c.metadata.title]));
    return { ...parity, items: parity.items.map((item) => ({ ...item, label: titles[item.component] ?? item.component })) };
  }, { interval: 60000 });
  const environments = loader.data?.environments ?? ["develop", "qa", "staging", "produccion"];
  const items = loader.data?.items ?? [];

  return (
    <section className="module-page">
      <Heading
        eyebrow="ENTREGA"
        title="Releases"
        description="Qué versión está desplegada en cada ambiente, con su commit y ejecución. Desde aquí se despliega y se hace rollback."
        actions={<TemplateButton template="solicitar-despliegue" label="Desplegar" className="create-button" onFinished={loader.reload} />}
      />
      <Stats
        items={[
          ["Componentes", items.length],
          ["Homologados", items.filter((i) => i.status === "homologado").length],
          ["Incompletos", items.filter((i) => i.status === "incompleto").length],
          ["Sin versión", items.filter((i) => i.status === "sin-version").length]
        ]}
      />
      <div className="module-panel">
        <div className="pipeline-toolbar">
          <span />
          <Refresh loader={loader} />
        </div>
        <ErrorBox message={loader.error && `No fue posible consultar los despliegues. ${loader.error}`} />
        <div className="table-wrapper">
          <table className="pool-table">
            <thead>
              <tr>
                <th>Componente</th>
                <th>Estado</th>
                {environments.map((env) => <th key={env}>{env}</th>)}
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <EmptyRow colSpan={environments.length + 3} loading={loader.loading && !loader.data}>No hay componentes con pipeline.</EmptyRow>}
              {items.map((item) => (
                <tr key={item.component}>
                  <td title={item.detail}>{item.label}</td>
                  <td><StatusBadge status={item.status} /></td>
                  {environments.map((env) => {
                    const cell = item.environments.find((e) => e.environment === env);
                    return (
                      <td key={env}>
                        {cell?.deployed ? (
                          <span title={`Commit ${cell.commit?.slice(0, 8)} · rama ${cell.branch} · ${formatDate(cell.finishedAt)}`}>
                            <strong>{cell.version ?? `#${cell.buildNumber}`}</strong>
                            <br />
                            <small>{cell.commit?.slice(0, 7)} · {cell.ageDays} d</small>
                          </span>
                        ) : (
                          <small>{cell?.optional ? "opcional" : "sin despliegue"}</small>
                        )}
                      </td>
                    );
                  })}
                  <td className="row-actions">
                    <TemplateButton template="solicitar-despliegue" preset={{ component: item.component }} label="Desplegar" onFinished={loader.reload} />
                    <TemplateButton template="redesplegar-version" preset={{ component: item.component }} label="Rollback" onFinished={loader.reload} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Footer loader={loader} source="Backstage · /api/homologation/components" />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- TechDebt */

export function TechDebtPage() {
  const loader = useData(async () => {
    const [baseline, cards] = await Promise.all([homologation.baseline(), scorecards.components().catch(() => [])]);
    return { baseline: baseline.items, cards };
  }, { interval: 60000 });

  const debt = [];
  for (const item of loader.data?.baseline ?? []) {
    for (const check of item.checks ?? []) {
      if (check.status !== "aprobada" && check.status !== "excepcion") {
        debt.push({
          key: `${item.component}-${check.id}`,
          component: item.component,
          source: "Línea base",
          title: check.title,
          value: check.value,
          detail: check.detail,
          severity: check.status === "no-aprobada" ? "Alta" : check.status === "sin-dato" ? "Media" : "Baja"
        });
      }
    }
  }
  for (const card of loader.data?.cards ?? []) {
    for (const check of card.checks ?? []) {
      if (!check.pass) {
        debt.push({
          key: `${card.name}-${check.id}`,
          component: card.name,
          source: "Scorecard",
          title: check.title,
          detail: check.detail,
          severity: "Media"
        });
      }
    }
  }
  const order = { Alta: 0, Media: 1, Baja: 2 };
  debt.sort((a, b) => order[a.severity] - order[b.severity] || a.component.localeCompare(b.component));
  const sevClass = { Alta: "homologation-pending", Media: "homologation-review", Baja: "homologation-approved" };

  return (
    <section className="module-page">
      <Heading
        eyebrow="CALIDAD"
        title="TechDebt"
        description="Deuda técnica detectada: versiones fuera de la línea base tecnológica e indicadores de calidad que no se cumplen."
      />
      <Stats
        items={[
          ["Hallazgos", debt.length],
          ["Alta", debt.filter((d) => d.severity === "Alta").length],
          ["Media", debt.filter((d) => d.severity === "Media").length],
          ["Componentes afectados", new Set(debt.map((d) => d.component)).size]
        ]}
      />
      <div className="module-panel">
        <div className="pipeline-toolbar"><span /><Refresh loader={loader} /></div>
        <ErrorBox message={loader.error && `No fue posible consultar la deuda técnica. ${loader.error}`} />
        <div className="table-wrapper">
          <table className="pool-table">
            <thead>
              <tr>
                <th>Componente</th>
                <th>Origen</th>
                <th>Hallazgo</th>
                <th>Detalle</th>
                <th>Severidad</th>
              </tr>
            </thead>
            <tbody>
              {debt.length === 0 && <EmptyRow colSpan={5} loading={loader.loading && !loader.data}>Sin deuda técnica detectada.</EmptyRow>}
              {debt.map((d) => (
                <tr key={d.key}>
                  <td>{d.component}</td>
                  <td>{d.source}</td>
                  <td>{d.title}{d.value ? ` (${d.value})` : ""}</td>
                  <td>{d.detail}</td>
                  <td><span className={sevClass[d.severity]}>{d.severity}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Footer loader={loader} source="Backstage · /api/homologation/baseline + /api/scorecards" />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Compliance IQ */

function PolicyCompliance({ components }) {
  const [repo, setRepo] = React.useState("");
  const [state, setState] = React.useState({});

  async function check(name) {
    setRepo(name);
    if (!name) {
      setState({});
      return;
    }
    setState({ loading: true });
    try {
      setState({ data: await branching.policies(name) });
    } catch (err) {
      setState({ error: err.message });
    }
  }

  return (
    <div className="module-panel panel-spaced">
      <div className="panel-title">
        <strong>Políticas de rama en Azure DevOps</strong>
        <small>¿Azure DevOps impone lo que pide la estrategia en el repositorio?</small>
      </div>
      <div className="pipeline-toolbar">
        <select value={repo} onChange={(e) => check(e.target.value)}>
          <option value="">Selecciona un repositorio</option>
          {components.map((name) => <option key={name}>{name}</option>)}
        </select>
        {state.loading && <Loader2 size={16} className="spin" />}
      </div>
      <ErrorBox message={state.error} />
      {state.data && (
        <div className="table-wrapper">
          <table className="pool-table">
            <thead>
              <tr><th>Rama</th><th>Estado</th><th>Verificaciones</th></tr>
            </thead>
            <tbody>
              {state.data.branches.map((branch) => (
                <tr key={branch.branch}>
                  <td>{branch.branch}</td>
                  <td><span className={branch.compliant ? "homologation-approved" : "homologation-pending"}>{branch.compliant ? "Cumple" : "No cumple"}</span></td>
                  <td>
                    {branch.checks.map((c) => (
                      <div key={c.name} className="check-line">
                        {c.ok ? <Check size={12} className="text-green" /> : <X size={12} className="text-red" />}
                        {c.name}: {c.actual} <small>(esperado: {c.expected})</small>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ValidateSimulator({ components, rules }) {
  const [form, setForm] = React.useState({ repo: "", sourceBranch: "", targetBranch: "", environment: "" });
  const [result, setResult] = React.useState(null);
  const [state, setState] = React.useState({});
  const set = (field) => (e) => setForm((current) => ({ ...current, [field]: e.target.value }));

  async function run() {
    setState({ loading: true });
    setResult(null);
    try {
      const body = {
        project: PROJECT,
        repo: form.repo,
        sourceBranch: form.sourceBranch || undefined,
        targetBranch: form.targetBranch || undefined,
        environment: form.environment || undefined,
        pullRequest: Boolean(form.targetBranch),
        deployment: Boolean(form.environment),
        checkRemote: false
      };
      setResult(await branching.validate(body));
      setState({});
    } catch (err) {
      setState({ error: err.message });
    }
  }

  const messages = (result?.errors ?? []).concat(result?.warnings ?? []);

  return (
    <div className="module-panel panel-spaced">
      <div className="panel-title">
        <strong>Simulador de la estrategia</strong>
        <small>Prueba un pull request o un despliegue contra las reglas sin tocar Azure DevOps.</small>
      </div>
      <div className="pipeline-toolbar sim-grid">
        <select value={form.repo} onChange={set("repo")}>
          <option value="">Repositorio</option>
          {components.map((name) => <option key={name}>{name}</option>)}
        </select>
        <input value={form.sourceBranch} onChange={set("sourceBranch")} placeholder="Rama origen (team/ABC-1)" />
        <input value={form.targetBranch} onChange={set("targetBranch")} placeholder="Rama destino (develop)" />
        <select value={form.environment} onChange={set("environment")}>
          <option value="">Sin despliegue</option>
          {Object.keys(rules?.deployments ?? {}).map((env) => <option key={env}>{env}</option>)}
        </select>
        <button className="create-primary-button" onClick={run} disabled={!form.repo || !form.sourceBranch || state.loading}>
          {state.loading ? <Loader2 size={15} className="spin" /> : "Validar"}
        </button>
      </div>
      <ErrorBox message={state.error} />
      {result && (
        <div className="sim-result">
          <span className={result.valid ? "homologation-approved" : "homologation-pending"}>
            {result.valid ? "La estrategia lo permite" : "La estrategia lo rechaza"}
          </span>
          {messages.map((message) => <p key={message}>{message}</p>)}
        </div>
      )}
    </div>
  );
}

export function ComplianceIqPage() {
  const loader = useData(async () => {
    const [rules, components] = await Promise.all([branching.rules(), catalog.components()]);
    return { rules, components: components.filter(isDeployable).map((e) => repoOf(e)) };
  }, { interval: 60000 });
  const rules = loader.data?.rules;
  const components = loader.data?.components ?? [];
  const roles = rules?.roles ?? [];

  return (
    <section className="module-page">
      <Heading
        eyebrow="CUMPLIMIENTO"
        title="Compliance IQ"
        description="Estrategia de branching, roles y políticas: qué exige la organización y si Azure DevOps lo está imponiendo."
      />
      <Stats
        items={[
          ["Tipos de rama", rules?.branches?.length ?? "—"],
          ["Reglas de PR", rules?.pullRequests?.length ?? "—"],
          ["Roles", roles.length || "—"],
          ["Commits", rules?.commits?.enforcement ?? "—"]
        ]}
      />
      <ErrorBox message={loader.error && `No fue posible consultar las reglas. ${loader.error}`} />

      <div className="module-panel panel-spaced">
        <div className="panel-title"><strong>Roles</strong><small>Estrategia {rules?.strategy ?? "—"}</small></div>
        <div className="table-wrapper">
          <table className="pool-table">
            <thead><tr><th>Rol</th><th>Responsabilidad</th><th>Grupo de Backstage</th></tr></thead>
            <tbody>
              {roles.length === 0 && <EmptyRow colSpan={3} loading={loader.loading}>Sin información.</EmptyRow>}
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>{role.name}</td>
                  <td>{role.description ?? "—"}</td>
                  <td>{[rules.roleGroups?.[role.id] ?? []].flat().map((g) => g.replace("group:default/", "")).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="module-panel panel-spaced">
        <div className="panel-title"><strong>Tipos de rama</strong><small>Qué ramas existen, quién las administra y cómo se nombran</small></div>
        <div className="table-wrapper">
          <table className="pool-table">
            <thead><tr><th>Tipo</th><th>Patrón</th><th>Vida</th><th>Administra</th><th>Descripción</th></tr></thead>
            <tbody>
              {(rules?.branches ?? []).map((branch) => (
                <tr key={branch.id}>
                  <td>{branch.id}</td>
                  <td><code>{branch.pattern}</code></td>
                  <td>{branch.lifetime === "long" ? "larga" : "corta"}</td>
                  <td>{branch.managedBy ?? "—"}</td>
                  <td>{branch.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="module-panel panel-spaced">
        <div className="panel-title"><strong>Reglas de pull request</strong><small>Quién crea y quién aprueba cada flujo</small></div>
        <div className="table-wrapper">
          <table className="pool-table">
            <thead><tr><th>Desde</th><th>Hacia</th><th>Fusión</th><th>Crea</th><th>Aprueba</th></tr></thead>
            <tbody>
              {(rules?.pullRequests ?? []).map((rule, i) => (
                <tr key={`${rule.from}-${i}`}>
                  <td>{rule.from}</td>
                  <td>{rule.to.join(", ")}</td>
                  <td>{rule.mergeStrategy}</td>
                  <td>{(rule.createdBy ?? []).join(", ")}</td>
                  <td>{(rule.approvedBy ?? []).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PolicyCompliance components={components} />
      <ValidateSimulator components={components} rules={rules} />
    </section>
  );
}

/* ----------------------------------------------------------------- Resumen */

export function SummaryPage({ onNavigate }) {
  const loader = useData(async () => {
    const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error: error.message }));
    const [homologationItems, pipelines, pools, tasks, parity] = await Promise.all([
      settle(homologation.items()),
      settle(branching.pipelines()),
      settle(branching.agentPools()),
      settle(scaffolder.tasks(10)),
      settle(homologation.components())
    ]);
    return { homologationItems, pipelines, pools, tasks, parity };
  }, { interval: 60000 });

  const d = loader.data ?? {};
  const items = d.homologationItems?.value?.items ?? [];
  const pipelines = d.pipelines?.value?.pipelines ?? [];
  const pools = d.pools?.value?.pools ?? [];
  const parity = d.parity?.value?.items ?? [];
  const tasks = d.tasks?.value?.tasks ?? [];
  const agents = pools.reduce((sum, pool) => sum + pool.total, 0);
  const online = pools.reduce((sum, pool) => sum + pool.available + pool.busy, 0);
  const failed = pipelines.filter((p) => p.status === "Fallida").length;

  const card = (title, page, lines, error) => (
    <div className="module-panel summary-card" key={title}>
      <div className="panel-title">
        <strong>{title}</strong>
        <button className="pipeline-action" onClick={() => onNavigate(page)}>Ver</button>
      </div>
      {error ? <ErrorBox message={error} /> : lines.map(([label, value]) => (
        <div className="summary-line" key={label}><span>{label}</span><strong>{value}</strong></div>
      ))}
    </div>
  );

  return (
    <section className="module-page">
      <Heading
        eyebrow="GRAVITY"
        title="Resumen"
        description="Vista general de la plataforma: homologación, pipelines, agentes y la actividad reciente del IDP."
        actions={<Refresh loader={loader} />}
      />
      <div className="summary-grid">
        {card("Homologación", "Homologation Status", [
          ["Homologados", items.filter((i) => i.status === "homologado").length],
          ["Pendientes", items.filter((i) => i.status === "pendiente").length],
          ["En revisión", items.filter((i) => i.status === "en-revision").length]
        ], d.homologationItems?.error)}
        {card("Pipelines", "Pipelines", [
          ["Pipelines", pipelines.length],
          ["Última ejecución fallida", <span key="failed" className={failed > 0 ? "status-text status-failed" : ""}>{failed}</span>],
          ["Ejecuciones", pipelines.reduce((sum, p) => sum + p.executions, 0)]
        ], d.pipelines?.error)}
        {card("Pool de agentes", "Pool de Agentes", [
          ["Pools", pools.length],
          ["Agentes", agents],
          ["En línea", online]
        ], d.pools?.error)}
        {card("Releases", "Releases", [
          ["Homologados", parity.filter((p) => p.status === "homologado").length],
          ["Incompletos", parity.filter((p) => p.status === "incompleto").length],
          ["Sin versión", parity.filter((p) => p.status === "sin-version").length]
        ], d.parity?.error)}
      </div>

      <div className="module-panel panel-spaced">
        <div className="panel-title">
          <strong>Actividad reciente del IDP</strong>
          <button className="pipeline-action" onClick={() => onNavigate("Pipeline Engine (IDP)")}>Ver todas</button>
        </div>
        <div className="table-wrapper">
          <table className="pool-table">
            <thead><tr><th>Plantilla</th><th>Estado</th><th>Creada</th><th>Por</th></tr></thead>
            <tbody>
              {tasks.length === 0 && <EmptyRow colSpan={4} loading={loader.loading && !loader.data}>{d.tasks?.error ?? "Sin tareas."}</EmptyRow>}
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.spec?.templateInfo?.entityRef?.replace("template:default/", "")}</td>
                  <td>{task.status}</td>
                  <td>{formatDate(task.createdAt)}</td>
                  <td>{task.createdBy?.replace("user:default/", "") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Tools Health */

export function ToolsHealthPage() {
  const loader = useData(async () => {
    const probe = async (name, detail, call) => {
      const started = performance.now();
      try {
        const info = await call();
        return { name, detail, ok: true, ms: Math.round(performance.now() - started), info };
      } catch (err) {
        return { name, detail, ok: false, ms: Math.round(performance.now() - started), info: err.message };
      }
    };
    return Promise.all([
      probe("Backstage · Catálogo", "Componentes y plantillas registrados", async () => `${(await catalog.components()).length} componentes`),
      probe("Backstage · Branching", "Reglas y estrategia", async () => `${(await branching.rules()).strategy}`),
      probe("Backstage · Homologación", "Infraestructura y componentes", async () => `${(await homologation.items()).items.length} elementos`),
      probe("Azure DevOps · Pipelines", "A través de Backstage", async () => `${(await branching.pipelines()).pipelines.length} pipelines`),
      probe("Azure DevOps · Agentes", "Pools de agentes", async () => `${(await branching.agentPools()).pools.length} pools`)
    ]);
  }, { interval: 60000 });

  const rows = loader.data ?? [];

  return (
    <section className="module-page">
      <Heading
        eyebrow="PLATAFORMA"
        title="Tools Health"
        description="Estado de las integraciones que alimentan GRAVITY."
        actions={<Refresh loader={loader} />}
      />
      <Stats items={[["Servicios", rows.length], ["Operativos", rows.filter((r) => r.ok).length], ["Con fallas", rows.filter((r) => !r.ok).length], ["Latencia máx.", rows.length ? `${Math.max(...rows.map((r) => r.ms))} ms` : "—"]]} />
      <div className="module-panel">
        <div className="table-wrapper">
          <table className="pool-table">
            <thead><tr><th>Servicio</th><th>Función</th><th>Estado</th><th>Respuesta</th><th>Latencia</th></tr></thead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={5} loading={loader.loading}>Sin información.</EmptyRow>}
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.detail}</td>
                  <td><span className={row.ok ? "homologation-approved" : "homologation-pending"}>{row.ok ? "Operativo" : "Con fallas"}</span></td>
                  <td>{row.info}</td>
                  <td>{row.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Footer loader={loader} source="Backstage" />
      </div>
    </section>
  );
}

/** Control de acceso: roles y qué secciones ve cada uno, y las personas con sus grupos y roles. Solo Admin. */
const USERNAME_PATTERN = /^[a-z]{2,}\.[a-z]{2,}$/;

/** Casillas de roles; `value` es la lista de ids marcados. */
function RoleChecks({ roles, value, onChange }) {
  return (
    <div className="role-checks">
      {roles.map((role) => (
        <label key={role.id} title={role.description}>
          <input
            type="checkbox"
            checked={value.includes(role.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, role.id] : value.filter((id) => id !== role.id))}
          />
          {role.name}
        </label>
      ))}
    </div>
  );
}

/** Resultado de un alta o un restablecimiento: aviso de correo enviado o la contraseña temporal, que se muestra una sola vez. */
function TemporaryPassword({ username, password, email, emailError, onClose }) {
  const [copied, setCopied] = React.useState(false);
  if (!password) {
    return (
      <div className="temp-password" role="status">
        <span>Se envió la contraseña temporal de <strong>{username}</strong> a <strong>{email}</strong>. Al entrar se le pedirá cambiarla.</span>
        <button type="button" className="link-button" onClick={onClose}>Cerrar</button>
      </div>
    );
  }
  return (
    <div className="temp-password" role="status">
      {emailError && <span className="field-error">{emailError}</span>}
      <span>Contraseña temporal de <strong>{username}</strong>:</span>
      <code>{password}</code>
      <button
        type="button"
        className="link-button"
        onClick={() => navigator.clipboard?.writeText(password).then(() => setCopied(true))}
      >
        {copied ? "Copiada" : "Copiar"}
      </button>
      <small>Solo se muestra ahora. Entrégala por un canal privado: al entrar se le pedirá cambiarla.</small>
      <button type="button" className="link-button" onClick={onClose}>Cerrar</button>
    </div>
  );
}

export function UsersPage() {
  const loader = useData(async () => {
    const [roles, users] = await Promise.all([access.roles(), access.users()]);
    return { roles, users: users.users ?? [] };
  });
  const roles = loader.data?.roles?.roles ?? [];
  const sections = loader.data?.roles?.sections ?? [];
  const emailEnabled = Boolean(loader.data?.roles?.emailEnabled);
  const users = loader.data?.users ?? [];

  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [newRoles, setNewRoles] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [issued, setIssued] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [editRoles, setEditRoles] = React.useState([]);

  const clean = (err) => err.message.replace(/ \(HTTP \d+\)$/, "");
  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      loader.reload();
    } catch (err) {
      setError(clean(err));
    } finally {
      setBusy(false);
    }
  };

  const validName = USERNAME_PATTERN.test(username.trim().toLowerCase());
  const create = (event) => {
    event.preventDefault();
    run(async () => {
      const result = await access.createUser({ username: username.trim().toLowerCase(), displayName: displayName.trim(), email: email.trim(), roles: newRoles });
      setIssued({ username: result.user.username, password: result.temporaryPassword, email: result.email, emailError: result.emailError });
      setUsername("");
      setEmail("");
      setDisplayName("");
      setNewRoles([]);
    });
  };
  const saveRoles = (user) =>
    run(async () => {
      await access.updateUser(user.username, { roles: editRoles, email: editEmail.trim() });
      setEditing(null);
    });
  const toggleActive = (user) => run(() => access.updateUser(user.username, { active: !user.active }));
  const reset = (user) =>
    run(async () => {
      const result = await access.resetPassword(user.username);
      setIssued({ username: user.username, password: result.temporaryPassword, email: result.email, emailError: result.emailError });
    });
  const remove = (user) => {
    if (!window.confirm(`¿Borrar la cuenta ${user.username}? No se puede deshacer; si solo quieres impedir que entre, desactívala.`)) {
      return;
    }
    run(() => access.deleteUser(user.username));
  };

  return (
    <section className="module-page">
      <Heading
        eyebrow="CONTROL DE ACCESO"
        title="Usuarios"
        description="Alta de personas (nombre.apellido) y sus roles. El rol decide qué secciones ve cada quien y qué puede hacer en las plantillas. Las cuentas fijas de la configuración se muestran pero no se editan aquí."
      />
      <Stats items={[["Usuarios", loader.data ? users.length : "—"], ["Roles", loader.data ? roles.length : "—"], ["Secciones", sections.length || "—"]]} />
      <ErrorBox message={loader.error && `No fue posible consultar el control de acceso. ${loader.error}`} />

      <div className="module-panel panel-spaced">
        <div className="panel-title">
          <strong>Nuevo usuario</strong>
          <small>{emailEnabled ? "La contraseña temporal se envía por correo" : "Se genera una contraseña temporal para entregarla a mano (el correo no está configurado)"}</small>
        </div>
        <form className="user-form" onSubmit={create}>
          <label>
            Usuario
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="nombre.apellido" autoComplete="off" required />
          </label>
          <label>
            Correo{emailEnabled ? "" : " (opcional)"}
            <input type="text" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre.apellido@empresa.com" autoComplete="off" />
          </label>
          <label>
            Nombre para mostrar (opcional)
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Se toma del usuario" />
          </label>
          <fieldset className="user-form-roles">
            <legend>Roles</legend>
            <RoleChecks roles={roles} value={newRoles} onChange={setNewRoles} />
          </fieldset>
          <div className="user-form-actions">
            <button type="submit" className="create-button" disabled={busy || !validName || newRoles.length === 0}>Crear usuario</button>
          </div>
        </form>
        {username && !validName && (
          <p className="field-error">Usa la forma nombre.apellido: minúsculas, sin acentos, espacios ni números (p. ej. fidencio.santander).</p>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
        {issued && <TemporaryPassword {...issued} onClose={() => setIssued(null)} />}
      </div>

      <div className="module-panel panel-spaced">
        <div className="panel-title"><strong>Personas</strong><small>Roles y estado de cada cuenta</small></div>
        <div className="table-wrapper">
          <table className="pool-table">
            <thead><tr><th>Usuario</th><th>Nombre</th><th>Correo</th><th>Roles</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              {users.length === 0 && <EmptyRow colSpan={6} loading={loader.loading}>Sin usuarios.</EmptyRow>}
              {users.map((user) => (
                <tr key={user.entityRef}>
                  <td>{user.username ?? user.entityRef.replace(/^user:default\//, "")}</td>
                  <td>{user.name}</td>
                  <td>
                    {editing === user.username ? (
                      <input type="text" className="inline-input" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="correo" />
                    ) : (
                      user.email ?? "—"
                    )}
                  </td>
                  <td>
                    {editing === user.username ? (
                      <RoleChecks roles={roles} value={editRoles} onChange={setEditRoles} />
                    ) : user.roles.length ? (
                      user.roles.map((role) => role.name).join(", ")
                    ) : (
                      "Sin rol"
                    )}
                  </td>
                  <td>
                    {!user.managed
                      ? "Cuenta fija"
                      : !user.active
                        ? "Desactivada"
                        : user.mustChangePassword
                          ? "Contraseña temporal"
                          : "Activa"}
                  </td>
                  <td>
                    {user.managed ? (
                      <div className="user-actions">
                        {editing === user.username ? (
                          <>
                            <button type="button" className="link-button" disabled={busy || editRoles.length === 0} onClick={() => saveRoles(user)}>Guardar</button>
                            <button type="button" className="link-button" onClick={() => setEditing(null)}>Cancelar</button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                              setEditing(user.username);
                              setEditRoles(user.roles.map((role) => role.id));
                              setEditEmail(user.email ?? "");
                            }}
                          >
                            Editar
                          </button>
                        )}
                        <button type="button" className="link-button" disabled={busy} onClick={() => toggleActive(user)}>
                          {user.active ? "Desactivar" : "Activar"}
                        </button>
                        <button type="button" className="link-button" disabled={busy || !user.active} onClick={() => reset(user)}>Restablecer contraseña</button>
                        <button type="button" className="link-button danger-link" disabled={busy} onClick={() => remove(user)}>Borrar</button>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="module-panel panel-spaced">
        <div className="panel-title"><strong>Roles y secciones</strong><small>Qué ve cada rol en GRAVITY</small></div>
        <div className="table-wrapper">
          <table className="pool-table">
            <thead>
              <tr><th>Sección</th>{roles.map((role) => <th key={role.id} title={role.description}>{role.name}</th>)}</tr>
            </thead>
            <tbody>
              {roles.length === 0 && <EmptyRow colSpan={1} loading={loader.loading}>Sin roles configurados.</EmptyRow>}
              {sections.map((section) => (
                <tr key={section}>
                  <td>{section}</td>
                  {roles.map((role) => <td key={role.id}>{role.sections.includes(section) ? "✔" : "—"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- Release Management */

const RM_KIND = { prevalidacion: "Pre-Validación", preliberacion: "Pre-Liberación" };
const rmIcon = (r) => (r.passed ? "✅" : r.kind === "prevalidacion" ? "🟠" : "⚠️");
const rmFlow = (r) => `${r.sourceBranch} → ${r.targetBranch}`;

function RmResult({ report }) {
  const className = report.passed ? "homologation-approved" : report.kind === "prevalidacion" ? "homologation-review" : "homologation-pending";
  return <span className={className}>{rmIcon(report)} {report.passed ? "Cumple" : report.kind === "prevalidacion" ? "No candidato" : "Requiere CAB"}</span>;
}

function RmNotification({ report }) {
  const n = report.notification;
  if (!n) return <small>—</small>;
  return n.sent ? (
    <span title={`Enviado el ${formatDate(n.at)}`}><Check size={14} /> Enviado</span>
  ) : (
    <span title={n.error ?? "No se envió"}><X size={14} /> No enviado</span>
  );
}

function RmSection({ icon, title, children }) {
  return (
    <div className="rm-report-section">
      <h3>{icon} {title}</h3>
      {children}
    </div>
  );
}

function RmFields({ rows }) {
  return (
    <table className="rm-report-fields">
      <tbody>
        {rows.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([label, value]) => (
          <tr key={label}><th>{label}</th><td>{value}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

/** Informe con el formato de los ejemplos de la propuesta To Be de Release Management. */
function RmReport({ report: r }) {
  const m = r.metrics ?? {};
  const pr = r.pullRequestUrl ? <Link href={r.pullRequestUrl}>#{r.pullRequestId}</Link> : r.pullRequestId ? `#${r.pullRequestId}` : undefined;
  const evaluated = formatDate(r.createdAt);
  return (
    <article className="rm-report" data-testid="rm-report">
      <header>
        <span>Reporte_Release_Management</span>
        <h2>{r.kind === "prevalidacion" ? "🔎 Informe de Pre-Validación de Pull Request" : "🔔 Informe de Pre-Liberación de CI de Release"}</h2>
      </header>
      {r.metricsSource === "simulado" && (
        <div className="rm-report-notice">Métricas de ejemplo: SonarQube y Checkmarx todavía no están conectados.</div>
      )}

      {r.kind === "prevalidacion" ? (
        <>
          <RmSection icon="📌" title="Resultado estimado de liberación">
            <RmFields
              rows={[
                ["Pull Request", <>{rmFlow(r)} {pr && <>· {pr}</>}</>],
                ["Componente", r.component],
                ["Autor", r.author?.name],
                ["Ticket InvGate", r.ticket],
                ["Fecha de evaluación", evaluated],
                ["Resultado estimado", <strong key="r">{rmIcon(r)} {r.result}</strong>]
              ]}
            />
          </RmSection>
          <RmSection icon="📊" title="Indicadores en este punto del flujo">
            <RmFields
              rows={[
                ["Calificación de calidad", m.qualityRating],
                ["Cobertura de pruebas", `${m.coverage}%`],
                ["Vulnerabilidades Altas", m.high],
                ["Vulnerabilidades Medias", m.medium],
                ["Vulnerabilidades Críticas", m.critical]
              ]}
            />
          </RmSection>
          <RmSection icon="📋" title="Aclaraciones importantes">
            <p>Este reporte representa una estimación preliminar. No contempla:</p>
            <ul>
              <li>Inspecciones de calidad y seguridad que aún no se ejecutan en ramas posteriores.</li>
              <li>Integraciones de código que podrían introducir conflictos o vulnerabilidades.</li>
              <li>Pruebas funcionales o de regresión que se ejecutan en etapas posteriores.</li>
            </ul>
            <p><strong>Objetivo:</strong> brindar información temprana a los equipos para mejorar sus entregables y aumentar la probabilidad de autorización automática al llegar a release.</p>
          </RmSection>
        </>
      ) : (
        <>
          <RmSection icon="🧩" title="Resumen ejecutivo">
            <RmFields
              rows={[
                ["Componente", r.component],
                ["Versión", r.version],
                ["Responsable de release", r.author?.name],
                ["Pull Request", pr],
                ["Ticket InvGate", r.ticket],
                ["Fecha de generación", evaluated]
              ]}
            />
          </RmSection>
          <RmSection icon="📌" title="Resultado de validación">
            <p><strong>{rmIcon(r)} {r.result}</strong></p>
          </RmSection>
        </>
      )}

      <RmSection icon="📋" title="Criterios para Cumplimiento para Pasaporte en CI">
        <table className="rm-report-fields" data-testid="rm-criteria">
          <thead><tr><th>Criterio</th><th>Valor</th><th>Resultado</th></tr></thead>
          <tbody>
            {(r.criteria ?? []).map((c, i) => (
              <tr key={c.id}>
                <td>{i + 1} {c.label}</td>
                <td>{c.value}</td>
                <td>{c.passed ? "✅ Cumple" : "❌ No cumple"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </RmSection>

      {r.kind === "preliberacion" && (
        <>
          <RmSection icon="🔐" title="Resultado de escáneres de seguridad">
            <code>Críticas: {m.critical} | Altas: {m.high} | Medias: {m.medium} | Bajas: {m.low} | Último escaneo: {m.lastScan ?? "—"}</code>
          </RmSection>
          <RmSection icon="📊" title="Calidad">
            <RmFields rows={[["Calidad del código", m.qualityRating], ["Cobertura de pruebas unitarias", `${m.coverage}%`], ["Pruebas automatizadas", m.tests]]} />
          </RmSection>
          <RmSection icon="🛡️" title="Gates">
            <RmFields rows={[["Quality Gate", m.qualityGate], ["Security Gate", m.securityRating]]} />
          </RmSection>
          <RmSection icon="✍️" title="Validación y firma de cumplimiento">
            <RmFields rows={[["Firma digital / acceso (automático)", "✅ Validado por GRAVITY al crear el pull request"]]} />
          </RmSection>
          <RmSection icon="🔀" title="Flujo de cambio">
            <RmFields rows={[["Origen", r.sourceBranch], ["Destino", r.targetBranch]]} />
          </RmSection>
        </>
      )}

      <RmSection icon="💬" title="Notificación a Google Chat">
        <p><RmNotification report={r} />{r.notification?.error && !r.notification.sent ? ` · ${r.notification.error}` : ""}</p>
      </RmSection>
      <footer>© {new Date(r.createdAt).getFullYear()} GRAVITY · {r.kind === "prevalidacion" ? "Evaluación preliminar automatizada desde el pull request" : "Reporte automatizado generado al crear el pull request hacia master"}</footer>
    </article>
  );
}

function RmReportView({ id, onBack }) {
  const loader = useData(() => rm.report(id));
  return (
    <section className="module-page">
      <button className="pipeline-action back-button" onClick={onBack}><ArrowLeft size={14} /> Volver al historial</button>
      <ErrorBox message={loader.error && `No fue posible consultar el informe. ${loader.error}`} />
      {loader.loading && !loader.data && <div className="empty-table"><Loader2 size={18} className="spin" /> Consultando el informe...</div>}
      {loader.data && <RmReport report={loader.data} />}
    </section>
  );
}

const RM_PAGE = 50;

/** Historial de informes de Release Management (MongoDB), con filtros y el detalle de cada informe. */
export function ReleaseManagementPage({ initialReport }) {
  const [openId, setOpenId] = React.useState(initialReport ?? null);
  const [filters, setFilters] = React.useState({ kind: "", component: "", passed: "", q: "", from: "", to: "" });
  const [limit, setLimit] = React.useState(RM_PAGE);
  const [search, setSearch] = React.useState("");
  // La búsqueda libre se aplica al dejar de escribir.
  React.useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 350);
    return () => clearTimeout(t);
  }, [search]);
  const key = JSON.stringify({ ...filters, limit });
  const loader = useData(() => rm.reports({ ...filters, limit }), { interval: 60000 });
  const components = useData(() => rm.components().then((r) => r.components).catch(() => []));
  const reload = loader.reload;
  // Al cambiar un filtro se vuelve a consultar (la primera carga ya la hace useData).
  const firstKey = React.useRef(key);
  React.useEffect(() => {
    if (firstKey.current === key) return;
    firstKey.current = null;
    reload();
  }, [key, reload]);

  if (openId) return <RmReportView id={openId} onBack={() => { setOpenId(null); loader.reload(); }} />;

  const items = loader.data?.items ?? [];
  const total = loader.data?.total ?? 0;
  const set = (name) => (e) => { setLimit(RM_PAGE); setFilters({ ...filters, [name]: e.target.value }); };
  const active = Object.entries(filters).some(([, v]) => v);

  return (
    <section className="module-page">
      <Heading
        eyebrow="GOBIERNO DE LIBERACIONES"
        title="Release Management"
        description="Historial de los informes de Pre-Validación (team/sprint → develop) y Pre-Liberación (release → master) de cada pull request creado desde GRAVITY. Cada informe también se envía al espacio de Google Chat."
      />
      <Stats
        items={[
          ["Informes", total],
          ["Pre-Validación", items.filter((r) => r.kind === "prevalidacion").length],
          ["Pre-Liberación", items.filter((r) => r.kind === "preliberacion").length],
          ["Cumplen", items.filter((r) => r.passed).length]
        ]}
      />
      <div className="module-panel">
        <div className="pipeline-toolbar rm-filters" data-testid="rm-filters">
          <div className="search-input-wrapper">
            <Search size={16} />
            <input value={search} onChange={(e) => { setLimit(RM_PAGE); setSearch(e.target.value); }} placeholder="Buscar por componente, autor, rama o ticket..." />
          </div>
          <select value={filters.kind} onChange={set("kind")} aria-label="Tipo de informe">
            <option value="">Todos los tipos</option>
            <option value="prevalidacion">Pre-Validación</option>
            <option value="preliberacion">Pre-Liberación</option>
          </select>
          <select value={filters.component} onChange={set("component")} aria-label="Componente">
            <option value="">Todos los componentes</option>
            {(components.data ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filters.passed} onChange={set("passed")} aria-label="Resultado">
            <option value="">Todos los resultados</option>
            <option value="true">Cumple</option>
            <option value="false">No cumple</option>
          </select>
          <label className="inline-check">Desde <input type="date" value={filters.from} onChange={set("from")} /></label>
          <label className="inline-check">Hasta <input type="date" value={filters.to} onChange={set("to")} /></label>
          {active && <button className="link-button" onClick={() => { setSearch(""); setLimit(RM_PAGE); setFilters({ kind: "", component: "", passed: "", q: "", from: "", to: "" }); }}>Limpiar filtros</button>}
          <Refresh loader={loader} />
        </div>
        <ErrorBox message={loader.error && `No fue posible consultar el historial. ${loader.error}`} />
        <div className="table-wrapper">
          <table className="pool-table" data-testid="rm-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Informe</th>
                <th>Componente</th>
                <th>Flujo</th>
                <th>Autor</th>
                <th>Resultado</th>
                <th>Cobertura</th>
                <th>Críticas</th>
                <th>Altas</th>
                <th>Medias</th>
                <th>Google Chat</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <EmptyRow colSpan={11} loading={loader.loading && !loader.data}>
                  {active ? "Ningún informe cumple los filtros." : "Todavía no hay informes. Se generan al integrar cambios de team/sprint hacia develop y de release hacia master."}
                </EmptyRow>
              )}
              {items.map((r) => (
                <tr key={r.id}>
                  <td><button className="link-button" onClick={() => setOpenId(r.id)}>{formatDate(r.createdAt)}</button></td>
                  <td>{RM_KIND[r.kind] ?? r.kind}</td>
                  <td>{r.component}</td>
                  <td>{rmFlow(r)}{r.pullRequestId ? <> · <Link href={r.pullRequestUrl}>#{r.pullRequestId}</Link></> : null}</td>
                  <td>{r.author?.name ?? "—"}</td>
                  <td title={r.result}><RmResult report={r} /></td>
                  <td>{r.metrics?.coverage}%</td>
                  <td>{r.metrics?.critical}</td>
                  <td>{r.metrics?.high}</td>
                  <td>{r.metrics?.medium}</td>
                  <td><RmNotification report={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length < total && (
          <div className="rm-more"><button className="link-button" onClick={() => setLimit(limit + RM_PAGE)}>Ver más ({items.length} de {total})</button></div>
        )}
        <Footer loader={loader} source="Backstage · /api/rm/reports · MongoDB" />
      </div>
    </section>
  );
}
