-- P2-18 (2ª prueba integral de salida) — "Soltar pedido" en la app Depósito.
--
-- Cuando un operario abre un pedido para prepararlo, el pedido pasa a "en_preparacion"
-- y se pierde de dónde venía ("pendiente" o "impreso"). Para que "Soltar pedido" lo
-- devuelva a la cola TAL CUAL estaba, el servidor guarda acá el estado de antes en el
-- momento de abrirlo (lib/deposito/picking.ts → pasarAEnPreparacion).
--
-- Solo agrega una columna que puede quedar vacía: no cambia ningún dato existente.
-- Se puede correr dos veces sin problema.
-- Mientras no se aplique, la app anda igual: soltar un pedido lo deja en "pendiente".

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS estado_antes_preparacion TEXT;

COMMENT ON COLUMN public.pedidos.estado_antes_preparacion IS
  'Estado del pedido (pendiente / impreso) cuando el depósito lo abrió para preparar. Lo usa "Soltar pedido" (app Depósito, P2-18) para devolverlo a la cola como estaba.';

-- Para que la API vea la columna nueva sin reiniciar
NOTIFY pgrst, 'reload schema';
