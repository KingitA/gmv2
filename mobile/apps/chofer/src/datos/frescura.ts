// P2-47 / P2-32 (29/10/2026): datos al día sin molestar.
// El 29/10 la billetera mostraba "Datos al 28/10 14:38 (hace 21 h)" con una rendición ya aceptada:
// la app no se había actualizado sola. Además del refresco del core (primer plano + cada N min),
// la app chofer revisa al abrir, al volver a primer plano y cada minuto si lo que el chofer mira
// (inicio, viajes, billetera) tiene más de MINUTOS_REFRESCO; si es así lo pide UNA vez, en orden,
// sin reintentos (P2-49: la base está cargada a ratos). El cartel "Datos al …" solo aparece cuando
// el dato pasó MINUTOS_DATO_VIEJO (como en la app vendedor).

import type { MetaDataset, Runtime } from "@gm/core"
import { DS } from "../datasets"

export const MINUTOS_REFRESCO = 5
export const MINUTOS_DATO_VIEJO = 15
/** Entre dos rondas de refresco automático, como mínimo */
const PAUSA_MS = 2 * 60_000
const CLAVES = [DS.me, DS.viajes, DS.billetera]

/** Datasets que hay que pedir: nunca sincronizados o con el último sync exitoso hace más de `minutos`. */
export function datasetsViejos(metas: Array<{ nombre: string; meta: Pick<MetaDataset, "syncedAt"> | null }>, ahora: number, minutos = MINUTOS_REFRESCO): string[] {
  return metas.filter(({ meta }) => !meta?.syncedAt || ahora - Date.parse(meta.syncedAt) > minutos * 60_000).map((x) => x.nombre)
}

/** Engancha el refresco automático. Devuelve la función para soltarlo. */
export function mantenerAlDia(rt: Pick<Runtime, "replica" | "sync" | "red" | "auth">): () => void {
  let corriendo = false
  let ultima = 0
  const revisar = async () => {
    if (corriendo || !rt.red.online || rt.auth.estado !== "autenticado" || document.visibilityState === "hidden") return
    if (Date.now() - ultima < PAUSA_MS) return
    const viejos = datasetsViejos(CLAVES.map((nombre) => ({ nombre, meta: rt.replica.metaSync(nombre) })), Date.now())
    if (!viejos.length) return
    corriendo = true
    ultima = Date.now()
    try {
      for (const ds of viejos) await rt.sync.dataset(ds)
    } finally {
      corriendo = false
    }
  }
  const alVolver = () => { if (document.visibilityState === "visible") void revisar() }
  document.addEventListener("visibilitychange", alVolver)
  window.addEventListener("focus", alVolver)
  const t = setInterval(() => void revisar(), 60_000)
  const inicio = setTimeout(() => void revisar(), 3_000)
  return () => {
    document.removeEventListener("visibilitychange", alVolver)
    window.removeEventListener("focus", alVolver)
    clearInterval(t)
    clearTimeout(inicio)
  }
}
