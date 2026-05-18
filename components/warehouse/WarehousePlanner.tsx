'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

const PX_M = 20       // pixels per meter at scale=1
const W_M = 30        // warehouse width (meters)
const H_M = 40        // warehouse height (meters)

type ElemType = 'estanteria' | 'rack_3' | 'rack_4' | 'pasillo' | 'recepcion' | 'preparacion' | 'oficina'
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const TYPE_CFG: Record<ElemType, { label: string; w: number; h: number; color: string; bg: string; stripe: string }> = {
  estanteria:  { label: 'Estantería',    w: 3,  h: 1,  color: '#2563eb', bg: '#dbeafe', stripe: '#93c5fd' },
  rack_3:      { label: 'Rack 3 Niv.',   w: 2,  h: 0.8,color: '#ea580c', bg: '#ffedd5', stripe: '#fdba74' },
  rack_4:      { label: 'Rack 4 Niv.',   w: 2,  h: 0.8,color: '#dc2626', bg: '#fee2e2', stripe: '#fca5a5' },
  pasillo:     { label: 'Pasillo',        w: 10, h: 2,  color: '#64748b', bg: '#f1f5f9', stripe: '#cbd5e1' },
  recepcion:   { label: 'Recepción',      w: 6,  h: 5,  color: '#059669', bg: '#d1fae5', stripe: '#6ee7b7' },
  preparacion: { label: 'Preparación',    w: 6,  h: 5,  color: '#d97706', bg: '#fef3c7', stripe: '#fcd34d' },
  oficina:     { label: 'Oficina',        w: 4,  h: 3,  color: '#7c3aed', bg: '#ede9fe', stripe: '#c4b5fd' },
}

interface WElem {
  id: string; type: ElemType
  x: number; y: number; w: number; h: number
  rotation: number; label: string
}

interface LayoutData { id?: string; elements: WElem[] }

