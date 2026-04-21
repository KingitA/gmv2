-- Rename tipo 'plata' → 'general' in bonificaciones
ALTER TABLE bonificaciones DROP CONSTRAINT chk_tipo;
UPDATE bonificaciones SET tipo = 'general' WHERE tipo = 'plata';
ALTER TABLE bonificaciones ADD CONSTRAINT chk_tipo
  CHECK (tipo IN ('mercaderia','general','viajante'));
