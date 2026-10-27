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
| App Vendedor v0.4.0 (dos cajitas, retiro, 10 % contado, Resumen) | App Vendedor | Hecho 20/10 (merge 78ee8a0), APK v0.4.0 |
| App Vendedor v0.4.1 (la rendición propone efectivo − retiros) y v0.4.2 (la ficha explica el proyectado, "A favor del cliente") | Cuentas corrientes (auditoría 21/10, con OK de Juan) | Hecho 21/10 (ccff0fb, 29b07c5), APK v0.4.2 instalada en el NuStar |
| V1 — Cobrar: créditos ya usados por un cobro sin rendir figuran "disponibles" (riesgo de usarlos dos veces) | Cuentas corrientes | **Hecho 21/10 en el servidor (460c095)**: el servidor no lo frenaba; ahora reserva lo tomado por cobros sin confirmar, rechaza el segundo uso y la ficha manda el disponible real. La app no necesita cambios. |
| ~~V2 — Cobrar: el renglón del pedido muestra el TOTAL del pedido y no lo que debe~~ | App Vendedor | Hecho 23/10, APK v0.4.3 |
| ~~V3 — Comisiones: "Mercadería cobrada" y "Comisiones ganadas" no coinciden~~ | App Vendedor | Hecho 26/10 (servidor en main; APK v0.4.4 compilada, sin instalar) |
| App Chofer v0.3.0 (Tu cuenta, valor de devolución, 10 % contado, formatos, verificar en_cobro y cheque único, cobrado duplicado al sincronizar, "debe" del buscador) | App Chofer | Hecho 21/10 (merge 246e87f), APK v0.3.0 instalada en el NuStar |
| App Chofer v0.3.1 (borrador del cobro, pedido del viaje primero, "$0"/"A favor", ficha explica el saldo, valor de devolución, sobrante, viajes viejos) | App Chofer | Hecho 21/10 (merge 7d62a2c), APK v0.3.1 instalada en el NuStar |
| App Depósito v0.3.0 (devolución por renglón, formatos, mercadería por cupo, **reactivar artículos dados de baja**) | App Depósito | Hecho 20/10 (rama `deposito-v030`), APK v0.3.0 |
| Tope de reintentos del outbox (O10) en `@gm/core` — **toca a las 3 apps** | App Depósito | Hecho 20/10. Vendedor y chofer lo reciben en su próxima APK sin hacer nada (ver abajo) |
| Recepción: la base rechazaba "faltante" (web y APK) | App Depósito | Hecho 20/10, migración `20261020d_recepciones_estado_faltante.sql` aplicada 21/10 y probada (la operación que fallaba 1.156 veces ahora guarda) |
| Artículos dados de baja: matching sin bajas, reactivar desde Artículos/Depósito, historial de quién | Servidor (sesión búsquedas/formatos) | Hecho 20/10 (bef0ecd + 570cc2c), migraciones `20261020_pedidos_articulo_real` y `20261020b_articulos_bajas` aplicadas |
| Devoluciones "tal cual fue facturado" — servidor, NC/REV y pantallas web | Sesión precios (con OK de Juan; toca `lib/cobranzas`) | Hecho 22/10 (rama `devoluciones-nc-exacta`, merge en main) — ver "Devoluciones tal cual facturado" abajo |
| ~~D1 — APK Vendedor con el valor de devolución nuevo~~ | App Vendedor | Hecho 23/10, APK v0.4.3 instalada en el NuStar |
| ~~D2 — APK Chofer con el valor de devolución nuevo~~ | App Chofer | Hecho 23/10, APK v0.3.2 (versionCode 8) instalada en el NuStar; falta la prueba de campo con un pedido facturado real (ver D2) |
| ~~C7 — Al anular un cobro, el servidor puede devolver `parada_reabierta: true` + `mensaje` (la parada "NO ENTREGAR SIN COBRAR" volvió a pendiente: refrescar la hoja y mostrar el mensaje) o 422 `PARADA_BLOQUEADA_ENTREGADA` con `reintentable: false` (viaje terminado: mostrar el error, no reintentar). R4 del 27/10~~ | App Chofer | **Hecho 27/10 — App Chofer v0.3.5**: aviso "volvió a pendiente" (también sin señal, con el overlay), 422 como rechazo sin reintento |
| D3 — Poner en 0 las devoluciones de prueba antes de producción (dato sucio) | Cuentas corrientes / oficina | Pendiente (día del corte) |

