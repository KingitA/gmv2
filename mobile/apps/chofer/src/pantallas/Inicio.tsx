import { useState } from "react"
import { Link } from "react-router"
import { useContadoresOutbox, useFila, useRuntime, useSesion } from "@gm/core"
import { Boton, Encabezado, Frescura, fechaHoraCorta } from "@gm/core/ui"
import type { ChoferMe, ViajeResumen } from "../datasets"

function TarjetaViaje({ v, activo }: { v: ViajeResumen; activo?: boolean }) {
  return (
    <Link
      to={`/viajes/${v.id}`}
      className={`block rounded-xl border p-4 active:bg-slate-100 ${activo ? "border-emerald-500 bg-emerald-50" : "bg-white"}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold">{v.nombre || "Viaje"}</span>
        <span className="text-xs uppercase text-slate-500">{v.estado.replace("_", " ")}</span>
      </div>
      <div className="text-sm text-slate-600">
        {v.fecha} {v.zonas?.nombre ? `· ${v.zonas.nombre}` : ""}
      </div>
    </Link>
  )
}

export function Inicio() {
  const { fila: me, cargando } = useFila<ChoferMe>("chofer_me", "me")
  const { sesion } = useSesion()
  const rt = useRuntime()
  const c = useContadoresOutbox()
  const [texto, setTexto] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const [saliendo, setSaliendo] = useState(false)

  // Escritura de prueba de la fundación: va al outbox al instante (con o sin red)
  const registrarPrueba = async () => {
    const t = texto.trim()
    if (!t) return
    await rt.outbox.encolar({ tipo: "prueba.registrar", payload: { texto: t }, etiqueta: `Prueba: ${t}` })
    setTexto("")
    setMsg("Guardado en el equipo. Se envía solo cuando haya red.")
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <Encabezado titulo="Chofer" atras={false} />
      <Frescura dataset="chofer_me" />
      <main className="flex-1 space-y-4 p-3">
        <p className="text-sm text-slate-600">
          Hola, <b>{me?.usuario?.nombre || sesion?.user.email}</b>
        </p>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Viaje activo</h2>
          {cargando ? null : me?.viaje_activo ? (
            <TarjetaViaje v={me.viaje_activo} activo />
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">
              {me ? "No tenés un viaje en curso." : "Todavía no se descargaron tus datos. Conectate a internet una vez."}
            </p>
          )}
        </section>

        {!!me?.historial?.length && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Últimos viajes</h2>
            {me.historial.slice(0, 5).map((v) => (
              <TarjetaViaje key={v.id} v={v} />
            ))}
          </section>
        )}

        <section className="space-y-2 rounded-xl border bg-white p-3">
          <h2 className="font-semibold">Prueba de envío sin red</h2>
          <p className="text-xs text-slate-500">
            Escribí algo y guardalo: queda en el equipo al instante y se envía solo al volver la red (una sola vez).
            Pendientes ahora: <b>{c.pendientes}</b>
          </p>
          <input
            className="h-12 w-full rounded-lg border border-slate-300 px-3"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Texto de prueba"
            maxLength={200}
          />
          <Boton className="w-full" onClick={registrarPrueba} disabled={!texto.trim()}>
            Guardar
          </Boton>
          {msg && <p className="text-sm text-emerald-700">{msg}</p>}
          <Link to="/pendientes" className="block text-center text-sm font-semibold underline">
            Ver operaciones
          </Link>
        </section>

        <div className="pt-4 text-center text-xs text-slate-400">
          v{__APP_VERSION__} · equipo {rt.deviceId.slice(0, 8)} · reloj {Math.round(rt.reloj.desfasajeMs / 1000)} s
          {sesion?.expires_at ? ` · token hasta ${fechaHoraCorta(new Date(sesion.expires_at * 1000).toISOString())}` : ""}
        </div>
        <Boton
          variante="secundario"
          className="w-full"
          disabled={saliendo}
          onClick={async () => {
            setSaliendo(true)
            try {
              await rt.salir()
            } catch (e: any) {
              setMsg(e.message)
            } finally {
              setSaliendo(false)
            }
          }}
        >
          Cerrar sesión
        </Boton>
      </main>
    </div>
  )
}
