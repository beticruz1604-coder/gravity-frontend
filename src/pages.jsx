import React from "react";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  ExternalLink,
  Check,
  X
} from "lucide-react";

import {
  PROJECT,
  branching,
  catalog,
  homologation,
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

export function HomologationPage() {
  const [tab, setTab] = React.useState("infraestructura");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("Todos");
  const loader = useData(() => homologation.items(), { interval: 60000 });

  const items = loader.data?.items ?? [];
  const records = items.filter((item) => (tab === "infraestructura" ? item.category === "infraestructura" : item.category === "componente"));
  const filtered = records.filter((item) => {
    const text = `${item.name} ${item.type} ${item.version ?? ""} ${item.environment}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (status === "Todos" || item.status === STATUS_ID[status]);
  });
  const count = (id) => records.filter((x) => x.status === id).length;

  return (
    <section className="module-page">
      <Heading
        eyebrow="HOMOLOGACIÓN"
        title="Homologation Status"
        description="Estado de homologación de infraestructura (GCP) y de los componentes: línea base tecnológica y paridad entre ambientes."
      />

      <Stats
        items={[
          ["Elementos registrados", records.length],
          ["Homologados", count("homologado")],
          ["Pendientes", count("pendiente")],
          ["En revisión", count("en-revision")]
        ]}
      />

      <div className="module-panel">
        <div className="homologation-tabs">
          <button className={tab === "infraestructura" ? "selected" : ""} onClick={() => setTab("infraestructura")}>Infraestructura</button>
          <button className={tab === "componentes" ? "selected" : ""} onClick={() => setTab("componentes")}>Componentes</button>
        </div>

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
                <th>Motivo (por qué no está homologado)</th>
                <th>Descripción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <EmptyRow colSpan={6} loading={loader.loading && !loader.data}>No hay información disponible.</EmptyRow>
              )}
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{[item.type, item.version].filter(Boolean).join(" · ")}</td>
                  <td>{item.environment}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td className="wrap" title={item.reason}>
                    {item.status === "homologado" ? <span className="status-text status-none">—</span> : (item.reason ?? "Sin detalle")}
                  </td>
                  <td>{item.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Footer loader={loader} source="Backstage · /api/homologation" />
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
                <th>Propietario</th>
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
                    <button className="link-button" onClick={() => openEntity(`component:default/${row.name}`)}>{row.name}</button>
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
  const loader = useData(() => homologation.components(), { interval: 60000 });
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
                  <td title={item.detail}>{item.component}</td>
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
  const [form, setForm] = React.useState({ repo: "", sourceBranch: "", targetBranch: "", environment: "", rfc: "" });
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
        rfc: form.rfc || undefined,
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
        <input value={form.rfc} onChange={set("rfc")} placeholder="RFC-2026-0001" />
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
                  <td>{rules.roleGroups?.[role.id]?.replace("group:default/", "") ?? "—"}</td>
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
