# GM Chofer — CHANGELOG

Formato: una sección por versión publicada (la agrega `npm run build:apks` con el
texto de `--notas`). Más nueva arriba.

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
