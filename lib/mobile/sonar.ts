// Hacer sonar un equipo perdido (20/11/2026). Ver MOBILE.md → "Hacer sonar un equipo".
// Reglas puras (las prueban los tests) + el envío con registro.

import { enviarFcm, type ResultadoFcm } from "./fcm"

export type AccionSonar = "sonar" | "detener"

/**
 * ¿Puede este usuario hacer sonar un equipo de esta app?
 * - admin (ERP → Equipos y apps): cualquiera.
 * - depósito (app depósito → "Buscar el equipo de un compañero"): solo equipos de depósito.
 */
export function puedeSonar(roles: string[], appDestino: string): boolean {
  if (roles.includes("admin")) return true
  return roles.includes("deposito") && appDestino === "deposito"
}

export interface EquipoSonable {
  device_id: string
  app: string
  usuario_id: string | null
  ultimo_contacto_at: string | null
  fcm_token: string | null
  revocado?: boolean | null
}

/** Por qué no se puede hacer sonar (null = se puede). Texto para el ERP y la app. */
export function motivoNoSuena(e: EquipoSonable): string | null {
  if (e.revocado) return "El equipo está dado de baja."
  if (e.fcm_token) return null
  if (!e.usuario_id || !e.ultimo_contacto_at) return "Nunca inició sesión en este equipo."
  return "Todavía no actualizó la app (o no dio permiso de avisos)."
}

export const MENSAJE_RESULTADO: Record<string, string> = {
  enviado: "Listo: el equipo va a sonar en unos segundos (hasta 60 s o hasta que lo apaguen).",
  detenido: "Listo: se mandó la orden de apagar.",
  sin_firebase: "Falta configurar Firebase en el servidor: avisá a sistemas.",
  token_invalido: "El equipo cambió su registro: que abra la app una vez con señal y probá de nuevo.",
}

export function mensajeResultado(accion: AccionSonar, r: ResultadoFcm | "sin_token"): string {
  if (r === "enviado") return accion === "sonar" ? MENSAJE_RESULTADO.enviado : MENSAJE_RESULTADO.detenido
  if (r === "sin_token") return "Este equipo todavía no puede sonar."
  return MENSAJE_RESULTADO[r] ?? "No se pudo avisar al equipo. Probá de nuevo en un rato."
}

/** Manda el mensaje y deja registro (best effort: sin la tabla de registro, igual suena). */
export async function sonarEquipo(
  admin: any,
  args: { equipo: EquipoSonable; accion: AccionSonar; pedidoPor: string; nombrePide: string | null; origen: "erp" | "app" },
): Promise<ResultadoFcm | "sin_token"> {
  const { equipo, accion } = args
  const resultado: ResultadoFcm | "sin_token" = !equipo.fcm_token
    ? "sin_token"
    : await enviarFcm(equipo.fcm_token, accion === "sonar"
      ? { tipo: "sonar", mensaje: args.nombrePide ? `Te busca ${args.nombrePide}` : "Te busca la oficina" }
      : { tipo: "detener" })
  await admin.from("mobile_sonar_log").insert({
    device_id: equipo.device_id, app: equipo.app, accion, pedido_por: args.pedidoPor, origen: args.origen, resultado,
  }).then(() => {}, () => {})
  return resultado
}
