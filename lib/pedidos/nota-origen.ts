// Nota del SISTEMA sobre de dónde vino un pedido (pedidos.nota_origen, Juan 27/11/2026).
// Va aparte de lo escrito a mano (pedidos.observaciones): se ve en el pedido y en su
// impresión, NUNCA en los comprobantes. Lleva el nombre de los archivos.

const PREFIJO_IA = "Importado vía IA"

/** "Importado vía IA - pedido juanenea 27-11.xlsx" (varios archivos: separados por coma) */
export function notaImportacionArchivos(nombres: (string | null | undefined)[]): string {
  const limpios = [...new Set(nombres.map((n) => (n ?? "").trim()).filter(Boolean))]
  return limpios.length ? `${PREFIJO_IA} - ${limpios.join(", ")}` : PREFIJO_IA
}

/**
 * Pedido que llegó por mail: con adjuntos, sus nombres; sin adjunto, de quién y el asunto.
 * "Importado vía IA - pedido.xlsx (mail de luis@x.com)" · "Importado vía IA - mail de luis@x.com: PEDIDOS LUIS"
 */
export function notaImportacionMail(de: string | null | undefined, asunto: string | null | undefined, adjuntos: (string | null | undefined)[] = []): string {
  const quien = (de ?? "").trim()
  const tema = (asunto ?? "").trim()
  const archivos = [...new Set(adjuntos.map((n) => (n ?? "").trim()).filter(Boolean))]
  if (archivos.length) return `${PREFIJO_IA} - ${archivos.join(", ")}${quien ? ` (mail de ${quien})` : ""}`
  return `${PREFIJO_IA} - mail${quien ? ` de ${quien}` : ""}${tema ? `: ${tema}` : ""}`
}
