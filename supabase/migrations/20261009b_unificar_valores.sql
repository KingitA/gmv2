-- Unificar valores cargados con mayúsculas distintas (09/10/2026)
-- Verificado antes de escribirlo:
--  · Ningún cálculo depende de estas mayúsculas (tipo de factura, reportes de IVA
--    y percepciones comparan en minúsculas; el recargo por nivel ahora también).
--  · No genera historial de precios: condicion_iva, nivel_puntaje y subcategoria
--    no están entre las columnas que registra trg_precio_historial.
--  · Sí avisa a las apps (trg_mobile_cambios): los celulares bajan esos clientes
--    y artículos en la próxima sincronización.

begin;

-- Clientes: condición IVA con la forma del selector de la ficha
update public.clientes set condicion_iva = 'Responsable Inscripto'
 where condicion_iva <> 'Responsable Inscripto' and lower(trim(condicion_iva)) = 'responsable inscripto';

-- Clientes: nivel de puntaje como lo muestra la lista
update public.clientes set nivel_puntaje = 'Regular'
 where nivel_puntaje <> 'Regular' and lower(trim(nivel_puntaje)) = 'regular';

-- Subcategorías con el mismo nombre en distinta forma (están en categorías distintas):
-- se pasan a MAYÚSCULAS como su gemela. Primero la tabla, después el texto del artículo
-- (el trigger de taxonomía resuelve el mismo id: el índice único es por lower(nombre)).
update public.subcategorias set nombre = 'INSECTICIDAS AEROSOL' where id = 'cfcf3a6d-96e0-413b-a060-2d4cceace606';
update public.subcategorias set nombre = 'PERFUMANTES DE TELAS' where id = 'bc8abda8-b47d-4b5a-ad74-8a3543d86648';
update public.articulos set subcategoria = 'INSECTICIDAS AEROSOL' where subcategoria = 'Insecticidas Aerosol';
update public.articulos set subcategoria = 'PERFUMANTES DE TELAS' where subcategoria = 'Perfumantes de Telas';

commit;

-- Control (todo debería dar una sola fila por valor):
-- select condicion_iva, count(*) from clientes group by 1;
-- select nivel_puntaje, count(*) from clientes group by 1;
-- select subcategoria, count(*) from articulos where lower(subcategoria) in ('insecticidas aerosol','perfumantes de telas') group by 1;