## Versiones instaladas hoy

| App | APK instalada | Fecha | Cambios del servidor que todavía no tiene |
|---|---|---|---|
| Vendedor | v0.4.3 (versionCode 12) | 23/10 | — |
| Chofer | v0.3.2 (versionCode 8) | 23/10 | — |
| Depósito | v0.3.0 (versionCode 8) | 20/10 | — |

---

## App Vendedor → v0.4.0 HECHA (20/10/2026, instalada en el NuStar)

Todo lo que estaba pendiente quedó en la v0.4.0 (detalle en MOBILE.md §18, "v0.4.0"): 10 % contado con la regla del 07/10, fila del proyectado en Resumen, devolución sin enviar valuada como el servidor, billetera en dos cajitas, pantalla de retiro (`retiro.registrar`), "Para retirar" en Comisiones, y los precios pendientes del 06/10 (descuento general y contado por pedido, condiciones por proveedor/marca, mercadería por cupo eligiendo artículos, "sin precio base, sin precio" también en el servidor). Un cheque = un papel: verificado, la app no lo duplica sin señal.

~~**Queda para probar en la calle:** un retiro real con la cuenta personal vinculada, y un pedido con cupo de mercadería hasta el picking.~~ **Probado por Juan (26/10).**

## App Vendedor → v0.4.1 y v0.4.2 HECHAS (21/10/2026, auditoría de cuentas corrientes, instalada v0.4.2 en el NuStar)

Las hizo la sesión de cuentas corrientes con el OK de Juan (tocan `mobile/apps/vendedor`): **el agente de la app Vendedor parte de este estado** (`version.json` en 0.4.2 / versionCode 11).

- **v0.4.1** — `pantallas/Rendiciones.tsx` + `datos/billetera.ts` (`efectivoARendir`): la rendición propone *efectivo cobrado − retiros sin rendir* y lo explica ("Cobraste $X − retiraste $Y = llevás $Z"); el aviso de faltan/sobran mide contra eso. Antes, rindiendo sin tocar el número, el retiro quedaba "a su favor". El servidor (`/api/vendedor/pagos-pendientes`) devuelve `retiros_sin_rendir`. Test en `packages/core/test/vendedor-040.test.ts`.
- **v0.4.2** — `pantallas/clientes/ClienteFicha.tsx` (`DesgloseProyectado`): debajo del saldo proyectado, la cuenta línea por línea (real − cobros sin confirmar − 10 % contado y otros al confirmar − devoluciones en proceso = proyectado) y "A favor del cliente" cuando es negativo.

### Pendientes encontrados el 21/10 (ver tabla de arriba)

0. **NuStar — pantalla blanca al reabrir una app cerrada a la fuerza** (visto 2 veces el 21/10 con la app Vendedor, después de `am force-stop`): logcat `cr_ChildProcessConn: Failed to establish the service connection`; WebView 155.0.8059.43 y Chrome 155.0.8059.79. Se arregla reiniciando el equipo. No es código de la app; conviene actualizar el WebView desde Play Store y probar si se repite al deslizar la app desde Recientes (lo que hace un usuario).

