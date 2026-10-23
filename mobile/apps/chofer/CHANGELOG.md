# GM Chofer — CHANGELOG

Formato: una sección por versión publicada (la agrega `npm run build:apks` con el
texto de `--notas`). Más nueva arriba.

## v0.3.2 (versionCode 8) — 2026-10-23

- Devoluciones tal cual fue facturado: lo del pedido entra con el precio neto de SU factura (bloqueado), con IVA, percepciones e IIBB vigente, menos el 10% si fue contado; el mismo valor en la ficha, el cobro y la nota de crédito. La rendición propone solo el efectivo que todavía tenés.

## v0.3.1 (versionCode 7) — 2026-10-21

- Borrador del cobro (si la app se cierra con la cámara abierta no se pierde lo cargado), el pedido de este viaje primero y lo anterior plegado, $0 / A favor en vez de guiones, la ficha explica el saldo (cobros sin confirmar y devoluciones de otros viajes), la devolución muestra lo que vale para el cliente, el sobrante se confirma siempre, alerta de viajes sin rendir

## v0.3.0 (versionCode 6) — 2026-10-21

- Cuentas corrientes: billetera en dos cajitas (Plata del viaje / Tu cuenta), 10% contado con la regla del 07/10 (10% del total, una vez, también en pago parcial), devoluciones descontadas por su valor, saldo del cliente con fuente única y lo ya en cobro por el vendedor reservado; el cobro sincronizado no se ve dos veces; importes con formato argentino en gasto y rendición

## v0.2.2 (versionCode 5) — 2026-10-01

- Cobro conjunto: un mismo pago (por ejemplo un cheque) cubre a varios clientes, cada uno con su cuenta completa; ficha con varios pedidos del mismo cliente; hora de los cobros corregida

## v0.2.1 (versionCode 4) — 2026-09-29

- Correcciones de la revisión del dueño: cobrar cierra la parada (el cobro parcial también; anular no la reabre), 10% contado solo a lo seleccionado, el sobrante nunca rebota, devolución desde el pedido, cheque duplicado con mensaje claro, fechas dd/mm/aaaa, la X siempre quita un cheque

## v0.2.0 (versionCode 3) — 2026-09-23

- App Chofer completa: viaje descargado al equipo, cobros/devoluciones/gastos/cierre sin señal (se envían solos al volver la red), foto de cheques con lectura en segundo plano y aviso BCRA

## v0.1.1 (versionCode 2) — 2026-09-18

- Fix: la sesión guardada no se restauraba en arranque en frío sin red (prefijo del almacén seguro); lectura del Keystore con reintentos

## v0.1.0 (versionCode 1) — 2026-09-18

- Esqueleto de validación de la fundación móvil
