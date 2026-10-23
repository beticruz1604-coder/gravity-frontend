import React from "react";
import {
  X,
  Check,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Rocket,
  GitBranch,
  GitPullRequest,
  Workflow,
  RotateCcw
} from "lucide-react";

import {
  PROJECT,
  branching,
  catalog,
  scaffolder,
  isDeployable,
  repoOf
} from "./backstage";
import { TASK_STATUS_TEXT, TaskStatus } from "./status";

/*
 * Ejecutor de plantillas de Backstage dentro de GRAVITY.
 *
 *  - TemplateModal: galería de plantillas → formulario → ejecución de la tarea.
 *  - TemplateForm:  renderiza el parameter-schema de Backstage (incluye `dependencies/oneOf`, enumNames y los campos propios
 *                   ComponentPicker, BranchPicker, RepositoryName, PullRequestPreview y OwnerPicker).
 *  - TaskViewer:    sigue una tarea (estado, pasos, log, enlaces y resumen de salida).
 */

const GOLDEN_TAG = "golden-path";

/* ---------------------------------------------------------------- Esquema */

/** Propiedades y obligatorios efectivos de un paso, resolviendo `dependencies` con `oneOf` según los valores actuales. */
export function resolveSchema(schema = {}, values = {}) {
  const properties = { ...schema.properties };
  const required = new Set(schema.required ?? []);

  for (const [key, dependency] of Object.entries(schema.dependencies ?? {})) {
    const options = dependency?.oneOf ?? [];
    const match = options.find((option) => {
      const rule = option.properties?.[key];
      if (!rule) {
        return false;
      }
      const allowed = rule.enum ?? (rule.const !== undefined ? [rule.const] : []);
      return allowed.includes(values[key]);
    });

    if (!match) {
      continue;
    }

    for (const [name, definition] of Object.entries(match.properties ?? {})) {
      if (name !== key) {
        properties[name] = definition;
      }
    }
    (match.required ?? []).forEach((name) => required.add(name));
  }

  return { properties, required };
}

function validateStep(schema, values) {
  const { properties, required } = resolveSchema(schema, values);
  const errors = {};

  for (const [name, definition] of Object.entries(properties)) {
    const value = values[name];
    const empty = value === undefined || value === null || value === "";

    if (definition["ui:field"] === "PullRequestPreview") {
      if (required.has(name) && value !== "ok") {
        errors[name] = "La estrategia no permite esta integración.";
      }
      continue;
    }

    if (definition["ui:field"] === "BranchNamePreview") {
      if (required.has(name) && value !== "ok") {
        errors[name] = "La rama ya existe o no cumple la estrategia: corrige los datos del paso anterior.";
      }
      continue;
    }

    if (empty) {
      if (required.has(name) && definition.type !== "boolean") {
        errors[name] = "Campo obligatorio.";
      }
      continue;
    }

    if (definition.pattern && !new RegExp(definition.pattern).test(String(value))) {
      errors[name] = definition.description
        ? `Formato inválido. ${definition.description}`
        : "Formato inválido.";
    }
  }

  return errors;
}

/** Valores iniciales a partir de los `default` del esquema. */
function initialValues(steps, preset = {}) {
  const values = {};
  for (const step of steps) {
    for (const [name, definition] of Object.entries(step.schema?.properties ?? {})) {
      if (definition.default !== undefined) {
        values[name] = definition.default;
      }
    }
  }
  return { ...values, ...preset };
}

/** Quita los valores de campos que ya no aplican (p. ej. el id de Jira al dejar de ser hotfix). */
function effectiveValues(steps, values) {
  const result = {};
  for (const step of steps) {
    const { properties } = resolveSchema(step.schema, values);
    for (const name of Object.keys(properties)) {
      if (values[name] !== undefined && values[name] !== "") {
        result[name] = values[name];
      }
    }
  }
  return result;
}

/* ----------------------------------------------------------------- Campos */

