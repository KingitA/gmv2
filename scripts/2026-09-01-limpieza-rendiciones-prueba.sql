-- ============================================================================
-- Limpieza de rendiciones "en viaje" fantasma (datos de prueba)
--
-- Auditoría 31/08: el vendedor ve rendiciones viejas "En viaje" (ej. una de
-- $13,2M del 19/8 cuyos pagos después se rechazaron) que la oficina ya no
-- puede procesar. Este script cancela las rendiciones ABIERTAS que no tienen
-- ningún pago vigente (pendiente / pendiente_rendicion) — incluidas las que
-- quedaron sin items.
--
-- USO: correr primero el BLOQUE 1 (preview) en el SQL Editor y revisar la
-- lista; si está bien, correr el BLOQUE 2 (update). Correr DESPUÉS de aplicar
-- las migraciones 20260901_* y el deploy (así el vendedor ya las ve como
-- "Cancelada" y no "En viaje").
-- ============================================================================

-- ── BLOQUE 1: preview — qué se va a cancelar ──
SELECT r.id, r.fecha, r.cobrador_tipo, r.efectivo_declarado, r.estado,
       (SELECT count(*) FROM rendicion_items ri WHERE ri.rendicion_id = r.id) AS items,
       (SELECT count(*)
        FROM rendicion_items ri
        JOIN pagos_clientes p ON p.id = ri.pago_id
        WHERE ri.rendicion_id = r.id
          AND p.estado IN ('pendiente', 'pendiente_rendicion')) AS pagos_vigentes
FROM rendiciones r
WHERE r.estado = 'abierta'
  AND NOT EXISTS (
    SELECT 1
    FROM rendicion_items ri
    JOIN pagos_clientes p ON p.id = ri.pago_id
    WHERE ri.rendicion_id = r.id
      AND p.estado IN ('pendiente', 'pendiente_rendicion')
  )
ORDER BY r.fecha;

-- ── BLOQUE 2: cancelar (correr solo después de revisar el preview) ──
-- UPDATE rendiciones r
-- SET estado = 'cancelada',
--     observaciones = COALESCE(observaciones, '') || ' [auto-cancelada: sin pagos vigentes — limpieza 2026-09-01]'
-- WHERE r.estado = 'abierta'
--   AND NOT EXISTS (
--     SELECT 1
--     FROM rendicion_items ri
--     JOIN pagos_clientes p ON p.id = ri.pago_id
--     WHERE ri.rendicion_id = r.id
--       AND p.estado IN ('pendiente', 'pendiente_rendicion')
--   );
