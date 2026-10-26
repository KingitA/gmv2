# Pendientes del ERP y del servidor para salir a producción — 26/10/2026

**Para:** agentes de **Cuentas corrientes**, **Frontend**, **Listas de precios y descuentos** y **Hojas de ruta / viajes y cobranzas**.
**De:** sesión "prueba integral de salida de mercadería", con Juan.
**Estado:** abierto. Cada agente tacha lo suyo (`~~…~~` + fecha + commit) en este mismo archivo.

> Todas las tareas tienen dueño (Juan las asignó el 26/10). Si algo de otra área te bloquea, **pedíselo a Juan**; no lo cambies vos.

---

## 1. De dónde salen estos pedidos

Entre el 23 y el 25/10 Juan hizo, con esta sesión, el **recorrido completo de salida de mercadería en producción**, con datos de prueba, como ensayo general del día del pase. El orden fue:
1. puesta a cero (`cc_puesta_a_cero`), limpieza complementaria y pase de los 1.640 pedidos reales viejos al estado nuevo **"sistema_viejo"**;
2. apertura de la deuda del sistema viejo (`/apertura`);
3. pedidos desde la app vendedor, preparación en la app depósito y presupuestos desde el ERP;
4. viaje con bloqueo de entrega y fondo al chofer;
5. entregas, cobros, devoluciones y gasto desde la app chofer;
6. rendición del chofer y del vendedor;
7. cobro en /caja;
8. control de billeteras, comisiones, caja y bancos (cuadraron al peso).

- El paso a paso con los números verificados en la base está en **[`docs/PRUEBA-INTEGRAL-SALIDA.md`](PRUEBA-INTEGRAL-SALIDA.md)**. Cada problema tiene un **#**, el mismo de este documento. Buscalo ahí antes de empezar: tiene el detalle, los importes y la decisión de Juan.
- Lo de las **apps** está en [`docs/PENDIENTES-APPS-SALIDA.md`](PENDIENTES-APPS-SALIDA.md). Varias tareas de acá son **el lado del servidor de una tarea de app**: está marcado, coordiná con ese agente.
- **Ya hecho por esta sesión (no repetir):**
  - estado `sistema_viejo` (pedidos viejos fuera de la cola, del armado de viajes y de los cobrables), en la migración `20261023_prueba_integral.sql`, aplicada;
  - **#15**, facturar lo preparado y no lo pedido en renglones parciales: `lib/pedidos/cantidad-a-facturar.ts`, usada por `generar` y `sincronizarKardexPedido`, verificado.
- **Ya hecho por el agente vendedor el 26/10:** #41, "Mercadería cobrada" = "Comisiones ganadas" (ea55e14).

### Reglas para todos
- Rama propia desde `origin/main`.
- `npm run typecheck:movil` en verde (es obligatorio y también corre el control de formatos).
- Nada a `main` sin el OK de Juan.
- Anotá "en curso" en la tabla del punto 2 **antes** de programar.
- **Formatos** (`docs/FORMATOS.md`): fechas dd/mm/aaaa, $1.000,32, helpers de `lib/formato`.
- **Nunca emitir un comprobante fiscal en pruebas.** Solo PRES y REV, con clientes sin CUIT o en "Presupuesto".
- Datos reales que **no se tocan**: artículos, clientes, proveedores, pedidos, comprobantes con CAE. Todo lo demás es de prueba (regla de Juan).
- Migraciones: las aplica Juan. Dejalas en `supabase/migrations/` y avisale la ruta completa en `gmv2-nuevo`.

### Datos de la prueba (de referencia; NO los uses para probar)
- Clientes 1190 CHEN, 199 URQUIZA y 556 FITTERER (reales: no cambies sus fichas).
- Pedidos 001939 a 001942.
- Viaje "PRUEBA".
- PRES 0001-00000019 a 22, REV 0001-00000018 a 23, DEV-00001 a 04.
- Cuenta personal de Juan: cód. 194.
- Todo se borra el día del pase.

---

## 2. Quién hace qué

