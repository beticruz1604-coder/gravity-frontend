import React from "react";

/*
 * Colores de estado. Una sola tabla para pipelines y tareas, así el mismo estado se ve igual en todas las pantallas:
 * verde = bien, rojo = falló, azul = en curso, ámbar = con avisos, gris = cancelado o sin datos.
 */

const PIPELINE_STATUS = {
  Exitosa: "success",
  Fallida: "failed",
  "En curso": "running",
  "En cola": "queued",
  "Con avisos": "warning",
  Cancelada: "canceled",
  "Sin ejecuciones": "none"
};

const TASK_STATUS = {
  completed: "success",
  failed: "failed",
  processing: "running",
  open: "queued",
  cancelled: "canceled"
};

export const TASK_STATUS_TEXT = {
  open: "En cola",
  processing: "En ejecución",
  completed: "Completada",
  failed: "Fallida",
  cancelled: "Cancelada"
};

export function pipelineTone(status) {
  return PIPELINE_STATUS[status] ?? "none";
}

export function taskTone(status) {
  return TASK_STATUS[status] ?? "none";
}

/** Insignia de estado: punto de color + texto. */
export function StatusPill({ tone, children }) {
  return (
    <span className={`status-pill status-${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

export function PipelineStatus({ status }) {
  return <StatusPill tone={pipelineTone(status)}>{status}</StatusPill>;
}

export function TaskStatus({ status }) {
  return <StatusPill tone={taskTone(status)}>{TASK_STATUS_TEXT[status] ?? status}</StatusPill>;
}

/** Color del porcentaje de éxito: verde desde 80 %, ámbar desde 50 %, rojo por debajo. */
export function successTone(percent) {
  if (percent === null || percent === undefined) return "none";
  if (percent >= 80) return "success";
  if (percent >= 50) return "warning";
  return "failed";
}

export function Percent({ value }) {
  return value === null || value === undefined ? (
    <span className="status-text status-none">—</span>
  ) : (
    <span className={`status-text status-${successTone(value)}`}>{value}%</span>
  );
}
