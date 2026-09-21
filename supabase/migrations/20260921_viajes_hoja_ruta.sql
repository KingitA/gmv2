-- =====================================================================
-- Viajes → Hoja de ruta (etapa 1: base del modelo)
-- ADITIVA e IDEMPOTENTE. Lo único que modifica de datos existentes es el
-- estado de los viajes 'pendiente' / 'planificando' → 'programado'.
--
-- Ciclo de vida del viaje de reparto:
--   programado  → calendario del mes: fecha + zonas. Sin chofer, vehículo ni
--                 pedidos obligatorios. Los pedidos se van asignando en
--                 CUALQUIER estado (asignar ya no los pasa a en_viaje).
--   despachado  → oficina cerró papeles: pedidos → en_viaje, hoja de ruta fija.
--   en_curso    → el chofer inició el viaje (viajes por transporte lo saltean).
--   en_rendicion→ el chofer finalizó y declaró la rendición (se coteja en /caja).
--   completado / cancelado.
-- Los viajes de levantamiento (tipo='levantamiento') siguen usando
-- en_curso / completado.
--
--  1. vehiculos                (patente, nombre, activo)
--  2. viajes: vehiculo_id + sellos de despacho/inicio/fin + estados con CHECK
--  3. viajes_choferes          (titular + acompañantes; el acompañante opera
--                               el viaje desde su handheld contra la billetera
--                               del TITULAR)
--  4. viajes_paradas           (una fila por cliente del viaje: orden,
--                               instrucción de cobro, candado de entrega,
--                               resultado de la entrega)
--  5. viaje_zonas también para reparto (backfill desde viajes.zona_id)
-- =====================================================================

