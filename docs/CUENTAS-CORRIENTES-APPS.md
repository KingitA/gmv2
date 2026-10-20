# Cuentas corrientes → qué cambia en cada app

Documento vivo de traspaso para los agentes de las apps (vendedor, chofer, depósito). Lo mantiene la sesión de cuentas corrientes y se actualiza en cada etapa, en el mismo commit que el cambio. El detalle de los hallazgos y las reglas del dueño está en `docs/AUDITORIA-CUENTAS-CORRIENTES.md`; las reglas del motor offline, en `MOBILE.md` (§21).

**Regla general:** el saldo de un cliente sale de un solo lugar, `lib/cuenta-corriente/saldo.ts`. Ninguna app calcula el saldo por su cuenta. Lo único que hace cada app es sumarle lo que todavía no envió (overlay) con las mismas reglas que el servidor.

| Etapa | Estado |
|---|---|
| 1 · Fuente única del saldo | En main (8dbedb9) |
| 2 · Verificación, roles, devoluciones por renglón | En main (54a34cd) |
| 3 · Comisiones y cuenta personal | En main (migración `20261019_cc_personal.sql` aplicada) |
| 4 · Puesta a cero y apertura | En main; la puesta a cero se ejecuta el día del corte (no afecta a las apps) |

---

## Conceptos que toda app tiene que respetar

- **Saldo real**: el libro mayor, solo lo confirmado.
- **Saldo proyectado**: cómo queda si se confirma todo lo pendiente, o sea los cobros sin verificar (con su 10 % contado y su ajuste) y las **devoluciones en proceso** (cargadas o aceptadas, todavía sin NC).
  - **Vendedor y chofer leen el proyectado como número principal.** El real va chico al lado cuando difiere.
- **Devoluciones**: descuentan del proyectado **desde que se cargan**, una sola vez, por su valor (`valorarDevoluciones`). Si depósito las rechaza, el cliente vuelve a deber solo. La NC la emite siempre una persona de la oficina, y solo sobre devoluciones aceptadas.
- **Nada queda confirmado al cargarlo en la calle**: cobros, devoluciones y rendiciones esperan a la oficina o a depósito.

---

## App Vendedor

### Ya hecho en el código (rama/main)

- Lista de clientes, filtro "con deuda", encabezado del pedido (`Marco.tsx`), viajes y estadísticas: muestran el **proyectado**.
  - El servidor manda `saldo_proyectado` en `/api/vendedor/clientes`, `/api/vendedor/viajes/[id]` (nuevo campo) y `/api/vendedor/estadisticas` (deuda de la cartera sobre el proyectado).
- Overlay (`mobile/apps/vendedor/src/datos/overlay.ts`):
  - una **devolución sin enviar** baja el proyectado, en la lista y en la ficha;
  - un **cobro anulado sin enviar** lo vuelve a subir por su monto;
  - `montoDeCobro` ya no cuenta las devoluciones descontadas: la devolución baja por su cuenta.
- La ficha (`lib/vendedor/ficha-cliente.ts`): `devoluciones_en_proceso` es el valor completo que ya descuenta el proyectado.
- Tests: `packages/core/test/vendedor.test.ts`.

### Qué tiene que hacer el agente de la app

1. **Armar una APK nueva** con estos cambios. Las APK viejas siguen andando, pero en algunas pantallas muestran el real.
2. Pendiente detectado en la auditoría, sin tocar todavía: en `Cobrar.tsx` y `comprobantes-ui.tsx` la estimación del **10 % contado** sigue la regla vieja (solo si se paga completo). El servidor usa la regla del 07/10: 10 % del total de cada comprobante, una vez. Además, la app no valida `dtos_hechos`.
3. Pendiente: la pestaña Resumen esconde la fila del proyectado cuando el único cobro en calle es uno sin enviar (`comprobantes-ui.tsx:77,131`).

---

## App Chofer

### Ya hecho en el código (rama/main)

