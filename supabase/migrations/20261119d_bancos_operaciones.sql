-- ─────────────────────────────────────────────────────────────────────────────
-- Tanda 2-A — Bancos: operaciones enviadas a Credicoop para firmar (19/11/2026)
--
-- Decisión de Juan: «emisión de echeqs, confirmación y realizar transferencias y pagos de VEPs
-- y servicios siempre lo hacemos desde Credicoop» / «Siempre, desde el banco que sea vamos a
-- tener que confirmar vía token.»
--
-- El sistema arma la operación (transferencia, e-cheq, endoso de e-cheq, pago de VEP) y la manda
-- a Credicoop en la modalidad "con firma": queda en Banca Internet Empresa esperando que una
-- persona la firme con su token. Esta tabla es el registro de cada una de esas operaciones.
--
-- NO cambia ningún dato existente: crea una tabla, agrega columnas vacías y pone tres guardias
-- (disparadores) sobre las órdenes de pago, que solo actúan cuando la orden tiene una operación
-- con el banco real. Se puede correr las veces que haga falta. No toca vencimientos, cuenta
-- corriente, caja ni stock. Requiere aplicada la 20261117p (usa fmt_moneda).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bancos_operaciones (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banco                  text NOT NULL DEFAULT 'credicoop',
  -- simulador = no salió hacia ningún banco (pruebas de pantalla) · homologacion = banco de pruebas
  ambiente               text NOT NULL CHECK (ambiente IN ('simulador', 'homologacion', 'produccion')),
  tipo                   text NOT NULL CHECK (tipo IN ('transferencia', 'echeq_emision', 'echeq_endoso', 'vep')),

  -- Clave de idempotencia ante el banco (idOrigen, hasta 36 caracteres). Se genera y se GUARDA
  -- antes de enviar: si se corta la comunicación, con ella se consulta si la operación entró.
  id_origen              varchar(36) NOT NULL UNIQUE,
  id_operacion_banco     text,                 -- número de operación que devuelve el banco

  -- preparada        guardada, todavía no salió hacia el banco
  -- enviada_a_firma  el banco la tiene esperando la firma con token
  -- en_proceso       aceptada por el banco pero sin terminar (en procesamiento, retenida…)
  -- firmada          el banco la procesó: la plata salió / el e-cheq se emitió / el VEP se pagó
  -- rechazada        el banco la rechazó, o no llegó a salir (el motivo dice cuál)
  -- error            NO se sabe si entró (corte de comunicación): hay que actualizar el estado
  -- acreditada       además se vio el movimiento en la cuenta
  estado                 text NOT NULL DEFAULT 'preparada'
                         CHECK (estado IN ('preparada', 'enviada_a_firma', 'en_proceso', 'firmada', 'rechazada', 'error', 'acreditada')),
  estado_banco           text,                 -- el texto de estado tal como lo dijo el banco
  motivo                 text,                 -- por qué se rechazó o qué falló

  cuenta_bancaria_id     uuid REFERENCES public.cuentas_bancarias(id),
  orden_pago_id          uuid REFERENCES public.ordenes_pago(id) ON DELETE SET NULL,
  orden_pago_numero      text,                 -- número de la orden, copiado: queda aunque la orden se elimine
  orden_pago_detalle_id  uuid,                 -- el medio de pago de la orden (ordenes_pago_detalle.id)
  cheque_id              uuid,                 -- e-cheq de tercero que se endosa (cheques.id)
  proveedor_id           uuid REFERENCES public.proveedores(id),
  vencimiento_ids        uuid[] NOT NULL DEFAULT '{}',   -- vencimientos relacionados (solo referencia: no se tocan)

  beneficiario_nombre    text,
  beneficiario_cuit      text,
  beneficiario_cbu       text,
  monto                  numeric(14,2) NOT NULL CHECK (monto > 0),
  fecha_pago             date,                 -- transferencia / VEP: el día del envío · e-cheq: su fecha de pago
  numero_vep             text,
  id_cheque_banco        text,                 -- identificador del e-cheq en el banco (emitido o endosado)

  pedido                 jsonb,                -- lo que se le mandó al banco (sin credenciales)
  respuesta              jsonb,                -- lo último que contestó el banco

  creado_por             uuid,
  creado_at              timestamptz NOT NULL DEFAULT now(),
  enviado_at             timestamptz,
  actualizado_por        uuid,
  actualizado_at         timestamptz NOT NULL DEFAULT now(),
  firmado_at             timestamptz,          -- cuándo se supo que el banco la procesó
  acreditado_at          timestamptz,
  acreditado_por         uuid,
  -- Destrabe a mano: un admin la marcó rechazada después de verificarlo en Banca Internet Empresa
  rechazo_manual_por     uuid,
  rechazo_manual_at      timestamptz
);

