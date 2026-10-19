# Pendientes de las apps (vendedor · chofer · depósito) — traspaso 19/10/2026

Documento único para los agentes de las APK. Junta lo que quedó repartido entre `MOBILE.md`, `docs/CUENTAS-CORRIENTES-APPS.md`, `docs/FORMATOS.md`, las notas de cada sesión y el estado real de la base. El estado general del sistema está en [`docs/ESTADO-CONSOLIDADO.md`](ESTADO-CONSOLIDADO.md).

## Antes de empezar (todas las apps)

1. **Partí de `main` actualizado** (`git fetch` + rama nueva desde `origin/main`). Todas las ramas viejas (`apk-vendedor`, `apk-chofer`, `apk-deposito`, `formatos`, `cuentas-corrientes-auditoria`, …) ya están mergeadas: no sigas trabajando sobre ellas sin traer `main` primero.
2. Leé `MOBILE.md` §0, §5, §8, §14, **§20 (formatos)** y **§21 (saldo, fuente única)**, y `docs/CUENTAS-CORRIENTES-APPS.md` entero. Este documento dice *qué* falta; esos dicen *cómo*.
3. El servidor ya está en producción con todo lo de abajo. Las APK instaladas siguen andando (todo es retrocompatible), pero muestran números o reglas viejas hasta que se publique la APK nueva.
4. `npm run typecheck:movil` en verde antes de cada commit, `cd mobile && npm test` en verde, y `npm run build:apks -- --apps <app> --notas "..."` para publicar (MOBILE.md §13).
5. Nunca push a `main` sin OK explícito del dueño. Pruebas contra producción: solo datos TEST-…, con foto antes/después; nada que emita comprobantes con CAE.
6. Al terminar, **actualizá este documento** (tachá lo hecho, con fecha y versión) y el CHANGELOG de la app, en el mismo commit.

## Versiones instaladas hoy

| App | APK instalada | Fecha | Cambios del servidor que todavía no tiene |
|---|---|---|---|
| Vendedor | v0.3.1 (versionCode 8) | 14/10 | Cuentas corrientes etapas 1 a 3 |
| Chofer | v0.2.2 (versionCode 5) | 01/10 | Cobro contado 07/10, formatos §20, cuentas corrientes etapas 1 a 3, devoluciones a valor |
| Depósito | v0.2.3 (versionCode 6) | 22/09 | Formatos §20, mercadería por cupo, revisión de devoluciones por renglón |

---

## App Vendedor → próxima versión v0.4.0

**Ya está en el código de `main` (solo falta compilar):** saldo proyectado como número principal en lista, filtro "con deuda", encabezado del pedido, viajes y estadísticas; overlay de devolución sin enviar y de cobro anulado sin enviar (CUENTAS-CORRIENTES-APPS.md, "App Vendedor").

**Falta hacer:**
1. **10 % contado con la regla del 07/10** en `Cobrar.tsx` y `comprobantes-ui.tsx`: la NC es el 10 % del **total** de cada comprobante, una sola vez, aunque el pago sea parcial. Hoy la app estima con la regla vieja y en un pago parcial pide cobrar de más (el excedente queda a cuenta). Validar también `dtos_hechos`.
2. Pestaña Resumen: no esconder la fila del proyectado cuando el único cobro en calle es uno sin enviar (`comprobantes-ui.tsx:77,131`).
3. **Billetera en dos cajitas** (etapa 3): "Plata de la empresa en tu mano" (`balance` en efectivo + `cheques_cantidad` como cantidad, nunca monto) y "Tu cuenta" (`cuenta_personal.a_favor`, comisiones ganadas, retiros). `cuenta_personal: null` = no vinculada → cálculo viejo.
4. **Pantalla de retiro**: `POST /api/vendedor/retiro { monto, observaciones?, idempotency_key }`. Offline: operación de outbox nueva (p. ej. `retiro.registrar`) con handler que llame a `registrarRetiro` (`lib/cuenta-corriente/retiro.ts`); en el overlay el retiro baja `balance` y `a_favor`. Errores: `409 SIN_CUENTA_PERSONAL` ("pedile a la oficina que la vincule"), `422 RETIRO_SUPERA_EFECTIVO`.
5. Pestaña Comisiones: "Para retirar" = `disponible` (puede ser negativo); "Sin cobrar" sigue siendo estimación.
6. Pendiente de precios (semana del 13/10, confirmar con el dueño si sigue vigente o ya lo cubrió la v0.3.x): descuento general, condiciones por proveedor/marca, contado al tomar el pedido, elegir artículos de mercadería por cupo, regla "sin precio base, sin precio" en `calculator.ts`. Ver MOBILE.md §10 "Sesión Precios y descuentos".
7. Coordinar con el arreglo de servidor **"un cheque = un papel"** (abajo): el cobro a varios clientes no debe partir el cheque.

## App Chofer → próxima versión v0.3.0

