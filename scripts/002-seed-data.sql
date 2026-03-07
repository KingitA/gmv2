-- Datos de ejemplo para proveedores
INSERT INTO proveedores (nombre, email, telefono, cuit, activo) VALUES
('Distribuidora Central', 'ventas@distcentral.com', '011-4444-5555', '20-12345678-9', true),
('Mayorista del Sur', 'info@mayoristasur.com', '011-5555-6666', '20-98765432-1', true),
('Proveedor Express', 'contacto@provexpress.com', '011-6666-7777', '20-11223344-5', true);

-- Datos de ejemplo para artículos
INSERT INTO articulos (sku, ean13, descripcion, unidad_medida, stock_actual, activo) VALUES
('000001', '7790001234567', 'TRAPO DE PISO GRIS MR. TRAPO', 'unidad', 0, true),
('000002', '7790002345678', 'LAMPAZO ALGODON 250GR', 'unidad', 0, true),
('000003', '7790003456789', 'LUSTRAMUEBLE SPRAY 360ML', 'unidad', 0, true),
('000004', '7790004567890', 'DESODORANTE AMBIENTE LAVANDA', 'unidad', 0, true),
('000005', '', 'BOLSA RESIDUO 50X60 NEGRA', 'bulto', 0, true);
