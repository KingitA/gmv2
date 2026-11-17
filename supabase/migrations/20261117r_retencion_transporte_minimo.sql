-- ═════════════════════════════════════════════════════════════════════════════
-- Retención de Ganancias — régimen TRANSPORTE: mínimo no sujeto $67.170
-- Prueba integral de ENTRADA, E-59. Decisión de Juan (17/11/2026), textual:
--   «Sí, estás en lo correcto, el mínimo es de 67.170».
--
-- La tabla se cargó con 6.700 (un cero de menos). Se corrige con el mecanismo de
-- vigencias: la fila vieja queda como historia (cerrada el 31/10/2026) y se agrega una
-- nueva vigente desde el 01/11/2026 con mínimo 67.170. La alícuota (0,25 % inscripto),
-- la retención mínima y los códigos de SICORE se copian de la fila vieja, sin tocarlos.
--
-- NO toca mercadería ('bienes': 224.000, 2 %) ni servicios. NO recalcula órdenes de
-- pago ya confirmadas: vale para lo que se confirme desde que se aplique.
-- Independiente de 20261117p_ordenes_pago_t1d.sql. Seguro de re-ejecutar.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c_desde  CONSTANT date := DATE '2026-11-01';
  c_minimo CONSTANT numeric := 67170.00;
  v_actual retencion_regimenes%ROWTYPE;
  v_nueva  retencion_regimenes%ROWTYPE;
BEGIN
  -- ¿Ya está la fila nueva? (re-ejecución): solo se asegura el mínimo
  SELECT * INTO v_nueva FROM retencion_regimenes WHERE clave = 'transporte' AND vigencia_desde = c_desde;
  IF FOUND THEN
    IF v_nueva.minimo_no_sujeto IS DISTINCT FROM c_minimo THEN
      UPDATE retencion_regimenes SET minimo_no_sujeto = c_minimo WHERE id = v_nueva.id;
      RAISE NOTICE 'Transporte desde %: mínimo no sujeto corregido de % a %.', c_desde, v_nueva.minimo_no_sujeto, c_minimo;
    ELSE
      RAISE NOTICE 'Transporte desde %: ya estaba con mínimo %. Nada que hacer.', c_desde, c_minimo;
    END IF;
    RETURN;
  END IF;

  -- Fila vigente hoy del régimen de transporte (la que no tiene fin)
  SELECT * INTO v_actual FROM retencion_regimenes
   WHERE clave = 'transporte' AND vigencia_hasta IS NULL
   ORDER BY vigencia_desde DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay un régimen de retención "transporte" vigente en retencion_regimenes. No se cambió nada.';
  END IF;
  IF v_actual.vigencia_desde >= c_desde THEN
    RAISE EXCEPTION 'El régimen "transporte" vigente rige desde % (posterior al %): alguien ya lo cambió. Revisarlo desde Ajustes → Retención de Ganancias. No se cambió nada.',
      to_char(v_actual.vigencia_desde, 'DD/MM/YYYY'), to_char(c_desde, 'DD/MM/YYYY');
  END IF;
  IF v_actual.alicuota_inscripto IS DISTINCT FROM 0.25 THEN
    RAISE WARNING 'OJO: la alícuota de transporte para inscriptos está en % (se esperaba 0,25 %%). Se copia tal cual: revisarla desde Ajustes → Retención de Ganancias.', v_actual.alicuota_inscripto;
  END IF;

  -- Primero la fila nueva, después se cierra la vieja (queda como historia)
  INSERT INTO retencion_regimenes (
    clave, descripcion, codigo_impuesto_txt, codigo_regimen_txt,
    alicuota_inscripto, alicuota_no_inscripto, minimo_no_sujeto, retencion_minima,
    vigencia_desde, vigencia_hasta
  ) VALUES (
    v_actual.clave, v_actual.descripcion, v_actual.codigo_impuesto_txt, v_actual.codigo_regimen_txt,
    v_actual.alicuota_inscripto, v_actual.alicuota_no_inscripto, c_minimo, v_actual.retencion_minima,
    c_desde, NULL
  );
  UPDATE retencion_regimenes SET vigencia_hasta = c_desde - 1 WHERE id = v_actual.id;

  RAISE NOTICE 'Transporte: mínimo no sujeto % → % desde el %. Alícuota inscripto % %% (sin cambios). La fila anterior quedó cerrada el %.',
    v_actual.minimo_no_sujeto, c_minimo, to_char(c_desde, 'DD/MM/YYYY'), v_actual.alicuota_inscripto, to_char(c_desde - 1, 'DD/MM/YYYY');
END $$;

-- Control (solo lectura): tiene que haber una fila de transporte desde el 01/11/2026 con
-- mínimo 67170 y alícuota 0,25, y la anterior cerrada el 31/10/2026.
-- select clave, alicuota_inscripto, minimo_no_sujeto, retencion_minima, vigencia_desde, vigencia_hasta
--   from retencion_regimenes order by clave, vigencia_desde;
