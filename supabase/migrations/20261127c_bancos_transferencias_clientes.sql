-- ════════════════════════════════════════════════════════════════════════════════════════
-- Bancos — Tanda 3: transferencias de clientes (27/11/2026)
-- Plan: docs/bancos/PLAN-BANCOS.md · Lógica: lib/bancos/transferencias/
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. clientes_pagadores: quién paga por quién (MUCHOS A MUCHOS). Una persona puede pagar por
--    varios clientes y un cliente puede tener varios pagadores. Por CUIT cuando hay.
-- 2. banco_transferencias_vinculos: qué movimiento del banco confirmó qué transferencia. UNIQUE
--    por movimiento y por renglón del cobro: nunca se usa dos veces lo mismo.
-- 3. banco_transferencias_ajustes: modo propuesta (por defecto ENCENDIDO: el sistema solo dice
--    "se confirmaría con…" y no confirma nada) y en nombre de quién confirma cuando se apaga.
-- 4. banco_transferencia_conciliar(): vincula el crédito del banco con la transferencia informada
--    y confirma el cobro por el MISMO camino que /caja (cobranza_confirmar); el resto de la
--    confirmación (comisiones, 10 % contado, billetera) lo hace el servidor como /caja.
--
-- NO cambia extracto_matchear ni cobranza_confirmar. Hasta que alguien vincule un crédito sin
-- identificar, no se toca ninguna cuenta corriente. Idempotente: se puede correr más de una vez.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Pagadores ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes_pagadores (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id                  uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  pagador_cuit                varchar(13),
  pagador_nombre              text,
  pagador_nombre_normalizado  text,
  banco                       text,
  cbu                         varchar(22),
  veces                       integer NOT NULL DEFAULT 0,
  ultimo_uso                  timestamptz,
  origen                      varchar(10) NOT NULL DEFAULT 'aprendido' CHECK (origen IN ('manual', 'aprendido')),
  creado_por                  uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK (pagador_cuit IS NOT NULL OR pagador_nombre_normalizado IS NOT NULL)
);
COMMENT ON TABLE public.clientes_pagadores IS
  'Quién paga por quién (muchos a muchos). Aprendido al confirmar una transferencia con el banco o cargado a mano. El CUIT del propio cliente cuenta como pagador sin estar acá.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_clientes_pagadores
  ON public.clientes_pagadores (cliente_id, coalesce(pagador_cuit, ''), coalesce(pagador_nombre_normalizado, ''));
CREATE INDEX IF NOT EXISTS idx_clientes_pagadores_cuit ON public.clientes_pagadores (pagador_cuit) WHERE pagador_cuit IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_pagadores_nombre ON public.clientes_pagadores (pagador_nombre_normalizado) WHERE pagador_nombre_normalizado IS NOT NULL;

DO $$
BEGIN
  IF to_regproc('public.trg_normalizar_cuit') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_normalizar_cuit ON public.clientes_pagadores;
    CREATE TRIGGER trg_normalizar_cuit
      BEFORE INSERT OR UPDATE OF pagador_cuit ON public.clientes_pagadores
      FOR EACH ROW EXECUTE FUNCTION public.trg_normalizar_cuit('pagador_cuit');
  END IF;
END $$;

ALTER TABLE public.clientes_pagadores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.clientes_pagadores FROM anon;
GRANT SELECT ON TABLE public.clientes_pagadores TO authenticated;
GRANT ALL ON TABLE public.clientes_pagadores TO service_role;
DO $$
BEGIN
  CREATE POLICY "clientes_pagadores_leer" ON public.clientes_pagadores FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. Vínculos movimiento del banco ↔ transferencia del cobro ─────────────────────────