-- Por si la tabla ya se había creado con la primera versión de esta migración
ALTER TABLE public.bancos_operaciones
  ADD COLUMN IF NOT EXISTS orden_pago_numero  text,
  ADD COLUMN IF NOT EXISTS rechazo_manual_por uuid,
  ADD COLUMN IF NOT EXISTS rechazo_manual_at  timestamptz;
ALTER TABLE public.bancos_operaciones DROP CONSTRAINT IF EXISTS bancos_operaciones_orden_pago_id_fkey;
ALTER TABLE public.bancos_operaciones
  ADD CONSTRAINT bancos_operaciones_orden_pago_id_fkey FOREIGN KEY (orden_pago_id) REFERENCES public.ordenes_pago(id) ON DELETE SET NULL;

COMMENT ON TABLE public.bancos_operaciones IS
  'Operaciones mandadas a un banco para firmar con token (Credicoop API Empresas, modalidad con firma). Registro: no se borra.';

-- Una sola operación VIVA por medio de pago, por e-cheq a endosar y por VEP: evita el doble
-- envío aunque dos personas toquen el botón a la vez. Una rechazada no cuenta (se puede reintentar,
-- con otro id_origen). Una en "error" SÍ cuenta: primero hay que saber si entró.
CREATE UNIQUE INDEX IF NOT EXISTS bancos_operaciones_viva_por_detalle
  ON public.bancos_operaciones (orden_pago_detalle_id)
  WHERE orden_pago_detalle_id IS NOT NULL AND estado <> 'rechazada';
CREATE UNIQUE INDEX IF NOT EXISTS bancos_operaciones_viva_por_cheque
  ON public.bancos_operaciones (cheque_id)
  WHERE cheque_id IS NOT NULL AND tipo = 'echeq_endoso' AND estado <> 'rechazada';
CREATE UNIQUE INDEX IF NOT EXISTS bancos_operaciones_viva_por_vep
  ON public.bancos_operaciones (numero_vep)
  WHERE numero_vep IS NOT NULL AND tipo = 'vep' AND estado <> 'rechazada';
CREATE INDEX IF NOT EXISTS bancos_operaciones_por_orden ON public.bancos_operaciones (orden_pago_id) WHERE orden_pago_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bancos_operaciones_abiertas ON public.bancos_operaciones (estado, creado_at DESC);

-- Solo el servidor (mueve plata: lo usan únicamente las rutas de admin)
ALTER TABLE public.bancos_operaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bancos_operaciones FROM anon, authenticated;
GRANT ALL ON TABLE public.bancos_operaciones TO service_role;

-- Una operación no se borra nunca (es el registro de lo que se le mandó al banco)
CREATE OR REPLACE FUNCTION public.bancos_operaciones_no_borrar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Las operaciones bancarias no se borran: son el registro de lo que se mandó al banco.';
END;
$$;
DROP TRIGGER IF EXISTS trg_bancos_operaciones_no_borrar ON public.bancos_operaciones;
CREATE TRIGGER trg_bancos_operaciones_no_borrar
  BEFORE DELETE ON public.bancos_operaciones
  FOR EACH ROW EXECUTE PROCEDURE public.bancos_operaciones_no_borrar();   -- (PROCEDURE: vale en todas las versiones de Postgres)

-- Cuentas bancarias: cuál se opera por la API y su número de cuenta en el banco (para pedir los
-- movimientos). El CBU ya existe (cuentas_bancarias.cbu).
ALTER TABLE public.cuentas_bancarias
  ADD COLUMN IF NOT EXISTS api_banco            text,
  ADD COLUMN IF NOT EXISTS numero_cuenta_banco  text;
COMMENT ON COLUMN public.cuentas_bancarias.api_banco IS
  'Banco con el que esta cuenta opera por API (hoy solo ''credicoop''). Vacío = no se manda nada por API desde esta cuenta, aunque el nombre del banco diga Credicoop: se habilita solo poniendo este valor.';
COMMENT ON COLUMN public.cuentas_bancarias.numero_cuenta_banco IS
  'Número de cuenta tal como lo informa el banco por API (para pedir los movimientos). Se completa solo la primera vez, buscándolo por el CBU.';
