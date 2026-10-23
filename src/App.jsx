import React from "react";
import {
  LayoutDashboard,
  Headset,
  BarChart3,
  GitBranch,
  Workflow,
  Rocket,
  Bug,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Wrench,
  FileSearch,
  CheckCircle,
  GitPullRequest,
  Server,
  Users,
  Gauge,
  Clock,
  ChevronDown,
  RefreshCw,
  Plus,
  X,
  ArrowRight,
  ArrowLeft,
  Check,
  Search,
  Loader2,
  ExternalLink,
  UploadCloud,
  Library
} from "lucide-react";

import "./App.css";

import {
  branching,
  catalog,
  scaffolder,
  formatDate
} from "./backstage";
import {
  TemplateModal,
  TaskViewer
} from "./TemplateRunner";
import {
  PipelineStatus,
  TaskStatus
} from "./status";
import { NavContext } from "./nav";
import { NewVersionBanner } from "./version";
import {
  CatalogPage,
  EntityPage,
  GlobalSearch
} from "./catalog";
import {
  HomologationPage,
  RepositoriesPage,
  PipelinesPage,
  ReleasesPage,
  TechDebtPage,
  ComplianceIqPage,
  SummaryPage,
  ToolsHealthPage
} from "./pages";

/* Todos los datos vienen de Backstage (ver backstage.js). */

/*MENU*/

const menuItems = [
  { name: "Resumen", icon: LayoutDashboard },
  { name: "Catálogo", icon: Library },
  { name: "Soporte DevSecOps", icon: Headset },
  { name: "Insights", icon: BarChart3 },
  { name: "Repositories", icon: GitBranch },
  { name: "Pipelines", icon: Workflow },
  { name: "Releases", icon: Rocket },
  { name: "TechDebt", icon: Bug },
  { name: "Pool de Agentes", icon: Activity },
  { name: "Compliance IQ", icon: ShieldCheck },
  { name: "Error Analytics", icon: AlertTriangle },
  { name: "Tools Health", icon: Wrench },
  { name: "Log Analyzer", icon: FileSearch },
  { name: "Homologation Status", icon: CheckCircle },
  { name: "Pipeline Engine (IDP)", icon: GitPullRequest }
];

/* NORMALIZADORES
   Permiten que el frontend pueda recibir diferentes nombres
   de propiedades desde el backend.*/

function normalizePool(item = {}) {
  return {
    name:
      item.name ??
      item.poolName ??
      item.pool ??
      "Sin nombre",

    project:
      item.project ??
      item.projectName ??
      "—",

    total:
      Number(
        item.total ??
        item.totalAgents ??
        item.agents ??
        0
      ),

    available:
      Number(
        item.available ??
        item.availableAgents ??
        item.online ??
        0
      ),

    busy:
      Number(
        item.busy ??
        item.busyAgents ??
        item.occupied ??
        0
      ),

    offline:
      Number(
        item.offline ??
        item.offlineAgents ??
        0
      )
  };
}

function formatLastRun(run) {
  if (!run) {
    return "Sin ejecuciones";
  }

  if (typeof run === "string") {
    return run;
  }

  return `${run.number ?? run.id} · ${formatDate(
    run.finishedAt ?? run.startedAt
  )}`;
}

function normalizePipeline(item = {}) {
  return {
    id:
      item.id ??
      item.pipelineId ??
      item.name ??
      Math.random(),

    name:
      item.name ??
      item.pipelineName ??
      "Sin nombre",

    type:
      item.type ??
      item.pipelineType ??
      "—",

    environment:
      item.environment ??
      item.environmentName ??
      "—",

    branch:
      item.branch ??
      item.branchName ??
      "—",

    status:
      item.status ??
      item.state ??
      "Sin información",

    lastRun: formatLastRun(
      item.lastRun ??
        item.lastExecution
    ),

    executions:
      Number(
        item.executions ??
        item.executionCount ??
        0
      )
  };
}

/*SIDEBAR*/

function Sidebar({ selectedPage, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-box">A</div>
        <span>GRAVITY</span>
      </div>

      <nav className="menu">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = selectedPage === item.name;

          return (
            <button
              key={item.name}
              type="button"
              className={`menu-item ${
                isActive ? "active" : ""
              }`}
              onClick={() => onNavigate(item.name)}
            >
              <Icon
                size={17}
                strokeWidth={1.8}
              />

              <span>{item.name}</span>
            </button>
          );
        })}
      </nav>

      <div className="user">
        <div className="user-circle">U1</div>

        <div className="user-data">
          <div>Usuario 1</div>
          <small>ADMIN</small>
        </div>
      </div>
    </aside>
  );
}

