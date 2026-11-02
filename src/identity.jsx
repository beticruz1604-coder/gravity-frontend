import React from "react";
import { access, rememberNewPassword, SESSION_LOST_EVENT, signIn as startSignIn, signOut as endSignOut, whoAmI } from "./backstage";

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
 * Acceso de la persona: { loading, error, authenticated, roles, sections, admin, managed, mustChangePassword, signIn, signOut, changePassword }.
 * `sections` viene del backend (GET /api/access/me); mientras carga o si falla no se muestra ninguna sección.
 */
const SIN_ACCESO = { authenticated: false, roles: [], sections: [], admin: false, managed: false, mustChangePassword: false };

export function useAccess() {
  const [state, setState] = React.useState({ loading: true, error: null, ...SIN_ACCESO });
  const load = React.useCallback(async () => {
    try {
      const me = await access.me();
      setState({
        loading: false,
        error: null,
        authenticated: Boolean(me.authenticated),
        roles: me.roles ?? [],
        sections: me.sections ?? [],
        admin: Boolean(me.admin),
        managed: Boolean(me.managed),
        mustChangePassword: Boolean(me.mustChangePassword)
      });
    } catch (err) {
      // 401: Backstage no reconoce a nadie; es «sin sesión», no un error.
      setState({ loading: false, error: err.status === 401 ? null : err.message, ...SIN_ACCESO });
    }
  }, []);
  React.useEffect(() => {
    load();
    window.addEventListener(SESSION_LOST_EVENT, load);
    return () => window.removeEventListener(SESSION_LOST_EVENT, load);
  }, [load]);
  const signIn = React.useCallback(async (username, password) => {
    await startSignIn(username, password);
    await load();
  }, [load]);
  const signOut = React.useCallback(async () => {
    await endSignOut();
    await load();
  }, [load]);
  const changePassword = React.useCallback(async (currentPassword, newPassword) => {
    await access.changePassword({ currentPassword, newPassword });
    rememberNewPassword(newPassword);
    await load();
  }, [load]);
  return { ...state, signIn, signOut, changePassword };
}