DO $$
BEGIN
  ALTER TABLE public.cuentas_bancarias
    ADD CONSTRAINT cuentas_bancarias_api_banco_check CHECK (api_banco IS NULL OR api_banco IN ('credicoop'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Cheques: identificadores del e-cheq en el sistema bancario (para poder endosarlo por API)
ALTER TABLE public.cheques
  ADD COLUMN IF NOT EXISTS echeq_id  text,
  ADD COLUMN IF NOT EXISTS cmc7      text;
COMMENT ON COLUMN public.cheques.echeq_id IS 'Identificador del e-cheq que le pone el sistema bancario (Coelsa). Se completa al traerlo del banco.';
COMMENT ON COLUMN public.cheques.cmc7 IS 'CMC7 del cheque (29 dígitos): banco, sucursal, código postal, número de cheque y cuenta.';

-- ═════════════════════ Bloqueos: el banco y la orden de pago no se pisan ═════════════════════
-- (revisión del 19/11) Las reglas van en la BASE, no solo en la pantalla, para que valgan por
-- cualquier camino (confirmar, confirmar ajustando la retención, cancelar, eliminar) y aunque dos
-- personas toquen a la vez.
--
-- SOLO cuentan las operaciones del banco REAL (ambiente = 'produccion'). Lo mandado al simulador
-- o al banco de prueba no bloquea ni habilita nada: no es plata.
--
--   · CONFIRMAR una orden como pagada: si un medio de pago de la orden tiene operaciones con el
--     banco, la ÚLTIMA tiene que estar hecha (firmada / acreditada) y por el MISMO importe.
--     Esperando la firma, en proceso o en duda → no se confirma. Rechazada → ese pago no salió:
--     hay que volver a mandarlo, o eliminar la orden y armarla con otra forma de pago.
--   · CANCELAR o ELIMINAR una orden: no se puede con una operación viva (si después la firman
--     con token en Banca Internet Empresa, la plata sale igual: pago doble) ni con una ya hecha.
--   · El IMPORTE de un medio de pago que ya se mandó al banco no se cambia (pasa cuando la
--     retención de Ganancias cambió entre que se armó la orden y el día de confirmar, E-57).
--   · MANDAR al banco solo un pago de una orden PENDIENTE; al guardar la operación se toma la
--     fila de la orden (FOR UPDATE), así mandar y confirmar no pueden cruzarse.

/** Por qué NO se puede hacer p_accion ('confirmar' | 'cancelar' | 'eliminar') con la orden. NULL = se puede. */
CREATE OR REPLACE FUNCTION public.bancos_bloqueo_orden(p_op_id uuid, p_accion text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF p_accion = 'confirmar' THEN
    FOR r IN
      SELECT DISTINCT ON (o.orden_pago_detalle_id) o.estado, o.monto, o.tipo, d.monto AS monto_detalle
      FROM bancos_operaciones o
      LEFT JOIN ordenes_pago_detalle d ON d.id = o.orden_pago_detalle_id
      WHERE o.orden_pago_id = p_op_id AND o.ambiente = 'produccion' AND o.orden_pago_detalle_id IS NOT NULL
      ORDER BY o.orden_pago_detalle_id, o.creado_at DESC
    LOOP
      IF r.estado = 'rechazada' THEN
        RETURN format('El banco rechazó el pago de %s que se había mandado a Credicoop: ese pago no salió. Volvé a mandarlo desde el botón de Credicoop de la orden, o eliminá la orden y armala de nuevo con otra forma de pago.', fmt_moneda(r.monto));
      ELSIF r.estado NOT IN ('firmada', 'acreditada') THEN
        RETURN format('Esta orden tiene un pago de %s mandado a Credicoop que todavía no está procesado (%s). Tocá “Actualizar estado” en el botón de Credicoop de la orden: se puede confirmar cuando el banco diga que quedó hecho.',
          fmt_moneda(r.monto), CASE r.estado WHEN 'error' THEN 'no se sabe si entró' WHEN 'enviada_a_firma' THEN 'falta la firma con token' ELSE 'el banco no terminó' END);
      ELSIF r.monto_detalle IS NOT NULL AND abs(r.monto_detalle - r.monto) > 0.005 THEN
        RETURN format('El banco procesó un pago de %s, pero en la orden ese pago figura por %s. No se confirma así: avisá a sistemas.', fmt_moneda(r.monto), fmt_moneda(r.monto_detalle));
      END IF;
    END LOOP;
    RETURN NULL;
  END IF;

  -- cancelar / eliminar
  SELECT o.estado, o.monto INTO r
  FROM bancos_operaciones o
  WHERE o.orden_pago_id = p_op_id AND o.ambiente = 'produccion' AND o.estado <> 'rechazada'
  ORDER BY (o.estado IN ('firmada', 'acreditada')) DESC, o.creado_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.estado IN ('firmada', 'acreditada') THEN
    RETURN format('El banco ya procesó un pago de %s de esta orden: la plata salió. No se puede %s. Confirmá la orden; si después hay que deshacer el pago, se anula.',
      fmt_moneda(r.monto), CASE WHEN p_accion = 'eliminar' THEN 'eliminar' ELSE 'cancelar' END);
  END IF;
  RETURN format('Esta orden tiene un pago de %s mandado a Credicoop que todavía se puede firmar con token. Si se %s la orden y después lo firman, la plata sale igual. Primero rechazá esa operación en Banca Internet Empresa y tocá “Actualizar estado” en el botón de Credicoop de la orden.',
    fmt_moneda(r.monto), CASE WHEN p_accion = 'eliminar' THEN 'elimina' ELSE 'cancela' END);
END;
$$;
REVOKE ALL ON FUNCTION public.bancos_bloqueo_orden(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bancos_bloqueo_orden(uuid, text) TO service_role;

-- La orden: confirmar, cancelar, eliminar
CREATE OR REPLACE FUNCTION public.bancos_orden_guardia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_msg text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_msg := public.bancos_bloqueo_orden(OLD.id, 'eliminar');
    IF v_msg IS NOT NULL THEN RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.estado = 'pagada' AND OLD.estado IS DISTINCT FROM 'pagada' THEN
    v_msg := public.bancos_bloqueo_orden(NEW.id, 'confirmar');
  ELSIF NEW.estado = 'cancelada' AND OLD.estado IS DISTINCT FROM 'cancelada' THEN
    v_msg := public.bancos_bloqueo_orden(NEW.id, 'cancelar');
  END IF;
  IF v_msg IS NOT NULL THEN RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bancos_orden_guardia ON public.ordenes_pago;
CREATE TRIGGER trg_bancos_orden_guardia
  BEFORE UPDATE OF estado OR DELETE ON public.ordenes_pago
  FOR EACH ROW EXECUTE PROCEDURE public.bancos_orden_guardia();

-- El medio de pago: su importe no cambia si ya se mandó al banco real
CREATE OR REPLACE FUNCTION public.bancos_detalle_guardia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_monto numeric;
BEGIN
  IF NEW.monto IS DISTINCT FROM OLD.monto THEN
    SELECT o.monto INTO v_monto FROM bancos_operaciones o
     WHERE o.orden_pago_detalle_id = OLD.id AND o.ambiente = 'produccion' AND o.estado <> 'rechazada'
     ORDER BY o.creado_at DESC LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Este pago ya se mandó a Credicoop por % y no se puede cambiar a %. Si la retención de Ganancias cambió desde que se armó la orden, no se puede ajustar sobre un pago que el banco ya tiene: rechazá esa operación en Banca Internet Empresa, actualizá su estado y volvé a mandarla, o eliminá la orden y armala de nuevo.',
        fmt_moneda(v_monto), fmt_moneda(NEW.monto) USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bancos_detalle_guardia ON public.ordenes_pago_detalle;
CREATE TRIGGER trg_bancos_detalle_guardia
  BEFORE UPDATE OF monto ON public.ordenes_pago_detalle
  FOR EACH ROW EXECUTE PROCEDURE public.bancos_detalle_guardia();

-- La operación: solo de una orden pendiente y por el importe del medio de pago. Toma la fila de
-- la orden (FOR UPDATE): mandar al banco y confirmar la orden esperan uno al otro.
CREATE OR REPLACE FUNCTION public.bancos_operacion_alta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_op record;
  v_monto numeric;
BEGIN
  IF NEW.orden_pago_id IS NULL THEN RETURN NEW; END IF;
  SELECT estado, numero_op INTO v_op FROM ordenes_pago WHERE id = NEW.orden_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden de pago ya no existe.' USING ERRCODE = 'P0001';
  END IF;
  IF v_op.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La orden % está %: solo se manda al banco un pago de una orden pendiente. No se mandó nada.', v_op.numero_op, v_op.estado USING ERRCODE = 'P0001';
  END IF;
  IF NEW.orden_pago_detalle_id IS NOT NULL THEN
    SELECT monto INTO v_monto FROM ordenes_pago_detalle WHERE id = NEW.orden_pago_detalle_id AND orden_pago_id = NEW.orden_pago_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ese medio de pago ya no es de la orden %. No se mandó nada.', v_op.numero_op USING ERRCODE = 'P0001';
    END IF;
    IF abs(v_monto - NEW.monto) > 0.005 THEN
      RAISE EXCEPTION 'El importe del pago cambió (ahora es %): volvé a abrir la ventana de Credicoop. No se mandó nada.', fmt_moneda(v_monto) USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.orden_pago_numero := v_op.numero_op;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bancos_operacion_alta ON public.bancos_operaciones;
CREATE TRIGGER trg_bancos_operacion_alta
  BEFORE INSERT ON public.bancos_operaciones
  FOR EACH ROW EXECUTE PROCEDURE public.bancos_operacion_alta();

-- Comprobaciones (solo lectura), después de aplicar:
--   select count(*) from public.bancos_operaciones;                                   -- 0
--   select id, nombre, banco, cbu, api_banco from public.cuentas_bancarias order by nombre;
-- Para habilitar una cuenta de Credicoop (lo hace sistemas con el OK de Juan, una sola vez):
--   update public.cuentas_bancarias set api_banco = 'credicoop' where id = '<id de la cuenta>';
