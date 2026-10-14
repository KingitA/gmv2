import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"
import { todayArgentina, startOfDayArgentina, endOfDayArgentina } from "@/lib/utils"
import { fetchAllRows } from "@/lib/playroom/queries"

// Informe de preparación de pedidos por empleado (solo lectura).
// Fuente: lo que registra la app del depósito al preparar —
//   picking_items: quién preparó cada renglón, cuántas unidades y cuándo lo escaneó;
//   picking_sesiones: la sesión de cada persona en cada pedido (inicio y fin).
// Plata preparada = unidades preparadas × precio final del renglón del pedido.
export const maxDuration = 30

interface PedidoEmpleado {
  pedido_id: string
  numero: string | null
  renglones: number
  unidades: number
  monto: number
  minutos: number | null
  desde: string | null
  hasta: string | null
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const sp = new URL(req.url).searchParams
  const hoy = todayArgentina()
  const from = sp.get("from") || hoy.slice(0, 7) + "-01"
  const to = sp.get("to") || hoy
  const sb = createAdminClient()

  try {
    const items = await fetchAllRows(() => sb.from("picking_items")
      .select("id, usuario_id, usuario_nombre, cantidad_preparada, estado, fecha_escaneo, pedidos_detalle(pedido_id, precio_final, pedidos(numero_pedido))")
      .gte("fecha_escaneo", startOfDayArgentina(from))
      .lte("fecha_escaneo", endOfDayArgentina(to)), "id")

    const pedidoIds = [...new Set(items.map((i: any) => i.pedidos_detalle?.pedido_id).filter(Boolean))] as string[]
    const sesiones = pedidoIds.length
      ? await fetchAllRows(() => sb.from("picking_sesiones").select("id, pedido_id, usuario_id, usuario_email, estado, inicio_at, created_at, fin_at").in("pedido_id", pedidoIds), "id")
      : []

    // Nombres legibles de los usuarios (por si el renglón no trae el nombre)
    const usuarioIds = [...new Set(items.map((i: any) => i.usuario_id).filter(Boolean))] as string[]
    const { data: usuarios } = usuarioIds.length ? await sb.from("usuarios").select("id, nombre").in("id", usuarioIds) : { data: [] as any[] }
    const nombreUsuario = new Map((usuarios || []).map((u: any) => [u.id, u.nombre]))

    // ── Por empleado y pedido ──
    const porEmpleado = new Map<string, { usuario_id: string | null; nombre: string; pedidos: Map<string, PedidoEmpleado> }>()
    for (const it of items as any[]) {
      if (it.estado === "PENDIENTE") continue
      const pedidoId = it.pedidos_detalle?.pedido_id
      if (!pedidoId) continue
      const clave = it.usuario_id || `nombre:${it.usuario_nombre || "?"}`
      const nombre = (it.usuario_id && nombreUsuario.get(it.usuario_id)) || it.usuario_nombre || "Operario sin nombre"
      if (!porEmpleado.has(clave)) porEmpleado.set(clave, { usuario_id: it.usuario_id ?? null, nombre, pedidos: new Map() })
      const emp = porEmpleado.get(clave)!
      if (!emp.pedidos.has(pedidoId)) {
        emp.pedidos.set(pedidoId, { pedido_id: pedidoId, numero: it.pedidos_detalle?.pedidos?.numero_pedido ?? null, renglones: 0, unidades: 0, monto: 0, minutos: null, desde: null, hasta: null })
      }
      const p = emp.pedidos.get(pedidoId)!
      const unidades = Number(it.cantidad_preparada) || 0
      p.renglones += 1
      p.unidades += unidades
      p.monto += unidades * (Number(it.pedidos_detalle?.precio_final) || 0)
      if (it.fecha_escaneo) {
        if (!p.desde || it.fecha_escaneo < p.desde) p.desde = it.fecha_escaneo
        if (!p.hasta || it.fecha_escaneo > p.hasta) p.hasta = it.fecha_escaneo
      }
    }

    // Tiempo de cada empleado en cada pedido: su sesión terminada (inicio → fin);
    // si no hay sesión cerrada, del primer al último escaneo suyo en ese pedido.
    const minutos = (a: string | null, b: string | null) => (a && b ? Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000) : null)
    for (const emp of porEmpleado.values()) {
      for (const p of emp.pedidos.values()) {
        const s = (sesiones as any[]).find(x => x.pedido_id === p.pedido_id && emp.usuario_id && x.usuario_id === emp.usuario_id && x.fin_at)
        const porSesion = s ? minutos(s.inicio_at || s.created_at, s.fin_at) : null
        // Una sesión de más de 8 horas es una sesión que quedó abierta: no cuenta como tiempo real
        p.minutos = porSesion != null && porSesion <= 480 ? porSesion : minutos(p.desde, p.hasta)
        if (p.minutos != null) p.minutos = Math.round(p.minutos * 10) / 10
      }
    }

    const filas = [...porEmpleado.values()].map(emp => {
      const pedidos = [...emp.pedidos.values()].sort((a, b) => (b.hasta || "").localeCompare(a.hasta || ""))
      const conTiempo = pedidos.filter(p => p.minutos != null && p.minutos > 0)
      const minutosTotal = conTiempo.reduce((t, p) => t + (p.minutos || 0), 0)
      const renglonesConTiempo = conTiempo.reduce((t, p) => t + p.renglones, 0)
      return {
        usuario_id: emp.usuario_id,
        nombre: emp.nombre,
        pedidos: pedidos.length,
        renglones: pedidos.reduce((t, p) => t + p.renglones, 0),
        unidades: Math.round(pedidos.reduce((t, p) => t + p.unidades, 0)),
        monto: Math.round(pedidos.reduce((t, p) => t + p.monto, 0)),
        minutos_promedio: conTiempo.length ? Math.round((minutosTotal / conTiempo.length) * 10) / 10 : null,
        minutos_total: Math.round(minutosTotal),
        renglones_hora: minutosTotal > 0 ? Math.round((renglonesConTiempo / (minutosTotal / 60)) * 10) / 10 : null,
        detalle: pedidos.map(p => ({ ...p, monto: Math.round(p.monto), unidades: Math.round(p.unidades) })),
      }
    }).sort((a, b) => b.monto - a.monto)

    const total = {
      pedidos: pedidoIds.length,
      renglones: filas.reduce((t, f) => t + f.renglones, 0),
      unidades: filas.reduce((t, f) => t + f.unidades, 0),
      monto: filas.reduce((t, f) => t + f.monto, 0),
      empleados: filas.length,
      minutos_promedio: (() => {
        const ps = filas.flatMap(f => f.detalle).filter(p => p.minutos != null && p.minutos > 0)
        return ps.length ? Math.round((ps.reduce((t, p) => t + (p.minutos || 0), 0) / ps.length) * 10) / 10 : null
      })(),
    }

    return NextResponse.json({ filas, total, meta: { from, to } })
  } catch (e: any) {
    console.error("[playroom/preparacion]", e?.message)
    return NextResponse.json({ error: e?.message || "Error" }, { status: 500 })
  }
}
