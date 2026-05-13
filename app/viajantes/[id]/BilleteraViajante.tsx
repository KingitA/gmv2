'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, RefreshCw, Wallet, TrendingDown, Plus, Minus, CheckSquare, Square } from 'lucide-react'
import Link from 'next/link'

interface Vendedor {
  id: string
  nombre: string
  comision_limpieza_bazar: number
  comision_perfumeria_0: number
  comision_perfumeria_plus: number
}

interface Comision {
  id: string
  monto: number
  segmento: string | null
  cantidad: number | null
  porcentaje: number
  created_at: string
  pedido_id: string | null
  comprobante_venta_id: string | null
  articulos?: { descripcion: string } | null
}

interface Movimiento {
  id: string
  tipo: string
  monto: number
  concepto: string
  medio: string | null
  fecha: string
  referencia_tipo: string | null
}

interface BilleteraData {
  balance: number
  desglose: { cobros: number; retiros: number; debitos: number; creditos: number }
  comisiones_pendientes: Comision[]
  total_pendiente_comisiones: number
  historial: Movimiento[]
  total: number
}

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function tipoLabel(tipo: string) {
  const labels: Record<string, string> = {
    cobro_cliente: 'Cobro cliente',
    retiro_comision: 'Retiro comisión',
    debito: 'Débito',
    credito: 'Crédito',
  }
  return labels[tipo] ?? tipo
}

function tipoColor(tipo: string) {
  if (tipo === 'cobro_cliente' || tipo === 'credito') return 'text-emerald-400'
  if (tipo === 'retiro_comision' || tipo === 'debito') return 'text-red-400'
  return 'text-white/60'
}

