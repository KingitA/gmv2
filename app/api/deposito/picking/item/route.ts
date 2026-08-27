import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { nowArgentina } from "@/lib/utils"
import { getUsuarioActual, getOCrearSesion, getPreparadoresPedido } from "@/lib/deposito/preparadores"

/**
 * Recalcula EN VIVO las cantidades de los artículos bonificados de un pedido
 * según lo realmente preparado: monto = % mercadería × neto preparado (sin
 * bonificados), repartido parejo entre los artículos elegidos. Devuelve el
 * resumen [{ id, cantidad }] para que la UI lo refleje.
 */
async function recalcularBonificados(supabase: any, pedido_id: string) {
  const [{ data: pedido }, { data: dets }] = await Promise.all([
    supabase.from("pedidos").select("bonif_mercaderia_pct").eq("id", pedido_id).single(),
    supabase.from("pedidos_detalle")
      .select("id, cantidad, cantidad_preparada, precio_base, lista_precio_id, es_bonificado")
      .eq("pedido_id", pedido_id),
  ])
  const bonificados = (dets || []).filter((d: any) => d.es_bonificado)
  if (bonificados.length === 0) return []
  const pct = Number(pedido?.bonif_mercaderia_pct ?? 0)
  // Sin % no se recalcula: deja las cantidades como las cargó el usuario manualmente.
  if (pct <= 0) return bonificados.map((b: any) => ({ id: b.id, cantidad: Number(b.cantidad || 0) }))
  // Lista especial: sus artículos NO entran en la base de bonificación.
  const { data: especial } = await supabase.from("listas_precio").select("id").eq("codigo", "especial").maybeSingle()
  const especialId = especial?.id ?? null
  // Base = NETO realmente preparado (precio_base, sin IVA), excluyendo bonificados y especial.
  const netoPreparado = (dets || [])
    .filter((d: any) => !d.es_bonificado && (!especialId || d.lista_precio_id !== especialId))
    .reduce((s: number, d: any) => s + Number(d.precio_base || 0) * Number(d.cantidad_preparada || 0), 0)
  const monto = netoPreparado * pct / 100
  const share = bonificados.length > 0 ? monto / bonificados.length : 0
  const out: Array<{ id: string; cantidad: number }> = []
  for (const b of bonificados) {
    const precio = Number(b.precio_base || 0)
    const units = precio > 0 ? Math.round(share / precio) : 0
    if (units !== Number(b.cantidad) || units !== Number(b.cantidad_preparada)) {
      await supabase.from("pedidos_detalle")
        .update({ cantidad: units, cantidad_preparada: units, estado_item: "COMPLETO" })
        .eq("id", b.id)
    }
    out.push({ id: b.id, cantidad: units })
  }
  return out
}

// GET ?pedido_id= — quién preparó cada renglón + resumen por persona (modal del ERP)
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const pedido_id = new URL(request.url).searchParams.get("pedido_id")
    if (!pedido_id) return NextResponse.json({ error: "pedido_id requerido" }, { status: 400 })
    const supabase = await createClient()
    return NextResponse.json(await getPreparadoresPedido(supabase, pedido_id))
  } catch (error: any) {
    return NextResponse.json({ error: `Error: ${error?.message}` }, { status: 500 })
  }
}

