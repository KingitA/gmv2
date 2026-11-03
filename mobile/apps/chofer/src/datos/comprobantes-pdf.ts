// PDF de los comprobantes (pedido de Juan, 03/11/2026): en el cobro, tocar un comprobante abre su
// PDF listo para compartir; en la ficha, "Comprobantes" junta en UN PDF todo lo valorizado del
// pedido (facturas, presupuestos, NC y reversas: /api/comprobantes-venta/pedido/:id/pdf).
// Igual que la app vendedor (apps/vendedor/src/datos/comprobantes-pdf.ts): se baja con la sesión
// del equipo (necesita señal), queda en la caché de la app y se abre con el visor del equipo,
// que ya trae "compartir".

import { useCallback, useState } from "react"
import { abrirArchivo, guardarArchivo, useOnline, useRuntime } from "@gm/core"
import { fecha } from "@gm/formato"

const TIPO_LARGO: Record<string, string> = {
  FA: "Factura A", FB: "Factura B", FC: "Factura C", PRES: "Presupuesto", REV: "Reversa",
  NC: "Nota de crédito", NCA: "Nota de crédito A", NCB: "Nota de crédito B", NCC: "Nota de crédito C",
  ND: "Nota de débito", NDA: "Nota de débito A", NDB: "Nota de débito B", NDC: "Nota de débito",
}
export const tipoComprobanteLargo = (t: string | null | undefined) => (t ? TIPO_LARGO[t] || t : "Comprobante")

export interface PdfAbrir {
  ruta: string
  /** Nombre del archivo, sin ".pdf" */
  nombre: string
}

/** Un comprobante: "Presupuesto 0001-00000035 29-10-2026" */
export function pdfComprobante(c: { id: string; tipo_comprobante: string; numero_comprobante: string; fecha?: string | null }): PdfAbrir {
  // dd-mm-aaaa: la "/" no puede ir en un nombre de archivo
  const f = c.fecha ? ` ${fecha(c.fecha).replaceAll("/", "-")}` : ""
  return { ruta: `/api/comprobantes-venta/${c.id}/pdf`, nombre: `${tipoComprobanteLargo(c.tipo_comprobante)} ${c.numero_comprobante}${f}` }
}

/** Todos los comprobantes vivos de un pedido en un solo PDF: "Pedido 002017 - comprobantes" */
export const pdfPedido = (p: { id: string; numero: string }): PdfAbrir => ({ ruta: `/api/comprobantes-venta/pedido/${p.id}/pdf`, nombre: `Pedido ${p.numero} - comprobantes` })

/** abrir(pdf): lo baja y lo abre listo para compartir. `ocupado` = hay una descarga en curso. */
export function usePdf(avisar: (msg: string, t?: "ok" | "err") => void) {
  const rt = useRuntime()
  const online = useOnline()
  const [ocupado, setOcupado] = useState(false)
  const abrir = useCallback(async (pdf: PdfAbrir) => {
    if (!online) return avisar("Necesitás señal para ver el PDF.", "err")
    setOcupado(true)
    try {
      const token = await rt.auth.accessToken()
      const res = await fetch(`${rt.api.base}${pdf.ruta}`, { headers: { Authorization: `Bearer ${token}` } })
      const tipo = res.headers.get("content-type") || ""
      if (!res.ok || tipo.includes("json")) {
        let msg = "No se pudo bajar el PDF."
        try { const d = await res.json(); msg = d.mensaje || d.error || msg } catch { /* sin cuerpo */ }
        throw new Error(msg)
      }
      await abrirArchivo(await guardarArchivo(`${pdf.nombre}.pdf`, await res.blob()))
    } catch (e) {
      avisar(e instanceof Error && e.message ? e.message : "No se pudo bajar el PDF. Probá de nuevo con buena señal.", "err")
    } finally {
      setOcupado(false)
    }
  }, [online, rt, avisar])
  return { abrir, ocupado, online }
}
