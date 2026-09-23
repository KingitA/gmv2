// Lectura de comprobantes de pago (cheques / transferencias / depósitos) con Gemini.
// Solo servidor. La validación de lo leído vive en ./validar (nunca se muestra un dato
// sin validar); acá solo se le pide al modelo que TRANSCRIBA.
//
// Dos pasadas para el cheque:
//  1. JSON estructurado (esquema forzado) con todos los campos + `linea_titular`: la
//     transcripción literal de las líneas impresas del titular ("Cta.: … / CUIT|CUIL
//     nnnnnnnnnnn NOMBRE"). De ahí se rescata el CUIT con regex acotada a ESA línea
//     (no a toda la imagen) si el campo vino vacío o inválido.
//  2. Si después de eso falta el CUIT o la fecha de pago, una pasada corta en texto
//     plano que solo pide esas dos cosas (foco = mejor lectura de dígitos chicos).

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai"

export const OCR_SCHEMA: any = {
  type: SchemaType.OBJECT,
  properties: {
    resultados: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          tipo: { type: SchemaType.STRING, description: "cheque | transferencia | deposito" },
          monto: { type: SchemaType.NUMBER },
          numero_cheque: { type: SchemaType.STRING },
          banco_emisor: { type: SchemaType.STRING },
          fecha_emision: { type: SchemaType.STRING },
          fecha_cheque: { type: SchemaType.STRING },
          cuit_emisor: { type: SchemaType.STRING },
          cuits_titulares: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          linea_titular: { type: SchemaType.STRING, description: "Transcripción LITERAL de las líneas impresas del titular de la cuenta (Cta., CUIT/CUIL, nombre, domicilio), tal cual se leen" },
          localidad: { type: SchemaType.STRING },
          color_cheque: { type: SchemaType.STRING, description: "ECHEQ solo si es cheque electrónico; en papel no devolver este campo" },
          cbu_destino: { type: SchemaType.STRING },
          cvu_destino: { type: SchemaType.STRING },
          fecha_transferencia: { type: SchemaType.STRING },
          numero_comprobante: { type: SchemaType.STRING },
          fecha_deposito: { type: SchemaType.STRING },
          items: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                tipo_item: { type: SchemaType.STRING, description: "efectivo | cheque" },
                monto: { type: SchemaType.NUMBER },
                banco_emisor: { type: SchemaType.STRING },
                numero_cheque: { type: SchemaType.STRING },
                fecha_pago_cheque: { type: SchemaType.STRING },
                numero_comprobante_deposito: { type: SchemaType.STRING },
                fecha_deposito_efectivo: { type: SchemaType.STRING },
                nro_comprobante_deposito_ef: { type: SchemaType.STRING },
              },
              required: ["tipo_item", "monto"],
            },
          },
        },
        required: ["tipo"],
      },
    },
  },
  required: ["resultados"],
}

export const PROMPT_OCR = `Sos un experto en documentos bancarios y de pagos argentinos.

Analizá esta imagen y extraé TODOS los comprobantes de pago que aparecen (puede haber uno o varios: cheques, transferencias, depósitos). La foto puede estar rotada 90° o 180°, con fondo, sombras o reflejos: leé el documento en su orientación correcta.

REGLA PRINCIPAL: COPIÁ, NO COMPLETES. Transcribí lo que está impreso o escrito; nunca completes dígitos que no ves ni corrijas un número para que "cierre". Si un dato no está en la imagen, null. Un campo inventado es un error grave; un campo transcripto con un dígito dudoso lo revisa el sistema.

CHEQUE (tipo: "cheque"). Anatomía de un cheque argentino:
- Arriba: banco (logo), "SERIE" y número de cheque (8 dígitos, también repetido en la banda MICR de abajo), importe en números ($).
- Fechas: "Lugar y fecha" / "TANDIL, 15 de ABRIL de 2026" = fecha de EMISIÓN (fecha_emision). En un cheque de pago diferido (CPD) hay una segunda línea "EL 27 de JUNIO de 2026" = fecha de PAGO (fecha_cheque). Un cheque común tiene una sola fecha: devolvela en fecha_cheque Y en fecha_emision. Suelen estar ESCRITAS A MANO con el mes en letras: convertí a YYYY-MM-DD. Devolvé siempre la fecha si se ve, aunque sea futura.
- "PÁGUESE A" y "LA CANTIDAD DE PESOS" (importe en letras, escrito a mano): monto = importe numérico; el de letras y el de números deben coincidir.
- Abajo a la izquierda, IMPRESAS en letra chica, las líneas del titular de la cuenta, por ejemplo:
    "Cta.: 114-355212/6 (10/99) RICCHIERI 343 (7000) TANDIL"
    "CUIL 20233373029 STRAUBINGER DIEGO ARIEL"
  cuit_emisor (PRIORIDAD MÁXIMA) es el número de 11 dígitos de esa línea, precedido por "CUIT", "C.U.I.T.", "CUIL" o "CT", con o sin guiones. Transcribilo exactamente en formato XX-XXXXXXXX-X aunque dudes de un dígito. NO es el número de cuenta (tiene barra "/"), NO es el número de cheque y NO está en la banda MICR.
  linea_titular: transcripción LITERAL de esas líneas impresas del titular (Cta., CUIT/CUIL, nombre, domicilio), tal cual se leen, para verificación.
- cuits_titulares: TODOS los CUITs/CUILs impresos junto a los nombres de los titulares (cuenta conjunta = dos). Si hay uno solo, array con ese único.
- banco_emisor: nombre del banco emisor (logo). localidad: si es visible. color_cheque: "ECHEQ" únicamente si es un cheque electrónico; si es papel, null.

TRANSFERENCIA (tipo: "transferencia"):
- monto, cbu_destino / cvu_destino (22 dígitos si es visible), fecha_transferencia (YYYY-MM-DD), numero_comprobante.

DEPÓSITO (tipo: "deposito", puede tener varios ítems):
- fecha_deposito (YYYY-MM-DD) e items: { tipo_item: "efectivo", monto, fecha_deposito_efectivo, nro_comprobante_deposito_ef } o { tipo_item: "cheque", monto, banco_emisor, numero_cheque, fecha_pago_cheque, numero_comprobante_deposito }.

Los montos SIEMPRE numéricos. Devolvé solo el JSON { "resultados": [ ... ] }.`

