// Nombre de un cliente al darlo de alta (P2-10): sin espacios en los costados ni
// dobles, y en mayúsculas como el resto de la cartera ("prueba1 " → "PRUEBA1").
export function limpiarNombreCliente(v: string | null | undefined): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().toLocaleUpperCase("es-AR")
}
