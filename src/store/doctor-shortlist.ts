// Favoritos y comparador de médicos.
//
// Hoy vive solo en el navegador (localStorage). Cuando exista autenticación
// (Fase 2), los favoritos de un usuario con sesión pasan a la tabla `favorites`
// y este store queda como caché optimista y como almacén para visitantes
// anónimos, que también deben poder guardar médicos antes de registrarse.
//
// Se guardan slugs y no ids: el slug es lo que viaja en la URL pública y
// sobrevive a que se regeneren los datos simulados.

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Más de tres columnas no caben de forma legible en el comparador. */
export const MAX_COMPARE = 3;

type ShortlistState = {
  favorites: string[];
  compare: string[];

  toggleFavorite: (slug: string) => void;
  isFavorite: (slug: string) => boolean;

  toggleCompare: (slug: string) => void;
  isComparing: (slug: string) => boolean;
  clearCompare: () => void;
  /** false cuando el comparador ya está lleno y este médico no está dentro. */
  canCompare: (slug: string) => boolean;
};

export const useShortlist = create<ShortlistState>()(
  persist(
    (set, get) => ({
      favorites: [],
      compare: [],

      toggleFavorite: (slug) =>
        set((state) => ({
          favorites: state.favorites.includes(slug)
            ? state.favorites.filter((s) => s !== slug)
            : [...state.favorites, slug],
        })),

      isFavorite: (slug) => get().favorites.includes(slug),

      toggleCompare: (slug) =>
        set((state) => {
          if (state.compare.includes(slug)) {
            return { compare: state.compare.filter((s) => s !== slug) };
          }
          if (state.compare.length >= MAX_COMPARE) return state;
          return { compare: [...state.compare, slug] };
        }),

      isComparing: (slug) => get().compare.includes(slug),

      clearCompare: () => set({ compare: [] }),

      canCompare: (slug) => {
        const { compare } = get();
        return compare.includes(slug) || compare.length < MAX_COMPARE;
      },
    }),
    {
      name: "doctorcita.shortlist",
      // Solo se persisten los datos; los métodos se recrean en cada carga.
      partialize: (state) => ({ favorites: state.favorites, compare: state.compare }),
    },
  ),
);