CREATE TABLE IF NOT EXISTS public.banco_transferencias_vinculos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id    uuid NOT NULL UNIQUE REFERENCES public.banco_extractos_movimientos(id) ON DELETE CASCADE,
  pago_id          uuid NOT NULL REFERENCES public.pagos_clientes(id),
  pago_detalle_id  uuid UNIQUE REFERENCES public.pagos_detalle(id) ON DELETE SET NULL,
  cliente_id       uuid,
  -- auto = la confirmó el sistema · existente = una persona la vinculó a una transferencia informada
  -- · nuevo = crédito sin identificar: una persona eligió el cliente y se creó el cobro
  origen           varchar(10) NOT NULL CHECK (origen IN ('auto', 'existente', 'nuevo')),
  fuente           varchar(10),
  creado_por       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_btv_pago ON public.banco_transferencias_vinculos (pago_id);
COMMENT ON TABLE public.banco_transferencias_vinculos IS
  'Qué crédito del banco confirmó qué transferencia de cliente. Único por movimiento y por renglón: no se usa dos veces.';

ALTER TABLE public.banco_transferencias_vinculos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.banco_transferencias_vinculos FROM anon;
GRANT SELECT ON TABLE public.banco_transferencias_vinculos TO authenticated;
GRANT ALL ON TABLE public.banco_transferencias_vinculos TO service_role;
DO $$
BEGIN
  CREATE POLICY "btv_leer" ON public.banco_transferencias_vinculos FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. Ajustes: modo propuesta ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banco_transferencias_ajustes (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  modo_propuesta       boolean NOT NULL DEFAULT true,
  -- En nombre de quién confirma el sistema: el admin que apagó el modo propuesta
  confirma_usuario_id  uuid,
  cambiado_por         uuid,
  cambiado_at          timestamptz
);
INSERT INTO public.banco_transferencias_ajustes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.banco_transferencias_ajustes IS
  'modo_propuesta = true: el sistema solo propone ("se confirmaría con…"). En false confirma solo, en nombre de confirma_usuario_id. Se cambia desde /caja (solo admin).';

ALTER TABLE public.banco_transferencias_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.banco_transferencias_ajustes FROM anon, authenticated;
GRANT ALL ON TABLE public.banco_transferencias_ajustes TO service_role;

