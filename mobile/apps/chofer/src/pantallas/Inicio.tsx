import { useNavigate } from "react-router"
import { useContadoresOutbox, useNoEnviados, useOverlay, useRuntime } from "@gm/core"
import { fechaHoraCorta } from "@gm/core/ui"
import { DS, type ViajeResumen } from "../datasets"
import { rechazosDe, useDescargaViaje, useMe, useRefrescarAlEntrar, useViaje, useYo } from "../datos/hooks"
import { AvisosBcra, fechaViaje, HojaConfirmar, Pantalla, Rechazos, useAvisoEntrante, useEnterCierraTeclado, useToast } from "../ui"

// Inicio del chofer (port de app/chofer/page.tsx). Atrás acá MINIMIZA la app (lo
// resuelve el core): no existe ninguna ruta del ERP a la que se pueda llegar.

function EstadoDescarga({ viajeId }: { viajeId: string }) {
  const d = useDescargaViaje(viajeId)
  if (!d.total && !d.completa) return null
  return d.completa ? (
    <p className="mt-2 rounded-lg bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700">
      ✓ Viaje descargado ({d.total} {d.total === 1 ? "cliente" : "clientes"}){d.generadoAt ? ` · datos al ${fechaHoraCorta(d.generadoAt)}` : ""}
    </p>
  ) : (
    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800">
      ⏳ Descargando el viaje: {d.descargados}/{d.total} clientes. Esperá a que esté completo antes de salir a ruta.
    </p>
  )
}

function TarjetaActivo({ v }: { v: ViajeResumen }) {
  const navigate = useNavigate()
  const { viaje } = useViaje(v.id)
  const estado = viaje?.viaje.estado || v.estado
  return (
    <button
      onClick={() => navigate(`/viajes/${v.id}`)}
      className="w-full rounded-2xl border-2 border-blue-500 bg-white p-5 text-left shadow-sm active:bg-blue-50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xl font-bold text-gray-900">{v.nombre || "Viaje"}</p>
          <p className="mt-1 text-gray-500">{fechaViaje(v.fecha)}</p>
          {v.zonas?.nombre && <p className="mt-1 font-medium text-blue-600">📍 {v.zonas.nombre}</p>}
        </div>
        {estado === "despachado" ? (
          <span className="shrink-0 rounded-full bg-indigo-100 px-3 py-1 text-sm font-bold text-indigo-700">LISTO PARA SALIR</span>
        ) : estado === "en_rendicion" ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-700">{viaje?.cierrePendiente ? "CIERRE SIN ENVIAR" : "EN RENDICIÓN"}</span>
        ) : (
          <span className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-green-700">EN CURSO</span>
        )}
      </div>
      <EstadoDescarga viajeId={v.id} />
      <div className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-center font-medium text-blue-700">Tocar para gestionar el viaje →</div>
    </button>
  )
}

export function Inicio() {
  const navigate = useNavigate()
  const rt = useRuntime()
  const yo = useYo()
  const { fila: me, cargando } = useMe()
  const contadores = useContadoresOutbox()
  const ops = useNoEnviados()
  const salir = useOverlay("salir")
  const { toast, mostrar } = useToast()
  useEnterCierraTeclado()
  useAvisoEntrante(mostrar)
  useRefrescarAlEntrar(DS.me)

  const cerrarSesion = async () => {
    try {
      await rt.salir()
    } catch (e) {
      salir.cerrar()
      mostrar((e as Error).message, "err")
    }
  }

  return (
    <Pantalla
      titulo={me?.usuario.nombre || yo.nombre}
      atras={false}
      dataset={DS.me}
      derecha={
        <>
          <button onClick={() => navigate("/billetera")} className="mr-1 min-h-10 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-medium">💰 Billetera</button>
          <button onClick={salir.abrir} className="mr-1 min-h-10 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-medium" aria-label="Cerrar sesión">🚪</button>
        </>
      }
    >
      {toast}
      {/* Lo que la oficina rechazó (un cobro, una parada…) se ve apenas se abre la app: no queda escondido en un contador */}
      <Rechazos items={rechazosDe(ops, "")} ayuda="Eso NO quedó registrado en el sistema. Revisalo y, si corresponde, cargalo de nuevo." />
      {/* Veredicto del BCRA de los cheques cobrados (llega después del cobro, también si se cargó sin señal) */}
      <AvisosBcra />
      <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
        <section>
          <h2 className="mb-3 text-lg font-bold text-gray-700">Viaje Activo</h2>
          {cargando ? null : me?.viaje_activo ? (
            <TarjetaActivo v={me.viaje_activo} />
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
              <p className="mb-3 text-4xl">🚛</p>
              <p className="text-lg text-gray-500">{me ? "No tenés un viaje asignado hoy." : "Todavía no se descargaron tus datos."}</p>
              <p className="mt-1 text-sm text-gray-400">{me ? "Consultá con administración." : "Conectate a internet una vez."}</p>
            </div>
          )}
        </section>

        {!!me?.historial?.length && (
          <section>
            <h2 className="mb-3 text-lg font-bold text-gray-700">Viajes Anteriores</h2>
            <div className="space-y-3">
              {me.historial.map((v) => (
                <button key={v.id} onClick={() => navigate(`/viajes/${v.id}`)} className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm active:bg-gray-50">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-gray-800">{v.nombre || "Viaje"}</p>
                      <p className="mt-0.5 text-sm text-gray-400">{fechaViaje(v.fecha, { day: "numeric", month: "long", year: "numeric" })}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${v.estado === "completado" ? "bg-gray-100 text-gray-500" : "bg-amber-100 text-amber-700"}`}>
                        {v.estado === "completado" ? "FINALIZADO" : "PENDIENTE RENDICIÓN"}
                      </span>
                      <span className="text-gray-400">›</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <p className="pb-4 text-center text-xs text-gray-400">
          GM Chofer v{__APP_VERSION__} · {yo.email} · equipo {rt.deviceId.slice(0, 8)}
        </p>
      </div>

      <HojaConfirmar abierta={salir.abierto} onCerrar={salir.cerrar} titulo="¿Cerrar la sesión?" confirmar="Cerrar sesión" peligro onConfirmar={() => void cerrarSesion()}>
        {contadores.pendientes > 0
          ? `Tenés ${contadores.pendientes} operación(es) sin enviar: conectate y esperá a que salgan antes de cerrar la sesión.`
          : "Vas a tener que ingresar de nuevo con tu usuario y contraseña (necesitás conexión para eso). En ruta no hace falta: la sesión queda guardada en el equipo."}
      </HojaConfirmar>
    </Pantalla>
  )
}
