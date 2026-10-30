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
import { estadoItemPicking } from "./bonificados"
import { recalcularBonificadosPedido } from "@/lib/pedidos/mercaderia-bonificada"
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
  if (pedido.estado !== "en_preparacion") await pasarAEnPreparacion(supabase, pedido)

  // Quién preparó cada renglón (para mostrar badges y bloquear los tomados por otro)
  const preparadores = await getPreparadoresPedido(supabase, pedido_id)
  return { pedido, preparadores, usuario: { id: usuario.id, nombre: usuario.nombre } }
}

/**
 * Recalcula EN VIVO las cantidades de los artículos bonificados de un pedido
 * según lo realmente preparado, cupo por cupo (lib/pedidos/mercaderia-bonificada.ts).
 * Mientras se prepara es una estimación; al cerrar el picking queda fija.
 * Devuelve [{ id, cantidad }] para la UI.
 */
export async function recalcularBonificados(supabase: any, pedido_id: string) {
  return recalcularBonificadosPedido(supabase, pedido_id, { enPicking: true })
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
    await pasarAEnPreparacion(supabase, pedido)
  }

  // Recalcular en vivo las cantidades bonificadas según lo realmente preparado
  let bonificados_actualizados: Array<{ id: string; cantidad: number }> = []
  if (data?.pedido_id && !data?.es_bonificado) {
    bonificados_actualizados = await recalcularBonificados(supabase, data.pedido_id)
  }

  return { ...data, bonificados_actualizados, preparado_por }
}

// ─── Estado de antes de preparar (P2-18 "Soltar pedido") ─────────────────────
// `pedidos.estado_antes_preparacion` llega con 20261029_deposito_soltar_pedido.sql.
// Hasta que se aplique, todo anda igual sin ella (soltar vuelve a "pendiente").

const SIN_COLUMNA_ESTADO_ANTES = /estado_antes_preparacion/i
const ESTADOS_DE_COLA = ["pendiente", "impreso"]

/** Pasa el pedido a "en preparación" recordando de dónde venía (pendiente / impreso). */
async function pasarAEnPreparacion(supabase: any, pedido: { id: string; estado: string }) {
  const { error } = await supabase
    .from("pedidos")
    .update({ estado: "en_preparacion", estado_antes_preparacion: pedido.estado })
    .eq("id", pedido.id)
  if (error && SIN_COLUMNA_ESTADO_ANTES.test(error.message)) {
    await supabase.from("pedidos").update({ estado: "en_preparacion" }).eq("id", pedido.id)
  }
}

export interface QuienPide {
  usuario?: UsuarioDeposito
  /** admin: puede reiniciar o soltar aunque no tenga la sesión o haya renglones de otros */
  esAdmin?: boolean
}

const esMismaPersona = (u: UsuarioDeposito, r: { usuario_id: string | null; nombre?: string; email?: string | null }) =>
  u.id && r.usuario_id ? r.usuario_id === u.id : r.email ? r.email === u.email : r.nombre === u.nombre

/**
 * Quién puede reiniciar o soltar (P2-18): el que tiene la sesión abierta en el pedido
 * (o cualquiera si nadie la tiene) y, si hay renglones preparados por OTRA persona,
 * solo un admin: no se le borra el trabajo a un compañero desde otro equipo.
 */
async function controlarQuienPide(supabase: any, pedido: { id: string; numero_pedido: string }, usuario: UsuarioDeposito, esAdmin: boolean) {
  const { data: sesiones, error: sErr } = await supabase
    .from("picking_sesiones")
    .select("id, usuario_id, usuario_email")
    .eq("pedido_id", pedido.id)
    .eq("estado", "EN_PROGRESO")
  if (sErr) throw sErr
  const { data: items, error: iErr } = await supabase
    .from("picking_items")
    .select("usuario_id, usuario_nombre, pedidos_detalle!inner(pedido_id)")
    .eq("pedidos_detalle.pedido_id", pedido.id)
  if (iErr) throw iErr
  const abiertas = (sesiones || []) as Array<{ usuario_id: string | null; usuario_email: string | null }>
  if (esAdmin) return { sesiones: abiertas.length }

  const mia = abiertas.some((s) => esMismaPersona(usuario, { usuario_id: s.usuario_id, email: s.usuario_email }))
  if (abiertas.length > 0 && !mia) {
    const quien = [...new Set(abiertas.map((s) => (s.usuario_email || "otro operario").split("@")[0]))].join(", ")
    throw new ErrorDeposito(`El pedido ${pedido.numero_pedido} lo tiene abierto ${quien}: lo puede soltar esa persona o un administrador.`, 409, { codigo: "sin_sesion" })
  }
  const deOtros = [...new Set(((items || []) as Array<{ usuario_id: string | null; usuario_nombre: string }>)
    .filter((r) => !esMismaPersona(usuario, { usuario_id: r.usuario_id, nombre: r.usuario_nombre }))
    .map((r) => r.usuario_nombre))]
  if (deOtros.length) {
    throw new ErrorDeposito(`Hay artículos preparados por ${deOtros.join(", ")}: los tiene que devolver esa persona o lo reinicia un administrador.`, 409, { codigo: "renglones_de_otro" })
  }
  return { sesiones: abiertas.length }
}

