-- ============================================================
-- Módulo Vendedor: vínculo usuario de login → registros de vendedores
-- Un usuario puede tener VARIOS registros de vendedor (ej: FREIJE DANIEL
-- y FREIJE DANIEL LISTA NECO) y en el módulo ve la unión de sus clientes.
-- Aplicar copiando/pegando en el SQL Editor de Supabase.
-- ============================================================

ALTER TABLE public.vendedores
  ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES public.usuarios(id);

CREATE INDEX IF NOT EXISTS idx_vendedores_usuario_id
  ON public.vendedores(usuario_id);

-- Mapeo automático por email donde coincide (hoy solo matchea ROSSI JUAN CRUZ;
-- el resto de los vendedores no tiene usuario creado o el email difiere)
UPDATE public.vendedores v
SET usuario_id = u.id
FROM public.usuarios u
WHERE v.usuario_id IS NULL
  AND v.email IS NOT NULL
  AND lower(trim(v.email)) = lower(trim(u.email));

-- Mapeos manuales: cuando crees el usuario de cada vendedor en /admin/usuarios,
-- vinculalo así (un mismo usuario puede apuntar a varios registros de vendedor):
-- UPDATE public.vendedores SET usuario_id = (SELECT id FROM public.usuarios WHERE email = 'EMAIL_DEL_USUARIO')
--   WHERE nombre IN ('FREIJE DANIEL', 'FREIJE DANIEL LISTA NECO');

-- Verificación: estado del vínculo
SELECT v.nombre, v.email AS email_vendedor, u.email AS usuario_vinculado
FROM public.vendedores v
LEFT JOIN public.usuarios u ON u.id = v.usuario_id
WHERE v.activo
ORDER BY v.nombre;
