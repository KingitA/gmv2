-- =====================================================================
-- Viajes → plata del viaje: fondo ("a cuenta viaje") y gastos.
-- Requiere 20260921_viajes_hoja_ruta.sql. ADITIVA e IDEMPOTENTE.
--
-- Modelo (no cambia la rendición existente):
--   billetera del TITULAR = fondo recibido + cobros − gastos.
--   Al finalizar, el chofer declara cuánto efectivo manda. Si manda todo lo
--   que tiene, el sobrante del fondo vuelve a caja; si manda solo los cobros,
--   el sobrante le queda en la billetera. rendicion_crear / rendicion_confirmar
--   ya resuelven ambos casos (saldo declarado + diferencia de conteo).
--
--  1. viajes_fondos + viaje_entregar_fondo(): la plata sale de CUALQUIER caja
--     o banco hacia la billetera del titular, en UNA transacción. Queda
--     asentado de dónde salió, quién la retiró (puede ser el acompañante) y
--     quién la entregó. /caja lo muestra como
--     "A cuenta viaje <NOMBRE> — retiró <QUIEN>".
--  2. viajes_gastos + viaje_gasto_registrar() / viaje_gasto_resolver(): el
--     chofer o acompañante declara (baja YA la billetera del titular); oficina
--     aprueba (egreso en el libro imputado al viaje) o rechaza (la plata vuelve
--     a figurar en la billetera: la debe).
--  3. Cierre: al completarse el viaje (rendicion_confirmar, u oficina a mano si
--     no hubo cobros) los pedidos toman su estado final según su parada.
-- =====================================================================