function useAsync(loader, deps) {
  const [state, setState] = React.useState({ loading: true });

  React.useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    loader()
      .then((data) => !cancelled && setState({ data }))
      .catch((error) => !cancelled && setState({ error: error.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

function Help({ children, error }) {
  if (!children) {
    return null;
  }
  return (
    <small className={error ? "field-error" : "field-help"}>{children}</small>
  );
}

function FieldShell({ definition, required, error, help, children }) {
  return (
    <label>
      {definition.title}
      {required ? " *" : ""}
      {children}
      <Help error={Boolean(error)}>{error || help || definition.description}</Help>
    </label>
  );
}

const refName = (ref) => String(ref ?? "").split("/").pop();
const relatedTo = (entity, type) => (entity.relations ?? []).filter((r) => r.type === type).map((r) => refName(r.targetRef));

/** Ficha del componente elegido: lo que el catálogo sabe de él, para confirmar que es el que se quiere antes de continuar. */
function ComponentCard({ entity }) {
  const { metadata, spec = {} } = entity;
  const ann = metadata.annotations ?? {};
  const rows = [
    ["Propietario", relatedTo(entity, "ownedBy").join(", ") || refName(spec.owner)],
    ["Sistema", refName(spec.system)],
    ["Tipo / ciclo de vida", [spec.type, spec.lifecycle].filter(Boolean).join(" · ")],
    ["Repositorio", ann["dev.azure.com/project-repo"]],
    ["Pipeline", ann["dev.azure.com/build-definition"]],
    ["Depende de", relatedTo(entity, "dependsOn").join(", ")],
    ["Lo usan", relatedTo(entity, "dependencyOf").join(", ")],
    ["APIs que ofrece", relatedTo(entity, "providesApi").join(", ")],
    ["APIs que consume", relatedTo(entity, "consumesApi").join(", ")],
  ].filter(([, v]) => v);
  return (
    <div className="preview-box" data-testid="component-card">
      <strong>{metadata.title ?? metadata.name}</strong>
      {metadata.description && <p>{metadata.description}</p>}
      <dl className="component-card">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {(metadata.tags ?? []).length > 0 && (
        <div className="chip-row">
          {metadata.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}
        </div>
      )}
    </div>
  );
}

function ComponentField({ definition, required, value, onChange, error }) {
  const state = useAsync(() => catalog.components(), []);
  const items = (state.data ?? []).filter(isDeployable);

  return (
    <FieldShell
      definition={definition}
      required={required}
      error={error || state.error}
      help={
        state.loading
          ? "Consultando el catálogo…"
          : items.length === 0
            ? "No hay componentes con repositorio y pipeline de Azure DevOps."
            : undefined
      }
    >
      <select
        value={value ?? ""}
        disabled={state.loading}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">Selecciona un componente</option>
        {items.map((entity) => (
          <option key={entity.metadata.name} value={entity.metadata.name}>
            {entity.metadata.title && entity.metadata.title !== entity.metadata.name
              ? `${entity.metadata.title} (${entity.metadata.name})`
              : entity.metadata.name}
            {entity.metadata.annotations?.["devops.lab/golden-path"] ? " · Golden Path" : ""}
          </option>
        ))}
      </select>
      {value && items.find((e) => e.metadata.name === value) && (
        <ComponentCard entity={items.find((e) => e.metadata.name === value)} />
      )}
    </FieldShell>
  );
}

function OwnerField({ definition, required, value, onChange, error }) {
  const state = useAsync(() => catalog.groups(), []);
  const groups = state.data ?? [];

  // Si el catálogo no responde se deja escribir la referencia a mano.
  if (state.error) {
    return (
      <FieldShell definition={definition} required={required} error={error}>
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="group:default/development" />
      </FieldShell>
    );
  }

  return (
    <FieldShell definition={definition} required={required} error={error}>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} disabled={state.loading}>
        <option value="">Selecciona un grupo</option>
        {groups.map((group) => {
          const ref = `group:${group.metadata.namespace ?? "default"}/${group.metadata.name}`;
          return (
            <option key={ref} value={ref}>
              {group.metadata.title ?? group.metadata.name}
            </option>
          );
        })}
      </select>
    </FieldShell>
  );
}

function RepositoryNameField({ definition, required, value, onChange, error, options, onBlock }) {
  const project = options?.project ?? PROJECT;
  const [exists, setExists] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const valid = value && new RegExp(definition.pattern ?? ".*").test(value);
  const taken = `Ya existe un repositorio llamado "${value}" en ${project}. Elige otro nombre.`;

  // El paso no avanza mientras el nombre esté ocupado.
  React.useEffect(() => {
    onBlock(exists ? taken : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exists, taken]);

  React.useEffect(() => {
    setExists(false);
    if (!valid) {
      return undefined;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(() => {
      branching
        .repositoryExists(value, project)
        .then((result) => !cancelled && setExists(Boolean(result?.exists)))
        // Sin conexión con Azure DevOps no se bloquea: la tarea lo comprueba otra vez al crear el repositorio.
        .catch(() => undefined)
        .finally(() => !cancelled && setChecking(false));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, valid, project]);

  return (
    <FieldShell
      definition={definition}
      required={required}
      error={error || (exists ? taken : "")}
      help={checking ? "Comprobando si el nombre está libre…" : undefined}
    >
      <input
        value={value ?? ""}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        placeholder="nombre-del-servicio"
      />
    </FieldShell>
  );
}

function BranchField({ definition, required, value, onChange, error, options = {}, form }) {
  const project = options.project ?? PROJECT;
  const repo = form[options.repoField];
  const environment = options.environmentField ? form[options.environmentField] : undefined;
  const newRole = options.roleField ? form[options.roleField] : undefined;
  const sourceName = options.sourceField ? form[options.sourceField] : undefined;

  const state = useAsync(
    () =>
      repo
        ? Promise.all([branching.branches(repo, project), branching.rules()]).then(
            ([branches, rules]) => ({ branches: branches.branches, rules })
          )
        : Promise.resolve(undefined),
    [repo, project]
  );

  const valid = (state.data?.branches ?? []).filter((b) => b.role);
  const rules = state.data?.rules;
  let choices = valid;

  if (options.kind === "source" && environment) {
    choices = valid.filter((b) => b.deployTo.includes(environment));
  }
  if (options.kind === "source" && options.requireMergeTarget) {
    choices = choices.filter((b) => b.mergeInto.length > 0);
  }
  if (options.kind === "base") {
    const from = rules?.branches.find((b) => b.id === newRole)?.createdFrom;
    choices = newRole && from ? valid.filter((b) => from.includes(b.role)) : [];
  }
  if (options.kind === "target") {
    const source = valid.find((b) => b.name === sourceName);
    choices = source ? valid.filter((b) => b.name !== source.name && source.mergeInto.includes(b.role)) : [];
  }

  // Si la selección ya no es válida (cambió el ambiente, el origen o el repositorio) se limpia.
  React.useEffect(() => {
    if (state.data && value && !choices.some((c) => c.name === value)) {
      onChange(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data, choices.map((c) => c.name).join("|"), value]);

  let help;
  if (state.error) {
    help = `No se pudieron cargar las ramas: ${state.error}.`;
  } else if (!repo) {
    help = "Elige primero el componente.";
  } else if (state.loading) {
    help = "Cargando ramas de Azure DevOps…";
  } else if (options.kind === "base" && !newRole) {
    help = "Elige primero el tipo de rama.";
  } else if (options.kind === "base") {
    help = `Una rama ${newRole} se crea a partir de: ${rules?.branches.find((b) => b.id === newRole)?.createdFrom?.join(", ") ?? "cualquier rama"}.`;
  } else if (options.kind === "source" && environment && rules?.deployments?.[environment]) {
    help = `En ${environment} solo se despliegan ramas de tipo: ${rules.deployments[environment].join(", ")}.`;
  } else {
    help = definition.description;
  }

  const hidden = (state.data?.branches ?? []).length - valid.length;
  if (hidden > 0 && !state.error) {
    help = `${help ?? ""} (${hidden} rama(s) no cumplen las convenciones de nombres y no se muestran.)`.trim();
  }

  return (
    <FieldShell definition={definition} required={required} error={error} help={help}>
      <select
        value={value ?? ""}
        disabled={!repo || state.loading || choices.length === 0}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">
          {choices.length === 0 && repo && !state.loading ? "Sin ramas disponibles" : "Selecciona una rama"}
        </option>
        {choices.map((branch) => (
          <option key={branch.name} value={branch.name}>
            {branch.name} · {branch.role}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

function PreviewField({ definition, onChange, options = {}, form }) {
  const repo = form[options.repoField];
  const source = form[options.sourceField];
  const [state, setState] = React.useState({});

  React.useEffect(() => {
    setState({});
    if (!repo || !source) {
      onChange(undefined);
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true });
    const timer = setTimeout(() => {
      branching
        .preview({ project: options.project ?? PROJECT, repo, sourceBranch: source })
        .then((preview) => {
          if (!cancelled) {
            setState({ preview });
            onChange(preview.valid ? "ok" : undefined);
          }
        })
        .catch((err) => {
          // Sin conexión con Azure DevOps no se bloquea: el servidor vuelve a validar al ejecutar.
          if (!cancelled) {
            setState({ error: err.message });
            onChange("ok");
          }
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, source, options.project]);

  const { preview, error, loading } = state;
  let body;

  if (!repo || !source) {
    body = <p>Elige el componente y la rama para ver qué hará la estrategia.</p>;
  } else if (loading) {
    body = <p>Calculando el destino según la estrategia…</p>;
  } else if (error) {
    body = <p>No se pudo calcular la vista previa ({error}). Se validará al ejecutar.</p>;
  } else if (preview) {
    const { plan } = preview;
    body = (
      <>
        <p>{plan.reason}</p>
        {plan.createPullRequest && (
          <div className="chip-row">
            <span className="chip">Destino: {plan.targetBranch}</span>
            {preview.mergeStrategy && <span className="chip">Fusión: {preview.mergeStrategy}</span>}
            <span className="chip">
              {plan.autoComplete ? "Se completa solo al cumplir las políticas" : "Lo completa quien aprueba"}
            </span>
            {preview.level && <span className="chip">Nivel: {preview.level}</span>}
            {preview.autoApprove && <span className="chip chip-accent">Aprobación automática</span>}
          </div>
        )}
        {preview.path && (
          <div className="chip-row">
            <small>Camino hasta producción:</small>
            {preview.path.labels.map((label, i) => (
              <span key={`${label}-${i}`} className={`chip ${i === preview.path.current ? "chip-accent" : ""}`}>
                {label}
              </span>
            ))}
          </div>
        )}
        {plan.createPullRequest && (
          <p>
            Crea: {preview.createdBy.join(", ") || "—"} · Aprueba: {preview.approvedBy.join(", ") || "—"}
          </p>
        )}
        {(preview.errors ?? []).map((message) => (
          <p key={message} className="field-error">{message}</p>
        ))}
        {(preview.warnings ?? []).map((message) => (
          <p key={message} className="field-warning">{message}</p>
        ))}
      </>
    );
  }

  return (
    <div className={`preview-box ${preview && !preview.valid ? "preview-invalid" : ""}`}>
      <strong>{definition.title}</strong>
      {body}
    </div>
  );
}

/** Datos con los que se compone el nombre de una rama, según su tipo (clave de Jira, descripción, consecutivo y versión). */
const BRANCH_NAME_PARTS = ["id", "description", "number", "version"];

/**
 * Comprobación de «Crear una rama» antes de ejecutar: calcula el nombre final, valida las convenciones y consulta si la
 * rama ya existe. Si existe (o no cumple) bloquea el avance: el campo queda vacío hasta que el nombre sea válido y esté libre.
 */
function BranchNameField({ definition, onChange, options = {}, form }) {
  const repo = form[options.repoField];
  const role = form[options.roleField];
  const from = form[options.fromField];
  const parts = BRANCH_NAME_PARTS.map((key) => form[key] ?? "").join("|");
  const [state, setState] = React.useState({});

  React.useEffect(() => {
    setState({});
    if (!repo || !role || !from) {
      onChange(undefined);
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true });
    const timer = setTimeout(() => {
      const body = { project: options.project ?? PROJECT, repo, role, from };
      BRANCH_NAME_PARTS.forEach((key) => {
        if (form[key]) body[key] = form[key];
      });
      branching
        .branchName(body)
        .then((result) => {
          if (!cancelled) {
            setState({ result });
            onChange(result.complete && result.valid ? "ok" : undefined);
          }
        })
        .catch((err) => {
          // Sin conexión no se bloquea: la ejecución vuelve a comprobarlo.
          if (!cancelled) {
            setState({ error: err.message });
            onChange("ok");
          }
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, role, from, parts, options.project]);

  const { result, error, loading } = state;
  let body;

  if (!repo || !role || !from) {
    body = <p>Completa el tipo de rama y de dónde se crea para comprobar el nombre.</p>;
  } else if (loading) {
    body = <p>Comprobando el nombre de la rama…</p>;
  } else if (error) {
    body = <p>No se pudo comprobar la rama ({error}). Se comprobará al ejecutar.</p>;
  } else if (result && !result.complete) {
    body = <p>Faltan datos para componer el nombre de la rama; vuelve al paso anterior.</p>;
  } else if (result) {
    body = result.valid ? (
      <>
        <p>
          Se creará la rama <code>{result.name}</code>.
        </p>
        <p>No existe todavía en {repo}: se puede crear.</p>
      </>
    ) : (
      <>
        <p>
          Se crearía la rama <code>{result.name}</code>.
        </p>
        {result.errors.map((message) => (
          <p key={message} className="field-error">{message}</p>
        ))}
      </>
    );
  }

  return (
    <div className={`preview-box ${result && result.complete && !result.valid ? "preview-invalid" : ""}`}>
      <strong>{definition.title}</strong>
      {body}
    </div>
  );
}

function SchemaField({ name, definition, required, form, set, error, onBlock }) {
  const value = form[name];
  const common = { definition, required, value, error, onChange: (v) => set(name, v) };
  const options = definition["ui:options"];

  switch (definition["ui:field"]) {
    case "ComponentPicker":
      return <ComponentField {...common} />;
    case "OwnerPicker":
      return <OwnerField {...common} />;
    case "RepositoryName":
      return <RepositoryNameField {...common} options={options} onBlock={(message) => onBlock(name, message)} />;
    case "BranchPicker":
      return <BranchField {...common} options={options} form={form} />;
    case "PullRequestPreview":
      return <PreviewField definition={definition} onChange={common.onChange} options={options} form={form} />;
    case "BranchNamePreview":
      return <BranchNameField definition={definition} onChange={common.onChange} options={options} form={form} />;
    default:
      break;
  }

  if (definition.type === "boolean") {
    return (
      <label className="check-field">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => set(name, e.target.checked)} />
        <span>{definition.title}</span>
        <Help>{definition.description}</Help>
      </label>
    );
  }

  if (definition.enum) {
    return (
      <FieldShell definition={definition} required={required} error={error}>
        <select value={value ?? ""} onChange={(e) => set(name, e.target.value || undefined)}>
          {/* Sin valor elegido se muestra un marcador; si no, el navegador pintaría la primera opción como seleccionada. */}
          {(!required || value === undefined) && <option value="">{required ? "Selecciona una opción" : "—"}</option>}
          {definition.enum.map((option, i) => (
            <option key={option} value={option}>
              {definition.enumNames?.[i] ?? option}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  }

  if (definition["ui:widget"] === "textarea") {
    return (
      <FieldShell definition={definition} required={required} error={error}>
        <textarea rows={4} value={value ?? ""} onChange={(e) => set(name, e.target.value)} />
      </FieldShell>
    );
  }

  return (
    <FieldShell definition={definition} required={required} error={error}>
      <input
        type={definition.type === "number" || definition.type === "integer" ? "number" : "text"}
        value={value ?? ""}
        autoFocus={Boolean(definition["ui:autofocus"])}
        onChange={(e) =>
          set(
            name,
            definition.type === "number" || definition.type === "integer"
              ? e.target.value === ""
                ? undefined
                : Number(e.target.value)
              : e.target.value
          )
        }
      />
    </FieldShell>
  );
}

/* ------------------------------------------------------------- Formulario */

function TemplateForm({ name, preset, onSubmit, onBack, backLabel }) {
  const state = useAsync(() => scaffolder.parameterSchema(name), [name]);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [form, setForm] = React.useState(null);
  const [errors, setErrors] = React.useState({});
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState("");
  const [blockers, setBlockers] = React.useState({});
  const setBlocker = React.useCallback(
    (field, message) => setBlockers((current) => (current[field] === message ? current : { ...current, [field]: message })),
    []
  );

  const steps = state.data?.steps ?? [];

  React.useEffect(() => {
    if (state.data) {
      setForm(initialValues(state.data.steps, preset));
      setStepIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data]);

  if (state.loading || (state.data && !form)) {
    return (
      <div className="create-modal-body">
        <div className="runner-loading"><Loader2 size={18} className="spin" /> Cargando la plantilla…</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="create-modal-body">
        <div className="module-error"><AlertTriangle size={16} /> {state.error}</div>
      </div>
    );
  }

  const step = steps[stepIndex];
  const { properties, required } = resolveSchema(step.schema, form);
  const last = stepIndex === steps.length - 1;

  function set(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function next() {
    const found = validateStep(step.schema, form);
    for (const [field, message] of Object.entries(blockers)) {
      if (message && field in properties) {
        found[field] = message;
      }
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    if (!last) {
      setStepIndex(stepIndex + 1);
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      await onSubmit(effectiveValues(steps, form));
    } catch (err) {
      setSubmitError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="create-modal-body">
        <div className="create-step-content">
          {state.data.description && (
            <div className="create-info">
              <GitBranch size={18} />
              <div>
                <strong>{state.data.title}</strong>
                <p>{state.data.description}</p>
              </div>
            </div>
          )}

          {steps.length > 1 && (
            <div className="runner-step-title">
              Paso {stepIndex + 1} de {steps.length}: {step.title}
            </div>
          )}

          {Object.entries(properties).map(([field, definition]) => (
            <SchemaField
              key={field}
              name={field}
              definition={definition}
              required={required.has(field)}
              form={form}
              set={set}
              error={errors[field]}
              onBlock={setBlocker}
            />
          ))}
        </div>
      </div>

      {submitError && (
        <div className="create-error"><AlertTriangle size={16} /><span>{submitError}</span></div>
      )}

      <div className="create-modal-footer">
        <button
          className="create-secondary-button"
          onClick={stepIndex === 0 ? onBack : () => setStepIndex(stepIndex - 1)}
        >
          <ArrowLeft size={15} />
          {stepIndex === 0 ? backLabel : "Atrás"}
        </button>
        <button className="create-primary-button" onClick={next} disabled={submitting}>
          {submitting ? (
            <><Loader2 size={16} className="spin" /> Enviando…</>
          ) : last ? (
            <>Ejecutar <Rocket size={16} /></>
          ) : (
            <>Continuar <ArrowRight size={16} /></>
          )}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Tarea */

const TERMINAL = ["completed", "failed", "cancelled"];

export { TASK_STATUS_TEXT };

export function TaskViewer({ taskId, onClose, onFinished }) {
  const [task, setTask] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [error, setError] = React.useState("");
  const lastEvent = React.useRef(0);
  const finished = React.useRef(false);
  const logRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    let timer;
    lastEvent.current = 0;
    finished.current = false;
    setEvents([]);
    setTask(null);

    let done = false;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function append(fresh) {
      if (fresh.length > 0) {
        lastEvent.current = fresh[fresh.length - 1].id;
        setEvents((all) => [...all, ...fresh]);
      }
    }

    // Estado de la tarea: consulta rápida cada 2 s, independiente de los eventos.
    async function pollStatus() {
      try {
        const current = await scaffolder.task(taskId);
        if (cancelled) {
          return;
        }
        setError("");
        setTask(current);
        if (TERMINAL.includes(current.status)) {
          done = true;
          // Una última lectura de eventos para completar el registro y el resumen de la salida.
          try {
            append(await scaffolder.events(taskId, lastEvent.current));
          } catch {
            /* el registro puede quedar incompleto; el estado ya es el final */
          }
          if (!cancelled && !finished.current) {
            finished.current = true;
            onFinished?.(current);
          }
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      }
      if (!cancelled && !done) {
        timer = setTimeout(pollStatus, 2000);
      }
    }

    // Eventos: Backstage mantiene la consulta abierta hasta ~30 s esperando eventos nuevos (espera larga), así que en los
    // pasos largos y silenciosos tarda ese tiempo en responder. Va en un ciclo aparte y sin aviso de error: un corte de esa
    // espera no es un fallo y no debe impedir que se actualice el estado.
    async function pollEvents() {
      while (!cancelled && !done) {
        try {
          const fresh = await scaffolder.events(taskId, lastEvent.current);
          if (cancelled) {
            return;
          }
          append(fresh);
        } catch {
          await sleep(2000);
        }
        await sleep(300);
      }
    }

    pollStatus();
    pollEvents();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  React.useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events.length]);

  const steps = task?.spec?.steps ?? [];
  const stepStatus = {};
  for (const event of events) {
    if (event.body?.stepId) {
      stepStatus[event.body.stepId] = event.body.status ?? stepStatus[event.body.stepId];
    }
  }
  const completion = [...events].reverse().find((event) => event.type === "completion");
  const output = completion?.body?.output ?? task?.spec?.output ?? null;
  const status = task?.status ?? "open";

  return (
    <>
      <div className="create-modal-body">
        <div className="create-step-content">
          <div className="task-header">
            <TaskStatus status={status} />
            <small>{task?.spec?.templateInfo?.entityRef ?? ""} · {taskId}</small>
            {!TERMINAL.includes(status) && <Loader2 size={16} className="spin" />}
          </div>

          {error && <div className="module-error"><AlertTriangle size={16} /> {error}</div>}

          {steps.length > 0 && (
            <ol className="task-steps">
              {steps.map((step) => {
                const value = stepStatus[step.id];
                return (
                  <li key={step.id} className={`task-step task-step-${value ?? "pending"}`}>
                    <span className="task-step-dot">
                      {value === "completed" ? <Check size={11} /> : value === "processing" ? <Loader2 size={11} className="spin" /> : value === "failed" ? <X size={11} /> : null}
                    </span>
                    {step.name}
                  </li>
                );
              })}
            </ol>
          )}

          {output?.links?.length > 0 && (
            <div className="task-links">
              {output.links
                .filter((link) => link.url)
                .map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="pipeline-action">
                    {link.title} <ExternalLink size={12} />
                  </a>
                ))}
            </div>
          )}

          {(output?.text ?? []).map((block) => (
            <div key={block.title} className="task-summary">
              <strong>{block.title}</strong>
              <pre>{block.content}</pre>
            </div>
          ))}

          <details className="task-log" open={status === "failed"}>
            <summary>Registro de la tarea ({events.filter((e) => e.type === "log").length} líneas)</summary>
            <pre ref={logRef}>
              {events
                .filter((event) => event.type === "log")
                .map((event) => event.body.message)
                .join("\n")}
            </pre>
          </details>
        </div>
      </div>

      <div className="create-modal-footer">
        <span />
        <button className="create-primary-button" onClick={onClose}>
          {TERMINAL.includes(status) ? "Cerrar" : "Seguir en segundo plano"}
        </button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- Galería */

function templateIcon(entity) {
  const tags = entity.metadata.tags ?? [];
  if (tags.includes(GOLDEN_TAG)) {
    return Workflow;
  }
  if (entity.metadata.name === "integrar-cambios") {
    return GitPullRequest;
  }
  if (entity.metadata.name === "crear-rama") {
    return GitBranch;
  }
  if (entity.metadata.name === "redesplegar-version") {
    return RotateCcw;
  }
  return Rocket;
}

function Gallery({ onPick, filter }) {
  const state = useAsync(() => catalog.templates(), []);
  const templates = (state.data ?? []).filter(filter ?? (() => true));
  const golden = templates.filter((t) => t.metadata.tags?.includes(GOLDEN_TAG));
  const operations = templates.filter((t) => !t.metadata.tags?.includes(GOLDEN_TAG));

  function group(title, hint, list) {
    if (list.length === 0) {
      return null;
    }
    return (
      <div className="gallery-group">
        <div className="gallery-title">
          <strong>{title}</strong>
          <small>{hint}</small>
        </div>
        <div className="gallery-grid">
          {list.map((entity) => {
            const Icon = templateIcon(entity);
            return (
              <button key={entity.metadata.name} className="gallery-card" onClick={() => onPick(entity)}>
                <Icon size={18} />
                <strong>{entity.metadata.title ?? entity.metadata.name}</strong>
                <span>{entity.metadata.description}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="create-modal-body">
      {state.loading && <div className="runner-loading"><Loader2 size={18} className="spin" /> Consultando plantillas…</div>}
      {state.error && <div className="module-error"><AlertTriangle size={16} /> {state.error}</div>}
      {group("Nuevo servicio (Golden Path)", "Repositorio, pipeline, despliegue y registro en el catálogo, listos para usar.", golden)}
      {group("Operaciones", "Tareas del flujo de trabajo: integrar, crear ramas y desplegar.", operations)}
    </div>
  );
}

/* ------------------------------------------------------------------ Modal */

/**
 * @param template    nombre de una plantilla para saltarse la galería
 * @param preset      valores iniciales del formulario (p. ej. { component: "test3" })
 * @param filter      filtro de plantillas de la galería
 */
export function TemplateModal({ onClose, template, preset, filter, title = "Create", onFinished }) {
  const [selected, setSelected] = React.useState(template ?? null);
  const [taskId, setTaskId] = React.useState(null);

  const selectedTitle = selected && typeof selected === "object" ? selected.metadata.title : null;
  const name = selected && typeof selected === "object" ? selected.metadata.name : selected;

  async function submit(values) {
    const result = await scaffolder.run(name, values);
    setTaskId(result.id);
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="create-modal" role="dialog" aria-modal="true">
        <div className="create-modal-header">
          <div>
            <span className="module-eyebrow">PIPELINE ENGINE · BACKSTAGE</span>
            <h2>{taskId ? "Ejecución de la tarea" : (selectedTitle ?? title)}</h2>
            <p>
              {taskId
                ? "Sigue el avance; también queda en el historial de tareas."
                : name
                  ? "Completa los datos; Backstage valida la estrategia antes de ejecutar."
                  : "Elige qué quieres hacer."}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={19} /></button>
        </div>

        {taskId ? (
          <TaskViewer taskId={taskId} onClose={onClose} onFinished={onFinished} />
        ) : name ? (
          <TemplateForm
            key={name}
            name={name}
            preset={preset}
            onSubmit={submit}
            onBack={template ? onClose : () => setSelected(null)}
            backLabel={template ? "Cancelar" : "Plantillas"}
          />
        ) : (
          <Gallery onPick={setSelected} filter={filter} />
        )}
      </div>
    </div>
  );
}

/** Botón que abre el modal ya posicionado en una plantilla. */
export function TemplateButton({ template, preset, label, className = "pipeline-action", onFinished, disabled }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button className={className} disabled={disabled} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <TemplateModal
          template={template}
          preset={preset}
          onClose={() => setOpen(false)}
          onFinished={onFinished}
        />
      )}
    </>
  );
}

export { repoOf };