- Saldo de la parada con **una sola fórmula** (`saldoDeParada` en `saldo.ts`), la misma para la hoja de ruta, `/api/chofer/viaje/[id]` y la ficha del cliente en el viaje (`lib/viajes/cliente-viaje.ts`).
  - `saldo_anterior` = proyectado **sin** los cobros y devoluciones de este viaje − saldo de los comprobantes del viaje.
  - `total_a_cobrar` = saldo_anterior + lo del viaje − lo devuelto en el viaje (valor).
  - Arregla el doble conteo de la ficha cuando el pedido estaba facturado.
- La hoja de ruta queda **viva** durante el viaje: si el cliente transfiere mientras tanto, al chofer le baja el "a cobrar" en la próxima sincronización (cada 5 minutos con señal).
- `chofer_clientes` (cobro conjunto) trae `saldo_proyectado`, y `Cobrar.tsx` muestra "debe" con el proyectado.
- Overlay (`mobile/apps/chofer/src/datos/overlay.ts`): una devolución sin enviar baja el `total_a_cobrar` de la parada.
- Al confirmar la rendición del viaje, **las devoluciones ya no se aprueban solas**: quedan esperando depósito. La respuesta de `POST /api/viajes/[id]/confirmar-rendicion` trae `devoluciones_pendientes_deposito`.
- Los anticipos que cobra el chofer se vinculan siempre al pedido (`/api/chofer/viaje/[id]/cobro`) y se aplican solos cuando el pedido se factura.
- Tests: `packages/core/test/chofer-overlay.test.ts`.

### Qué tiene que hacer el agente de la app

1. **Armar una APK nueva.**
2. Pendiente, **riesgo de cobro doble**: `SelectorCuenta` / `cargarCuentaCobro` no recibe del servidor lo que ya está "en cobro" (cobros pendientes del vendedor o de otro viaje sobre el mismo comprobante). La ficha del vendedor sí lo reserva. Hay que agregar `en_cobro` desde el servidor, igual que en `lib/vendedor/ficha-cliente.ts`.
3. Pendiente: el "Neto a cobrar" de la ficha (`Cliente.tsx`) y `resumenCuenta` (`cuenta-cobro.ts:83`) usan el `monto_total` bruto de la devolución. El servidor ya usa el valor (`valor_cobro`).
4. Pendiente: la estimación del 10 % contado sigue la regla vieja (`cuenta-cobro.ts:73-79`). Es lo mismo que en vendedor.

---

## App Depósito

### Ya hecho en el servidor (rama)

- **Revisión de devoluciones renglón por renglón** (migración `20261016c`, ya aplicada). Depósito puede aceptar algunos renglones, rechazar otros, cambiar la cantidad aceptada y si es vendible o no. Se guardan los valores originales, quién decidió y cuándo.
- Función única: `revisarDevolucion` en `lib/deposito/devoluciones.ts`.
  - Solo revisa devoluciones pendientes y no duplica el stock.
  - Lo rechazado queda con cantidad 0.
  - Si se rechaza todo, la devolución pasa a `rechazado`.
- Contrato de `POST /api/deposito/devoluciones`:
  - **Nuevo**: `{ devolucion_id, renglones: [{ id, aceptar, cantidad_aceptada?, es_vendible?, condicion?, motivo? }], motivo? }`. Los renglones que no se mandan se aceptan como están.
  - **Viejo, sigue andando**: `{ devolucion_id, items_confirmados }` acepta todo.
- `GET /api/deposito/devoluciones` trae por renglón: precio, cantidad original, condición y estado del renglón.
- La operación offline `devolucion.recibir` (`lib/mobile/outbox/deposito.ts`) sigue aceptando todo y ahora registra el usuario real.
- La pantalla web de depósito (`app/deposito/devoluciones`) ya hace la revisión por renglón.
- Permiso: `revisar_devoluciones_deposito` (admin, administrativo, deposito).

### Qué tiene que hacer el agente de la app (con OK del dueño)

1. Adaptar la pantalla de recepción de devoluciones de la APK para revisar renglón por renglón (aceptar o rechazar, cantidad aceptada, vendible o no, motivo), igual que la pantalla web.
2. Agregar al outbox una operación nueva, por ejemplo `devolucion.revisar` con `renglones`, que llame a `revisarDevolucion`. Hay que mantener `devolucion.recibir` para las APK viejas.
3. Respuesta de error: `409` si la devolución ya no está pendiente. El outbox lo tiene que tratar como "ya resuelta", no reintentar para siempre.

