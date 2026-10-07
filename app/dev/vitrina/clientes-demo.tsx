"use client"

// Demo de la pantalla CLIENTES con datos de ejemplo (vitrina local, sin base).
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { TablaPedidos, type Orden, type PedidoFila } from "@/components/clientes/tabla-pedidos"
import { FiltrosPedidos, type Filtros } from "@/components/clientes/filtros-pedidos"
import { CalendarioViajes, celdasSemana } from "@/components/viajes/calendario-viajes"
import type { ViajeCal } from "@/lib/viajes/use-viajes-rango"

const HOY = "2026-10-07"
const PEDIDOS: PedidoFila[] = [
  { id: "1", numero_pedido: "001755", fecha: "2026-10-07", estado: "impreso", prioridad: 1, total: 134309, viaje_id: null, clientes: { nombre_razon_social: "Distribuidora Urquiza", localidad: "Punta Alta" }, vendedores: { nombre: "Rossi Juan Cruz" }, zona: { id: "z1", nombre: "Punta Alta" } },
  { id: "2", numero_pedido: "001754", fecha: "2026-10-07", estado: "impreso", prioridad: 3, total: 2245625.39, viaje_id: null, clientes: { nombre_razon_social: "CHEN SONGMEI", localidad: "GENERAL ROCA" }, vendedores: { nombre: "FREIJE DANIEL LISTA NECO" }, zona: { id: "z2", nombre: "ALTO VALLE" } },
  { id: "3", numero_pedido: "001753", fecha: "2026-10-07", estado: "pendiente", prioridad: 2, total: 1184514.26, viaje_id: "v1", clientes: { nombre_razon_social: "LIN HAIYAN", localidad: "GENERAL ROCA" }, vendedores: { nombre: "FREIJE DANIEL LISTA NECO" }, viajes: { nombre: "ALTO VALLE · 08/10", fecha: "2026-10-08" }, zona: { id: "z2", nombre: "ALTO VALLE" } },
  { id: "4", numero_pedido: "001751", fecha: "2026-10-06", estado: "impreso", prioridad: 3, total: 256243.81, viaje_id: null, clientes: { nombre_razon_social: "CUEVAS RACOSTA SOC SECC V LGS", localidad: "BAHIA BLANCA" }, vendedores: { nombre: "LAUMANN KARINA" }, zona: { id: "z3", nombre: "BAHIA" } },
]
const VIAJES: ViajeCal[] = [
  { id: "v1", nombre: "ALTO VALLE · 08/10", fecha: "2026-10-08", dias: 2, estado: "programado", tipo_transporte: null, zonas: [{ id: "z2", nombre: "ALTO VALLE" }], choferes: [{ usuario_id: "u", rol: "titular", nombre: "Rodrigo" }], pedidos_count: 12, clientes_count: 10, bultos: 84, total: 5400000 },
  { id: "v2", nombre: "BAHIA · 10/10", fecha: "2026-10-10", dias: 1, estado: "programado", tipo_transporte: null, zonas: [{ id: "z3", nombre: "BAHIA" }], choferes: [], pedidos_count: 0, clientes_count: 0, bultos: 0, total: 0 },
]

export function ClientesDemo() {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [f, setF] = useState<Filtros>({ q: "", estados: ["pendiente", "impreso"], vendedor: "", zona: "", prioridad: "", viaje: "", desde: "2026-09-07", hasta: "" })
  const [orden, setOrden] = useState<Orden>("prioridad")
  const [msg, setMsg] = useState("")
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-azul-900">Pantalla CLIENTES (demo)</h2>
      {msg && <div className="rounded-lg bg-cian-50 px-3 py-2 text-sm text-cian-900">{msg}</div>}
      <CalendarioViajes modo="semana" celdas={celdasSemana(HOY)} viajes={VIAJES} hoy={HOY}
        onAbrirViaje={id => setMsg(`Abre la hoja de ruta del viaje ${id}`)} onProgramar={d => setMsg(`Programar viaje el ${d}`)}
        onMoverViaje={(id, d) => setMsg(`Mueve el viaje ${id} al ${d}`)}
        onSoltarPedidosEnViaje={v => setMsg(`Sube los pedidos al viaje ${v.nombre}`)} onSoltarPedidosEnDia={d => setMsg(`Pedidos soltados el ${d}: arma viaje de la zona`)} />
      <FiltrosPedidos f={f} set={c => setF(p => ({ ...p, ...c }))} vendedores={[{ id: "a", nombre: "LAUMANN KARINA" }]} zonas={[{ id: "z2", nombre: "ALTO VALLE" }]} hayFiltrosExtra={false} onLimpiar={() => {}} />
      <TablaPedidos pedidos={PEDIDOS} seleccion={sel}
        onToggle={id => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })}
        onToggleTodos={() => setSel(p => p.size === PEDIDOS.length ? new Set() : new Set(PEDIDOS.map(x => x.id)))}
        onAbrir={p => setMsg(`Abre el panel del pedido ${p.numero_pedido}`)} onPrioridad={(p, n) => setMsg(`Prioridad ${n} al ${p.numero_pedido}`)}
        onEliminar={p => setMsg(`Eliminar ${p.numero_pedido}`)} puedeEliminar={() => true}
        estadoBadge={e => <Badge className="bg-green-500 text-white">{e === "impreso" ? "Impreso" : "Pendiente"}</Badge>}
        orden={orden} dir="desc" onOrdenar={setOrden} onArrastrar={() => {}} />
    </div>
  )
}
