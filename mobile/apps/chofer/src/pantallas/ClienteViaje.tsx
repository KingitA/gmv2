import { useParams } from "react-router"
import { useFila, useOverlay } from "@gm/core"
import { Boton, Encabezado, Frescura, Hoja, moneda } from "@gm/core/ui"
import type { ViajeDetalle } from "../datasets"

function Fila({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between border-b py-2 text-sm last:border-0">
      <span className="text-slate-500">{l}</span>
      <span className="font-medium">{v}</span>
    </div>
  )
}

export function ClienteViaje() {
  const { viajeId, pedidoId } = useParams()
  const { fila: v } = useFila<ViajeDetalle>("chofer_viajes", viajeId)
  const p = v?.pedidos.find((x) => x.id === pedidoId)
  // Sheet como entrada de historial: atrás físico la cierra (no sale de la pantalla)
  const cuenta = useOverlay("cuenta")

  if (!p) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <Encabezado titulo="Pedido" />
        <p className="p-6 text-center text-slate-500">Este pedido no está en los datos del equipo.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <Encabezado titulo={p.cliente_nombre} />
      <Frescura dataset="chofer_viajes" />
      <main className="space-y-3 p-3">
        <section className="rounded-xl border bg-white p-3">
          <Fila l="Pedido" v={p.numero} />
          <Fila l="Dirección" v={`${p.direccion}${p.localidad ? `, ${p.localidad}` : ""}`} />
          <Fila l="Teléfono" v={p.telefono || "—"} />
          <Fila l="Bultos" v={String(p.bultos)} />
          <Fila l="Estado" v={p.estado_entrega.replace("_", " ")} />
        </section>
        <Boton className="w-full" onClick={cuenta.abrir}>
          Ver cuenta
        </Boton>
        {p.telefono && (
          <a href={`tel:${p.telefono}`} className="block h-12 rounded-lg border bg-white text-center font-semibold leading-[3rem]">
            Llamar
          </a>
        )}
      </main>
      <Hoja abierta={cuenta.abierto} onCerrar={cuenta.cerrar} titulo="Cuenta del cliente">
        <Fila l="Saldo anterior" v={moneda(p.saldo_anterior)} />
        <Fila l="Este pedido" v={moneda(p.total_pedido)} />
        <Fila l="Total a cobrar" v={moneda(p.total_a_cobrar)} />
        <Fila l="Cobrado en el viaje" v={moneda(p.cobrado)} />
        <Fila l="Devuelto" v={moneda(p.devuelto)} />
      </Hoja>
    </div>
  )
}
