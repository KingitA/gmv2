# Auditoría de cuentas corrientes — 16/10/2026

Rama `cuentas-corrientes-auditoria` (worktree `../gmv2-cc`, desde main e90cbab). Solo clientes + vendedores + choferes; proveedores queda para después.
Estado: **relevamiento hecho, nada corregido todavía.** Esperando respuestas del dueño (preguntas al final).

## Modelo vigente

- **Libro mayor** = `cuenta_corriente_clientes` (único escritor SQL: `cc_postear`, sin unicidad). Saldo real = `v_saldo_clientes` = Σdebe−Σhaber. La columna `saldo` del libro no se usa (siempre 0 / desactualizada: 159/171 filas no coinciden) — no mostrarla nunca.
- **Capa por comprobante** = `comprobantes_venta.saldo_pendiente` + `imputaciones`. Se mantiene a mano en paralelo al libro → se desincroniza (`v_cc_reconciliacion` mide la diferencia).
- **Saldo proyectado** = `lib/cuenta-corriente/saldo.ts` (real − cobros pendiente/pendiente_rendicion − NC 10 % proyectada − ajustes − `devoluciones_descuentos`).
- Lo pendiente NO entra al libro: cobros se postean en `cobranza_confirmar`; devoluciones solo por la NC/REV (`generar-nc-reversa`).
- Facturas/PRES se postean al emitir (`app/api/comprobantes-venta/generar/route.ts:938`), sin verificación.

## Hallazgos

Verificado = comprobado en la base o leyendo el código. Reportado = lo encontraron los relevamientos; hay que confirmarlo antes de tocar.

