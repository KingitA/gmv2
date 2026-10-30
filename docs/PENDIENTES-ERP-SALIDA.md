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
| ~~28~~ | ~~Devolución de un artículo que no está en el comprobante: comprobante anterior o el 0002-00000001~~ | Cuentas corrientes | **Hecho 26/10** (negro → PRES 0002-00000001; blanco → NC con período a ARCA, sin asociado), ver §3 |
| ~~29, 36~~ | ~~Billeteras con plata "fantasma" después de rendir~~ | Cuentas corrientes | **Hecho 26/10**, migración aplicada y verificada (BILLETERA en $0, compensación de retiros $10.000) |
| ~~33~~ | ~~El 10 % contado sobre mercadería ya devuelta (lado servidor de V2)~~ | Cuentas corrientes | **Hecho 26/10** (ver §3) |
| ~~10, 11, 42~~ | ~~Comisiones: "sin cobrar" inflado, pedidos sin número, Playroom en $0~~ | Cuentas corrientes | **Hecho 26/10, falta que Juan aplique** `supabase/migrations/20261026c_comisiones_salida.sql` (ver §3) |
| ~~30~~ | ~~Números sin formato en los textos de la rendición~~ | Cuentas corrientes | **Hecho 26/10** en la misma migración (`fmt_moneda`) |
| ~~37~~ | ~~/caja: el total no descuenta lo que el cliente tiene a cuenta~~ | Cuentas corrientes | **Hecho 26/10** (ver §3) |
| ~~35~~ | ~~Transferencias fuera de la rendición, confirmadas en /caja (lado servidor de C6/V5)~~ | Cuentas corrientes | **Hecho 26/10** (ver §3) |
| ~~25~~ | ~~Tope de devolución en el servidor (lado servidor de C2)~~ | Cuentas corrientes | **Hecho 26/10** (ver §3) |
| ~~23~~ | ~~El servidor rechaza "entregado" en una parada bloqueada sin cobro (lado servidor de C1)~~ | Hojas de ruta/viajes y cobranzas | **Hecho 26/10** (daab2b3, ver §4) |
| ~~27~~ | ~~La parada dice "cobró de menos" cuando sobró~~ | Hojas de ruta/viajes y cobranzas | **Hecho 26/10** (daab2b3, ver §4) |
| ~~22~~ | ~~Cargar bultos o pallets en el ERP antes de finalizar el viaje~~ | Hojas de ruta/viajes y cobranzas | **Hecho 26/10** (e0b8b3f, falta que Juan aplique `supabase/migrations/20261026_pedidos_pallets.sql`) |
| ~~43~~ | ~~Aprobar los gastos del viaje al aceptar la rendición~~ | Hojas de ruta/viajes y cobranzas | **Hecho 26/10** (839f9db, falta que Juan aplique `supabase/migrations/20261026b_viajes_gastos_aprobacion.sql`) |
| ~~21~~ | ~~Hoja del viaje: "PRES 0001-0001-…"~~ | Hojas de ruta/viajes y cobranzas | **Hecho 26/10** (daab2b3, ver §4) |
| ~~13~~ | ~~Pedido con 10 % contado desde la venta (lado servidor de V1)~~ | Listas de precios y descuentos | **Hecho 26/10** (8f907c8, ver §5): campo `bonif_pedido.contado_todo`. Falta la app (V1) |
| ~~16~~ | ~~Condiciones editables hasta facturar, y repreciar al guardar~~ | Listas de precios y descuentos | **Hecho 26/10** (8f907c8, ver §5) |
| 19, 20 | Botón "Anular comprobantes" y volver a emitir con condiciones nuevas | **Listas de precios y descuentos** (dirige el flujo) + Frontend (botón y modal) + Cuentas corrientes (anular todo junto) | **Listas de precios: hecho 26/10** (reglas en `lib/pedidos/anulacion-pedido.ts`, ver §5). **Cuentas corrientes: hecho 26/10** (`lib/pedidos/anular-comprobantes-pedido.ts` + `GET/POST /api/pedidos/[id]/anular-comprobantes`, ver §5). **Frontend: hecho 26/10 (3e44ea2, en main 0af7935)**: botón "Anular comprobantes" en el modal del pedido → `components/pedidos/AnularComprobantesDialog.tsx`. `tieneComprobantes` de `/clientes-pedidos` ahora solo cuenta débitos vivos (la NC/REV espejo de la anulación ya no deja el pedido "con comprobantes") |
| ~~17, 39~~ | ~~Pedido con todo faltante: volver a pendiente o eliminar; que no aparezca como cobrable~~ | Frontend | **Hecho 26/10 (3e44ea2, en main 0af7935)**: aviso en el modal + "Volver a Pendiente" / "Eliminar" (`lib/actions/pedido-sin-mercaderia.ts`, usa `reiniciarPicking`); fuera de cobrables con `lib/pedidos/sin-mercaderia.ts` en `ComprobantesSelector`, `ficha-cliente.ts` y `cliente-viaje.ts` |
| ~~14~~ | ~~Mostrar "preparado 30 de 36" y el total a facturar~~ | Frontend | **Hecho 26/10 (3e44ea2, en main 0af7935)**: `lib/pedidos/totales-pedido.ts`; modal y ficha muestran "30 de 36", "A facturar" (lo preparado) o "Facturado" (débitos vivos) |
| ~~34~~ | ~~Cambiar el color del cheque en /caja y en la cartera~~ | Frontend | **Hecho 26/10 (a9eecd3, en main 0af7935)**: en Caja se toca el color del cheque antes de confirmar (`color_cheques_cambio` en `PATCH /api/pagos/[id]/confirmar` → `cambiarColorChequesPago`); en Cheques, tocando el color de un cheque de tercero en cartera (`PATCH /api/cheques/[id]/color`). La regla automática no cambió |
| ~~40~~ | ~~Chofer "d6ac25bb" sin nombre en el tablero de Finanzas~~ | Frontend | **Hecho 26/10 (78d66d5, en main 0af7935)**: `lib/finanzas/nombres-cobradores.ts` busca en vendedores y usuarios; aplicado en tablero, panel y cajas. Sin migración |
| 9, 12, 4 | Datos: clientes 56, 1381, 765 y 766; artículos mal cargados; recepciones de prueba | Oficina (Juan) | Pendiente |
| P2-01 | Código de cliente nuevo = el siguiente al más alto (ERP, app vendedor y base) | **Cambios general** (agente nuevo, 27/10) | Pendiente (ver §8) |
| P2-02 | Eliminar un cliente de verdad, con cartel "¿Asumir deuda y eliminarlo de todas formas?" | **Cambios general** | Pendiente: faltan 3 decisiones de Juan (ver §8) |

**Agente "Cambios general" (Juan, 27/10):** se hace cargo de todo problema que no le corresponde claramente a un agente existente (cuentas corrientes, frontend, listas de precios y descuentos, hojas de ruta/viajes y cobranzas, apps). Ante la duda de dueño, va a Cambios general.

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
- [x] Se asocia a un **comprobante anterior** del cliente que tenga ese artículo: el de gmv2 o el de la apertura.
- [x] Si el artículo va en **negro**, sale **reversa**; si va en **blanco**, sale **nota de crédito**. Salvo que el cliente esté configurado todo negro o todo blanco: ahí manda el cliente.
- [x] Si **no existe ningún comprobante** con ese artículo (tampoco del sistema viejo), todas esas devoluciones se asocian a un único comprobante **0002-00000001**.

**Dónde:** `app/api/comprobantes-venta/generar-nc-reversa`, `valor-devolucion.ts`, `origen-devolucion.ts`.

**Ojo con lo fiscal:** si el cliente tiene CUIT y el artículo va en blanco, esto **emite una NC con CAE**. En pruebas, solo clientes sin CUIT.

**HECHO 26/10 (cuentas corrientes), sin migración** (`lib/cobranzas/origen-devolucion.ts`):
- Con el artículo en un comprobante de gmv2 → el último que lo tiene, al precio facturado (ya era así). Los de la **apertura no traen artículos** (solo número, tipo y fecha), así que nunca se pueden elegir por artículo.
- Sin comprobante con el artículo y va en **negro** (motor de precios: manda la configuración del cliente) → **REV asociada al PRES 0002-00000001 del cliente**, uno por cliente, en $0, sin renglones y sin libro mayor (no mueve saldo). Se crea solo al guardar la primera devolución que lo necesita (`asegurarComprobanteRespaldo`). La REV queda a favor del cliente y **no baja la comisión de ningún comprobante**. Antes iba al PRES más reciente (URQUIZA: PRES 0001-00000020).
- Sin comprobante con el artículo y va en **blanco** → **NC sin comprobante asociado**, ni en ARCA ni en el sistema (decisión de Juan 26/10: "si no hace falta mentirle a ARCA, menos a nosotros"). A ARCA se le informa el **período asociado** (RG 4540, manual WSFEv1 v4.0: NC/ND informan comprobante asociado *o* período): del 1° del mes a la fecha de emisión (con percepciones tiene que ser el mismo mes, error 10217). La NC dice en observaciones "sin comprobante asociado: período … informado a ARCA". Sin origen no lleva percepción IVA espejo ni 10 % contado. **El camino de período nunca se probó contra ARCA real** (Juan decidió no probarlo): si ARCA lo rechaza, /revision-devoluciones muestra "ARCA rechazó el comprobante: …", no se graba nada y la devolución queda pendiente para reintentar. Antes de esto iba a la factura más reciente, que no tenía el artículo.
- `generar-nc-reversa`: si un origen no tiene saldo (el respaldo en $0) sigue con el próximo en vez de cortar la imputación.

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

- [x] **#10:** "sin cobrar" en `/api/vendedor/comisiones` dio **$2.368.414,82**, cuando lo de la prueba era $104.058,65. Suma $1.917.710,02 de 21 pedidos en **sistema_viejo** (esas comisiones se liquidan en el sistema viejo, regla 36) y $346.646,15 de **10 pedidos eliminados**, porque `kardex.pedido_eliminado` sigue en `false` aunque el pedido esté "eliminado". Hay que excluir los dos y arreglar el flag (o filtrar por el estado del pedido). Revisar también el Playroom y las estadísticas.
- [x] **#11:** `kardex.numero_pedido` queda **null** en los pedidos que entran por la app: 9.143 de 11.279 renglones del último mes. Las listas muestran "—". Tomar el número del pedido, o completarlo al insertar en el kardex (`lib/kardex/insertar-kardex.ts`, desde `createPedido`), y rellenar los existentes.
- [x] **#42:** Playroom → comisiones cobradas de octubre: **$0**, cuando Juan ganó $65.429,71. El tablero lee la tabla vieja de comisiones "cobradas", que ya no se escribe desde la etapa 3. Tiene que leer la comisión acreditada en la cuenta personal, como hizo el agente vendedor en V3 (`comisionGanadaPorComprobante`, `lib/cuenta-corriente/cuenta-personal.ts`).

**HECHO 26/10 (cuentas corrientes), con migración `supabase/migrations/20261026c_comisiones_salida.sql` (falta aplicarla):**
- **#10:** las comisiones se filtran por el **estado del pedido** (`lib/comisiones/pedidos-sin-comision.ts`: `eliminado` y `sistema_viejo` no cuentan), no solo por el flag del kardex: `/api/vendedor/comisiones` (+ detalle) y Playroom vendidas (resumen y pedidos). La migración marca `pedido_eliminado = true` en el kardex de los 41 pedidos eliminados de agosto (borra sus comisiones "vendida" no pagadas, igual que la baja de hoy) y saca eliminados y sistema viejo de `playroom_comisiones_viajantes`. "Sin cobrar" de Juan hoy: $2.271.578,99 → **$7.222,82** (lo de la prueba ya se cobró y pasó a ganadas).
- **#11:** `createPedido` pasa `numero_pedido` al kardex; la migración rellena los 50.076 renglones sin número y agrega el trigger `trg_kardex_numero_pedido` (lo completa al insertar, venga de donde venga).
- **#42:** "cobradas" del Playroom sale de la **cuenta personal** (`lib/comisiones/ganadas.ts`: renglones `comision` referidos al comprobante, netos y revertidos si se anula el cobro), en el resumen, la lista por pedido y el detalle por comprobante (repartido entre artículos según la comisión pactada). "Pagado" = acreditado en su cuenta (de ahí la retira); "Pendiente" = 0. Octubre: **$65.429,71** (Juan, 3 comprobantes del 25/10). Sin migración.

