import { redirect } from "next/navigation"

/**
 * Pantalla RETIRADA (E-47 / E-15, 17/11/2026).
 *
 * La vieja "Comprobantes de la orden" creaba y editaba comprobantes de compra escribiendo
 * directo desde el navegador: sin control de duplicados, sin la regla de que los renglones
 * sumen el total y sin pasar por la validación del servidor. Nadie enlazaba a ella. Todo eso
 * se hace ahora desde la verificación de la orden (subir, cargar a mano, editar, validar).
 *
 * Queda la ruta para que un link viejo no dé 404. `revisar-matches.tsx`, en esta misma
 * carpeta, sigue en uso: lo importa la verificación.
 */
export default async function ComprobantesDeLaOrdenRetirada({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/ordenes-compra/${id}/verificacion`)
}
