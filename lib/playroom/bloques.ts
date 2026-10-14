// Contrato entre las pantallas de Playroom y el "cerebro" (Megasur).
// Un Bloque es lo que se dibuja: un número, una tabla o un gráfico. Lo devuelven
// tanto el chat (/api/playroom/chat → bloques) como el tablero (/api/playroom/tablero),
// así una respuesta del chat se puede "fijar" como una tarjeta más.
// Documentado para la sesión del cerebro en docs/rediseno-frontend/PEDIDO-agente-cerebro-playroom.md

export type Formato = "pesos" | "numero" | "porcentaje" | "fecha" | "texto"

/** Cómo volver a pedir el mismo dato con información fresca (tarjetas fijadas desde el chat) */
export type Recalcular = { herramienta: string; parametros: Record<string, unknown> }

export type Comparacion = { texto: string; tono: "bien" | "mal" | "neutro" }

export type Bloque =
  | {
      tipo: "numero"
      titulo: string
      valor: number | null
      formato: Formato
      comparacion?: Comparacion
      /** Aclaración chica debajo (ej: "según el costo cargado en cada artículo") */
      nota?: string
      /** Curva chiquita de fondo (últimos días), opcional */
      serie?: number[]
      recalcular?: Recalcular
    }
  | {
      tipo: "tabla"
      titulo: string
      columnas: { clave: string; titulo: string; formato?: Formato }[]
      filas: Record<string, string | number | null>[]
      total?: Record<string, number>
      nota?: string
      recalcular?: Recalcular
    }
  | {
      tipo: "grafico"
      titulo: string
      forma: "barras" | "lineas" | "torta"
      x: { clave: string; titulo?: string; formato?: Formato }
      series: { clave: string; titulo: string }[]
      datos: Record<string, string | number | null>[]
      formato?: Formato
      nota?: string
      recalcular?: Recalcular
    }

/** Respuesta del chat (todo opcional salvo `respuesta`) */
export interface RespuestaChat {
  respuesta: string
  bloques?: Bloque[]
  consultado?: string[]
  sugerencias?: string[]
  historial?: unknown[]
  /** nombre que usa hoy el cerebro actual para el historial */
  historial_actualizado?: unknown[]
  error?: string
}

// ── Formatos ──────────────────────────────────────────────────────────────────
const es = (n: number, dec = 0) => n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec })

/** "$ 84,6 M" / "$ 912.300" — para títulos grandes */
export function pesosCorto(n: number): string {
  const abs = Math.abs(n)
  const signo = n < 0 ? "−" : ""
  if (abs >= 1_000_000_000) return `${signo}$ ${es(abs / 1_000_000_000, 1)} mil M`
  if (abs >= 1_000_000) return `${signo}$ ${es(abs / 1_000_000, 1)} M`
  return `${signo}$ ${es(Math.round(abs))}`
}

export function formatear(v: unknown, formato: Formato = "texto", corto = false): string {
  if (v == null || v === "") return "—"
  if (formato === "texto") return String(v)
  if (formato === "fecha") {
    const s = String(v).slice(0, 10)
    const [a, m, d] = s.split("-")
    return d && m && a ? `${d}/${m}/${a}` : s
  }
  const n = typeof v === "number" ? v : Number(v)
  if (!isFinite(n)) return String(v)
  if (formato === "pesos") return corto ? pesosCorto(n) : `$ ${es(n, Math.abs(n) < 1000 && n % 1 !== 0 ? 2 : 0)}`
  if (formato === "porcentaje") return `${es(n, 1)}%`
  return es(n, n % 1 === 0 ? 0 : 1)
}