-- ─── 1. Vehículos ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehiculos (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      VARCHAR(100) NOT NULL,
  patente     VARCHAR(15),
  activo      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehiculos_patente
  ON public.vehiculos (upper(patente)) WHERE patente IS NOT NULL AND patente <> '';

-- Los vehículos que hoy están como texto libre en viajes.vehiculo
INSERT INTO public.vehiculos (nombre)
SELECT DISTINCT upper(trim(v.vehiculo))
FROM public.viajes v
WHERE coalesce(trim(v.vehiculo), '') <> ''
  AND NOT EXISTS (SELECT 1 FROM public.vehiculos x WHERE upper(x.nombre) = upper(trim(v.vehiculo)));

-- ─── 2. viajes ───────────────────────────────────────────────────────
ALTER TABLE public.viajes
  ADD COLUMN IF NOT EXISTS vehiculo_id     UUID REFERENCES public.vehiculos(id),
  ADD COLUMN IF NOT EXISTS creado_por      UUID,
  ADD COLUMN IF NOT EXISTS despachado_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS despachado_por  UUID,
  ADD COLUMN IF NOT EXISTS iniciado_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalizado_at   TIMESTAMPTZ;

UPDATE public.viajes v
SET vehiculo_id = x.id
FROM public.vehiculos x
WHERE v.vehiculo_id IS NULL
  AND coalesce(trim(v.vehiculo), '') <> ''
  AND upper(x.nombre) = upper(trim(v.vehiculo));

-- tipo_transporte: 'chofer' (dato viejo) = 'chofer_propio'
UPDATE public.viajes SET tipo_transporte = 'chofer_propio' WHERE tipo_transporte = 'chofer';

-- Estados: los viejos 'pendiente' / 'planificando' son el nuevo 'programado'
UPDATE public.viajes SET estado = 'programado'
WHERE estado IS NULL OR estado IN ('pendiente', 'planificando', 'asignado');

ALTER TABLE public.viajes ALTER COLUMN estado SET DEFAULT 'programado';
ALTER TABLE public.viajes ALTER COLUMN estado SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'viajes_estado_check') THEN
    ALTER TABLE public.viajes ADD CONSTRAINT viajes_estado_check
      CHECK (estado IN ('programado', 'despachado', 'en_curso', 'en_rendicion', 'completado', 'cancelado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'viajes_tipo_check') THEN
    ALTER TABLE public.viajes ADD CONSTRAINT viajes_tipo_check
      CHECK (tipo IN ('reparto', 'levantamiento'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_viajes_fecha_estado ON public.viajes (fecha, estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_viaje ON public.pedidos (viaje_id) WHERE viaje_id IS NOT NULL;

-- ─── 3. Choferes del viaje ───────────────────────────────────────────
-- viajes.chofer_id se mantiene = titular (lo usan las rutas /api/chofer/** y
-- la rendición). El acompañante NO tiene billetera propia dentro del viaje:
-- sus cobros y gastos van a la del titular, con creado_por = acompañante.
CREATE TABLE IF NOT EXISTS public.viajes_choferes (
  viaje_id    UUID        NOT NULL REFERENCES public.viajes(id) ON DELETE CASCADE,
  usuario_id  UUID        NOT NULL REFERENCES public.profiles(id),
  rol         VARCHAR(20) NOT NULL DEFAULT 'acompanante'
              CHECK (rol IN ('titular', 'acompanante')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (viaje_id, usuario_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_viajes_choferes_titular
  ON public.viajes_choferes (viaje_id) WHERE rol = 'titular';
CREATE INDEX IF NOT EXISTS idx_viajes_choferes_usuario ON public.viajes_choferes (usuario_id);

INSERT INTO public.viajes_choferes (viaje_id, usuario_id, rol)
SELECT v.id, v.chofer_id, 'titular'
FROM public.viajes v
WHERE v.chofer_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ─── 4. Paradas (la hoja de ruta) ────────────────────────────────────
-- Una fila por CLIENTE del viaje. Los pedidos siguen colgando de
-- pedidos.viaje_id; la parada los agrupa. Admite clientes sin pedido
-- (pasar solo a cobrar). Los importes (saldo anterior, total del viaje,
-- bultos) NO se guardan: se calculan siempre desde pedidos / comprobantes /
-- libro de cuenta corriente.
CREATE TABLE IF NOT EXISTS public.viajes_paradas (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  viaje_id               UUID        NOT NULL REFERENCES public.viajes(id) ON DELETE CASCADE,
  cliente_id             UUID        NOT NULL REFERENCES public.clientes(id),
  orden                  INTEGER     NOT NULL DEFAULT 0,
  -- Instrucción de oficina
  exigir_cobro_anterior  BOOLEAN     NOT NULL DEFAULT false,  -- cobrar sí o sí lo que debe de antes
  exigir_cobro_actual    BOOLEAN     NOT NULL DEFAULT false,  -- cobrar sí o sí lo de este viaje
  bloquear_entrega       BOOLEAN     NOT NULL DEFAULT false,  -- NO bajar mercadería sin cobrar
  motivo_bloqueo         TEXT,
  nota_oficina           TEXT,
  -- Resultado (lo carga el chofer / acompañante)
  estado                 VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente', 'entregado', 'entregado_parcial', 'no_entregado', 'solo_cobro')),
  bultos_entregados      INTEGER,
  motivo_no_entrega      TEXT,
  motivo_no_cobro        TEXT,     -- obligatorio si había exigencia de cobro y no se cumplió
  resuelto_at            TIMESTAMPTZ,
  resuelto_por           UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (viaje_id, cliente_id)
);
CREATE INDEX IF NOT EXISTS idx_viajes_paradas_viaje ON public.viajes_paradas (viaje_id, orden);

DROP TRIGGER IF EXISTS update_viajes_paradas_updated_at ON public.viajes_paradas;
CREATE TRIGGER update_viajes_paradas_updated_at
  BEFORE UPDATE ON public.viajes_paradas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill: una parada por cliente con pedidos ya asignados a un viaje de reparto
INSERT INTO public.viajes_paradas (viaje_id, cliente_id, orden)
SELECT p.viaje_id, p.cliente_id,
       row_number() OVER (PARTITION BY p.viaje_id ORDER BY min(p.prioridad) NULLS LAST, min(p.created_at))
FROM public.pedidos p
JOIN public.viajes v ON v.id = p.viaje_id AND v.tipo = 'reparto'
WHERE p.estado <> 'eliminado'
GROUP BY p.viaje_id, p.cliente_id
ON CONFLICT (viaje_id, cliente_id) DO NOTHING;

-- ─── 5. Zonas del viaje también para reparto ─────────────────────────
INSERT INTO public.viaje_zonas (viaje_id, zona_id)
SELECT v.id, v.zona_id FROM public.viajes v
WHERE v.zona_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ─── Permisos (mismo criterio que el resto de las tablas del ERP) ────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehiculos, public.viajes_choferes, public.viajes_paradas
  TO authenticated, service_role;
