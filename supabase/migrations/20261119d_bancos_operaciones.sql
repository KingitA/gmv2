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
-- NO cambia ningún dato existente: crea una tabla y agrega columnas vacías. Se puede correr las
-- veces que haga falta. No toca vencimientos, cuenta corriente, caja ni stock.
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
  orden_pago_id          uuid REFERENCES public.ordenes_pago(id),
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
  acreditado_por         uuid
);

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
  'Banco con el que esta cuenta opera por API (hoy solo ''credicoop''). Vacío = no se manda nada por API desde esta cuenta.';
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

-- Comprobaciones (solo lectura), después de aplicar:
--   select count(*) from public.bancos_operaciones;                                   -- 0
--   select id, nombre, banco, cbu, api_banco from public.cuentas_bancarias order by nombre;
-- Para habilitar una cuenta de Credicoop (lo hace sistemas con el OK de Juan, una sola vez):
--   update public.cuentas_bancarias set api_banco = 'credicoop' where id = '<id de la cuenta>';
