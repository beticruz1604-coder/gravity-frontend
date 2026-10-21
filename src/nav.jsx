import React from "react";

/** Navegación compartida: cualquier pantalla puede abrir el detalle de una entidad del catálogo. */
export const NavContext = React.createContext({
  openEntity: () => undefined,
  navigate: () => undefined
});

export function useNav() {
  return React.useContext(NavContext);
}
