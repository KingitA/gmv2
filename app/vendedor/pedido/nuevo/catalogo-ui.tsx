"use client"

// ── Sistema visual del catálogo del vendedor ─────────────────────────
// Cada rubro tiene su tinte propio que acompaña toda la navegación:
// tarjeta de rubro → tarjetas de categoría → chips de subcategoría.
// Perfumería = malva · Limpieza = aqua · Bazar = arena/terracota.

export interface Tinte {
  bg: string
  bgSoft: string
  ink: string
  accent: string
  border: string
}

const TINTES: Record<string, Tinte> = {
  perfumeria: { bg: "#F2EBF7", bgSoft: "#F9F5FB", ink: "#5C3F70", accent: "#9B72B0", border: "#E3D3EC" },
  limpieza: { bg: "#E3F2EF", bgSoft: "#F2FAF8", ink: "#1F5F55", accent: "#4BA396", border: "#CDE7E1" },
  bazar: { bg: "#F8EFE2", bgSoft: "#FCF7EE", ink: "#7C5327", accent: "#C68A52", border: "#EDDFC8" },
}

const TINTE_NEUTRO: Tinte = { bg: "#EEF0F2", bgSoft: "#F7F8F9", ink: "#3F4A54", accent: "#6B7A87", border: "#DFE3E7" }

