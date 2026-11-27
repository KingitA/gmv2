// Control de cheques y transferencias antes de registrar un cobro (Juan, 27/11/2026).
// Mensaje CORTO ("Falta monto del cheque"), el campo en rojo y la fila abierta. Un cheque
// con el mismo número y el mismo banco (normalizado: "Patagonia" = "BANCO PATAGONIA") que
// otro del mismo cobro no se deja cargar; igual una transferencia con el mismo N° de
// operación. Contra los cheques ya cargados del cliente controla el servidor (la réplica del
// vendedor no trae cheques). Puro: lo prueban los tests.

import { chequesRepetidos, faltantes, transferenciasRepetidas, type FilaCheque } from "@gm/cheques"

/** Nombre del faltante de `faltantes()` → campo de la fila y cómo decirlo. */
const CAMPO: Record<string, { campo: string; texto: string }> = {
  monto: { campo: "monto", texto: "monto" },
  banco: { campo: "banco", texto: "banco" },
  número: { campo: "numero_cheque", texto: "número" },
  fecha: { campo: "fecha_cheque", texto: "fecha" },
  "cuenta destino": { campo: "cuenta_bancaria_id", texto: "cuenta destino" },
}

export interface ProblemaMetodos {
  /** Fila a abrir */
  idx: number
  texto: string
  /** id de fila → campos en rojo */
  errores: Record<string, string[]>
}

export function problemaMetodos(filas: ReadonlyArray<FilaCheque>): ProblemaMetodos | null {
  const errores: Record<string, string[]> = {}
  let primero: { idx: number; texto: string } | null = null
  const marcar = (idx: number, campos: string[], texto: string) => {
    const id = filas[idx]!.id
    errores[id] = [...new Set([...(errores[id] || []), ...campos])]
    if (!primero) primero = { idx, texto }
  }
  filas.forEach((f, idx) => {
    const falta = faltantes(f)
    if (!falta.length) return
    const de = f.tipo === "cheque" ? "del cheque" : "de la transferencia"
    marcar(idx, falta.map((x) => CAMPO[x]?.campo ?? x), `Falta ${CAMPO[falta[0]!]?.texto ?? falta[0]} ${de}${f.tipo === "cheque" && f.numero_cheque ? ` ${f.numero_cheque}` : ""}.`)
  })
  for (const idx of chequesRepetidos(filas)) marcar(idx, ["banco", "numero_cheque"], `El cheque ${filas[idx]!.numero_cheque} ya está cargado en este cobro.`)
  for (const idx of transferenciasRepetidas(filas)) marcar(idx, ["referencia_transferencia"], "Esa transferencia ya está cargada en este cobro.")
  const p = primero as { idx: number; texto: string } | null
  return p ? { idx: p.idx, texto: p.texto, errores } : null
}