| # | Hallazgo | Estado |
|---|---|---|
| 1 | `v_aging_clientes` (tablero finanzas, `app/api/finanzas/tablero/route.ts:25`) suma `saldo_pendiente` en vez del libro: da $47,8 M contra $35,35 M del libro. La diferencia son pagos "APERTURA GM" (migración del sistema viejo) y entregas a cuenta que nunca se imputaron a comprobantes (WENG $4 M, SENGER $1,4 M, ZHUANG $1,87 M, LIN $0,9 M, LI $0,5 M, CARDOZO, ROMERO, FANG). Además: zona desde `clientes_zonas` (1 fila), `CURRENT_DATE`, posible duplicación si un cliente está en varias zonas. | Verificado |
| 2 | Tres cálculos de antigüedad distintos: `v_aging_clientes`, Playroom `app/api/playroom/cuentas-corrientes` (JS, por comprobante) y `jarvis_deuda_antiguedad` (libro, FIFO — el único que cuadra). | Verificado |
| 3 | Ficha cliente chofer (`lib/viajes/cliente-viaje.ts:128,184`): saldo_anterior = saldo real, que ya incluye la factura del viaje, y después suma `pedido.total` → **doble conteo** cuando el pedido está facturado. La hoja de ruta (`hoja-ruta.ts:319`) lo hace bien. | Verificado |
| 4 | Al confirmar la rendición del chofer (`app/api/viajes/[id]/confirmar-rendicion/route.ts:177-195`) se **auto-confirman las devoluciones del viaje** y se suma el stock sin que depósito verifique. | Verificado |
| 5 | `generar-nc-reversa` permite emitir la NC de una devolución que no está confirmada (solo bloquea facturado/rechazado, `:85-97`). | Verificado |
| 6 | DEV-00008 (JONATAN EZEQUIEL ROMERO, $106.573,50) confirmada el 08/10 y sin NC. La confirmación solo mueve stock; la NC es un paso manual aparte que nadie dispara. | Verificado |
| 7 | Comisiones: `sync_comision_desde_kardex_manual` usa `ON CONFLICT (kardex_id)`, pero el índice único ahora es `(kardex_id, tipo)` → falla cuando la comisión se setea después del alta. `sync_comision_update_kardex` actualiza el `monto` de **todas** las comisiones del kardex, incluida la 'cobrada'. | Verificado (definición en la base) |
| 8 | Billetera del viajante: dos saldos distintos. `saldos_financieros` (trigger sobre `billetera_movimientos`) contra `v_saldos_control` (reconstruido desde kardex): diferencias de $7,18 M y $1,12 M. Además, la convención de signo de 'debito' es mixta. | Verificado |
| 9 | Cobros de chofer trabados en pendiente_rendicion desde el 23/09: LACOMBE $1.921.830 y YAN JIAOMEI $5.502.800. | Verificado |
| 10 | App vendedor: la lista de clientes muestra el saldo real; la ficha, la pantalla de pago y cobrar muestran el proyectado. El filtro "con deuda" usa el real. | Reportado |
| 11 | Overlay offline del vendedor: una devolución descontada dentro de un cobro sin enviar muestra un saldo mayor que el del ERP (`mobile/.../overlay.ts:115-120`). Anular un cobro sin señal no restituye el saldo proyectado. | Reportado |
| 12 | Selector de cobro del chofer sin `en_cobro` del servidor: puede cobrar un comprobante que el vendedor ya tiene en cobro pendiente (riesgo de cobro doble). | **Resuelto 20/10** (`lib/cobranzas/en-cobro.ts`) |
| 13 | Las apps calculan el 10 % contado con la regla vieja (solo si se paga completo); el servidor aplica la nueva (07/10). El vendedor no valida `dtos_hechos`. | Reportado |
| 14 | El chofer ve las devoluciones a valor bruto (`monto_total`); el servidor descuenta `valor_cobro` (neto de 10 %, ya descontado). | Reportado |
| 15 | Los cheques de cobros pendientes nacen EN_CARTERA, así que cartera y proyección de caja incluyen plata no confirmada. `cobranza_anular` anula un cheque compartido para todos los clientes. | **Resuelto 20/10** (EN_VERIFICACION + un cheque = un papel, migración 20261020b) |
| 16 | "Pendiente de verificación" significa dos cosas: en `saldo.ts` es cobro sin confirmar; en `v_verificacion_pendiente` es confirmado sin segunda firma. | Verificado |
| 17 | Los cobros cargados desde la oficina se confirman en el acto (`confirmar` por defecto true): no pasan por una segunda persona. Los endpoints de confirmación solo piden estar logueado (`requireAuth`), sin rol. | Reportado |
| 18 | No hay control de límite de crédito (`lib/services/reglas-negocio.ts` está muerto). | Reportado |
| 19 | `rendicion_devolver` revierte un solo movimiento de saldo declarado; `rendiciones.diferencia` cambia de significado entre la creación y la confirmación. | Reportado |
| 20 | Hay scripts destructivos en `supabase/migrations/` (`20260811_reset_datos_prueba.sql`, `20260811_fix_billetera_fantasma.sql`): no deben volver a correrse nunca. | Verificado |

## Código muerto (ignorar)

- `app/api/cuenta-corriente/imputar-credito`
- `app/api/pagos/[id]/reprocesar`
- `app/api/pagos/generar-bonificacion`
- GET de `app/api/viajes/[id]` y `components/viajes/pedido-item.tsx`
- `components/reports/account-statement.tsx`
- `components/finanzas/BalanceCards.tsx`
- `components/ai/dashboard-agenda.tsx`
- `lib/services/legacy-adapter.ts`
- `lib/services/ia-pago-sugerido.ts`
- `lib/actions/finanzas.ts` (`confirmarCobro` / `obtenerSugerenciaImputacion` / `ejecutarPagoSugerido`): escribiría imputaciones sin pasar por el libro
- `lib/services/reglas-negocio.ts`
- `cuenta_corriente_ajustes` (deprecada)
- `cobranzas.estado` (no lo maneja ninguna RPC)

## Preguntas abiertas al dueño

## Reglas definidas por el dueño (16/10)