/** Todos los renglones del pedido a cero, PENDIENTE y sin dueño (como "devolver a pendiente" en cada uno). */
async function renglonesACero(supabase: any, pedido_id: string) {
  const { data: renglones, error: rErr } = await supabase.from("pedidos_detalle").select("id").eq("pedido_id", pedido_id)
  if (rErr) throw rErr
  const ids = ((renglones || []) as Array<{ id: string }>).map((r) => r.id)
  if (!ids.length) return 0
  const { error: dErr } = await supabase.from("pedidos_detalle").update({ cantidad_preparada: 0, estado_item: "PENDIENTE" }).eq("pedido_id", pedido_id)
  if (dErr) throw dErr
  const { error: pErr } = await supabase.from("picking_items").delete().in("pedido_detalle_id", ids)
  if (pErr) throw pErr
  return ids.length
}

/**
 * "Reiniciar preparación" (app Depósito, P2-18): vuelve a cero todo lo separado y la
 * sesión de quien lo pide queda abierta (sigue preparando desde cero). Idempotente.
 * Los bonificados se recalculan con el primer renglón que se marque (como en #17).
 */
export async function reiniciarPreparacion(supabase: any, pedido_id: string, quien: QuienPide = {}) {
  if (!pedido_id) throw new ErrorDeposito("pedido_id requerido", 400)
  const { data: pedido } = await supabase.from("pedidos").select("id, numero_pedido, estado").eq("id", pedido_id).maybeSingle()
  if (!pedido) throw new ErrorDeposito("Pedido no encontrado", 404)
  if (!ESTADOS_PREPARABLES.includes(pedido.estado)) {
    throw new ErrorDeposito(`El pedido ${pedido.numero_pedido} ya no está en preparación (${pedido.estado}): no se reinició.`, 409, { codigo: "pedido_cerrado" })
  }
  const usuario = quien.usuario ?? (await getUsuarioActual(supabase))
  await controlarQuienPide(supabase, pedido, usuario, !!quien.esAdmin)

  const renglones = await renglonesACero(supabase, pedido_id)
  await getOCrearSesion(supabase, pedido_id, usuario)
  if (pedido.estado !== "en_preparacion") await pasarAEnPreparacion(supabase, pedido)
  return { ok: true, renglones }
}

/**
 * "Soltar pedido" (app Depósito, P2-18): el pedido vuelve a la cola como si nadie lo
 * hubiera abierto: renglones a cero, TODAS las sesiones terminadas y el estado de antes
 * (impreso / pendiente). Caso real: 001945 quedó "en preparación" a nombre de Juan sin
 * nada escaneado y no había cómo liberarlo. Idempotente: si ya está en la cola sin
 * sesiones abiertas, no hace nada.
 */
