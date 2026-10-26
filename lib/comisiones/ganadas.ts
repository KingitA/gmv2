import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import { endOfDayArgentina, startOfDayArgentina } from "@/lib/utils"
import { fechaISO } from "@/lib/formato"

/**
 * COMISIONES GANADAS (cobradas) desde la cuenta personal — fuente única desde
 * la etapa 3 (lib/comisiones/liquidar.ts): renglones 'comision' de la cuenta
 * personal del vendedor, referidos al comprobante del cliente, ya netos de 10%
 * contado y devoluciones (y revertidos si el cobro se anula). La tabla vieja
 * `comisiones` tipo 'cobrada' ya no se escribe: leerla daba $0 (#42).
 *
 * Devuelve una fila por (comprobante, vendedor) con la fecha del último
 * renglón y las líneas del kardex de ese comprobante, para repartir el monto
 * por artículo / categoría en proporción a la comisión pactada de cada línea.
 */
export interface ComisionGanada {
  comprobante_id: string
  vendedor_id: string
  cuenta_id: string
  monto: number
  /** día argentino (aaaa-mm-dd) del último renglón */
  fecha: string
  cliente_id: string | null
  pedido_id: string | null
  lineas: Array<{ articulo_id: string | null; articulo_categoria: string | null; numero_pedido: string | null; comision: number }>
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function comisionesGanadas(
  supabase: SupabaseClient,
  { desde, hasta, vendedorId }: { desde: string; hasta: string; vendedorId?: string | null },
): Promise<ComisionGanada[]> {
  // Cuenta personal de cada código de vendedor (cuenta_cliente_id o, si no,
  // la cuenta del usuario) — mismo vínculo que usa la liquidación
  const vends = await fetchAllRows<any>(() => supabase.from("vendedores").select("id, cuenta_cliente_id, usuario_id"))
  const usuarios = vends.filter((v) => !v.cuenta_cliente_id && v.usuario_id).map((v) => v.usuario_id)
  const cuentaDeUsuario = new Map<string, string>()
  if (usuarios.length) {
    const { data } = await supabase.from("clientes").select("id, empleado_usuario_id").in("empleado_usuario_id", usuarios)
    for (const c of data || []) cuentaDeUsuario.set(c.empleado_usuario_id, c.id)
  }
  const cuentaDe = new Map<string, string>()
  const vendedoresDeCuenta = new Map<string, string[]>()
  for (const v of vends) {
    const cuenta = v.cuenta_cliente_id || (v.usuario_id ? cuentaDeUsuario.get(v.usuario_id) : undefined)
    if (!cuenta) continue
    cuentaDe.set(v.id, cuenta)
    vendedoresDeCuenta.set(cuenta, [...(vendedoresDeCuenta.get(cuenta) || []), v.id])
  }
  const cuentasFiltro = vendedorId ? [cuentaDe.get(vendedorId)].filter(Boolean) as string[] : null
  if (cuentasFiltro && !cuentasFiltro.length) return []

  const movs = await fetchAllRows<any>(() => {
    let q = supabase
      .from("cuenta_corriente_clientes")
      .select("id, cliente_id, referencia_id, debe, haber, fecha")
      .eq("tipo_movimiento", "comision")
      .eq("referencia_tipo", "comision")
      .gte("fecha", startOfDayArgentina(desde))
      .lte("fecha", endOfDayArgentina(hasta))
    if (cuentasFiltro) q = q.in("cliente_id", cuentasFiltro)
    return q
  })
  if (!movs.length) return []

  const compIds = [...new Set(movs.map((m) => m.referencia_id).filter(Boolean))] as string[]
  const [comps, lineas] = await Promise.all([
    fetchByIds<any>((ch) => supabase.from("comprobantes_venta").select("id, cliente_id, pedido_id").in("id", ch), compIds),
    fetchByIds<any>(
      (ch) =>
        supabase
          .from("kardex")
          .select("comprobante_venta_id, vendedor_id, articulo_id, articulo_categoria, numero_pedido, comision_viajante_monto")
          .eq("tipo_movimiento", "venta")
          .in("comprobante_venta_id", ch),
      compIds,
      10, // un comprobante trae ~40 líneas: lejos del corte de 1000
    ),
  ])
  const compDe = new Map(comps.map((c) => [c.id, c]))
  const lineasDe = new Map<string, any[]>()
  for (const l of lineas) lineasDe.set(l.comprobante_venta_id, [...(lineasDe.get(l.comprobante_venta_id) || []), l])

  const out = new Map<string, ComisionGanada>()
  for (const m of movs) {
    if (!m.referencia_id) continue
    const propias = lineasDe.get(m.referencia_id) || []
    // El vendedor es el de las líneas del comprobante cuya cuenta es esta
    const vendedor =
      propias.find((l) => l.vendedor_id && cuentaDe.get(l.vendedor_id) === m.cliente_id)?.vendedor_id ??
      vendedoresDeCuenta.get(m.cliente_id)?.[0]
    if (!vendedor) continue
    if (vendedorId && vendedor !== vendedorId && cuentaDe.get(vendedorId) !== m.cliente_id) continue
    const key = `${m.referencia_id}|${vendedor}`
    const comp = compDe.get(m.referencia_id)
    const prev = out.get(key) || {
      comprobante_id: m.referencia_id,
      vendedor_id: vendedor,
      cuenta_id: m.cliente_id,
      monto: 0,
      fecha: "",
      cliente_id: comp?.cliente_id ?? null,
      pedido_id: comp?.pedido_id ?? null,
      lineas: propias
        .filter((l) => l.vendedor_id === vendedor)
        .map((l) => ({
          articulo_id: l.articulo_id,
          articulo_categoria: l.articulo_categoria,
          numero_pedido: l.numero_pedido,
          comision: Number(l.comision_viajante_monto) || 0,
        })),
    }
    prev.monto = r2(prev.monto + Number(m.haber || 0) - Number(m.debe || 0))
    const dia = fechaISO(m.fecha)
    if (dia > prev.fecha) prev.fecha = dia
    out.set(key, prev)
  }
  return [...out.values()].filter((g) => Math.abs(g.monto) >= 0.005)
}

/**
 * Reparte el monto ganado de un comprobante entre sus líneas, en proporción a
 * la comisión pactada de cada una (sin líneas: todo en una sola, sin artículo).
 */
export function repartirPorLinea(g: ComisionGanada) {
  const total = g.lineas.reduce((s, l) => s + l.comision, 0)
  if (!g.lineas.length || Math.abs(total) < 0.005) {
    return [{ articulo_id: null as string | null, articulo_categoria: null as string | null, monto: g.monto }]
  }
  return g.lineas.map((l) => ({ articulo_id: l.articulo_id, articulo_categoria: l.articulo_categoria, monto: (g.monto * l.comision) / total }))
}
