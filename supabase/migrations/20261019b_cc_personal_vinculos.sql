-- ═══════════════════════════════════════════════════════════════════════
-- CUENTAS DEL PERSONAL · Vínculos iniciales (19/10/2026, confirmados por el dueño)
--
-- Marca como cuenta del personal y vincula cada cuenta de cliente con su
-- usuario del sistema y sus códigos de vendedor (adonde entran las comisiones).
-- Cada UPDATE exige número de cliente Y nombre: si alguno no coincide, no se
-- aplica (no hay riesgo de vincular la cuenta equivocada).
-- No toca saldos ni movimientos. IDEMPOTENTE.
-- PEREYRA HORACIO ya no trabaja con la empresa (dueño, 19/10): su código de
-- vendedor queda inactivo (no tiene clientes asignados).
-- GABRIEL AMAN: cliente 8, renombrado por el dueño a "AMAN GABRIEL (EMPLEADO)" el 19/10.
-- ═══════════════════════════════════════════════════════════════════════

-- Cuentas (EMPLEADO)/(VIAJANTE)/(VENDEDOR)/(SOCIO)/(EMPLEADA) y las de la familia
UPDATE public.clientes SET es_empleado = true
WHERE (codigo_cliente, upper(nombre)) IN (
  ('1003', 'EBERLE DANIEL (SOCIO)'),
  ('900',  'FEDERICO EBERLE (VENDEDOR)'),
  ('1710', 'KARINA LAUMANN (EMPLEADA)'),
  ('613',  'LOPEZ LUIS (VENDEDOR)'),
  ('1002', 'ROSSI FABIAN (SOCIO)'),
  ('194',  'ROSSI JUAN CRUZ'),
  ('200',  'ROSSI PIA'),
  ('8',    'AMAN GABRIEL (EMPLEADO)')
);

-- Usuario dueño de cada cuenta
UPDATE public.clientes c SET empleado_usuario_id = v.usuario
FROM (VALUES
  ('115',  'FREIJE DANIEL (VIAJANTE)',          'f6df2b69-71a4-4166-b63d-91dff086ef6f'::uuid),  -- FREIJE
  ('1003', 'EBERLE DANIEL (SOCIO)',             'bcfcb6a1-9f30-441a-8baa-044a351e40c3'::uuid),  -- EBERLE
  ('1710', 'KARINA LAUMANN (EMPLEADA)',         '419e383f-3cdb-4b4f-89fc-c2882c80f3a3'::uuid),  -- LAUMANN
  ('1002', 'ROSSI FABIAN (SOCIO)',              '157b461c-97d0-44d0-88be-7f405c93f58e'::uuid),  -- FABIAN
  ('194',  'ROSSI JUAN CRUZ',                   'd6ac25bb-8204-474d-9e3c-12c2807ac2b7'::uuid),  -- Juan Cruz
  ('200',  'ROSSI PIA',                         'd604c7f7-4985-407f-8a8e-110a0ab64a60'::uuid),  -- PIA
  ('7',    'ORDIALES RODRIGO (EMPLEADO)',       '6c447a30-77e6-4e66-b685-0a5ede0ec721'::uuid),  -- RODRIGO
  ('867',  'GARRIDO SERGIO GABRIEL (EMPLEADO)', 'd3246204-b76f-4524-98aa-44483d2f3c63'::uuid),  -- SERGIO
  ('8',    'AMAN GABRIEL (EMPLEADO)',           'bde8ec47-ff80-49e8-bcd2-9f6fd06a9efd'::uuid)   -- GABRIEL
) AS v(codigo, nombre, usuario)
WHERE c.codigo_cliente = v.codigo AND upper(c.nombre) = v.nombre
  AND c.empleado_usuario_id IS DISTINCT FROM v.usuario
  AND NOT EXISTS (SELECT 1 FROM public.clientes o WHERE o.empleado_usuario_id = v.usuario AND o.id <> c.id);

-- Códigos de vendedor → cuenta donde entran sus comisiones
UPDATE public.vendedores ve SET cuenta_cliente_id = c.id
FROM (VALUES
  ('65f69dfe-e563-4eb6-9119-073969d96f98'::uuid, '115',  'FREIJE DANIEL (VIAJANTE)'),        -- FREIJE DANIEL
  ('d7f2ec52-2ded-48f6-8802-5d5802beda22'::uuid, '115',  'FREIJE DANIEL (VIAJANTE)'),        -- FREIJE DANIEL LISTA NECO
  ('c63ed924-c270-4a5a-9564-96e641bfdf2f'::uuid, '95',   'SILVA MARIO OMAR (VIAJANTE)'),     -- SILVA MARIO
  ('22e85498-b174-4e92-ac93-2d2586dd21b8'::uuid, '916',  'GUERRA LUIS ALBERTO (VIAJANTE)'),  -- GUERRA LUIS
  ('ad2ab202-702d-4ff2-8a41-6ca5b2f0db90'::uuid, '916',  'GUERRA LUIS ALBERTO (VIAJANTE)'),  -- GUERRA LUIS MDP
  ('3df28acd-5927-4cdb-aa09-697f8a0d3e6e'::uuid, '613',  'LOPEZ LUIS (VENDEDOR)'),           -- LOPEZ LUIS
  ('049e5f24-0fda-4f47-b315-dff340a8cd36'::uuid, '1003', 'EBERLE DANIEL (SOCIO)'),           -- EBERLE DANIEL
  ('45cdb1b4-f944-4836-a931-4398536bbe95'::uuid, '900',  'FEDERICO EBERLE (VENDEDOR)'),      -- EBERLE FEDERICO
  ('021eb984-cfbd-4164-a6f5-370a6bf95684'::uuid, '900',  'FEDERICO EBERLE (VENDEDOR)'),      -- EBERLE FEDERICO NECO
  ('81451a23-5c93-444f-a8d5-7a32eea50bd7'::uuid, '1710', 'KARINA LAUMANN (EMPLEADA)'),       -- LAUMANN KARINA
  ('afb261e8-7071-42c5-9121-7e332bc0fb0a'::uuid, '1002', 'ROSSI FABIAN (SOCIO)'),            -- ROSSI FABIAN
  ('8146a51a-b423-4a0f-b207-2b78341e1b91'::uuid, '194',  'ROSSI JUAN CRUZ'),                 -- ROSSI JUAN CRUZ
  ('e511f729-2bad-4cef-a7b1-9116ce53422b'::uuid, '200',  'ROSSI PIA')                        -- ROSSI PIA
) AS v(vendedor_id, codigo, nombre)
JOIN public.clientes c ON c.codigo_cliente = v.codigo AND upper(c.nombre) = v.nombre
WHERE ve.id = v.vendedor_id
  AND ve.cuenta_cliente_id IS DISTINCT FROM c.id;

-- PEREYRA HORACIO: código de vendedor inactivo (sin clientes asignados)
UPDATE public.vendedores SET activo = false
WHERE id = '8541c650-558c-4f64-9e42-a21401587f20' AND nombre = 'PEREYRA HORACIO' AND activo;

-- Verificación (correr a mano): las 13 cuentas con su usuario y sus códigos
--   SELECT c.codigo_cliente, c.nombre, c.es_empleado, c.empleado_usuario_id,
--          (SELECT string_agg(v.nombre, ', ') FROM vendedores v WHERE v.cuenta_cliente_id = c.id) AS codigos
--   FROM clientes c WHERE c.es_empleado ORDER BY c.nombre;