-- ─── 4. Vincular y confirmar ────────────────────────────────────────────────────────────
-- Todo en una transacción: si cobranza_confirmar falla, no queda ni el vínculo ni el movimiento
-- conciliado. El UNIQUE de los vínculos + el FOR UPDATE del movimiento impiden usarlo dos veces.
CREATE OR REPLACE FUNCTION public.banco_transferencia_conciliar(
  p_mov_id      uuid,
  p_pago_id     uuid,
  p_detalle_id  uuid,
  p_usuario_id  uuid,
  p_origen      text      -- auto | existente | nuevo
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov     banco_extractos_movimientos%ROWTYPE;
  v_pago    pagos_clientes%ROWTYPE;
  v_det     pagos_detalle%ROWTYPE;
  v_otros   int;
  v_res     jsonb;
  v_kardex  uuid;
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'banco_transferencia_conciliar: falta quién confirma';
  END IF;
  IF p_origen NOT IN ('auto', 'existente', 'nuevo') THEN
    RAISE EXCEPTION 'banco_transferencia_conciliar: origen % inválido', p_origen;
  END IF;

  SELECT * INTO v_mov FROM banco_extractos_movimientos WHERE id = p_mov_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento del banco no encontrado.';
  END IF;
  IF v_mov.monto <= 0 THEN
    RAISE EXCEPTION 'Ese movimiento del banco no es un crédito.';
  END IF;
  IF v_mov.estado_matching <> 'PENDIENTE' OR EXISTS (SELECT 1 FROM banco_transferencias_vinculos WHERE movimiento_id = p_mov_id) THEN
    RAISE EXCEPTION 'Ese movimiento del banco ya está vinculado o conciliado: no se usó de nuevo.';
  END IF;

  SELECT * INTO v_pago FROM pagos_clientes WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado.';
  END IF;
  IF v_pago.estado NOT IN ('pendiente', 'pendiente_rendicion') THEN
    RAISE EXCEPTION 'El cobro está % : solo se vinculan cobros pendientes.', v_pago.estado;
  END IF;

  SELECT * INTO v_det FROM pagos_detalle WHERE id = p_detalle_id AND pago_id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La transferencia no es de ese cobro.';
  END IF;
  IF v_det.tipo_pago NOT IN ('transferencia', 'deposito') THEN
    RAISE EXCEPTION 'Ese renglón del cobro no es una transferencia ni un depósito.';
  END IF;
  IF abs(round(v_det.monto, 2) - round(v_mov.monto, 2)) >= 1 THEN
    RAISE EXCEPTION 'El monto no coincide: el banco dice % y el cobro %.', v_mov.monto, v_det.monto;
  END IF;
  SELECT count(*) INTO v_otros FROM pagos_detalle WHERE pago_id = p_pago_id AND id <> p_detalle_id;
  IF v_otros > 0 THEN
    RAISE EXCEPTION 'El cobro tiene otros medios de pago: confirmalo a mano desde su fila en Caja.';
  END IF;
  IF EXISTS (SELECT 1 FROM banco_transferencias_vinculos WHERE pago_detalle_id = p_detalle_id) THEN
    RAISE EXCEPTION 'Esa transferencia ya está vinculada a otro movimiento del banco.';
  END IF;

  -- El banco manda: la plata entró a ESA cuenta, ese día
  UPDATE pagos_detalle
     SET cuenta_bancaria_id = v_mov.cuenta_bancaria_id,
         fecha_transferencia = coalesce(fecha_transferencia, v_mov.fecha)
   WHERE id = p_detalle_id;

  INSERT INTO banco_transferencias_vinculos (movimiento_id, pago_id, pago_detalle_id, cliente_id, origen, fuente, creado_por)
  VALUES (p_mov_id, p_pago_id, p_detalle_id, v_pago.cliente_id, p_origen, v_mov.fuente_detalle, p_usuario_id);

  -- La misma confirmación que /caja
  v_res := cobranza_confirmar(p_pago_id, p_usuario_id);

  SELECT k.id INTO v_kardex
    FROM kardex_contable k
   WHERE k.pago_id = p_pago_id AND k.referencia_tipo = 'pago_cliente'
     AND k.kardex_reversa_de IS NULL
   ORDER BY (k.destino_tipo = 'BANCO' AND k.destino_id = v_mov.cuenta_bancaria_id) DESC, k.created_at
   LIMIT 1;

  UPDATE banco_extractos_movimientos
     SET estado_matching = 'CONCILIADO', pago_id = p_pago_id, kardex_id = v_kardex,
         matcheado_por = p_usuario_id, matcheado_at = now()
   WHERE id = p_mov_id;

  -- El banco es la segunda firma: verificado por conciliación, con la fuente del movimiento
  UPDATE pagos_clientes
     SET verificado_por = coalesce(verificado_por, p_usuario_id),
         verificado_at = coalesce(verificado_at, now()),
         verificacion_metodo = 'conciliacion',
         verificacion_fuente = coalesce(v_mov.fuente_detalle, 'extracto')
   WHERE id = p_pago_id;
  UPDATE kardex_contable
     SET verificado = true, verificado_por = coalesce(verificado_por, p_usuario_id), verificado_at = coalesce(verificado_at, now())
   WHERE pago_id = p_pago_id AND verificado = false;

  RETURN v_res || jsonb_build_object('kardex_id', v_kardex, 'movimiento_id', p_mov_id);
END;
$$;

REVOKE ALL ON FUNCTION public.banco_transferencia_conciliar(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.banco_transferencia_conciliar(uuid, uuid, uuid, uuid, text) TO service_role;

-- Probar (sin tocar nada):
--   SELECT * FROM public.banco_transferencias_ajustes;          -- modo_propuesta = true
--   SELECT count(*) FROM public.clientes_pagadores;
