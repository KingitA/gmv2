// PDF de los comprobantes (pedido del dueño, 14/10/2026): cada comprobante que se toca
// abre su PDF listo para compartir, y se pueden compartir varios juntos.
//
// El PDF es el MISMO que ve el ERP: /api/comprobantes-venta/:id/pdf redirige a la URL
// firmada del bucket privado. Se baja con la sesión del equipo (online-only), se deja en
// la caché de la app y se abre con el visor del equipo o va a la hoja de compartir.

import { useCallback, useState } from "react"
import { abrirArchivo, compartirArchivos, guardarArchivo, useOnline, useRuntime, type Archivo } from "@gm/core"
import { fecha } from "@gm/formato"

export interface ComprobantePdf {
  id: string
  tipo_comprobante: string | null
  numero_comprobante: string | null
  fecha?: string | null
  /** Otra ruta de PDF (remitos): por defecto /api/comprobantes-venta/:id/pdf */
  ruta?: string
}

const TIPO_LARGO: Record<string, string> = {
  FA: "Factura A", FB: "Factura B", FC: "Factura C", PRES: "Presupuesto", REV: "Reversa",
  NC: "Nota de crédito", NCA: "Nota de crédito A", NCB: "Nota de crédito B", NCC: "Nota de crédito C",
  NDA: "Nota de débito A", NDB: "Nota de débito B", NDC: "Nota de débito",
}
export const tipoComprobanteLargo = (t: string | null | undefined) => (t ? TIPO_LARGO[t] || t : "Comprobante")

/** "Presupuesto 0001-00001234 14-10-2026.pdf" */
export function nombrePdf(c: ComprobantePdf): string {
  // dd-mm-aaaa: la "/" no puede ir en un nombre de archivo
  const f = c.fecha ? ` ${fecha(c.fecha).replaceAll("/", "-")}` : ""
  return `${tipoComprobanteLargo(c.tipo_comprobante)} ${c.numero_comprobante || c.id.slice(0, 8)}${f}.pdf`
}

async function bajarPdf(rt: ReturnType<typeof useRuntime>, c: ComprobantePdf): Promise<Archivo> {
  const token = await rt.auth.accessToken()
  const res = await fetch(`${rt.api.base}${c.ruta ?? `/api/comprobantes-venta/${c.id}/pdf`}`, { headers: { Authorization: `Bearer ${token}` } })
  const tipo = res.headers.get("content-type") || ""
  if (!res.ok || tipo.includes("json")) {
    let msg = "No se pudo bajar el PDF."
    try { const d = await res.json(); msg = d.mensaje || d.error || msg } catch { /* sin cuerpo */ }
    throw new Error(`${tipoComprobanteLargo(c.tipo_comprobante)} ${c.numero_comprobante || ""}: ${msg}`)
  }
  return guardarArchivo(nombrePdf(c), await res.blob())
}

/**
 * abrir(c): baja y abre el PDF del comprobante. compartir([...]): los baja todos y abre
 * la hoja de compartir con todos juntos. `ocupado` = hay una descarga en curso.
 */
export function usePdfComprobantes(avisar: (msg: string) => void) {
  const rt = useRuntime()
  const online = useOnline()
  const [ocupado, setOcupado] = useState(false)

  const correr = useCallback(async (fn: () => Promise<void>) => {
    if (!online) return avisar("Necesitás señal para bajar el PDF.")
    setOcupado(true)
    try { await fn() } catch (e) { avisar(e instanceof Error && e.message ? e.message : "No se pudo bajar el PDF. Probá de nuevo con buena señal.") } finally { setOcupado(false) }
  }, [online, avisar])

  const abrir = useCallback((c: ComprobantePdf) => correr(async () => { await abrirArchivo(await bajarPdf(rt, c)) }), [correr, rt])
  const compartir = useCallback((cs: ComprobantePdf[]) => correr(async () => {
    const archivos: Archivo[] = []
    for (const c of cs) archivos.push(await bajarPdf(rt, c))
    await compartirArchivos(archivos, cs.length === 1 ? nombrePdf(cs[0]!) : `${cs.length} comprobantes`)
  }), [correr, rt])

  return { abrir, compartir, ocupado, online }
}