1. ~~**V1 — créditos usados dos veces.**~~ **Resuelto en el servidor 21/10 (460c095)** — la app ya recibe el disponible real; queda el texto original como referencia: En Cobrar, URQUIZA muestra disponibles el a cuenta de $14.011,02 y el anticipo de $170.019, que ya usa el cobro de $122.000 del 14/10 todavía sin rendir (marca `[CREDITOS:…]`). Hace falta que el servidor descuente de cada crédito lo que tienen tomado los cobros pendientes (como `en_cobro` hace con los comprobantes) y que la app lo muestre. Primero confirmar si el servidor ya rechaza el segundo uso.
2. ~~**V2 — total del pedido vs. lo que debe.**~~ **Hecho 23/10 (v0.4.3):** si el pedido tiene comprobantes, el número grande es lo que debe (suma de sus saldos) y abajo chico "debe · de $total"; el título ya no se corta. El renglón del pedido #001454 dice $8.646.266,97 (total) y el cliente debe $155.005,43 de ese pedido; se ve recién abriendo la flechita. Mostrar "debe $X" como número principal y el total chico.
3. ~~**V3 — comisiones.**~~ **Hecho 26/10:** con la cuenta personal vinculada, "Mercadería cobrada" sale de los renglones `comision` de la cuenta (`comisionGanadaPorComprobante`, `lib/cuenta-corriente/cuenta-personal.ts`), agrupados por pedido; el detalle por comprobante también. La lista suma exactamente "Comisiones ganadas" y ya descuenta devoluciones y contado (muestra "pactada $X − devoluciones/contado"). Validado en solo lectura: 001939 = $51.175,19 (antes $65.822,31), 001941 = $14.254,52, total $65.429,71 = Comisiones ganadas. Sin cuenta vinculada sigue el cálculo viejo. Lo del servidor ya rige con la APK instalada; la APK v0.4.4 agrega los textos.

## App Chofer → v0.3.0 HECHA (21/10/2026, merge 246e87f, instalada en el NuStar)

Detalle en MOBILE.md §19 "v0.3.0". Todo lo que estaba pendiente:

1. ~~Riesgo de cobro doble~~ **Resuelto en el servidor (20/10)**; la app lo descuenta en `saldoCobrable`. Queda verificarlo en el equipo con un comprobante que el vendedor tenga en cobro.
2. ~~"Neto a cobrar" y `resumenCuenta` con el bruto~~ **Hecho**: `valor_cobro` en ficha, selector y total; devolución local con `valor_estimado` (misma regla que el servidor).
3. ~~10 % contado regla vieja~~ **Hecho**: `nc_contado` desde `cargarCuentaCobro` + `ncContadoDe` en la app (10 % del total, una vez, también en pago parcial).
4. ~~Formatos §20~~ **Hecho**: solo faltaban el importe del gasto y el efectivo de la rendición (`MontoInput`). El aviso de CUIT repetido no aplica al chofer.
5. ~~Billetera etapa 3~~ **Hecho**: "💵 Plata del viaje" + "👤 Tu cuenta" (`cuenta_personal`).
6. ~~Un cheque = un papel~~ **Verificado**: la hoja, la billetera y el overlay cuentan el cheque una vez; el servidor quita el sufijo " (2)" al vincular las piezas.
7. ~~Menores de la pasada final~~ **Hechos**: cobrado duplicado al sincronizar (dedup por `idempotency_key` en hoja, ficha y billetera) y "debe" del buscador (parche de `chofer_clientes` tras cobrar/anular). "Reintenta 3 veces" no era de la app (422 definitivo; eran cortes de señal).
8. Nuevo: al rendir, aviso de que las devoluciones del viaje quedan esperando depósito.

**Probado en el equipo (21/10, TEST-CHOFER4, todo con presupuestos):** cobro parcial con 10 %, devolución a valor (−10 %), `en_cobro` de un cobro de oficina, cobro conjunto con un cheque real (una fila en cartera), sin duplicado al sincronizar, dos cajitas con la cuenta personal real. Detalle y **análisis de uso con 8 cambios propuestos** en MOBILE.md §19 "Pasada guionada 21/10".

**v0.3.1 HECHA (21/10, merge 7d62a2c, APK instalada en el NuStar):** borrador del cobro (Android mató la app con la cámara abierta), lo de este viaje primero y lo viejo plegado, "$0" / "A favor" en vez de guiones, la ficha explica el saldo (cobros sin confirmar y devoluciones de otros viajes), valor final de la devolución en su pantalla, "atrás" tras el teclado, confirmación del sobrante siempre, alerta de viajes viejos sin rendir, texto del candado. Detalle en MOBILE.md §19 "v0.3.1".

## App Depósito → v0.3.0 HECHA (20/10/2026, instalada en el NuStar)

Detalle en MOBILE.md §17 "v0.3.0".