-- ─── 1. Fondo del viaje ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.viajes_fondos (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  viaje_id         UUID          NOT NULL REFERENCES public.viajes(id),
  monto            NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  origen_tipo      VARCHAR(20)   NOT NULL,
  origen_id        UUID          NOT NULL,
  titular_id       UUID          NOT NULL,   -- billetera acreditada
  retirado_por     UUID          NOT NULL,   -- quién se llevó la plata en mano
  entregado_por    UUID,                     -- usuario de oficina que la entregó
  kardex_id        UUID,
  billetera_mov_id UUID,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_viajes_fondos_viaje ON public.viajes_fondos (viaje_id);

CREATE OR REPLACE FUNCTION public.viaje_entregar_fondo(
  p_viaje_id     uuid,
  p_origen_tipo  text,
  p_origen_id    uuid,
  p_monto        numeric,
  p_retirado_por uuid,
  p_usuario_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_viaje    viajes%ROWTYPE;
  v_saldo    numeric;
  v_quien    text;
  v_concepto text;
  v_kardex   uuid;
  v_mov      uuid;
  v_fondo    uuid;
BEGIN
  SELECT * INTO v_viaje FROM viajes WHERE id = p_viaje_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'viaje_entregar_fondo: viaje no encontrado'; END IF;
  IF v_viaje.tipo <> 'reparto' OR v_viaje.tipo_transporte = 'transporte' THEN
    RAISE EXCEPTION 'viaje_entregar_fondo: solo viajes de reparto con chofer propio';
  END IF;
  IF v_viaje.estado NOT IN ('programado', 'despachado', 'en_curso') THEN
    RAISE EXCEPTION 'viaje_entregar_fondo: el viaje está %', v_viaje.estado;
  END IF;
  IF v_viaje.chofer_id IS NULL THEN
    RAISE EXCEPTION 'viaje_entregar_fondo: el viaje no tiene chofer titular';
  END IF;
  IF p_origen_tipo NOT IN ('CAJA', 'BANCO') OR p_origen_id IS NULL THEN
    RAISE EXCEPTION 'viaje_entregar_fondo: el origen debe ser una CAJA o un BANCO';
  END IF;
  IF COALESCE(p_monto, 0) <= 0 THEN
    RAISE EXCEPTION 'viaje_entregar_fondo: el monto debe ser > 0';
  END IF;
  IF p_retirado_por IS NULL OR (p_retirado_por <> v_viaje.chofer_id AND NOT EXISTS (
    SELECT 1 FROM viajes_choferes WHERE viaje_id = p_viaje_id AND usuario_id = p_retirado_por
  )) THEN
    RAISE EXCEPTION 'viaje_entregar_fondo: quien retira debe ser chofer o acompañante del viaje';
  END IF;

  SELECT saldo INTO v_saldo FROM saldos_financieros
  WHERE cuenta_tipo = p_origen_tipo::fund_account_type AND cuenta_id = p_origen_id
    AND color = 'BLANCO'::money_color
  FOR UPDATE;
  IF COALESCE(v_saldo, 0) < p_monto THEN
    RAISE EXCEPTION 'viaje_entregar_fondo: saldo insuficiente en origen (disponible %, requerido %)',
      COALESCE(v_saldo, 0), p_monto;
  END IF;

  SELECT nombre INTO v_quien FROM usuarios WHERE id = p_retirado_por;
  v_concepto := 'A cuenta viaje ' || v_viaje.nombre || ' — retiró ' || COALESCE(v_quien, 'chofer');

  v_kardex := kardex_registrar(
    p_tipo_movimiento => 'TRANSFERENCIA_INTERNA',
    p_concepto        => v_concepto,
    p_monto           => p_monto,
    p_color           => 'BLANCO',
    p_origen_tipo     => p_origen_tipo,
    p_origen_id       => p_origen_id,
    p_destino_tipo    => 'BILLETERA',
    p_destino_id      => v_viaje.chofer_id,
    p_metodo          => CASE WHEN p_origen_tipo = 'BANCO' THEN 'TRANSFERENCIA' ELSE 'EFECTIVO' END,
    p_referencia_tipo => 'viaje_fondo',
    p_referencia_id   => p_viaje_id,
    p_viaje_id        => p_viaje_id,
    p_cobrador_id     => p_retirado_por,
    p_usuario_id      => p_usuario_id,
    p_verificado      => true
  );

  -- Crédito en la billetera del titular (el trigger sincroniza su saldo)
  INSERT INTO billetera_movimientos (
    viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
  ) VALUES (
    v_viaje.chofer_id, 'credito', 'efectivo', abs(p_monto), v_concepto,
    p_viaje_id, 'viaje_fondo', now(), p_usuario_id
  ) RETURNING id INTO v_mov;

  INSERT INTO viajes_fondos (
    viaje_id, monto, origen_tipo, origen_id, titular_id, retirado_por, entregado_por, kardex_id, billetera_mov_id
  ) VALUES (
    p_viaje_id, p_monto, p_origen_tipo, p_origen_id, v_viaje.chofer_id, p_retirado_por, p_usuario_id, v_kardex, v_mov
  ) RETURNING id INTO v_fondo;

  RETURN jsonb_build_object('success', true, 'fondo_id', v_fondo, 'kardex_id', v_kardex, 'concepto', v_concepto);
END;
$function$;

-- ─── 2. Gastos del viaje ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.viajes_gastos (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  viaje_id         UUID          NOT NULL REFERENCES public.viajes(id),
  titular_id       UUID          NOT NULL,
  cargado_por      UUID          NOT NULL,
  categoria        VARCHAR(20)   NOT NULL
                   CHECK (categoria IN ('nafta', 'peon', 'hotel', 'peaje', 'comida', 'cubierta', 'otro')),
  monto            NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  observaciones    TEXT,
  foto_url         TEXT,
  estado           VARCHAR(20)   NOT NULL DEFAULT 'declarado'
                   CHECK (estado IN ('declarado', 'aprobado', 'rechazado')),
  motivo_rechazo   TEXT,
  billetera_mov_id UUID,
  kardex_id        UUID,
  revisado_por     UUID,
  revisado_at      TIMESTAMPTZ,
  idempotency_key  UUID UNIQUE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_viajes_gastos_viaje ON public.viajes_gastos (viaje_id);

CREATE OR REPLACE FUNCTION public.viaje_gasto_registrar(
  p_viaje_id      uuid,
  p_usuario_id    uuid,
  p_categoria     text,
  p_monto         numeric,
  p_observaciones text DEFAULT NULL,
  p_foto_url      text DEFAULT NULL,
  p_idempotency   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_viaje viajes%ROWTYPE;
  v_mov   uuid;
  v_gasto uuid;
BEGIN
  IF p_idempotency IS NOT NULL THEN
    SELECT id INTO v_gasto FROM viajes_gastos WHERE idempotency_key = p_idempotency;
    IF FOUND THEN RETURN jsonb_build_object('success', true, 'gasto_id', v_gasto, 'dedup', true); END IF;
  END IF;

  SELECT * INTO v_viaje FROM viajes WHERE id = p_viaje_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'viaje_gasto_registrar: viaje no encontrado'; END IF;
  IF v_viaje.estado NOT IN ('despachado', 'en_curso', 'en_rendicion') THEN
    RAISE EXCEPTION 'viaje_gasto_registrar: el viaje está %', v_viaje.estado;
  END IF;
  IF v_viaje.chofer_id IS NULL THEN RAISE EXCEPTION 'viaje_gasto_registrar: viaje sin chofer titular'; END IF;
  IF p_usuario_id <> v_viaje.chofer_id AND NOT EXISTS (
    SELECT 1 FROM viajes_choferes WHERE viaje_id = p_viaje_id AND usuario_id = p_usuario_id
  ) THEN
    RAISE EXCEPTION 'viaje_gasto_registrar: no sos chofer ni acompañante de este viaje';
  END IF;
  IF COALESCE(p_monto, 0) <= 0 THEN RAISE EXCEPTION 'viaje_gasto_registrar: el monto debe ser > 0'; END IF;

  INSERT INTO billetera_movimientos (
    viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
  ) VALUES (
    v_viaje.chofer_id, 'debito', 'efectivo', -abs(p_monto),
    'Gasto - ' || initcap(p_categoria) || COALESCE(': ' || NULLIF(trim(p_observaciones), ''), ''),
    p_viaje_id, 'viaje', now(), p_usuario_id
  ) RETURNING id INTO v_mov;

  INSERT INTO viajes_gastos (
    viaje_id, titular_id, cargado_por, categoria, monto, observaciones, foto_url, billetera_mov_id, idempotency_key
  ) VALUES (
    p_viaje_id, v_viaje.chofer_id, p_usuario_id, p_categoria, abs(p_monto),
    NULLIF(trim(p_observaciones), ''), p_foto_url, v_mov, p_idempotency
  ) RETURNING id INTO v_gasto;

  RETURN jsonb_build_object('success', true, 'gasto_id', v_gasto);
END;
$function$;

CREATE OR REPLACE FUNCTION public.viaje_gasto_resolver(
  p_gasto_id   uuid,
  p_aprobar    boolean,
  p_usuario_id uuid,
  p_motivo     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_g      viajes_gastos%ROWTYPE;
  v_nombre text;
  v_kardex uuid;
BEGIN
  SELECT * INTO v_g FROM viajes_gastos WHERE id = p_gasto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'viaje_gasto_resolver: gasto no encontrado'; END IF;
  IF v_g.estado <> 'declarado' THEN
    RAISE EXCEPTION 'viaje_gasto_resolver: el gasto ya está %', v_g.estado;
  END IF;
  SELECT nombre INTO v_nombre FROM viajes WHERE id = v_g.viaje_id;

  IF p_aprobar THEN
    -- Egreso de la empresa imputado al viaje. Origen BILLETERA: no toca saldos
    -- de caja (la billetera ya bajó al declararse el gasto).
    v_kardex := kardex_registrar(
      p_tipo_movimiento => 'EGRESO_GENERAL',
      p_concepto        => '[VIAJE ' || COALESCE(v_nombre, '') || '] ' || initcap(v_g.categoria)
                           || COALESCE(': ' || v_g.observaciones, ''),
      p_monto           => v_g.monto,
      p_color           => 'BLANCO',
      p_origen_tipo     => 'BILLETERA',
      p_origen_id       => v_g.titular_id,
      p_destino_tipo    => 'GASTO',
      p_metodo          => 'EFECTIVO',
      p_referencia_tipo => 'viaje_gasto',
      p_referencia_id   => v_g.id,
      p_viaje_id        => v_g.viaje_id,
      p_cobrador_id     => v_g.cargado_por,
      p_usuario_id      => p_usuario_id,
      p_verificado      => true
    );
    UPDATE viajes_gastos
    SET estado = 'aprobado', kardex_id = v_kardex, revisado_por = p_usuario_id, revisado_at = now()
    WHERE id = p_gasto_id;
  ELSE
    IF COALESCE(trim(p_motivo), '') = '' THEN
      RAISE EXCEPTION 'viaje_gasto_resolver: el rechazo necesita un motivo';
    END IF;
    INSERT INTO billetera_movimientos (
      viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
    ) VALUES (
      v_g.titular_id, 'credito', 'efectivo', abs(v_g.monto),
      'Gasto rechazado - ' || initcap(v_g.categoria) || ': ' || trim(p_motivo),
      v_g.id, 'viaje_gasto_rechazado', now(), p_usuario_id
    );
    UPDATE viajes_gastos
    SET estado = 'rechazado', motivo_rechazo = trim(p_motivo), revisado_por = p_usuario_id, revisado_at = now()
    WHERE id = p_gasto_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'estado', CASE WHEN p_aprobar THEN 'aprobado' ELSE 'rechazado' END);
END;
$function$;

-- ─── 3. Cierre del viaje: estado final de los pedidos ────────────────
-- Se dispara cuando el viaje pasa a 'completado' (rendicion_confirmar lo hace
-- al confirmarse la última rendición; oficina lo hace a mano si no hubo
-- cobros). Según el resultado de la parada de cada cliente:
--   entregado / entregado_parcial → pedido 'entregado'
--   no_entregado                  → vuelve a 'listo_para_enviar' y queda SIN
--                                   viaje, libre para reprogramarlo (la parada
--                                   conserva el motivo como historial).
-- Nunca bloquea el cierre de la rendición: ante un error solo avisa.
CREATE OR REPLACE FUNCTION public.viaje_cerrar_pedidos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tipo <> 'reparto' OR NEW.tipo_transporte = 'transporte' THEN
    RETURN NEW;
  END IF;
  BEGIN
    UPDATE pedidos p SET estado = 'entregado'
    FROM viajes_paradas pa
    WHERE pa.viaje_id = NEW.id AND pa.cliente_id = p.cliente_id
      AND pa.estado IN ('entregado', 'entregado_parcial')
      AND p.viaje_id = NEW.id AND p.estado = 'en_viaje';

    UPDATE pedidos p SET estado = 'listo_para_enviar', viaje_id = NULL
    FROM viajes_paradas pa
    WHERE pa.viaje_id = NEW.id AND pa.cliente_id = p.cliente_id
      AND pa.estado = 'no_entregado'
      AND p.viaje_id = NEW.id AND p.estado = 'en_viaje';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'viaje_cerrar_pedidos(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_viaje_cerrar_pedidos ON public.viajes;
CREATE TRIGGER trg_viaje_cerrar_pedidos
  AFTER UPDATE OF estado ON public.viajes
  FOR EACH ROW
  WHEN (NEW.estado = 'completado' AND OLD.estado IS DISTINCT FROM 'completado')
  EXECUTE FUNCTION public.viaje_cerrar_pedidos();

-- ─── Permisos ────────────────────────────────────────────────────────
-- Fondos y gastos se escriben SOLO por sus funciones (SECURITY DEFINER).
GRANT SELECT ON public.viajes_fondos, public.viajes_gastos TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.viaje_entregar_fondo(uuid, text, uuid, numeric, uuid, uuid),
                          public.viaje_gasto_registrar(uuid, uuid, text, numeric, text, text, uuid),
                          public.viaje_gasto_resolver(uuid, boolean, uuid, text)
  TO authenticated, service_role;
