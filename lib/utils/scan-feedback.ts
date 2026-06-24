"use client"

/**
 * Feedback sensorial al escanear con la colectora: un beep corto (WebAudio) y una
 * vibración. Se llama desde los handlers onScan de cada flujo (OK = beep agudo,
 * error = beep grave). Falla en silencio si el navegador no soporta la API.
 */

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  try {
    if (!audioCtx) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!Ctx) return null
      audioCtx = new Ctx()
    }
    return audioCtx
  } catch {
    return null
  }
}

function tone(freq: number, durationMs: number) {
  const ctx = getCtx()
  if (!ctx) return
  try {
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "square"
    osc.frequency.value = freq
    gain.gain.value = 0.05
    osc.connect(gain)
    gain.connect(ctx.destination)
    const now = ctx.currentTime
    osc.start(now)
    gain.gain.setValueAtTime(0.05, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000)
    osc.stop(now + durationMs / 1000)
  } catch {
    /* noop */
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* noop */
  }
}

/** Escaneo exitoso: beep agudo + vibración corta. */
export function scanOk() {
  tone(1760, 70)
  vibrate(40)
}

/** Escaneo con error (no encontrado / no pertenece): beep grave + doble vibración. */
export function scanError() {
  tone(220, 180)
  vibrate([60, 50, 60])
}
