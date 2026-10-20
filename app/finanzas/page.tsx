"use client"

// Panel de Finanzas: lo que hay (efectivo, bancos, cheques y bolsa), lo que hay que pagar
// (calendario de la semana con los atrasados al costado) y si alcanza ("¿Llego a pagar?").
// Diseño acordado con el dueño (20/10/2026). Mismos cálculos de antes: solo cambia cómo se ve.
//  - Los saldos se cambian tocándolos (queda quién, cuándo y el motivo, en el kardex).
//  - Los pagos se editan, se mueven, se pagan o generan la OP desde su tarjeta del calendario.
//  - La cartera de cheques, la importación del Excel y los cheques propios están en Finanzas → Cheques.

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts"
import { LineChart as IconoGrafico, Pencil, Plus, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CalendarioPagos } from "@/components/finanzas/calendario-pagos"
import { AjustarSaldoDialog, type CuentaAjustable } from "@/components/finanzas/ajustar-saldo-dialog"
import { NuevoGastoDialog } from "@/components/finanzas/nuevo-gasto-dialog"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { cn } from "@/lib/utils"
import { fecha, fechaCorta, fechaHora, fechaISO, hora, hoyISO, moneda, numero, sumarDiasISO } from "@/lib/formato"

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Cuenta = CuentaAjustable & { grupo?: string; updated_at?: string | null }
type Cartera = "BLANCO" | "NEGRO" | "ECHEQ"
interface Cheque { id: string; numero: string; monto: number; fecha_vencimiento: string; color: string; es_echeq: boolean }
interface Ajuste { fecha: string; usuario: string | null; motivo: string | null }

const CARTERAS: { key: Cartera; label: string }[] = [
  { key: "BLANCO", label: "Blanco" },
  { key: "NEGRO", label: "Negro" },
  { key: "ECHEQ", label: "Echeq" },
]
// Colores de las líneas de la evolución (orden fijo)
const COLORES_SERIE = ["#4549B5", "#22A9C9", "#B47C0F", "#15805A", "#C8641A", "#7C7FD0", "#545871", "#D2364B"]