| # | Tarea | Dueño | Estado |
|---|---|---|---|
| ~~5, 6, 7, 8, 18~~ | ~~Apertura: importar el reporte real (no frenar todo, texto libre como ajuste, cuentas del personal, segunda columna de saldo, PRES viejos como PV 2)~~ | Cuentas corrientes | **Hecho 26/10** (ver §3) |
| 28 | Devolución de un artículo que no está en el comprobante: comprobante anterior o el 0002-00000001 | Cuentas corrientes | Tomada 26/10 por cuentas corrientes (en cola, en este orden: 29/36, 33, 25, 35, 37, 30, 10/11/42, 28) |
| ~~29, 36~~ | ~~Billeteras con plata "fantasma" después de rendir~~ | Cuentas corrientes | **Hecho 26/10, falta que Juan aplique** `supabase/migrations/20261026_billeteras_sin_fantasma.sql` |
| ~~33~~ | ~~El 10 % contado sobre mercadería ya devuelta (lado servidor de V2)~~ | Cuentas corrientes | **Hecho 26/10** (ver §3) |
| 10, 11, 42 | Comisiones: "sin cobrar" inflado, pedidos sin número, Playroom en $0 | Cuentas corrientes | Tomada 26/10 por cuentas corrientes (en cola, en este orden: 29/36, 33, 25, 35, 37, 30, 10/11/42, 28) |
| ~~30~~ | ~~Números sin formato en los textos de la rendición~~ | Cuentas corrientes | **Hecho 26/10** en la misma migración (`fmt_moneda`) |
| 37 | /caja: el total no descuenta lo que el cliente tiene a cuenta | Cuentas corrientes | Tomada 26/10 por cuentas corrientes (en cola, en este orden: 29/36, 33, 25, 35, 37, 30, 10/11/42, 28) |
| 35 | Transferencias fuera de la rendición, confirmadas en /caja (lado servidor de C6/V5) | Cuentas corrientes | Tomada 26/10 por cuentas corrientes (en cola, en este orden: 29/36, 33, 25, 35, 37, 30, 10/11/42, 28) |
| 25 | Tope de devolución en el servidor (lado servidor de C2) | Cuentas corrientes | Tomada 26/10 por cuentas corrientes (en cola, en este orden: 29/36, 33, 25, 35, 37, 30, 10/11/42, 28) |
| 23 | El servidor rechaza "entregado" en una parada bloqueada sin cobro (lado servidor de C1) | Hojas de ruta/viajes y cobranzas | Pendiente |
| 27 | La parada dice "cobró de menos" cuando sobró | Hojas de ruta/viajes y cobranzas | Pendiente |
| 22 | Cargar bultos o pallets en el ERP antes de finalizar el viaje | Hojas de ruta/viajes y cobranzas | Pendiente |
| 43 | Aprobar los gastos del viaje al aceptar la rendición | Hojas de ruta/viajes y cobranzas | Pendiente |
| 21 | Hoja del viaje: "PRES 0001-0001-…" | Hojas de ruta/viajes y cobranzas | Pendiente |
| 13 | Pedido con 10 % contado desde la venta (lado servidor de V1) | Listas de precios y descuentos | Pendiente |
| 16 | Condiciones editables hasta facturar, y repreciar al guardar | Listas de precios y descuentos | Pendiente |
| 19, 20 | Botón "Anular comprobantes" y volver a emitir con condiciones nuevas | **Listas de precios y descuentos** (dirige el flujo) + Frontend (botón y modal) + Cuentas corrientes (anular todo junto) | Pendiente |
| 17, 39 | Pedido con todo faltante: volver a pendiente o eliminar; que no aparezca como cobrable | Frontend | Pendiente |
| 14 | Mostrar "preparado 30 de 36" y el total a facturar | Frontend | Pendiente |
| 34 | Cambiar el color del cheque en /caja y en la cartera | Frontend | Pendiente |
| 40 | Chofer "d6ac25bb" sin nombre en el tablero de Finanzas | Frontend | Pendiente |
| 9, 12, 4 | Datos: clientes 56, 1381, 765 y 766; artículos mal cargados; recepciones de prueba | Oficina (Juan) | Pendiente |