1. Si un pago llega sin comprobante indicado, se imputa automáticamente a los comprobantes más viejos. La oficina puede reimputarlo a mano.
2. Siempre se muestran los dos saldos: real (lo confirmado) y proyectado (como queda si se confirma todo lo pendiente). Vendedor y chofer leen el **proyectado** como número principal.
3. Una devolución cargada por el vendedor o el chofer baja el proyectado en el momento, sin esperar a que se use en un cobro.
4. La NC/reversa la emite la oficina, que tiene que tener una bandeja de "devoluciones para aceptar / NC para emitir".
5. Las devoluciones del chofer pasan siempre por depósito. Se saca la auto-confirmación de `confirmar-rendicion`.
6. Si rebota un cheque compartido, toda la deuda va al cliente que lo entregó.
7. La comisión se gana cuando el cliente paga. La devolución descuenta comisión, y el 10 % contado también.
8. Billetera:
   - Los cheques físicos se cuentan como unidades, no como monto ("$100.000 efectivo + 1 cheque").
   - La billetera es una **cuenta corriente** del vendedor. Retira él mismo de lo que tiene en mano, y el retiro se descuenta.
   - La oficina puede cargar movimientos: mercadería que compra, sueldo depositado y descontado de comisión, etc.
   - Reemplaza la "cuenta de cliente" que hoy tienen vendedores, choferes y empleados de depósito en el sistema viejo, donde se acredita la comisión mensual y se debitan retiros y presupuestos. La comisión se acredita a medida que cobra, no a fin de mes.
9. Verificación de cobros:
   - Los cobros de /cobros se verifican siempre.
   - En /caja se confirma en el acto lo que queda imputado a comprobantes. La entrega a cuenta (sin comprobante) queda pendiente hasta que se imputa o se decide dejarla a cuenta, desde la misma planilla.
10. Si un cobro se rechaza, vuelve al cliente. El vendedor o el chofer no responde por él.
11. El chofer rinde al día siguiente. El vendedor junta plata durante días o semanas y la entrega por chofer, por transporte o en mano. Desde que aprieta "enviar rendición", esa rendición puede tardar como máximo 1 semana.
12. Los comprobantes van directo a la cuenta al emitirse. No hay tope de crédito: el bloqueo de entregas lo maneja Jarvis.
13. La billetera tiene dos partes:
    - la **plata de la empresa en mano**: efectivo, más los cheques como unidades;
    - la **cuenta corriente personal**: comisiones cobradas a favor; retiros, mercadería y sueldo en contra.

    Un retiro baja la plata en mano y debita la cuenta. Puede retirar de más y quedar debiendo.
14. Choferes y empleados de depósito también tienen cuenta personal: adelantos, retiros, mercadería.
15. Los 12 comprobantes con CAE emitidos desde gmv2 **no** están en el sistema viejo: se conservan en la puesta a cero.
16. La apertura de saldos al pasar a producción se carga comprobante por comprobante, con su fecha.
18. El sistema **jamás** emite una NC solo. La bandeja solo avisa; la NC la emite una persona de la oficina, y únicamente sobre una devolución aceptada por depósito.
19. **Una sola fuente para el saldo** (decisión del 16/10, reemplaza la idea del "control de cuadre"):
    - Una única función calcula el saldo real y el proyectado, y todas las pantallas y apps la consultan.
    - El saldo por comprobante deja de mantenerse a mano: se deriva del libro con imputación FIFO.
    - El control queda solo como alarma interna.
17. No se arma una base de pruebas separada. Se prueba en la real, sin emitir comprobantes fiscales, y antes de producción todo queda en cero salvo lo fiscal y los pedidos.

## Etapa 1 — Una sola fuente para el saldo (16/10, en la rama, falta aplicar migración y pasar a main)

