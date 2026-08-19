-- ─────────────────────────────────────────────────────────────────────────────
-- Lista de precios AUTOMÁTICA por viajante (13/08/2026)
--
-- Regla del dueño: la lista no la elige el vendedor, es consecuencia del
-- viajante al que se asigna el cliente. Ej. Freije tiene dos viajantes:
--   · "FREIJE DANIEL LISTA NECO" → lista Neco
--   · "FREIJE DANIEL"            → lista Viajante
-- vendedores.lista_precio_id: si está seteada, todo cliente que se asigne
-- (alta o reasignación desde la app) toma esa lista y el selector no aparece.
-- NULL = el viajante no fija lista (se elige a mano si tiene permiso).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS lista_precio_id uuid NULL REFERENCES listas_precio(id);

UPDATE vendedores SET lista_precio_id = (SELECT id FROM listas_precio WHERE nombre = 'Neco' LIMIT 1)
WHERE nombre = 'FREIJE DANIEL LISTA NECO';
UPDATE vendedores SET lista_precio_id = (SELECT id FROM listas_precio WHERE nombre = 'Viajante' LIMIT 1)
WHERE nombre = 'FREIJE DANIEL';

-- Backfill: clientes de esos viajantes SIN lista (47 al 13/08: iban por
-- cálculo estándar, sin el recargo que les corresponde)
UPDATE clientes c
SET lista_precio_id = v.lista_precio_id
FROM vendedores v
WHERE c.vendedor_id = v.id
  AND v.lista_precio_id IS NOT NULL
  AND c.lista_precio_id IS NULL;

-- Control
SELECT v.nombre viajante, l.nombre lista_del_viajante,
       count(c.id) clientes,
       count(c.id) FILTER (WHERE c.lista_precio_id = v.lista_precio_id) con_la_lista_correcta
FROM vendedores v
LEFT JOIN listas_precio l ON l.id = v.lista_precio_id
LEFT JOIN clientes c ON c.vendedor_id = v.id AND c.activo
WHERE v.lista_precio_id IS NOT NULL
GROUP BY 1, 2;