---

## 3. Cuentas corrientes

### #5, #6, #7, #8, #18 — Apertura: que el reporte real se pueda importar · BLOQUEA EL PASE

**Qué pasó:** el reporte real "Comprobantes Impagos de Clientes" del 23/10 (`C:\Users\INTEL PC1\Desktop\pruebafacimpagasclientesxcodigo.chr`) tiene 1.859 renglones, 249 clientes y $675.632.433,83 de total. Lo leí con `lib/apertura/parsear-chr.ts` en solo lectura: **hoy `/apertura` no deja confirmar nada**, porque unos 34 clientes tienen error y uno solo alcanza para frenar todo. Para la prueba se importó a mano solo el 556.

**Decisiones de Juan:**
- [ ] **#5:** importar los clientes que están bien y mostrar aparte los que hay que corregir. No frenar el archivo entero por un error.
- [ ] **#6:** los **72 renglones de texto libre** de 15 clientes comunes ($65,4 M, casi todos en GRONDONA CHRISTIAN cód. 1000; "CHEQUE RECH (YASH)", "ECHEQ", "10%", "COMISION JULIO", nombres de personas) entran como **ajuste**, igual que "Ajustar saldo" de la cuenta corriente, con el texto original como concepto y el signo del importe.
- [ ] **#7:** las **15 cuentas de empleados, socios y viajantes** (805 renglones, $12,7 M) van a la **cuenta personal** de cada uno. Lo que no es comprobante entra como ajuste, igual que en #6.
- [ ] **#8:** el reporte trae **dos columnas de saldo** (`c[30]` y `c[31]` en `leerReporteImpagos`). La buena es la **segunda (`c[31]`)**, que siempre coincide con la suma de lo pendiente. Ejemplo: DELLI GUSTAVO (169) debe $2.804.921,57, no $2.923.875,09. Hoy el lector compara con la primera, y por eso 17 clientes "no cuadran".
- [ ] **#18:** los PRES del sistema viejo entran como **punto de venta 2**. Juan pasa el archivo con "0001-00117929" y la importación lo graba como **"0002-00117929"**, para que no se mezclen con los PRES nuevos de gmv2, que siguen en el PV 1. La idempotencia (no cargar dos veces) tiene que reconocer el número ya convertido.

**HECHO 26/10 (cuentas corrientes).** Vista previa REAL contra la base (solo lectura) con el archivo del 23/10: 1.859 renglones, 249 clientes, $675.632.433,83; **se cargan 245 clientes por $663.608.194,55** y quedan afuera 4 por $12.024.239,28 (suman el total): **56 y 1381** ("cambió de dueño": CUIT y nombre distintos de la ficha), **765 y 766** (no existen). 507 renglones de texto libre en 22 clientes → AJUSTE (libro mayor, `referencia_tipo ajuste_manual`, observaciones `APERTURA GM AJUSTE — <texto> … [ap:…]`, idempotente). 738 PRES → `0002-…` (guarda el número viejo; reconoce también los ya cargados con PV 1). Avisos que no frenan: CUIT distinto con el mismo nombre (830, 1249, 1501). Los ajustes se ven en "Solo saldos" de la cuenta del cliente (tipo AJUSTE) y no cuentan como descuadre (`lib/cuenta-corriente/descuadres.ts`). La ficha del vendedor trae `ajustes_apertura` (ver PENDIENTES-APPS-SALIDA). Tests: `mobile/packages/core/test/apertura-chr.test.ts`. Archivos: `lib/apertura/parsear-chr.ts`, `lib/apertura/importar.ts`, `app/apertura/page.tsx`.

**Cómo verificar (original):** la vista previa local con el lector real da hoy 1.859 renglones, 249 clientes y $675.632.433,83. Después del cambio, el total importable más el total de los clientes con error tiene que dar ese mismo número. Los 4 clientes del #9 tienen que salir como error o aviso hasta que la oficina los corrija. Ojo: el 56 y el 1381 tienen **otro dueño**, así que **no** los cargues al cliente que hoy tiene ese código (ver #9).