Hecho:
- `lib/cuenta-corriente/saldo.ts` es LA fórmula (real + proyectado + devoluciones en proceso). La versión de un cliente usa por dentro la de varios, así que no pueden dar distinto. Va de a tandas de 150 clientes.
- Regla 3: las devoluciones en proceso (pendiente/confirmado sin NC) bajan el proyectado una vez, por su valor. Ya no se suman a través de `devoluciones_descuentos`.
- `saldoDeParada`: una fórmula para la hoja de ruta, `/api/chofer/viaje/[id]` y `cliente-viaje.ts`. Arregla el hallazgo 3 (doble conteo).
- ERP: la ficha del cliente, la ficha rápida de la lista y el diálogo de imputar leen `/api/clientes/saldos` y muestran real + proyectado. La cuenta corriente muestra las devoluciones en proceso.
- Vendedor y chofer: el proyectado es el número principal (lista, filtro con deuda, Marco, Viajes, estadísticas, cobro conjunto del chofer). Overlays: devolución sin enviar y anulación (hallazgo 11).
- Migración `20261016_cc_fuente_unica.sql`: `cc_deuda_antiguedad_base`, `v_aging_clientes` (mismas columnas más localidad), `jarvis_deuda_antiguedad` sobre la misma base. Playroom usa la vista. Arregla los hallazgos 1 y 2.
- Tablero: "sin verificar" pasa a llamarse "sin segunda firma" (hallazgo 16).

Verificado:
- La fórmula de antigüedad, corrida en la base en solo lectura, da $35.350.521,38, igual al libro.
- `getSaldosClientes` contra la base real: el real coincide con el libro en 29/29 clientes, y la versión de un cliente da igual que la de varios en 40/40.
- `typecheck:movil` OK y los 320 tests de mobile OK.

Pendiente:
- El dueño aplica la migración **antes** de desplegar el código: Playroom lee columnas nuevas de la vista.
- APK nueva de vendedor y chofer.
- Una hoja de ruta de un viaje ya rendido puede mover su saldo anterior cuando se confirman sus cobros o se emiten sus NC. Decisión del dueño (16/10): durante el viaje la hoja queda **viva**, para que el chofer vea si el cliente transfirió mientras tanto. Recién se **congela al confirmar la rendición**, para que el registro histórico no cambie. Es un detalle menor, para más adelante.

## Etapa 2 — Verificación (16/10, en la rama; faltan las migraciones del dueño y el OK para main)

Reglas nuevas del dueño, del 16/10:

20. Si un pago entra sin factura, aparecen dos opciones: "Imputar a lo más viejo" o "Dejar a cuenta". Un anticipo de un pedido sin facturar se aplica solo a la factura de ese pedido.
21. En la oficina, el efectivo y el cheque físico entran en el acto. Las transferencias y los echeqs quedan pendientes hasta que se controla el banco.
22. Depósito (o la oficina) puede aceptar algunos renglones de una devolución, rechazar otros y cambiar la cantidad y la condición.
23. Roles:
    - Cobros: admin, administrativo y mostrador (el cobro queda pendiente).
    - Caja (confirmar, imputar, anular, rendiciones, ajustes): solo admin.
    - Emitir comprobantes y aceptar devoluciones: admin y administrativo. Depósito también acepta devoluciones.
    - Depósito, chofer y vendedor no entran al ERP.
24. El mismo admin que carga un cobro puede confirmarlo. El control de otra persona es el arqueo al cierre.

Lo que se hizo:

- `lib/auth.ts`: la tabla `PERMISOS` y las funciones `requirePermiso` / `tienePermiso`. Las aplican las APIs de plata, devoluciones y emisión, y `ROUTE_RULES` (`/caja` solo admin; `/pagos-clientes` admin, administrativo y mostrador). El menú filtra por rol.
- `lib/cobranzas/reglas-confirmacion.ts`: la regla única que decide si un cobro de la oficina se confirma al cargarlo (lo aplican `/api/pagos-clientes` y `/api/cobranzas`). Un cheque a cuenta sin color queda pendiente.
- Botones "Proponer lo más viejo" y "Dejar a cuenta" (`/api/pagos/[id]/a-cuenta`, migración `20261016b`).
- Los anticipos se vinculan siempre al pedido, en oficina y en chofer. `lib/cobranzas/aplicar-anticipo.ts` los aplica al facturar (`generar`, paso 7b). Al anular un cobro, el pedido queda libre.
- Devoluciones (migración `20261016c`): `revisarDevolucion` revisa renglón por renglón, solo desde pendiente y sin duplicar stock. La NC solo sale de devoluciones aceptadas y solo por los renglones aceptados. Se sacó la auto-confirmación al rendir el viaje y se registra el usuario real.
- Bandeja `/caja/pendientes` (antes `/pendientes`; desde el 21/10 dentro de Caja y solo admin) (`/api/pendientes`): cobros sin confirmar, entregas a cuenta sin decidir, anticipos esperando factura, devoluciones esperando depósito, devoluciones aceptadas sin NC y rendiciones abiertas.

