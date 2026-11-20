#!/usr/bin/env node
// Genera el sonido de alarma propio del plugin (res/raw/gm_alarma.wav): sirena de dos tonos
// fuerte y repetitiva, sintetizada acá (sin archivos de terceros ni licencias). El NuStar no
// tiene un tono de alarma por defecto que se pueda abrir (MediaPlayer: "Couldn't open fd for
// content://settings/system/alarm_alert"). Se reproduce en loop: dura 2 s y empalma sin corte.
//
//   node mobile/packages/capacitor-alarma/scripts/generar-sonido.mjs

import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SR = 22050
const SEG = 2
const n = SR * SEG
const datos = Buffer.alloc(n * 2)
let fase = 0
for (let i = 0; i < n; i++) {
  const t = i / SR
  // 4 pitidos por segundo alternando 880 / 1320 Hz (tipo alarma de depósito)
  const cuarto = Math.floor(t * 8)
  const f = cuarto % 2 === 0 ? 880 : 1320
  fase += (2 * Math.PI * f) / SR
  // Cuadrada suavizada (más audible que una senoidal en un parlante chico) + ataque corto sin clics
  let s = Math.tanh(4 * Math.sin(fase))
  const enPitido = (t * 8) % 1
  const env = Math.min(1, enPitido / 0.02, (1 - enPitido) / 0.02)
  s *= env * 0.92
  datos.writeInt16LE(Math.round(s * 32767), i * 2)
}
const cab = Buffer.alloc(44)
cab.write("RIFF", 0)
cab.writeUInt32LE(36 + datos.length, 4)
cab.write("WAVE", 8)
cab.write("fmt ", 12)
cab.writeUInt32LE(16, 16)
cab.writeUInt16LE(1, 20) // PCM
cab.writeUInt16LE(1, 22) // mono
cab.writeUInt32LE(SR, 24)
cab.writeUInt32LE(SR * 2, 28)
cab.writeUInt16LE(2, 32)
cab.writeUInt16LE(16, 34)
cab.write("data", 36)
cab.writeUInt32LE(datos.length, 40)

const destino = resolve(dirname(fileURLToPath(import.meta.url)), "../android/src/main/res/raw/gm_alarma.wav")
writeFileSync(destino, Buffer.concat([cab, datos]))
console.log(`✓ ${destino} (${SEG} s, ${SR} Hz, ${(44 + datos.length) / 1024 | 0} KB)`)