### #25 — Tope de devolución en el servidor (lado servidor de C2) · GRAVE

- [ ] Al crear una devolución (outbox chofer `viaje.devolucion`, vendedor y web), la cantidad por artículo no puede superar **lo vendido menos lo ya devuelto**, contando confirmadas y pendientes.
- [ ] Hoy entraron DEV-00001 y DEV-00002 por las mismas 6 naftalinas de 6 vendidas.

**HECHO 26/10 (cuentas corrientes):** `lib/cobranzas/tope-devolucion.ts` (`excedeTopeDevolucion`) en las 4 entradas: `/api/chofer/viaje/[id]/devolucion` (outbox `viaje.devolucion`), `/api/viajante/devolucion` (outbox `devolucion.registrar`), `/api/devoluciones` (web) y `/api/mostrador/devolucion`. Por renglón y contra su comprobante de origen: cantidad ≤ vendido en ese comprobante − ya devuelto contra él (pendiente, aceptado o con NC; rechazados no cuentan). Responde **409** `{ error, codigo: "TOPE_DEVOLUCION" }` con el detalle ("NAFTALINA PURA x150g: en PRES 0001-00000022 se vendieron 6, ya se devolvieron 6 y querés devolver 1 (máximo 0)"). Sin detalle del artículo en el comprobante (apertura o origen de respaldo de #28) no topea. Verificado contra la prueba: DEV-00002 habría sido rechazada.

### #35 — Transferencias fuera de la rendición, confirmadas en /caja (lado servidor de C6/V5)

**Qué pasó:** al confirmar la rendición del vendedor, la transferencia de $784.600 de URQUIZA **entró directo al Credicoop** (de $13.443.379,93 a $14.227.979,93), sin control de banco.

**Decisión de Juan (26/10):**
- [ ] Las transferencias **no pasan por las rendiciones**: la rendición lleva solo efectivo y cheques.
- [ ] El vendedor o el chofer la anota en la app → aparece en **/caja → "Transf. por confirmar"** → la oficina controla el banco y **la confirma ahí**. Recién entonces entra al banco y a la cuenta del cliente.
- [ ] Ejemplo de Juan: el 26/10 se anota la transferencia y se confirma; el 27/10 el chofer rinde y esa transferencia ya está aceptada y no forma parte de la rendición.
- [ ] Coordinar con las apps (C6 y V5): la rendición propuesta deja de incluirlas.
- [ ] Revisar también la rendición del chofer y `rendicion_crear` / `rendicion_confirmar`: hoy mueven transferencias junto con el efectivo.

**HECHO 26/10 (cuentas corrientes), sin migración:** `crearCobranza` (`lib/cobranzas/crear.ts`, la usan `/api/viajante/cobro` y `/api/chofer/viaje/[id]/cobro`) parte el cobro de la calle: parte física (efectivo, cheque papel) → `pendiente_rendicion` (billetera + rendición); parte digital (transferencia, depósito, echeq) → otro pago **`pendiente`** (`/caja` → "Transf. por confirmar", confirmable ahí; recién al confirmar entra al banco y a la cuenta del cliente). Imputaciones repartidas en orden (primero la digital); `[CREDITOS]`/`[AJUSTE]`/anticipo con la física, `[10% CONTADO]` con las dos (la NC sale una vez por comprobante). Clave de idempotencia derivada para la parte digital. La billetera solo anota la plata física. La rendición ya no incluye transferencias de cobros nuevos (sigue tomando solo `pendiente_rendicion`). La hoja de ruta, la parada del chofer y la ficha del cliente en el viaje cuentan también los pagos `pendiente` como cobrados (si no, el bloqueo de entrega #23 los ignoraba). Test: `mobile/packages/core/test/cobro-transferencia-aparte.test.ts`.

### #37 — /caja no descuenta lo que el cliente tiene a cuenta

**Qué pasó:** FITTERER tenía $20.000 a cuenta, que le había dado al chofer. En /caja, el resumen chico decía "a favor / a cuenta −$20.000 · Saldo de la cuenta $4.403.099,76", pero el **"Total a pagar"** grande y el cálculo del 10 % usaron **$4.423.099,76**. Pagó todo y quedó con $20.000 a favor.

- [x] /caja ofrece **usar lo que está a cuenta** (lo aplica la oficina, regla 39) y muestra el total neto. El 10 % contado se calcula sobre lo que realmente se paga.

**HECHO 26/10 (cuentas corrientes), sin migración:** al elegir el cliente, /caja (`components/caja/registrar-cobro.tsx`) pide `GET /api/pagos-clientes/creditos?cliente_id=` y muestra el recuadro **"Tiene a favor"**: NC/REV vivas y entregas a cuenta (confirmadas, en oficina o sin rendir) con su disponible, sin lo que ya tomaron otros cobros sin confirmar. La oficina tilda lo que usa (se puede bajar el monto) y viaja como `creditos_aplicar` (el servidor ya lo validaba y lo ejecuta al confirmar). Cuenta: **seleccionado − a favor − NC 10 % = a cobrar**; "Total a pagar" del selector también sale neto. El 10 % sigue siendo el de cada comprobante (regla 07/10): la plata a cuenta no lleva 10 % en contra; una NC de mercadería tildada con contado sí (check "10 % en contra", igual que la app vendedor). La lista sale de `lib/cobranzas/creditos-a-favor.ts`, que ahora usa también la ficha del vendedor (`lib/vendedor/ficha-cliente.ts`, misma respuesta). FITTERER hoy: entrega a cuenta del 25/10 con $20.000 disponibles.

### #30 — Números sin formato en los textos de la rendición

- [x] **HECHO 26/10** (`fmt_moneda` en `rendicion_crear` v5 y `rendicion_confirmar` v3, misma migración que #29/#36). Antes: los movimientos de la diferencia de rendición decían "faltan $1000.0000000000000000" y "declaró enviar $45000.00". Tienen que decir **$1.000,00** y **$45.000,00**. Esos textos los arman las funciones SQL de rendición.

---

## 4. Hojas de ruta / viajes y cobranzas

### #23 — El servidor tiene que rechazar "entregado" en una parada bloqueada sin cobro · GRAVE

**Qué pasó:** FITTERER tenía `bloquear_entrega = true` y "cobrar sí o sí $3.784.286,00". La app chofer mandó "entregado" sin cobro y `PATCH /api/chofer/viaje/[id]/parada` lo aceptó.

- [ ] `PATCH .../parada` rechaza `entregado` y `entregado_parcial` si la parada está bloqueada y no se cumplió el cobro exigido. Contá los cobros de la parada, también los pendientes de rendición. Error claro, con código, para que la app lo muestre.
- [ ] Solo deja `no_entregado`.
- [ ] El texto que muestra la app es **"Si no salda lo solicitado, retirar el pedido"**. La app hace su parte (C1).

**HECHO 26/10 (daab2b3, hojas de ruta/viajes y cobranzas):**
- `PATCH /api/chofer/viaje/[id]/parada` responde **409** `{ error, codigo: "ENTREGA_BLOQUEADA", minimo_exigido, cobrado }` si la parada tiene `bloquear_entrega` y lo cubierto no llega a lo exigido. Solo acepta `no_entregado` (y `pendiente` para reabrir). "Lo cubierto" = cobros del viaje (también pendientes de rendición) + 10 % contado y ajuste (`descuentos_cobro`). El `error` empieza con "Si no salda lo solicitado, retirar el pedido". Por el outbox (`viaje.parada`) llega como rechazo definitivo con ese texto y código.
- **Segunda puerta que también estaba abierta:** registrar un cobro cerraba la parada como "entregado" aunque no llegara a lo exigido (`cierreDeParadaPorCobro`). Ahora, si la parada está bloqueada y no cumple, el cobro se registra pero **la parada queda pendiente**.
- La hoja de ruta (`lib/viajes/hoja-ruta.ts`, también `GET /api/chofer/viaje/[id]` y el dataset de la app) trae **`entrega_bloqueada`** (bloqueada y sin cumplir). La web del chofer (`/chofer/[viajeId]`) solo ofrece "No entregué" y muestra el texto.
- Constantes compartidas en `lib/cobranzas/reglas-cobro.ts` (`@gm/cobro`): `TEXTO_ENTREGA_BLOQUEADA`, `CODIGO_ENTREGA_BLOQUEADA`, `cobroCumple`. Tests: `mobile/packages/core/test/entrega-bloqueada.test.ts`.

### #27 — La parada dice "cobró de menos" cuando sobró

- [ ] La parada de CHEN quedó con "Cobró $100.000,00 de $154.329,05 exigidos (parada cerrada al registrar el cobro)". Lo exigido no descontó las devoluciones ni el 10 % contado, y en realidad sobró plata. El texto sale de `lib/cobranzas/reglas-cobro.ts`.
- [ ] Lo exigido tiene que ser **neto** de devoluciones y del 10 % si corresponde, con la misma base que `saldoDeParada`.

**HECHO 26/10 (daab2b3):** `minimo_exigido` es ahora **neto de lo devuelto en el viaje** (misma base que `saldoDeParada` / `total_a_cobrar`) y la parada trae **`descuentos_cobro`**: el 10 % contado y el ajuste de los cobros del viaje (pendientes: lo que bajan del saldo además de la plata; ya rendido: los créditos NC/REV aplicados a los comprobantes del viaje). `cobro_cumplido` = cobrado + descuentos ≥ exigido. El texto del cierre lo muestra aparte: "Cobró $70.000,00 (+ $9.000,00 de 10 % contado / ajuste) de $90.000,00 exigidos". Verificado con el viaje PRUEBA en solo lectura: CHEN cubrió $100.000 + $36.585,36 de REV sobre $154.329,05 → le faltan $17.743,69, lo mismo que quedó debiendo cuando se rechazó DEV-00002 (en la calle, con esa devolución pendiente, daba cumplido). Los textos ya grabados en paradas viejas no se reescriben.

### #22 — Bultos en el ERP

**Decisión de Juan:**
- [ ] Los bultos se cargan **en el ERP**, en cualquier momento antes de **finalizar** el viaje. Al despachar ya deberían estar.
- [ ] Pueden ser **bultos o pallets**.
- [ ] **No bloquea:** un pedido sin bultos se despacha igual, sin alerta.
- [ ] Hoy los 3 pedidos del viaje y la hoja de ruta mostraron 0 bultos. Falta el lugar donde cargarlos, por pedido, en el armado del viaje o en la ficha del pedido.

**HECHO 26/10 (e0b8b3f):** en el detalle del viaje → "Pedidos del viaje", cada pedido tiene **Bultos** y **Pallets** editables mientras el viaje está programado, despachado o en curso (se guardan al salir del campo). `PATCH /api/viajes/[id]/pedidos { pedido_id, bultos?, pallets? }`. No bloquea el despacho ni avisa. La hoja (pantalla, PDF) muestra los pallets junto a los bultos. **Migración `20261026_pedidos_pallets.sql`** (columna `pedidos.pallets`); hasta aplicarla, los pallets se leen en 0 y no se pueden guardar (los bultos sí). La ficha del pedido no tiene el campo: si se quiere también ahí, es de Frontend.

### #43 — Aprobar los gastos del viaje al aceptar la rendición

**Qué pasó:** la nafta ($25.000) quedó "declarado" ("a revisar en oficina") aunque la rendición se confirmó.

**Decisión de Juan:**
- [ ] Al **aceptar la rendición**, la oficina aprueba o carga cada gasto (nafta, camión, peón, hotel u otro), asociado al **vehículo** o al concepto.
- [ ] Queda aprobado con quién y cuándo.
- [ ] La app chofer deja de mostrarlo "a revisar".

**HECHO 26/10 (839f9db):** en **/caja → Controlar rendición**, si la rendición es de un viaje aparece "Gastos del viaje": cada gasto declarado viene **aprobado por defecto**, con su **concepto** (nafta, camión, peón, hotel, peaje, comida, cubierta u otro) y el **vehículo** (por defecto el del viaje); se puede rechazar con motivo. `POST /api/finanzas/rendiciones/[id]/confirmar` recibe `gastos: [{ id, aprobar, categoria?, vehiculo_id?, motivo? }]`: si quedan gastos sin decidir o un rechazo sin motivo, no confirma (400). Se aplican **después** de confirmar con `viaje_gasto_resolver` (queda `revisado_por` / `revisado_at`); si alguno falla, la rendición queda confirmada y se avisa (se resuelve desde el arqueo del viaje). No toca la cuenta de la rendición (gastos congelados al declarar, 20260929). **Migración `20261026b_viajes_gastos_aprobacion.sql`**: `viajes_gastos.vehiculo_id` y el concepto 'camion' (sin aplicar: el vehículo no se guarda y camión pasa a "otro"). Lógica en `lib/viajes/gastos-rendicion.ts`. **Lo de la prueba:** la nafta de $25.000 del viaje PRUEBA sigue "declarado" (la rendición ya estaba confirmada); se aprueba desde el arqueo del viaje o la borra la puesta a cero.

### #21 — "PRES 0001-0001-00000021" en la hoja del viaje

- [ ] El punto de venta se repite. Tiene que decir **"PRES 0001-00000021"**.

**HECHO 26/10 (daab2b3):** la hoja (pantalla, PDF y app chofer) usa `numeroVisible()` de `lib/viajes/hoja-ruta.ts`: el `numero_comprobante` ya trae el punto de venta. Dice "PRES 0001-00000021" (verificado con el viaje PRUEBA).

---

## 5. Listas de precios y descuentos

### #13 — Pedido con 10 % contado desde la venta (lado servidor de V1)

> **Hecho 26/10 (8f907c8) — lado servidor y ERP.** No tocar sin hablar con listas de precios.
> - **Campo:** `pedidos.bonif_pedido.contado_todo` (jsonb existente, **sin migración**): `true` = checkbox tildado (todo el pedido contado), `false` = destildado (nada contado), ausente/`null` = cada artículo según su segmento, ficha y condición por proveedor/marca. Tildado o destildado **le gana a todo** (`resolverContadoItem` en `lib/pricing/resolver.ts`); la lista Especial nunca va contado.
> - **Cómo arranca el checkbox:** `contadoPorDefectoCliente(fichaFilas, condiciones)` (en `@gm/pricing`) → `"todo"` (tildado), `"parcial"` (algún segmento o condición: mostrarlo sin definir y dejar tildar/destildar) o `"nada"`.
> - **Outbox de la app:** va dentro del `bonif_pedido` que ya manda la app al crear/confirmar el pedido (`{ ..., contado_todo: true }`). `createPedido` y `aplicarCondicionesPedidoVendedor` lo guardan; `normalizarBonifPedido` lo conserva.
> - **Al facturar:** cada renglón queda con `pedidos_detalle.contado` y `generar` emite la NC/REV del 10 % de esos comprobantes (lo de siempre, no cambió). Al repreciar se respeta.
> - **ERP:** en la ficha del pedido, "10 % por pago contado en TODO el pedido": Según cada segmento / Sí / No.
> - **Pendiente:** la pantalla de la app (V1, agente vendedor). La REV del 10 % la emite `generar` como siempre: no hace falta nada de cuentas corrientes.

**Decisión de Juan:**
- [ ] Al finalizar el pedido en la app, un checkbox "10 % por pago contado": tildado por defecto si el cliente lo tiene, y tildable si no.
- [ ] El **total del pedido en vivo** lo incluye.
- [ ] El servidor tiene que **guardar la marca en el pedido** y respetarla en el total, al repreciar y al facturar. Hoy existen `pedidos.pago_contado_10`, "Contado 10 %" por segmento en el encabezado del pedido del ERP y las condiciones por proveedor y marca.
- [ ] Definí con el agente vendedor el campo y el formato del outbox, y con cuentas corrientes cómo se emite la REV.

### #16 — Condiciones editables hasta facturar, y repreciar al guardar

> **Hecho 26/10 (8f907c8).** No tocar sin hablar con listas de precios.
> - `lib/pedidos/estados.ts` → `puedeEditarCondiciones(estado)`: estados editables **y `pendiente_facturacion`**. `motivoBloqueo` lo explica.
> - Servidor (`lib/actions/pedidos.ts`): `actualizarEncabezadoPedido` acepta en `pendiente_facturacion` las condiciones (`CAMPOS_CONDICIONES`: listas y métodos general y por segmento, `bonif_pedido`, `bonif_mercaderia_pct`) + la entrega; **si cambia alguna, reprecia solo** (precios de cuando se tomó el pedido, "precio cerrado") y `recalcularTotalPedido` resincroniza el kardex. `guardarCondicionesPedido` y `repreciarPedido` usan `assertCondicionesEditables` (estado + **sin comprobantes vivos**).
> - Artículos, cantidades, precios a mano y cupos de mercadería siguen con `esPedidoEditable` (bloqueados después de preparar).
> - ERP `/clientes-pedidos/[id]`: los controles de condiciones usan `condEditable`; un solo "Guardar" (reprecia una vez).
> - "Condición de pago" a nivel pedido = el contado 10 % (#13). La forma de pago de la ficha del cliente no es del pedido.

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

#### Plan acordado (listas de precios, 26/10) — respuestas de Juan incluidas

> **Actualizado 27/10 (R1, d8e2a39):** el pedido **ya no vuelve a Pendiente Facturación**: queda en su estado y `ESTADO_TRAS_ANULAR` no existe más. Lo pagado contra el pedido **pasa al comprobante nuevo** al volver a generar (`lib/pedidos/refacturar.ts`). Lo de abajo que diga lo contrario quedó viejo.

**Respuestas de Juan (26/10):**
1. Se puede refacturar **hasta que se cobra**: si alguien cobró el 100 % del pedido se bloquea; cobrado en parte, se puede. El estado del pedido (facturado, listo, en viaje, entregado) no importa.
2. **Se anula todo**: los comprobantes del pedido **y** el 10 % contado. Las NC/REV de **devoluciones no** (es mercadería que volvió, con su stock).
3. Lo que el cliente ya pagó **queda a cuenta**: no se reimputa solo.

Idea: **anular = volver el pedido a "Pendiente Facturación"**. Desde ahí rige #16 (condiciones editables, reprecio solo; "Repreciar" lleva a precios de hoy) y se vuelve a generar con el botón de siempre: `generar` ya acepta un pedido cuyos comprobantes están todos anulados y factura las cantidades preparadas (`cantidad-a-facturar.ts`). No hace falta un estado nuevo.

**Hecho por listas de precios (26/10) — NO reescribir, usarlo:** `lib/pedidos/anulacion-pedido.ts`
- `evaluarAnulacionPedido(supabase, pedidoId)` → `{ puede, motivo, aAnular, estado }`. `aAnular` = lo que hay que anular, **en orden**: primero las NC/REV del 10 % contado imputadas a sus comprobantes, después los comprobantes del pedido (fiscales antes que PRES). Si `puede` es false, `motivo` es el texto para la pantalla ("ya está cobrado al 100 %…").
- `reglaAnulacionPedido(estado, comprobantes)`: la parte pura (tests en `mobile/packages/core/test/anulacion-pedido.test.ts`).
- `ESTADO_TRAS_ANULAR = "pendiente_facturacion"`.
- "Cobrado al 100 %" = todos los comprobantes del pedido con `saldo_pendiente` en 0 (pagos, 10 % contado o devoluciones).

**Falta — cuentas corrientes:** `anularComprobantesPedido(supabase, pedidoId, usuarioId)` + `POST /api/pedidos/[id]/anular-comprobantes`:
1. `evaluarAnulacionPedido`; si `!puede` → 422 con `motivo`.
2. Anular cada uno de `aAnular` **en ese orden**, con la misma lógica de `/api/comprobantes-venta/[id]/anular` (sacarla a una función de `lib/` sin cambiar lo que hace: inverso PRES→REV / FA→NC con CAE, libro mayor, cruce con el original, comisión, stock, remito).
3. **Reintentable:** si se corta a la mitad, al volver a llamar `aAnular` ya trae solo lo que sigue vivo.
4. Lo pagado queda **a cuenta** del cliente (respuesta 3): no reimputar.
5. Sin comprobantes vivos: `pedidos.estado = ESTADO_TRAS_ANULAR`, `pago_contado_10 = false` si lo tenía, y `sincronizarKardexPedido`.
6. Respuesta: lista de lo anulado (tipo, número, importe) + lo que quedó a cuenta.

**HECHO — cuentas corrientes (26/10), sin migración:**
- `lib/comprobantes/anular-comprobante.ts` → `anularComprobante(supabase, id, usuarioId)`: la anulación de a uno sacada **tal cual** de `/api/comprobantes-venta/[id]/anular` (la ruta ahora la llama). Los cortes de validación salen como `CorteAnulacion` con el mismo cuerpo y status que antes.
- `lib/pedidos/anular-comprobantes-pedido.ts` → `anularComprobantesPedido(supabase, pedidoId, usuarioId)`: pasos 1-6 de arriba. Además **cruza entre sí lo que deja abierto la anulación**: el inverso del 10 % contado es un débito (ND/PRES) y el de cada comprobante un crédito (NC/REV); sin el cruce quedaban los dos pendientes por el mismo importe. Lo que queda a favor = crédito de la NC/REV de la anulación (respuesta `a_favor`).
- `GET /api/pedidos/[id]/anular-comprobantes` → `evaluarAnulacionPedido` (para el modal). `POST` → anula. Permiso `emitir_comprobantes`. Corte a mitad: `{ error, error_code, anulados, pendientes }` (status del corte); se reintenta con el mismo POST.
- **`generar` (listas de precios, avisado):** el guard "el pedido ya tiene comprobantes" contaba también la NC/REV espejo de la anulación (lleva `pedido_id` y queda viva): un pedido anulado no se podía volver a generar nunca. Ahora solo frenan los **débitos** vivos (FA/FB/FC/PRES/ND). Las NC/REV de devoluciones tampoco frenan.
- **Simulado contra la base (sin ejecutar):** de los 3 pedidos con comprobantes vivos, 001939 (URQUIZA) y 001941 (FITTERER) están cobrados al 100 % → bloqueados. 001940 (CHEN): anula REV 0001-00000018 (10 %) → PRES espejo, y PRES 0001-00000022 → REV espejo; después del cruce CHEN queda con **$121.152,45 a favor** ($100.000 pagados + $21.152,45 de la devolución ya acreditada), y la cuenta pasa de deber $17.743,69 a ese saldo a favor.
- **Ojo para listas de precios:** la devolución de ese pedido sigue viva (no se anula, regla 2). Al volver a generar, las cantidades a facturar tienen que descontar lo devuelto, o se factura de nuevo mercadería que volvió (`cantidad-a-facturar.ts`).

**Falta — frontend:** en el modal del pedido (`/clientes-pedidos`), botón **"Anular comprobantes"** cuando `tieneComprobantes` (ya existe en la página).
- Al abrir, pedir `evaluarAnulacionPedido` (vía la ruta o una server action) y mostrar `aAnular` con número y monto. Si hay FA/FB: "la nota de crédito se emite en ARCA y no se puede deshacer". Si `!puede`: mostrar `motivo` y deshabilitar.
- Al terminar: refrescar y mostrar "Pendiente Facturación: cambiá las condiciones (Editar pedido) o Repreciar, y volvé a Generar". El resto de los botones ya funciona: Repreciar y Generar se habilitan solos cuando no quedan comprobantes vivos.

**Apps:** nada. Ven los comprobantes nuevos por las réplicas de siempre.

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
  - **Aviso de App Depósito (26/10): para "volver a pendiente" usá `reiniciarPicking(supabase, pedidoId)` de `lib/deposito/picking.ts` — NO un `update` de `pedidos.estado`.** Si solo cambia el estado, los renglones siguen en FALTANTE (el pedido aparece "Listo" al 100 % en la web y en la APK) y quedan a nombre de quien los preparó (índice único `ux_picking_items_renglon`, aplicado 21/10): otro operario recibe "Ya lo preparó X" y no puede tocarlos. Verificado en el 001942: sus 3 renglones están en FALTANTE y a nombre de "Juan Cruz". La función pone cada renglón en PENDIENTE con cantidad 0 y sin dueño, cierra sesiones abiertas y recién al final cambia el estado (la cola nunca lo ve "Listo"). Solo acepta pedidos en `pendiente_facturacion` sin renglones facturados (409 `pedido_no_reiniciable` / `pedido_facturado`, mensaje legible) y es idempotente. "Eliminar" no necesita nada del depósito: el pedido sale solo de la cola.
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

---

## Revisión del 27/10 antes de la segunda prueba (sesión de la prueba integral)

Se revisó todo lo marcado como hecho, comparando el código con la decisión de Juan. **Todo está en `main` y publicado. Las 4 migraciones del 26/10 están aplicadas** (billeteras en $0, pallets, gastos, comisiones; ya no queda ninguna venta sin número de pedido). `typecheck:movil` en verde y 415 tests de `mobile/` en verde.

Lo que salió de la revisión, con un número nuevo para seguir la misma tabla. **R1 y R2 se arreglan antes de la segunda prueba de punta a punta.**

| # | Gravedad | Qué pasa | Dónde | Dueño |
|---|---|---|---|---|
| ~~**R1**~~ | ~~GRAVE, frena la prueba~~ | **Hecho 27/10 (d8e2a39, listas de precios).** Solo los débitos vivos (FA/FB/FC/PRES/ND) facturan el pedido: `comprobanteVivoDePedido`, Repreciar y `assertCondicionesEditables` ya no cuentan la REV/NC espejo. `puedeEditarCondiciones(estado, tieneFacturaViva)`: sin débitos vivos las condiciones se cambian **en cualquier estado** (en viaje, entregado). `actualizarEncabezadoPedido` ya no ignora en silencio: si el cambio no se puede aplicar, da error. Reglas de Juan 27/10 aplicadas: **anular no cambia el estado del pedido** (`anular-comprobantes-pedido.ts`), **Generar no lo hace retroceder** (`estadoAlFacturar`), y **lo pagado contra el pedido pasa al comprobante nuevo** (`lib/pedidos/refacturar.ts`: el crédito de la REV/NC espejo del mismo pedido se imputa al nuevo; lo que estaba a cuenta sigue a cuenta). **Probado de punta a punta** con el código real contra la base (cliente TEST-R1 sin CUIT, pedido 9bae0f97, solo PRES/REV): emitir PRES 0023 → entregado → pago parcial $21.506 imputado → anular → lista Bahía → repreciar → emitir PRES 0024: cantidades iguales, total $53.766,70 → $48.006, sigue **entregado**, saldo $26.500 = $48.006 − $21.506. Visto en la prueba, para cuentas corrientes: si falla el PDF de la reversa, `anularComprobante` contesta 500 por un `.update(...).eq(...).catch` (el constructor de supabase no tiene `.catch`), aunque la anulación ya se hizo | `lib/actions/pedidos.ts:1343` (`comprobanteVivoDePedido`) y `:1889` (`repreciarPedidoPreciosActuales`); `actualizarEncabezadoPedido` (`:1301`) | Listas de precios y descuentos |
| ~~**R2**~~ | ~~GRAVE, riesgo fiscal~~ | **Hecho 27/10 (9f464b1, cuentas corrientes).** Ya no hay "factura" por defecto: si no se sabe el origen, decide el **método del cliente** (sin CUIT o todo Presupuesto → REV; todo Factura → NC; método mixto sin dato → **no se emite**, error `ORIGEN_INDETERMINADO`). El período a ARCA va **solo** en el caso exacto del #28 (todos los renglones fiscales sin ningún comprobante); cualquier otra NC sin asociado se frena con `NC_SIN_ASOCIADO`. Verificado en lectura: los clientes 1190, 199 y 556 salen REV | `generar-nc-reversa/route.ts`; `lib/cobranzas/origen-devolucion.ts` | Cuentas corrientes |
| ~~R3~~ | ~~Alta~~ | **Hecho 27/10 (cuentas corrientes, sobre R1 de listas).** La REV del 10 % contado que cubre también otros comprobantes se anula **solo en la parte de este pedido**: un PRES no fiscal por esa parte (`lib/pedidos/anular-parte-contado.ts`), que se cruza con el crédito de la anulación. Si la nota compartida es una **NC fiscal**, se emite sola una **ND con CAE por la parte de este pedido** (Juan 27/10, opción B: `anularComprobante` con `parcial`, mismo camino a ARCA que la anulación entera; neto/IVA calculados para que neto + IVA = la parte exacta e IVA al centavo del 21 %; no se emite dos veces si se reintenta). Simulado sin ARCA real con la NCA 0007-00000006 y 20.000 montos al azar: todos cumplen total exacto e IVA a no más de 1 centavo del 21 % (el 83 % exacto; el resto es el mismo criterio que la NC de apertura). La plata pagada que pasa al comprobante nuevo (refacturar.ts) **cuenta para la comisión** (`liquidar.ts`). Arreglado también el `.catch` de anular-comprobante.ts que contestaba 500 cuando fallaba el PDF | `lib/pedidos/anulacion-pedido.ts`, `anular-comprobantes-pedido.ts`, `anular-parte-contado.ts`, `lib/comisiones/liquidar.ts` | Cuentas corrientes |
| ~~R4~~ | ~~Alta~~ | **Hecho 27/10 (cuentas corrientes).** Al anular un cobro (`DELETE …/cobro/[pagoId]`) de una parada "NO ENTREGAR SIN COBRAR" que quedó cerrada (entregado / solo cobro), si sin ese cobro no llega a lo exigido: con el viaje en curso la parada **vuelve a pendiente** (respuesta `parada_reabierta: true` con el mensaje para el chofer); con el viaje terminado **se frena** la anulación (422 `PARADA_BLOQUEADA_ENTREGADA`). Regla pura `efectoAnulacionEnParada` en `reglas-cobro.ts`, con tests. La app Chofer muestra el mensaje: ver C7 en PENDIENTES-APPS | `app/api/chofer/viaje/[id]/cobro/[pagoId]/route.ts`; `lib/cobranzas/reglas-cobro.ts` | Cuentas corrientes (+ App Chofer: mostrar el mensaje) |
| | | **Observación de hojas de ruta/viajes (27/10) sobre R4, para cuentas corrientes:** `efectoAnulacionEnParada` recibe `descuentos: antes.descuentos_cobro`, que **todavía incluye el 10 % contado / ajuste del cobro que se anula** (la hoja se arma antes de anular). Con un solo cobro no cambia nada (sin la plata no llega igual), pero con **dos o más cobros** en la misma parada bloqueada, el 10 % del anulado puede alcanzar para dar "cumplido" y la parada queda entregada. Sugerencia: restar también la parte de `descuentos_cobro` de ese pago (o rearmar la hoja después de anular y decidir con esa). No lo toqué: es tu endpoint. | `app/api/chofer/viaje/[id]/cobro/[pagoId]/route.ts:72-79` | Cuentas corrientes |
| ~~R5~~ | ~~Alta~~ | **Hecho 27/10 en el servidor (cuentas corrientes).** Si la NC/REV de **devolución** se usa en un cobro contado contra un débito que ese mismo cobro bonifica, ya **no** se asienta el débito del 10 % "en contra": la base del 10 % ya la descuenta (`devueltoPorComprobante`). Se sigue asentando cuando el débito ya tenía su 10 % de antes. **Para Frontend (vistas previas de /caja `registrar-cobro.tsx` y de `cuenta-agregada.tsx`)** la fórmula del servidor es: por cada débito FA/FB/FC/PRES elegido y sin 10 % hecho, `bonif = 10 % × (total_factura − devuelto)`, donde `devuelto` = NC/REV de devolución vivas imputadas a ese comprobante **más** las NC de devolución que se tildan en este cobro contra él. Con tope en lo que se imputa (`min(imputado, bonif)`). El −10 % de lo usado (`cred10`) se resta **solo** cuando el crédito no es de devolución o el débito ya tenía su 10 %. Es sobre el comprobante COMPLETO, no sobre lo que paga este cobro (regla de Juan 27/10) | `lib/cobranzas/creditos.ts`, `post-confirmacion.ts`; vistas previas: `registrar-cobro.tsx:182`, `cuenta-agregada.tsx:55` | Cuentas corrientes (hecho) + **Frontend: hecho 27/10 (08bd3d1)**: las dos vistas previas piden la base al servidor (`POST /api/cobranzas/vista-contado` → `bonificacionPendientePorComprobante` + qué créditos son de devolución; hook `components/pagos/useVistaContado.ts`); la NC de devolución tildada baja la base y no lleva 10 % en contra si el cobro bonifica ese débito |
| ~~R6~~ | ~~Alta~~ | **Hecho 27/10 (cuentas corrientes).** Las dos partes del cobro partido (efectivo + transferencia) llevan `[10% CONTADO]` y la misma marca de par `[CONTADO_PAR:clave]`. La NC/REV del 10 % sale **una sola vez, cuando están confirmadas las dos**, sobre los comprobantes de las dos (la que se confirma primero espera y guarda sus candidatos en `[CONTADO_ESPERA:…]`). Si la otra parte se **rechaza o anula** antes, no hay 10 % (aviso en `bonificacion_error`). Queda abierto un caso: si la otra parte se rechaza **después** de emitida la nota, la nota no se revierte sola (lo mismo que pasaba antes con un cobro no partido) | `lib/cobranzas/crear.ts`, `post-confirmacion.ts`, `lib/constants.ts` | Cuentas corrientes |
| ~~R7~~ | ~~Media~~ | **Hecho 27/10 (cuentas corrientes).** El cruce por nombre compara palabras enteras y significativas (sin S.A., SRL, DE, LA, HNOS…), contra el nombre y la razón social (`nombresCoinciden`, con tests). **Frena** (error del cliente, no del archivo) cuando el código lleva a una **cuenta del personal** con otro nombre, o cuando el nombre del reporte es el de un **empleado** y el código lleva a otro cliente. Probado en lectura con el reporte de prueba (249 clientes): 0 errores nuevos y 2 avisos de nombre mal escrito (622 PALMA BLANCA/BLANSA, 817 TYX PANDA/TYXPanda) | `lib/apertura/importar.ts` | Cuentas corrientes |
| ~~R8~~ | ~~Media~~ | **Hecho 27/10 (cuentas corrientes). Falta aplicar `20261027_devoluciones_tope.sql`.** `PUT /api/devoluciones/[id]` controla el tope con las cantidades finales (409 `TOPE_DEVOLUCION`). Y el tope vive ahora **en la base**: un disparador con candado por (comprobante, artículo) frena al grabar, así dos devoluciones simultáneas no pasan las dos; solo controla cuando la cantidad sube. Las 4 altas, si el disparador frena, borran la cabecera recién creada y contestan 409 (no 500: las apps no reintentan) | `app/api/devoluciones/[id]/route.ts`; altas; `lib/cobranzas/tope-devolucion.ts`; migración | Cuentas corrientes |
| ~~R9~~ | ~~Media~~ | **Hecho 27/10 (cuentas corrientes). Falta aplicar `20261027b_respaldo_devolucion_unico.sql`.** "Todo negro / todo blanco" ya se respeta desde R2 (9f464b1): con el cliente uniforme se saltean los comprobantes de la otra clase. Respaldo **0002-00000001**: índice único por cliente en la base; si dos devoluciones lo crean a la vez, la segunda usa el de la primera. #18: la apertura **frena** el cliente con un PRES viejo que caería en 0002-00000001 o que viene de un punto de venta viejo que no es el 0001 (en el reporte de prueba: 738 PRES, todos del 0001 y ninguno es el número 1). Lo que va al respaldo no tiene contra qué topearse: **lo controla la oficina** (Juan 27/10). En /revision-devoluciones cada renglón del respaldo lleva un aviso con lo que el cliente compró de ese artículo en gmv2 ("compró 25 el 20/10/2026 (PRES …); ¿las otras 25 corresponden a un pedido del sistema viejo?"), `textoAvisoRespaldo`. Y (Juan 27/10) lo devuelto **de más** sobre lo comprado en un PRESUPUESTO ya no se frena: hasta lo disponible va contra ese comprobante y el resto al respaldo, al mismo precio (`repartirExcedenteAlRespaldo` en `prepararRenglonesDevolucion`); en FACTURA sigue el tope. Probado en lectura con el cliente 1190. La app Chofer todavía frena en el celular: C8 en PENDIENTES-APPS | `origen-devolucion.ts`, `respaldo-devolucion.ts`, `lib/apertura/importar.ts`; migración | Cuentas corrientes |
| ~~R10~~ | ~~Baja~~ | **Hecho 27/10 (cuentas corrientes).** Las estadísticas del vendedor leen lo GANADO de su cuenta personal (renglones `comision`): "Comisiones del mes" = comisiones del mes (netas de reversas) y "Pend. retiro" = lo que tiene a favor en su cuenta (lo mismo que "Para retirar" de la billetera). Sin cuenta personal vinculada, sigue la tabla vieja | `app/api/vendedor/estadisticas/route.ts` | Cuentas corrientes |
| ~~R11~~ | ~~Baja~~ | **Hecho 27/10 (cuentas corrientes). Falta aplicar `20261027c_anular_comprobantes_candado.sql`.** Candado por pedido (`pedidos.anulando_comprobantes_at`): la segunda anulación simultánea contesta 409 `ANULACION_EN_CURSO`; el candado se suelta al terminar y vence a los 10 minutos si algo se cuelga. Sin la migración sigue andando como antes (sin candado) | `lib/pedidos/anular-comprobantes-pedido.ts` | Cuentas corrientes |
| R12 | Baja | **#6 hecho 27/10 (cuentas corrientes):** un comprobante con el formato del sistema viejo de un tipo que gmv2 no tiene ("Fact.E", "N.Cr.X", "N.Db.E") ya no entra callado como ajuste: frena ese cliente con el aviso (`pareceComprobanteNoReconocido`, con tests). El texto libre como "FACTURA LOREAL" (socio 1003) sigue entrando como ajuste. Probado en lectura con el reporte de prueba: 0 clientes frenados. **Quedan de sus dueños:** #22 el remito guarda los bultos al generarse y queda viejo si se cargan después; ~~#34 `PATCH /api/cheques/[id]/color` pide solo estar logueado (sin permiso de Caja); #17 si falla el borrado después de `reiniciarPicking`, el pedido vuelve a la cola~~ (**hecho 27/10, 08bd3d1, frontend:** el color pide `requirePermiso("caja")`; "Eliminar" de un pedido con todo faltante es un solo paso desde Pendiente Facturación, sin `reiniciarPicking`, y si falla avisa) | `lib/apertura/parsear-chr.ts`, `importar.ts`; varios | El dueño de cada # |

**Frontend R1/R3 (hecho 27/10, 08bd3d1):** en el modal del pedido, si está cobrado al 100 % el botón dice **"Cobrado al 100 %"**, deshabilitado, con el motivo del servidor al pasar el mouse (se consulta `GET /api/pedidos/[id]/anular-comprobantes` al abrir el pedido). Después de anular, la pantalla ya no lo pasa a "Pendiente Facturación": queda en su estado.

**Respuestas de Juan (27/10):**
1. **#19/#20:** **sí**, un pedido en viaje o entregado también se puede anular y refacturar (ej.: el cliente pagó una parte al chofer y el chofer avisa "hay que refacturarlo"; la oficina lo rehace y el chofer vuelve después a cobrar lo que resta). **El pedido se bloquea recién cuando está cobrado al 100 %.** Al refacturar, **el pedido queda en el estado de logística en que estaba** (entregado sigue entregado, en viaje sigue en viaje, etc.). **Lo ya pagado respeta lo que eligió quien cobró**: si el chofer lo imputó a este pedido, va al comprobante nuevo de este pedido; si lo puso a cuenta de lo anterior, sigue a cuenta de lo anterior.
2. **10 % contado:** es el **10 % de los comprobantes completos**, no de la plata a cuenta ni de pagos parciales. Factura de 00 → NC/REV de 0, pague el cliente 0, 0 o 20. (#37 queda bien como está: el 10 % no baja con la plata a cuenta.)

**Apps:**
- La **App Chofer v0.3.3** se compiló 20 segundos antes de que entrara el login con usuario (T1). La **App Depósito v0.3.1** es de la mañana. **Las dos hay que recompilarlas** (chofer v0.3.4 y depósito v0.3.2) para que tengan el login con usuario.
- La App Vendedor v0.4.5 ya lo tiene.
- Ninguna de las tres está instalada en el NuStar todavía.
- Pendiente menor de la prueba (casilla 0.6): las apps no le ponen nombre al estado "sistema_viejo".

## 8. Segunda prueba integral (27/10) — problemas nuevos

Roadmap: [`PRUEBA-INTEGRAL-SALIDA-2.md`](PRUEBA-INTEGRAL-SALIDA-2.md). Mientras dure la prueba, leer [`AVISO-AGENTES-PRUEBA-2.md`](AVISO-AGENTES-PRUEBA-2.md): nada de probar en producción.

### P2-01 — Código de un cliente nuevo: el siguiente al último, no el primer libre · Dueño: Cambios general

**Regla de Juan (27/10):** el cliente nuevo recibe **el número siguiente al código más alto** (hoy el más alto es 90028 → el próximo es **90029**). Nunca se reusa un hueco (3, 4, 765…).

**Por qué:** con el "primer libre" (`primer_codigo_libre` / `lib/codigos.ts → primerLibre`), el cliente de prueba de un agente se quedó con el **3**. Antes del pase, un alta en gmv2 puede quedarse con el código de un cliente del sistema viejo que todavía no está acá (765, 766…) y la apertura, que reconoce a los clientes por código, le cargaría esa deuda.

**Dónde:** las tres altas tienen que dar lo mismo:
- la base: `public.primer_codigo_libre` / `siguiente_codigo_cliente()` y el disparador `trg_codigo_unico` (migración `20261014_codigos_unicos.sql`);
- `lib/codigos.ts` (`primerLibre`, `siguienteCodigo`), que usan `app/api/codigos/route.ts` y el alta desde la **app vendedor** (`app/api/vendedor/clientes/route.ts`);
- el comentario de cabecera de `lib/codigos.ts` describe la regla vieja: actualizarlo.

Proveedores: Juan no lo pidió; preguntarle si va la misma regla.

**Hecho (30/10, rama `cambios-general-b`) — falta aplicar la migración:**
- `supabase/migrations/20261029b_codigo_cliente_siguiente.sql` (**sin aplicar**): `siguiente_codigo_cliente()` y el disparador dan **el más alto + 1** (hoy 90035); los códigos no numéricos no cuentan. Proveedores sin cambio (primer libre).
- `lib/codigos.ts`: `siguienteAlMayor` para clientes (lo usan `/api/codigos` y el alta de la app vendedor por el servidor: la app no necesita cambios). Textos del alta: "siguiente" en vez de "primero libre".

### P2-02 — "Eliminar" un cliente lo desactiva en vez de eliminarlo · Dueño: Cambios general

**Qué pasa hoy:** el tacho de `/clientes` (`app/clientes/page.tsx:219-226`) pregunta "¿Está seguro de eliminar este cliente?" y hace `update({ activo: false })`: el cliente sigue en la base, con su código ocupado, sus pedidos, comprobantes y saldo, y aparece en "Inactivos". Visto con el cliente 3 "TEST-R1 REFACTURAR" (desactivado por Juan el 27/10 con deuda de $26.500).

**Regla de Juan (27/10):** eliminar tiene que **eliminar** el cliente, no sacarlo de la vista. Si tiene deuda, tiene que aparecer el cartel **"¿Asumir deuda y eliminarlo de todas formas?"**.

**Decisiones de Juan (27/10, por el chat):**
1. **Cliente con comprobantes con CAE:** se borra todo lo demás, pero el cliente queda **escondido** solo para que esas facturas/notas tengan dueño: no aparece en ninguna lista (ni en "Inactivos") ni en búsquedas, y **su código queda libre**.
2. **"Asumir deuda":** la deuda que se asume va a la **caja de ajustes** (P2-03). Hasta que exista, no programar el cartel con un movimiento provisorio: coordinar con P2-03.
3. **Cliente sin deuda pero con pedidos, comprobantes o cobros:** se **conservan** sus pedidos y comprobantes (historial de ventas y comisiones); el cliente desaparece de las listas y de las búsquedas.

**Hecho (30/10, rama `cambios-general-b`) — falta aplicar la migración:**
- `supabase/migrations/20261029c_cliente_eliminar.sql` (**sin aplicar**) + `DELETE /api/clientes/[id]` (solo admin, permiso `eliminar_clientes`); el tacho de `/clientes` llama al servidor.
- Con saldo (deuda o a favor) → no se elimina: "Tiene deuda de $X: primero hay que saldarla" (asumir deuda espera a la caja de ajustes, P2-03). Con pedidos en curso → no se elimina.
- Sin ningún movimiento → se borra. Con historial (comprobantes con o sin CAE, pedidos, cobros, cuenta corriente…) → se conserva el historial, se borra la configuración (bonificaciones, condiciones, zonas, precios calculados) y el cliente queda **escondido** (`clientes.eliminado_at`): fuera de `/clientes` (también de "Inactivos"), de la búsqueda y del aviso de mismo CUIT; **código libre** (queda en `codigo_cliente_eliminado`).

### P2-03 — Caja de ajustes · Dueño: Cambios general · PROPUESTA, espera el OK de Juan

**Idea de Juan (27/10):** un solo lugar donde caen **todos** los ajustes de plata, para ver cada tanto cuánto se ajustó y tomar decisiones.

**Hoy los ajustes están desparramados:** movimientos "ajuste" en la cuenta corriente (Ajustar saldo, texto libre de la apertura), la marca `[AJUSTE:x]` en las observaciones del cobro (redondeo de menos del 1 % desde la app), `AJUSTE_CAJA` en `kardex_contable` (ajuste manual de saldo de cajas y bancos), `cierres_caja.ajuste_kardex_id`, y la tabla `cuenta_corriente_ajustes` (vacía).

**Propuesta — aprobada por Juan el 27/10 con cambios; se termina de definir DESPUÉS de la prueba (no programar antes):**
- No es una caja con plata: ahí no entra ni sale efectivo, así que **no se mezcla con el arqueo** de cajas y bancos. Es un **registro único**: cada ajuste deja un renglón con fecha, de dónde viene, cliente o cuenta, monto (a favor o en contra de la empresa), motivo, quién lo hizo y a qué cobro/comprobante pertenece. El "saldo" de la caja es la suma.
- **Entran:** redondeos de cobros desde **cualquier lugar donde se ingresen pagos** (app chofer, app vendedor, /caja, /pagos-clientes y cualquier otro), "Ajustar saldo" en la ficha, deuda asumida al eliminar un cliente (P2-02) y sobrantes que la oficina decide no dejarle a favor al cliente.
- **No entran (Juan 27/10):** el texto libre de la apertura, los ajustes manuales de saldo de cajas y bancos, las diferencias de rendición (van a la cuenta personal del chofer/vendedor) y el saldo a favor de los clientes (es plata del cliente).
- **Pantalla:** totales por mes, por tipo de ajuste y por usuario, con el detalle de cada renglón.
- **Cuándo:** después de la prueba y antes del pase. Durante la prueba, la sesión de la prueba lista los ajustes a mano desde la base.
- [x] OK de Juan a la idea (27/10). Falta redondearla después de la prueba.

### P2-06 — Listado de pedidos: mostrar la dirección del cliente · Dueño: Frontend

**Pedido de Juan (28/10):** en `/clientes-pedidos`, en el listado, al lado (o debajo) del nombre del cliente tiene que verse la **dirección** (calle y número). Hoy se ve solo "BAHIA BLANCA · LAUMANN KARINA" (localidad · vendedor).

**Dónde:** `app/clientes-pedidos/page.tsx`, renglón del listado. La consulta ya trae `clientes.direccion` (línea ~426), así que no hace falta tocar la base. Que quede: nombre, y abajo "dirección · localidad · vendedor". Si no tiene dirección, como hoy.

### P2-07 — Entrega por transporte: aclarar flete en origen o en destino · Dueño: Cambios general

**Pedido de Juan (28/10):** cuando la condición de entrega del cliente es "Envío por Transporte", tiene que poder elegirse si el flete se paga **en origen** (lo pagamos nosotros al despachar) o **en destino** (lo paga el cliente al recibir). Hoy el alta/ficha del cliente no tiene ese dato. Ver dónde se usa (`condicion_entrega = 'transporte'`, tabla `transportes`) y si tiene que llegar también al pedido, al remito y a la hoja de ruta.

**Hecho (30/10, rama `cambios-general-b`) — falta aplicar la migración:**
- Base (en `20261029d_condicion_entrega.sql`): `clientes.flete_pago` y `pedidos.flete_pago` = `origen` / `destino`, solo con "transporte" (si no, vacío); el pedido nuevo lo copia del cliente. `PATCH /api/clientes/[id]` y `/api/vendedor/cliente/[id]` lo aceptan.
- **Falta (Frontend):** en la ficha / alta del cliente (`app/clientes/[id]/page.tsx`), cuando la forma de entrega es "Envío por transporte", un selector "Flete: en origen (lo pagamos nosotros) / en destino (lo paga el cliente)" que guarde `flete_pago`. Si se quiere en el remito o la hoja de ruta, va aparte.

### P2-08 — Retener entregas desde la ficha del cliente · Dueño: Frontend

**Visto por Juan (28/10):** "retener entregas" (`clientes.retener_entregas`, `retener_motivo`) solo se puede marcar desde Viajes o desde Jarvis; en el alta y en la ficha del cliente no está. Tiene que poder marcarse y desmarcarse desde la ficha (con el motivo), con el mismo efecto que hoy (`lib/viajes/retencion.ts`).

### P2-09 — Dos campos distintos para "retira en el depósito" · Dueño: Cambios general · a verificar

En el alta, "Retira en Mostrador" guarda `condicion_entrega = 'retira_mostrador'` pero deja `retira_en_deposito = false`. Viajes y mostrador miran `condicion_entrega`; el cálculo de precios manual (`lib/pricing.ts`, `app/api/pedidos/route.ts:117`) mira `retira_en_deposito` para **no cobrar flete**. Resultado posible: a un cliente que retira se le suma el flete de su zona. Unificar en un solo dato (o mantener los dos sincronizados). Visto con PRUEBA 5 (90033).

**Hecho (30/10, rama `cambios-general-b`) — falta aplicar la migración:**
- En `20261029d_condicion_entrega.sql`: disparador que mantiene **siempre iguales** `condicion_entrega = retira_mostrador` ↔ `retira_en_deposito = true` (cambiar uno cambia el otro) y sincroniza los clientes existentes (hoy 8 que retiran pasan a `retira_en_deposito = true`: el precio manual deja de sumarles el flete de su zona).

### P2-10 — El alta de cliente no limpia el nombre · Dueño: Frontend · baja

PRUEBA 2 quedó guardado como "PRUEBA 2 " (con espacio al final) y PRUEBA 1 en minúsculas ("prueba1"). El alta debería sacar los espacios de los costados (y, si es la regla de la casa, pasar a mayúsculas como el resto de los clientes).

### P2-15 — Pedidos "en revisión" no se ven en /clientes-pedidos · Dueño: Frontend

El primer pedido de un cliente nuevo tomado en la app vendedor nace **en revisión** (está bien, regla del 09/10). Pero el listado de `/clientes-pedidos` abre filtrado en Pendiente + Impreso y esos pedidos **no aparecen salvo que se toque "Todos"**: la oficina no se entera de que tiene pedidos para revisar. Que "En revisión" esté incluido en el filtro por defecto (o un aviso arriba: "Hay N pedidos para revisar"). Visto con los pedidos 002020 a 002023 (PRUEBA 1 a 4).

### P2-20 — Cambios de estado de un pedido sin registro de quién · Dueño: Cambios general

Entre el 27/10 15:19 y el 28/10 11:40, los pedidos reales **001945, 001956 y 001972** (del 26/10) pasaron de "sistema viejo" a "impreso", y `pedidos.actualizado_por` quedó vacío: no hay forma de saber quién ni cuándo. El cambio manual de estado (`cambiarEstadoPedidoManual`) y cualquier otro cambio de estado tienen que dejar quién y cuándo (y, si existe, una entrada en un historial del pedido).

**Hecho (30/10, rama `cambios-general-b`) — falta aplicar la migración:**
- **Causa encontrada:** reimprimir un pedido lo pasaba a "impreso" en **cualquier** estado (`marcarPedidoImpreso`): así volvieron de "sistema viejo" 001945, 001956 y 001972. Ahora solo pasa a impreso si estaba pendiente o en venta (imprimir un facturado o del sistema viejo no le cambia el estado).
- `supabase/migrations/20261029f_pedidos_historial_estados.sql` (**sin aplicar**): tabla `pedidos_estados_historial` + disparador: cada alta o cambio de estado (lo haga quien lo haga) deja estado anterior, nuevo, usuario, por dónde (sesión / servidor) y cuándo. `pedidos.actualizado_por` pasa a ser siempre el último que cambió el estado. El cambio manual, la impresión y la entrega en mostrador anotan el usuario.

### P2-22 — DOS COMPROBANTES CON EL MISMO NÚMERO · GRAVÍSIMO · Dueño: Cambios general (consultar a Cuentas corrientes)

**Qué pasó (28/10 12:14:57):** Juan apretó Generar en el pedido 002021, cerró el modal, abrió el 002022 y apretó Generar. Salieron **los dos como PRES 0001-00000030** (0,2 s de diferencia): 002021 PRUEBA 2 por $11.647,56 y 002022 PRUEBA 3 por $272.709,24.

**Por qué:** `app/api/comprobantes-venta/generar/route.ts` lee `numeracion_comprobantes.ultimo_numero` (l. ~785), suma 1, inserta el comprobante y recién al final (l. ~1016) guarda el número nuevo. Sin candado y sin índice único en `comprobantes_venta (tipo_comprobante, punto_venta, numero_comprobante)`: dos pedidos generados a la vez leen el mismo número. Lo mismo en `generar-nc-reversa` (l. ~332/533) y `generar-nd` (l. ~140/195). En los **fiscales**, hoy lo frena ARCA (el segundo pide CAE para un número ya autorizado y ARCA lo rechaza) y el índice único de `arca_solicitudes_cae`; pero el segundo usuario recibe un error y nada nuestro lo impide.

**Regla de Juan (28/10): ESTÁ PROHIBIDO que salgan dos comprobantes con el mismo número, de cualquier tipo.** Son 5 máquinas en la oficina; si las 5 aprietan Generar a la vez, no puede pasar nada.

**Qué hay que hacer:**
1. **Número en la base, atómico:** una función que haga `UPDATE numeracion_comprobantes SET ultimo_numero = ultimo_numero + 1 … RETURNING` (o `SELECT … FOR UPDATE`), dentro de la misma transacción que el alta. Para los fiscales, además, **una cola por (tipo, punto de venta)** (candado mientras dura el pedido de CAE a ARCA): uno atrás del otro, nunca en paralelo.
2. **Índice único** en `comprobantes_venta (tipo_comprobante, punto_venta, numero_comprobante)` (antes, resolver el duplicado 0001-00000030 de la prueba; las copias de la apertura tienen su número original).
3. **Facturar varios juntos** (pedido de Juan): en `/clientes-pedidos`, con varios pedidos tildados, además de "Subir a viaje / Crear viaje / Prioridad", un botón **"Facturar"**. Todos los pedidos (los tildados y los de cualquier otra máquina) pasan por **la misma cola**: no se pisan.
4. Probarlo con 5 generaciones simultáneas (PRES y, en homologación sin grabar, FA).

**Hecho (29/10, commit 2e7abb1, rama `cambios-general`) — falta aplicar la migración y el botón en pantalla:**
- `supabase/migrations/20261029_numeracion_atomica.sql` (**sin aplicar**): `numeracion_reservar` (número interno atómico; saltea números que ya existen, p. ej. copias de la apertura), turno fiscal `numeracion_tomar_turno` / `numeracion_soltar_turno` (uno atrás del otro por tipo + PV; vence solo a los 90 s), renumera el PRES 0001-00000030 **anulado** de PRUEBA 3 al siguiente libre (también en su cuenta corriente y kardex; el vivo queda igual), índice único `ux_comprobantes_venta_numero` (anulados incluidos; única excepción: el PRES 0002-00000001 de respaldo de devoluciones, uno por cliente a propósito) y candado por pedido `pedidos.facturando_at`.
- `lib/comprobantes/numeracion.ts`: `reservarNumero` (internos) y `tomarTurnoFiscal` (fiscales: número = último en ARCA + 1, se suelta apenas el comprobante queda grabado; si ARCA rechaza no se consume número ni queda hueco). Lo usan **todos** los caminos: `generar`, `generar-nc-reversa`, `generar-nd`, `anular-comprobante`, `generar-bonificacion` (NC y REV del 10 %), `anular-parte-contado`. Recibos, remitos, OP, retenciones y ND de cheque ya numeraban con candado en la base (sin cambios).
- `generar`: candado por pedido (dos "Generar" del mismo pedido a la vez → el segundo recibe "ya se está facturando").
- **Facturar varios:** `POST /api/comprobantes-venta/generar-lote` `{ pedido_ids: [...] }` (hasta 30): factura uno atrás del otro con el mismo circuito que "Generar" y devuelve qué salió y qué no. **Falta el botón "Facturar" en `/clientes-pedidos` (Frontend).**
- Probado en una base local descartable: 5 máquinas × 20 PRES a la vez → 100 números distintos y correlativos; 30 FA simultáneas con ARCA simulado → sin repetidos ni huecos; turno colgado se libera solo; el índice frena repetidos. Nada probado en producción ni emitido en ARCA.

### P2-21 — "Guardar pedido" tiene que volver a donde estaba · Dueño: Frontend

Al editar un pedido (ej. cambiar la lista) y apretar "Guardar pedido", la pantalla queda en el mismo lugar. Tiene que volver a donde estaba el usuario (el listado / el modal desde donde entró).

### P2-23 — Pedido de contado: el PRES figura "parcial" y la REV del 10 % "pagado" · Dueño: Frontend (consultar a Cuentas corrientes)

Con el 10 % contado tildado al vender (`bonif_pedido.contado_todo`), al generar sale el PRES y **en el mismo momento** la REV del 10 % imputada a ese PRES (diseño #13: si no paga de contado, se anula la REV). En "Comprobantes emitidos" el PRES 0001-00000026 de CHEN figura **"parcial"** (saldo $36.513,45) y la REV 0001-00000025 **"pagado"**. Para Juan se lee mal: el cliente no pagó nada. Mostrarlo como "Pendiente · con 10 % contado" y la REV como "Aplicada al PRES …".

### P2-24 — Anular comprobantes de un pedido "facturado" tiene que volverlo a "pendiente de facturación" · Dueño: Listas de precios y descuentos (dirige #19/#20) + Cuentas corrientes

**Qué pasó (28/10 12:28):** se anuló el PRES 0001-00000030 del pedido 002022 (sale REV 0001-00000026, todo bien en la cuenta) y el pedido **siguió "facturado"**. Se pudo volver a generar (PRES 0001-00000033), pero el estado engaña.

**Regla de Juan (28/10):** si se anulan los comprobantes, el pedido vuelve a **pendiente de facturación**. Se combina con la regla del 27/10 (#19/#20): si el pedido ya está en la logística (listo para enviar/retirar, en viaje, entregado, rechazado) **se queda donde está**; si está "facturado" (todavía en la oficina), vuelve a "pendiente de facturación". Ver `lib/pedidos/anular-comprobantes-pedido.ts` y `estadoAlFacturar` en `lib/pedidos/estados.ts`.

### P2-25 — "Subir a un viaje" no ofrece el viaje ya creado · Dueño: Hojas de ruta/viajes

En `/clientes-pedidos`, al tildar pedidos se abre abajo "subir a un viaje", pero **no aparece ningún viaje** aunque el viaje PRUEBA2 ya estaba creado (28/10 ~12:40). Tiene que listar los viajes abiertos (no despachados) a los que se puede subir.

### P2-26 — "Pedidos del viaje": unificar con la lista de arriba · Dueño: Hojas de ruta/viajes

Dentro del viaje, la sección "Pedidos del viaje" repite la lista de arriba; lo único distinto es sacar pedidos y cargar bultos. Pedido de Juan: **una sola lista**, con la **cruz roja** para sacar el pedido del viaje y la **columna de bultos editable** ahí mismo. El campo de bultos tiene que aparecer **vacío** (no "0"): con 0, al tipear 36 queda "036".

### P2-27 — Bultos + pallets: que se entienda · Dueño: Hojas de ruta/viajes

En la hoja de ruta, un pedido con bultos y pallets se ve "2" grande y abajo "1 pal.": no se sabe si es 1 pallet con 2 bultos o 1 pallet + 2 bultos. Mostrarlo escrito: "2 bultos + 1 pallet" (y en el total "132 bultos + 1 pallet").

### P2-28 — Hoja de ruta: CHEN no descuenta el 10 % contado ya emitido · Dueño: Hojas de ruta/viajes (a verificar en la app chofer)

Pedido 002016 con 10 % contado: al generar salió la REV 0001-00000025 por $4.057,05 imputada al PRES 0001-00000026 (saldo $36.513,45). La hoja del viaje PRUEBA2 muestra en CHEN "este viaje" **$399.991,26** = 40.570,50 + 359.420,76 (los totales brutos); lo que se le cobra es **$395.934,21** (36.513,45 + 359.420,76). Además la instrucción no avisa que es de contado. Ver qué muestra la app chofer.

**HECHO 30/10 (cuentas corrientes, rama `cc-p2`, sin merge, sin migración):** "lo de este viaje" de `saldoDeParada` ahora es **total − créditos ya aplicados** a cada comprobante (REV del 10 % contado, NC de devoluciones emitidas): nuevo `creditosAplicadosA` en `lib/cuenta-corriente/saldo.ts`, usado por `lib/viajes/hoja-ruta.ts` y `lib/viajes/cliente-viaje.ts` (la vista del chofer toma la hoja). Con eso lo exigido también sale neto ("debía $100 con contado → a pagar $90") y lo "cubierto" ya no vuelve a sumar esos créditos. La REV aplicada ya no figura a favor. Cada comprobante de la hoja trae `creditos` (además de `total` y `saldo`). Verificado contra la base: PRES 0001-00000026 de CHEN cuenta $36.513,45 (40.570,50 − 4.057,05). Falta: que la instrucción avise "contado" (lo de la hoja/app).

### P2-36 — /caja: el cheque compartido se ve como dos cheques · Dueño: Frontend (con Cuentas corrientes)

PRUEBA 4 pagó con UN cheque (Provincia n.º 126, $657.726,52) que cubre también a PRUEBA 5. En la base está bien: **un solo papel** (`cheques` "Cheque compartido entre varios clientes"). Pero en la rendición de `/caja` se ven **dos cheques iguales** con montos distintos ($66.209,52 y $591.517). Mostrarlo como un cheque de $657.726,52 repartido entre los dos clientes. Además ese cheque quedó con color **"PENDIENTE"** en la base (los otros dos, NEGRO): ver por qué no tomó color al confirmar.

### P2-37 — El ajuste por redondeo no se confirma en la rendición · Dueño: Cuentas corrientes (va con P2-03)

PRUEBA 2 pagó $11.600 de $11.647,56 y el chofer eligió "Ajuste por redondeo — oficina lo confirma al rendir". Al aceptar la rendición **nadie preguntó nada**: el ajuste de $47,56 entró solo (el PRES quedó saldado). Juan: está bien que sea automático si es menos del 1 %, pero tiene que caer en la **caja de ajustes** (P2-03) y verse en la rendición.

### P2-38 — Movimientos de billetera del chofer que no suman cero · Dueño: Cuentas corrientes · baja

Después de aceptar la rendición, la billetera del chofer da **$0** en `saldos_financieros` y en la app (bien), pero sus renglones en `billetera_movimientos` suman **$1.000**: la diferencia de rendición quedó como un renglón "debito" de **+$1.000** que nadie compensa (la diferencia fue, bien, solo a la cuenta personal). Mismo síntoma que el #29 de la 1ª prueba. Si alguna pantalla suma renglones en vez de leer el saldo, va a mostrar $1.000.

**HECHO 30/10 (cuentas corrientes, rama `cc-p2`, sin merge) — migración `supabase/migrations/20261030_billetera_traspaso_cuenta_personal.sql`, NO APLICADA:** el renglón de la diferencia es el vehículo hacia la cuenta personal (la billetera no lo suma desde #29). La migración agrega, por cada renglón vehículo (`rendicion_saldo_declarado`, `rendicion_diferencia`, `rendicion_devuelta`, `viaje_gasto_rechazado`), su **traspaso** en la billetera: `referencia_tipo = traspaso_cuenta_personal`, importe opuesto, "Pasa a la cuenta personal: …". Lo hace un disparador para los nuevos y un relleno para los que ya están. El traspaso no mueve el saldo (`billetera_saldo_sync`) ni se copia a la cuenta personal. Código: `TIPOS_SOLO_CUENTA_PERSONAL` lo deja fuera de la plata en mano. Simulado contra la base: chofer renglones $1.000 → **$0** = saldo; vendedor $0 sin cambios. La migración termina con una verificación (tiene que dar 0 filas).

### P2-39 — El pedido no toma la "forma de entrega" del cliente · Dueño: Cambios general

PRUEBA 5 (90033) es "Retira en Mostrador", pero su pedido 002024 (tomado en la app vendedor) quedó con `pedidos.condicion_entrega = NULL`. Por eso **no aparece en `/mostrador` → "Para retirar"** (`app/api/mostrador/para-retirar` filtra por la condición del pedido) y podría subirse a un viaje (`app/api/viajes/[id]/pedidos` solo excluye los que dicen retira_mostrador). Desde el 01/10, 358 pedidos tienen la condición vacía y solo 3 la tienen cargada. El alta del pedido (app vendedor → `lib/mobile/outbox/vendedor.ts` / `createPedido`, y el alta desde el ERP) tiene que copiar la condición de entrega del cliente; y las pantallas, si el pedido no la tiene, usar la del cliente. Además, Juan no sabía que existe `/mostrador`: revisar que se llegue fácil (hoy hay un botón "Mostrador" arriba en Pedidos y viajes).

**Hecho (30/10, rama `cambios-general-b`) — falta aplicar la migración:**
- En `20261029d_condicion_entrega.sql`: al crearse un pedido sin forma de entrega copia la del cliente (todas las altas: app vendedor, ERP, mails, importación, mostrador; la app no necesita cambios). Los pedidos existentes no se tocan.
- `/api/mostrador/para-retirar` y `/api/viajes/[id]/pedidos`: un pedido sin forma de entrega usa la del cliente (un pedido viejo de un cliente que retira aparece en "Para retirar" y no se ofrece para un viaje).

### P2-40 — Mostrador "Para retirar": un pedido ya pagado no se puede entregar · Dueño: Frontend (con Cambios general)

En `/mostrador` → "Para retirar", el pedido 002024 de PRUEBA 5 (ya pagado con el cheque de PRUEBA 4, saldo $0) aparece, pero el único botón es **"Cobrar efectivo y entregar"**, que con saldo $0 queda deshabilitado ("Sin saldo"): **no hay forma de entregarlo**. Además: (a) solo cobra en **efectivo** (no transferencia, cheque ni mixto); (b) la entrega se hace con un `update` directo desde el navegador (`app/mostrador/page.tsx:230`), sin registro de quién. Agregar "Entregar" para los pagados (y cobro con los mismos medios que /caja). Ojo: el botón "Mostrador" de arriba en Pedidos y viajes lleva a cargar un pedido nuevo (`/clientes-pedidos/nuevo`), no a `/mostrador`.

**Hecho (30/10, rama `cambios-general-b`):**
- `POST /api/mostrador/entregar` (permiso `cargar_cobros`): pagado → **Entregar**; con saldo → **Cobrar y entregar** con los mismos medios que /caja (efectivo, transferencia, cheque, depósito o varios = mixto, con `MetodoPagoForm`), por el circuito de siempre (`/api/pagos-clientes`, imputado a los comprobantes del pedido). Se entrega solo si el saldo quedó en $0: una transferencia queda pendiente hasta confirmarla en Caja.
- La entrega la hace el servidor y queda quién (`actualizado_por`) y cuándo (historial de P2-20); se sacó el `update` directo desde el navegador. La venta directa de mostrador también anota quién entregó.

### P2-41 — Base del 10 % contado: resta también lo devuelto que fue al respaldo del sistema viejo · Dueño: Cuentas corrientes · decide Juan

URQUIZA (199): PRES 0001-00000027 $318.366,48. DEV-00002 devolvió 36 trapos de un artículo del que compró 24: 24 contra el PRES 0027 ($45.167,52) y 12 al respaldo 0002-00000001 ($22.583,76), pero salió **una sola REV 0001-00000027 por $67.751,28 imputada entera al PRES 0027**. Al cobrar con 10 % contado desde la app vendedor, la REV del 10 % salió por **$25.061,52** = 10 % × (318.366,48 − 67.751,28). Si lo devuelto al respaldo no es de este comprobante, la base sería 318.366,48 − 45.167,52 = 273.198,96 → **$27.319,90** (diferencia $2.258,38). Además el crédito de los 12 del sistema viejo terminó cancelando deuda del PRES 0027 y no del respaldo. Decidir con Juan cuál es la regla y, si corresponde, separar la REV de la parte del respaldo.

**Regla de Juan (29/10):** el 10 % contado es **por comprobante**: cada comprobante que se paga de contado lleva su 10 %, **también los del sistema viejo** (ninguno trae el 10 % hecho). Ejemplo de Juan: PRES viejo 1111 por $10 + PRES 30 por $100 pagados de contado → REV por **$11** ($1 del 1111 y $10 del 30). Por lo tanto, lo devuelto que fue al respaldo (mercadería del sistema viejo) **no** baja la base del PRES 0027: el 10 % correcto era **$27.319,90**, y la REV de la devolución tiene que separar la parte del respaldo. Ojo: el 10 % de un comprobante viejo que sea **factura** sale como NC fiscal.

**HECHO 30/10 (cuentas corrientes, rama `cc-p2`, sin merge, sin migración):**
- **La causa:** `generar-nc-reversa` emite una NC/REV por parte (fiscal / presupuesto) y la imputaba a sus orígenes **en orden hasta agotarla**. El respaldo está en $0 y no toma nada, así que la REV entera ($67.751,28) cayó en el PRES 0027 y `devueltoPorComprobante` (la base del 10 %) contó también lo del sistema viejo.
- **El arreglo:** a cada comprobante de origen se le imputa **solo lo que vale lo devuelto de él** (`importePorOrigen` en `lib/cobranzas/valor-devolucion.ts`: neto + IVA de sus renglones + su parte de las percepciones por neto; la suma da el total al centavo). Lo del respaldo 0002-00000001 o sin origen **queda a favor** del cliente. Con eso la base del 10 % del PRES 0027 es 318.366,48 − 45.167,52 → **$27.319,90** (test `devolucion-por-origen.test.ts`).
- **El 10 % por comprobante, también los del sistema viejo:** ya era así en `generar-bonificacion` (no excluye comprobantes sin pedido; los de la apertura van con `componentesNCFiscal`, y una factura vieja sale como NC fiscal). Sin cambios ahí.
- **Lo que no arregla:** la REV 0001-00000027 de URQUIZA ya emitida sigue imputada entera al PRES 0027 (dato de la prueba; sin datos en producción durante la veda). Si hace falta, se corrige a mano con la oficina.

### P2-42 — App vendedor: el 10 % aparece como "saldo proyectado a favor" · Dueño: App Vendedor — **Hecho 29/10 (5d16867, rama vendedor-p2, APK v0.4.7)**: con deuda real, un proyectado negativo se ve $0 (lista, ficha, Cobrar y Resumen; `datos/saldo.ts`); Cobrar dice "A pagar $X" con el 10 % contado como parte del cálculo.

Al cobrar a URQUIZA con 10 % contado, la app mostró "a favor del cliente: saldo proyectado $25.061,52". Es el 10 % que se le descuenta al pagar, no plata que le quede a favor (el cliente terminó en $0). **Regla de Juan (29/10): no mostrar nada del 10 % como saldo.** Si debía $100 con 10 % contado, la pantalla dice "a pagar $90"; pagó $90 → debe **$0**. Nada de "a favor" ni "saldo proyectado": confunde a los vendedores.

### P2-43 — Devolución hecha antes de refacturar queda con el precio viejo · Dueño: Listas de precios (con Cuentas corrientes) · a verificar

CHEN 002017: la devolución DEV-00001 (2 aceite baby) se valuó a precio **Neco** ($8.105,08, REV 0001-00000028). Después se refacturó el pedido a lista **Bahía** (REV 0001-00000032 anula el PRES 0028; PRES 0001-00000035 $339.161,76, pedido sigue entregado; el pago de $100.000 y la REV de la devolución pasaron al PRES nuevo: saldo $231.056,68). La mercadería devuelta sigue acreditada al precio Neco, más alto que el que ahora se le cobró: el cliente queda con un poco más de crédito del que corresponde. Decidir si al refacturar se revalúan las devoluciones ya hechas.

### P2-44 — "Anular comprobantes" en un pedido cobrado al 100 %: no está bloqueado de entrada y muestra un "éxito" viejo · Dueño: Frontend

PRUEBA 1 (002020, cobrado completo): el botón **no** aparece deshabilitado con "Cobrado al 100 %" (frontend R1/R3 decía que sí). Juan lo apretó, trabajó un rato y recién al final salió "el pedido ya está cobrado al 100 %: no se puede refacturar". Al cerrar, apareció **"Comprobantes generados exitosamente: PRES 0001-00000035"**, que era el aviso del pedido anterior (002017). Verificado en la base: para 002020 no se anuló ni se generó nada; cuenta, comisión, caja y stock sin cambios. Arreglar: deshabilitar el botón de entrada y limpiar el aviso anterior.

### P2-45 — Importar pedido (Excel / .eml): poder borrar un renglón LOW · Dueño: Frontend

Pedido de Juan (29/10, le molesta mucho): en la revisión de un pedido importado por archivo (Excel o .eml), cuando un artículo aparece con coincidencia **LOW**, tiene que haber una **cruz a la derecha del renglón** para borrarlo del pedido. Ver `/imports` y `/clientes-pedidos/import-review` (tablas `imports` / `import_items`).

### P2-46 — La sesión del ERP se cierra cada ~10 minutos · Dueño: Cambios general · URGENTE para la oficina

Pedido de Juan (29/10, le molesta mucho): trabajando 4 personas, el ERP les pide volver a iniciar sesión **cada 10 minutos**. Revisar la renovación de la sesión de Supabase (`middleware.ts`, `lib/supabase/server.ts` / `client.ts`: que el middleware refresque el token y escriba las cookies nuevas en la respuesta), la duración del JWT y del "refresh token" en la configuración de Auth de Supabase, y si hay algún cierre por inactividad. La sesión tiene que durar la jornada.

**Hecho (29/10, commit e432dd8, rama `cambios-general`) — falta que Juan revise el panel de Supabase:**
- En el código no hay ningún cierre por inactividad.
- Causa encontrada en el código: el middleware le da 1,2 s a Supabase (para no pasar el límite de Vercel). Si al vencer el token la renovación o la consulta de roles tardaba más, quedaba "sin usuario" o "sin roles" y mandaba al **login con la sesión viva** (verificado: el corte devuelve `AuthRetryableFetchError`). Si Supabase alcanzaba a rotar el refresh token pero la respuesta se cortaba, la cookie quedaba con el token viejo y a los segundos Supabase daba la sesión por robada y la cerraba de verdad.
- Ahora: en ese caso va a `/auth/renovar`, que renueva desde el navegador (sin el límite) y vuelve a la misma pantalla; si la sesión terminó de verdad, recién ahí va al login; si el servidor no contesta varias veces, avisa con "Reintentar" en vez de dar vueltas. Los tokens renovados viajan también en el request (patrón oficial de `@supabase/ssr`), para que las pantallas del servidor no renueven por segunda vez con el token ya usado.
- **Panel de Supabase (Juan):** Authentication → Sessions: "Time-box user sessions" y "Inactivity timeout" en 0 / desactivados; "Detect and revoke potentially compromised refresh tokens" activado con "Refresh token reuse interval" en 10 s. Project Settings → JWT Keys (o Authentication → Sessions según la versión): "Access token expiry" en 3600 s. Si el JWT está en ~600 s, eso explica el "cada 10 minutos".

### P2-48 — NC por devolución de una factura del sistema viejo: total = precio final, percepciones adentro · Dueño: Cuentas corrientes

**Regla de Juan (29/10):** cuando se devuelve un artículo de una **factura del sistema viejo** (las que entraron por la apertura, sin detalle de artículos), si el precio final es **$100**, la NC sale por **$100 justos**, con **todo adentro**: neto + IVA + percepción IVA + percepción IIBB = $100. Nunca $100 + percepciones.

**Hoy (lectura del código, 29/10):** `lib/cobranzas/origen-devolucion.ts` toma para esos renglones el **neto actual** del artículo para el cliente y `valorDevolucion` (`lib/cobranzas/valor-devolucion.ts`) le suma IVA 21 % y, encima, la **percepción IIBB vigente** (y la de IVA si correspondiera): con alícuota IIBB el total queda por arriba del precio final. Cambiar para este caso: partir del **precio final** y abrir hacia atrás neto, IVA y percepciones de modo que la suma dé exacto al centavo (ARCA valida ImpTotal = ImpNeto + ImpIva + ImpTrib). Las facturas emitidas en gmv2 siguen la regla "tal cual facturado" (21/10). No se probó en vivo porque emitiría una NC fiscal.

**HECHO 30/10 (cuentas corrientes, rama `cc-p2`, sin merge, sin migración; solo tests, nunca contra ARCA):**
- **Qué renglones:** los fiscales **sin renglón facturado** (`exacto = false`: factura de la apertura, o artículo nunca facturado en gmv2 → NC con período). Su precio es el **FINAL** al cliente: `resolverOrigenesDevolucion` sugiere `precio_al_cliente` (antes el neto) y `prepararRenglonesDevolucion`, si una app manda el neto de hoy, lo pasa al final.
- **Cómo se abre:** `abrirPrecioFinal` (`lib/cobranzas/valor-devolucion.ts`) busca el neto tal que neto + IVA 21 % + percepción IVA (si la factura la llevaba) + IIBB vigente = final, **al centavo**. Si por redondeo ningún neto cierra, el centavo va a la percepción IIBB (o a la de IVA): ARCA controla el IVA contra su base; de los tributos, que sumen ImpTrib. Sin ninguna percepción el centavo queda en el neto. `valorDevolucion` usa eso para esos renglones (marca `precioFinal`, la pone `valorDevolucionConOrigen`). Lo "tal cual facturado" no cambia: con solo renglones de gmv2 da lo mismo que antes, al centavo.
- **NC:** el detalle lleva el neto unitario en esos renglones (unitario × cantidad = total del renglón).
- **Ejemplos (tests `nc-precio-final.test.ts`):** final $100 con IIBB 3 % → 80,65 + 16,94 + 2,41 = **$100**; con 10 % contado, 10 × $100 → **$900**; barrido de 220 precios × 4 alícuotas × con/sin percepción IVA: todos cierran exacto.
- **Riesgo:** sin percepciones (cliente sin IIBB ni perc. IVA) hay finales que ningún neto cierra (826,40: 682,97 → 826,39; 682,98 → 826,41): el IVA queda 1 centavo distinto del 21 % de su base. ARCA lo tolera según su redondeo, pero **nunca se probó** (no se emite en pruebas).
- Cambia el valor de las devoluciones **pendientes ya cargadas** con ese origen: antes el precio guardado era neto + IVA + percepciones encima; ahora es final.

### P2-49 — La base de producción se satura a ratos (statement timeout) · Dueño: Cambios general

**Visto (29/10 12:00-12:30):** logs de Vercel llenos de "canceling statement due to statement timeout" en `/api/vendedor/articulos-ventas`, `/api/mobile/sync/vendedor` (vendedor_catalogos) y `/api/vendedor/catalogo`; en la oficina, búsquedas de minutos, errores al guardar y la sesión cortándose. Picos, no caída (Supabase plan Free).

**Medido (solo lectura, 29/10):** `v_articulos_ventas` tarda **12 s** (el corte es 8 s) y recorre los 82.000 renglones de `pedidos_detalle` cada vez (la tabla llevaba 62.000 lecturas completas). El dataset `vendedor_catalogos` no tiene log de cambios: **en cada sync de cada equipo** se arma entero (7 consultas, ventas incluidas) solo para comparar el hash; con cada cambio en `mobile_cambios` todos los equipos resincronizan a los 15 s. `usuarios_roles` llevaba 300.000 lecturas (el middleware la consulta en cada página). La búsqueda de artículos tarda 0,2 s con la base tranquila (0,2-1 s en dos palabras): lo lento era la saturación.

**Hecho (29/10, rama `cambios-general-p249`) — falta aplicar la migración:**
- `supabase/migrations/20261029e_articulos_ventas_nocturno.sql` (**sin aplicar**): `mv_articulos_ventas` (mismo cálculo, guardado), `v_articulos_ventas` lee de ahí (misma forma: nadie cambia nada), se recalcula todas las noches 3:30 con pg_cron sin bloquear, e índice que faltaba `pedidos_detalle(articulo_id)`.
- `lib/memo-compartido.ts`: lo que es igual para todos (catálogo, ventas 180 d, proveedores, cuentas bancarias) se arma una vez y se comparte unos minutos; 5 pedidos a la vez = 1 consulta.
- `/api/mobile/sync/[dataset]`: con la base saturada responde **503 + Retry-After** (60-180 s al azar) en vez de 500.
- Middleware: roles en una cookie firmada (`gm-roles`, HMAC, 5 min, atada al usuario); un cambio de roles tarda hasta 5 min en aplicarse. El id del usuario se lee del token: se terminaron los avisos "Using the user object as returned from supabase.auth.getSession()". Clave: `ROLES_COOKIE_SECRET` en Vercel (si no está, usa la service role key).
- **Pendiente app vendedor (agente de la app):** respetar 503/Retry-After; esperar a que `cambios_seq` quede quieto (~60 s + azar) antes de resincronizar, en vez de a los 15 s de cada cambio; espera creciente entre fallos de sync. Respuesta del snapshot por partes = cambio de protocolo app + servidor, para más adelante.