**Ya está en el código de `main` (solo falta compilar):** saldo de la parada con una sola fórmula (`saldoDeParada`), hoja de ruta viva durante el viaje, `chofer_clientes` con `saldo_proyectado`, overlay de devolución sin enviar, formatos §20 en las pantallas que tocó la sesión de formatos.

**Falta hacer:**
1. **Riesgo de cobro doble**: `SelectorCuenta` / `cargarCuentaCobro` no reciben lo que ya está "en cobro" (cobros pendientes del vendedor o de otro viaje sobre el mismo comprobante). Agregar `en_cobro` desde el servidor, igual que `lib/vendedor/ficha-cliente.ts`, y descontarlo en la app.
2. "Neto a cobrar" de la ficha (`Cliente.tsx`) y `resumenCuenta` (`cuenta-cobro.ts:83`): usar `valor_cobro` de la devolución, no `monto_total` bruto.
3. **10 % contado con la regla del 07/10** (`datos/cuenta-cobro.ts:73-79`): igual que vendedor.
4. **Formatos §20**: revisar que todas las pantallas usen `@gm/formato` y `MontoInput` / `FechaInput` / `CuitInput`, con el aviso de CUIT repetido. MOBILE.md §20 dice "falta chofer".
5. Billetera (etapa 3): "Plata del viaje" como hoy + "Tu cuenta" (`saldo_cuenta_corriente` / `cuenta_personal`). El chofer no tiene comisiones.
6. Correctivo del primer batch (01/10): **un cheque = un papel** (ver servidor, abajo). La app tiene que mostrar un solo cheque aunque cubra a varios clientes.
7. Menores anotados en la pasada final (MOBILE.md §19): lo cobrado se ve duplicado 2–10 s al sincronizar un cobro conjunto; la cabecera `cobranzas` queda `pendiente` con todos sus pagos anulados; el "debe" del buscador de clientes no se refresca; un rechazo de negocio reintenta 3 veces.

## App Depósito → próxima versión v0.3.0 (con OK del dueño)

1. **Revisión de devoluciones por renglón**: aceptar/rechazar, cantidad aceptada, vendible o no, motivo, igual que la web (`app/deposito/devoluciones`). Operación de outbox nueva (p. ej. `devolucion.revisar` con `renglones`) que llame a `revisarDevolucion` (`lib/deposito/devoluciones.ts`). Mantener `devolucion.recibir` para APK viejas. `409` = devolución ya resuelta: tratar como hecha, no reintentar. Contrato completo en CUENTAS-CORRIENTES-APPS.md, "App Depósito".
2. **Formatos §20** (fecha, moneda, cantidades) con `@gm/formato`.
3. **Mercadería por cupo**: la app muestra la estimación vieja (`calcularBonificados`); pasar a `calcularBonificadosPorCupo` para que coincida con el servidor (que es el que manda).
4. Pedidos de empleados (cuenta personal) no aparecen en la cola de preparación: lo filtra el servidor, solo verificar.
5. Pendientes del mes de prueba (MOBILE.md §17): pantalla de fotos de recepción con documentos reales, devoluciones con el flujo real del chofer, gestos con el dedo, lista chica con el teclado abierto en Buscar, "⇪ N sin enviar" partido en dos líneas.
6. **Base de datos**: la migración `20260827_picking_preparadores.sql` **no está aplicada** en producción. El código de picking supone el índice `ux_picking_items_renglon` ("Ya lo preparó X"). Avisarle al dueño antes de probar picking concurrente; el control previo está en ESTADO-CONSOLIDADO.md §3.

---

## Servidor — arreglos que afectan a las apps (los hace quien tenga el OK)

| # | Arreglo | Apps | Detalle |
|---|---|---|---|
| 1 | **Un cheque = un papel** | Chofer y vendedor | `lib/cobranzas/cobro-conjunto.ts` (`repartirMetodos`, sufijo " (2)") y `app/api/viajante/cobro/route.ts` crean un cheque por cliente. Debe quedar UNA fila en cartera por el total y el reparto en imputaciones/detalles. Pedido obligatorio del dueño (01/10). |
| 2 | `en_cobro` en la cuenta de cobro del chofer | Chofer | Ver chofer, punto 1. |
| 3 | Cheques de cobros pendientes nacen EN_CARTERA; `cobranza_anular` anula un cheque compartido para todos | Chofer y vendedor | Reportado en la auditoría (AUDITORIA-CUENTAS-CORRIENTES.md #15), confirmar antes de tocar. |
| 4 | Pantalla admin de `mobile_dispositivos` (revocar equipo) y `mobile_alertas_integridad` | Las 3 | MOBILE.md §10. |

## Lo que NO hay que rehacer (ya está resuelto)

- Foto de cheques + OCR + BCRA en vendedor: va desde v0.3.0.
- Bug de `cobranza_anular` que anulaba el 10 % de otro pago: corregido en la v7 (01/10).
- Migraciones de las apps (`20260918`, `20260919`, `20260921`), formatos, códigos, en_revisión y cuentas corrientes 1 a 3: **aplicadas**.
- La rama local `apk-deposito` con "CAJA: sobrante en el cobro": ya está en `main` (8c7d3f1).
