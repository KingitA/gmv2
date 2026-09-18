import { useMemo } from "react"
import type { Articulo } from "../../datasets"
import { eansDe } from "../../datos/busqueda"
import { useArticulos, useCatalogos, useVistaArticulos } from "../../datos/hooks"
import { cmpOrdenDeposito, cmpSinCodigo, type ArticuloVista } from "../../datos/overlay"

// Recorrido = lista navegable (Anterior / Siguiente) de "Modificación de artículos".
// En la web son server actions con cursor sobre la base; acá es la réplica local
// ordenada igual: orden_deposito (sin orden al final) → descripción → id.
// Vive en ?rec= para que sobreviva a cerrar la app:
//   prov:<id> · cat:<nombre> · orden · sincodigo

export type Recorrido =
  | { tipo: "prov"; id: string }
  | { tipo: "cat"; nombre: string }
  | { tipo: "orden" }
  | { tipo: "sincodigo" }

export function leerRecorrido(rec: string | null): Recorrido | null {
  if (!rec) return null
  if (rec === "orden") return { tipo: "orden" }
  if (rec === "sincodigo") return { tipo: "sincodigo" }
  if (rec.startsWith("prov:")) return { tipo: "prov", id: rec.slice(5) }
  if (rec.startsWith("cat:")) return { tipo: "cat", nombre: rec.slice(4) }
  return null
}

export function useRecorrido(rec: string | null) {
  const { articulos } = useArticulos()
  const { proveedores } = useCatalogos()
  const vista = useVistaArticulos()
  const r = leerRecorrido(rec)
  const clave = r ? JSON.stringify(r) : ""

  const lista: ArticuloVista[] = useMemo(() => {
    if (!r) return []
    let base: Articulo[]
    if (r.tipo === "prov") base = articulos.filter((a) => a.proveedor_id === r.id)
    else if (r.tipo === "cat") base = articulos.filter((a) => (a.categoria || "").toLowerCase() === r.nombre.toLowerCase())
    else base = articulos
    if (r.tipo !== "sincodigo") return [...base].sort(cmpOrdenDeposito).map(vista)
    // Sin código de barras: sin EAN, sin los descartados al proveedor INEXISTENTE
    const inexistente = proveedores.find((p) => p.nombre.trim().toLowerCase() === "inexistente")?.id
    return base
      .map(vista)
      .filter((a) => eansDe(a).length === 0 && !a.descartado && (!inexistente || a.proveedor_id !== inexistente))
      .sort(cmpSinCodigo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articulos, proveedores, vista, clave])

  const etiqueta = !r
    ? ""
    : r.tipo === "orden" ? "Orden de Depósito"
    : r.tipo === "sincodigo" ? "Sin código"
    : r.tipo === "cat" ? `Categoría: ${r.nombre}`
    : `Proveedor: ${proveedores.find((p) => p.id === r.id)?.nombre ?? ""}`

  return { recorrido: r, lista, etiqueta }
}
