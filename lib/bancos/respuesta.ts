import { NextResponse } from "next/server"
import { ErrorCredicoop } from "./credicoop/nucleo"
import { ErrorOperacion } from "./operaciones"

/**
 * Convierte un error de las operaciones bancarias en la respuesta de la ruta. El mensaje ya
 * viene en castellano y dice qué hacer. `clase` le dice a la pantalla si la operación quedó
 * en duda (INCIERTO / DUPLICADO): en ese caso hay que actualizar el estado, no reenviar.
 */
export function respuestaErrorBanco(e: unknown, donde: string) {
  if (e instanceof ErrorOperacion) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
  if (e instanceof ErrorCredicoop) {
    const status = e.clase === "SIN_CONEXION" ? 503 : e.clase === "LIMITE" ? 429 : e.clase === "DATOS" ? 422 : e.clase === "INCIERTO" || e.clase === "DUPLICADO" ? 409 : 502
    return NextResponse.json({ error: e.message, clase: e.clase, codigo: e.codigo ?? null, operacion: (e as any).operacion ?? null }, { status })
  }
  console.error(`[bancos/credicoop] ${donde}`, e)
  return NextResponse.json({ error: (e as Error)?.message ?? "No se pudo completar la operación." }, { status: 500 })
}
