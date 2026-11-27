// Un usuario vendedor puede tener VARIOS códigos de vendedor (ej. FREIJE DANIEL y FREIJE
// DANIEL LISTA NECO). La plata en la mano es UNA (rendición única, 27/11/2026): la
// rendición y los retiros se anotan siempre en el mismo código, el "principal". Regla
// determinista (no depende de cuánto efectivo tenga cada código ese día): el de id menor.

export function codigoPrincipal(vendedorIds: readonly string[]): string {
  if (!vendedorIds.length) throw new Error("El usuario no tiene códigos de vendedor")
  return [...vendedorIds].sort()[0]!
}
