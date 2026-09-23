// Fila de cheque/transferencia en un formulario de cobro (chofer web, vendedor web,
// app vendedor). Reducer puro: la UI de cada módulo solo pinta.
//
// Regla 1 (la foto nunca bloquea): la fila nace al instante con la foto adjunta y
// `ocr.estado = "leyendo"`; cuando el OCR responde se AUTOCOMPLETAN solo los campos
// que el operario todavía no tocó. Si falla, la fila queda igual: carga manual.
// Regla 2 (prohibido inventar): acá entra únicamente un ResultadoOcr ya saneado.
// Los campos que vinieron del OCR quedan marcados en `ocr.deOcr` hasta que el
// operario los pisa (la UI los resalta).

import { CAMPOS_CHEQUE, textoDescartados, type CampoCheque, type DatosCheque, type ResultadoOcr } from "./validar"

export type EstadoOcr = "sin_foto" | "leyendo" | "ok" | "sin_datos" | "fallo"

export interface EstadoFotoFila {
  estado: EstadoOcr
  /** Campos que vinieron del OCR y el operario todavía no pisó */
  deOcr: CampoCheque[]
  /** Campos que el operario tocó: el OCR (aunque llegue después) no los pisa */
  editados: CampoCheque[]
  /** URL en el bucket (cuando la subida terminó) */
  foto_url: string | null
  /** Vista previa local (object URL / data URL) mientras no hay URL del bucket, o sin señal */
  foto_local: string | null
  /** Mensaje corto para la UI cuando estado = fallo | sin_datos */
  detalle: string | null
  /** Pista: lo que el OCR leyó y no validó (CUIT que no cierra, fecha rara) */
  pista?: string | null
}

export interface FilaCheque extends DatosCheque {
  /** id local estable (clave de React, correlación con la foto) */
  id: string
  tipo: "cheque" | "transferencia"
  // transferencia
  referencia_transferencia: string
  cuenta_bancaria_id: string
  ocr: EstadoFotoFila
}

export const filaVacia = (id: string, tipo: FilaCheque["tipo"] = "cheque"): FilaCheque => ({
  id,
  tipo,
  monto: 0,
  banco: "",
  numero_cheque: "",
  fecha_cheque: "",
  fecha_emision: "",
  cuit_emisor: "",
  es_echeq: false,
  referencia_transferencia: "",
  cuenta_bancaria_id: "",
  ocr: { estado: "sin_foto", deOcr: [], editados: [], foto_url: null, foto_local: null, detalle: null },
})

/** Fila que nace de una foto: abre al instante, con la foto adjunta y el OCR "leyendo". */
export function filaDesdeFoto(id: string, fotoLocal: string | null): FilaCheque {
  const f = filaVacia(id, "cheque")
  return { ...f, ocr: { ...f.ocr, estado: "leyendo", foto_local: fotoLocal } }
}

const vacio = (fila: FilaCheque, campo: CampoCheque) => {
  const v = fila[campo]
  return v === "" || v === 0 || v === false || v === null || v === undefined
}

/**
 * Aplica un resultado saneado del OCR a la fila: solo completa campos vacíos y no
 * editados. Si el resultado es una transferencia y la fila estaba virgen, la fila
 * cambia de tipo. Devuelve una fila nueva (inmutable).
 */
export function aplicarOcr(fila: FilaCheque, r: ResultadoOcr, fotoUrl: string | null): FilaCheque {
  const deOcr = new Set(fila.ocr.deOcr)
  const editados = new Set(fila.ocr.editados)
  let out: FilaCheque = { ...fila }
  if (r.tipo === "transferencia") {
    const virgen = editados.size === 0 && CAMPOS_CHEQUE.every((c) => vacio(fila, c))
    if (virgen) out.tipo = "transferencia"
    if (out.tipo === "transferencia") {
      if (r.monto !== undefined && vacio(out, "monto") && !editados.has("monto")) {
        out.monto = r.monto
        deOcr.add("monto")
      }
      if (r.numero_comprobante && !out.referencia_transferencia) out.referencia_transferencia = r.numero_comprobante
      if (r.cuenta_bancaria_id && !out.cuenta_bancaria_id) out.cuenta_bancaria_id = r.cuenta_bancaria_id
    }
  } else {
    for (const campo of CAMPOS_CHEQUE) {
      const v = (r as Partial<DatosCheque>)[campo]
      if (v === undefined || v === null || v === "" || v === false) continue
      if (editados.has(campo) || !vacio(out, campo)) continue
      out = { ...out, [campo]: v }
      deOcr.add(campo)
    }
  }
  out.ocr = { ...fila.ocr, estado: "ok", deOcr: [...deOcr], editados: [...editados], foto_url: fotoUrl ?? fila.ocr.foto_url, detalle: null, pista: r.tipo === "cheque" ? textoDescartados(r.descartados) : null }
  return out
}

