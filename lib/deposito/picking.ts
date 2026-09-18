/**
 * Lógica de picking compartida por las API routes web (/api/deposito/picking*)
 * y los handlers del outbox de la app Depósito (lib/mobile/outbox/deposito.ts).
 * Un solo lugar = mismas reglas para la web y para el handheld.
 *
 * Concurrencia (ver MOBILE.md → "Depósito"):
 *  - Un pedido lo preparan VARIOS operarios a la vez (una sesión por persona).
 *  - Un renglón es de UNA persona: el primero que lo marca lo reclama en
 *    picking_items (índice único ux_picking_items_renglon). El reclamo se hace
 *    ANTES de escribir pedidos_detalle, así dos equipos simultáneos nunca pisan
 *    la cantidad del otro: el segundo recibe 409.
 *  - Devolver a PENDIENTE libera el renglón.
 */

import { nowArgentina } from "@/lib/utils"
import { calcularBonificados, estadoItemPicking } from "./bonificados"
import { getOCrearSesion, getPreparadoresPedido, getUsuarioActual } from "./preparadores"

export const ESTADOS_PREPARABLES = ["pendiente", "en_preparacion", "impreso"]

/** Error con status HTTP: las routes lo devuelven tal cual; los handlers lo mapean a rechazo/transitorio. */
export class ErrorDeposito extends Error {
  constructor(
    message: string,
    public status: number,
    public extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export type UsuarioDeposito = { id: string | null; nombre: string; email: string }

/** Iniciar o retomar la preparación de un pedido (POST /api/deposito/picking). */
export async function abrirPicking(supabase: any, pedido_id: string, usuarioDado?: UsuarioDeposito) {
  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .select(`
        id, numero_pedido, estado,
        clientes(id, nombre, razon_social),
        pedidos_detalle(
          id, cantidad, articulo_id,
          cantidad_preparada, estado_item, es_bonificado,
          articulos(id, sku, descripcion, ean13, unidades_por_bulto, proveedores(nombre))
        )
      `)
    .eq("id", pedido_id)
    .in("estado", ESTADOS_PREPARABLES)
    .single()

  if (pedidoError || !pedido) throw new ErrorDeposito(`Pedido no encontrado: ${pedidoError?.message}`, 404)

  // Sesión de picking POR PERSONA: un pedido lo pueden preparar varios usuarios,
  // cada uno con su sesión.
  const usuario = usuarioDado ?? (await getUsuarioActual(supabase))
  await getOCrearSesion(supabase, pedido_id, usuario)
  if (pedido.estado !== "en_preparacion") {
    await supabase.from("pedidos").update({ estado: "en_preparacion" }).eq("id", pedido_id)
  }

  // Quién preparó cada renglón (para mostrar badges y bloquear los tomados por otro)
  const preparadores = await getPreparadoresPedido(supabase, pedido_id)
  return { pedido, preparadores, usuario: { id: usuario.id, nombre: usuario.nombre } }
}

/**
 * Recalcula EN VIVO las cantidades de los artículos bonificados de un pedido
 * según lo realmente preparado. Devuelve [{ id, cantidad }] para la UI.
 */
export async function recalcularBonificados(supabase: any, pedido_id: string) {
  const [{ data: pedido }, { data: dets }] = await Promise.all([
    supabase.from("pedidos").select("bonif_mercaderia_pct").eq("id", pedido_id).single(),
    supabase
      .from("pedidos_detalle")
      .select("id, cantidad, cantidad_preparada, precio_base, lista_precio_id, es_bonificado")
      .eq("pedido_id", pedido_id),
  ])
  const lineas = (dets || []) as any[]
  if (!lineas.some((d) => d.es_bonificado)) return []
  const pct = Number(pedido?.bonif_mercaderia_pct ?? 0)
  // Lista especial: sus artículos NO entran en la base de bonificación.
  let especialId: string | null = null
  if (pct > 0) {
    const { data: especial } = await supabase.from("listas_precio").select("id").eq("codigo", "especial").maybeSingle()
    especialId = especial?.id ?? null
  }
  const calc = calcularBonificados(
    pct,
    lineas.map((d) => ({ ...d, excluye_bonif: !!especialId && d.lista_precio_id === especialId })),
  )
  for (const b of calc) {
    if (b.cambia) {
      await supabase
        .from("pedidos_detalle")
        .update({ cantidad: b.cantidad, cantidad_preparada: b.cantidad, estado_item: "COMPLETO" })
        .eq("id", b.id)
    }
  }
  return calc.map((b) => ({ id: b.id, cantidad: b.cantidad }))
}

export interface ArgsPickingItem {
  pedido_detalle_id: string
  cantidad_preparada: number
  es_faltante?: boolean
  /** La web lo manda; si falta se usa la cantidad del renglón */
  cantidad_pedida?: number
  /** Momento real del escaneo (offline: capturado_at). Default: ahora */
  fecha?: string
  /** true (app) ⇒ rechaza si el pedido ya salió de preparación */
  exigirPedidoAbierto?: boolean
}

/** Marca un renglón (PATCH /api/deposito/picking/item). Valor ABSOLUTO ⇒ reenviar es inocuo. */
export async function aplicarPickingItem(supabase: any, args: ArgsPickingItem, usuarioDado?: UsuarioDeposito) {
  const { pedido_detalle_id, es_faltante } = args
  const cantidad_preparada = Number(args.cantidad_preparada) || 0
  if (!pedido_detalle_id) throw new ErrorDeposito("pedido_detalle_id requerido", 400)

  const usuario = usuarioDado ?? (await getUsuarioActual(supabase))

  const { data: det, error: detErr } = await supabase
    .from("pedidos_detalle")
    .select("id, pedido_id, articulo_id, cantidad")
    .eq("id", pedido_detalle_id)
    .single()
  if (detErr || !det) throw new ErrorDeposito("Renglón no encontrado", 404)

  const { data: pedido } = await supabase.from("pedidos").select("id, estado").eq("id", det.pedido_id).maybeSingle()
  if (args.exigirPedidoAbierto && (!pedido || !ESTADOS_PREPARABLES.includes(pedido.estado))) {
    throw new ErrorDeposito("El pedido ya se cerró: este cambio no se aplicó.", 409, { codigo: "pedido_cerrado" })
  }

  const estado_item = estadoItemPicking(cantidad_preparada, Number(args.cantidad_pedida ?? det.cantidad), !!es_faltante)

  // ── Traba: el renglón lo tomó otra persona → no se puede tocar ──
  const leerReg = async () => {
    const { data } = await supabase
      .from("picking_items")
      .select("id, usuario_id, usuario_nombre")
      .eq("pedido_detalle_id", pedido_detalle_id)
      .limit(1)
      .maybeSingle()
    return data as { id: string; usuario_id: string | null; usuario_nombre: string } | null
  }
  const esDeOtro = (r: { usuario_id: string | null; usuario_nombre: string } | null) =>
    !!r && (r.usuario_id ? r.usuario_id !== usuario.id : r.usuario_nombre !== usuario.nombre)
  const tomado = (r: { usuario_nombre: string }) =>
    new ErrorDeposito(`Ya lo preparó ${r.usuario_nombre}. Solo esa persona puede modificarlo.`, 409, {
      preparado_por: r.usuario_nombre,
      codigo: "renglon_tomado",
    })

  let reg = await leerReg()
  if (esDeOtro(reg)) throw tomado(reg!)

  // ── Reclamo ANTES de escribir la cantidad (dos equipos a la vez: gana uno solo) ──
  let preparado_por: { usuario_id: string | null; usuario_nombre: string; fecha_escaneo: string } | null = null
  if (estado_item !== "PENDIENTE") {
    const sesion = await getOCrearSesion(supabase, det.pedido_id, usuario)
    const fecha = args.fecha || nowArgentina()
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
    if (regErr?.code === "23505") {
      // Otro equipo lo reclamó entre la lectura y el insert (ux_picking_items_renglon)
      reg = await leerReg()
      if (esDeOtro(reg)) throw tomado(reg!)
    } else if (regErr) {
      console.error("[picking/item] No se pudo registrar el preparador:", regErr.message)
    }
    preparado_por = { usuario_id: usuario.id, usuario_nombre: usuario.nombre, fecha_escaneo: fecha }
  }

  const { data, error } = await supabase
    .from("pedidos_detalle")
    .update({ cantidad_preparada, estado_item })
    .eq("id", pedido_detalle_id)
    .select()
    .single()
  if (error) throw new ErrorDeposito(`Error: ${error.message}`, 500)

  // Devuelto a pendiente: se libera para que lo pueda tomar cualquiera
  if (estado_item === "PENDIENTE" && reg) await supabase.from("picking_items").delete().eq("id", reg.id)

  // Primer renglón marcado sin haber "abierto" el pedido (app offline): queda en preparación
  if (pedido && pedido.estado !== "en_preparacion" && ESTADOS_PREPARABLES.includes(pedido.estado) && estado_item !== "PENDIENTE") {
    await supabase.from("pedidos").update({ estado: "en_preparacion" }).eq("id", pedido.id)
  }

  // Recalcular en vivo las cantidades bonificadas según lo realmente preparado
  let bonificados_actualizados: Array<{ id: string; cantidad: number }> = []
  if (data?.pedido_id && !data?.es_bonificado) {
    bonificados_actualizados = await recalcularBonificados(supabase, data.pedido_id)
  }

  return { ...data, bonificados_actualizados, preparado_por }
}

/** Finaliza la preparación (POST /api/deposito/picking/item). Idempotente: cerrar dos veces = una. */
export async function cerrarPicking(supabase: any, pedido_id: string) {
  if (!pedido_id) throw new ErrorDeposito("pedido_id requerido", 400)

  const { data: pedido } = await supabase.from("pedidos").select("id, estado").eq("id", pedido_id).maybeSingle()
  if (!pedido) throw new ErrorDeposito("Pedido no encontrado", 404)

  if (!ESTADOS_PREPARABLES.includes(pedido.estado)) {
    // Ya lo cerró otro equipo (o este mismo, en un reintento): no se repite nada.
    if (pedido.estado === "eliminado" || pedido.estado === "cancelado" || pedido.estado === "anulado") {
      throw new ErrorDeposito(`El pedido está ${pedido.estado}: no se puede cerrar la preparación.`, 409, { codigo: "pedido_no_preparable" })
    }
    const { resumen } = await getPreparadoresPedido(supabase, pedido_id)
    return { ok: true, ya_cerrado: true, preparadores: resumen }
  }

  // Verificar que no haya items PENDIENTE
  const { data: items } = await supabase.from("pedidos_detalle").select("id, estado_item").eq("pedido_id", pedido_id)
  const pendientes = (items || []).filter((i: any) => !i.estado_item || i.estado_item === "PENDIENTE").length
  if (pendientes > 0) throw new ErrorDeposito(`Quedan ${pendientes} artículos sin resolver`, 400, { codigo: "renglones_pendientes" })

  await supabase.from("pedidos").update({ estado: "pendiente_facturacion" }).eq("id", pedido_id)

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

  return { ok: true, preparadores: resumen }
}
