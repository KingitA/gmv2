import { useNavigate } from "react-router"
import { useContadoresOutbox, useOverlay, useRuntime } from "@gm/core"
import { DS } from "../datasets"
import { useBorradores } from "../datos/borradores"
import { useClientes, useMe, usePedidos, useRefrescarAlEntrar, useYo } from "../datos/hooks"
import { BadgeEstado, fechaCorta, formatCurrency, HojaConfirmar, Pantalla, SinEnviar, useEnterCierraTeclado, useToast } from "../ui"

// Inicio del vendedor (port de app/vendedor/page.tsx). Atrás acá MINIMIZA la app (lo
// resuelve el core): no existe ninguna ruta del ERP a la que se pueda llegar.

interface Me {
  usuario: { id: string; nombre: string | null; email: string | null }
  total_clientes: number
  billetera: { saldo: number; cheques_cantidad: number; comisiones_pendientes: number }
  proximas_zonas: Array<{ id: string; nombre: string; fecha: string; estado: string; zonas?: { nombre: string; descripcion: string | null } | null; mis_clientes_en_zona: number }>
}

export function Inicio() {
  const navigate = useNavigate()
  const rt = useRuntime()
  const yo = useYo()
  const { fila: me } = useMe<Me>()
  const { clientes } = useClientes()
  const { pedidos } = usePedidos()
  const borradores = useBorradores().filter((b) => b.items.length > 0)
  const contadores = useContadoresOutbox()
  const salir = useOverlay("salir")
  const { toast, mostrar } = useToast()
  useEnterCierraTeclado()
  useRefrescarAlEntrar(DS.me)

  const cerrarSesion = async () => {
    try {
      await rt.salir()
    } catch (e) {
      salir.cerrar()
      mostrar((e as Error).message, "err")
    }
  }

  const acceso = "rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm"
  return (
    <Pantalla
      titulo={me?.usuario.nombre || yo.nombre}
      atras={false}
      dataset={DS.me}
      derecha={
        <>
          <button onClick={() => navigate("/billetera")} className="mr-1 min-h-10 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-medium">💰</button>
          <button onClick={salir.abrir} className="mr-1 min-h-10 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-medium" aria-label="Cerrar sesión">🚪</button>
        </>
      }
    >
      {toast}
      <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
        {borradores.map((b) => (
          <button key={b.clienteId} onClick={() => navigate(`/pedido/nuevo/${b.clienteId}`)} className="flex w-full items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left">
            <span className="text-2xl">🛒</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-gray-900">Pedido a medio cargar · {b.clienteNombre}</span>
              <span className="block text-sm text-gray-600">{b.items.length} artículo(s) — tocá para seguir</span>
            </span>
          </button>
        ))}

        <button onClick={() => navigate("/billetera")} className="w-full rounded-2xl bg-emerald-700 p-5 text-left text-white shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-emerald-200">💰 Saldo en billetera</p>
              <p className="mt-1 text-3xl font-bold">{formatCurrency(me?.billetera?.saldo ?? 0)}</p>
              {(me?.billetera?.cheques_cantidad || 0) > 0 && (
                <p className="mt-0.5 text-xs text-emerald-200">🧾 {me!.billetera.cheques_cantidad} {me!.billetera.cheques_cantidad === 1 ? "cheque" : "cheques"} en mano</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm text-emerald-200">Comisiones pend.</p>
              <p className="text-lg font-bold">{formatCurrency(me?.billetera?.comisiones_pendientes ?? 0)}</p>
            </div>
          </div>
        </button>

        <section className="grid grid-cols-2 gap-4">
          <button onClick={() => navigate("/clientes")} className={acceso}><p className="mb-2 text-3xl">👥</p><p className="text-lg font-bold text-gray-900">Mis Clientes</p><p className="mt-1 text-sm text-gray-500">{clientes.length || me?.total_clientes || 0} asignados</p></button>
          <button onClick={() => navigate("/pedido/nuevo")} className="rounded-2xl bg-emerald-600 p-5 text-left text-white shadow-sm"><p className="mb-2 text-3xl">🛒</p><p className="text-lg font-bold">Nuevo Pedido</p><p className="mt-1 text-sm text-emerald-100">Levantar pedido</p></button>
          <button onClick={() => navigate("/pago")} className="rounded-2xl bg-emerald-800 p-5 text-left text-white shadow-sm"><p className="mb-2 text-3xl">💵</p><p className="text-lg font-bold">Pago</p><p className="mt-1 text-sm text-emerald-200">Cobrar a un cliente</p></button>
          <button onClick={() => navigate("/pedidos")} className={acceso}><p className="mb-2 text-3xl">📋</p><p className="text-lg font-bold text-gray-900">Mis Pedidos</p><p className="mt-1 text-sm text-gray-500">Historial y estados</p></button>
          <button onClick={() => navigate("/precios")} className={acceso}><p className="mb-2 text-3xl">💲</p><p className="text-lg font-bold text-gray-900">Precios</p><p className="mt-1 text-sm text-gray-500">Consultá y compará listas</p></button>
          <button onClick={() => navigate("/viajes")} className={acceso}><p className="mb-2 text-3xl">🧭</p><p className="text-lg font-bold text-gray-900">Mis Viajes</p><p className="mt-1 text-sm text-gray-500">Levantar pedidos por zona</p></button>
          <button onClick={() => navigate("/estadisticas")} className={acceso}><p className="mb-2 text-3xl">📊</p><p className="text-lg font-bold text-gray-900">Estadísticas</p><p className="mt-1 text-sm text-gray-500">Ventas y comisiones</p></button>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-700">Últimos pedidos</h2>
            <button onClick={() => navigate("/pedidos")} className="min-h-11 text-sm font-medium text-emerald-700">Ver todos →</button>
          </div>
          {pedidos.length ? (
            <div className="space-y-3">
              {pedidos.slice(0, 5).map((p) => (
                <button key={p.id} onClick={() => navigate(`/pedidos/${p.id}`)} className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-gray-900">{p.cliente?.nombre || "Sin cliente"}</p>
                    <p className="text-sm text-gray-500">{p.numero_pedido ? `#${p.numero_pedido} · ` : ""}{fechaCorta(p.fecha)}</p>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <p className="font-bold text-gray-900">{formatCurrency(p.total)}</p>
                    {p.local ? <SinEnviar texto={p.local.estado === "rechazado" ? "no se pudo enviar" : "pendiente de enviar"} /> : <BadgeEstado estado={p.estado} />}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm"><p className="mb-3 text-4xl">📋</p><p className="text-lg text-gray-500">Todavía no tenés pedidos.</p></div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold text-gray-700">Próximas zonas</h2>
          {me?.proximas_zonas?.length ? (
            <div className="space-y-3">
              {me.proximas_zonas.map((z) => (
                <div key={z.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-gray-900">📍 {z.zonas?.nombre || z.nombre}</p>
                      <p className="text-sm text-gray-500">{fechaCorta(z.fecha, { weekday: "long", day: "numeric", month: "long" })}{z.zonas?.descripcion ? ` · ${z.zonas.descripcion}` : ""}</p>
                    </div>
                    <div className="ml-3 shrink-0 text-right">
                      {z.estado === "en_curso" && <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">EN CURSO</span>}
                      {z.mis_clientes_en_zona > 0 && <p className="mt-1 text-sm font-bold text-emerald-700">{z.mis_clientes_en_zona} clientes tuyos</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center text-gray-500 shadow-sm">No hay viajes programados.</div>
          )}
        </section>

        <p className="pb-4 text-center text-xs text-gray-400">GM Vendedor v{__APP_VERSION__} · {yo.email}</p>
      </div>

      <HojaConfirmar abierta={salir.abierto} onCerrar={salir.cerrar} titulo="¿Cerrar la sesión?" confirmar="Cerrar sesión" peligro onConfirmar={() => void cerrarSesion()}>
        {contadores.pendientes > 0
          ? `Tenés ${contadores.pendientes} operación(es) sin enviar: conectate y esperá a que salgan antes de cerrar la sesión.`
          : "Vas a tener que ingresar de nuevo con tu usuario y contraseña (necesitás conexión para eso)."}
      </HojaConfirmar>
    </Pantalla>
  )
}
