import { useState, type FormEvent } from "react"
import type { ItemOutbox } from "../db/idb"
import { ErrorHttp, ErrorRed } from "../net/errores"
import { useItemsOutbox, useRuntime } from "../react/contexto"
import { Boton, Encabezado } from "./componentes"
import { fechaHoraCorta } from "./formato"

/** Login de dispositivo: se ve UNA vez (la sesión queda guardada en el Keystore). */
export function PantallaLogin({ nombreApp }: { nombreApp: string }) {
  const { auth } = useRuntime()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setEnviando(true)
    try {
      await auth.ingresar(email.trim(), password)
    } catch (err) {
      setError(
        err instanceof ErrorRed
          ? "No hay conexión. El primer ingreso necesita internet."
          : err instanceof ErrorHttp
            ? err.message
            : "No se pudo ingresar.",
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-slate-900 p-6">
      <form onSubmit={enviar} className="space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">GM</div>
          <h1 className="text-2xl font-bold">{nombreApp}</h1>
        </div>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            className="mt-1 h-12 w-full rounded-lg border border-slate-300 px-3 text-base"
            type="email" inputMode="email" autoComplete="username" autoCapitalize="none"
            value={email} onChange={(e) => setEmail(e.target.value)} required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Contraseña</span>
          <input
            className="mt-1 h-12 w-full rounded-lg border border-slate-300 px-3 text-base"
            type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required
          />
        </label>
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <Boton type="submit" className="w-full" disabled={enviando}>
          {enviando ? "Ingresando…" : "Ingresar"}
        </Boton>
      </form>
    </div>
  )
}

const ESTADO: Record<ItemOutbox["estado"], { txt: string; cls: string }> = {
  pendiente: { txt: "Pendiente de enviar", cls: "bg-amber-100 text-amber-900" },
  enviando: { txt: "Enviando…", cls: "bg-sky-100 text-sky-900" },
  enviado: { txt: "Enviado", cls: "bg-emerald-100 text-emerald-900" },
  rechazado: { txt: "Rechazado", cls: "bg-red-100 text-red-800" },
}

/** Ruta /pendientes: estado de cada operación del outbox (común a las 3 apps). */
export function PantallaPendientes() {
  const { outbox, sync } = useRuntime()
  const items = [...useItemsOutbox()].reverse()
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <Encabezado titulo="Operaciones" />
      <div className="flex gap-2 p-3">
        <Boton variante="secundario" className="flex-1" onClick={() => void sync.todo()}>Enviar ahora</Boton>
      </div>
      {items.length === 0 && <p className="p-8 text-center text-slate-500">No hay operaciones registradas.</p>}
      <ul className="divide-y bg-white">
        {items.map((it) => (
          <li key={it.key} className="p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{it.etiqueta || it.tipo}</div>
                <div className="text-xs text-slate-500">
                  Capturada {fechaHoraCorta(it.capturadoAt)}
                  {it.enviadoAt ? ` · enviada ${fechaHoraCorta(it.enviadoAt)}` : ""}
                  {it.intentos > 1 && it.estado !== "enviado" ? ` · ${it.intentos} intentos` : ""}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO[it.estado].cls}`}>{ESTADO[it.estado].txt}</span>
            </div>
            {it.error && it.estado !== "enviado" && <p className="mt-1 text-sm text-red-700">{it.error}</p>}
            {it.estado === "rechazado" && (
              <Boton variante="secundario" className="mt-2 h-10 text-sm" onClick={() => void outbox.descartar(it.key)}>
                Entendido, descartar
              </Boton>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
