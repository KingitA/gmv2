-- Habilitar Realtime en la tabla pedidos para notificaciones de urgentes
-- Ejecutar en Supabase SQL Editor
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
