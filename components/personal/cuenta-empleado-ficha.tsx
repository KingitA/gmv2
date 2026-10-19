"use client"

// "Cuenta de empleado" en la ficha del cliente (regla del dueño, 19/10/2026):
// si esta cuenta es la cuenta personal de alguien del personal, de quién es y
// qué códigos de vendedor cobran comisión acá. Se edita en /personal (solo admin).

import { useEffect, useState } from "react"
import Link from "next/link"
import { UserRound } from "lucide-react"

type Info = {
  es_empleado: boolean
  usuario: { id: string; nombre: string } | null
  vendedores: Array<{ id: string; nombre: string; activo: boolean }>
  puede_editar: boolean
}

export function CuentaEmpleadoFicha({ clienteId }: { clienteId: string }) {
  const [info, setInfo] = useState<Info | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/personal?cliente_id=${encodeURIComponent(clienteId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setInfo(j) })
      .catch(() => { if (vivo) setInfo(null) })
    return () => { vivo = false }
  }, [clienteId])

  if (!info) return null

  return (
    <div className="mt-4 rounded-xl border border-neutro-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-neutro-700">
          <UserRound className="size-4" /> Cuenta de empleado
        </p>
        <Link href="/personal" className="text-xs font-semibold text-azul-600 hover:underline">
          {info.puede_editar ? "Editar en Cuentas del personal →" : "Ver Cuentas del personal →"}
        </Link>
      </div>
      {!info.es_empleado ? (
        <p className="mt-1 text-sm text-neutro-500">No. Es una cuenta de cliente común.</p>
      ) : (
        <div className="mt-2 space-y-1 text-sm">
          <p className="text-neutro-600">
            Sí: es la cuenta personal de <b className="text-azul-900">{info.usuario?.nombre ?? "— (sin usuario vinculado)"}</b>. No cuenta como deuda de clientes.
          </p>
          <p className="text-neutro-600">
            Comisiones de:{" "}
            {info.vendedores.length
              ? info.vendedores.map((v) => v.nombre + (v.activo ? "" : " (inactivo)")).join(", ")
              : <span className="text-neutro-400">ningún código de vendedor</span>}
          </p>
        </div>
      )}
    </div>
  )
}
