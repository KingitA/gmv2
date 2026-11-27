/**
 * Vigía de BANCOS (Tanda 5 del plan de bancos, control diario). Mismas reglas que el resto
 * (lib/jarvis/vigias.ts): solo lee, sin IA; el aviso va a "Lo que Jarvis notó" y se cierra solo
 * cuando ya no hay nada pendiente.
 *
 * Un solo aviso a la mañana con lo que falta: bancos sin actualizar hoy, diferencias banco vs
 * sistema, créditos sin identificar, cheques demorados (96 h), rechazos para confirmar y
 * propuestas pendientes (tandas 3, 4 y 5). Los datos son los del control diario
 * (lib/bancos/control/servidor.ts → panelControl).
 */
import { pesosCorto } from "@/lib/playroom/bloques"
import { panelControl } from "@/lib/bancos/control/servidor"
import { TOLERANCIA_DIFERENCIA } from "@/lib/bancos/control/reglas"
import type { Candidato, Vigia } from "./vigias"

const lista = (xs: string[], max = 3) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} y ${xs.length - max} más`)
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

const resumenBancos: Vigia = async (db) => {
  let p: Awaited<ReturnType<typeof panelControl>>
  try {
    p = await panelControl(db)
  } catch (e) {
    const err = e as { code?: string; message?: string } | null
    if (err?.code === "42P01" || err?.code === "PGRST205" || err?.code === "42703") return [] // migraciones de bancos sin aplicar
    throw e
  }
  if (!p.cuentas.length) return []
  const t = p.totales
  const propuestas = t.pendientes.cargo.cantidad + t.pendientes.propuesta_transferencia.cantidad + t.pendientes.propuesta_cheque.cantidad
  const partes: string[] = []
  if (t.sin_actualizar.length) partes.push(`sin actualizar hoy: ${lista(t.sin_actualizar)}`)
  if (t.con_diferencia.length) partes.push(`diferencia con el sistema en ${lista(t.con_diferencia.map((d) => `${d.nombre} (${pesosCorto(d.diferencia)})`))}`)
  if (t.pendientes.sin_identificar.cantidad) partes.push(`${plural(t.pendientes.sin_identificar.cantidad, "crédito sin identificar", "créditos sin identificar")} (${pesosCorto(t.pendientes.sin_identificar.monto)})`)
  if (t.demorados.cantidad) partes.push(`${plural(t.demorados.cantidad, "cheque sin acreditar", "cheques sin acreditar")} a las 96 h (${pesosCorto(t.demorados.monto)})`)
  if (t.pendientes.rechazo.cantidad) partes.push(`${plural(t.pendientes.rechazo.cantidad, "rechazo de cheque", "rechazos de cheques")} para confirmar`)
  if (propuestas) partes.push(`${plural(propuestas, "propuesta pendiente", "propuestas pendientes")}`)
  const otros = t.pendientes.debito.cantidad + t.pendientes.credito.cantidad + t.pendientes.sugerido.cantidad
  if (otros) partes.push(`${plural(otros, "movimiento sin conciliar", "movimientos sin conciliar")}`)
  if (t.no_aparecieron.cantidad) partes.push(`${plural(t.no_aparecieron.cantidad, "transferencia informada que no apareció", "transferencias informadas que no aparecieron")}`)
  if (!partes.length) return []

  const grave = t.con_diferencia.length > 0 || t.pendientes.rechazo.cantidad > 0 || t.demorados.cantidad > 0
  const severidad = t.con_diferencia.reduce((s, d) => s + Math.abs(d.diferencia), 0)
    + t.pendientes.sin_identificar.monto + t.demorados.monto + t.pendientes.rechazo.monto + t.no_aparecieron.monto
  const titulo = t.con_diferencia.length
    ? `Bancos: ${t.con_diferencia.length === 1 ? `${t.con_diferencia[0].nombre} no cuadra con el sistema` : `${t.con_diferencia.length} bancos no cuadran con el sistema`}`
    : `Bancos: ${plural(t.total, "cosa", "cosas")} sin explicar${t.sin_actualizar.length ? ` y ${plural(t.sin_actualizar.length, "banco", "bancos")} sin actualizar hoy` : ""}`
  const c: Candidato = {
    clave: "bancos-control-diario", vigia: "bancos_control", tono: grave ? "alerta" : "atencion",
    titulo,
    detalle: partes.map((x) => x[0].toUpperCase() + x.slice(1)).join(". ") + ".",
    acciones: [
      { texto: "Abrir control", pregunta: "¿Cómo están los bancos hoy?", href: "/finanzas/control-bancos" },
      { texto: "¿Cuadran?", pregunta: "¿Cuadra el banco con el sistema en cada cuenta?" },
    ],
    severidad: Math.max(severidad, 1),
    datos: {
      sin_actualizar: t.sin_actualizar, con_diferencia: t.con_diferencia,
      sin_identificar: t.pendientes.sin_identificar, demorados: t.demorados, rechazos: t.pendientes.rechazo.cantidad,
      propuestas, sin_conciliar: otros, no_aparecieron: t.no_aparecieron.cantidad, tolerancia: TOLERANCIA_DIFERENCIA,
    },
  }
  return [c]
}

export const VIGIAS_BANCOS: Record<string, Vigia> = { bancos_control: resumenBancos }
