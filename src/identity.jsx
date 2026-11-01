import React from "react";
import { access, signIn as startSignIn, signOut as endSignOut, whoAmI } from "./backstage";

/** Usuario que está usando GRAVITY (null mientras carga o si no hay identidad). */
export function useIdentity(version) {
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
  }, [version]);
  return identity;
}

export function initials(name) {
  const parts = String(name ?? "").trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * Acceso de la persona: { loading, error, authenticated, roles, sections, admin, signIn, signOut }.
 * `sections` viene del backend (GET /api/access/me); mientras carga o si falla no se muestra ninguna sección.
 */
export function useAccess() {
  const [state, setState] = React.useState({ loading: true, error: null, authenticated: false, roles: [], sections: [], admin: false });
  const load = React.useCallback(async () => {
    try {
      const me = await access.me();
      setState({ loading: false, error: null, authenticated: Boolean(me.authenticated), roles: me.roles ?? [], sections: me.sections ?? [], admin: Boolean(me.admin) });
    } catch (err) {
      setState({ loading: false, error: err.message, authenticated: false, roles: [], sections: [], admin: false });
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);
  const signIn = React.useCallback(async (username, password) => {
    await startSignIn(username, password);
    await load();
  }, [load]);
  const signOut = React.useCallback(async () => {
    await endSignOut();
    await load();
  }, [load]);
  return { ...state, signIn, signOut };
}