function normalizar(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export function tinteRubro(nombreOrSlug: string | null | undefined): Tinte {
  const n = normalizar(nombreOrSlug || "")
  if (n.includes("perfum")) return TINTES.perfumeria
  if (n.includes("limpieza")) return TINTES.limpieza
  if (n.includes("bazar")) return TINTES.bazar
  return TINTE_NEUTRO
}

// Tintes de las tres vistas transversales (banners)
export const TINTE_NOVEDADES: Tinte = { bg: "#E4F2E9", bgSoft: "#F2FAF5", ink: "#1D6B44", accent: "#3E9467", border: "#CFE6D8" }
export const TINTE_OFERTAS: Tinte = { bg: "#FCE9E4", bgSoft: "#FDF4F1", ink: "#A63B22", accent: "#D2603F", border: "#F4D6CC" }
export const TINTE_HABITUALES: Tinte = { bg: "#FAF1DC", bgSoft: "#FCF8EE", ink: "#8A6314", accent: "#C0932F", border: "#EFE1BF" }

// ── Ilustraciones line-art por rubro ─────────────────────────────────

function ArtePerfumeria({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className="w-full h-full" aria-hidden>
      {/* frasco de perfume con atomizador */}
      <rect x="30" y="42" width="30" height="38" rx="8" stroke="currentColor" strokeWidth="2.4" />
      <rect x="30" y="42" width="30" height="38" rx="8" fill={accent} opacity="0.14" />
      <path d="M40 42v-6c0-2 1.5-3.5 3.5-3.5h3c2 0 3.5 1.5 3.5 3.5v6" stroke="currentColor" strokeWidth="2.4" />
      <rect x="41" y="24" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2.4" />
      <path d="M49 27h8c2.5 0 4 1.5 4 4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="64" cy="34" r="2.6" fill="currentColor" />
      {/* gotas / aroma */}
      <path d="M72 22c0 2.2-1.6 3.6-3.4 3.6S65.2 24.2 65.2 22c0-2.4 3.4-5.6 3.4-5.6S72 19.6 72 22Z" stroke="currentColor" strokeWidth="2" />
      <path d="M78 34.5c0 1.7-1.2 2.8-2.7 2.8s-2.7-1.1-2.7-2.8c0-1.9 2.7-4.4 2.7-4.4s2.7 2.5 2.7 4.4Z" stroke="currentColor" strokeWidth="1.8" />
      {/* etiqueta */}
      <path d="M38 58h14M38 64h9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
      <circle cx="22" cy="56" r="1.8" fill="currentColor" opacity="0.45" />
      <circle cx="76" cy="66" r="1.8" fill="currentColor" opacity="0.45" />
    </svg>
  )
}

function ArteLimpieza({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className="w-full h-full" aria-hidden>
      {/* rociador */}
      <path d="M38 40h18l3 8v26a4 4 0 0 1-4 4H39a4 4 0 0 1-4-4V48l3-8Z" stroke="currentColor" strokeWidth="2.4" />
      <path d="M38 40h18l3 8v26a4 4 0 0 1-4 4H39a4 4 0 0 1-4-4V48l3-8Z" fill={accent} opacity="0.14" />
      <path d="M44 40v-8h-6c-3 0-5-2-5-5v-2h16c4 0 6 2.5 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M33 25h-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      {/* chorro y burbujas */}
      <path d="M22 20l-5-3M22 25h-6M22 30l-5 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="70" cy="26" r="4.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="79" cy="37" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="70" cy="46" r="2" fill="currentColor" opacity="0.5" />
      {/* nivel de líquido */}
      <path d="M35 60c4 2.4 8-2.4 12 0s8-2.4 12 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

function ArteBazar({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className="w-full h-full" aria-hidden>
      {/* olla */}
      <path d="M28 48h40v18a10 10 0 0 1-10 10H38a10 10 0 0 1-10-10V48Z" stroke="currentColor" strokeWidth="2.4" />
      <path d="M28 48h40v18a10 10 0 0 1-10 10H38a10 10 0 0 1-10-10V48Z" fill={accent} opacity="0.14" />
      <path d="M24 48h48M28 54h-6M68 54h6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      {/* vapor */}
      <path d="M42 38c0-4 3-4 3-8M53 38c0-4 3-4 3-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
      {/* cuchara y tenedor */}
      <path d="M76 18v18M76 18c-3 0-5 2.5-5 6s2 6 5 6 5-2.5 5-6-2-6-5-6Z" stroke="currentColor" strokeWidth="2" transform="translate(-58 2)" />
      <path d="M82 16v10M78 16v6c0 2.5 1.7 4 4 4s4-1.5 4-4v-6M86 16v6M82 26v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="34" cy="64" r="1.8" fill="currentColor" opacity="0.45" />
      <circle cx="60" cy="68" r="1.8" fill="currentColor" opacity="0.45" />
    </svg>
  )
}

export function ArteRubro({ nombre, accent }: { nombre: string; accent: string }) {
  const n = normalizar(nombre)
  if (n.includes("perfum")) return <ArtePerfumeria accent={accent} />
  if (n.includes("limpieza")) return <ArteLimpieza accent={accent} />
  return <ArteBazar accent={accent} />
}

// ── Íconos chicos por categoría (mapeo por palabra clave) ────────────

type IconDef = { match: RegExp; d: React.ReactNode }

const S = { stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" }

const ICONOS: IconDef[] = [
  { match: /cabello/, d: <path {...S} d="M12 3c-4 0-7 3.2-7 7.5 0 3 1.4 4.7 1.4 7.2V21M12 3c4 0 7 3.2 7 7.5 0 3-1.4 4.7-1.4 7.2V21M12 3v5M8.5 21v-3M15.5 21v-3M12 21v-5" /> },
  { match: /bucal|dental/, d: <path {...S} d="M7 3.5C4.8 3.5 3.5 5.3 3.5 7.5c0 3.5 2 4 2.5 7 .4 2.6.6 6 2.3 6 1.6 0 1-4.5 3.7-4.5s2.1 4.5 3.7 4.5c1.7 0 1.9-3.4 2.3-6 .5-3 2.5-3.5 2.5-7 0-2.2-1.3-4-3.5-4-2.3 0-3 1.2-5 1.2s-2.7-1.2-5-1.2Z" /> },
  { match: /bebe|nin/, d: <><circle {...S} cx="12" cy="13" r="7" /><path {...S} d="M12 6c0-2 1.2-3 2.8-3M9.4 12.6h.01M14.6 12.6h.01M9.5 15.5c.7.8 1.5 1.2 2.5 1.2s1.8-.4 2.5-1.2" /></> },
  { match: /facial/, d: <><circle {...S} cx="12" cy="12" r="8.5" /><path {...S} d="M8.8 10.5h.01M15.2 10.5h.01M9 15.2c.9.9 1.9 1.3 3 1.3s2.1-.4 3-1.3" /></> },
  { match: /solar/, d: <><circle {...S} cx="12" cy="12" r="4" /><path {...S} d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></> },
  { match: /auxilios|salud|desinfec/, d: <><rect {...S} x="3.5" y="6" width="17" height="14" rx="3" /><path {...S} d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M12 10v6M9 13h6" /></> },
  { match: /intima/, d: <path {...S} d="M12 21s-7.5-4.6-9.3-9C1.2 8.4 3.2 5 6.6 5c2.2 0 3.8 1.2 5.4 3.4C13.6 6.2 15.2 5 17.4 5c3.4 0 5.4 3.4 3.9 7-1.8 4.4-9.3 9-9.3 9Z" /> },
  { match: /unas|depilacion/, d: <path {...S} d="M8 3.5c-1.7 0-3 1.4-3 3.2V14a7 7 0 0 0 14 0V9.5a2 2 0 0 0-4 0V12M11 6.7V12M11 6.7c0-1.8-1.3-3.2-3-3.2" /> },
  { match: /hombre/, d: <><circle {...S} cx="10" cy="14" r="6" /><path {...S} d="M14.5 9.5 20 4M20 4h-5M20 4v5" /></> },
  { match: /personal/, d: <><circle {...S} cx="12" cy="7.5" r="4" /><path {...S} d="M4.5 20.5c.8-4 3.9-6.5 7.5-6.5s6.7 2.5 7.5 6.5" /></> },
  { match: /perfumeria|fragancia/, d: <><rect {...S} x="8" y="10" width="8" height="10.5" rx="2.5" /><path {...S} d="M10.5 10V7.5h3V10M12 5v2.5M15 5.5c1.8 0 2.8 1 2.8 2.5M19.5 4.5h.01" /></> },
  { match: /aromatizante|desodorante/, d: <><rect {...S} x="9" y="8" width="7" height="13" rx="2" /><path {...S} d="M10.5 8V6a1.5 1.5 0 0 1 1.5-1.5h1A1.5 1.5 0 0 1 14.5 6v2M18.5 5l1.5-1M19 8.5l1.8-.3M18 11.5l1.4.8" /></> },
  { match: /insecticida|plaga/, d: <><ellipse {...S} cx="12" cy="14" rx="5" ry="6.5" /><path {...S} d="M12 7.5c0-2 1-3 2.5-3.5M12 7.5c0-2-1-3-2.5-3.5M7 12l-3.5-1M7 16.5 4 18M17 12l3.5-1M17 16.5 20 18M12 10v8" /></> },
  { match: /cocina|vajilla/, d: <><path {...S} d="M4 11h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6v-3ZM2.5 11h19" /><path {...S} d="M9 7c0-1.5 1.2-1.5 1.2-3M14 7c0-1.5 1.2-1.5 1.2-3" /></> },
  { match: /termo|mate/, d: <><path {...S} d="M8 9.5c-1.5 6 .5 11 4 11s5.5-5 4-11c-1-3.5-5-4-8 0Z" /><path {...S} d="M14 8 18.5 3.5M12.2 20.5v.01" /><path {...S} d="M9.5 12.5c1.5 1.2 3.5 1.2 5 0" opacity="0.7" /></> },
  { match: /iluminacion|electricidad|pila/, d: <><path {...S} d="M12 3a6 6 0 0 0-3.5 10.9c.9.7 1.5 1.6 1.5 2.6h4c0-1 .6-1.9 1.5-2.6A6 6 0 0 0 12 3Z" /><path {...S} d="M10 19.5h4M10.7 22h2.6" /></> },
  { match: /jardin|exterior/, d: <path {...S} d="M12 21v-8M12 13c0-4.5 2.8-7.5 7.5-7.5 0 4.7-3 7.5-7.5 7.5ZM12 11C12 7.5 9.8 5 6 5c0 3.8 2.2 6 6 6Z" /> },
  { match: /organizacion|plastico|accesorio/, d: <><path {...S} d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" /><path {...S} d="M4 8.5 12 13l8-4.5M12 13v7" /></> },
  { match: /pisos|superficie|hogar/, d: <path {...S} d="M13.5 3 12 12.5M12 12.5c-3.5-.7-6 1-6.8 4.2-.3 1.3.2 2 1.5 2.4 3.3 1 8 1.6 11.3.9M12 12.5c2 .4 3.5 1.7 4 4.5l.5 3M9.5 15.5 9 19M12.7 16l-.4 3.7" /> },
  { match: /cera|limpiador|detergente|lavandina/, d: <><path {...S} d="M9.5 9h5l1.5 3v7a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-7l1.5-3Z" /><path {...S} d="M10.5 9V6h3v3M10 6h4M8 15.5c1.3.8 2.7-.8 4 0s2.7-.8 4 0" opacity="0.9" /></> },
  { match: /bolsa/, d: <path {...S} d="M6 8h12l-1 12.5a1.6 1.6 0 0 1-1.6 1.5H8.6A1.6 1.6 0 0 1 7 20.5L6 8ZM9 10.5V6a3 3 0 0 1 6 0v4.5" /> },
  { match: /guante/, d: <path {...S} d="M8 21h7c1.7 0 3-1.3 3-3v-5.4c0-3 2-3.6 2-5.6 0-1-.7-1.7-1.6-1.7-1.2 0-2.4 1.5-2.4 4M8 21c-1.7 0-3-1.3-3-3v-7M8 21v-4M5 11V5.5a1.75 1.75 0 0 1 3.5 0M8.5 10V4a1.75 1.75 0 0 1 3.5 0M12 10V4.3a1.75 1.75 0 0 1 3.5 0V10" /> },
  { match: /esponja|estropajo/, d: <><rect {...S} x="3.5" y="8" width="17" height="9" rx="3" /><path {...S} d="M8 11.5h.01M12 13.5h.01M16 11.5h.01M10 15h.01M14 10h.01" /></> },
  { match: /textil|microfibra|pano/, d: <path {...S} d="M5 5c3 2 5 6 5 9.5V19c-2.5 0-5-1-6-3.5C2.7 12 3.5 8 5 5ZM19 5c-3 2-5 6-5 9.5V19c2.5 0 5-1 6-3.5 1.3-3.5.5-7.5-1-10.5Z" /> },
  { match: /cepillo|calzado|cuero/, d: <path {...S} d="M4 12l8.5-8.5c1-1 2.6-1 3.5 0l.5.5c1 1 1 2.6 0 3.5L8 16M4 12l4 4M4 12l-1.5 5c-.3 1.2.5 2 1.7 1.7L9 17.5M11 9l4 4" /> },
  { match: /bano/, d: <path {...S} d="M4 12h16v2a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6v-2ZM4 12V5.5A2.5 2.5 0 0 1 6.5 3C8 3 9 4 9 5.5M7.5 7.5c0-1.2.8-2 2-2s2 .8 2 2M6 20l-1 2M18 20l1 2" /> },
]

export function IconoCategoria({ nombre, className }: { nombre: string; className?: string }) {
  const n = normalizar(nombre)
  const def = ICONOS.find((i) => i.match.test(n))
  return (
    <svg viewBox="0 0 24 24" className={className || "w-6 h-6"} fill="none" aria-hidden>
      {def ? def.d : <path {...S} d="M9.5 3.5 5 8v11a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8l-4.5-4.5h-5ZM5 8h14M12 12v5M9.5 14.5h5" />}
    </svg>
  )
}