**Hecho 20/10/2026 (APK Depósito v0.3.0).** Los tres puntos: la tarjeta de cada renglón queda igual y un "✏️ Editar" despliega aceptar/rechazar, cantidad aceptada y motivo; operación `devolucion.revisar { devolucion_id, renglones: [{ id, aceptar, cantidad_aceptada, es_vendible, motivo }] }` en `lib/mobile/outbox/deposito.ts`; el 409 `devolucion_no_pendiente` devuelve "ya resuelta" y saca la devolución de la lista. Detalle en MOBILE.md §17 "v0.3.0".

---

## Roles (etapa 2) — afecta a quién puede usar qué

| Permiso | Roles |
|---|---|
| Cargar cobros en /pagos-clientes (quedan pendientes) | admin, administrativo, mostrador |
| Caja: confirmar, imputar, dejar a cuenta, anular, rendiciones, ajustes | admin |
| Revisar devoluciones (ERP) | admin, administrativo |
| Revisar devoluciones (depósito) | admin, administrativo, deposito |
| Emitir comprobantes (facturas, NC, reversas) | admin, administrativo |

Los endpoints de las apps (`/api/viajante/*`, `/api/chofer/*`, `/api/vendedor/*`) no cambiaron de permisos. Depósito, chofer y vendedor no entran al ERP salvo que también tengan rol admin o administrativo.

---

## Etapa 3 · Comisiones y cuenta personal (19/10, en la rama)

Reglas del dueño:
- La **cuenta personal** de cada empleado (vendedor, chofer, depósito) **es su cuenta de cliente** (`clientes.es_empleado`).
  - Se vincula con su usuario (`clientes.empleado_usuario_id`) y, para las comisiones, con cada código de vendedor (`vendedores.cuenta_cliente_id`).
  - Ahí entran: comisiones, retiros, diferencias de rendición, mercadería que retira (pedido normal) y pagos que hace.
- **Comisión**:
  - se gana cuando el comprobante del cliente queda **saldado del todo**;
  - se calcula sobre la **plata** que pagó (el 10 % contado y las devoluciones la reducen solas);
  - usa el % de la venta y es del vendedor original del cliente;
  - motor: `lib/comisiones/liquidar.ts`.
- **Retiro**:
  - lo hace el vendedor solo, de la plata que tiene en la mano;
  - se debita en su cuenta y baja lo que tiene que rendir;
  - la oficina lo controla en la rendición.
- **Diferencias de rendición** (de más o de menos) → a la cuenta del empleado, con fecha y rendición. Lo hace el trigger `billetera_a_cuenta_empleado`.
- Las cuentas de empleados **no cuentan como deuda de clientes**. Los pedidos de empleados **no aparecen para preparar**, pero cuentan como venta y bajan stock.

### Servidor (ya hecho)

- `GET /api/vendedor/billetera` y `GET /api/vendedor/me`:
  - `balance` = **plata de la empresa en la mano**: efectivo cobrado − retiros sin rendir.
  - Campos nuevos: `retiros_sin_rendir` y `cuenta_personal: { cliente_id, saldo_real, saldo_proyectado, a_favor, comisiones_ganadas, retiros } | null`. `null` significa que la oficina todavía no la vinculó, y entonces vale el cálculo viejo.
  - `deuda_rendiciones` sale de la cuenta personal cuando está vinculada.
  - `saldo` (balance + deuda) sigue existiendo por compatibilidad.
- `GET /api/vendedor/comisiones`: con la cuenta vinculada, `disponible` = lo que tiene a favor en su cuenta y `retirado` = la suma de sus retiros. `sin_cobrar` sigue siendo la estimación del kardex.
- **Nuevo** `POST /api/vendedor/retiro` `{ monto, observaciones?, idempotency_key? }`:
  - `409 SIN_CUENTA_PERSONAL` si no está vinculada;
  - `422 RETIRO_SUPERA_EFECTIVO` si pide más efectivo del que tiene en la mano;
  - es idempotente por `idempotency_key`.
