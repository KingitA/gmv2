-- ─────────────────────────────────────────────────────────────────────────────
-- Recepción de mercadería: permitir estado_linea = 'faltante'.
--
-- La regla original (scripts/036-smart-reception-schema.sql, julio 2026) solo
-- acepta 'pendiente', 'ok', 'diferencia_cantidad' y 'no_pedido'. Todo el código
-- actual (web /deposito/recibir-mercaderia, APK Depósito, lib/deposito/recepciones.ts
-- → estadoLineaRecepcion) escribe 'faltante' al marcar un artículo que no llegó,
-- y la base lo rechazaba siempre (error 23514):
--   · web: "Marcar faltante" decía "Marcado como faltante" pero no se guardaba nada;
--   · APK: la operación quedaba reintentando para siempre y trababa la cola.
-- Encontrado el 20/10/2026 en los logs de Vercel. En toda la tabla había 0 líneas
-- 'faltante'.
--
-- Es un SUPERCONJUNTO de los valores anteriores: ninguna fila existente puede
-- violar la regla nueva. Se puede correr más de una vez.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE recepciones_items DROP CONSTRAINT IF EXISTS recepciones_items_estado_linea_check;

ALTER TABLE recepciones_items
  ADD CONSTRAINT recepciones_items_estado_linea_check
  CHECK (estado_linea IN ('pendiente', 'ok', 'faltante', 'diferencia_cantidad', 'no_pedido'));
