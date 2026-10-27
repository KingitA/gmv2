"use server"

// Pedido preparado con TODO faltante (#17/#39 de la prueba de salida): no hay nada
// para facturar. Se puede volver a la cola del depósito (para prepararlo cuando
// haya mercadería) o eliminar. Volver a la cola usa reiniciarPicking (App Depósito):
// un update de pedidos.estado dejaría los renglones en FALTANTE y a nombre de quien
// los preparó. Eliminar es un solo paso (R12): un pedido eliminado sale solo de la
// cola, así que no hace falta reiniciar la preparación antes (y si el borrado
// fallaba después de reiniciar, el pedido quedaba de vuelta en la cola).

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { reiniciarPicking } from "@/lib/deposito/picking"
import { cantidadAFacturar } from "@/lib/pedidos/cantidad-a-facturar"
import { nowArgentina } from "@/lib/utils"

async function verificarSinMercaderia(pedidoId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autorizado")
  const { data: renglones, error } = await supabase
    .from("pedidos_detalle")
    .select("cantidad, cantidad_preparada, estado_item")
    .eq("pedido_id", pedidoId)
  if (error) throw new Error(error.message)
  if ((renglones || []).some((r: any) => cantidadAFacturar(r) > 0)) {
    throw new Error("El pedido tiene mercadería preparada: se factura con Generar.")
  }
}

/** Vuelve el pedido a "pendiente": entra de nuevo a la cola del depósito. */
export async function volverPedidoSinMercaderiaAPendiente(pedidoId: string) {
  await verificarSinMercaderia(pedidoId)
  await reiniciarPicking(createAdminClient(), pedidoId)
  revalidatePath("/clientes-pedidos")
  return { ok: true }
}

/** Elimina el pedido de una vez, igual que softDeletePedido pero desde "Pendiente Facturación". */
export async function eliminarPedidoSinMercaderia(pedidoId: string) {
  await verificarSinMercaderia(pedidoId)
  const supabase = await createClient()
  const { data: compVivo } = await supabase
    .from("comprobantes_venta")
    .select("tipo_comprobante, numero_comprobante")
    .eq("pedido_id", pedidoId)
    .is("anulado_en", null)
    .neq("estado_pago", "anulado")
    .in("tipo_comprobante", ["FA", "FB", "FC", "PRES", "ND", "NDA", "NDB", "NDC"])
    .limit(1)
    .maybeSingle()
  if (compVivo) throw new Error(`El pedido tiene el comprobante ${compVivo.tipo_comprobante} ${compVivo.numero_comprobante} vivo: anulalo primero.`)

  const { data: borrado, error } = await supabase
    .from("pedidos")
    .update({ estado: "eliminado", eliminado_at: nowArgentina() })
    .eq("id", pedidoId)
    .eq("estado", "pendiente_facturacion")
    .select("id")
  if (error) throw new Error(`No se pudo eliminar el pedido: ${error.message}`)
  if (!borrado?.length) throw new Error("El pedido ya no está en Pendiente Facturación: refrescá la pantalla.")

  // Igual que softDeletePedido: fuera de los reportes de ventas y comisiones
  await supabase.from("kardex").update({ pedido_eliminado: true }).eq("pedido_id", pedidoId)
  revalidatePath("/clientes-pedidos")
  return { ok: true }
}
