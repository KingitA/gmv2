// Frontera del código del módulo vendedor que comparte la app Android (alias
// `@gm/vendedor` en mobile/). Solo módulos PUROS: sin DB, sin next/*, sin React y sin
// dependencias de node_modules (la app no tiene las del ERP). Misma regla que
// lib/pricing/isomorfico.ts.
export * from "./orden-articulos"
export * from "../search/local-match"
export * from "../pedidos/estados"