### #28 — Devolución de un artículo que no está en el comprobante

**Qué pasó:** URQUIZA devolvió 3 bolsas residuo 45x60 "de otro pedido". La devolución quedó atada al PRES 0001-00000020, que **no tiene ese artículo**, a $500,98 (REV 0001-00000019). Eso además bajó un poco la comisión de ese PRES.

**Regla de Juan (26/10):**
- [ ] Se asocia a un **comprobante anterior** del cliente que tenga ese artículo: el de gmv2 o el de la apertura.
- [ ] Si el artículo va en **negro**, sale **reversa**; si va en **blanco**, sale **nota de crédito**. Salvo que el cliente esté configurado todo negro o todo blanco: ahí manda el cliente.
- [ ] Si **no existe ningún comprobante** con ese artículo (tampoco del sistema viejo), todas esas devoluciones se asocian a un único comprobante **0002-00000001**.

**Dónde:** `app/api/comprobantes-venta/generar-nc-reversa`, `valor-devolucion.ts`, `origen-devolucion.ts`.

**Ojo con lo fiscal:** si el cliente tiene CUIT y el artículo va en blanco, esto **emite una NC con CAE**. En pruebas, solo clientes sin CUIT.

### #29 y #36 — Billeteras con plata "fantasma" después de rendir

