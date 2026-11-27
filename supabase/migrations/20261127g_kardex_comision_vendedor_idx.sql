-- ═══════════════════════════════════════════════════════════════════════
-- BILLETERA DEL VENDEDOR: "último intento falló" (27/11/2026)
--
-- Qué pasaba: GET /api/mobile/sync/vendedor_billetera devolvía 57014 (statement timeout)
-- varias veces por día (Vercel 27/11 13:48, 13:50, 13:51, 14:21 UTC). La sync calcula las
-- comisiones leyendo el kardex del vendedor de a páginas por id (keyset) con el cruce a
-- pedidos (sin eliminados ni sistema viejo): lib/vendedor/comisiones-vendedor.ts →
-- kardexComisionVendedor. Medido con los dos códigos de Freije (27/11):
--   - una página CON el cruce: 5,2 s en frío (el plan recorre el kardex por id y filtra);
--   - la misma SIN el cruce: 0,24 s; todas las páginas con caché caliente: 1,4 s.
-- Con la base cargada, una página fría pasa el límite de 8 s y la sync entera falla.
--
-- Qué hace: índice PARCIAL con exactamente el filtro y el orden de esa consulta
-- (vendedor_id + id, solo ventas con comisión de pedidos no eliminados). El plan pasa a
-- leer solo las filas del vendedor ya ordenadas por id.
--
-- CONCURRENTLY: no bloquea el kardex mientras se crea. Correrlo SOLO (fuera de una
-- transacción: en el editor SQL de Supabase, esta sentencia sola). IDEMPOTENTE.
-- Aplicar con OK de Juan.
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kardex_comision_vendedor_id
  ON public.kardex (vendedor_id, id)
  WHERE tipo_movimiento = 'venta'
    AND pedido_eliminado = false
    AND comision_viajante_monto IS NOT NULL
    AND comision_viajante_monto <> 0;
