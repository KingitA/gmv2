"use server"

// Pedido preparado con TODO faltante (#17/#39 de la prueba de salida): no hay nada
// para facturar. Se puede volver a la cola del depósito (para prepararlo cuando
// haya mercadería) o eliminar. Las dos usan reiniciarPicking (App Depósito): un
// update de pedidos.estado dejaría los renglones en FALTANTE y a nombre de quien
// los preparó.

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { reiniciarPicking } from "@/lib/deposito/picking"
import { cantidadAFacturar } from "@/lib/pedidos/cantidad-a-facturar"
import { softDeletePedido } from "@/lib/actions/pedidos"

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

/** Elimina el pedido (primero lo saca de la preparación, después la baja de siempre). */
export async function eliminarPedidoSinMercaderia(pedidoId: string) {
  await verificarSinMercaderia(pedidoId)
  await reiniciarPicking(createAdminClient(), pedidoId)
  await softDeletePedido(pedidoId)
  return { ok: true }
}
