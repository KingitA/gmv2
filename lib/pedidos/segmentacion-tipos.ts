// Tipos de la segmentación por PROVEEDOR y por MARCA (components/pedidos/SegmentacionCondiciones.tsx).
// Aparte del componente para que la lógica pura (lib/pedidos/condiciones-form.ts) y sus
// tests no dependan de la pantalla.

export type CondRow = {
  ref_id: string                       // proveedor_id | marca_id
  nombre: string
  lista_precio_id: string | null       // null = hereda la lista del pedido
  metodo_facturacion: string | null    // 'Factura' | 'Final' | 'Presupuesto' · null = hereda
  dto_general_pct: number | null
  dto_viajante_pct: number | null
  dto_mercaderia_pct: number | null
  contado?: boolean | null             // true = sale con 10% contado · null = hereda
}

export type SegmentacionValue = { proveedor: CondRow[]; marca: CondRow[] }
