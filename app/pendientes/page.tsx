"use client"

// ─── Bandeja de pendientes de la oficina (regla del dueño, 16/10/2026) ──────
// Todo lo que espera que alguien lo revise, en un solo lugar y con hace
// cuántos días espera: así nada queda "dando vueltas" en la base sin que nadie
// lo vea. Datos: GET /api/pendientes (solo lectura).
// Acciones: las de plata (imputar a lo más viejo / dejar a cuenta) abren el
// mismo diálogo que la Caja y son solo admin. Lo demás lleva a su pantalla.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { RefreshCw, Inbox } from "lucide-react"
import { fecha, moneda } from "@/lib/formato"
import { ImputarPago, type PagoAImputar } from "@/components/caja/imputar-pago"

type Datos = {
  puede_operar_caja: boolean
  cobros_sin_confirmar: Array<{ pago_id: string; cliente: string; monto: number; estado: string; en_camino?: boolean; quien: string; cargado_por: string | null; medios: string[]; desde: string; dias: number }>
  a_cuenta_sin_decidir: Array<{ pago_id: string; cliente_id: string; cliente: string; monto: number; disponible: number; desde: string; dias: number }>
  anticipos_esperando_factura: Array<{ pago_id: string; cliente: string; disponible: number; pedidos: string[]; desde: string; dias: number }>
  devoluciones_en_deposito: Array<{ devolucion_id: string; numero: string; cliente: string; monto: number; desde: string; dias: number }>
  devoluciones_sin_nc: Array<{ devolucion_id: string; numero: string; cliente: string; monto: number; aceptada_por: string | null; desde: string; dias: number }>
  rendiciones_abiertas: Array<{ rendicion_id: string; quien: string; tipo: string; efectivo: number; desde: string; dias: number; vencida: boolean }>
}

const Dias = ({ d, alerta = 7 }: { d: number; alerta?: number }) => (
  <Badge variant={d > alerta ? "destructive" : "secondary"} className="tabular-nums">
    {d === 0 ? "hoy" : d === 1 ? "1 día" : `${d} días`}
  </Badge>
)

function Seccion({ titulo, ayuda, cantidad, children }: { titulo: string; ayuda: string; cantidad: number; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {titulo}
          <Badge variant={cantidad ? "default" : "outline"} className="tabular-nums">{cantidad}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{ayuda}</p>
      </CardHeader>
      <CardContent>
        {cantidad === 0 ? <p className="py-2 text-sm text-muted-foreground">Nada pendiente.</p> : children}
      </CardContent>
    </Card>
  )
}

const fila = "flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0"

