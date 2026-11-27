/**
 * Lectura con IA (Gemini, el mismo OCR del resto del sistema) de capturas de pantalla del
 * homebanking y de PDFs sin texto. SOLO SERVIDOR. Un prompt por banco.
 *
 * La IA solo TRANSCRIBE lo que ve; todo lo demás (signo, CUIT válido, clave, control por saldo,
 * no duplicar) lo hace lib/bancos/lectura con funciones probadas. Lo que devuelve la IA pasa
 * siempre por parseFecha / parseMonto / el dígito verificador del CUIT (docs/FORMATOS.md).
 */
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai"
import { conRespaldoGemini } from "@/lib/ai/gemini-model"
import { parseFecha, parseMonto } from "@/lib/formato"
import type { BancoLectura, FilaLeida, Lectura } from "./lectura"

const SCHEMA: any = {
  type: SchemaType.OBJECT,
  properties: {
    movimientos: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          fecha: { type: SchemaType.STRING, description: "AAAA-MM-DD" },
          hora: { type: SchemaType.STRING, description: "HH:MM:SS si se ve, si no vacío" },
          concepto: { type: SchemaType.STRING },
          detalle: { type: SchemaType.STRING, description: "texto de la columna Detalle (nombre + CUIT), vacío si es '-'" },
          contraparte_nombre: { type: SchemaType.STRING },
          contraparte_cuit: { type: SchemaType.STRING, description: "11 dígitos si se ve" },
          debito: { type: SchemaType.NUMBER, description: "importe de la columna Débito, positivo; 0 si no hay" },
          credito: { type: SchemaType.NUMBER, description: "importe de la columna Crédito, positivo; 0 si no hay" },
          importe: { type: SchemaType.NUMBER, description: "si hay una sola columna de importe: con su signo (negativo = débito)" },
          saldo: { type: SchemaType.NUMBER, description: "saldo del renglón si se ve; si no, omitir" },
          referencia: { type: SchemaType.STRING, description: "número de comprobante / operación si se ve" },
          cortado: { type: SchemaType.BOOLEAN, description: "true si el renglón está cortado por el borde de la imagen" },
        },
        required: ["fecha"],
      },
    },
    saldo_cuenta: { type: SchemaType.NUMBER, description: "saldo de la cuenta del encabezado de la pantalla (Saldo disponible / Saldo actual), si se ve" },
    orden: { type: SchemaType.STRING, description: "nuevo_primero si lo más nuevo está arriba; viejo_primero si no" },
  },
  required: ["movimientos"],
}

const BASE = `Sos un transcriptor de movimientos bancarios argentinos. Te paso una CAPTURA DE PANTALLA del homebanking (o un extracto).

Reglas:
- Transcribí SOLO lo que se ve. NUNCA inventes ni completes un renglón. Si un dato no se ve, dejalo vacío.
- Devolvé los renglones en el MISMO ORDEN en que aparecen (de arriba hacia abajo).
- Si un renglón está cortado por el borde de arriba o de abajo (no se ve completo su fecha, su importe o su saldo), marcalo cortado = true.
- Renglones iguales (mismo concepto, fecha, hora e importe) son movimientos DISTINTOS: devolvelos todos, uno por renglón.
- Los documentos son de Argentina: las fechas vienen dd/mm/aaaa (día primero, NUNCA mes/día) y los montos 1.234,56 (punto = miles, coma = decimales). Devolvé las fechas como AAAA-MM-DD y los montos como número JSON con punto decimal y sin separador de miles (ej: 1528310.00).
- No son movimientos: encabezados, totales, "Llegaste al final de la consulta", saldos anteriores, botones.
- saldo_cuenta: SOLO si la pantalla muestra el saldo de la cuenta en un encabezado ("Saldo disponible", "Saldo actual", "Saldo"). El saldo de un renglón NO es saldo_cuenta.`