1. ~~Revisión de devoluciones por renglón~~ **Hecho**: sin pantalla nueva (pedido del dueño): la tarjeta queda igual y un **✏️ Editar** despliega aceptar/rechazar, cantidad aceptada y motivo. Operación `devolucion.revisar` → `revisarDevolucion`; `devolucion.recibir` sigue para APKs viejas; el 409 `devolucion_no_pendiente` se trata como hecha.
2. ~~Formatos §20~~ **Ya estaba en el código** (Cola, Recepción, Artículos y Cantidad usan `@gm/formato`, control automático en 0); solo faltaba compilar.
3. ~~Mercadería por cupo~~ **Hecho**: `calcularBonificadosPorCupo` si el pedido tiene cupos, regla vieja si no. La réplica `deposito_pedidos` pasa a `version: 2` con `bonif_merc_origen` / `bonif_merc_pct`.
4. ~~Pedidos de empleados~~ **Verificado en el código**: filtro en `lib/deposito/cola.ts` y `lib/mobile/sync/deposito.ts`.
5. Pendientes del mes de prueba (MOBILE.md §17): pantalla de fotos de recepción con documentos reales, devoluciones con el flujo real del chofer (ahora con revisión por renglón), gestos con el dedo. (Los dos detalles visuales —lista chica con el teclado abierto en Buscar y "⇪ N sin enviar" partido en dos líneas— quedaron resueltos el 26/10 en la v0.3.1, ver abajo.)
6. **Reactivar artículos dados de baja (20/10/2026)** — va en la v0.3.0; falta probarlo en el equipo con un código real dado de baja. Regla del dueño: si se escanea o tipea un código (SKU con o sin ceros, EAN, bulto) que no está entre los activos pero es de un artículo **dado de baja**, la app dice "Este artículo está dado de baja: <SKU> <descripción>. ¿Reactivarlo?" y lo reactiva, registrando quién.
   - Servidor: `GET /api/mobile/deposito/articulo-baja?codigo=` (online, `requireMobile`) y operación de outbox `articulo.reactivar { articulo_id }` (`lib/mobile/outbox/deposito.ts`, idempotente; usa `cambiarEstadoArticulos(…, "app_deposito")` de `lib/articulos/estado.ts`). El historial (`articulos_estado_historial`) guarda usuario, fecha y origen.
   - App: `pantallas/comunes/DadoDeBaja.tsx` (hoja `?ver=baja`), usada en Artículos, Recepción y Devoluciones. Sin señal: "no se encontró (sin señal no se puede ver si está dado de baja)". El artículo reaparece al sincronizar (sin overlay optimista).
   - Ya publicado en la APK v0.3.0 (instalada el 20/10). Falta solo probarlo en el NuStar con un código real dado de baja (escanearlo, reactivar, ver que aparezca). Detalle en MOBILE.md §17 "Artículo dado de baja".
9. **v0.3.1 lista, SIN instalar (26/10, a pedido del dueño):** los dos detalles visuales del punto 5. El APK está compilado (`dist-apks/deposito-v0.3.1.apk` en la carpeta `gmv2-deposito`); se publica junto con los próximos cambios en una sola versión. Si hay que recompilar con más cambios, `--bump none` mantiene el nombre (el versionCode sube igual).
7. ~~Base de datos~~ **Hecho 21/10**: el dueño aplicó `20261020d_recepciones_estado_faltante.sql` y `20260827_picking_preparadores.sql`. Probado con la misma función del servidor: RESIDUO VAIVEN → faltante se guardó (primera línea `faltante` de la historia). Recepciones de prueba de OC-000007 y OC-000008 **canceladas** (estaban abiertas desde julio/agosto por este bug); foto antes/después IDÉNTICA en las 18 tablas, stock de los 3.292 artículos y numeración.
8. **Cola del NuStar limpiada (20/10, con OK del dueño):** se sacaron 3 operaciones del 18–22/09 que nunca iban a entrar (2 recepciones "faltante" y "Abrir pedido 001576", que habría pasado ese pedido de `impreso` a `en_preparacion` un mes tarde).

## Devoluciones tal cual facturado (22/10/2026) → D1 (Vendedor) y D2 (Chofer)

