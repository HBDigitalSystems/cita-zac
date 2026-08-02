import { useEffect, useState } from "react";

/**
 * false durante el render del servidor y en el primer render del cliente.
 *
 * El store de favoritos lee de localStorage, que no existe en el servidor. Sin
 * este guardia el HTML servido y el primer render del cliente difieren, y React
 * avisa de desajuste de hidratación. Los componentes que dependan de estado
 * persistido deben pintar su versión neutra hasta que esto sea true.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
