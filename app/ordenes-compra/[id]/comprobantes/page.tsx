import { redirect } from "next/navigation"

/**
 * Pantalla RETIRADA (E-15, 17/11/2026).
 *
 * La vieja pantalla de comprobantes de la orden de compra quedó huérfana: ningún botón ni
 * link del sistema llevaba a ella, y duplicaba (con reglas viejas) lo que hace la
 * verificación. Los comprobantes de una orden se cargan, revisan y validan en un solo lugar:
 * `/ordenes-compra/[id]/verificacion`.
 *
 * `revisar-matches.tsx`, en esta misma carpeta, SIGUE EN USO: lo importa la verificación.
 * Queda la ruta para que los links viejos (favoritos, historial) no den 404.
 */
export default async function ComprobantesDeLaOrdenRetirada({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/ordenes-compra/${id}/verificacion`)
}
