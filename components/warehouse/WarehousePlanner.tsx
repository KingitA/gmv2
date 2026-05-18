'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Stage, Layer, Rect, Text, Line, Group, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'

const PX_PER_M = 20
const W_METERS = 30
const H_METERS = 40

type ElemType = 'estanteria' | 'rack_3' | 'rack_4'

const TYPE_CFG: Record<ElemType, { label: string; w: number; h: number; color: string; bg: string }> = {
  estanteria: { label: 'Estantería',    w: 3,   h: 1,   color: '#2563eb', bg: '#dbeafe' },
  rack_3:     { label: 'Rack 3 Niv.',  w: 2,   h: 0.8, color: '#ea580c', bg: '#ffedd5' },
  rack_4:     { label: 'Rack 4 Niv.',  w: 2,   h: 0.8, color: '#dc2626', bg: '#fee2e2' },
}

interface WElem {
  id: string
  type: ElemType
  x: number
  y: number
  w: number
  h: number
  rotation: number
  label: string
}

interface LayoutData { id?: string; elements: WElem[] }

function clamp(val: number, min: number, max: number) { return Math.max(min, Math.min(max, val)) }

export default function WarehousePlanner() {
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [elements, setElements] = useState<WElem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [stagePos, setStagePos] = useState({ x: 40, y: 40 })
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 })
  const [showGrid, setShowGrid] = useState(true)
  const [layoutId, setLayoutId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [labelEdit, setLabelEdit] = useState('')
  const [saved, setSaved] = useState(false)

  // Load layout
  useEffect(() => {
    fetch('/api/warehouse/layout')
      .then(r => r.ok ? r.json() : null)
      .then((data: LayoutData | null) => {
        if (data) {
          setLayoutId(data.id ?? null)
          setElements(data.elements ?? [])
        }
      })
      .catch(console.error)
  }, [])

  // Canvas resize observer
  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setCanvasSize({ w: width, h: height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // Sync transformer to selected node
  useEffect(() => {
    if (!trRef.current || !stageRef.current) return
    if (selectedId) {
      const node = stageRef.current.findOne(`#elem-${selectedId}`)
      if (node) { trRef.current.nodes([node]); trRef.current.getLayer()?.batchDraw() }
    } else {
      trRef.current.nodes([])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [selectedId, elements])

  // Sync label editor to selected element
  useEffect(() => {
    const el = elements.find(e => e.id === selectedId)
    setLabelEdit(el?.label ?? '')
  }, [selectedId])

  const addElement = (type: ElemType) => {
    const cfg = TYPE_CFG[type]
    const cx = (-stagePos.x + canvasSize.w / 2) / (scale * PX_PER_M)
    const cy = (-stagePos.y + canvasSize.h / 2) / (scale * PX_PER_M)
    const count = elements.filter(e => e.type === type).length + 1
    const el: WElem = {
      id: crypto.randomUUID(),
      type,
      x: clamp(cx - cfg.w / 2, 0, W_METERS - cfg.w),
      y: clamp(cy - cfg.h / 2, 0, H_METERS - cfg.h),
      w: cfg.w,
      h: cfg.h,
      rotation: 0,
      label: `${cfg.label} ${count}`,
    }
    setElements(prev => [...prev, el])
    setSelectedId(el.id)
  }

  const updateElem = useCallback((id: string, patch: Partial<WElem>) => {
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }, [])

  const deleteSelected = () => {
    if (!selectedId) return
    setElements(prev => prev.filter(e => e.id !== selectedId))
    setSelectedId(null)
  }

  const rotateSelected = () => {
    if (!selectedId) return
    const el = elements.find(e => e.id === selectedId)
    if (!el) return
    updateElem(selectedId, { rotation: (el.rotation + 90) % 360 })
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
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) { console.error(e) }
    finally { setIsSaving(false) }
  }

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1
    const newScale = clamp(scale * factor, 0.2, 5)
    const mousePointTo = { x: (pointer.x - stagePos.x) / scale, y: (pointer.y - stagePos.y) / scale }
    setScale(newScale)
    setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale })
  }

  const handleTransformEnd = (el: WElem) => {
    const node = stageRef.current?.findOne(`#elem-${el.id}`) as Konva.Group | undefined
    if (!node) return
    const sx = node.scaleX()
    const sy = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    updateElem(el.id, {
      x: node.x() / PX_PER_M,
      y: node.y() / PX_PER_M,
      w: Math.max(0.5, el.w * sx),
      h: Math.max(0.5, el.h * sy),
      rotation: node.rotation(),
    })
  }

  const selectedEl = elements.find(e => e.id === selectedId)
  const counts = { estanteria: 0, rack_3: 0, rack_4: 0 }
  elements.forEach(e => counts[e.type]++)

  // Grid lines (computed once per showGrid change — stable for render)
  const gridLines: React.ReactNode[] = []
  if (showGrid) {
    for (let i = 0; i <= W_METERS; i++) {
      const major = i % 5 === 0
      gridLines.push(
        <Line key={`v${i}`}
          points={[i * PX_PER_M, 0, i * PX_PER_M, H_METERS * PX_PER_M]}
          stroke={major ? '#94a3b8' : '#e2e8f0'}
          strokeWidth={major ? 0.6 : 0.3} />
      )
      if (major)
        gridLines.push(<Text key={`vl${i}`} x={i * PX_PER_M + 2} y={3} text={`${i}m`} fontSize={7} fill="#94a3b8" />)
    }
    for (let j = 0; j <= H_METERS; j++) {
      const major = j % 5 === 0
      gridLines.push(
        <Line key={`h${j}`}
          points={[0, j * PX_PER_M, W_METERS * PX_PER_M, j * PX_PER_M]}
          stroke={major ? '#94a3b8' : '#e2e8f0'}
          strokeWidth={major ? 0.6 : 0.3} />
      )
      if (major && j > 0)
        gridLines.push(<Text key={`hl${j}`} x={3} y={j * PX_PER_M + 2} text={`${j}m`} fontSize={7} fill="#94a3b8" />)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100dvh', fontFamily: "'DM Sans', system-ui, sans-serif", overflow: 'hidden', background: '#f1f5f9' }}>
      {/* ── Sidebar ── */}
      <div style={{ width: 268, flexShrink: 0, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Planner Depósito</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>30 m × 40 m · {elements.length} elementos</div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
          {/* Add elements */}
          <div style={{ marginBottom: 16 }}>
            <div style={S.sectionLabel}>Agregar</div>
            {(Object.entries(TYPE_CFG) as [ElemType, typeof TYPE_CFG[ElemType]][]).map(([type, cfg]) => (
              <button key={type} onClick={() => addElement(type)} style={{ ...S.addBtn, borderColor: `${cfg.color}33`, background: cfg.bg }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: cfg.color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                </div>
                <div style={{ flex: 1, textAlign: 'left' as const }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{cfg.label}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{cfg.w}m × {cfg.h}m · <span style={{ color: cfg.color, fontWeight: 600 }}>{counts[type]} en plano</span></div>
                </div>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: cfg.color, color: '#fff', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 300, flexShrink: 0 }}>+</div>
              </button>
            ))}
          </div>

          {/* Properties panel */}
          {selectedEl && (
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 14 }}>
              <div style={S.sectionLabel}>Propiedades seleccionadas</div>
              <div style={{ background: '#f9fafb', borderRadius: 10, padding: '12px', border: '1px solid #e5e7eb' }}>
                <div style={{ marginBottom: 10 }}>
                  <div style={S.fieldLabel}>Etiqueta</div>
                  <input
                    value={labelEdit}
                    onChange={e => setLabelEdit(e.target.value)}
                    onBlur={() => updateElem(selectedEl.id, { label: labelEdit })}
                    onKeyDown={e => { if (e.key === 'Enter') updateElem(selectedEl.id, { label: labelEdit }) }}
                    style={S.input}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div>
                    <div style={S.fieldLabel}>Largo (m)</div>
                    <input type="number" min={0.5} max={20} step={0.5}
                      value={selectedEl.w}
                      onChange={e => updateElem(selectedEl.id, { w: parseFloat(e.target.value) || 1 })}
                      style={S.input}
                    />
                  </div>
                  <div>
                    <div style={S.fieldLabel}>Ancho (m)</div>
                    <input type="number" min={0.5} max={20} step={0.5}
                      value={selectedEl.h}
                      onChange={e => updateElem(selectedEl.id, { h: parseFloat(e.target.value) || 1 })}
                      style={S.input}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div>
                    <div style={S.fieldLabel}>Pos X (m)</div>
                    <input type="number" min={0} max={W_METERS} step={0.5}
                      value={Math.round(selectedEl.x * 10) / 10}
                      onChange={e => updateElem(selectedEl.id, { x: parseFloat(e.target.value) || 0 })}
                      style={S.input}
                    />
                  </div>
                  <div>
                    <div style={S.fieldLabel}>Pos Y (m)</div>
                    <input type="number" min={0} max={H_METERS} step={0.5}
                      value={Math.round(selectedEl.y * 10) / 10}
                      onChange={e => updateElem(selectedEl.id, { y: parseFloat(e.target.value) || 0 })}
                      style={S.input}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={rotateSelected} style={S.actionBtn}>
                    <RotateIcon /> Rotar 90°
                  </button>
                  <button onClick={deleteSelected} style={{ ...S.actionBtn, borderColor: '#fca5a5', background: '#fef2f2', color: '#dc2626' }}>
                    <TrashIcon /> Eliminar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px', borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowGrid(g => !g)}
              style={{ flex: 1, padding: '7px', borderRadius: 8, border: `1px solid ${showGrid ? '#bae6fd' : '#d1d5db'}`, background: showGrid ? '#f0f9ff' : '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: showGrid ? '#0284c7' : '#6b7280' }}>
              ⊞ {showGrid ? 'Grilla ON' : 'Grilla OFF'}
            </button>
            <button onClick={() => { setScale(1); setStagePos({ x: 40, y: 40 }) }}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#374151', fontWeight: 600 }}>
              Centrar
            </button>
          </div>
          <button onClick={handleSave} disabled={isSaving}
            style={{ width: '100%', padding: '10px', borderRadius: 10, border: 'none', background: saved ? '#16a34a' : isSaving ? '#9ca3af' : '#111827', color: '#fff', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, transition: 'background 0.2s' }}>
            {saved ? '✓ Guardado' : isSaving ? 'Guardando...' : 'Guardar Layout'}
          </button>
          <div style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af' }}>
            Scroll → zoom · Arrastrá el fondo → mover
          </div>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#cbd5e1' }}>
        <Stage
          ref={stageRef}
          width={canvasSize.w}
          height={canvasSize.h}
          scaleX={scale}
          scaleY={scale}
          x={stagePos.x}
          y={stagePos.y}
          draggable
          onDragEnd={e => setStagePos({ x: e.target.x(), y: e.target.y() })}
          onWheel={handleWheel}
          onClick={e => { if (e.target === e.target.getStage() || e.target.getParent() === e.target.getLayer()) setSelectedId(null) }}
        >
          {/* Floor + grid layer */}
          <Layer>
            <Rect x={0} y={0}
              width={W_METERS * PX_PER_M}
              height={H_METERS * PX_PER_M}
              fill="#f8fafc" stroke="#475569" strokeWidth={2}
            />
            {gridLines}
            {/* Dimension labels on edges */}
            <Text x={W_METERS * PX_PER_M / 2 - 20} y={H_METERS * PX_PER_M + 6} text="30 m" fontSize={9} fill="#64748b" fontStyle="bold" />
            <Text x={W_METERS * PX_PER_M + 6} y={H_METERS * PX_PER_M / 2 - 12} text="40 m" fontSize={9} fill="#64748b" fontStyle="bold" rotation={90} />
          </Layer>

          {/* Elements layer */}
          <Layer>
            {elements.map(el => {
              const cfg = TYPE_CFG[el.type]
              const px = el.x * PX_PER_M
              const py = el.y * PX_PER_M
              const pw = el.w * PX_PER_M
              const ph = el.h * PX_PER_M
              const isSelected = selectedId === el.id
              return (
                <Group
                  key={el.id}
                  id={`elem-${el.id}`}
                  x={px} y={py}
                  width={pw} height={ph}
                  rotation={el.rotation}
                  draggable
                  onClick={e => { e.cancelBubble = true; setSelectedId(el.id) }}
                  onDragEnd={e => updateElem(el.id, {
                    x: Math.max(0, e.target.x() / PX_PER_M),
                    y: Math.max(0, e.target.y() / PX_PER_M),
                  })}
                  onTransformEnd={() => handleTransformEnd(el)}
                >
                  <Rect
                    width={pw} height={ph}
                    fill={cfg.bg}
                    stroke={isSelected ? '#0f172a' : cfg.color}
                    strokeWidth={isSelected ? 2 / scale : 1 / scale}
                    cornerRadius={2}
                    shadowEnabled={isSelected}
                    shadowColor="#000"
                    shadowBlur={12}
                    shadowOpacity={0.25}
                  />
                  {/* Stripe lines for visual depth */}
                  {Array.from({ length: Math.floor(el.w / 0.5) - 1 }, (_, i) => (
                    <Line key={i}
                      points={[(i + 1) * 0.5 * PX_PER_M, 0, (i + 1) * 0.5 * PX_PER_M, ph]}
                      stroke={cfg.color} strokeWidth={0.4} opacity={0.3}
                    />
                  ))}
                  <Text
                    text={el.label}
                    width={pw} height={ph}
                    align="center" verticalAlign="middle"
                    fontSize={clamp(pw / (el.label.length * 0.6), 6, 11)}
                    fill={cfg.color}
                    fontStyle="bold"
                    fontFamily="'DM Sans', system-ui"
                    wrap="word"
                    padding={2}
                  />
                </Group>
              )
            })}
            <Transformer
              ref={trRef}
              anchorSize={clamp(7 / scale, 4, 12)}
              borderStrokeWidth={1.5 / scale}
              rotateEnabled={false}
              boundBoxFunc={(_, newBox) => ({
                ...newBox,
                width: Math.max(PX_PER_M * 0.5, newBox.width),
                height: Math.max(PX_PER_M * 0.5, newBox.height),
              })}
            />
          </Layer>
        </Stage>

        {/* Zoom controls */}
        <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <ZoomBtn label="+" onClick={() => setScale(s => clamp(s * 1.2, 0.2, 5))} />
          <ZoomBtn label="−" onClick={() => setScale(s => clamp(s / 1.2, 0.2, 5))} />
        </div>

        {/* Zoom indicator */}
        <div style={{ position: 'absolute', bottom: 16, left: 16, background: 'rgba(255,255,255,0.92)', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: '#64748b', border: '1px solid #e2e8f0' }}>
          {Math.round(scale * 100)}% · {W_METERS}m × {H_METERS}m
        </div>

        {/* Legend */}
        <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.95)', borderRadius: 10, padding: '8px 12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(Object.entries(TYPE_CFG) as [ElemType, typeof TYPE_CFG[ElemType]][]).map(([type, cfg]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: cfg.bg, border: `1.5px solid ${cfg.color}` }} />
              <span style={{ color: '#374151', fontWeight: 600 }}>{cfg.label}</span>
              <span style={{ color: cfg.color, fontWeight: 700 }}>{counts[type]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Shared styles ──────────────────────────────────────────────
const S = {
  sectionLabel: { fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 },
  addBtn: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, border: '1px solid', cursor: 'pointer', marginBottom: 7, textAlign: 'left' as const },
  fieldLabel: { fontSize: 11, color: '#6b7280', marginBottom: 3, fontWeight: 500 },
  input: { width: '100%', padding: '6px 8px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, color: '#111827' },
  actionBtn: { flex: 1, padding: '7px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 },
}

// ── Small icon components ──────────────────────────────────────
function ZoomBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: 36, height: 36, borderRadius: 9, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', color: '#374151', fontWeight: 300 }}>
      {label}
    </button>
  )
}

function RotateIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M21 2v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/>
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
    </svg>
  )
}