export default function PendientesPage() {
  const { toast } = useToast()
  const [data, setData] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [usuarioId, setUsuarioId] = useState<string>("")
  const [imputando, setImputando] = useState<PagoAImputar | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch("/api/pendientes")
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setCargando(false)
    }
  }, [toast])

  useEffect(() => {
    cargar()
    createClient().auth.getUser().then((r: any) => setUsuarioId(r?.data?.user?.id || ""))
  }, [cargar])

  const total = data
    ? data.cobros_sin_confirmar.length + data.a_cuenta_sin_decidir.length + data.devoluciones_en_deposito.length +
      data.devoluciones_sin_nc.length + data.rendiciones_abiertas.length
    : 0

  return (
    <div className="container mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Inbox className="h-6 w-6" /> Pendientes de revisar
          </h1>
          <p className="text-sm text-muted-foreground">
            Todo lo que espera que alguien lo controle. Nada de esto toca la cuenta del cliente hasta que se confirma.
          </p>
        </div>
        <Button variant="outline" onClick={cargar} disabled={cargando} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      {data && (
        <p className="text-sm font-semibold">{total === 0 ? "Está todo al día." : `${total} cosas esperando revisión.`}</p>
      )}

      {data && (
        <>
          <Seccion
            titulo="Cobros sin confirmar"
            ayuda="Cargados por la oficina, un vendedor o un chofer. Se confirman en Caja (solo admin)."
            cantidad={data.cobros_sin_confirmar.length}
          >
            {data.cobros_sin_confirmar.map((c) => (
              <div key={c.pago_id} className={fila}>
                <div className="min-w-0">
                  <p className="font-semibold">{c.cliente}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.quien}{c.cargado_por ? ` · ${c.cargado_por}` : ""} · {c.medios.join(", ") || "—"} · {c.en_camino ? "rendido, en camino a oficina" : c.estado === "pendiente_rendicion" ? "sin rendir" : "sin confirmar"} · {fecha(c.desde)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{moneda(c.monto)}</span>
                  <Dias d={c.dias} />
                </div>
              </div>
            ))}
            {data.puede_operar_caja && (
              <Link href="/caja" className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline">Ir a Caja →</Link>
            )}
          </Seccion>

          <Seccion
            titulo="Entregas a cuenta sin decidir"
            ayuda="Pagos confirmados con plata sin aplicar a ninguna factura. Imputar a lo más viejo o dejar a cuenta."
            cantidad={data.a_cuenta_sin_decidir.length}
          >
            {data.a_cuenta_sin_decidir.map((p) => (
              <div key={p.pago_id} className={fila}>
                <div className="min-w-0">
                  <p className="font-semibold">{p.cliente}</p>
                  <p className="text-xs text-muted-foreground">Pago de {moneda(p.monto)} del {fecha(p.desde)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{moneda(p.disponible)} a cuenta</span>
                  <Dias d={p.dias} />
                  {data.puede_operar_caja && (
                    <Button
                      size="sm"
                      onClick={() => setImputando({ pago_id: p.pago_id, cliente_id: p.cliente_id, quien: p.cliente, disponible: p.disponible })}
                    >
                      Decidir
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </Seccion>

          {data.anticipos_esperando_factura.length > 0 && (
            <Seccion
              titulo="Anticipos esperando la factura"
              ayuda="Pagos adelantados de pedidos sin facturar. Cuando se facture el pedido, se aplican solos a esa factura."
              cantidad={data.anticipos_esperando_factura.length}
            >
              {data.anticipos_esperando_factura.map((a) => (
                <div key={a.pago_id} className={fila}>
                  <div className="min-w-0">
                    <p className="font-semibold">{a.cliente}</p>
                    <p className="text-xs text-muted-foreground">Pedido {a.pedidos.join(", ")} · {fecha(a.desde)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">{moneda(a.disponible)}</span>
                    <Dias d={a.dias} alerta={30} />
                  </div>
                </div>
              ))}
            </Seccion>
          )}

          <Seccion
            titulo="Devoluciones esperando depósito"
            ayuda="Cargadas por el vendedor o el chofer. Ya descuentan del saldo proyectado; depósito tiene que revisar la mercadería."
            cantidad={data.devoluciones_en_deposito.length}
          >
            {data.devoluciones_en_deposito.map((d) => (
              <div key={d.devolucion_id} className={fila}>
                <div className="min-w-0">
                  <p className="font-semibold">{d.cliente}</p>
                  <p className="text-xs text-muted-foreground">{d.numero} · cargada el {fecha(d.desde)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{moneda(d.monto)}</span>
                  <Dias d={d.dias} alerta={14} />
                </div>
              </div>
            ))}
            <Link href="/revision-devoluciones" className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline">Ir a revisión de devoluciones →</Link>
          </Seccion>

          <Seccion
            titulo="Devoluciones aceptadas sin nota de crédito"
            ayuda="Depósito ya las aceptó. La nota de crédito o reversa la emite una persona de la oficina: el sistema nunca la emite solo."
            cantidad={data.devoluciones_sin_nc.length}
          >
            {data.devoluciones_sin_nc.map((d) => (
              <div key={d.devolucion_id} className={fila}>
                <div className="min-w-0">
                  <p className="font-semibold">{d.cliente}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.numero} · aceptada el {fecha(d.desde)}{d.aceptada_por ? ` por ${d.aceptada_por}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{moneda(d.monto)}</span>
                  <Dias d={d.dias} alerta={3} />
                </div>
              </div>
            ))}
            <Link href="/revision-devoluciones" className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline">Emitir notas de crédito →</Link>
          </Seccion>

          <Seccion
            titulo="Rendiciones abiertas"
            ayuda="El chofer o el vendedor ya mandó la rendición y falta controlar la plata. En rojo si pasa la semana."
            cantidad={data.rendiciones_abiertas.length}
          >
            {data.rendiciones_abiertas.map((r) => (
              <div key={r.rendicion_id} className={fila}>
                <div className="min-w-0">
                  <p className="font-semibold">{r.quien}</p>
                  <p className="text-xs text-muted-foreground">{r.tipo === "chofer" ? "Chofer" : "Vendedor"} · enviada el {fecha(r.desde)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{moneda(r.efectivo)} en efectivo</span>
                  <Dias d={r.dias} />
                </div>
              </div>
            ))}
            {data.puede_operar_caja && (
              <Link href="/caja" className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline">Controlar en Caja →</Link>
            )}
          </Seccion>
        </>
      )}

      {imputando && (
        <ImputarPago
          pago={imputando}
          usuarioId={usuarioId}
          onCerrar={() => setImputando(null)}
          onListo={() => {
            setImputando(null)
            cargar()
          }}
        />
      )}
    </div>
  )
}
