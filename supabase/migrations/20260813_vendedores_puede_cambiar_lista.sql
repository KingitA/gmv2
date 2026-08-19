-- Permiso por viajante para cambiar la lista de precios de sus clientes
-- desde la app de vendedores. Por defecto NADIE; se habilita a los cuatro
-- que indicó el dueño (13/08/2026). Para sumar/quitar a alguien: UPDATE del
-- flag, sin tocar código.
ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS puede_cambiar_lista boolean NOT NULL DEFAULT false;

UPDATE vendedores SET puede_cambiar_lista = true
WHERE nombre IN (
  'FREIJE DANIEL',
  'FREIJE DANIEL LISTA NECO',
  'ROSSI FABIAN',
  'ROSSI JUAN CRUZ',
  'EBERLE DANIEL'
);

-- Control
SELECT nombre, puede_cambiar_lista FROM vendedores WHERE activo ORDER BY puede_cambiar_lista DESC, nombre;
