'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { moneda, numero } from '@/lib/formato'

function pct(n: number) {
  return `${numero(n, 2)}%`
}

function catLabel(cat: string) {
  if (cat === 'limpieza_bazar') return 'L/B'
  if (cat === 'perfumeria') return 'Perf.'
  return cat
}

interface ViajanteRef {
  viajante_id: string
  nombre: string
}

interface PedidoRow {
  pedido_id: string
  numero_pedido: string
  cliente_nombre: string
  fecha: string
  fecha_cobro: string | null
  total_monto: number
  total_comision: number
  cantidad_skus: number
}

interface ArticuloRow {
  kardex_id: string
  sku: string
  descripcion: string
  categoria: string
  cantidad: number
  precio_unitario: number
  subtotal: number
  comision_pct: number
  comision_monto: number
}

interface ComprobanteDet {
  comprobante_id: string
  numero: string
  tipo_comprobante: string
  fecha_cobro: string
  total_neto: number
  total_iva: number
  total: number
  total_comision: number
  articulos: ArticuloRow[]
}

interface Props {
  open: boolean
  onClose: () => void
  viajante: ViajanteRef | null
  tipo: 'cobrada' | 'vendida'
  dateFrom: string
  dateTo: string
}

export default function ComisionesDrawer({ open, onClose, viajante, tipo, dateFrom, dateTo }: Props) {
  const [pedidos, setPedidos] = useState<PedidoRow[]>([])
  const [loadingPedidos, setLoadingPedidos] = useState(false)
  const [selectedPedido, setSelectedPedido] = useState<PedidoRow | null>(null)
  const [detalle, setDetalle] = useState<{ articulos?: ArticuloRow[]; comprobantes?: ComprobanteDet[] } | null>(null)
  const [loadingDetalle, setLoadingDetalle] = useState(false)

  useEffect(() => {
    if (!open || !viajante) return
    setSelectedPedido(null)
    setDetalle(null)
    setLoadingPedidos(true)
    const params = new URLSearchParams({ viajante_id: viajante.viajante_id, from: dateFrom, to: dateTo, tipo })
    fetch(`/api/playroom/comisiones/pedidos?${params}`)
      .then(r => r.json())
      .then(d => setPedidos(d.pedidos ?? []))
      .catch(console.error)
      .finally(() => setLoadingPedidos(false))
  }, [open, viajante?.viajante_id, dateFrom, dateTo, tipo])

  const handleSelectPedido = async (pedido: PedidoRow) => {
    setSelectedPedido(pedido)
    setDetalle(null)
    setLoadingDetalle(true)
    try {
      const params = new URLSearchParams({ pedido_id: pedido.pedido_id, tipo })
      if (viajante) params.set('viajante_id', viajante.viajante_id)
      const res = await fetch(`/api/playroom/comisiones/detalle?${params}`)
      setDetalle(await res.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingDetalle(false)
    }
  }

  const handleBack = () => { setSelectedPedido(null); setDetalle(null) }

  const handleClose = () => {
    setSelectedPedido(null)
    setDetalle(null)
    setPedidos([])
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && handleClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-4xl p-0 flex flex-col overflow-hidden"
        style={{ background: '#FFFFFF', borderLeft: '1px solid #E3E5EF', color: '#1B1D4E' }}
      >
        {/* Header / breadcrumb */}
        <div className="flex items-center gap-2 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #E3E5EF' }}>
          {selectedPedido ? (
            <button onClick={handleBack}
              className="flex items-center gap-0.5 text-xs font-semibold transition-colors"
              style={{ color: '#6E7290' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#1B1D4E' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#6E7290' }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {viajante?.nombre}
            </button>
          ) : (
            <span className="text-xs font-semibold" style={{ color: '#545871' }}>Comisiones</span>
          )}

          <span style={{ color: '#9295AE' }}>/</span>

          {selectedPedido ? (
            <>
              <span className="text-sm font-bold text-azul-900">Pedido {selectedPedido.numero_pedido}</span>
              <span className="text-xs ml-1" style={{ color: '#9295AE' }}>{selectedPedido.cliente_nombre}</span>
            </>
          ) : (
            <span className="text-sm font-bold text-azul-900">{viajante?.nombre}</span>
          )}

          <div className="ml-auto">
            <span className="px-2 py-0.5 rounded text-xs font-semibold"
              style={{
                background: tipo === 'cobrada' ? '#E6F4EE' : '#EEEEF6',
                color: tipo === 'cobrada' ? '#15805A' : '#4549B5',
              }}>
              {tipo === 'cobrada' ? 'Cobrada' : 'Vendida'}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!selectedPedido
            ? <PedidosList pedidos={pedidos} loading={loadingPedidos} tipo={tipo} onSelect={handleSelectPedido} />
            : <PedidoDetalle tipo={tipo} detalle={detalle} loading={loadingDetalle} />
          }
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Level 0: pedidos list ─────────────────────────────────────────────────────

function PedidosList({ pedidos, loading, tipo, onSelect }: {
  pedidos: PedidoRow[]
  loading: boolean
  tipo: 'cobrada' | 'vendida'
  onSelect: (p: PedidoRow) => void
}) {
  if (loading) return <LoadingRows />
  if (!pedidos.length) return (
    <div className="flex items-center justify-center h-40">
      <p className="text-sm" style={{ color: '#9295AE' }}>Sin pedidos en el período</p>
    </div>
  )

  const totalComision = pedidos.reduce((s, p) => s + p.total_comision, 0)
  const totalMonto = pedidos.reduce((s, p) => s + p.total_monto, 0)

  return (
    <div>
      <SummaryBar items={[
        { label: 'Pedidos', value: String(pedidos.length) },
        { label: 'Monto total', value: moneda(totalMonto, 0) },
        { label: 'Comisión total', value: moneda(totalComision, 0) },
      ]} />

      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid #F0F1F7' }}>
            {['Pedido', 'Cliente', tipo === 'cobrada' ? 'F. Cobro' : 'Fecha', 'Monto', 'Comisión', 'SKUs', ''].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold"
                style={{ color: '#9295AE' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pedidos.map(p => (
            <tr key={p.pedido_id} onClick={() => onSelect(p)}
              className="cursor-pointer transition-colors"
              style={{ borderBottom: '1px solid #F0F1F7' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#F7F8FC' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <td className="px-4 py-3">
                <span className="font-mono text-xs font-semibold text-azul-600">{p.numero_pedido}</span>
              </td>
              <td className="px-4 py-3 max-w-[180px]">
                <span className="text-xs truncate block" style={{ color: '#1B1D4E' }}>{p.cliente_nombre}</span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="text-xs font-mono" style={{ color: '#6E7290' }}>
                  {tipo === 'cobrada' ? (p.fecha_cobro ?? '—') : p.fecha}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="font-mono text-xs" style={{ color: '#545871' }}>{moneda(p.total_monto, 0)}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="font-mono text-sm font-semibold text-exito-600">{moneda(p.total_comision, 0)}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="font-mono text-xs" style={{ color: '#9295AE' }}>{p.cantidad_skus}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <ChevronLeft className="h-3.5 w-3.5 rotate-180 inline" style={{ color: '#9295AE' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Level 1: pedido detail ────────────────────────────────────────────────────

function PedidoDetalle({ tipo, detalle, loading }: {
  tipo: 'cobrada' | 'vendida'
  detalle: { articulos?: ArticuloRow[]; comprobantes?: ComprobanteDet[] } | null
  loading: boolean
}) {
  if (loading) return <LoadingRows />
  if (!detalle) return null

  if (tipo === 'vendida') {
    const arts = detalle.articulos ?? []
    const totalMonto = arts.reduce((s, a) => s + a.subtotal, 0)
    const totalComision = arts.reduce((s, a) => s + a.comision_monto, 0)

    return (
      <div>
        <SummaryBar items={[
          { label: 'Artículos', value: String(arts.length) },
          { label: 'Monto neto', value: moneda(totalMonto, 0) },
          { label: 'Comisión', value: moneda(totalComision, 0) },
        ]} />

        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid #F0F1F7' }}>
              {['SKU', 'Descripción', 'Cat.', 'Cant.', 'P. Unit.', 'Subtotal', '% Com.', 'Comisión'].map((h, i) => (
                <th key={h} className={`px-3 py-2.5 text-xs font-semibold ${i >= 3 ? 'text-right' : 'text-left'}`}
                  style={{ color: '#9295AE' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {arts.map(a => (
              <tr key={a.kardex_id} style={{ borderBottom: '1px solid #F0F1F7' }}>
                <td className="px-3 py-2.5"><span className="font-mono text-xs text-azul-600">{a.sku}</span></td>
                <td className="px-3 py-2.5 max-w-[180px]">
                  <span className="text-xs block truncate" style={{ color: '#1B1D4E' }}>{a.descripcion}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: '#F0F1F7', color: '#545871' }}>
                    {catLabel(a.categoria)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="font-mono text-xs" style={{ color: '#31354A' }}>{a.cantidad}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="font-mono text-xs" style={{ color: '#545871' }}>{moneda(a.precio_unitario, 0)}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="font-mono text-xs" style={{ color: '#31354A' }}>{moneda(a.subtotal, 0)}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="font-mono text-xs text-ambar-700">{pct(a.comision_pct)}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="font-mono text-sm font-semibold text-exito-600">{moneda(a.comision_monto, 0)}</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid #E3E5EF' }}>
              <td colSpan={5} className="px-3 py-3 text-right">
                <span className="text-xs font-semibold" style={{ color: '#545871' }}>Total</span>
              </td>
              <td className="px-3 py-3 text-right">
                <span className="font-mono text-sm font-bold" style={{ color: '#31354A' }}>{moneda(totalMonto, 0)}</span>
              </td>
              <td />
              <td className="px-3 py-3 text-right">
                <span className="font-mono text-sm font-bold text-exito-600">{moneda(totalComision, 0)}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    )
  }

  // cobrada: comprobantes agrupados
  const comps = detalle.comprobantes ?? []
  const totalComision = comps.reduce((s, c) => s + c.total_comision, 0)

  return (
    <div>
      <SummaryBar items={[
        { label: 'Comprobantes', value: String(comps.length) },
        { label: 'Comisión total', value: moneda(totalComision, 0) },
      ]} />

      {comps.map(comp => (
        <div key={comp.comprobante_id} style={{ borderBottom: '1px solid #E3E5EF' }}>
          {/* Comprobante header bar */}
          <div className="px-5 py-3 flex items-center gap-4 flex-wrap"
            style={{ background: '#F7F8FC', borderBottom: '1px solid #F0F1F7' }}>
            <span className="font-mono text-xs font-bold text-azul-600">{comp.numero}</span>
            <span className="font-mono text-xs" style={{ color: '#6E7290' }}>{comp.fecha_cobro}</span>
            <span className="flex-1" />
            {comp.total_neto > 0 && (
              <span className="text-xs" style={{ color: '#6E7290' }}>
                Neto: <span className="font-mono">{moneda(comp.total_neto, 0)}</span>
              </span>
            )}
            {comp.total_iva > 0 && (
              <span className="text-xs" style={{ color: '#6E7290' }}>
                IVA: <span className="font-mono">{moneda(comp.total_iva, 0)}</span>
              </span>
            )}
            {comp.total > 0 && (
              <span className="text-xs" style={{ color: '#545871' }}>
                Total: <span className="font-mono font-semibold">{moneda(comp.total, 0)}</span>
              </span>
            )}
            <span className="text-xs font-bold text-exito-600 font-mono">Com: {moneda(comp.total_comision, 0)}</span>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid #F0F1F7' }}>
                {['SKU', 'Descripción', 'Cat.', 'Cant.', 'P. Unit.', 'Subtotal', '% Com.', 'Comisión'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 text-xs font-semibold ${i >= 3 ? 'text-right' : 'text-left'}`}
                    style={{ color: '#9295AE' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comp.articulos.map(a => (
                <tr key={a.kardex_id} style={{ borderBottom: '1px solid #F0F1F7' }}>
                  <td className="px-3 py-2.5"><span className="font-mono text-xs text-azul-600">{a.sku}</span></td>
                  <td className="px-3 py-2.5 max-w-[160px]">
                    <span className="text-xs block truncate" style={{ color: '#1B1D4E' }}>{a.descripcion}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: '#F0F1F7', color: '#6E7290' }}>
                      {catLabel(a.categoria)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="font-mono text-xs" style={{ color: '#31354A' }}>{a.cantidad}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="font-mono text-xs" style={{ color: '#6E7290' }}>{moneda(a.precio_unitario, 0)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="font-mono text-xs" style={{ color: '#31354A' }}>{moneda(a.subtotal, 0)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="font-mono text-xs text-ambar-700">{pct(a.comision_pct)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="font-mono text-sm font-semibold text-exito-600">{moneda(a.comision_monto, 0)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SummaryBar({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid gap-px flex-shrink-0"
      style={{
        gridTemplateColumns: `repeat(${items.length}, 1fr)`,
        background: '#F0F1F7',
        borderBottom: '1px solid #E3E5EF',
      }}>
      {items.map(item => (
        <div key={item.label} className="px-5 py-4" style={{ background: '#FFFFFF' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: '#545871' }}>
            {item.label}
          </p>
          <p className="text-lg font-bold text-azul-900 font-mono">{item.value}</p>
        </div>
      ))}
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="p-5 space-y-2">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="h-10 rounded-lg animate-pulse" style={{ background: '#F0F1F7' }} />
      ))}
    </div>
  )
}
