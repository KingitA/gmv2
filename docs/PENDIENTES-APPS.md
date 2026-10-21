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
| App Chofer v0.3.0 (Tu cuenta, valor de devolución, 10 % contado, formatos, verificar en_cobro y cheque único, cobrado duplicado al sincronizar, "debe" del buscador) | App Chofer | **En curso** desde el 21/10 (rama `chofer-v0.3.0`, sesión chofer) |
| App Depósito v0.3.0 (devolución por renglón, formatos, mercadería por cupo, **reactivar artículos dados de baja**) | App Depósito | Hecho 20/10 (rama `deposito-v030`), APK v0.3.0 |
| Tope de reintentos del outbox (O10) en `@gm/core` — **toca a las 3 apps** | App Depósito | Hecho 20/10. Vendedor y chofer lo reciben en su próxima APK sin hacer nada (ver abajo) |
| Recepción: la base rechazaba "faltante" (web y APK) | App Depósito | Hecho 20/10, migración `20261020d_recepciones_estado_faltante.sql` aplicada 21/10 y probada (la operación que fallaba 1.156 veces ahora guarda) |
| Artículos dados de baja: matching sin bajas, reactivar desde Artículos/Depósito, historial de quién | Servidor (sesión búsquedas/formatos) | Hecho 20/10 (bef0ecd + 570cc2c), migraciones `20261020_pedidos_articulo_real` y `20261020b_articulos_bajas` aplicadas |

## Versiones instaladas hoy

| App | APK instalada | Fecha | Cambios del servidor que todavía no tiene |
|---|---|---|---|
| Vendedor | v0.4.0 (versionCode 9) | 20/10 | — |
| Chofer | v0.2.2 (versionCode 5) | 01/10 | Cobro contado 07/10, formatos §20, cuentas corrientes etapas 1 a 3, devoluciones a valor |
| Depósito | v0.3.0 (versionCode 8) | 20/10 | — |

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

## App Depósito → v0.3.0 HECHA (20/10/2026, instalada en el NuStar)

Detalle en MOBILE.md §17 "v0.3.0".

1. ~~Revisión de devoluciones por renglón~~ **Hecho**: sin pantalla nueva (pedido del dueño): la tarjeta queda igual y un **✏️ Editar** despliega aceptar/rechazar, cantidad aceptada y motivo. Operación `devolucion.revisar` → `revisarDevolucion`; `devolucion.recibir` sigue para APKs viejas; el 409 `devolucion_no_pendiente` se trata como hecha.
2. ~~Formatos §20~~ **Ya estaba en el código** (Cola, Recepción, Artículos y Cantidad usan `@gm/formato`, control automático en 0); solo faltaba compilar.
3. ~~Mercadería por cupo~~ **Hecho**: `calcularBonificadosPorCupo` si el pedido tiene cupos, regla vieja si no. La réplica `deposito_pedidos` pasa a `version: 2` con `bonif_merc_origen` / `bonif_merc_pct`.
4. ~~Pedidos de empleados~~ **Verificado en el código**: filtro en `lib/deposito/cola.ts` y `lib/mobile/sync/deposito.ts`.
5. Pendientes del mes de prueba (MOBILE.md §17): pantalla de fotos de recepción con documentos reales, devoluciones con el flujo real del chofer (ahora con revisión por renglón), gestos con el dedo, lista chica con el teclado abierto en Buscar, "⇪ N sin enviar" partido en dos líneas.
6. **Reactivar artículos dados de baja (20/10/2026)** — va en la v0.3.0; falta probarlo en el equipo con un código real dado de baja. Regla del dueño: si se escanea o tipea un código (SKU con o sin ceros, EAN, bulto) que no está entre los activos pero es de un artículo **dado de baja**, la app dice "Este artículo está dado de baja: <SKU> <descripción>. ¿Reactivarlo?" y lo reactiva, registrando quién.
   - Servidor: `GET /api/mobile/deposito/articulo-baja?codigo=` (online, `requireMobile`) y operación de outbox `articulo.reactivar { articulo_id }` (`lib/mobile/outbox/deposito.ts`, idempotente; usa `cambiarEstadoArticulos(…, "app_deposito")` de `lib/articulos/estado.ts`). El historial (`articulos_estado_historial`) guarda usuario, fecha y origen.
   - App: `pantallas/comunes/DadoDeBaja.tsx` (hoja `?ver=baja`), usada en Artículos, Recepción y Devoluciones. Sin señal: "no se encontró (sin señal no se puede ver si está dado de baja)". El artículo reaparece al sincronizar (sin overlay optimista).
   - Falta: probar en el NuStar o contra el mock (escanear un código de un artículo dado de baja, reactivar, ver que aparezca) y publicar la APK. Detalle en MOBILE.md §17 "Artículo dado de baja".
