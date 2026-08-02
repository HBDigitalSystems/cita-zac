// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },

  nitro: {
    // Destino de despliegue: Vercel.
    //
    // Por defecto este preset es `cloudflare-module`, así que el build local
    // generaba `wrangler.json` y `.wrangler/` — artefactos de Cloudflare
    // Workers que en Vercel no sirven de nada. Nitro detecta Vercel solo cuando
    // el build corre allí, pero eso significaba no poder comprobar en local que
    // la salida es la correcta hasta después de desplegar.
    //
    // Se respeta NITRO_PRESET por si hace falta construir para otro destino sin
    // tocar este archivo. Dentro de un build de Lovable esto se ignora: su
    // entorno fuerza Cloudflare para su propia vista previa, lo cual es
    // independiente de tu producción en Vercel.
    preset: process.env.NITRO_PRESET ?? "vercel",
  },
});
