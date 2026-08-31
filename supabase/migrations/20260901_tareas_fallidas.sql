-- ============================================================================
-- tareas_fallidas — "nada falla en silencio" (auditoría cta cte 31/08)
--
-- Los pasos accesorios del circuito de cobranzas (posteo al libro mayor,
-- post-confirmación: bonificación 10%, créditos, ajuste, comisiones) corren
-- FUERA de la transacción principal. Hasta hoy un fallo solo dejaba un aviso
-- en la respuesta y un console.error. Esta tabla persiste cada fallo con el
-- payload exacto para reintentarlo (las operaciones son idempotentes), y la
-- Caja del Día muestra un panel "Pendientes de reproceso" con botón Reintentar.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tareas_fallidas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo              text NOT NULL,          -- 'cc_postear' | 'post_confirmacion'
  referencia_tipo   text,                   -- ej. 'pago_cliente', 'comprobante_venta'
  referencia_id     uuid,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- params exactos para reintentar
  error             text,
  intentos          int NOT NULL DEFAULT 1,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  ultimo_intento_en timestamptz,
  resuelto_en       timestamptz
);

-- Una sola tarea abierta por (tipo, referencia): el insert repetido de un mismo
-- fallo hace upsert sobre este índice (incrementa intentos, pisa el error).
CREATE UNIQUE INDEX IF NOT EXISTS tareas_fallidas_pendiente_uniq
  ON public.tareas_fallidas (tipo, referencia_id) WHERE resuelto_en IS NULL;

CREATE INDEX IF NOT EXISTS tareas_fallidas_abiertas_idx
  ON public.tareas_fallidas (creado_en DESC) WHERE resuelto_en IS NULL;

ALTER TABLE public.tareas_fallidas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tareas_fallidas_auth_all" ON public.tareas_fallidas
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
