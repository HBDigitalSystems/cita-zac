import { useEffect, useState } from "react";

/**
 * Retrasa la propagación de un valor que cambia rápido.
 *
 * Se usa en el buscador: sin esto, cada tecla dispara un filtrado completo (y
 * mañana, una consulta a Supabase). Con 300 ms se filtra cuando la persona
 * termina de escribir, no mientras escribe.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