- `GET /api/chofer/billetera`: `saldo_cuenta_corriente` sale de su cuenta personal cuando está vinculada (positivo = a favor) y trae `cuenta_personal`.
- `rendicion_crear` v4 descuenta los retiros sin rendir de lo esperado y lo informa en `retiros`. `rendicion_devolver` v2 los libera.

### App Vendedor — qué tiene que hacer el agente

1. **Billetera en dos cajitas** (regla del dueño):
   - "Plata de la empresa en tu mano": `balance` en efectivo + `cheques_cantidad` como **cantidad**, nunca como monto.
   - "Tu cuenta": `cuenta_personal.a_favor` (si es negativo, "debés"), con comisiones ganadas y retiros.
   - Mostrar `saldo` como un número único ya no corresponde.
2. **Pantalla de retiro**: monto (con el componente de monto de la app) y observación.
   - Llama a `POST /api/vendedor/retiro` con un `idempotency_key` generado en el equipo.
   - Offline: agregar una operación de outbox (por ejemplo `retiro.registrar`) con un handler de servidor que llame a `registrarRetiro` (`lib/cuenta-corriente/retiro.ts`). En el overlay, el retiro baja `balance` y `a_favor` hasta que sincronice.
   - Mensajes: si no hay cuenta vinculada, "pedile a la oficina que la vincule"; si el monto supera el efectivo en mano, avisarlo.
3. La pestaña Comisiones: "Para retirar" = `disponible` (puede ser negativo si debe). "Sin cobrar" sigue siendo una estimación.
4. **Armar una APK nueva.**

### App Chofer — qué tiene que hacer el agente

1. Billetera:
   - "Plata del viaje" (efectivo, fondos, gastos y cheques como cantidad), como hoy.
   - "Tu cuenta": `saldo_cuenta_corriente` / `cuenta_personal` (diferencias de rendición, mercadería, pagos).
   - El chofer no tiene comisiones.
2. **Armar una APK nueva.**

### App Depósito

- No cambia nada en la app. Sus empleados tienen cuenta personal: la mercadería que retiran es un pedido normal a su cuenta, y **no aparece en la cola de preparación**.

---

## Arreglos de servidor del 20/10 (cheques y cobro doble)

- **Un cheque = un papel** (`lib/cobranzas/cheque-compartido.ts`). En el cobro conjunto del chofer (`/api/chofer/viaje/[id]/cobro`) y en el cobro a varios clientes del vendedor (`/api/viajante/cobro`), un cheque que cubre a varios clientes es UNA fila en `cheques` por el total. Cada pieza de cliente queda con `pagos_detalle.cheque_id` apuntando a esa fila y sin el sufijo " (2)".
  - `cheques_cantidad` de la billetera del vendedor, de la del chofer y de la hoja de ruta cuenta el papel una sola vez.
  - Si rebota, `cheque_rechazar` rechaza todos los cobros sin confirmar que cubría. Si ya había cobros confirmados, la ND va entera al cliente que lo entregó (`cliente_origen_id` = cliente principal).
- **Cheques de cobros sin confirmar**: estado nuevo `EN_VERIFICACION`.
  - Quedan fuera de la cartera, de la proyección de caja, de las órdenes de pago y de Jarvis, porque todo eso filtra `EN_CARTERA`.
  - Pasan a `EN_CARTERA` solos al confirmarse el cobro y a `ANULADO` si el cobro se anula o se rechaza, salvo que otro cliente siga usando el cheque.
  - Los mueve un trigger de la migración `20261020b_cheques_un_papel.sql`.
- **`en_cobro` para el chofer**: `cargarCuentaCobro` (la cuenta de cobro del chofer) manda `en_cobro` por comprobante, con la misma fórmula que la ficha del vendedor (`lib/cobranzas/en-cobro.ts`). La APK chofer actual ya lo descuenta en `saldoCobrable`.
- La cabecera `cobranzas` de un envío queda `anulada` cuando se anulan todos sus pagos.