export default function BilleteraViajante({ vendedor }: { vendedor: Vendedor }) {
  const [data, setData] = useState<BilleteraData | null>(null)
  const [loading, setLoading] = useState(true)
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set())
  const [retirando, setRetirando] = useState(false)
  const [showMovModal, setShowMovModal] = useState(false)
  const [movForm, setMovForm] = useState({ tipo: 'debito', monto: '', concepto: '', medio: '' })
  const [guardandoMov, setGuardandoMov] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/viajantes/${vendedor.id}/billetera`)
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [vendedor.id])

  useEffect(() => { load() }, [load])

  const toggleSeleccion = (id: string) => {
    setSeleccionadas(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleTodo = () => {
    const pendientes = data?.comisiones_pendientes ?? []
    if (seleccionadas.size === pendientes.length) {
      setSeleccionadas(new Set())
    } else {
      setSeleccionadas(new Set(pendientes.map(c => c.id)))
    }
  }

  const totalSeleccionado = (data?.comisiones_pendientes ?? [])
    .filter(c => seleccionadas.has(c.id))
    .reduce((s, c) => s + Number(c.monto), 0)

  const handleRetirar = async () => {
    if (!seleccionadas.size) return
    setRetirando(true)
    try {
      const res = await fetch(`/api/viajantes/${vendedor.id}/retiro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comisiones_ids: [...seleccionadas] }),
      })
      if (res.ok) {
        setSeleccionadas(new Set())
        await load()
      } else {
        const err = await res.json()
        alert(err.error ?? 'Error al retirar')
      }
    } finally {
      setRetirando(false)
    }
  }

  const handleMovManual = async () => {
    if (!movForm.monto || !movForm.concepto) return
    setGuardandoMov(true)
    try {
      const res = await fetch(`/api/viajantes/${vendedor.id}/movimiento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: movForm.tipo,
          monto: parseFloat(movForm.monto),
          concepto: movForm.concepto,
          medio: movForm.medio || null,
        }),
      })
      if (res.ok) {
        setShowMovModal(false)
        setMovForm({ tipo: 'debito', monto: '', concepto: '', medio: '' })
        await load()
      } else {
        const err = await res.json()
        alert(err.error ?? 'Error')
      }
    } finally {
      setGuardandoMov(false)
    }
  }

  const cardStyle = { background: '#111827', border: '1px solid rgba(255,255,255,0.07)' }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/viajantes" className="text-white/40 hover:text-white/80 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{vendedor.nombre}</h1>
          <p className="text-white/30 text-xs mt-0.5">
            Comisiones: L/B {vendedor.comision_limpieza_bazar ?? 0}% · P0 {vendedor.comision_perfumeria_0 ?? 0}% · P+ {vendedor.comision_perfumeria_plus ?? 0}%
          </p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg text-white/40 hover:text-white/80 transition-colors"
          style={cardStyle}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Balance + desglose */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl p-4 col-span-2 md:col-span-1" style={cardStyle}>
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-4 w-4 text-blue-400" />
            <span className="text-white/40 text-xs uppercase tracking-wide font-semibold">Balance</span>
          </div>
          <p className={`text-2xl font-bold font-mono ${(data?.balance ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {loading ? '...' : ars(data?.balance ?? 0)}
          </p>
        </div>
        {[
          { label: 'Cobros', key: 'cobros' as const, color: 'text-emerald-400' },
          { label: 'Retiros', key: 'retiros' as const, color: 'text-red-400' },
          { label: 'Comisiones pendientes', key: null, color: 'text-amber-400' },
        ].map(item => (
          <div key={item.label} className="rounded-xl p-4" style={cardStyle}>
            <p className="text-white/40 text-xs uppercase tracking-wide font-semibold mb-2">{item.label}</p>
            <p className={`text-lg font-bold font-mono ${item.color}`}>
              {loading ? '...' : item.key
                ? ars(data?.desglose[item.key] ?? 0)
                : ars(data?.total_pendiente_comisiones ?? 0)
              }
            </p>
          </div>
        ))}
      </div>

      {/* Comisiones pendientes de cobrar */}
      <div className="rounded-xl" style={cardStyle}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <p className="text-white font-semibold">Comisiones pendientes de cobrar</p>
            <p className="text-white/30 text-xs mt-0.5">{data?.comisiones_pendientes.length ?? 0} registros · {ars(data?.total_pendiente_comisiones ?? 0)} total</p>
          </div>
          <div className="flex items-center gap-2">
            {seleccionadas.size > 0 && (
              <button
                onClick={handleRetirar}
                disabled={retirando}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-50 transition-colors"
              >
                {retirando ? 'Retirando...' : `Retirar ${ars(totalSeleccionado)}`}
              </button>
            )}
            <button
              onClick={setShowMovModal.bind(null, true)}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white/50 hover:text-white/80 transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.1)' }}
            >
              Débito/Crédito
            </button>
          </div>
        </div>

        {(data?.comisiones_pendientes.length ?? 0) > 0 && (
          <div className="px-5 py-3 border-b border-white/[0.04]">
            <button
              onClick={toggleTodo}
              className="flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              {seleccionadas.size === (data?.comisiones_pendientes.length ?? 0)
                ? <CheckSquare className="h-4 w-4 text-blue-400" />
                : <Square className="h-4 w-4" />
              }
              Seleccionar todas
            </button>
          </div>
        )}

        <div className="divide-y divide-white/[0.04]">
          {loading ? (
            <p className="text-white/30 text-sm p-5">Cargando...</p>
          ) : (data?.comisiones_pendientes.length ?? 0) === 0 ? (
            <p className="text-white/20 text-sm p-5">Sin comisiones pendientes</p>
          ) : (
            data!.comisiones_pendientes.map(c => (
              <div
                key={c.id}
                onClick={() => toggleSeleccion(c.id)}
                className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
              >
                {seleccionadas.has(c.id)
                  ? <CheckSquare className="h-4 w-4 text-blue-400 flex-shrink-0" />
                  : <Square className="h-4 w-4 text-white/20 flex-shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm truncate">{c.articulos?.descripcion ?? 'Artículo'}</p>
                  <p className="text-white/30 text-xs">
                    {c.segmento ?? '—'} · {c.porcentaje}% · {new Date(c.created_at).toLocaleDateString('es-AR')}
                  </p>
                </div>
                <span className="font-mono font-semibold text-emerald-400 text-sm flex-shrink-0">{ars(Number(c.monto))}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Historial de movimientos */}
      <div className="rounded-xl" style={cardStyle}>
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <p className="text-white font-semibold">Historial de movimientos</p>
          <p className="text-white/30 text-xs mt-0.5">{data?.total ?? 0} movimientos</p>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {loading ? (
            <p className="text-white/30 text-sm p-5">Cargando...</p>
          ) : (data?.historial.length ?? 0) === 0 ? (
            <p className="text-white/20 text-sm p-5">Sin movimientos</p>
          ) : (
            data!.historial.map(m => (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                <div className={`flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center ${Number(m.monto) >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                  {Number(m.monto) >= 0
                    ? <Plus className="h-3.5 w-3.5 text-emerald-400" />
                    : <Minus className="h-3.5 w-3.5 text-red-400" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm">{m.concepto}</p>
                  <p className="text-white/30 text-xs">
                    {tipoLabel(m.tipo)} · {m.medio ? `${m.medio} · ` : ''}{new Date(m.fecha).toLocaleDateString('es-AR')}
                  </p>
                </div>
                <span className={`font-mono font-semibold text-sm flex-shrink-0 ${tipoColor(m.tipo)}`}>
                  {Number(m.monto) > 0 ? '+' : ''}{ars(Number(m.monto))}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal débito/crédito manual */}
      {showMovModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="rounded-xl p-6 w-full max-w-md space-y-4" style={{ background: '#1a1d23', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h3 className="text-white font-semibold text-lg">Movimiento manual</h3>

            <div className="flex gap-2">
              {(['debito', 'credito'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setMovForm(f => ({ ...f, tipo: t }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${movForm.tipo === t ? (t === 'debito' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white') : 'text-white/40 hover:text-white/70'}`}
                  style={movForm.tipo !== t ? { border: '1px solid rgba(255,255,255,0.1)' } : {}}
                >
                  {t === 'debito' ? 'Débito' : 'Crédito'}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-white/50 text-xs block mb-1">Monto</label>
                <input
                  type="number"
                  value={movForm.monto}
                  onChange={e => setMovForm(f => ({ ...f, monto: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-white text-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-white/50 text-xs block mb-1">Concepto</label>
                <input
                  type="text"
                  value={movForm.concepto}
                  onChange={e => setMovForm(f => ({ ...f, concepto: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-white text-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                  placeholder="Ej: Descuento sueldo"
                />
              </div>
              <div>
                <label className="text-white/50 text-xs block mb-1">Medio (opcional)</label>
                <select
                  value={movForm.medio}
                  onChange={e => setMovForm(f => ({ ...f, medio: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-white text-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  <option value="">— Sin especificar —</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="cheque">Cheque</option>
                  <option value="transferencia">Transferencia</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowMovModal(false)}
                className="flex-1 py-2 rounded-lg text-white/50 hover:text-white/80 transition-colors text-sm"
                style={{ border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleMovManual}
                disabled={guardandoMov || !movForm.monto || !movForm.concepto}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-50 transition-colors"
              >
                {guardandoMov ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
