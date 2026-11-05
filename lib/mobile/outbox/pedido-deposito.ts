// CARGAR PEDIDO DESDE DEPÓSITO (decisión de Juan, 05/11/2026) — outbox de la app Depósito.
//
// "pedido.cargar_deposito": el empleado escanea artículos y cantidades y cierra.
//  - modo "propio": el pedido va a SU cuenta personal (clientes.empleado_usuario_id
//    = su usuario; lib/cuenta-corriente/cuenta-personal.ts).
//  - modo "cliente": un cliente que se armó la mercadería solo.
// En la app no se elige lista, método ni precio: todo sale de la ficha del cliente
// con createPedido (los mismos precios que la web, vigentes al recibirlo). Nace
// "pendiente" con pedidos.origen = deposito_propio / deposito_cliente y retira
// mostrador: no va a la cola, "Facturar varios" lo toma y al facturar pasa a
// "entregado" (lib/pedidos/origen-deposito.ts). La oficina lo edita como cualquier
// pedido pendiente. La comisión del vendedor del cliente, la de siempre. No aplica
// la revisión del primer pedido (en_revision): lo cargó la empresa.
//
// Idempotente por local_id (pedidos.movil_local_id UNIQUE, vía conCaptura).
// Requiere la migración 20261105_pedidos_origen_numeracion.sql (columna origen).

import { agregarItemPedido, createPedido } from "@/lib/actions/pedidos"
import { cuentaPersonalDe } from "@/lib/cuenta-corriente/cuenta-personal"
import { fechaISO } from "@/lib/formato"
import { esErrorReglaPedido } from "@/lib/pedidos/errores"
import {
  articulosSinPrecio,
  juntarItems,
  MENSAJE_SIN_CUENTA_PERSONAL,
  mensajeSinPrecio,
  validarPayloadPedidoDeposito,
  type PayloadPedidoDeposito,
} from "@/lib/pedidos/origen-deposito"
import { prepararMotorCliente } from "@/lib/pricing/motor"
import { conCaptura, type CapturaPedido } from "../contexto-captura"
import { insumosAFecha } from "../precios-integridad"
import { RechazoNegocio, type HandlerDef } from "./tipos"

const nombreDe = (c: any) => c?.nombre_razon_social || c?.nombre || "Cliente"

async function pedidoExistente(admin: any, localId: string) {
  const { data, error } = await admin
    .from("pedidos")
    .select("id, numero_pedido, origen, cliente:clientes!pedidos_cliente_id_fkey(nombre_razon_social, nombre), pedidos_detalle(articulo_id)")
    .eq("movil_local_id", localId)
    .maybeSingle()
  if (error) throw new Error(`pedidos.movil_local_id: ${error.message}`)
  return data
}

/** Origen + retira mostrador: no va a la cola, sin remito; al facturar pasa a entregado. */
async function marcarCargadoEnDeposito(admin: any, pedidoId: string, modo: PayloadPedidoDeposito["modo"]) {
  const { error } = await admin
    .from("pedidos")
    .update({ origen: modo === "propio" ? "deposito_propio" : "deposito_cliente", condicion_entrega: "retira_mostrador" })
    .eq("id", pedidoId)
  // Sin esto el pedido entraría a la cola como uno común: transitorio, el reintento
  // lo encuentra por local_id y lo vuelve a marcar
  if (error) throw new Error(`pedidos.origen: ${error.message}`)
}