**Regla del dueño (21/10/2026):** la NC/REV de una devolución sale **tal cual se facturó** esa mercadería, ni un centavo más ni uno menos, y **todas** las pantallas muestran el mismo número (web vendedor, web chofer, APK vendedor, APK chofer, cobro y emisión). Ejemplo del dueño: artículo a $100 neto + 21 % IVA + 3 % percepción IVA + 3 % IIBB − 10 % contado → 10 unidades = **$1.143** (900 + 189 + 27 + 27).

### Qué estaba mal (auditoría 21/10)

1. La NC recalculaba la percepción IVA sobre la devolución con el mínimo de $3.000: una devolución chica de una factura grande salía **sin** percepción IVA ($1.116 en vez de $1.143).
2. La NC calculaba el IVA como 21 % del neto y la factura lo calcula por renglón: diferencias de centavos (hasta $1,06 en facturas reales; en una NC grande, más).
3. Chofer, artículo del pedido que entrega: entraba con el precio **con IVA** y sin factura asociada → en pantalla $1.210 y la NC le volvía a sumar IVA y percepciones (**doble IVA**).
4. Cada pantalla mostraba otro número: vendedor web $1.000 (neto), APK vendedor y chofer $1.089 (sin percepciones), cobro $1.116.

### Reglas (decididas por Juan)

- **Valor por renglón** (`lib/cobranzas/valor-devolucion.ts` → `valorDevolucionConOrigen`, función ÚNICA): neto del renglón facturado × cantidad; IVA = IVA por unidad que llevó ese renglón (sin renglón: 21 % del neto); **percepción IVA 3 % si el comprobante de origen la llevó** (aunque la devolución sea chica; en comprobantes del sistema, la que efectivamente llevó; en importados, si su neto supera $100.000), y si no la llevó, no va; **IIBB a la alícuota VIGENTE** del cliente el día de la NC; −10 % si ese comprobante fue cobrado contado.
- **A qué comprobante se asocia cada renglón** (`lib/cobranzas/origen-devolucion.ts`):
  1. lo del pedido que entrega el chofer → el comprobante de **ese pedido**;
  2. si el artículo está en un comprobante del sistema → el último; **precio bloqueado** (no se edita);
  3. si no (comprobantes importados del sistema viejo, que solo tienen número, tipo y fecha, o artículo nunca facturado) → el comprobante **más reciente** del cliente del tipo que corresponde según cómo va hoy ese artículo **para ese cliente**. Si el cliente lleva todo facturado es **NC A aunque el artículo tenga iva_ventas 0**. Precio neto actual, editable. (Es una "trampa" aceptada por Juan: no hay forma de saber en qué factura vieja estaba.)
- **NC A/B o REV:** lo facturado con factura → NC A/B; lo de presupuesto → REV. Una devolución mixta emite **las dos**; si falla a la mitad, al reintentar se emite solo la parte que falta.
- **El servidor manda:** las 4 rutas de alta (`/api/devoluciones`, `/api/viajante/devolucion`, `/api/chofer/viaje/[id]/devolucion`, `/api/mostrador/devolucion`) pasan por `prepararRenglonesDevolucion`: asocian el comprobante y guardan el precio facturado aunque una APK vieja mande otro (si manda el precio con IVA de algo que va por factura, lo pasa al neto).

### Qué está hecho (servidor y web, en main)

