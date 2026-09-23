-- Historial de cambios de un viaje: quién, cuándo y qué cambió (creación,
-- fecha, duración, zonas, chofer, vehículo, estado: despacho, cancelación…).
-- Lo escribe un trigger sobre viajes; el usuario sale de actualizado_por /
-- creado_por / despachado_por (los setea la API) o de auth.uid().
-- ADITIVA e IDEMPOTENTE.
CREATE TABLE IF NOT EXISTS public.viajes_historial (
  id          BIGSERIAL    PRIMARY KEY,
  viaje_id    UUID         NOT NULL REFERENCES public.viajes(id) ON DELETE CASCADE,
  usuario_id  UUID,
  accion      VARCHAR(30)  NOT NULL,          -- creado | modificado | estado
  cambios     JSONB        NOT NULL DEFAULT '{}'::jsonb,  -- { campo: { de, a } }
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_viajes_historial_viaje ON public.viajes_historial (viaje_id, created_at);
GRANT SELECT ON public.viajes_historial TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.viajes_registrar_historial() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario uuid;
  v_cambios jsonb := '{}'::jsonb;
  v_accion  text;
BEGIN
  BEGIN
    v_usuario := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_usuario := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO viajes_historial (viaje_id, usuario_id, accion, cambios)
    VALUES (NEW.id, COALESCE(NEW.creado_por, v_usuario), 'creado',
            jsonb_build_object('fecha', NEW.fecha, 'dias', NEW.dias, 'nombre', NEW.nombre));
    RETURN NEW;
  END IF;

  IF NEW.fecha IS DISTINCT FROM OLD.fecha THEN v_cambios := v_cambios || jsonb_build_object('fecha', jsonb_build_object('de', OLD.fecha, 'a', NEW.fecha)); END IF;
  IF NEW.dias IS DISTINCT FROM OLD.dias THEN v_cambios := v_cambios || jsonb_build_object('dias', jsonb_build_object('de', OLD.dias, 'a', NEW.dias)); END IF;
  IF NEW.nombre IS DISTINCT FROM OLD.nombre THEN v_cambios := v_cambios || jsonb_build_object('nombre', jsonb_build_object('de', OLD.nombre, 'a', NEW.nombre)); END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN v_cambios := v_cambios || jsonb_build_object('estado', jsonb_build_object('de', OLD.estado, 'a', NEW.estado)); END IF;
  IF NEW.chofer_id IS DISTINCT FROM OLD.chofer_id THEN v_cambios := v_cambios || jsonb_build_object('chofer', jsonb_build_object('de', OLD.chofer, 'a', NEW.chofer)); END IF;
  IF NEW.vehiculo_id IS DISTINCT FROM OLD.vehiculo_id THEN v_cambios := v_cambios || jsonb_build_object('vehiculo_id', jsonb_build_object('de', OLD.vehiculo_id, 'a', NEW.vehiculo_id)); END IF;
  IF NEW.transporte_id IS DISTINCT FROM OLD.transporte_id THEN v_cambios := v_cambios || jsonb_build_object('transporte_id', jsonb_build_object('de', OLD.transporte_id, 'a', NEW.transporte_id)); END IF;
  IF NEW.tipo_transporte IS DISTINCT FROM OLD.tipo_transporte THEN v_cambios := v_cambios || jsonb_build_object('tipo_transporte', jsonb_build_object('de', OLD.tipo_transporte, 'a', NEW.tipo_transporte)); END IF;
  IF NEW.zona_id IS DISTINCT FROM OLD.zona_id THEN v_cambios := v_cambios || jsonb_build_object('zona_principal', jsonb_build_object('de', OLD.zona_id, 'a', NEW.zona_id)); END IF;
  IF NEW.observaciones IS DISTINCT FROM OLD.observaciones THEN v_cambios := v_cambios || jsonb_build_object('observaciones', jsonb_build_object('de', OLD.observaciones, 'a', NEW.observaciones)); END IF;

  IF v_cambios = '{}'::jsonb THEN RETURN NEW; END IF;

  v_accion := CASE WHEN v_cambios ? 'estado' THEN 'estado' ELSE 'modificado' END;
  INSERT INTO viajes_historial (viaje_id, usuario_id, accion, cambios)
  VALUES (NEW.id,
          COALESCE(
            CASE WHEN NEW.estado = 'despachado' AND OLD.estado <> 'despachado' THEN NEW.despachado_por END,
            CASE WHEN NEW.actualizado_at IS DISTINCT FROM OLD.actualizado_at THEN NEW.actualizado_por END,
            v_usuario, NEW.actualizado_por),
          v_accion, v_cambios);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_viajes_historial ON public.viajes;
CREATE TRIGGER trg_viajes_historial
  AFTER INSERT OR UPDATE ON public.viajes
  FOR EACH ROW EXECUTE FUNCTION public.viajes_registrar_historial();
