// Redes sociales del médico en su ficha pública.
//
// Los iconos van como SVG y no desde lucide-react: esa biblioteca retiró las
// marcas comerciales, y usar un icono genérico de "compartir" para Facebook
// haría que nadie lo reconociera.

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16ZM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.12 1.38C1.36 2.67.94 3.34.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.12.66.66 1.33 1.08 2.12 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.79-.3 1.46-.72 2.12-1.38.66-.66 1.08-1.33 1.38-2.12.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91-.3-.79-.72-1.46-1.38-2.12C21.33 1.36 20.66.94 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7.85-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0Z" />
    </svg>
  );
}

const REDES = [
  { clave: "facebook", etiqueta: "Facebook", Icono: FacebookIcon },
  { clave: "instagram", etiqueta: "Instagram", Icono: InstagramIcon },
] as const;

/**
 * Completa el enlace si el médico escribió solo su usuario.
 *
 * En el formulario mucha gente escribe `dra.ruiz` o `@dra.ruiz` en vez de la
 * dirección entera. Sin esto el navegador lo tomaría por una ruta interna y
 * llevaría a una página inexistente del propio sitio.
 */
function normalizar(valor: string, red: "facebook" | "instagram"): string | null {
  const v = valor.trim();
  if (!v) return null;

  if (/^https?:\/\//i.test(v)) return v;
  if (/^www\./i.test(v)) return `https://${v}`;

  const usuario = v.replace(/^@/, "").replace(/^\/+/, "");
  if (!usuario) return null;

  return red === "facebook"
    ? `https://facebook.com/${usuario}`
    : `https://instagram.com/${usuario}`;
}

export function SocialLinks({
  facebookUrl,
  instagramUrl,
  nombre,
}: {
  facebookUrl: string | null;
  instagramUrl: string | null;
  nombre: string;
}) {
  const enlaces = REDES.map((r) => {
    const bruto = r.clave === "facebook" ? facebookUrl : instagramUrl;
    const url = bruto ? normalizar(bruto, r.clave) : null;
    return url ? { ...r, url } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  if (enlaces.length === 0) return null;

  return (
    <div className="mt-6 border-t border-border pt-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Redes sociales</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {enlaces.map(({ clave, etiqueta, Icono, url }) => (
          <a
            key={clave}
            href={url}
            target="_blank"
            // `noopener` no es opcional: sin él, la página que se abre puede
            // manipular esta pestaña mediante window.opener. `nofollow` porque
            // es un enlace que pone el propio médico.
            rel="noopener noreferrer nofollow"
            aria-label={`${etiqueta} de ${nombre}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2
                       text-xs font-medium text-secondary transition-colors
                       hover:border-primary hover:text-primary"
          >
            <Icono />
            {etiqueta}
          </a>
        ))}
      </div>
    </div>
  );
}
