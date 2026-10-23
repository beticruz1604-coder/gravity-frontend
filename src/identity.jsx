import React from "react";
import { whoAmI } from "./backstage";

/** Usuario que está usando GRAVITY (null mientras carga o si no hay identidad). */
export function useIdentity() {
  const [identity, setIdentity] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    whoAmI().then((who) => {
      if (!cancelled) {
        setIdentity(who);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return identity;
}

export function initials(name) {
  const parts = String(name ?? "").trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
