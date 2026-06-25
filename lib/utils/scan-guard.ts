/**
 * Detecta si un texto escaneado parece un QR/URL en lugar de un código de barras
 * numérico (EAN/DUN). Sirve para ignorar QR con URLs que el operario escanea sin
 * querer al lado del EAN, evitando cargar datos basura o disparar navegación.
 */
export function esQrOUrl(raw: string): boolean {
  const s = (raw || "").trim()
  if (!s) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true        // http://, https://, ftp://, etc.
  if (s.includes("://")) return true
  if (/\s/.test(s)) return true                               // los EAN no tienen espacios
  if (/^(www\.|mailto:|tel:|geo:|smsto:|sms:|wifi:|begin:|matmsg:)/i.test(s)) return true
  if (s.length > 18 && !/^\d+$/.test(s)) return true          // payload largo no numérico
  return false
}