export async function soltarPedido(supabase: any, pedido_id: string, quien: QuienPide = {}) {
  if (!pedido_id) throw new ErrorDeposito("pedido_id requerido", 400)
  // select("*"): funciona con o sin la columna estado_antes_preparacion
  const { data: pedido } = await supabase.from("pedidos").select("*").eq("id", pedido_id).maybeSingle()
  if (!pedido) throw new ErrorDeposito("Pedido no encontrado", 404)
  if (!ESTADOS_PREPARABLES.includes(pedido.estado)) {
    throw new ErrorDeposito(`El pedido ${pedido.numero_pedido} ya no está en preparación (${pedido.estado}): no se soltó.`, 409, { codigo: "pedido_cerrado" })
  }
  const usuario = quien.usuario ?? (await getUsuarioActual(supabase))
  const { sesiones } = await controlarQuienPide(supabase, pedido, usuario, !!quien.esAdmin)
  if (sesiones === 0 && ESTADOS_DE_COLA.includes(pedido.estado)) return { ok: true, ya_estaba: true, estado: pedido.estado }

  const renglones = await renglonesACero(supabase, pedido_id)
  await supabase.from("picking_sesiones").update({ estado: "TERMINADO", fin_at: nowArgentina() }).eq("pedido_id", pedido_id).eq("estado", "EN_PROGRESO")

  const estado = ESTADOS_DE_COLA.includes(pedido.estado)
    ? pedido.estado
    : ESTADOS_DE_COLA.includes(pedido.estado_antes_preparacion) ? pedido.estado_antes_preparacion : "pendiente"
  if (estado !== pedido.estado) {
    const { error } = await supabase.from("pedidos").update({ estado, estado_antes_preparacion: null }).eq("id", pedido_id).eq("estado", pedido.estado)
    if (error && SIN_COLUMNA_ESTADO_ANTES.test(error.message)) {
      const { error: e2 } = await supabase.from("pedidos").update({ estado }).eq("id", pedido_id).eq("estado", pedido.estado)
      if (e2) throw e2
    } else if (error) throw error
  }
  return { ok: true, renglones, estado }
}

/**
 * Devuelve a la cola del depósito un pedido ya preparado, como si nunca se hubiera
 * preparado (PENDIENTES-ERP-SALIDA #17: pedido con TODO faltante que quedó en
 * "pendiente_facturacion" sin nada para facturar).
 *
 * NO alcanza con cambiar `pedidos.estado`: los renglones seguirían en FALTANTE (el pedido
 * aparecería "Listo" al 100 % en la web y en la APK) y los `picking_items` seguirían a
 * nombre de quien lo preparó (índice único ux_picking_items_renglon): otro operario no
 * podría tocarlos ("Ya lo preparó X"). Cada renglón queda igual que cuando un operario
 * lo devuelve a pendiente en `aplicarPickingItem`: cantidad_preparada 0, PENDIENTE, sin
 * dueño. Los bonificados se recalculan con el primer renglón que se prepare.
 *
 * Solo desde "pendiente_facturacion" y sin ningún renglón facturado. Idempotente: si el
 * pedido ya está en `estadoNuevo`, no hace nada.
 */
export async function reiniciarPicking(supabase: any, pedido_id: string, estadoNuevo: "pendiente" = "pendiente") {
  if (!pedido_id) throw new ErrorDeposito("pedido_id requerido", 400)
  const { data: pedido } = await supabase.from("pedidos").select("id, numero_pedido, estado").eq("id", pedido_id).maybeSingle()
  if (!pedido) throw new ErrorDeposito("Pedido no encontrado", 404)
  if (pedido.estado === estadoNuevo) return { ok: true, ya_estaba: true }
  if (pedido.estado !== "pendiente_facturacion") {
    throw new ErrorDeposito(`El pedido ${pedido.numero_pedido} está ${pedido.estado}: solo se puede volver a la cola desde "pendiente de facturación".`, 409, { codigo: "pedido_no_reiniciable" })
  }

  const { data: renglones, error: rErr } = await supabase
    .from("pedidos_detalle")
    .select("id, comprobante_venta_detalle_id")
    .eq("pedido_id", pedido_id)
  if (rErr) throw rErr
  if ((renglones || []).some((r: any) => r.comprobante_venta_detalle_id)) {
    throw new ErrorDeposito(`El pedido ${pedido.numero_pedido} ya tiene renglones facturados: no se puede volver a preparar.`, 409, { codigo: "pedido_facturado" })
  }
  const ids = (renglones || []).map((r: any) => r.id)

  // 1) Renglones a pendiente y sin dueño (antes de cambiar el estado: la cola nunca lo ve "Listo")
  if (ids.length) {
    const { error: dErr } = await supabase.from("pedidos_detalle").update({ cantidad_preparada: 0, estado_item: "PENDIENTE" }).eq("pedido_id", pedido_id)
    if (dErr) throw dErr
    const { error: pErr } = await supabase.from("picking_items").delete().in("pedido_detalle_id", ids)
    if (pErr) throw pErr
  }
  // 2) Ninguna sesión queda abierta (cerrarPicking ya las terminó; por las dudas)
  await supabase.from("picking_sesiones").update({ estado: "TERMINADO", fin_at: nowArgentina() }).eq("pedido_id", pedido_id).eq("estado", "EN_PROGRESO")
  // Bonificados: NO se recalculan acá (con enPicking los marcaría COMPLETO con la cola
  // todavía sin preparar); aplicarPickingItem los recalcula con el primer renglón, como
  // en cualquier pedido.
  // 3) Recién ahora vuelve a la cola (web /deposito y réplica deposito_pedidos por el log de cambios)
  const { error: eErr } = await supabase.from("pedidos").update({ estado: estadoNuevo }).eq("id", pedido_id).eq("estado", "pendiente_facturacion")
  if (eErr) throw eErr
  return { ok: true, renglones: ids.length }
}