const pedidoCargarDeposito: HandlerDef<PayloadPedidoDeposito> = {
  tipo: "pedido.cargar_deposito",
  roles: ["deposito"],
  validar: validarPayloadPedidoDeposito,
  async aplicar(ctx, m) {
    const p = m.payload

    const items = juntarItems(p.items || [])

    // Reintento (ya llegó): el mismo pedido, sin volver a crearlo. createPedido no es
    // transaccional: si se cortó a mitad, se completan los renglones y la marca.
    const previo = await pedidoExistente(ctx.admin, p.local_id)
    if (previo) return completarExistente(ctx.admin, previo, items, p.modo)
    if (!items.length) throw new RechazoNegocio("El pedido no tiene artículos: escaneá al menos uno.", "sin_items")

    // ¿Para quién?
    let clienteId: string
    if (p.modo === "propio") {
      const propia = await cuentaPersonalDe(ctx.admin, { usuarioId: ctx.sesion.user.id })
      if (!propia) throw new RechazoNegocio(MENSAJE_SIN_CUENTA_PERSONAL, "sin_cuenta_personal")
      clienteId = propia
    } else {
      clienteId = p.cliente_id as string
    }
    const { data: cliente, error: cliErr } = await ctx.admin
      .from("clientes")
      .select("id, nombre_razon_social, nombre, activo")
      .eq("id", clienteId)
      .maybeSingle()
    if (cliErr) throw cliErr
    if (!cliente) throw new RechazoNegocio("El cliente no existe en el sistema: el pedido no se cargó.", "cliente_inactivo")
    if (cliente.activo === false) throw new RechazoNegocio(`${nombreDe(cliente)} está dado de baja: el pedido no se puede cargar.`, "cliente_inactivo")

    // Artículos: que existan y estén activos
    const ids = items.map((i) => i.articulo_id)
    const { data: arts, error: artErr } = await ctx.admin.from("articulos").select("id, descripcion, activo").in("id", ids)
    if (artErr) throw artErr
    const artDe = new Map<string, any>(((arts || []) as any[]).map((a) => [a.id, a]))
    const deBaja = ids.filter((id) => !artDe.has(id) || artDe.get(id).activo === false)
    if (deBaja.length) {
      const lista = deBaja.map((id) => ({ articulo_id: id, descripcion: artDe.get(id)?.descripcion || "Artículo que ya no existe" }))
      throw new RechazoNegocio(
        `Estos artículos están dados de baja: ${lista.map((a) => a.descripcion).join(", ")}. Sacalos del pedido.`,
        "articulo_dado_de_baja",
        { articulos: lista },
      )
    }

    // Precios: los de la ficha del cliente, vigentes ahora (mismo motor que createPedido)
    const ahora = new Date().toISOString()
    const reconstruido = await insumosAFecha(ctx.admin, clienteId, ids, ahora)
    const motor = prepararMotorCliente(reconstruido.insumos)
    const conPrecio = new Map<string, any>(reconstruido.articulos.map((a: any) => [a.id, a]))
    const sinPrecio = articulosSinPrecio(ids, (id) => {
      const a = conPrecio.get(id)
      if (!a) return null
      try {
        const pr = motor.precio(a)
        return { precio: pr.precio, sinLista: pr.sinLista }
      } catch {
        return null
      }
    })
    if (sinPrecio.length) {
      const lista = sinPrecio.map((id) => ({ articulo_id: id, descripcion: artDe.get(id)?.descripcion || "Artículo" }))
      throw new RechazoNegocio(mensajeSinPrecio(lista.map((a) => a.descripcion)), "sin_precio", { articulos: lista })
    }

    const captura: CapturaPedido = {
      clienteId,
      vigenciaAt: ahora,
      insumos: reconstruido.insumos,
      articulos: conPrecio,
      localId: p.local_id,
      fecha: fechaISO(m.capturado_at),
    }
    let pedido: any
    try {
      pedido = await conCaptura(captura, () =>
        createPedido({
          cliente_id: clienteId,
          items: items.map((i) => ({ producto_id: i.articulo_id, cantidad: i.cantidad, precio_unitario: 0, descuento: 0 })),
          observaciones: p.observaciones?.trim() || undefined,
          estado_inicial: "pendiente",
        }),
      )
    } catch (e: any) {
      // Dos envíos a la vez del mismo pedido: el otro ya lo creó (movil_local_id UNIQUE)
      if (e?.code === "23505") {
        const otro = await pedidoExistente(ctx.admin, p.local_id)
        if (otro) return completarExistente(ctx.admin, otro, items, p.modo)
      }
      if (esErrorReglaPedido(e)) throw new RechazoNegocio(e.message, "sin_precio")
      throw e
    }

    await marcarCargadoEnDeposito(ctx.admin, pedido.id, p.modo)
    return { pedido_id: pedido.id, numero_pedido: pedido.numero_pedido, cliente_nombre: nombreDe(cliente) }
  },
}

async function completarExistente(admin: any, previo: any, items: Array<{ articulo_id: string; cantidad: number }>, modo: PayloadPedidoDeposito["modo"]) {
  const tiene = new Set(((previo.pedidos_detalle || []) as any[]).map((d) => d.articulo_id))
  for (const it of items) if (!tiene.has(it.articulo_id)) await agregarItemPedido(previo.id, it.articulo_id, it.cantidad)
  if (!previo.origen) await marcarCargadoEnDeposito(admin, previo.id, modo)
  return { pedido_id: previo.id, numero_pedido: previo.numero_pedido, cliente_nombre: nombreDe(previo.cliente), ya_existia: true }
}

export const HANDLERS_PEDIDO_DEPOSITO: HandlerDef[] = [pedidoCargarDeposito]