Migraciones `20261016b` y `20261016c` APLICADAS por el dueño y verificadas (19/10).

25. Mostrador: un cobro que carga el mostrador queda pendiente hasta que un admin lo confirma en Caja (confirmado por el dueño el 19/10).
26. Todo cambio que toque las apps va a `docs/CUENTAS-CORRIENTES-APPS.md`, el traspaso para el agente de cada app.

Pendiente:
- La app de depósito todavía acepta la devolución entera: falta adaptar su pantalla, con el OK del dueño.
- Una devolución rechazada con plata ya descontada solo se avisa en el momento. Falta mostrarla en la bandeja.

## Etapa 3 — Comisiones y cuenta personal (19/10, en la rama; falta la migración del dueño y el OK para main)

Reglas del dueño (19/10):

27. La comisión se gana cuando el comprobante del cliente queda **saldado del todo**. Si el cliente pagó a cuenta, se gana al imputar. Se usa el % de la venta y va al vendedor original del cliente.
28. La cuenta personal del empleado **es su cuenta de cliente**. Entra todo:
    - mercadería que retira (pedido normal que no va a preparación, pero sí cuenta como venta y baja stock);
    - pagos que hace;
    - comisiones;
    - retiros;
    - diferencias de rendición;
    - ajustes.
29. El chofer tiene la cuenta del viaje; solo la diferencia, de más o de menos, va a su cuenta personal, con fecha y rendición. Depósito solo tiene mercadería y pagos.
30. El retiro lo hace el vendedor solo, de lo que tiene en la mano. Alcanza con el control en la rendición.
31. Las cuentas de empleados no cuentan como deuda de clientes y se ven en un listado aparte.

Lo que se hizo:

- Migración `20261019_cc_personal.sql`:
  - `clientes.es_empleado` (marca las 9 cuentas "(EMPLEADO)"/"(VIAJANTE)"), `empleado_usuario_id` y `vendedores.cuenta_cliente_id`.
  - `cuenta_empleado_de()`.
  - Trigger que copia las diferencias de rendición de la billetera a la cuenta personal.
  - `rendicion_crear` v4 (descuenta los retiros) y `rendicion_devolver` v2 (revierte todo y libera los retiros; arregla el hallazgo 19).
  - Antigüedad sin empleados.
  - Arreglo de los triggers de comisión (hallazgo 7).
- `lib/comisiones/liquidar.ts`: motor único. Reconcilia lo que corresponde contra lo ya posteado, así que no duplica, y si se anula un cobro revierte la comisión. Lo usan la post-confirmación, la anulación de cobro, la NC de devolución, la anulación de comprobante y los ajustes que saldan un comprobante.
- Se dejaron de escribir las comisiones 'cobrada', el débito del 10 % y las comisiones negativas de NC y de anulación.
- `lib/cuenta-corriente/cuenta-personal.ts` y `retiro.ts`; `POST /api/vendedor/retiro`.
- La billetera del vendedor y la del chofer leen la cuenta personal. `/api/viajantes/[id]/retiro|movimiento` quedaron dados de baja (410).
- Pantalla `/personal` (vincular usuario y códigos de vendedor, botón "Poner al día") y recuadro en la ficha del cliente.
- Los reportes de deuda (estadísticas del vendedor, Playroom) excluyen a los empleados, y la cola de preparación de depósito (web y app) no muestra sus pedidos.

