"use client"

// Feriados y vacaciones para mostrar en los calendarios de viajes (Viajes, Clientes,
// "Programar viaje", ficha del viaje). Lee /api/viajes/calendario-laboral.
// Los datos los cargan: feriados → Jarvis (fuente oficial) + quien decide si se trabaja;
// vacaciones → Ajustes → Personas → Vacaciones y ausencias.

import { useCallback, useEffect, useMemo, useState } from "react"
import { sumarDiasISO } from "@/lib/formato"
import type { Ausencia, DiaEspecial } from "./calendario-laboral"

export type MarcaDia = { feriado?: { texto: string; tono: "no" | "duda" | "si" }; ausentes?: string[] }

export function useCalendarioLaboral(desde: string | null, hasta: string | null) {
  const [especiales, setEspeciales] = useState<DiaEspecial[]>([])
  const [ausencias, setAusencias] = useState<Ausencia[]>([])

  const cargar = useCallback(async () => {
    if (!desde || !hasta) return
    try {
      const r = await fetch(`/api/viajes/calendario-laboral?desde=${desde}&hasta=${hasta}`)
      if (!r.ok) return
      const j = await r.json()
      setEspeciales(j.especiales ?? [])
      setAusencias(j.ausencias ?? [])
    } catch {
      /* sin datos: el calendario se ve igual que antes */
    }
  }, [desde, hasta])
  useEffect(() => { cargar() }, [cargar])

  const marcas = useMemo(() => {
    const m = new Map<string, MarcaDia>()
    for (const e of especiales) {
      const tono = e.trabajamos === null ? "duda" : e.trabajamos ? "si" : "no"
      const texto = e.trabajamos === null ? `${e.nombre} · ¿trabajamos?` : e.trabajamos ? `${e.nombre} · se trabaja` : `${e.nombre} · no se trabaja`
      m.set(e.fecha, { ...(m.get(e.fecha) ?? {}), feriado: { texto, tono } })
    }
    if (desde && hasta) {
      for (const a of ausencias) {
        for (let d = a.desde < desde ? desde : a.desde; d <= a.hasta && d <= hasta; d = sumarDiasISO(d, 1)) {
          const x = m.get(d) ?? {}
          m.set(d, { ...x, ausentes: [...(x.ausentes ?? []), a.nombre] })
        }
      }
    }
    return m
  }, [especiales, ausencias, desde, hasta])

  /** Ausencia de esa persona que se cruza con el rango (para avisar al asignarla). */
  const ausenciaDe = useCallback(
    (usuarioId: string, d1: string, d2: string) => ausencias.find((a) => a.usuario_id === usuarioId && a.desde <= d2 && a.hasta >= d1) ?? null,
    [ausencias],
  )

  return { marcas, especiales, ausencias, ausenciaDe, recargar: cargar }
}

/**
 * PATCH de un viaje que, si alguien del equipo está de vacaciones, pide confirmación
 * (el servidor responde 409 requiere_confirmacion). Devuelve null si el usuario canceló.
 */
export async function patchViajeConfirmando(viajeId: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: any } | null> {
  const enviar = async (b: Record<string, unknown>) => {
    const res = await fetch(`/api/viajes/${viajeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
    return { res, data: await res.json().catch(() => ({})) }
  }
  let { res, data } = await enviar(body)
  if (res.status === 409 && data?.requiere_confirmacion === "ausencia") {
    if (!window.confirm(`${data.error}\n\n¿Seguir igual? (queda registrado que lo confirmaste)`)) return null
    ;({ res, data } = await enviar({ ...body, confirmar_ausencias: true }))
  }
  return { ok: res.ok, data }
}