/** Segunda pasada, solo texto: CUIT y fechas del cheque, con foco. */
export const PROMPT_TITULAR = `Esta es la foto de un cheque argentino (puede estar rotada). Necesito SOLO tres datos, transcriptos tal cual se leen, sin completar ni corregir:

1. LINEA_TITULAR: las líneas impresas en letra chica abajo a la izquierda con los datos del titular de la cuenta (empiezan con "Cta.:" y siguen con "CUIT" o "CUIL" y el nombre). Copialas literalmente, dígito por dígito.
2. FECHA_EMISION: la fecha escrita a mano junto al lugar ("TANDIL, 15 de ABRIL de 2026"), tal cual está escrita.
3. FECHA_PAGO: si es un cheque de pago diferido, la fecha de la línea "EL ... de ... de ..."; si no hay, escribí "no hay".

Respondé exactamente en este formato, una por línea:
LINEA_TITULAR: ...
FECHA_EMISION: ...
FECHA_PAGO: ...`

const MODELO = "gemini-2.5-flash"

function cliente() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurado")
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
}

/** Pasada 1: JSON estructurado con todos los comprobantes de la imagen. */
export async function leerComprobantesConGemini(base64: string, mimeType: string, timeoutMs = 30_000): Promise<any[]> {
  const model = cliente().getGenerativeModel({
    model: MODELO,
    generationConfig: { responseMimeType: "application/json", responseSchema: OCR_SCHEMA, temperature: 0 },
  })
  const result = await model.generateContent([{ inlineData: { mimeType: mimeType || "image/jpeg", data: base64 } }, PROMPT_OCR], { timeout: timeoutMs })
  const text = result.response.text()
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error("No se pudo interpretar la respuesta del OCR")
    parsed = JSON.parse(m[0])
  }
  return Array.isArray(parsed?.resultados) ? parsed.resultados : []
}

export interface LecturaTitular {
  linea_titular: string | null
  fecha_emision: string | null
  fecha_pago: string | null
  crudo: string
}

/** Pasada 2 (texto plano): línea del titular + fechas. Nunca lanza: si falla devuelve nulls. */
export async function leerTitularConGemini(base64: string, mimeType: string, timeoutMs = 20_000): Promise<LecturaTitular> {
  try {
    const model = cliente().getGenerativeModel({ model: MODELO, generationConfig: { temperature: 0 } })
    const result = await model.generateContent([{ inlineData: { mimeType: mimeType || "image/jpeg", data: base64 } }, PROMPT_TITULAR], { timeout: timeoutMs })
    const crudo = result.response.text()
    const campo = (k: string) => {
      const m = crudo.match(new RegExp(`${k}\\s*:\\s*(.+)`, "i"))
      const v = m?.[1]?.trim() || null
      return v && !/^(no hay|null|-|—)$/i.test(v) ? v : null
    }
    return { linea_titular: campo("LINEA_TITULAR"), fecha_emision: campo("FECHA_EMISION"), fecha_pago: campo("FECHA_PAGO"), crudo }
  } catch (e: any) {
    console.error("[ocr-gemini] segunda pasada:", e?.message)
    return { linea_titular: null, fecha_emision: null, fecha_pago: null, crudo: "" }
  }
}
