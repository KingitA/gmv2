"use client"

import { useRef, useState } from "react"

// Visor de imagen a pantalla completa para la tablet del vendedor:
// pinch para zoom (dos dedos), arrastre con el zoom activo y doble tap
// para alternar 1x/2.5x. Sin librerías: pointer events nativos.
export function ZoomImageOverlay({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)

  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const gesto = useRef<{ dist: number; scale: number; x: number; y: number; tx: number; ty: number } | null>(null)
  const lastTap = useRef(0)

  const clampScale = (s: number) => Math.min(5, Math.max(1, s))

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length === 2) {
      gesto.current = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        scale,
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
        tx,
        ty,
      }
    } else if (pts.length === 1) {
      gesto.current = { dist: 0, scale, x: pts[0].x, y: pts[0].y, tx, ty }
      const now = Date.now()
      if (now - lastTap.current < 300) {
        // Doble tap: alternar zoom
        if (scale > 1) {
          setScale(1)
          setTx(0)
          setTy(0)
        } else {
          setScale(2.5)
        }
        lastTap.current = 0
      } else {
        lastTap.current = now
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    const g = gesto.current
    if (!g) return
    if (pts.length === 2 && g.dist > 0) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      setScale(clampScale((g.scale * dist) / g.dist))
      const cx = (pts[0].x + pts[1].x) / 2
      const cy = (pts[0].y + pts[1].y) / 2
      setTx(g.tx + (cx - g.x))
      setTy(g.ty + (cy - g.y))
    } else if (pts.length === 1 && scale > 1) {
      setTx(g.tx + (pts[0].x - g.x))
      setTy(g.ty + (pts[0].y - g.y))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) gesto.current = null
    if (pointers.current.size === 1) {
      const p = [...pointers.current.values()][0]
      gesto.current = { dist: 0, scale, x: p.x, y: p.y, tx, ty }
    }
    if (scale <= 1.02) {
      setScale(1)
      setTx(0)
      setTy(0)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" style={{ touchAction: "none" }}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-11 h-11 rounded-full bg-white/15 text-white text-2xl leading-none flex items-center justify-center"
        aria-label="Cerrar"
      >
        ✕
      </button>
      <p className="absolute bottom-5 inset-x-0 text-center text-white/50 text-xs pointer-events-none">
        Pellizcá para hacer zoom · doble tap para acercar
      </p>
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          // Tap simple en el fondo (sin zoom) cierra
          if (scale === 1 && e.target === e.currentTarget) onClose()
        }}
      >
        <img
          src={src}
          alt={alt || ""}
          draggable={false}
          className="max-w-full max-h-full object-contain select-none"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transition: gesto.current ? "none" : "transform 120ms" }}
        />
      </div>
    </div>
  )
}