// PATCH: Actualizar cantidad_preparada y estado_item en pedidos_detalle,
// registrando QUIÉN lo preparó (picking_items). Un renglón = un preparador.
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { pedido_detalle_id, cantidad_preparada, es_faltante, cantidad_pedida } = body

    if (!pedido_detalle_id) {
      return NextResponse.json({ error: "pedido_detalle_id requerido" }, { status: 400 })
    }

    let estado_item = "PENDIENTE"
    if (es_faltante) {
      estado_item = "FALTANTE"
    } else if (cantidad_preparada >= cantidad_pedida) {
      estado_item = "COMPLETO"
    } else if (cantidad_preparada > 0) {
      estado_item = "PARCIAL"
    }

    const usuario = await getUsuarioActual(supabase)

    const { data: det, error: detErr } = await supabase
      .from("pedidos_detalle")
      .select("id, pedido_id, articulo_id, cantidad")
      .eq("id", pedido_detalle_id)
      .single()
    if (detErr || !det) return NextResponse.json({ error: "Renglón no encontrado" }, { status: 404 })

    // ── Traba: el renglón lo tomó otra persona → no se puede tocar ──
    const { data: reg } = await supabase
      .from("picking_items")
      .select("id, usuario_id, usuario_nombre")
      .eq("pedido_detalle_id", pedido_detalle_id)
      .limit(1)
      .maybeSingle()
    const esDeOtro = !!reg && (reg.usuario_id ? reg.usuario_id !== usuario.id : reg.usuario_nombre !== usuario.nombre)
    if (esDeOtro) {
      return NextResponse.json(
        { error: `Ya lo preparó ${reg!.usuario_nombre}. Solo esa persona puede modificarlo.`, preparado_por: reg!.usuario_nombre },
        { status: 409 }
      )
    }

    const { data, error } = await supabase
      .from("pedidos_detalle")
      .update({ cantidad_preparada, estado_item })
      .eq("id", pedido_detalle_id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: `Error: ${error.message}` }, { status: 500 })
    }

    // ── Registro de quién lo preparó ──
    let preparado_por: { usuario_id: string | null; usuario_nombre: string; fecha_escaneo: string } | null = null
    if (estado_item === "PENDIENTE") {
      // Devuelto a pendiente: se libera para que lo pueda tomar cualquiera
      if (reg) await supabase.from("picking_items").delete().eq("id", reg.id)
    } else {
      const sesion = await getOCrearSesion(supabase, det.pedido_id, usuario)
      const fecha = nowArgentina()
      const fila = {
        sesion_id: sesion.id,
        pedido_detalle_id,
        articulo_id: det.articulo_id,
        cantidad_pedida: det.cantidad,
        cantidad_preparada,
        estado: estado_item === "COMPLETO" ? "preparado" : estado_item === "PARCIAL" ? "parcial" : "faltante",
        usuario_id: usuario.id,
        usuario_nombre: usuario.nombre,
        fecha_escaneo: fecha,
      }
      const { error: regErr } = reg
        ? await supabase.from("picking_items").update(fila).eq("id", reg.id)
        : await supabase.from("picking_items").insert(fila)
      if (regErr) console.error("[picking/item] No se pudo registrar el preparador:", regErr.message)
      preparado_por = { usuario_id: usuario.id, usuario_nombre: usuario.nombre, fecha_escaneo: fecha }
    }

    // Recalcular en vivo las cantidades bonificadas según lo realmente preparado
    let bonificados_actualizados: Array<{ id: string; cantidad: number }> = []
    if (data?.pedido_id && !data?.es_bonificado) {
      bonificados_actualizados = await recalcularBonificados(supabase, data.pedido_id)
    }

    return NextResponse.json({ ...data, bonificados_actualizados, preparado_por })

  } catch (error: any) {
    return NextResponse.json({ error: `Error: ${error?.message}` }, { status: 500 })
  }
}

// POST: Finalizar picking de un pedido
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { pedido_id } = await request.json()

    // Verificar que no haya items PENDIENTE
    const { data: items } = await supabase
      .from("pedidos_detalle")
      .select("id, estado_item")
      .eq("pedido_id", pedido_id)

    const pendientes = (items || []).filter(
      (i: any) => !i.estado_item || i.estado_item === "PENDIENTE"
    ).length

    if (pendientes > 0) {
      return NextResponse.json(
        { error: `Quedan ${pendientes} artículos sin resolver` },
        { status: 400 }
      )
    }

    // Marcar pedido como pendiente_facturacion
    await supabase
      .from("pedidos")
      .update({ estado: "pendiente_facturacion" })
      .eq("id", pedido_id)

    // Cerrar TODAS las sesiones de picking del pedido (una por persona)
    await supabase
      .from("picking_sesiones")
      .update({ estado: "TERMINADO", fin_at: nowArgentina() })
      .eq("pedido_id", pedido_id)
      .eq("estado", "EN_PROGRESO")

    // Dejar los preparadores en el kardex del pedido (uuid[])
    const { resumen } = await getPreparadoresPedido(supabase, pedido_id)
    const ids = resumen.map((r) => r.usuario_id).filter((x): x is string => !!x)
    if (ids.length) {
      const { error: kErr } = await supabase.from("kardex").update({ preparadores_ids: ids }).eq("pedido_id", pedido_id)
      if (kErr) console.error("[picking] No se pudo grabar preparadores_ids en kardex:", kErr.message)
    }

    return NextResponse.json({ ok: true, preparadores: resumen })

  } catch (error: any) {
    return NextResponse.json({ error: `Error: ${error?.message}` }, { status: 500 })
  }
}