7. ~~Base de datos~~ **Hecho 21/10**: el dueño aplicó `20261020d_recepciones_estado_faltante.sql` y `20260827_picking_preparadores.sql`. Probado con la misma función del servidor: RESIDUO VAIVEN → faltante se guardó (primera línea `faltante` de la historia). Recepciones de prueba de OC-000007 y OC-000008 **canceladas** (estaban abiertas desde julio/agosto por este bug); foto antes/después IDÉNTICA en las 18 tablas, stock de los 3.292 artículos y numeración.
8. **Cola del NuStar limpiada (20/10, con OK del dueño):** se sacaron 3 operaciones del 18–22/09 que nunca iban a entrar (2 recepciones "faltante" y "Abrir pedido 001576", que habría pasado ese pedido de `impreso` a `en_preparacion` un mes tarde).

### Para los agentes de Vendedor y Chofer: tope de reintentos (O10) en `@gm/core`

Cambió `mobile/packages/core/src/sync/outbox.ts` (compartido). No hay que tocar nada en las pantallas; entra solo con la próxima APK. Qué cambia: una operación que el servidor rechaza con **5xx** 30 veces **y** durante más de 24 h pasa a "rechazado" (el usuario la ve y la descarta) en vez de frenar la fila para siempre; y ya con 30 fallos, el `forzar` del sondeo respeta el backoff (antes reenviaba cada 15 s). Los cortes de red **no** cuentan: nunca se rechaza trabajo hecho sin señal. Si una pantalla filtra rechazados por `tipo`, el mensaje nuevo empieza con "El servidor no pudo aplicarla…". MOBILE.md §4.2, O10.

---

## Servidor — arreglos que afectan a las apps (los hace quien tenga el OK)

| # | Arreglo | Apps | Detalle |
|---|---|---|---|
| 1 | ~~Un cheque = un papel~~ **Hecho 20/10** | Chofer y vendedor | `lib/cobranzas/cheque-compartido.ts`: una fila en cartera por el total, cada cliente vinculado. Si rebota, la ND va entera a quien lo entregó. Migración `20261020b_cheques_un_papel.sql`. |
| 2 | ~~`en_cobro` en la cuenta de cobro del chofer~~ **Hecho 20/10** | Chofer | `lib/cobranzas/en-cobro.ts` (fórmula única con el vendedor). La APK actual ya lo usa. |
| 3 | ~~Cheques de cobros pendientes en cartera / anular cheque compartido~~ **Hecho 20/10** | Chofer y vendedor | Estado EN_VERIFICACION hasta confirmar el cobro; un cheque compartido no se anula mientras otro cliente lo use. |
| 4 | Pantalla admin de `mobile_dispositivos` (revocar equipo) y `mobile_alertas_integridad` | Las 3 | MOBILE.md §10. |
| 6 | ~~Recepción: la base rechazaba `estado_linea = 'faltante'`~~ **Hecho 20/10** | Depósito (web y APK) | La regla vieja de `recepciones_items` no aceptaba `faltante`; la web decía "Marcado como faltante" sin guardar. Migración `20261020d_recepciones_estado_faltante.sql` (aplicada 21/10) y la web ahora avisa si no se guardó. |
| 5 | ~~Artículos dados de baja en matching e importaciones~~ **Hecho 20/10** | Las 3 (sin APK, salvo depósito) | Importación de pedidos (el "062216" dado de baja tapaba al "62216"), listas de precios (mail y Excel), facturas/recepciones de proveedor, OC, vincular a mano, chat de IA y búsqueda por IA (`match_articulos` filtra activos en la base): **solo activos**. Excel de artículos con SKU dado de baja: se actualiza sin reactivar y avisa. Búsqueda por foto del vendedor por EAN corregida (servidor). |

## Lo que NO hay que rehacer (ya está resuelto)

- Foto de cheques + OCR + BCRA en vendedor: va desde v0.3.0.
- Bug de `cobranza_anular` que anulaba el 10 % de otro pago: corregido en la v7 (01/10).
- Migraciones de las apps (`20260918`, `20260919`, `20260921`), formatos, códigos, en_revisión y cuentas corrientes 1 a 3: **aplicadas**.
- La rama local `apk-deposito` con "CAJA: sobrante en el cobro": ya está en `main` (8c7d3f1).
- **Artículos dados de baja (20/10):** las réplicas de las 3 apps ya traen solo activos (en el delta un artículo dado de baja llega como borrado), y el matching del servidor ya los excluye. **No** agregar filtros propios ni "reactivar" en vendedor/chofer: reactivar es solo desde `/articulos`, el depósito web y la app Depósito, siempre por `cambiarEstadoArticulos` (registra quién). Migraciones `20261020_pedidos_articulo_real` y `20261020b_articulos_bajas`: **aplicadas**.
