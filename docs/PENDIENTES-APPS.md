# Pendientes de las apps (vendedor · chofer · depósito) — traspaso 19/10/2026

Documento único para los agentes de las APK. Junta lo que quedó repartido entre `MOBILE.md`, `docs/CUENTAS-CORRIENTES-APPS.md`, `docs/FORMATOS.md`, las notas de cada sesión y el estado real de la base. El estado general del sistema está en [`docs/ESTADO-CONSOLIDADO.md`](ESTADO-CONSOLIDADO.md).

## Antes de empezar (todas las apps)

1. **Partí de `main` actualizado** (`git fetch` + rama nueva desde `origin/main`). Todas las ramas viejas (`apk-vendedor`, `apk-chofer`, `apk-deposito`, `formatos`, `cuentas-corrientes-auditoria`, …) ya están mergeadas: no sigas trabajando sobre ellas sin traer `main` primero.
2. Leé `MOBILE.md` §0, §5, §8, §14, **§20 (formatos)** y **§21 (saldo, fuente única)**, y `docs/CUENTAS-CORRIENTES-APPS.md` entero. Este documento dice *qué* falta; esos dicen *cómo*.
3. El servidor ya está en producción con todo lo de abajo. Las APK instaladas siguen andando (todo es retrocompatible), pero muestran números o reglas viejas hasta que se publique la APK nueva.
4. `npm run typecheck:movil` en verde antes de cada commit, `cd mobile && npm test` en verde, y `npm run build:apks -- --apps <app> --notas "..."` para publicar (MOBILE.md §13).
5. Nunca push a `main` sin OK explícito del dueño. Pruebas contra producción: solo datos TEST-…, con foto antes/después; nada que emita comprobantes con CAE.
6. Al terminar, **actualizá este documento** (tachá lo hecho, con fecha y versión) y el CHANGELOG de la app, en el mismo commit.

## Quién hace qué (tablero — leer ANTES de empezar cualquier tarea)

Regla del dueño (20/10): cada agente trabaja en su propia rama o carpeta (worktree); NO todos en la misma rama, porque se pisarían los cambios a medio hacer. Para no hacer dos veces lo mismo:

1. **Antes de empezar** una tarea: `git fetch` y mirar `origin/main`. Si la tarea está en la tabla de abajo con otro dueño, **no la toques**: coordiná a través del dueño (Juan).
2. **Al tomar** una tarea: anotala acá en la tabla, con tu nombre (área) y "en curso", y subí ese cambio a `main` **antes** de programar. Es un cambio de documentación solo: no necesita el OK del dueño.
3. **Al terminar**: pasala a "hecho" con la fecha y el commit, en el mismo commit del trabajo.
4. **Límites por área.** El servidor de cobros, cheques, cuentas corrientes, comisiones y billeteras (`lib/cobranzas`, `lib/cuenta-corriente`, `lib/comisiones`, `app/api/viajante/cobro`, `app/api/chofer/viaje/*/cobro`, migraciones de esos temas) es de **cuentas corrientes**. Las pantallas de cada APK (`mobile/apps/<app>`) son del agente de esa app. Si una app necesita algo del servidor de cobros, lo pide; no lo cambia.

| Tarea | Área dueña | Estado |
|---|---|---|
| Un cheque = un papel (servidor) | Cuentas corrientes | Hecho 20/10 (20ac463), migración 20261020b aplicada |
| `en_cobro` del chofer (servidor) | Cuentas corrientes | Hecho 20/10 (20ac463) |
| Cheques en verificación / anular cheque compartido | Cuentas corrientes | Hecho 20/10 (20ac463) |
| Puesta a cero y apertura | Cuentas corrientes | Instalado; se ejecuta el día del corte |
| App Vendedor v0.4.0 (dos cajitas, retiro, 10 % contado, Resumen) | App Vendedor | Pendiente |
| App Chofer v0.3.0 (Tu cuenta, valor de devolución, 10 % contado, formatos, verificar en_cobro y cheque único) | App Chofer | Pendiente |
| App Depósito v0.3.0 (devolución por renglón, formatos, mercadería por cupo) | App Depósito | Pendiente (con OK del dueño) |

## Versiones instaladas hoy

| App | APK instalada | Fecha | Cambios del servidor que todavía no tiene |
|---|---|---|---|
| Vendedor | v0.4.0 (versionCode 9) | 20/10 | — |
| Chofer | v0.2.2 (versionCode 5) | 01/10 | Cobro contado 07/10, formatos §20, cuentas corrientes etapas 1 a 3, devoluciones a valor |
| Depósito | v0.2.3 (versionCode 6) | 22/09 | Formatos §20, mercadería por cupo, revisión de devoluciones por renglón |

