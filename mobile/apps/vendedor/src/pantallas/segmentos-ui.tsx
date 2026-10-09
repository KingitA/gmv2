import { metodoCorto, metodoLabel, type ResumenSegmentos } from "../datos/segmentos"

/**
 * Cuadro "Lista y facturación por segmento": lo que de verdad se usa para cotizar y
 * facturar cada mercadería del cliente. Un dato que falta se marca en rojo (con eso
 * el pedido no se puede cerrar).
 */
export function CuadroSegmentos({ resumen, titulo = "Lista y facturación por segmento", nota }: { resumen: ResumenSegmentos; titulo?: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <p className="border-b border-gray-100 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">{titulo}</p>
      <div className="divide-y divide-gray-100">
        {resumen.filas.map((f) => (
          <div key={f.seg} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-sm text-gray-600">{f.label}</span>
            <span className="text-right text-sm font-bold">
              {f.listaNombre ? <span className="text-gray-900">{f.listaNombre}</span> : <span className="text-red-600">SIN LISTA</span>}
              <span className="text-gray-400"> · </span>
              {f.metodo ? <span className="text-gray-900">{metodoLabel(f.metodo)}</span> : <span className="text-red-600">SIN MÉTODO</span>}
            </span>
          </div>
        ))}
      </div>
      {resumen.filas.some((f) => f.delPedido) && (
        <p className="border-t border-gray-100 px-3 py-2 text-xs font-medium text-amber-700">Incluye lo elegido solo para este pedido.</p>
      )}
      {resumen.condicionesExtra > 0 && (
        <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
          + {resumen.condicionesExtra} {resumen.condicionesExtra === 1 ? "condición" : "condiciones"} por proveedor/marca: esa mercadería puede ir con otra lista o método.
        </p>
      )}
      {nota && <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">{nota}</p>}
    </div>
  )
}

/**
 * Texto corto para el chip del pedido: "NECO C/IVA" si los tres segmentos van igual;
 * si no, chip "NECO MIXTO" y el detalle "NECO · L/B PRES · P0 PRES · P+ C/IVA" en la barra de abajo
 * (nunca "STD": sin lista/método se ve "SIN LISTA"/"SIN MÉT.").
 */
export function textoSegmentos(r: ResumenSegmentos): { chip: string; detalle: string | null } {
  const lista = (n: string | null) => (n ? n.toUpperCase() : "SIN LISTA")
  const met = (m: string | null) => metodoCorto(m) ?? "SIN MÉT."
  const f0 = r.filas[0]!
  if (r.uniforme) return { chip: `${lista(f0.listaNombre)} ${met(f0.metodo)}`, detalle: null }
  const mismaLista = r.filas.every((f) => f.listaId === f0.listaId)
  const partes = r.filas.map((f) => `${f.corto} ${mismaLista ? "" : lista(f.listaNombre) + " "}${met(f.metodo)}`)
  return { chip: mismaLista ? `${lista(f0.listaNombre)} MIXTO` : "MIXTO", detalle: (mismaLista ? `${lista(f0.listaNombre)} · ` : "") + partes.join(" · ") }
}