/**
 * Bultos y pallets cargados al finalizar (P2-19). Sin carga = "dejar para después del
 * control": la oficina los carga al armar el viaje (#22, PATCH /api/viajes/[id]/pedidos).
 */
export interface CargaPedido {
  bultos?: number
  pallets?: number
}

/** Escribe estado (si viene) + bultos/pallets; sin la columna pallets (20261026) graba sin ella. */
async function actualizarConCarga(supabase: any, pedido_id: string, cambios: Record<string, unknown>, carga: CargaPedido) {
  const fila: Record<string, unknown> = { ...cambios }
  if (carga.bultos !== undefined) fila.bultos = carga.bultos
  if (carga.pallets !== undefined) fila.pallets = carga.pallets
  if (!Object.keys(fila).length) return
  const { error } = await supabase.from("pedidos").update(fila).eq("id", pedido_id)
  if (error && "pallets" in fila && /pallets/i.test(error.message)) {
    delete fila.pallets
    const { error: e2 } = await supabase.from("pedidos").update(fila).eq("id", pedido_id)
    if (e2) throw e2
  } else if (error) throw error
}

/** Finaliza la preparación (POST /api/deposito/picking/item). Idempotente: cerrar dos veces = una. */
export async function cerrarPicking(supabase: any, pedido_id: string, carga: CargaPedido = {}) {
  if (!pedido_id) throw new ErrorDeposito("pedido_id requerido", 400)

  const { data: pedido } = await supabase.from("pedidos").select("id, estado").eq("id", pedido_id).maybeSingle()
  if (!pedido) throw new ErrorDeposito("Pedido no encontrado", 404)

  if (!ESTADOS_PREPARABLES.includes(pedido.estado)) {
    // Ya lo cerró otro equipo (o este mismo, en un reintento): no se repite nada.
    if (pedido.estado === "eliminado" || pedido.estado === "cancelado" || pedido.estado === "anulado") {
      throw new ErrorDeposito(`El pedido está ${pedido.estado}: no se puede cerrar la preparación.`, 409, { codigo: "pedido_no_preparable" })
    }
    // Lo cerró otro equipo sin bultos y este los trae: se guardan mientras no salió del depósito
    if (pedido.estado === "pendiente_facturacion") await actualizarConCarga(supabase, pedido_id, {}, carga)
    const { resumen } = await getPreparadoresPedido(supabase, pedido_id)
    return { ok: true, ya_cerrado: true, preparadores: resumen }
  }

  // Mercadería bonificada: la cantidad queda FIJA sobre lo que realmente va
  // (todos los renglones ya resueltos). Va antes del control de pendientes:
  // deja preparados los renglones bonificados.
  await recalcularBonificadosPedido(supabase, pedido_id, { enPicking: true })

  // Verificar que no haya items PENDIENTE
  const { data: items } = await supabase.from("pedidos_detalle").select("id, estado_item").eq("pedido_id", pedido_id)
  const pendientes = (items || []).filter((i: any) => !i.estado_item || i.estado_item === "PENDIENTE").length
  if (pendientes > 0) throw new ErrorDeposito(`Quedan ${pendientes} artículos sin resolver`, 400, { codigo: "renglones_pendientes" })

  // Estado y bultos en la misma escritura: un reintento nunca deja uno sin el otro
  await actualizarConCarga(supabase, pedido_id, { estado: "pendiente_facturacion" }, carga)

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