/** El OCR no devolvió nada útil: la foto queda adjunta, los campos se cargan a mano. */
export function marcarSinDatos(fila: FilaCheque, fotoUrl: string | null): FilaCheque {
  return { ...fila, ocr: { ...fila.ocr, estado: "sin_datos", foto_url: fotoUrl ?? fila.ocr.foto_url, detalle: "La foto quedó adjunta; no se pudieron leer los datos. Cargalos a mano." } }
}

/** El OCR falló o tardó demasiado: nada bloquea, se carga a mano. */
export function marcarFalloOcr(fila: FilaCheque, fotoUrl: string | null, motivo?: string): FilaCheque {
  const url = fotoUrl ?? fila.ocr.foto_url
  const adjunta = !!(url || fila.ocr.foto_local)
  return {
    ...fila,
    ocr: {
      ...fila.ocr,
      estado: "fallo",
      foto_url: url,
      detalle: adjunta
        ? `No se pudo leer la foto${motivo ? ` (${motivo})` : ""}. Quedó adjunta; cargá los datos a mano.`
        : `No se pudo subir la foto${motivo ? ` (${motivo})` : ""}. Cargá los datos a mano.`,
    },
  }
}

/** Foto adjunta sin OCR (por ejemplo, sin señal: se guarda en el equipo y sube con el cobro). */
export function marcarFotoAdjunta(fila: FilaCheque, fotoUrl: string | null, fotoLocal?: string | null): FilaCheque {
  return {
    ...fila,
    ocr: {
      ...fila.ocr,
      estado: fila.ocr.estado === "leyendo" ? "sin_datos" : fila.ocr.estado,
      foto_url: fotoUrl ?? fila.ocr.foto_url,
      foto_local: fotoLocal ?? fila.ocr.foto_local,
      detalle: fotoUrl ? null : "La foto quedó guardada en el equipo y sube con el cobro. Cargá los datos a mano.",
    },
  }
}

/** El operario pisa un campo: deja de ser "del OCR" y el OCR ya no lo toca. */
export function editarCampo<K extends keyof FilaCheque>(fila: FilaCheque, campo: K, valor: FilaCheque[K]): FilaCheque {
  const esCampoOcr = (CAMPOS_CHEQUE as string[]).includes(campo as string)
  const c = campo as CampoCheque
  return {
    ...fila,
    [campo]: valor,
    ocr: esCampoOcr
      ? { ...fila.ocr, deOcr: fila.ocr.deOcr.filter((x) => x !== c), editados: fila.ocr.editados.includes(c) ? fila.ocr.editados : [...fila.ocr.editados, c] }
      : fila.ocr,
  }
}

export const vinoDelOcr = (fila: FilaCheque, campo: CampoCheque) => fila.ocr.deOcr.includes(campo)

/** Lo que falta para que la fila se pueda registrar (misma regla en los 3 módulos). */
export function faltantes(fila: FilaCheque): string[] {
  const f: string[] = []
  if (!(fila.monto > 0)) f.push("monto")
  if (fila.tipo === "cheque") {
    if (!fila.banco) f.push("banco")
    if (!fila.numero_cheque) f.push("número")
    if (!fila.fecha_cheque) f.push("fecha")
  } else if (!fila.cuenta_bancaria_id) f.push("cuenta destino")
  return f
}

/** Fotos ya subidas (URLs del bucket) para `comprobante_urls`. */
export function urlsDeFotos(filas: FilaCheque[]): string[] {
  return [...new Set(filas.map((f) => f.ocr.foto_url).filter((u): u is string => !!u))]
}