/*METRIC CARD*/

function MetricCard({ metric }) {
  const Icon = metric.icon;

  return (
    <div className="metric-card">
      <div className={`metric-icon ${metric.color}`}>
        <Icon
          size={19}
          strokeWidth={1.8}
        />
      </div>

      <div className="metric-info">
        <span className="metric-label">
          {metric.label}
        </span>

        <strong>{metric.value}</strong>

        <small>{metric.detail}</small>
      </div>
    </div>
  );
}

/*POOL TABLE*/

function PoolTable({ pools }) {
  const totalPools = pools.length;

  return (
    <section className="panel pool-panel">
      <div className="panel-heading pool-heading">
        <div>
          <h3>Estado de Pools</h3>

          <p>
            Resumen de agentes por pool configurado.
          </p>
        </div>

        <button className="filter-button">
          Todos los pools
          <ChevronDown size={15} />
        </button>
      </div>

      <div className="table-wrapper">
        <table className="pool-table">
          <thead>
            <tr>
              <th>Pool</th>
              <th>Proyecto</th>
              <th>Total</th>
              <th className="text-green">
                Disp.
              </th>
              <th className="text-yellow">
                Busy
              </th>
              <th className="text-red">
                Offline
              </th>
            </tr>
          </thead>

          <tbody>
            {pools.length === 0 ? (
              <tr>
                <td
                  colSpan="6"
                  className="empty-table"
                >
                  No hay información disponible.
                </td>
              </tr>
            ) : (
              pools.map((pool) => (
                <tr key={pool.name}>
                  <td>{pool.name}</td>

                  <td>{pool.project}</td>

                  <td>{pool.total}</td>

                  <td className="text-green">
                    {pool.available}
                  </td>

                  <td className="text-yellow">
                    {pool.busy}
                  </td>

                  <td className="text-red">
                    {pool.offline}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="table-footer">
        <span>
          Total filtrados: {totalPools} pools
        </span>

        <div className="pagination">
          <button disabled>
            Anterior
          </button>

          <span>
            {totalPools === 0 ? "0 / 0" : "1 / 1"}
          </span>

          <button disabled>
            Siguiente
          </button>
        </div>
      </div>
    </section>
  );
}

/*AVAILABILITY CHART*/

function AvailabilityChart({
  available = 0,
  busy = 0,
  offline = 0
}) {
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <h3>
            Disponibilidad de Agentes (24h)
          </h3>

          <p>
            Historial de concurrencia y salud
            de máquinas.
          </p>
        </div>
      </div>

      <div className="chart-legend">
        <span>
          <i className="legend-dot red-dot" />
          Offline {offline}
        </span>

        <span>
          <i className="legend-dot green-dot" />
          Disponibles {available}
        </span>

        <span>
          <i className="legend-dot yellow-dot" />
          Ocupados {busy}
        </span>
      </div>

      <div className="chart">
        <div className="chart-y-labels">
          <span>70</span>
          <span>60</span>
          <span>40</span>
          <span>20</span>
          <span>0</span>
        </div>

        <svg
          className="chart-svg"
          viewBox="0 0 500 250"
          preserveAspectRatio="none"
          role="img"
          aria-label="Disponibilidad de agentes"
        >
          <g className="chart-grid">
            <line
              x1="0"
              y1="15"
              x2="500"
              y2="15"
            />

            <line
              x1="0"
              y1="65"
              x2="500"
              y2="65"
            />

            <line
              x1="0"
              y1="115"
              x2="500"
              y2="115"
            />

            <line
              x1="0"
              y1="165"
              x2="500"
              y2="165"
            />

            <line
              x1="0"
              y1="215"
              x2="500"
              y2="215"
            />
          </g>

          {/* Línea cero hasta recibir historial real */}
          <path
            className="line-red"
            d="M0 215 L500 215"
          />

          <path
            className="line-green"
            d="M0 215 L500 215"
          />

          <path
            className="line-yellow"
            d="M0 215 L500 215"
          />
        </svg>
      </div>

      <div className="chart-x-labels">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </section>
  );
}

/*HOMOLOGATION*/

/*CREATE COMPONENT MODAL*/

function CreateComponentModal({
  onClose,
  onCreated
}) {
  const [step, setStep] =
    React.useState(1);

  const [url, setUrl] =
    React.useState("");

  const [entityType, setEntityType] =
    React.useState("Component");

  const [name, setName] =
    React.useState("");

  const [description, setDescription] =
    React.useState("");

  const [owner, setOwner] =
    React.useState("");

  const [analyzing, setAnalyzing] =
    React.useState(false);

  const [saving, setSaving] =
    React.useState(false);

  const [error, setError] =
    React.useState("");

  const [success, setSuccess] =
    React.useState(false);

  function validateUrl(value) {
    try {
      const parsed =
        new URL(value);

      return (
        parsed.protocol ===
          "http:" ||
        parsed.protocol ===
          "https:"
      );
    } catch {
      return false;
    }
  }

  async function handleAnalyze() {
    setError("");

    if (!validateUrl(url)) {
      setError(
        "Ingresa una URL válida del repositorio."
      );
      return;
    }

    setAnalyzing(true);

    try {
      /* Backstage lee el catalog-info.yaml sin guardarlo y devuelve la entidad que se crearía. */
      const preview = await catalog.dryRunRegister(url.trim());
      const entity = (preview?.entities ?? [])[0];

      if (!entity) {
        setError(
          "No se encontró ninguna entidad en esa URL. Usa la URL del catalog-info.yaml."
        );
        return;
      }

      setEntityType(entity.kind ?? "Component");
      setName(entity.metadata?.name ?? "");
      setDescription(entity.metadata?.description ?? "");
      setOwner(entity.spec?.owner ?? "");

      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  function handleNext() {
    setError("");

    if (step === 1) {
      handleAnalyze();
      return;
    }

    if (step === 2) {
      setStep(3);
      return;
    }

    if (step === 3) {
      setStep(4);
    }
  }

  function handleBack() {
    setError("");

    if (step > 1) {
      setStep(step - 1);
    }
  }

  async function handleFinish() {
    setError("");
    setSaving(true);

    const payload = {
      url,
      type: entityType,
      name,
      description,
      owner
    };

    try {
      await catalog.register(url.trim());

      setSuccess(true);

      if (onCreated) {
        onCreated(payload);
      }
    } catch (err) {
      setError(
        err.message ||
          "No fue posible registrar el componente."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (
          e.target ===
          e.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div
        className="create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
      >
        <div className="create-modal-header">
          <div>
            <span className="module-eyebrow">
              CATALOG
            </span>

            <h2 id="create-title">
              Registrar un componente
            </h2>

            <p>
              Agrega un componente existente
              al catálogo Gravity.
            </p>
          </div>

          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={19} />
          </button>
        </div>

        <div className="create-steps">
          {[
            {
              number: 1,
              title: "Seleccionar URL"
            },
            {
              number: 2,
              title: "Import Actions"
            },
            {
              number: 3,
              title: "Review"
            },
            {
              number: 4,
              title: "Finish"
            }
          ].map((item) => (
            <div
              key={item.number}
              className={`create-step ${
                step >= item.number
                  ? "completed"
                  : ""
              } ${
                step === item.number
                  ? "current"
                  : ""
              }`}
            >
              <div className="create-step-number">
                {step > item.number ? (
                  <Check size={14} />
                ) : (
                  item.number
                )}
              </div>

              <span>
                {item.title}
              </span>
            </div>
          ))}
        </div>

        <div className="create-modal-body">
          {step === 1 && (
            <div className="create-step-content">
              <div className="create-info">
                <UploadCloud size={22} />

                <div>
                  <strong>
                    Vincula un componente existente
                  </strong>

                  <p>
                    Ingresa la URL del archivo
                    de entidad o del repositorio
                    que deseas registrar.
                  </p>
                </div>
              </div>

              <label>
                URL *
                <input
                  value={url}
                  onChange={(e) =>
                    setUrl(
                      e.target.value
                    )
                  }
                  placeholder=""
                  autoFocus
                />
              </label>

              <small className="input-help">
                <strong>
                  {" "}
                </strong>
              
              </small>
            </div>
          )}

          {step === 2 && (
            <div className="create-step-content">
              <div className="analysis-success">
                <CheckCircle
                  size={24}
                />

                <div>
                  <strong>
                    URL validada
                  </strong>

                  <span>
                    El recurso está listo
                    para continuar con el
                    registro.
                  </span>
                </div>
              </div>

              <label>
                Tipo de entidad
                <select
                  value={entityType}
                  disabled
                  onChange={(e) =>
                    setEntityType(
                      e.target.value
                    )
                  }
                >
                  <option>
                    Component
                  </option>

                  <option>
                    API
                  </option>

                  <option>
                    Resource
                  </option>

                  <option>
                    System
                  </option>
                </select>
              </label>

              <label>
                Nombre del componente *
                <input
                  value={name}
                  disabled
                  onChange={(e) =>
                    setName(
                      e.target.value
                    )
                  }
                  placeholder="nombre-del-componente"
                />
              </label>

              <label>
                Descripción
                <textarea
                  value={description}
                  disabled
                  onChange={(e) =>
                    setDescription(
                      e.target.value
                    )
                  }
                  placeholder="Descripción del componente..."
                  rows="3"
                />
              </label>

              <label>
                Owner
                <input
                  value={owner}
                  disabled
                  onChange={(e) =>
                    setOwner(
                      e.target.value
                    )
                  }
                  placeholder="Equipo responsable"
                />
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="create-step-content">
              <div className="review-card">
                <div className="review-row">
                  <span>
                    Tipo
                  </span>

                  <strong>
                    {entityType}
                  </strong>
                </div>

                <div className="review-row">
                  <span>
                    Nombre
                  </span>

                  <strong>
                    {name ||
                      "Sin nombre"}
                  </strong>
                </div>

                <div className="review-row">
                  <span>
                    Owner
                  </span>

                  <strong>
                    {owner ||
                      "Sin owner"}
                  </strong>
                </div>

                <div className="review-row">
                  <span>
                    URL
                  </span>

                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>
                      {url}
                    </span>

                    <ExternalLink
                      size={14}
                    />
                  </a>
                </div>

                <div className="review-description">
                  <span>
                    Descripción
                  </span>

                  <p>
                    {description ||
                      "Sin descripción"}
                  </p>
                </div>
              </div>

              <div className="create-warning">
                <AlertTriangle
                  size={17}
                />

                <span>
                  Revisa la información
                  antes de registrar el
                  componente.
                </span>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="create-finish">
              {success ? (
                <>
                  <div className="finish-icon">
                    <Check size={30} />
                  </div>

                  <h3>
                    Componente registrado
                  </h3>

                  <p>
                    El componente{" "}
                    <strong>
                      {name}
                    </strong>{" "}
                    fue enviado para
                    registrarse en el
                    catálogo.
                  </p>

                  <button
                    className="create-primary-button"
                    onClick={onClose}
                  >
                    Finalizar
                  </button>
                </>
              ) : (
                <>
                  <div className="finish-icon pending">
                    <GitBranch
                      size={30}
                    />
                  </div>

                  <h3>
                    Listo para registrar
                  </h3>

                  <p>
                    Se utilizará la
                    información revisada
                    para crear el componente.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="create-error">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {!success && (
          <div className="create-modal-footer">
            <button
              className="create-secondary-button"
              onClick={
                step === 1
                  ? onClose
                  : handleBack
              }
            >
              {step === 1 ? (
                "Cancelar"
              ) : (
                <>
                  <ArrowLeft size={15} />
                  Atrás
                </>
              )}
            </button>

            {step < 4 ? (
              <button
                className="create-primary-button"
                onClick={handleNext}
                disabled={
                  analyzing ||
                  (step === 2 &&
                    !name)
                }
              >
                {analyzing ? (
                  <>
                    <Loader2
                      size={16}
                      className="spin"
                    />
                    Analizando...
                  </>
                ) : (
                  <>
                    {step === 1
                      ? "Analizar"
                      : "Continuar"}

                    <ArrowRight
                      size={16}
                    />
                  </>
                )}
              </button>
            ) : (
              <button
                className="create-primary-button"
                onClick={
                  handleFinish
                }
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2
                      size={16}
                      className="spin"
                    />
                    Registrando...
                  </>
                ) : (
                  <>
                    Registrar componente
                    <Check
                      size={16}
                    />
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/*TAREAS RECIENTES DEL IDP*/

function RecentTasks({ version }) {
  const [tasks, setTasks] =
    React.useState([]);

  const [error, setError] =
    React.useState("");

  const [openTask, setOpenTask] =
    React.useState(null);

  const load = React.useCallback(
    async () => {
      try {
        const response =
          await scaffolder.tasks(15);

        setTasks(response.tasks ?? []);
        setError("");
      } catch (err) {
        setError(err.message);
      }
    },
    []
  );

  React.useEffect(() => {
    load();

    const interval =
      setInterval(load, 10000);

    return () =>
      clearInterval(interval);
  }, [load, version]);

  return (
    <div className="module-panel panel-spaced">
      <div className="panel-title">
        <strong>Tareas recientes</strong>
        <small>
          Historial de ejecuciones de plantillas
          (Golden Paths y operaciones)
        </small>
      </div>

      {error && (
        <div className="module-error">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <div className="table-wrapper">
        <table className="pool-table">
          <thead>
            <tr>
              <th>Plantilla</th>
              <th>Estado</th>
              <th>Creada</th>
              <th>Por</th>
              <th>Acción</th>
            </tr>
          </thead>

          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td
                  colSpan="5"
                  className="empty-table"
                >
                  Sin tareas ejecutadas.
                </td>
              </tr>
            )}

            {tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  {task.spec?.templateInfo?.entityRef?.replace(
                    "template:default/",
                    ""
                  )}
                </td>

                <td>
                  <TaskStatus
                    status={task.status}
                  />
                </td>

                <td>
                  {formatDate(
                    task.createdAt
                  )}
                </td>

                <td>
                  {task.createdBy?.replace(
                    "user:",
                    ""
                  ) ?? "anónimo"}
                </td>

                <td>
                  <button
                    className="pipeline-action"
                    onClick={() =>
                      setOpenTask(task.id)
                    }
                  >
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openTask && (
        <div
          className="modal-overlay"
          onMouseDown={(e) =>
            e.target ===
              e.currentTarget &&
            setOpenTask(null)
          }
        >
          <div className="create-modal">
            <div className="create-modal-header">
              <div>
                <span className="module-eyebrow">
                  TAREA
                </span>

                <h2>
                  Detalle de la ejecución
                </h2>
              </div>

              <button
                className="modal-close"
                onClick={() =>
                  setOpenTask(null)
                }
                aria-label="Cerrar"
              >
                <X size={19} />
              </button>
            </div>

            <TaskViewer
              taskId={openTask}
              onClose={() =>
                setOpenTask(null)
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

/*PIPELINE ENGINE*/

function PipelineEnginePage() {
  const [search, setSearch] =
    React.useState("");

  const [environment, setEnvironment] =
    React.useState("Todos");

  const [selectedPipeline, setSelectedPipeline] =
    React.useState(null);

  const [pipelines, setPipelines] =
    React.useState([]);

  const [loading, setLoading] =
    React.useState(false);

  const [error, setError] =
    React.useState("");

  const [lastUpdated, setLastUpdated] =
    React.useState(null);

  const [showCreate, setShowCreate] =
    React.useState(false);

  const [showRegister, setShowRegister] =
    React.useState(false);

  const [tasksVersion, setTasksVersion] =
    React.useState(0);

  const loadPipelines = React.useCallback(
    async () => {
      setLoading(true);
      setError("");

      try {
        const response =
          await branching.pipelines();

        if (!response) {
          setPipelines([]);
          return;
        }

        const data =
          Array.isArray(response)
            ? response
            : response.data ??
              response.pipelines ??
              response.items ??
              [];

        setPipelines(
          data.map(normalizePipeline)
        );

        setLastUpdated(
          new Date()
        );
      } catch {
        setError(
          "No fue posible consultar los pipelines. Se conservan los últimos datos."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  React.useEffect(() => {
    loadPipelines();

    const interval =
      setInterval(
        loadPipelines,
        30000
      );

    return () =>
      clearInterval(
        interval
      );
  }, [loadPipelines]);

  const filtered =
    pipelines.filter(
      (pipeline) => {
        const matchesSearch =
          `${pipeline.name} ${pipeline.branch}`
            .toLowerCase()
            .includes(
              search.toLowerCase()
            );

        const matchesEnvironment =
          environment === "Todos" ||
          pipeline.environment ===
            environment;

        return (
          matchesSearch &&
          matchesEnvironment
        );
      }
    );

  const executions =
    pipelines.reduce(
      (sum, pipeline) =>
        sum +
        Number(
          pipeline.executions || 0
        ),
      0
    );

  const environments =
    new Set(
      pipelines
        .map(
          (x) =>
            x.environment
        )
        .filter(
          (x) =>
            x &&
            x !== "—"
        )
    ).size;

  const readyCount =
    pipelines.filter(
      (x) =>
        x.status === "Exitosa"
    ).length;

  function formatUpdated() {
    if (!lastUpdated) {
      return "Sin actualización";
    }

    return lastUpdated.toLocaleTimeString(
      "es-MX",
      {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }
    );
  }

  return (
    <section className="module-page">
      <div className="module-heading">
        <div>
          <span className="module-eyebrow">
            AUTOMATIZACIÓN
          </span>

          <h1>
            Pipeline Engine (IDP)
          </h1>

          <p>
            Consulta pipelines, revisa su
            configuración y simula el flujo
            de ejecución de una entrega.
          </p>
        </div>

        <div className="pipeline-header-actions">
          <button
            className="pipeline-action"
            onClick={() =>
              setShowRegister(true)
            }
          >
            Registrar existente
          </button>

          <button
            className="create-button"
            onClick={() =>
              setShowCreate(true)
            }
          >
            <Plus size={17} />
            Create
          </button>
        </div>
      </div>

      <div className="homologation-stats">
        <div className="homologation-stat">
          <span>
            Pipelines registrados
          </span>

          <strong>
            {pipelines.length}
          </strong>
        </div>

        <div className="homologation-stat">
          <span>
            Última ejecución exitosa
          </span>

          <strong>
            {readyCount}
          </strong>
        </div>

        <div className="homologation-stat">
          <span>
            Ejecuciones realizadas
          </span>

          <strong>
            {executions}
          </strong>
        </div>

        <div className="homologation-stat">
          <span>
            Entornos disponibles
          </span>

          <strong>
            {environments}
          </strong>
        </div>
      </div>

      <div className="module-panel">
        <div className="pipeline-toolbar">
          <div className="search-input-wrapper">
            <Search size={16} />

            <input
              value={search}
              onChange={(e) =>
                setSearch(
                  e.target.value
                )
              }
              placeholder="Buscar pipeline..."
            />
          </div>

          <select
            value={environment}
            onChange={(e) =>
              setEnvironment(
                e.target.value
              )
            }
          >
            <option>Todos</option>

            {[
              ...new Set(
                pipelines
                  .map((x) => x.environment)
                  .filter((x) => x && x !== "—")
              )
            ].map((option) => (
              <option key={option}>
                {option}
              </option>
            ))}
          </select>

          <button
            className="refresh-module-button"
            onClick={
              loadPipelines
            }
            disabled={loading}
            title="Actualizar información"
          >
            <RefreshCw
              size={16}
              className={
                loading
                  ? "spin"
                  : ""
              }
            />
          </button>
        </div>

        {error && (
          <div className="module-error">
            <AlertTriangle
              size={16}
            />
            {error}
          </div>
        )}

        <div className="table-wrapper">
          <table className="pool-table">
            <thead>
              <tr>
                <th>Pipeline</th>
                <th>Tipo</th>
                <th>Ambiente</th>
                <th>Rama</th>
                <th>Estado</th>
                <th>
                  Última ejecución
                </th>
                <th>Acción</th>
              </tr>
            </thead>

            <tbody>
              {loading &&
                pipelines.length === 0 && (
                  <tr>
                    <td
                      colSpan="7"
                      className="empty-table"
                    >
                      <Loader2
                        size={18}
                        className="spin"
                      />
                      Consultando información...
                    </td>
                  </tr>
                )}

              {!loading &&
                filtered.length ===
                  0 && (
                  <tr>
                    <td
                      colSpan="7"
                      className="empty-table"
                    >
                      No hay pipelines
                      disponibles.
                    </td>
                  </tr>
                )}

              {filtered.map(
                (pipeline) => (
                  <tr
                    key={
                      pipeline.id
                    }
                  >
                    <td>
                      {pipeline.name}
                    </td>

                    <td>
                      {pipeline.type}
                    </td>

                    <td>
                      {
                        pipeline.environment
                      }
                    </td>

                    <td>
                      {pipeline.branch}
                    </td>

                    <td>
                      <PipelineStatus
                        status={pipeline.status}
                      />
                    </td>

                    <td>
                      {
                        pipeline.lastRun
                      }
                    </td>

                    <td>
                      <button
                        className="pipeline-action"
                        onClick={() =>
                          setSelectedPipeline(
                            pipeline
                          )
                        }
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>

        {selectedPipeline && (
          <div className="pipeline-detail">
            <div className="pipeline-detail-header">
              <div>
                <span className="module-eyebrow">
                  DETALLE DEL PIPELINE
                </span>

                <h2>
                  {
                    selectedPipeline.name
                  }
                </h2>
              </div>

              <button
                className="pipeline-action"
                onClick={() =>
                  setSelectedPipeline(
                    null
                  )
                }
              >
                Cerrar
              </button>
            </div>

            <div className="pipeline-flow">
              <div className="pipeline-step">
                <strong>
                  1. Código
                </strong>

                <span>
                  Rama:{" "}
                  {
                    selectedPipeline.branch
                  }
                </span>
              </div>

              <div className="pipeline-step">
                <strong>
                  2. Build
                </strong>

                <span>
                  Información recibida
                  desde el pipeline.
                </span>
              </div>

              <div className="pipeline-step">
                <strong>
                  3. Validaciones
                </strong>

                <span>
                  Validaciones
                  configuradas.
                </span>
              </div>

              <div className="pipeline-step">
                <strong>
                  4. Deploy
                </strong>

                <span>
                  Ambiente:{" "}
                  {
                    selectedPipeline.environment
                  }
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="module-footer-info">
          <span>
            Última actualización:{" "}
            {formatUpdated()}
          </span>

          <span>
            Backstage · /api/branching/pipelines
          </span>
        </div>
      </div>

      <RecentTasks version={tasksVersion} />

      {showCreate && (
        <TemplateModal
          onClose={() =>
            setShowCreate(false)
          }
          onFinished={() => {
            setTasksVersion((v) => v + 1);
            loadPipelines();
          }}
        />
      )}

      {showRegister && (
        <CreateComponentModal
          onClose={() =>
            setShowRegister(false)
          }
          onCreated={() => {
            loadPipelines();
          }}
        />
      )}
    </section>
  );
}

/*POOL DE AGENTES*/

function AgentPoolsPage() {
  const [pools, setPools] =
    React.useState([]);

  const [loading, setLoading] =
    React.useState(false);

  const [error, setError] =
    React.useState("");

  const [lastUpdated, setLastUpdated] =
    React.useState(null);

  const loadPools = React.useCallback(
    async () => {
      setLoading(true);
      setError("");

      try {
        const response =
          await branching.agentPools();

        if (!response) {
          setPools([]);
          return;
        }

        const data =
          Array.isArray(response)
            ? response
            : response.data ??
              response.pools ??
              response.items ??
              [];

        setPools(
          data.map(normalizePool)
        );

        setLastUpdated(
          new Date()
        );
      } catch {
        setError(
          "No fue posible consultar los pools. Se conservan los últimos datos."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  React.useEffect(() => {
    loadPools();

    const interval =
      setInterval(
        loadPools,
        30000
      );

    return () =>
      clearInterval(
        interval
      );
  }, [loadPools]);

  const totalAgents =
    pools.reduce(
      (sum, pool) =>
        sum + pool.total,
      0
    );

  const available =
    pools.reduce(
      (sum, pool) =>
        sum + pool.available,
      0
    );

  const busy =
    pools.reduce(
      (sum, pool) =>
        sum + pool.busy,
      0
    );

  const offline =
    pools.reduce(
      (sum, pool) =>
        sum + pool.offline,
      0
    );

  const utilization =
    totalAgents > 0
      ? (
          (busy /
            totalAgents) *
          100
        ).toFixed(1)
      : "0.0";

  const metrics = [
    {
      label: "POOLS TOTALES",
      value: pools.length,
      detail:
        "Configurados",
      icon: Server,
      color: "blue"
    },
    {
      label: "AGENTES",
      value: totalAgents,
      detail:
        "Nodos detectados",
      icon: Users,
      color: "purple"
    },
    {
      label: "DISPONIBLES",
      value: available,
      detail:
        totalAgents > 0
          ? `${(
              (available /
                totalAgents) *
              100
            ).toFixed(0)}% del total`
          : "0% del total",
      icon: CheckCircle,
      color: "green"
    },
    {
      label: "OCUPADOS",
      value: busy,
      detail:
        `${utilization}% del total`,
      icon: Activity,
      color: "yellow"
    },
    {
      label: "OFFLINE",
      value: offline,
      detail:
        totalAgents > 0
          ? `${(
              (offline /
                totalAgents) *
              100
            ).toFixed(0)}% del total`
          : "0% del total",
      icon: AlertTriangle,
      color: "red"
    },
    {
      label: "UTILIZACIÓN",
      value: `${utilization}%`,
      detail:
        "Capacidad utilizada",
      icon: Gauge,
      color: "green"
    },
    {
      label: "COLA PROMEDIO",
      value: "0 min",
      detail:
        "Espera estimada",
      icon: Clock,
      color: "cyan"
    }
  ];

  const formattedTime =
    lastUpdated
      ? lastUpdated.toLocaleTimeString(
          "es-MX",
          {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          }
        )
      : "Sin actualización";

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="title-line">
            <h1>
              Pools de Agentes
            </h1>

            <span className="azure-tag">
              Azure DevOps
            </span>
          </div>

          <p>
            Monitoreo en tiempo real de
            pools y agentes de compilación
            distribuidos.
          </p>
        </div>

        <div className="updated">
          <span>
            Última actualización:
          </span>

          <strong>
            {formattedTime}
          </strong>

          <button
            title="Actualizar"
            onClick={loadPools}
            disabled={loading}
          >
            <RefreshCw
              size={15}
              className={
                loading
                  ? "spin"
                  : ""
              }
            />
          </button>
        </div>
      </div>

      {error && (
        <div className="module-error">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <section className="metrics-grid">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            metric={metric}
          />
        ))}
      </section>

      <section className="dashboard-grid">
        <PoolTable
          pools={pools}
        />

        <AvailabilityChart
          available={available}
          busy={busy}
          offline={offline}
        />
      </section>

      <div className="demo-notice">
        <span className="demo-indicator" />

        {error ? "No se pudo consultar Backstage." : "Información actualizada desde Backstage (Azure DevOps)."}
      </div>
    </>
  );
}

/*PLACEHOLDER*/

function PlaceholderPage({ title }) {
  return (
    <section className="module-page">
      <div className="module-heading">
        <div>
          <span className="module-eyebrow">
            GRAVITY
          </span>

          <h1>{title}</h1>

          <p>
            Esta sección estará disponible
            próximamente.
          </p>
        </div>
      </div>
    </section>
  );
}

/*APP*/

function App() {
  const [
    selectedPage,
    setSelectedPage
  ] = React.useState(
    "Resumen"
  );

  const [entityRef, setEntityRef] =
    React.useState(null);

  const navigate = React.useCallback(
    (page) => {
      setEntityRef(null);
      setSelectedPage(page);
    },
    []
  );

  const navValue = React.useMemo(
    () => ({
      openEntity: setEntityRef,
      navigate
    }),
    [navigate]
  );

  return (
    <NavContext.Provider value={navValue}>
    <div className="app">
      <NewVersionBanner />
      <Sidebar
        selectedPage={
          entityRef
            ? "Catálogo"
            : selectedPage
        }
        onNavigate={navigate}
      />

      <main className="main">
        <header className="top-header">
          <div className="brand">
            <div className="brand-name">
              GRAVITY{" "}
              <span className="infinity">
                ∞
              </span>
            </div>

            <div className="brand-subtitle">
              DEVSECOPS INTELLIGENCE PLATFORM
            </div>
          </div>

          <div className="header-right">
            <GlobalSearch />

            <div className="organization">
              <small>
                AZURE ORGANIZATION
              </small>

              <button>
                <GitBranch
                  size={13}
                />

                Coppel-Retail

                <ChevronDown
                  size={14}
                />
              </button>
            </div>

            <div className="online-status">
              <span className="online-dot" />

              <strong>
                ONLINE
              </strong>

              <small>
                Pre Production
              </small>
            </div>
          </div>
        </header>

        <div className="dashboard-content">
          {entityRef && (
            <EntityPage
              reference={entityRef}
              onBack={() =>
                setEntityRef(null)
              }
            />
          )}

          {!entityRef && selectedPage ===
            "Catálogo" && (
            <CatalogPage />
          )}

          {!entityRef && selectedPage === "Resumen" && (
            <SummaryPage
              onNavigate={setSelectedPage}
            />
          )}

          {!entityRef && selectedPage === "Repositories" && (
            <RepositoriesPage />
          )}

          {!entityRef && selectedPage === "Pipelines" && (
            <PipelinesPage />
          )}

          {!entityRef && selectedPage === "Releases" && (
            <ReleasesPage />
          )}

          {!entityRef && selectedPage === "TechDebt" && (
            <TechDebtPage />
          )}

          {!entityRef && selectedPage ===
            "Pool de Agentes" && (
            <AgentPoolsPage />
          )}

          {!entityRef && selectedPage ===
            "Compliance IQ" && (
            <ComplianceIqPage />
          )}

          {!entityRef && selectedPage ===
            "Tools Health" && (
            <ToolsHealthPage />
          )}

          {!entityRef && selectedPage ===
            "Homologation Status" && (
            <HomologationPage />
          )}

          {!entityRef && selectedPage ===
            "Pipeline Engine (IDP)" && (
            <PipelineEnginePage />
          )}

          {!entityRef && ![
            "Resumen",
            "Catálogo",
            "Repositories",
            "Pipelines",
            "Releases",
            "TechDebt",
            "Pool de Agentes",
            "Compliance IQ",
            "Tools Health",
            "Homologation Status",
            "Pipeline Engine (IDP)"
          ].includes(
            selectedPage
          ) && (
            <PlaceholderPage
              title={
                selectedPage
              }
            />
          )}
        </div>
      </main>
    </div>
    </NavContext.Provider>
  );
}

export default App;