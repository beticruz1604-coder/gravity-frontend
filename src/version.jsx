import React from "react";
import { RefreshCw } from "lucide-react";

/**
 * Aviso de versión nueva. Una pestaña abierta antes de un despliegue sigue ejecutando el JavaScript viejo (con sus
 * errores ya corregidos) hasta que se recarga. Cada cierto tiempo, y al volver a la pestaña, se lee index.html (se sirve
 * sin caché) y se compara el script con el que está cargado: si cambió, se ofrece recargar.
 */
const CHECK_EVERY_MS = 5 * 60 * 1000;

function loadedScript() {
  const el = [...document.querySelectorAll("script[src]")].find((s) => /\/assets\/index-[\w-]+\.js/.test(s.src));
  return el ? el.getAttribute("src") : null;
}

export function useNewVersion() {
  const [available, setAvailable] = React.useState(false);

  React.useEffect(() => {
    const current = loadedScript();
    if (!current) {
      return undefined; // modo desarrollo: sin archivos con hash, no hay nada que comparar
    }
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/index.html", { cache: "no-store" });
        if (!res.ok) {
          return;
        }
        const latest = (await res.text()).match(/\/assets\/index-[\w-]+\.js/);
        if (!cancelled && latest && !current.endsWith(latest[0])) {
          setAvailable(true);
        }
      } catch {
        /* sin red: se vuelve a intentar en la siguiente comprobación */
      }
    }
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return available;
}

export function NewVersionBanner() {
  const available = useNewVersion();
  if (!available) {
    return null;
  }
  return (
    <div className="new-version-banner" role="status">
      <RefreshCw size={14} />
      <span>Hay una versión nueva de GRAVITY. Recarga para usarla; lo que tengas a medias en un formulario se perderá.</span>
      <button type="button" onClick={() => window.location.reload()}>Recargar ahora</button>
    </div>
  );
}