type Op =
  | { kind: 'drag';   id: string; sx: number; sy: number; ex: number; ey: number }
  | { kind: 'resize'; id: string; handle: ResizeHandle; sx: number; sy: number; ex: number; ey: number; ew: number; eh: number }
  | { kind: 'pan';    sx: number; sy: number; px: number; py: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
function handleStyle(h: ResizeHandle, pw: number, ph: number): React.CSSProperties {
  const SIZE = 8
  const HALF = SIZE / 2
  const midX = pw / 2 - HALF, midY = ph / 2 - HALF
  const left = h.includes('e') ? pw - HALF : h.includes('w') ? -HALF : midX
  const top  = h.includes('s') ? ph - HALF : h.includes('n') ? -HALF : midY
  const cursors: Record<ResizeHandle, string> = {
    nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
    e: 'e-resize', se: 'se-resize', s: 's-resize',
    sw: 'sw-resize', w: 'w-resize',
  }
  return {
    position: 'absolute', width: SIZE, height: SIZE, left, top,
    background: '#fff', border: '1.5px solid #0f172a', borderRadius: 2,
    cursor: cursors[h], zIndex: 10,
  }
}

export default function WarehousePlanner() {
  const [elements, setElements] = useState<WElem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [showGrid, setShowGrid] = useState(true)
  const [labelEdit, setLabelEdit] = useState('')
  const [layoutId, setLayoutId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const opRef = useRef<Op | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(scale)
  const panRef = useRef(pan)
  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { panRef.current = pan }, [pan])

  // Load layout on mount
  useEffect(() => {
    fetch('/api/warehouse/layout')
      .then(r => r.ok ? r.json() : null)
      .then((data: LayoutData | null) => {
        if (data) { setLayoutId(data.id ?? null); setElements(data.elements ?? []) }
      })
      .catch(console.error)
  }, [])

  // Sync label editor when selection changes
  useEffect(() => {
    setLabelEdit(elements.find(e => e.id === selectedId)?.label ?? '')
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateElem = useCallback((id: string, patch: Partial<WElem>) => {
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }, [])

  const addElement = (type: ElemType) => {
    const cfg = TYPE_CFG[type]
    const s = scaleRef.current; const p = panRef.current
    const cx = (-p.x + (canvasRef.current?.clientWidth ?? 800) / 2) / (PX_M * s)
    const cy = (-p.y + (canvasRef.current?.clientHeight ?? 600) / 2) / (PX_M * s)
    const count = elements.filter(e => e.type === type).length + 1
    const el: WElem = {
      id: crypto.randomUUID(), type,
      x: clamp(cx - cfg.w / 2, 0, W_M - cfg.w),
      y: clamp(cy - cfg.h / 2, 0, H_M - cfg.h),
      w: cfg.w, h: cfg.h, rotation: 0,
      label: `${cfg.label} ${count}`,
    }
    setElements(prev => [...prev, el])
    setSelectedId(el.id)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    setElements(prev => prev.filter(e => e.id !== selectedId))
    setSelectedId(null)
  }

  const rotateSelected = () => {
    if (!selectedId) return
    const el = elements.find(e => e.id === selectedId)
    if (el) updateElem(selectedId, { rotation: (el.rotation + 90) % 360 })
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const res = await fetch('/api/warehouse/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: layoutId, elements }),
      })
      const data = await res.json()
      if (data?.id) setLayoutId(data.id)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { console.error(e) }
    finally { setIsSaving(false) }
  }

  // ── Pointer events (all captured on the canvas container) ──────────────
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    canvasRef.current?.setPointerCapture(e.pointerId)

    const target = e.target as HTMLElement
    const handle = target.dataset.handle as ResizeHandle | undefined
    const elemId = target.closest<HTMLElement>('[data-elemid]')?.dataset.elemid

    if (handle && elemId) {
      const el = elements.find(x => x.id === elemId)!
      opRef.current = { kind: 'resize', id: elemId, handle, sx: e.clientX, sy: e.clientY, ex: el.x, ey: el.y, ew: el.w, eh: el.h }
    } else if (elemId) {
      const el = elements.find(x => x.id === elemId)!
      setSelectedId(elemId)
      opRef.current = { kind: 'drag', id: elemId, sx: e.clientX, sy: e.clientY, ex: el.x, ey: el.y }
    } else {
      setSelectedId(null)
      opRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const op = opRef.current
    if (!op) return
    const s = scaleRef.current

    if (op.kind === 'pan') {
      setPan({ x: op.px + e.clientX - op.sx, y: op.py + e.clientY - op.sy })
    } else if (op.kind === 'drag') {
      const dx = (e.clientX - op.sx) / (PX_M * s)
      const dy = (e.clientY - op.sy) / (PX_M * s)
      setElements(prev => prev.map(el => el.id === op.id
        ? { ...el, x: Math.max(0, op.ex + dx), y: Math.max(0, op.ey + dy) }
        : el))
    } else if (op.kind === 'resize') {
      const dx = (e.clientX - op.sx) / (PX_M * s)
      const dy = (e.clientY - op.sy) / (PX_M * s)
      setElements(prev => prev.map(el => {
        if (el.id !== op.id) return el
        let { x, y, w, h } = { x: op.ex, y: op.ey, w: op.ew, h: op.eh }
        if (op.handle.includes('e')) w = Math.max(0.5, op.ew + dx)
        if (op.handle.includes('s')) h = Math.max(0.5, op.eh + dy)
        if (op.handle.includes('w')) { x = op.ex + dx; w = Math.max(0.5, op.ew - dx) }
        if (op.handle.includes('n')) { y = op.ey + dy; h = Math.max(0.5, op.eh - dy) }
        return { ...el, x, y, w, h }
      }))
    }
  }

  const handlePointerUp = () => { opRef.current = null }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const newScale = clamp(scale * factor, 0.2, 5)
    setPan(p => ({ x: mx - (mx - p.x) * newScale / scale, y: my - (my - p.y) * newScale / scale }))
    setScale(newScale)
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const selectedEl = elements.find(e => e.id === selectedId)
  const counts = Object.fromEntries(Object.keys(TYPE_CFG).map(k => [k, 0])) as Record<ElemType, number>
  elements.forEach(e => counts[e.type]++)
  const pw = W_M * PX_M
  const ph = H_M * PX_M

  // ── Grid SVG (memoized via static render) ──────────────────────────────
  const gridLines: React.ReactNode[] = []
  if (showGrid) {
    for (let i = 0; i <= W_M; i++) {
      const major = i % 5 === 0
      gridLines.push(<line key={`v${i}`} x1={i*PX_M} y1={0} x2={i*PX_M} y2={ph} stroke={major ? '#94a3b8' : '#e2e8f0'} strokeWidth={major ? 0.6 : 0.3} />)
      if (major) gridLines.push(<text key={`vt${i}`} x={i*PX_M+2} y={9} fontSize={7} fill="#94a3b8">{i}m</text>)
    }
    for (let j = 0; j <= H_M; j++) {
      const major = j % 5 === 0
      gridLines.push(<line key={`h${j}`} x1={0} y1={j*PX_M} x2={pw} y2={j*PX_M} stroke={major ? '#94a3b8' : '#e2e8f0'} strokeWidth={major ? 0.6 : 0.3} />)
      if (major && j > 0) gridLines.push(<text key={`ht${j}`} x={2} y={j*PX_M+9} fontSize={7} fill="#94a3b8">{j}m</text>)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100dvh', fontFamily: "'DM Sans', system-ui, sans-serif", overflow: 'hidden', background: '#f1f5f9' }}>

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <div style={{ width: 268, flexShrink: 0, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Planner Depósito</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>30 m × 40 m · {elements.length} elementos</div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
          {/* Add elements */}
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Agregar elemento</SectionLabel>
            {(Object.entries(TYPE_CFG) as [ElemType, typeof TYPE_CFG[ElemType]][]).map(([type, cfg]) => (
              <button key={type} onClick={() => addElement(type)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, border: `1px solid ${cfg.color}33`, background: cfg.bg, cursor: 'pointer', marginBottom: 7, textAlign: 'left' }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: cfg.color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="2" y="2" width="9" height="9" rx="1.5"/><rect x="13" y="2" width="9" height="9" rx="1.5"/><rect x="2" y="13" width="9" height="9" rx="1.5"/><rect x="13" y="13" width="9" height="9" rx="1.5"/></svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{cfg.label}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{cfg.w}m × {cfg.h}m · <span style={{ color: cfg.color, fontWeight: 600 }}>{counts[type]} en plano</span></div>
                </div>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: cfg.color, color: '#fff', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 300, flexShrink: 0 }}>+</div>
              </button>
            ))}
          </div>

          {/* Properties */}
          {selectedEl && (
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 14 }}>
              <SectionLabel>Propiedades</SectionLabel>
              <div style={{ background: '#f9fafb', borderRadius: 10, padding: 12, border: '1px solid #e5e7eb' }}>
                <div style={{ marginBottom: 10 }}>
                  <FieldLabel>Etiqueta</FieldLabel>
                  <input value={labelEdit}
                    onChange={e => setLabelEdit(e.target.value)}
                    onBlur={() => updateElem(selectedEl.id, { label: labelEdit })}
                    onKeyDown={e => e.key === 'Enter' && updateElem(selectedEl.id, { label: labelEdit })}
                    style={S.input} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  {[
                    { label: 'Largo (m)', key: 'w', val: selectedEl.w },
                    { label: 'Ancho (m)', key: 'h', val: selectedEl.h },
                    { label: 'Pos X (m)', key: 'x', val: Math.round(selectedEl.x * 10) / 10 },
                    { label: 'Pos Y (m)', key: 'y', val: Math.round(selectedEl.y * 10) / 10 },
                  ].map(f => (
                    <div key={f.key}>
                      <FieldLabel>{f.label}</FieldLabel>
                      <input type="number" min={0.5} max={f.key === 'w' || f.key === 'x' ? W_M : H_M} step={0.5}
                        value={f.val}
                        onChange={e => updateElem(selectedEl.id, { [f.key]: parseFloat(e.target.value) || 0.5 })}
                        style={S.input} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={rotateSelected} style={S.actionBtn}>↻ Rotar 90°</button>
                  <button onClick={deleteSelected} style={{ ...S.actionBtn, borderColor: '#fca5a5', background: '#fef2f2', color: '#dc2626' }}>✕ Eliminar</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowGrid(g => !g)}
              style={{ flex: 1, padding: '7px', borderRadius: 8, border: `1px solid ${showGrid ? '#bae6fd' : '#d1d5db'}`, background: showGrid ? '#f0f9ff' : '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: showGrid ? '#0284c7' : '#6b7280' }}>
              ⊞ {showGrid ? 'Grilla ON' : 'Grilla OFF'}
            </button>
            <button onClick={() => { setScale(1); setPan({ x: 40, y: 40 }) }}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' }}>
              Centrar
            </button>
          </div>
          <button onClick={handleSave} disabled={isSaving}
            style={{ width: '100%', padding: 10, borderRadius: 10, border: 'none', background: saved ? '#16a34a' : isSaving ? '#9ca3af' : '#111827', color: '#fff', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, transition: 'background 0.2s' }}>
            {saved ? '✓ Guardado' : isSaving ? 'Guardando...' : 'Guardar Layout'}
          </button>
          <div style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af' }}>
            Scroll → zoom · Arrastrá el fondo → mover
          </div>
        </div>
      </div>

      {/* ── Canvas ──────────────────────────────────────────── */}
      <div
        ref={canvasRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#cbd5e1', cursor: opRef.current?.kind === 'pan' ? 'grabbing' : 'grab' }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        {/* World container */}
        <div style={{
          position: 'absolute', left: 0, top: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          width: pw, height: ph,
        }}>
          {/* Floor */}
          <div style={{ position: 'absolute', inset: 0, background: '#f8fafc', border: '2px solid #475569', boxSizing: 'border-box' }} />

          {/* Grid SVG */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {gridLines}
          </svg>

          {/* Dimension labels */}
          <div style={{ position: 'absolute', bottom: -18, left: pw/2 - 16, fontSize: 9, color: '#64748b', fontWeight: 700, pointerEvents: 'none' }}>30 m</div>
          <div style={{ position: 'absolute', right: -18, top: ph/2 - 10, fontSize: 9, color: '#64748b', fontWeight: 700, pointerEvents: 'none', transform: 'rotate(90deg)', transformOrigin: 'center' }}>40 m</div>

          {/* Elements */}
          {elements.map(el => {
            const cfg = TYPE_CFG[el.type]
            const epw = el.w * PX_M
            const eph = el.h * PX_M
            const isSelected = selectedId === el.id
            return (
              <div
                key={el.id}
                data-elemid={el.id}
                style={{
                  position: 'absolute',
                  left: el.x * PX_M, top: el.y * PX_M,
                  width: epw, height: eph,
                  transform: `rotate(${el.rotation}deg)`,
                  transformOrigin: 'top left',
                  background: cfg.bg,
                  border: `${isSelected ? 2 : 1}px solid ${isSelected ? '#0f172a' : cfg.color}`,
                  borderRadius: 2,
                  boxSizing: 'border-box',
                  cursor: 'move',
                  userSelect: 'none',
                  boxShadow: isSelected ? '0 4px 14px rgba(0,0,0,0.22)' : '0 1px 3px rgba(0,0,0,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {/* Stripe lines */}
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 2, pointerEvents: 'none' }}>
                  {Array.from({ length: Math.floor(el.w / 0.5) - 1 }, (_, i) => (
                    <div key={i} style={{ position: 'absolute', left: (i + 1) * 0.5 * PX_M, top: 0, bottom: 0, width: 1, background: cfg.stripe, opacity: 0.5 }} />
                  ))}
                </div>
                {/* Label */}
                <span style={{
                  pointerEvents: 'none', textAlign: 'center', padding: 3,
                  fontSize: clamp(epw / (el.label.length * 0.65), 6, 11),
                  color: cfg.color, fontWeight: 700, wordBreak: 'break-word',
                  lineHeight: 1.2, position: 'relative', zIndex: 1,
                }}>
                  {el.label}
                </span>
                {/* Resize handles (only when selected) */}
                {isSelected && HANDLES.map(h => (
                  <div
                    key={h}
                    data-handle={h}
                    data-elemid={el.id}
                    style={handleStyle(h, epw, eph)}
                  />
                ))}
              </div>
            )
          })}
        </div>

        {/* Zoom buttons */}
        <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {['+', '−'].map((lbl, i) => (
            <button key={lbl} onClick={() => setScale(s => clamp(i === 0 ? s * 1.2 : s / 1.2, 0.2, 5))}
              style={{ width: 36, height: 36, borderRadius: 9, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 20, fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', color: '#374151' }}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Zoom indicator */}
        <div style={{ position: 'absolute', bottom: 16, left: 16, background: 'rgba(255,255,255,0.92)', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: '#64748b', border: '1px solid #e2e8f0' }}>
          {Math.round(scale * 100)}% · {W_M}m × {H_M}m
        </div>

        {/* Legend */}
        <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.95)', borderRadius: 10, padding: '8px 12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {(Object.entries(TYPE_CFG) as [ElemType, typeof TYPE_CFG[ElemType]][]).map(([type, cfg]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: cfg.bg, border: `1.5px solid ${cfg.color}`, flexShrink: 0 }} />
              <span style={{ color: '#374151', fontWeight: 600 }}>{cfg.label}</span>
              <span style={{ color: cfg.color, fontWeight: 700, marginLeft: 2 }}>{counts[type]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Shared styles & tiny components ──────────────────────────
const S = {
  input: { width: '100%', padding: '6px 8px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, color: '#111827' },
  actionBtn: { flex: 1, padding: '7px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' },
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{children}</div>
}
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3, fontWeight: 500 }}>{children}</div>
}
