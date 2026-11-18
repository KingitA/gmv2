"use client"

// Botón "Conectar Gmail" con la explicación de qué hay que hacer antes. Es el ÚNICO lugar de
// la pantalla desde el que se conecta (o se vuelve a conectar) la cuenta de la que salen las
// órdenes de compra. Lleva a /api/auth/google (Google pide elegir la cuenta y aceptar los
// permisos) y vuelve a /ordenes-compra con el resultado.
// SOLO ADMIN: el sistema lee el correo de todas las cuentas conectadas. A quien no es admin se
// le dice que se lo pida a un administrador (la ruta también lo exige).

import { Link2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMisRoles } from "@/lib/hooks/useMisRoles"

export type EstadoCuentaGmail = "conectada" | "vencida" | "sin_permiso" | "no_conectada"

export const TEXTO_ESTADO_CUENTA: Record<EstadoCuentaGmail, string> = {
  conectada: "conectada",
  vencida: "la conexión venció o fue revocada",
  sin_permiso: "conectada, pero sin permiso para enviar mails",
  no_conectada: "NO conectada",
}

/** Dirección que arranca la conexión con Google y vuelve a Órdenes de compra */
export const URL_CONECTAR_GMAIL = "/api/auth/google?volver=" + encodeURIComponent("/ordenes-compra")

export function ConectarGmail({ cuenta, estado, className }: { cuenta: string; estado?: EstadoCuentaGmail; className?: string }) {
  const { esAdmin, loading } = useMisRoles()
  const reconectar = estado === "vencida" || estado === "sin_permiso"
  if (loading) return null
  if (!esAdmin) {
    return (
      <div className={cn("rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950", className)}>
        Pedile a un administrador que conecte la cuenta <b>{cuenta}</b> desde Órdenes de compra → “Envío de órdenes”.
      </div>
    )
  }
  return (
    <div className={cn("rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950", className)}>
      <div className="mb-2">
        <b>Antes de tocar el botón:</b> entrá a Gmail con <b>{cuenta}</b> en este navegador. Google te va a pedir elegir la cuenta
        (elegí esa) y aceptar los permisos: aceptalos todos{estado === "sin_permiso" ? ", en especial el de enviar correo" : ""}.
        Al terminar volvés solo a esta pantalla.
      </div>
      <a href={URL_CONECTAR_GMAIL}
        className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        <Link2 className="mr-2 h-4 w-4" /> {reconectar ? "Volver a conectar Gmail" : "Conectar Gmail"}
      </a>
    </div>
  )
}
