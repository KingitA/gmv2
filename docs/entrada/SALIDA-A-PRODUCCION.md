# Entrada de mercadería — pasos para pasar a producción

Armado el 19/11/2026 con la base de ese día. Cada paso dice **quién** lo hace y **cómo se comprueba**.
Plan y decisiones: `docs/PRUEBA-INTEGRAL-ENTRADA.md`.

## Cómo está hoy (19/11)

| Qué | Estado |
|---|---|
| Código de las tandas 0, 1 y 2 | En main y en producción |
| Migraciones hasta `20261119k` | Aplicadas |
| Órdenes de pago de prueba | Ninguna (la única pendiente es COTY, real) |
| Datos de prueba de compras | OC-000010 a OC-000013 (HORNAL): 4 órdenes, 5 recepciones, 13 comprobantes, 7 movimientos de cuenta corriente, 17 vencimientos, 24 kardex |
| Proveedores activos | 96: 53 con CUIT completo, 16 con mail, 0 con mail para órdenes de pago, 0 con CBU |
| Mails de órdenes de compra y de pago | **Modo prueba**: salen de megasur.proveedores y llegan a juancruzrossi072 |
| Credicoop | Sin credenciales. Ninguna cuenta con `api_banco`. El simulador NO está prendido en producción |
| Pantalla de verificación | Responde en 0,4 a 1 segundo (antes de los arreglos tardaba 12 a 35 s) |

## A. Antes del corte (lo trae Juan)

1. **Excel de proveedores.** Proveedores → "Importar datos de compra (Excel)" → bajar la plantilla, completarla y subirla. Columnas clave: CUIT, mail, **mail para órdenes de pago**, CBU, acuerdo de pago, condición de Ganancias.
   *Se comprueba:* la consulta 1 de abajo da casi 96 en cada columna.
2. **Contador.** Tablas → "Retención de Ganancias": confirmar alícuotas y mínimos (2 % mercadería, 0,25 % transporte, mínimo de transporte).
3. **Credicoop (cuando lleguen las credenciales de homologación).**
   - Vercel → Settings → Environment Variables: `CREDICOOP_CLIENT_ID`, `CREDICOOP_CLAVE_PRIVADA`, `CREDICOOP_NUMERO_ADHERENTE` (sin `CREDICOOP_URL` = homologación).
   - SQL: `UPDATE cuentas_bancarias SET api_banco = 'credicoop' WHERE id = '5b3c2ba1-25cc-4ae7-8b67-3173a92005c4';`
   - Supabase → Database → Extensions: activar `pg_net`. Después: `UPDATE bancos_consulta_ajustes SET url = 'https://gmv2.vercel.app/api/cron/bancos-credicoop', secreto = '<CRON_SECRET de Vercel>';`
   - Prueba en homologación: una transferencia chica de una orden de pago de prueba, firmarla con el token y ver que la orden se confirma sola.
   - Para pasar a producción del banco: `CREDICOOP_URL` y `CREDICOOP_REALM` con los datos que dé Credicoop.

## B. El día del corte (en este orden)

1. **Revisar que no haya órdenes de pago de prueba.** Si aparece alguna en la sección 08 del PASO 1, anularla desde Órdenes de pago.
2. **Limpieza de compras de prueba:** `docs/entrada/limpieza-compras-prueba.sql`, en el editor SQL de Supabase.
   - PASO 1 (mirar): tiene que listar lo de la tabla de arriba y nada de otro proveedor.
   - PASO 2 tal cual (termina en `ROLLBACK`): corre sin error y muestra los totales.
   - Cambiar `ROLLBACK` por `COMMIT` y correrlo de nuevo.
   - Ya incluye la limpieza del kardex "en camino" (`scripts/entrada-limpieza-kardex-en-camino.sql`): no hace falta correrlo aparte.
   - **Stock:** el script no lo toca. Decisión de Juan (16/11): el stock se carga de cero desde ajustes de depósito (paso 3). El bloque opcional del final NO se usa.
   - **Costos:** los dos artículos que tocó la prueba (190114 film, 190138 aluminio) quedaron con su costo de lista menos 20 %, que es el correcto. No hay nada que devolver.
3. **Stock inicial** desde ajustes de depósito (decisión 2 de Juan).
4. **Órdenes viejas abiertas** (no son de prueba, el script no las toca): OC-000007 BUYANOR y OC-000008 DESES PLAST siguen "recibida en parte"; OC-000001 a 006 y 009 están "recibida". Finalizarlas o cancelarlas desde Órdenes de compra para que no aparezcan como pendientes en el depósito ni en Jarvis.
5. **Apagar el modo prueba de los mails.** Órdenes de compra → botón del sobre ("A dónde van los mails de las órdenes de compra") → "Apagar el modo prueba" (pide escribir la frase de confirmación). Es un solo interruptor para las órdenes de compra y las de pago.
   *Se comprueba:* en la misma ventana dice que los mails van a los proveedores y que la cuenta de Gmail de compras está conectada.
6. **App Depósito:** todos los equipos con la última versión (botón de actualizar de la app).
7. **Permisos:** solo admin hace órdenes de pago y conecta Gmail. Revisar en Usuarios que nadie más tenga admin.

## C. Primera semana (casos que no se pudieron probar sin datos reales)

- **Factura que ya estaba anotada a mano** (E-102): al validar, la pantalla tiene que mostrar el vencimiento a mano y preguntar si es esa factura. Si se elige "es esta", queda un solo vencimiento.
- **Mail de la orden de pago:** al confirmar una orden a un proveedor con mail para órdenes de pago, tiene que llegarle el PDF. Sin mail queda "cerrada sin enviar".
- **Credicoop:** la primera transferencia real, firmada con token, tiene que confirmar la orden sola.

## Consultas de control (solo lectura)

```sql
-- 1. Datos de proveedores completos
SELECT count(*) total,
       count(*) FILTER (WHERE cuit ~ '^\d{2}-\d{8}-\d$') cuit_ok,
       count(*) FILTER (WHERE coalesce(email, '') <> '') con_mail,
       count(*) FILTER (WHERE coalesce(mail_ordenes_pago, '') <> '') mail_op,
       count(*) FILTER (WHERE coalesce(cbu, '') <> '') con_cbu
  FROM proveedores WHERE activo;

-- 2. Después de la limpieza: no queda nada de prueba
SELECT numero_orden FROM ordenes_compra
 WHERE numero_orden IN ('OC-000010','OC-000011','OC-000012','OC-000013')
    OR fecha_orden >= timestamptz '2026-11-16 00:00:00-03';   -- tiene que dar 0 filas (salvo órdenes reales nuevas)
```