**Qué pasó:**
- **Chofer (#29):** rindió $44.000 de $45.000. Los $1.000 que faltan quedaron como **deuda en la cuenta personal** (`diferencia_rendicion`, debe $1.000) **y además** como **$1.000 "en mano"** en `saldos_financieros` (BILLETERA del usuario `d6ac25bb…`): "queda en billetera del cobrador". Se cuentan dos veces.
- **Vendedor (#36):** cobró $1.000.000 en efectivo + $784.600 por transferencia, retiró $10.000 (debitado en la cuenta personal) y rindió $990.000. Al confirmar, la rendición descontó **$1.784.600** de la billetera, así que la BILLETERA del vendedor `8146a51a…` quedó en **−$10.000**.
- En las dos apps se ve $0,00 en mano, porque calculan por su cuenta. El error está en la base y en el tablero de Finanzas, y puede pegar en la próxima rendición.

**Qué tiene que pasar:**
- [ ] Después de una rendición confirmada, la billetera (plata de la empresa en mano) queda en **$0**.
- [ ] La diferencia va **solo** a la cuenta personal (regla 29 de la auditoría).
- [ ] El retiro, que ya se debitó en la cuenta personal, no se vuelve a restar.

**Dónde:** `rendicion_confirmar` / `rendicion_crear` y el trigger que copia la diferencia a la cuenta personal (migraciones `20260826_rendicion_confirmar_v2_faltante_billetera`, `20260915_rendicion_cc_dos_diferencias`, `20260929_rendicion_fondos_gastos`, `20261019_cc_personal`).

**HECHO 26/10 (cuentas corrientes) — migración `20261026_billeteras_sin_fantasma.sql` (la aplica Juan):** `billetera_saldo_sync` ya no suma a la billetera los movimientos que son de la cuenta personal (`rendicion_saldo_declarado`, `rendicion_diferencia`, `rendicion_devuelta`, `viaje_gasto_rechazado`: `TIPOS_SOLO_CUENTA_PERSONAL` en `lib/cobranzas/billetera-cc.ts`); `rendicion_confirmar` v3 devuelve a la billetera los retiros de la rendición (movimiento `rendicion_retiros`, idempotente); reparación de lo ya rendido y recálculo de `saldos_financieros` BILLETERA. Simulado con los datos de la prueba: chofer $1.000 → $0, vendedor −$10.000 → $0. `/viajantes` y `/api/viajantes/[id]/billetera` usan la misma regla. No toca el libro ni las cuentas personales.

**Además (original):** hay que dejar en $0 la billetera del chofer ($1.000) y la del vendedor (−$10.000). La puesta a cero del pase lo hace sola, pero para las próximas pruebas conviene el arreglo antes.

### #33 — El 10 % contado sobre mercadería ya devuelta (lado servidor de V2)

**Qué pasó:**
- **URQUIZA:** primero se emitieron las REV de devoluciones a precio lleno ($293.597,34); después se cobró contado y `generarBonificacionContado` emitió la **REV 0001-00000022 por $230.921,56**, que es el 10 % de los totales **originales** de los PRES. Lo correcto era **$201.561,82**, el 10 % de lo que el cliente se quedó: **$29.359,74 de más**.
- **CHEN:** el orden fue el inverso (primero el 10 % sobre el total, después la devolución revertida al 90 %) y el saldo final quedó **bien**. El sistema depende del orden.

**Qué tiene que pasar:**
- [ ] La REV del 10 % contado se calcula sobre el comprobante **menos sus reversas o NC de devolución ya emitidas**. El resultado no puede depender del orden.
- [ ] Misma base que la app vendedor (V2) y la app chofer (C3): acordala con esos agentes.

**Dónde:** `lib/comprobantes/generar-bonificacion.ts`.

**HECHO 26/10 (cuentas corrientes):** base del 10% = total − lo imputado por NC/REV de devolución (`lib/cobranzas/devuelto.ts`, `devueltoPorComprobante`). La usan la emisión (`generar-bonificacion`), el `nc_contado` que reciben las apps (`bonif-pendiente`: ficha del vendedor, cuenta de cobro del chofer, cobro del chofer) y el saldo proyectado (`saldo.ts`). Verificado con URQUIZA en la base: daría $201.561,82 (antes $230.921,56). La devolución posterior al cobro ya salía neta del 10%: los dos órdenes terminan iguales. Sin migración.

### #10, #11, #42 — Comisiones mostradas mal

- [ ] **#10:** "sin cobrar" en `/api/vendedor/comisiones` dio **$2.368.414,82**, cuando lo de la prueba era $104.058,65. Suma $1.917.710,02 de 21 pedidos en **sistema_viejo** (esas comisiones se liquidan en el sistema viejo, regla 36) y $346.646,15 de **10 pedidos eliminados**, porque `kardex.pedido_eliminado` sigue en `false` aunque el pedido esté "eliminado". Hay que excluir los dos y arreglar el flag (o filtrar por el estado del pedido). Revisar también el Playroom y las estadísticas.
- [ ] **#11:** `kardex.numero_pedido` queda **null** en los pedidos que entran por la app: 9.143 de 11.279 renglones del último mes. Las listas muestran "—". Tomar el número del pedido, o completarlo al insertar en el kardex (`lib/kardex/insertar-kardex.ts`, desde `createPedido`), y rellenar los existentes.
- [ ] **#42:** Playroom → comisiones cobradas de octubre: **$0**, cuando Juan ganó $65.429,71. El tablero lee la tabla vieja de comisiones "cobradas", que ya no se escribe desde la etapa 3. Tiene que leer la comisión acreditada en la cuenta personal, como hizo el agente vendedor en V3 (`comisionGanadaPorComprobante`, `lib/cuenta-corriente/cuenta-personal.ts`).

### #25 — Tope de devolución en el servidor (lado servidor de C2) · GRAVE

- [ ] Al crear una devolución (outbox chofer `viaje.devolucion`, vendedor y web), la cantidad por artículo no puede superar **lo vendido menos lo ya devuelto**, contando confirmadas y pendientes.
- [ ] Hoy entraron DEV-00001 y DEV-00002 por las mismas 6 naftalinas de 6 vendidas.

### #35 — Transferencias fuera de la rendición, confirmadas en /caja (lado servidor de C6/V5)

**Qué pasó:** al confirmar la rendición del vendedor, la transferencia de $784.600 de URQUIZA **entró directo al Credicoop** (de $13.443.379,93 a $14.227.979,93), sin control de banco.

**Decisión de Juan (26/10):**
- [ ] Las transferencias **no pasan por las rendiciones**: la rendición lleva solo efectivo y cheques.
- [ ] El vendedor o el chofer la anota en la app → aparece en **/caja → "Transf. por confirmar"** → la oficina controla el banco y **la confirma ahí**. Recién entonces entra al banco y a la cuenta del cliente.
- [ ] Ejemplo de Juan: el 26/10 se anota la transferencia y se confirma; el 27/10 el chofer rinde y esa transferencia ya está aceptada y no forma parte de la rendición.
- [ ] Coordinar con las apps (C6 y V5): la rendición propuesta deja de incluirlas.
- [ ] Revisar también la rendición del chofer y `rendicion_crear` / `rendicion_confirmar`: hoy mueven transferencias junto con el efectivo.

### #37 — /caja no descuenta lo que el cliente tiene a cuenta

**Qué pasó:** FITTERER tenía $20.000 a cuenta, que le había dado al chofer. En /caja, el resumen chico decía "a favor / a cuenta −$20.000 · Saldo de la cuenta $4.403.099,76", pero el **"Total a pagar"** grande y el cálculo del 10 % usaron **$4.423.099,76**. Pagó todo y quedó con $20.000 a favor.

- [ ] /caja ofrece **usar lo que está a cuenta** (lo aplica la oficina, regla 39) y muestra el total neto. El 10 % contado se calcula sobre lo que realmente se paga.

### #30 — Números sin formato en los textos de la rendición

- [x] **HECHO 26/10** (`fmt_moneda` en `rendicion_crear` v5 y `rendicion_confirmar` v3, misma migración que #29/#36). Antes: los movimientos de la diferencia de rendición decían "faltan $1000.0000000000000000" y "declaró enviar $45000.00". Tienen que decir **$1.000,00** y **$45.000,00**. Esos textos los arman las funciones SQL de rendición.

---

## 4. Hojas de ruta / viajes y cobranzas

### #23 — El servidor tiene que rechazar "entregado" en una parada bloqueada sin cobro · GRAVE

**Qué pasó:** FITTERER tenía `bloquear_entrega = true` y "cobrar sí o sí $3.784.286,00". La app chofer mandó "entregado" sin cobro y `PATCH /api/chofer/viaje/[id]/parada` lo aceptó.

- [ ] `PATCH .../parada` rechaza `entregado` y `entregado_parcial` si la parada está bloqueada y no se cumplió el cobro exigido. Contá los cobros de la parada, también los pendientes de rendición. Error claro, con código, para que la app lo muestre.
- [ ] Solo deja `no_entregado`.
- [ ] El texto que muestra la app es **"Si no salda lo solicitado, retirar el pedido"**. La app hace su parte (C1).

### #27 — La parada dice "cobró de menos" cuando sobró

- [ ] La parada de CHEN quedó con "Cobró $100.000,00 de $154.329,05 exigidos (parada cerrada al registrar el cobro)". Lo exigido no descontó las devoluciones ni el 10 % contado, y en realidad sobró plata. El texto sale de `lib/cobranzas/reglas-cobro.ts`.
- [ ] Lo exigido tiene que ser **neto** de devoluciones y del 10 % si corresponde, con la misma base que `saldoDeParada`.

### #22 — Bultos en el ERP

**Decisión de Juan:**
- [ ] Los bultos se cargan **en el ERP**, en cualquier momento antes de **finalizar** el viaje. Al despachar ya deberían estar.
- [ ] Pueden ser **bultos o pallets**.
- [ ] **No bloquea:** un pedido sin bultos se despacha igual, sin alerta.
- [ ] Hoy los 3 pedidos del viaje y la hoja de ruta mostraron 0 bultos. Falta el lugar donde cargarlos, por pedido, en el armado del viaje o en la ficha del pedido.

### #43 — Aprobar los gastos del viaje al aceptar la rendición

**Qué pasó:** la nafta ($25.000) quedó "declarado" ("a revisar en oficina") aunque la rendición se confirmó.

**Decisión de Juan:**
- [ ] Al **aceptar la rendición**, la oficina aprueba o carga cada gasto (nafta, camión, peón, hotel u otro), asociado al **vehículo** o al concepto.
- [ ] Queda aprobado con quién y cuándo.
- [ ] La app chofer deja de mostrarlo "a revisar".

### #21 — "PRES 0001-0001-00000021" en la hoja del viaje

- [ ] El punto de venta se repite. Tiene que decir **"PRES 0001-00000021"**.

---

## 5. Listas de precios y descuentos

### #13 — Pedido con 10 % contado desde la venta (lado servidor de V1)

**Decisión de Juan:**
- [ ] Al finalizar el pedido en la app, un checkbox "10 % por pago contado": tildado por defecto si el cliente lo tiene, y tildable si no.
- [ ] El **total del pedido en vivo** lo incluye.
- [ ] El servidor tiene que **guardar la marca en el pedido** y respetarla en el total, al repreciar y al facturar. Hoy existen `pedidos.pago_contado_10`, "Contado 10 %" por segmento en el encabezado del pedido del ERP y las condiciones por proveedor y marca.
- [ ] Definí con el agente vendedor el campo y el formato del outbox, y con cuentas corrientes cómo se emite la REV.

### #16 — Condiciones editables hasta facturar, y repreciar al guardar

**Qué pasó:** después de que el depósito termina el último artículo, el pedido pasa a "Pendiente Facturación" y en el ERP **se bloquea todo** salvo la condición de entrega (`lib/pedidos/estados.ts`: `ESTADOS_EDITABLES`, `puedeEditarEntrega`).

**Regla de Juan:**
- [ ] Los **artículos y cantidades** quedan bloqueados después de preparar, porque son lo que armó el depósito.
- [ ] **Lista, método de facturación, condición de pago, descuentos por segmento y contado 10 %** se pueden cambiar **hasta que el pedido esté facturado**.
- [ ] Al guardar, el pedido se **reprecia solo** y el kardex se resincroniza (`sincronizarKardexPedido`).

### #19 y #20 — Anular comprobantes y volver a emitir · lo dirige Listas de precios y descuentos

**Reparto (Juan, 26/10):**
- **Listas de precios y descuentos** dirige el flujo: que el pedido vuelva a tener las condiciones editables, el repreciado y la nueva emisión.
- **Frontend** hace el botón "Anular comprobantes" en el modal del pedido.
- **Cuentas corrientes** hace la anulación de todos los comprobantes del pedido juntos, con su cuenta corriente, comisión, stock y remito.

Empieza Listas de precios con un plan corto que acuerden los tres.

**Caso real de Juan:** "le pedí al vendedor todo factura", o mitad y mitad, o todo presupuesto; o se cambió la lista en el medio.

**Flujo pedido:**
1. Emitir comprobantes.
2. El cliente quiere refacturar.
3. En el **modal del pedido** aparece el botón **"Anular comprobantes"**, que anula **todos** los comprobantes del pedido juntos (PRES → REV; FA → NC, fiscal en producción).
4. El pedido vuelve a tener las **condiciones** editables, como en #16.
5. Se reprecia.
6. Se vuelve a emitir **sin tocar cantidades**.

Todo lo que eso implica:
- la cuenta corriente se ajusta a lo nuevo;
- la comisión también;
- el stock;
- el remito;
- las apps ven el comprobante nuevo.

**Lo que ya existe:** `app/api/comprobantes-venta/[id]/anular` anula **de a uno**. Por cada uno: asienta la reversa en la cuenta corriente y la cruza con el original, reliquida la comisión, devuelve el stock y anula el remito. **Pero el pedido queda en "Facturado"** y no se puede editar ni volver a generar.

**Detalles a tener en cuenta:**
- [ ] Un pedido puede tener varios comprobantes (URQUIZA tuvo 2, por la condición de ARNANUK).
- [ ] Si el cliente ya había pagado una parte, esa plata queda a favor y la oficina la aplica al comprobante nuevo (regla 39 de la auditoría).

---

## 6. Frontend

### #14 — Preparado y total a facturar en la ficha del pedido

**Qué pasó:** el 001941 se preparó con 30 de 36 PACKx2 y el BATMAN faltante, y se facturó por $638.813,76. La ficha y el modal del pedido siguieron mostrando **36 u.** y **"TOTAL $722.881"**, también ya facturado.

- [ ] Por renglón, después de preparar: **"30 de 36"** (además del color).
- [ ] El total que se va a facturar: la suma de lo preparado, que es lo mismo que `cantidadAFacturar` de `lib/pedidos/cantidad-a-facturar.ts`.
- [ ] Ya facturado: el **total de los comprobantes**, no el del pedido.

### #34 — Color del cheque editable

**Decisión de Juan:**
- [ ] La regla automática queda como está (`lib/actions/color-cheque.ts`: más del 50 % presupuesto = NEGRO; si no, BLANCO).
- [ ] Se tiene que poder **cambiar a mano** al recibirlo en **/caja** y desde la **cartera de cheques**.

### #40 — Chofer sin nombre en el tablero

- [ ] En el tablero de Finanzas, la billetera y las rendiciones del chofer figuran como **"d6ac25bb"**, un pedazo del id del usuario. Tiene que decir el nombre ("Juan Cruz"). Sale de `/api/finanzas/tablero`.

### #17 y #39 — Pedido con todo faltante

**Qué pasó:** el 001942 (FITTERER) se preparó con los 3 renglones faltantes.
- "Generar" mostró **"Comprobantes generados exitosamente:"** con la lista **vacía**, no generó nada, y el pedido quedó en "Pendiente Facturación" para siempre.
- Después, al imputar un cobro en /caja, el modal ofreció ese pedido como **anticipo** ("Sin facturar (anticipo)", $115.545,25).

**Qué tiene que pasar:**
- [ ] "Generar" sobre un pedido sin nada para facturar avisa: **"No hay nada para facturar: todos los renglones están en faltante."**
- [ ] El pedido se puede **volver a "pendiente"** (para prepararlo cuando haya mercadería; vuelve a la cola del depósito) **o pasar a "eliminado"**.
- [ ] Un pedido con todo faltante **no aparece como cobrable** en ningún lado: `components/pagos/ComprobantesSelector.tsx`, `lib/vendedor/ficha-cliente.ts`, `lib/viajes/cliente-viaje.ts`. Son los mismos lugares donde se excluyó `sistema_viejo`.

---

## 7. Oficina (Juan) — no es código

- [ ] **#9:** actualizar el cliente **56** (en el sistema viejo es SANJUMATO S.A., CUIT 30-71698039-8) y el **1381** (DING DAFU, CUIT 20-96309098-7), que cambiaron de dueño. Dar de alta el **765** LA PAMPEANA DISTRIBUIDORA S.A. (30-71835473-7) y el **766** YOU JUNJUN (20-95333922-7). Exportar del sistema viejo **todos** los clientes (código, nombre, CUIT) para armar el listado completo de faltantes.
- [ ] **#12:** el artículo "Cepillo Dent BATMAN/M.MARAVILLA" tiene proveedor "INEXISTENTE", y el "PACKx2 ULTRA BLANCO x90g" no tiene rubro.
- [ ] **#4:** las 2 recepciones de mercadería de prueba se borran antes del pase (van en el script del pase, Fase 10.4 del roadmap).
- [ ] FITTERER (556) quedó con lista **Bahía** desde la prueba: decidir si vuelve a Neco.

---

## 8. Al terminar cada tarea

1. Tachala en la tabla del punto 2, con fecha y commit.
2. En [`docs/PRUEBA-INTEGRAL-SALIDA.md`](PRUEBA-INTEGRAL-SALIDA.md), columna "Estado" de ese #: "Hecho dd/mm (commit)".
3. Si cambia algo que ven las apps, anotalo en [`docs/PENDIENTES-APPS-SALIDA.md`](PENDIENTES-APPS-SALIDA.md) para el agente de la app.
4. Si dejaste una migración, avisale a Juan la ruta completa en `gmv2-nuevo` para que la aplique.