Pendiente:
- El dueño aplica `20261019_cc_personal.sql` antes de main.
- La oficina vincula cada cuenta en `/personal` y aprieta "Poner al día".
- APK vendedor (dos cajitas y pantalla de retiro) y APK chofer: ver `docs/CUENTAS-CORRIENTES-APPS.md`.

## Etapa 4 — Puesta a cero y apertura (20/10, en preparación)

Reglas del dueño (20/10):

32. La fecha de corte todavía no está definida.
33. Los presupuestos y facturas sin CAE emitidos en la prueba también están en el sistema viejo: se borran y vuelven con la apertura.
34. Finanzas:
    - Los cheques son de prueba, salvo los echeqs PROPIOS emitidos a proveedores (ENTREGADO_A_PROVEEDOR: 2 a La Mariposa y 1 a Rofina).
    - Los saldos de bancos son reales pero cambian todos los días: se borran y el dueño los recarga.
36. Las comisiones de los comprobantes del sistema viejo se siguen liquidando en el sistema viejo hasta que se salden (decisión del dueño, 20/10). En gmv2 los comprobantes de apertura no generan comisión, porque no tienen renglones de kardex.
35. La apertura sale del reporte "Comprobantes Impagos de Clientes" del sistema viejo (`.chr`, Windows-1252). Es el mismo archivo con el que se cargaron los clientes de Freije el 01/10.

Simulacro, solo lectura, del 20/10:
- Los 12 comprobantes con CAE se cancelan entre sí (cada FA con su NCA de anulación; la ND de HEMA con su NC): suman $0 y se conservan.
- En Finanzas hay 438 cheques; solo 3 son reales.

Hecho:
- `lib/apertura/parsear-chr.ts`: lector puro del reporte. Probado con el archivo de Freije: 22 renglones, 7 clientes que cuadran contra el saldo del reporte, total $16.018.014,27 igual al del reporte.
- `lib/apertura/importar.ts`, `POST /api/apertura` y la pantalla `/apertura` (solo admin). La previsualización bloquea si un cliente no existe, si hay un tipo desconocido o si la suma no da el saldo del reporte. La carga se confirma por tandas y es idempotente: la previsualización contra la base real ya reconoce como cargados los 22 renglones de Freije. Sigue las convenciones de la apertura anterior ("APERTURA GM", total_neto = importe final) y guarda la fecha a mediodía de Argentina, para que no se corra de día.

Pendiente:
- La migración `20261020_cc_puesta_a_cero.sql` está escrita (autorizada por el dueño el 20/10; APLICADA y verificada: funciones instaladas, nada borrado). Aplicarla NO borra nada: instala `cc_puesta_a_cero_simulacro()` y `cc_puesta_a_cero('PONER A CERO')`. El simulacro, corrido en solo lectura, conserva 12 comprobantes con CAE (/usr/bin/bash), 12 asientos, 6 imputaciones entre ellos y 3 echeqs.


## Auditoría para producción — 21/10 (rama `cc-produccion-2110`)

Recorrido completo: base (solo lectura), ERP en Chrome y apps vendedor v0.4.0 / chofer v0.3.0 en el NuStar. El libro cierra: ningún cobro confirmado sin asiento ni duplicado, detalle = monto, imputaciones ≤ pago.

Reglas nuevas del dueño (21/10):

37. El 10 % contado no tiene tope: queda a criterio del cobrador. Siempre es el 10 % de un comprobante y se emite por NC/REV.
38. Un anticipo puede saldar otros pedidos (reemplaza lo de la regla 20 sobre "solo la factura de ese pedido").
39. La plata a favor la aplica la oficina, no el sistema solo: un pago se imputa a una factura (factura $100, paga $50 → saldo $50) o queda a cuenta (se ve la factura de $100 con saldo $100 y "a cuenta" $50).

Arreglado en la rama:

