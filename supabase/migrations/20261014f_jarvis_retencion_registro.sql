-- ═══════════════════════════════════════════════════════════════════════
-- JARVIS · Retener / liberar entregas SIEMPRE queda en la bitácora.
--
-- Hasta acá lo anotaba el programa (agenda de Jarvis o botón "Liberar").
-- Con este trigger lo anota la BASE: venga de donde venga el cambio (Jarvis,
-- otra pantalla futura, un script, el SQL Editor), queda quién y cuándo.
-- Quién = retener_por (al retener) o actualizado_por (al liberar); si nadie
-- lo dejó, queda vacío y se ve como "sin usuario" en el historial.
--
-- ADITIVA e IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.clientes_registrar_retencion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.retener_entregas IS DISTINCT FROM OLD.retener_entregas THEN
    INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
    VALUES (
      CASE WHEN NEW.retener_entregas THEN COALESCE(NEW.retener_por, NEW.actualizado_por) ELSE NEW.actualizado_por END,
      CASE WHEN NEW.retener_entregas THEN 'cliente_retenido' ELSE 'cliente_liberado' END,
      'cliente', NEW.id::text,
      jsonb_build_object(
        'titulo', CASE WHEN NEW.retener_entregas THEN 'Retener entregas a ' ELSE 'Liberar entregas a ' END || COALESCE(NEW.nombre, ''),
        'nota', CASE WHEN NEW.retener_entregas THEN NEW.retener_motivo ELSE 'Tenía: ' || COALESCE(OLD.retener_motivo, '—') END,
        'entidad', jsonb_build_object('tipo', 'cliente', 'id', NEW.id)));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_clientes_registrar_retencion ON public.clientes;
CREATE TRIGGER trg_clientes_registrar_retencion
  AFTER UPDATE OF retener_entregas ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.clientes_registrar_retencion();
