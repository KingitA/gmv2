import { useMemo } from "react"
import { useNavigate } from "react-router"
import { useParamEstado } from "@gm/core"
import { ListaVirtual } from "@gm/core/ui"
import { DS } from "../../datasets"
import { useBorradores, type Borrador } from "../../datos/borradores"
import { usePedidos, useRefrescarAlEntrar } from "../../datos/hooks"
import type { PedidoVista } from "../../datos/overlay"
import { BadgeEstado, fechaCorta, formatCurrency, Pantalla, SinEnviar } from "../../ui"

// Mis pedidos (= app/vendedor/pedidos/page.tsx). El filtro ?estado= que la web resolvía en
// el servidor (.eq("estado", …)) se aplica LOCAL sobre la réplica + lo tomado acá sin enviar.
// Arriba de todo: los pedidos a medio cargar de este equipo (borradores con ítems).

const ESTADOS = [
  { key: "", label: "Todos" },
  { key: "en_venta", label: "En venta" },
  { key: "pendiente", label: "Pendientes" },
  { key: "impreso", label: "Impresos" },
  { key: "en_preparacion", label: "En preparación" },
  { key: "en_viaje", label: "En viaje" },
] as const

type Fila = { tipo: "borrador"; clave: string; b: Borrador } | { tipo: "pedido"; clave: string; p: PedidoVista }

const ALTO = 92
const ALTO_CON_AVISO = 120
const ALTO_RECHAZADO = 140
const altoDe = (f: Fila) => (f.tipo === "borrador" ? ALTO : f.p.local?.estado === "rechazado" ? ALTO_RECHAZADO : f.p.local || f.p.cambios ? ALTO_CON_AVISO : ALTO)

export function Pedidos() {
  const navigate = useNavigate()
  const [estado, setEstado] = useParamEstado("estado")
  const { pedidos, cargando } = usePedidos()
  const borradores = useBorradores()
  useRefrescarAlEntrar(DS.pedidos)

  const filas = useMemo<Fila[]>(() => {
    const medio = borradores.filter((b) => b.items.length > 0).map((b): Fila => ({ tipo: "borrador", clave: `borrador:${b.clienteId}`, b }))
    const lista = (estado ? pedidos.filter((p) => p.estado === estado) : pedidos).map((p): Fila => ({ tipo: "pedido", clave: p.id, p }))
    return [...medio, ...lista]
  }, [borradores, pedidos, estado])

  const abrir = (p: PedidoVista) => {
    if (p.local) navigate(`/pedidos/${p.id}`)
    else if (p.estado === "en_venta" && p.cliente?.id) navigate(`/pedido/nuevo/${p.cliente.id}?pedido=${p.id}`)
    else navigate(`/pedidos/${p.id}`)
  }

  return (
    <Pantalla
      titulo="Mis Pedidos"
      dataset={DS.pedidos}
      derecha={
        <button onClick={() => navigate("/pedido/nuevo")} className="mr-1 min-h-11 rounded-xl border border-emerald-500 bg-emerald-600 px-4 text-sm font-medium">
          + Nuevo
        </button>
      }
    >
      <div className="flex shrink-0 gap-2 overflow-x-auto bg-emerald-700 px-4 py-2">
        {ESTADOS.map((e) => (
          <button
            key={e.key}
            onClick={() => setEstado(e.key)}
            className={`min-h-11 whitespace-nowrap rounded-full px-4 text-sm font-medium ${estado === e.key ? "bg-white text-emerald-700" : "bg-emerald-600 text-emerald-100"}`}
          >
            {e.label}
          </button>
        ))}
      </div>

      {cargando ? null : (
        <ListaVirtual
          items={filas}
          altoDe={altoDe}
          clave={(f) => f.clave}
          vacio={
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
              <p className="mb-3 text-4xl">📋</p>
              <p className="text-lg text-gray-500">No hay pedidos.</p>
            </div>
          }
          render={(f) => (
            <div className="mx-auto h-full w-full max-w-2xl px-4 pt-3">
              {f.tipo === "borrador" ? (
                <button
                  onClick={() => navigate(`/pedido/nuevo/${f.b.clienteId}`)}
                  className="flex h-full w-full items-center gap-3 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-4 text-left active:bg-amber-100"
                >
                  <span className="text-2xl">🛒</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-amber-900">Pedido a medio cargar · {f.b.clienteNombre}</p>
                    <p className="truncate text-sm text-amber-800">
                      {f.b.items.length} {f.b.items.length === 1 ? "ítem" : "ítems"} — tocá para seguir
                    </p>
                  </div>
                </button>
              ) : (
                <TarjetaPedido p={f.p} onAbrir={() => abrir(f.p)} />
              )}
            </div>
          )}
        />
      )}
    </Pantalla>
  )
}

function TarjetaPedido({ p, onAbrir }: { p: PedidoVista; onAbrir: () => void }) {
  const fecha = fechaCorta(p.fecha, { day: "numeric", month: "short", year: "numeric" })
  return (
    <button onClick={onAbrir} className="flex h-full w-full items-center justify-between overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm active:bg-gray-50">
      <div className="min-w-0">
        <p className="truncate font-bold text-gray-900">{p.cliente?.nombre || "Sin cliente"}</p>
        {p.local ? (
          <>
            <p className="truncate text-sm text-gray-500">
              {fecha} · {p.local.estado === "enviando" ? "Enviando…" : p.local.estado === "rechazado" ? "" : "Pendiente de enviar"}
            </p>
            {p.local.estado === "rechazado" && <p className="line-clamp-2 text-sm font-medium text-red-600">No se pudo enviar: {p.local.error || "el servidor lo rechazó"}</p>}
            <div className="mt-1">
              <SinEnviar />
            </div>
          </>
        ) : (
          <>
            <p className="truncate text-sm text-gray-500">
              {p.numero_pedido ? `#${p.numero_pedido} · ` : ""}
              {fecha}
              {p.estado === "en_venta" ? " · tocá para seguir cargando" : ""}
            </p>
            {p.cambios && (
              <div className="mt-1">
                <SinEnviar texto="cambios sin enviar" />
              </div>
            )}
          </>
        )}
      </div>
      <div className="ml-3 shrink-0 text-right">
        <p className="font-bold text-gray-900">{formatCurrency(p.total || 0)}</p>
        <BadgeEstado estado={p.estado} />
      </div>
    </button>
  )
}
