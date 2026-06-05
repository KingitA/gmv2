/**
 * Normaliza un código EAN: si es numérico y tiene menos de 13 dígitos,
 * lo completa con ceros a la izquierda hasta llegar a 13.
 * Esto cubre escáneres que eliminan el cero inicial.
 */
export function padEan13(code: string): string {
  const trimmed = code.trim()
  if (/^\d+$/.test(trimmed) && trimmed.length < 13) {
    return trimmed.padStart(13, "0")
  }
  return trimmed
}

export function padEanArray(codes: string[]): string[] {
  return codes.map(padEan13)
}