---

## App Vendedor → v0.4.0 HECHA (20/10/2026, instalada en el NuStar)

Todo lo que estaba pendiente quedó en la v0.4.0 (detalle en MOBILE.md §18, "v0.4.0"): 10 % contado con la regla del 07/10, fila del proyectado en Resumen, devolución sin enviar valuada como el servidor, billetera en dos cajitas, pantalla de retiro (`retiro.registrar`), "Para retirar" en Comisiones, y los precios pendientes del 06/10 (descuento general y contado por pedido, condiciones por proveedor/marca, mercadería por cupo eligiendo artículos, "sin precio base, sin precio" también en el servidor). Un cheque = un papel: verificado, la app no lo duplica sin señal.

**Queda para probar en la calle:** un retiro real con la cuenta personal vinculada, y un pedido con cupo de mercadería hasta el picking.

## App Chofer → próxima versión v0.3.0

**Ya está en el código de `main` (solo falta compilar):** saldo de la parada con una sola fórmula (`saldoDeParada`), hoja de ruta viva durante el viaje, `chofer_clientes` con `saldo_proyectado`, overlay de devolución sin enviar, formatos §20 en las pantallas que tocó la sesión de formatos.

**Falta hacer:**
1. ~~Riesgo de cobro doble~~ **Resuelto en el servidor (20/10):** `cargarCuentaCobro` ya manda `en_cobro` por comprobante y la app ya lo descuenta (`saldoCobrable`). Solo hay que verificarlo en el equipo con un comprobante que el vendedor tenga en cobro.
2. "Neto a cobrar" de la ficha (`Cliente.tsx`) y `resumenCuenta` (`cuenta-cobro.ts:83`): usar `valor_cobro` de la devolución, no `monto_total` bruto.
3. **10 % contado con la regla del 07/10** (`datos/cuenta-cobro.ts:73-79`): igual que vendedor.
4. **Formatos §20**: revisar que todas las pantallas usen `@gm/formato` y `MontoInput` / `FechaInput` / `CuitInput`, con el aviso de CUIT repetido. MOBILE.md §20 dice "falta chofer".
5. Billetera (etapa 3): "Plata del viaje" como hoy + "Tu cuenta" (`saldo_cuenta_corriente` / `cuenta_personal`). El chofer no tiene comisiones.
6. **Un cheque = un papel**: el servidor ya deja una sola fila (20/10) y `cheques_cantidad` de la hoja y de la billetera cuenta el cheque una vez. En la app hay que verificar que el overlay sin señal no lo muestre dos veces. `repartirMetodos` todavía agrega el sufijo " (2)" a las piezas locales; el servidor lo saca al vincularlas.
7. Menores anotados en la pasada final (MOBILE.md §19): lo cobrado se ve duplicado 2–10 s al sincronizar un cobro conjunto; el "debe" del buscador de clientes no se refresca; un rechazo de negocio reintenta 3 veces. (La cabecera `cobranzas` que quedaba `pendiente` con todos sus pagos anulados ya la resuelve el servidor desde el 20/10.)

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
| 1 | ~~Un cheque = un papel~~ **Hecho 20/10** | Chofer y vendedor | `lib/cobranzas/cheque-compartido.ts`: una fila en cartera por el total, cada cliente vinculado. Si rebota, la ND va entera a quien lo entregó. Migración `20261020b_cheques_un_papel.sql`. |
| 2 | ~~`en_cobro` en la cuenta de cobro del chofer~~ **Hecho 20/10** | Chofer | `lib/cobranzas/en-cobro.ts` (fórmula única con el vendedor). La APK actual ya lo usa. |
| 3 | ~~Cheques de cobros pendientes en cartera / anular cheque compartido~~ **Hecho 20/10** | Chofer y vendedor | Estado EN_VERIFICACION hasta confirmar el cobro; un cheque compartido no se anula mientras otro cliente lo use. |
| 4 | Pantalla admin de `mobile_dispositivos` (revocar equipo) y `mobile_alertas_integridad` | Las 3 | MOBILE.md §10. |

## Lo que NO hay que rehacer (ya está resuelto)

- Foto de cheques + OCR + BCRA en vendedor: va desde v0.3.0.
- Bug de `cobranza_anular` que anulaba el 10 % de otro pago: corregido en la v7 (01/10).
- Migraciones de las apps (`20260918`, `20260919`, `20260921`), formatos, códigos, en_revisión y cuentas corrientes 1 a 3: **aplicadas**.
- La rama local `apk-deposito` con "CAJA: sobrante en el cobro": ya está en `main` (8c7d3f1).
