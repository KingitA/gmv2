import { redirect } from "next/navigation"

/**
 * Pantalla RETIRADA (E-01, 16/11/2026).
 *
 * La vieja "Cargar artículos" de la orden de compra sumaba stock con `incrementar_stock`
 * en CADA guardado (guardar dos veces = stock duplicado) y borraba y volvía a insertar
 * todo el detalle de la OC. El stock entra por un solo lugar: la recepción del depósito
 * (lib/deposito/recepciones.ts → finalizarRecepcion). Lo pedido, lo recibido y lo
 * facturado se revisan en la verificación.
 *
 * Queda la ruta para que los links viejos (favoritos, historial) no den 404.
 */
export default async function ArticulosDeLaOrdenRetirada({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/ordenes-compra/${id}/verificacion`)
}
