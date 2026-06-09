-- No-op: clientes.percepcion_iibb ya existe (DECIMAL 5,2) desde la migración inicial.
-- La columna almacena la alícuota IIBB (%) a percibir a este cliente según padrón provincial.
-- NULL / 0 = no se percibe IIBB. Buenos Aires province: siempre 0 (no se percibe).
SELECT 1;