| # | Hallazgo | Arreglo |
|---|---|---|
| 21 | La rendición del vendedor proponía declarar todo el efectivo cobrado, sin restar los retiros: rindiendo sin tocar, el retiro quedaba "a su favor" (caso Juan Cruz: $0 en mano, proponía $122.000). | App, web y `/api/vendedor/pagos-pendientes` proponen efectivo − retiros y lo explican. Falta APK vendedor. |
| 22 | `cobranza_anular` v7 anulaba la REV de bonificación entera pero solo liberaba sus imputaciones a los comprobantes del cobro anulado. URQUIZA: PRES-12 "pagado" con $155.005,43 debidos según el libro (única diferencia de `v_cc_reconciliacion`). | Migración `20261021_cobranza_anular_v8.sql` + reparación. |
| 23 | Rendiciones y cobros trabados sin aviso: viaje CARHUE 24/09 con $7.424.630 "camino a oficina" hace 28 días. La bandeja lo marcaba, pero nadie la abría. | Número rojo en "Pendientes de revisar"; "rendido, en camino" en vez de "sin rendir"; nombre de quien aceptó la devolución en vez del id. |
| 24 | Al confirmar una rendición, un cobro con cheque sin tildar volvía callado a "plata en mano". El panel no restaba los retiros del esperado (mostraba "retiene" lo retirado). `rechazar-pago` solo pedía estar logueado. | Aviso antes de confirmar, retiros en el esperado, `rechazar-pago` con permiso de Caja. |

Pendientes de pantalla (no frenan, pero confunden):
- Extracto de la cuenta: los asientos de la apertura de Freije (01/10) están a medianoche UTC y se ven un día antes que en la lista de comprobantes (se van con la puesta a cero; la apertura nueva guarda mediodía).
- Cuenta detallada: un pago a cuenta se ve "−$0,00 CONFIRMADO" mientras que en "Solo saldos" figura "A CUENTA".
- App vendedor: el saldo proyectado no detalla la NC del 10 % proyectada (URQUIZA: −$76.842,80 con facturas por $323.091).
- "Saldo a cobrar" de Cobros/Caja suma solo facturas (ignora NC a favor, a cuenta y en cobro). La lista de clientes del ERP no tiene saldo. El Excel de saldos no tiene total.
- Varios (ver mapa del 21/10): web del vendedor muestra real; empleados en listas de deuda; overlay offline del chofer resta dos veces las devoluciones.

Arreglado además el 21/10 (en main): pantallas que confundían (pago "−$0,00", total en el Excel, "Facturas pendientes · a favor · Saldo de la cuenta" en Cobros/Caja, columna Saldo en clientes, fechas del extracto, 10 % visible en el proyectado del ERP y de la app vendedor v0.4.2), Pendientes de revisar movida a Finanzas → Caja (solo admin), nombre de quien aceptó la devolución. Manual de uso: https://claude.ai/artifact/Gpgo1EaFkTdnGDQg6iXba3

Pendientes que encontré al sacar las capturas (sin tocar todavía):
- App vendedor, Cobrar: el renglón de cada pedido muestra el TOTAL del pedido (URQUIZA #001454: $8.646.266,97) y no lo que debe ($155.005,43); hay que abrir la flechita para verlo.
- App vendedor, Cobrar: los créditos que ya usa un cobro sin rendir (URQUIZA: a cuenta $14.011,02 y anticipo $170.019 dentro del cobro de $122.000 del 14/10) figuran "disponibles": riesgo de usarlos dos veces. Falta confirmar si el servidor lo frena.
- App vendedor, Comisiones: "Mercadería cobrada" lista comisiones (URQUIZA #001454) mientras "Comisiones ganadas" dice $0: la lista sale del cálculo viejo y la cuenta personal todavía no tiene "Poner al día". Se alinea con la puesta a cero + Poner al día; revisar entonces.
- NuStar: el 21/10 volvió la pantalla blanca por actualización del WebView; se arregló reiniciando el equipo (adb reboot).
