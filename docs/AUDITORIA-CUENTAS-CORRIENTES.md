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
| 12 | Selector de cobro del chofer sin `en_cobro` del servidor: puede cobrar un comprobante que el vendedor ya tiene en cobro pendiente (riesgo de cobro doble). | Reportado |
| 13 | Las apps calculan el 10 % contado con la regla vieja (solo si se paga completo); el servidor aplica la nueva (07/10). El vendedor no valida `dtos_hechos`. | Reportado |
| 14 | El chofer ve las devoluciones a valor bruto (`monto_total`); el servidor descuenta `valor_cobro` (neto de 10 %, ya descontado). | Reportado |
| 15 | Los cheques de cobros pendientes nacen EN_CARTERA, así que cartera y proyección de caja incluyen plata no confirmada. `cobranza_anular` anula un cheque compartido para todos los clientes. | Reportado |
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
- Bandeja `/pendientes` (`/api/pendientes`): cobros sin confirmar, entregas a cuenta sin decidir, anticipos esperando factura, devoluciones esperando depósito, devoluciones aceptadas sin NC y rendiciones abiertas.

Migraciones `20261016b` y `20261016c` APLICADAS por el dueño y verificadas (19/10).

25. Mostrador: un cobro que carga el mostrador queda pendiente hasta que un admin lo confirma en Caja (confirmado por el dueño el 19/10).
26. Todo cambio que toque las apps va a `docs/CUENTAS-CORRIENTES-APPS.md`, el traspaso para el agente de cada app.

Pendiente:
- La app de depósito todavía acepta la devolución entera: falta adaptar su pantalla, con el OK del dueño.
- Una devolución rechazada con plata ya descontada solo se avisa en el momento. Falta mostrarla en la bandeja.
