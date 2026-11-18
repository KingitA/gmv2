-- ─────────────────────────────────────────────────────────────────────────────
-- Registro de renglones de comprobantes de compra tocados A MANO (18/11/2026).
-- Prueba en producción de la entrada de mercadería: ahora se puede agregar, corregir y
-- borrar un renglón de un comprobante sin validar; cada vez queda anotado quién, cuándo,
-- qué había antes y qué quedó.
--
-- Solo agrega una tabla nueva, vacía. No toca ningún dato. Se puede correr más de una vez.
-- El código funciona con o sin ella: sin la tabla el cambio se hace igual y la anotación
-- queda solo en el registro del servidor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comprobantes_compra_cambios (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id uuid        NOT NULL,
  -- el renglón puede haberse borrado: no lleva clave foránea
  detalle_id     uuid,
  accion         text        NOT NULL CHECK (accion IN ('agregar', 'editar', 'borrar')),
  antes          jsonb,
  despues        jsonb,
  usuario_id     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comprobantes_compra_cambios_comprobante
  ON public.comprobantes_compra_cambios (comprobante_id, created_at);

COMMENT ON TABLE public.comprobantes_compra_cambios IS
  'Renglones de comprobantes de compra agregados, corregidos o borrados a mano: quién, cuándo, antes y después.';

-- Solo la escribe y la lee el servidor (cliente de servicio)
ALTER TABLE public.comprobantes_compra_cambios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comprobantes_compra_cambios FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.comprobantes_compra_cambios TO service_role;