- `lib/cobranzas/valor-devolucion.ts`: `valorDevolucionConOrigen`, `elegirOrigenDevolucion`, `origenDesdeComprado`, tipos `OrigenDevolucion` y `ContextoDevolucion` (isomórfico: lo usan las apps vía `@gm/vendedor`).
- `lib/cobranzas/origen-devolucion.ts` (nuevo): origen de comprados, contexto del cliente (IIBB vigente + comprobante fiscal y presupuesto más recientes), resolución por artículo y por renglón guardado.
- `lib/cobranzas/valorar-devoluciones.ts`: valuación por renglón con su origen (la usan ficha del vendedor, chofer, cobros, saldo y la NC).
- `/api/comprobantes-venta/generar-nc-reversa`: emite con los importes de la regla (NC + REV si es mixta), kardex y PDF con los mismos números.
- `/api/chofer/articulo/precio-historico` (acepta `pedidoId`): devuelve `precio`, `origen` y `alicuota_iibb`. `/api/vendedor/cliente/[id]/comprados` devuelve `contexto`.
- Réplicas: `vendedor_cc` y `chofer_viaje_clientes` traen `comprados` con los campos de origen (`fiscal`, `percepcion_iva`, `exacto`, `precio`, `iva_unitario`) y `contexto_devolucion`. Son campos nuevos y opcionales: las APK instaladas los ignoran.
- Web: `/vendedor/clientes/[id]/devolucion` y la ficha del chofer web (`/chofer/[viajeId]/cliente/[clienteId]`) muestran el valor final y bloquean el precio facturado.
- Tests: `packages/core/test/valor-devolucion.test.ts` (caso $1.143, percepción en NC chica, IVA del renglón, mixta, asociación, réplica vieja). 361/361.
- **Validado en solo lectura** con las FA 0007-00000001…05 y PRES 0001-00000017/18: devolver todo da el total facturado al centavo (la 0007-00000003 difiere solo en el IIBB: el cliente es de Buenos Aires y hoy es 0 %, regla del IIBB vigente).

### D1 — App Vendedor (agente de la app Vendedor) — HECHO 23/10, v0.4.3

Revisado el código de 188385d (misma función que la NC, precio facturado bloqueado, `valor_estimado` = total que se ve). Probado con el mock (FA $1.500 neto → $1.815). ~~Queda para la calle: comparar con la NC que emite la oficina en un caso real.~~ **Probado por Juan (26/10).**


El código **ya está** en `mobile/apps/vendedor` (commit 188385d): `pantallas/clientes/Devolucion.tsx` (cada ítem guarda `origen_comp`; lo facturado se muestra sin poder editar el precio; "Precio unitario neto/final"; el total es `valorDevolucionConOrigen` con `contexto_devolucion.alicuota_iibb`; desde el catálogo entra con el neto del motor y `elegirOrigenDevolucion`) y `datasets.ts` (tipos). Falta:
1. Subir versión (`version.json` 0.4.3) y CHANGELOG.
2. Probar en el NuStar: devolución de algo facturado contado (precio bloqueado, total con IVA + percepciones − 10 %), algo nunca facturado de un cliente "todo factura" (precio neto, editable), y que el valor coincida con la NC que emite oficina.
3. `npm run build:apks -- --apps vendedor --notas "..."`, instalar y tachar D1.

### D2 — App Chofer (agente de la app Chofer) — HECHO 23/10, v0.3.2

Compilada e instalada en el NuStar (versionCode 8), abre en línea y sincroniza. Probado contra el mock el camino de respaldo (sin origen del servidor: el renglón del pedido entra al neto y el valor suma el IVA). **Queda para la calle, con un viaje real:** devolver algo del pedido que se entrega (factura A: precio neto bloqueado, total con IVA + percepciones), algo de mercadería vieja, y sin señal; el valor tiene que ser el mismo en la ficha, en el cobro y en la NC. Incluye también el arreglo del servidor del 21/10 (la rendición propone solo el efectivo que el chofer todavía tiene).

El código **ya estaba** en `mobile/apps/chofer` (commit 188385d): `pantallas/Devolucion.tsx` (`resolverItem`: con señal pregunta al ERP con el `pedidoId` del viaje; sin señal usa `comprados`; lo del pedido ya no entra con el precio con IVA; precio facturado bloqueado; muestra el comprobante asociado), `datos/cuenta-cobro.ts` (`valorEstimadoDevolucion` con origen + alícuota) y `datasets.ts`. Falta:
1. Subir versión (`version.json` 0.3.2) y CHANGELOG.
2. Probar en el NuStar: devolver algo **del pedido que se entrega** (factura A: precio neto bloqueado, total con IVA + percepciones), algo de mercadería vieja, y sin señal. El valor tiene que ser el mismo en la ficha, en el cobro y en la NC.
3. `npm run build:apks -- --apps chofer --notas "..."`, instalar y tachar D2.

### D3 — Antes de producción

Las devoluciones que hay hoy en la base son de prueba y están rotas (precios con IVA, sin factura asociada): **no usarlas de ejemplo**. Se ponen en 0 el día del corte.

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