const POR_BANCO: Record<BancoLectura, string> = {
  nacion: `Banco Nación (homebanking). Columnas: "Fecha y hora" (dd/mm/aaaa y debajo HH:MM:SS), "Concepto" (ej. "GRAVAMEN LEY 25413 S/DEB", "REG.REC.SIRCREB", "CR DEBIN RED LINK", "DEB.TRAN.INTERB"; puede ocupar dos líneas: unilas), "Detalle" (NOMBRE y CUIT de 11 dígitos de quien transfirió, o "-"), "Débito" (en rojo, "- $ 9,34") y "Crédito" (en verde). No hay saldo por renglón.
- hora: la hora exacta con segundos (los impuestos salen 00:00:00).
- debito / credito: el importe POSITIVO en la columna que corresponda; la otra en 0. No uses "importe".
- detalle: el texto de la columna Detalle tal cual; contraparte_nombre = el nombre; contraparte_cuit = los 11 dígitos.`,
  provincia: `Banco Provincia (homebanking). Cada movimiento es un bloque: la fecha arriba a la izquierda, el concepto debajo (puede ocupar dos líneas: unilas), "Saldo: $ …" debajo, y el importe a la derecha con signo ("-$ 20,70" = débito, "$ 48,60" = crédito).
- importe: con su signo. saldo: el número de "Saldo:" (puede ser negativo: "-$ 63.348,57" = -63348.57).
- No hay hora. Si el concepto trae un CUIT entre paréntesis, ponelo en contraparte_cuit y el nombre en contraparte_nombre.`,
  credicoop: `Banco Credicoop. Columnas: fecha, comprobante, descripción (la segunda línea trae CUIT−código−NOMBRE y "CBU Origen/Destino"), débito, crédito y saldo (a veces solo al final del día).
- debito / credito: el importe positivo en su columna. detalle: la segunda línea completa. referencia: el número de comprobante.`,
  mp: `MercadoPago (actividad / dinero disponible). Cada renglón: fecha, descripción ("Transferencia recibida NOMBRE", "Rendimientos", "Pago de impuestos"…), importe con signo y, si se ve, saldo.
- importe: con signo (+ entra, − sale). contraparte_nombre: el nombre de la transferencia. referencia: el número de operación si se ve.`,
  otro: `Banco no identificado: buscá fecha, concepto, detalle, débito/crédito (o importe con signo) y saldo.`,
}

/** Lee una imagen (o PDF sin texto) con Gemini y la devuelve como Lectura (sin renglones cortados). */
export async function leerConIA(banco: BancoLectura, archivo: { base64: string; mime: string; nombre: string; origen: Lectura["origen"] }): Promise<Lectura> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurado")
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const prompt = `${BASE}\n\n${POR_BANCO[banco]}`
  const result = await conRespaldoGemini((modelo) =>
    genAI
      .getGenerativeModel({ model: modelo, generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 } })
      .generateContent([{ inlineData: { mimeType: archivo.mime, data: archivo.base64 } }, prompt]),
    "bancos-captura",
  )
  const text = result.response.text()
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error("No se pudo interpretar la lectura de la imagen")
    parsed = JSON.parse(m[0])
  }
  const num = (v: unknown) => (v == null || v === "" ? null : parseMonto(v as string | number))
  const filas: FilaLeida[] = ((parsed.movimientos ?? []) as any[])
    .filter((m) => !m?.cortado)
    .map((m) => {
      const deb = num(m.debito), cred = num(m.credito)
      const conColumnas = !!(deb || cred)
      return {
        fecha: parseFecha(m.fecha ?? null) ?? (m.fecha ? String(m.fecha) : null),
        hora: m.hora ? String(m.hora) : null,
        concepto: m.concepto ? String(m.concepto) : "",
        detalle: m.detalle ? String(m.detalle) : "",
        contraparte_nombre: m.contraparte_nombre ? String(m.contraparte_nombre) : null,
        contraparte_cuit: m.contraparte_cuit ? String(m.contraparte_cuit) : null,
        debito: conColumnas ? deb : null,
        credito: conColumnas ? cred : null,
        monto: conColumnas ? null : num(m.importe),
        saldo: num(m.saldo),
        referencia: m.referencia ? String(m.referencia) : null,
      }
    })
  const saldo = num(parsed.saldo_cuenta)
  return {
    nombre: archivo.nombre, origen: archivo.origen, filas,
    orden: parsed.orden === "viejo_primero" ? "viejo_primero" : archivo.origen === "captura" ? "nuevo_primero" : "viejo_primero",
    saldo_cuenta: archivo.origen === "captura" ? saldo : null,
  }
}
