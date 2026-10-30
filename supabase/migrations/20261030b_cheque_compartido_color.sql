-- P2-36 (2ª prueba, parte servidor — cuentas corrientes, 30/10/2026): un cheque
-- compartido entre varios clientes queda con color PENDIENTE aunque sus piezas
-- tengan color.
--
-- Qué pasa: el papel único (lib/cobranzas/cheque-compartido.ts) nace PENDIENTE si
-- nadie eligió color; cada pieza (pagos_detalle de cada cliente) toma el suyo de
-- su imputación (>50 % a PRES ⇒ NEGRO). Al confirmar, cobranza_confirmar no crea
-- el cheque (ya existe) ni le pasa el color, y resolverColorPendientes solo
-- actúa si la PIEZA está pendiente. Visto: Provincia n.º 126, $657.726,52
-- (PRUEBA 4 + PRUEBA 5): piezas NEGRO, papel PENDIENTE.
--
-- Arreglo: al confirmarse un pago, cada cheque PENDIENTE al que apuntan sus
-- piezas toma el color de sus piezas con color (misma regla que la imputación:
-- NEGRO si lo negro es más de la mitad del importe, si no BLANCO). Sirve para
-- Caja y para la rendición (las dos pasan el pago a 'confirmado'). Relleno para
-- los que ya están. No toca los cheques que ya tienen color.
--
-- NO APLICADA. Idempotente.

-- ── 1. Color de un cheque según sus piezas ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.cheque_color_de_piezas(p_cheque_id uuid)
RETURNS money_color
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN COALESCE(SUM(monto) FILTER (WHERE color_cheque = 'NEGRO'), 0)
         > COALESCE(SUM(monto) FILTER (WHERE color_cheque = 'BLANCO'), 0) THEN 'NEGRO'::money_color
    WHEN COUNT(*) > 0 THEN 'BLANCO'::money_color
  END
  FROM pagos_detalle
  WHERE cheque_id = p_cheque_id
    AND color_cheque IN ('BLANCO', 'NEGRO')
$fn$;

-- ── 2. Al confirmarse un pago, sus cheques pendientes toman color ───────────
CREATE OR REPLACE FUNCTION public.cheque_color_al_confirmar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE cheques ch
  SET color = cheque_color_de_piezas(ch.id)
  WHERE ch.id IN (SELECT cheque_id FROM pagos_detalle WHERE pago_id = NEW.id AND cheque_id IS NOT NULL)
    AND ch.color = 'PENDIENTE'
    AND cheque_color_de_piezas(ch.id) IS NOT NULL;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cheque_color_al_confirmar ON public.pagos_clientes;
CREATE TRIGGER trg_cheque_color_al_confirmar
  AFTER UPDATE OF estado ON public.pagos_clientes
  FOR EACH ROW
  WHEN (NEW.estado = 'confirmado' AND OLD.estado IS DISTINCT FROM 'confirmado')
  EXECUTE FUNCTION public.cheque_color_al_confirmar();

-- ── 3. Relleno: cheques PENDIENTES con piezas de pagos ya confirmados ───────
UPDATE public.cheques ch
SET color = public.cheque_color_de_piezas(ch.id)
WHERE ch.color = 'PENDIENTE'
  AND public.cheque_color_de_piezas(ch.id) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.pagos_detalle pd
    JOIN public.pagos_clientes p ON p.id = pd.pago_id AND p.estado = 'confirmado'
    WHERE pd.cheque_id = ch.id
  );

-- ── Verificación: tiene que dar 0 filas ──
SELECT ch.id, ch.banco, ch.numero, ch.monto, ch.color
FROM public.cheques ch
WHERE ch.color = 'PENDIENTE'
  AND EXISTS (
    SELECT 1 FROM public.pagos_detalle pd
    JOIN public.pagos_clientes p ON p.id = pd.pago_id AND p.estado = 'confirmado'
    WHERE pd.cheque_id = ch.id AND pd.color_cheque IN ('BLANCO', 'NEGRO')
  );
