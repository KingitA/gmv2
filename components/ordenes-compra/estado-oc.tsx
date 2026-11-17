import { ESTADOS_OC } from "@/lib/compras/orden-compra"
import { cn } from "@/lib/utils"

const TONOS: Record<string, string> = {
  amarillo: "bg-yellow-100 text-yellow-800",
  azul: "bg-blue-100 text-blue-800",
  violeta: "bg-purple-100 text-purple-800",
  naranja: "bg-orange-100 text-orange-800",
  verde: "bg-green-100 text-green-800",
  rojo: "bg-red-100 text-red-800",
  gris: "bg-gray-100 text-gray-800",
}

/** Etiqueta del estado de una orden de compra (los mismos nombres en el listado, el detalle y el envío). */
export function EstadoOC({ estado, className }: { estado: string; className?: string }) {
  const e = ESTADOS_OC[estado] ?? { nombre: estado, tono: "gris" as const }
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONOS[e.tono], className)}>{e.nombre}</span>
}