const claveCuenta = (c: { cuenta_tipo: string; cuenta_id: string }) => `${c.cuenta_tipo}:${c.cuenta_id}`
const saldoDe = (c: Cuenta) => Number(c.saldos?.BLANCO ?? 0) + Number(c.saldos?.NEGRO ?? 0)
const carteraDe = (c: { color: string; es_echeq: boolean }): Cartera => (c.es_echeq ? "ECHEQ" : c.color === "NEGRO" ? "NEGRO" : "BLANCO")
/** "$1,5 M" · "$12 K" para ejes */
const corto = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : ""
  if (a >= 1_000_000) return `${s}$${numero(a / 1_000_000, 1)} M`
  if (a >= 1_000) return `${s}$${numero(a / 1_000, 0)} K`
  return moneda(n, 0)
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function FinanzasPage() {
  const hoy = hoyISO()
  const [loading, setLoading] = useState(true)
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [cheques, setCheques] = useState<Cheque[]>([])
  const [depositados, setDepositados] = useState<{ monto: number }[]>([])
  const [vencs, setVencs] = useState<any[]>([])
  const [emitidos, setEmitidos] = useState<{ monto: number; fecha_vencimiento: string }[]>([])
  const [proyRet, setProyRet] = useState<Record<string, { retencion: number; neto: number }>>({})
  const [evolucion, setEvolucion] = useState<{ serie: any[]; cuentas: string[] }>({ serie: [], cuentas: [] })
  const [extra, setExtra] = useState<{ ultimos_ajustes: Record<string, Ajuste>; en_calle: number; en_calle_detalle: { nombre: string; monto: number }[]; cobros_por_verificar: { cantidad: number; monto: number } }>({
    ultimos_ajustes: {}, en_calle: 0, en_calle_detalle: [], cobros_por_verificar: { cantidad: 0, monto: 0 },
  })

  // Cuentas y carteras que entran en "¿Llego a pagar?" (por defecto: efectivo, bancos y las 3 carteras)
  const [excluidas, setExcluidas] = useState<Set<string>>(new Set())
  const [carterasSel, setCarterasSel] = useState<Set<Cartera>>(new Set(["BLANCO", "NEGRO", "ECHEQ"]))

  // "¿Llego a pagar?"
  const [dias, setDias] = useState<7 | 15 | 30 | 0>(15)
  const [hasta, setHasta] = useState(sumarDiasISO(hoy, 15))

  // Diálogos
  const [cuentaEdit, setCuentaEdit] = useState<Cuenta | null>(null)
  const [nuevoGastoOpen, setNuevoGastoOpen] = useState(false)
  const [graficoOpen, setGraficoOpen] = useState(false)
  const [bolsaAbierta, setBolsaAbierta] = useState(false)
  const [calKey, setCalKey] = useState(0)

  const load = async () => {
    const [cajasRes, chequesRes, depRes, vencsRes, emitidosRes, evoRes, proyRes, extraRes] = await Promise.all([
      fetch("/api/finanzas/cajas").then(r => r.json()).catch(() => ({ cuentas: [] })),
      fetch("/api/cheques?estado=EN_CARTERA&tipo=TERCERO").then(r => r.json()).catch(() => ({ cheques: [] })),
      fetch("/api/cheques?estado=DEPOSITADO&tipo=TERCERO").then(r => r.json()).catch(() => ({ cheques: [] })),
      fetch("/api/vencimientos?estado=pendiente&mantener=1").then(r => r.json()).catch(() => []),
      fetch("/api/cheques?estado=ENTREGADO_A_PROVEEDOR&tipo=PROPIO").then(r => r.json()).catch(() => ({ cheques: [] })),
      fetch("/api/finanzas/evolucion").then(r => r.json()).catch(() => ({ serie: [], cuentas: [] })),
      fetch("/api/finanzas/proyeccion-retenciones").then(r => r.json()).catch(() => ({ proyeccion: {} })),
      fetch("/api/finanzas/panel").then(r => r.json()).catch(() => null),
    ])
    setCuentas((cajasRes.cuentas || []).filter((c: any) => c.cuenta_tipo !== "BILLETERA"))
    setCheques(chequesRes.cheques || [])
    setDepositados(depRes.cheques || [])
    setVencs(Array.isArray(vencsRes) ? vencsRes : [])
    setEmitidos(emitidosRes.cheques || [])
    setEvolucion(evoRes.serie ? evoRes : { serie: [], cuentas: [] })
    setProyRet(proyRes.proyeccion || {})
    if (extraRes && !extraRes.error) setExtra(extraRes)
    setLoading(false)
  }
  useEffect(() => { load() }, [])
  const recargar = () => { load(); setCalKey(k => k + 1) }

  // ── Cuentas por grupo ─────────────────────────────────────────────────────
  const efectivo = cuentas.filter(c => c.grupo === "EFECTIVO")
  const bancos = cuentas.filter(c => c.grupo === "BANCOS")
  const bolsa = cuentas.filter(c => c.grupo === "BOLSA")
  const suma = (xs: Cuenta[], soloIncluidas = false) => xs.filter(c => !soloIncluidas || !excluidas.has(claveCuenta(c))).reduce((t, c) => t + saldoDe(c), 0)
  const efectivoSel = suma(efectivo, true)
  const bancosSel = suma(bancos, true)

  // ── Cheques en cartera por vencimiento ────────────────────────────────────
  const tramos = useMemo(() => {
    const d30 = sumarDiasISO(hoy, 30), d60 = sumarDiasISO(hoy, 60)
    const t = { alDia: 0, a30: 0, a60: 0, mas60: 0, total: 0, cantidad: 0 }
    for (const c of cheques) {
      const m = Number(c.monto)
      t.total += m; t.cantidad++
      if (c.fecha_vencimiento <= hoy) t.alDia += m
      else if (c.fecha_vencimiento <= d30) t.a30 += m
      else if (c.fecha_vencimiento <= d60) t.a60 += m
      else t.mas60 += m
    }
    return t
  }, [cheques, hoy])
  const chequesSel = cheques.filter(c => carterasSel.has(carteraDe(c)))
  const chequesSelTotal = chequesSel.reduce((t, c) => t + Number(c.monto), 0)
  const cobrablesHoy = chequesSel.filter(c => c.fecha_vencimiento <= hoy).reduce((t, c) => t + Number(c.monto), 0)

  // ── "¿Llego a pagar?" (mismo cálculo de siempre + la plata por rendir como entrada de efectivo) ──
  const elegirDias = (d: 7 | 15 | 30) => { setDias(d); setHasta(sumarDiasISO(hoy, d)) }
  const netoVenc = (v: any) => (proyRet[v.id] ? proyRet[v.id].neto : Number(v.monto)) // neto de la retención de Ganancias proyectada
  const vencsHasta = vencs.filter(v => v.fecha_vencimiento <= hasta)
  const salePor = (formas: string[]) => vencsHasta.filter(v => formas.includes(v.forma_pago || "transferencia")).reduce((t, v) => t + netoVenc(v), 0)
  const emitidosHasta = (f: string) => emitidos.filter(c => c.fecha_vencimiento <= f && sumarDiasISO(c.fecha_vencimiento, 30) >= hoy).reduce((t, c) => t + Number(c.monto), 0)

  const entraEfectivo = extra.en_calle
  const entraBancos = depositados.reduce((t, c) => t + Number(c.monto), 0)
  const entraCheques = chequesSel.filter(c => c.fecha_vencimiento > hoy && c.fecha_vencimiento <= hasta).reduce((t, c) => t + Number(c.monto), 0)
  const saleEfectivo = salePor(["efectivo"])
  const saleBancos = salePor(["transferencia"]) + emitidosHasta(hasta)
  const saleCheques = salePor(["cheque"])
  const queda = {
    efectivo: efectivoSel + entraEfectivo - saleEfectivo,
    bancos: bancosSel + entraBancos - saleBancos,
    cheques: chequesSelTotal - saleCheques,
  }
  const proxEfectivo = vencsHasta.filter(v => v.forma_pago === "efectivo").sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))[0]

  // ── Último cambio de saldos (el más reciente de todas las cuentas) ─────────
  const ultimoCambio = useMemo(() => {
    const todos = Object.values(extra.ultimos_ajustes)
    if (!todos.length) return null
    return todos.sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
  }, [extra.ultimos_ajustes])
  const cuandoFue = (iso: string) => (fechaISO(iso) === hoy ? `hoy ${hora(iso)}` : fechaHora(iso))

  // ── Piezas ────────────────────────────────────────────────────────────────
  const FilaCuenta = ({ c }: { c: Cuenta }) => {
    const k = claveCuenta(c)
    const incluida = !excluidas.has(k)
    const aj = extra.ultimos_ajustes[k]
    return (
      <div className="group flex items-center gap-2 py-1">
        <input type="checkbox" checked={incluida} title="Entra en «¿Llego a pagar?»"
          onChange={() => setExcluidas(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })}
          className="size-3.5 shrink-0 accent-azul-600" />
        <span className={cn("min-w-0 flex-1 truncate text-[13px]", incluida ? "text-neutro-700" : "text-neutro-400 line-through")}>{c.nombre}</span>
        <button type="button" onClick={() => setCuentaEdit(c)}
          title={aj ? `Último cambio: ${aj.usuario ?? "—"}, ${cuandoFue(aj.fecha)}${aj.motivo ? ` · ${aj.motivo}` : ""}\nTocá para cambiar el saldo` : "Tocá para cambiar el saldo"}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[13px] font-semibold tabular-nums text-neutro-900 hover:bg-azul-50 hover:text-azul-700">
          {moneda(saldoDe(c), 0)}
          <Pencil className="h-3 w-3 text-neutro-300 group-hover:text-azul-500" />
        </button>
      </div>
    )
  }

  const Grande = ({ titulo, valor, children, nota }: { titulo: string; valor: number; children?: React.ReactNode; nota?: React.ReactNode }) => (
    <div className="min-w-0 rounded-2xl border border-neutro-200 bg-white p-4">
      <div className="text-[13px] font-semibold text-neutro-500">{titulo}</div>
      <div className="mt-0.5 text-[28px] font-extrabold leading-tight tracking-tight text-azul-900 tabular-nums">{loading ? "—" : moneda(valor, 0)}</div>
      {nota && <div className="text-xs text-neutro-400">{nota}</div>}
      {children && <div className="mt-2 border-t border-neutro-100 pt-2">{children}</div>}
    </div>
  )

  const Tramo = ({ label, monto }: { label: string; monto: number }) => (
    <div className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-neutro-600">{label}</span>
      <span className="font-semibold tabular-nums text-neutro-900">{moneda(monto, 0)}</span>
    </div>
  )

  const Bolsillo = ({ titulo, tengo, entra, entraLabel, sale, saleLabel, q, aviso }: {
    titulo: string; tengo: number; entra: number; entraLabel: string; sale: number; saleLabel: string; q: number; aviso: React.ReactNode
  }) => (
    <div className="rounded-xl border border-neutro-200 p-3.5">
      <div className="text-[13px] font-bold text-neutro-600">{titulo}</div>
      <div className="mt-1.5 space-y-1 text-[13px]">
        <div className="flex justify-between text-neutro-600"><span>Tengo hoy</span><b className="tabular-nums text-neutro-900">{moneda(tengo, 0)}</b></div>
        <div className="flex justify-between text-neutro-600"><span>{entraLabel}</span><b className="tabular-nums text-exito-600">{entra > 0 ? `+ ${moneda(entra, 0)}` : "—"}</b></div>
        <div className="flex justify-between text-neutro-600"><span>{saleLabel}</span><b className="tabular-nums text-error-600">{sale > 0 ? `− ${moneda(sale, 0)}` : "—"}</b></div>
      </div>
      <div className="mt-2 flex items-baseline justify-between border-t border-neutro-200 pt-2">
        <span className="text-[13px] font-semibold text-neutro-700">Me queda</span>
        <b className={cn("text-xl tabular-nums", q < 0 ? "text-error-600" : "text-exito-600")}>{moneda(q, 0)}</b>
      </div>
      <p className={cn("mt-2 rounded-lg px-2.5 py-1.5 text-xs", q < 0 ? "bg-error-50 text-error-700" : "bg-exito-50 text-exito-700")}>{aviso}</p>
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-[1700px] space-y-5 px-4 py-5 sm:px-6">
      {/* ── Encabezado ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azul-900 sm:text-3xl">Panel de Finanzas</h1>
          <p className="text-sm text-neutro-500">Lo que hay, lo que hay que pagar y si alcanza</p>
        </div>
        <Button onClick={() => setNuevoGastoOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" />Nuevo gasto</Button>
      </div>

      {extra.cobros_por_verificar.cantidad > 0 && (
        <Link href="/caja" className="flex items-center gap-2 rounded-xl border border-ambar-200 bg-ambar-50 px-4 py-2.5 text-sm text-ambar-800 hover:bg-ambar-100">
          <b>{extra.cobros_por_verificar.cantidad} cobro{extra.cobros_por_verificar.cantidad === 1 ? "" : "s"} por verificar en Caja</b>
          <span>· {moneda(extra.cobros_por_verificar.monto, 0)}</span>
          <ArrowRight className="ml-auto h-4 w-4" />
        </Link>
      )}

      {/* ── Lo que hay ── */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-lg font-bold tracking-tight text-azul-900">Lo que hay</h2>
          <span className="text-xs text-neutro-400">
            Saldos cargados a mano · tocá un saldo para cambiarlo
            {ultimoCambio && <> · último cambio: <b className="font-semibold text-neutro-600">{ultimoCambio.usuario ?? "—"}</b>, {cuandoFue(ultimoCambio.fecha)}</>}
          </span>
          <button type="button" onClick={() => setGraficoOpen(true)} className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-azul-600 hover:underline">
            <IconoGrafico className="h-4 w-4" />Ver gráfico
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Grande titulo="Efectivo" valor={suma(efectivo)}>
            {efectivo.map(c => <FilaCuenta key={claveCuenta(c)} c={c} />)}
          </Grande>
          <Grande titulo="Bancos" valor={suma(bancos)}>
            {bancos.map(c => <FilaCuenta key={claveCuenta(c)} c={c} />)}
          </Grande>
          <Grande titulo="Cheques en cartera" valor={tramos.total} nota={`${tramos.cantidad} cheque${tramos.cantidad === 1 ? "" : "s"} de terceros`}>
            <Tramo label="Al día" monto={tramos.alDia} />
            <Tramo label="Próximos 30 días" monto={tramos.a30} />
            <Tramo label="De 31 a 60 días" monto={tramos.a60} />
            <Tramo label="Más de 60 días" monto={tramos.mas60} />
            <Link href="/finanzas/cheques" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-azul-600 hover:underline">Ver cheques <ArrowRight className="h-3 w-3" /></Link>
          </Grande>
          <Grande titulo="Bolsa" valor={suma(bolsa)} nota="Rescate en 24-48 h · no suma al disponible">
            <button type="button" onClick={() => setBolsaAbierta(a => !a)} className="text-xs font-semibold text-azul-600 hover:underline">
              {bolsaAbierta ? "Ocultar cuentas" : "Cambiar un saldo"}
            </button>
            {bolsaAbierta && bolsa.map(c => (
              <div key={claveCuenta(c)} className="group flex items-center gap-2 py-1">
                <span className="min-w-0 flex-1 truncate text-[13px] text-neutro-700">{c.nombre}</span>
                <button type="button" onClick={() => setCuentaEdit(c)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[13px] font-semibold tabular-nums hover:bg-azul-50">
                  {moneda(saldoDe(c), 0)}<Pencil className="h-3 w-3 text-neutro-300" />
                </button>
              </div>
            ))}
          </Grande>
        </div>
      </section>

      {/* ── Lo que hay que pagar ── */}
      <section>
        <h2 className="mb-2 text-lg font-bold tracking-tight text-azul-900">Lo que hay que pagar</h2>
        <p className="mb-3 text-xs text-neutro-400">Tocá un pago para sumarlo a la cinta; el lápiz lo edita (fecha, monto, forma de pago, generar orden de pago o marcarlo pagado). Arrastralo para cambiarle el día.</p>
        <CalendarioPagos key={calKey} showCheques conSemana conTipos lateral="atrasados" onDataChanged={load} />
      </section>

      {/* ── ¿Llego a pagar? ── */}
      <section className="rounded-2xl border border-neutro-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-1 text-lg font-bold tracking-tight text-azul-900">¿Llego a pagar todo hasta el…?</h2>
          <div className="inline-flex rounded-lg bg-neutro-100 p-0.5 text-[13px] font-semibold">
            {([7, 15, 30] as const).map(d => (
              <button key={d} type="button" onClick={() => elegirDias(d)}
                className={cn("rounded-md px-3 py-1", dias === d ? "bg-white text-azul-700 shadow-sm" : "text-neutro-500 hover:text-neutro-800")}>{d} días</button>
            ))}
          </div>
          <FechaInput value={hasta} onChange={(iso) => { if (iso) { setHasta(iso); setDias(0) } }} containerClassName="w-[130px]" />
          <span className="text-sm text-neutro-500">hasta el <b className="text-neutro-800">{fecha(hasta)}</b></span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-neutro-500">Cheques que cuento:</span>
            {CARTERAS.map(c => (
              <button key={c.key} type="button"
                onClick={() => setCarterasSel(p => { const n = new Set(p); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n })}
                className={cn("rounded-full border px-2.5 py-0.5 font-semibold", carterasSel.has(c.key) ? "border-azul-300 bg-azul-50 text-azul-700" : "border-neutro-200 text-neutro-400 line-through")}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Bolsillo titulo="Efectivo" tengo={efectivoSel} entra={entraEfectivo} entraLabel="Entra (rendiciones)"
            sale={saleEfectivo} saleLabel="Sale (pagos en efectivo)" q={queda.efectivo}
            aviso={queda.efectivo < 0
              ? <>Faltan {moneda(-queda.efectivo, 0)}{proxEfectivo ? ` para «${proxEfectivo.proveedores?.nombre || proxEfectivo.concepto}» (${fechaCorta(proxEfectivo.fecha_vencimiento)})` : ""}. Retirá del banco o esperá una rendición.</>
              : saleEfectivo > 0 ? "Alcanza para los pagos en efectivo." : "No hay pagos en efectivo hasta esa fecha."} />
          <Bolsillo titulo="Bancos" tengo={bancosSel} entra={entraBancos} entraLabel="Entra (cheques depositados, 72 h)"
            sale={saleBancos} saleLabel="Sale (transferencias y cheques propios)" q={queda.bancos}
            aviso={queda.bancos < 0
              ? <>Faltan {moneda(-queda.bancos, 0)}. Depositá cheques cobrables ({moneda(cobrablesHoy, 0)} disponibles) o rescatá de la bolsa.</>
              : "Alcanza para las transferencias, los VEP y los débitos de cheques propios."} />
          <Bolsillo titulo="Cheques" tengo={chequesSelTotal} entra={entraCheques} entraLabel="Se hacen cobrables"
            sale={saleCheques} saleLabel="Comprometidos con proveedores" q={queda.cheques}
            aviso={queda.cheques < 0
              ? <>Comprometiste {moneda(-queda.cheques, 0)} más de lo que hay en cartera.</>
              : saleCheques > 0 ? "Los cheques comprometidos están cubiertos." : "No hay pagos con cheque hasta esa fecha."} />
        </div>
        {saleEfectivo + saleBancos > 0 && Object.keys(proyRet).length > 0 && (
          <p className="mt-2 text-xs text-neutro-400">Los pagos con retención de Ganancias proyectada cuentan por lo que realmente sale (el neto).</p>
        )}
      </section>

      {/* ── Diálogos ── */}
      <AjustarSaldoDialog cuenta={cuentaEdit} open={!!cuentaEdit} onOpenChange={(o) => { if (!o) setCuentaEdit(null) }} onSaved={recargar} />
      <NuevoGastoDialog open={nuevoGastoOpen} onOpenChange={setNuevoGastoOpen} onSaved={recargar} />
      <Dialog open={graficoOpen} onOpenChange={setGraficoOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Evolución de saldos</DialogTitle>
            <DialogDescription>Saldo de cada cuenta día por día (dato del kardex, desde julio 2026)</DialogDescription>
          </DialogHeader>
          {!evolucion.serie.length ? (
            <p className="py-10 text-center text-sm text-neutro-400">Todavía no hay datos para el gráfico.</p>
          ) : (
            <div className="h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={evolucion.serie} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#E3E5EF" vertical={false} />
                  <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: "#6E7290" }} tickFormatter={d => fechaCorta(d)} tickLine={false} axisLine={{ stroke: "#E3E5EF" }} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: "#6E7290" }} tickFormatter={corto} width={64} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number, n: string) => [moneda(v), n]} labelFormatter={d => fecha(String(d))}
                    contentStyle={{ background: "#fff", border: "1px solid #E3E5EF", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {evolucion.cuentas.map((n, i) => (
                    <Line key={n} type="stepAfter" dataKey={n} stroke={COLORES_SERIE[i % COLORES_SERIE.length]} strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
