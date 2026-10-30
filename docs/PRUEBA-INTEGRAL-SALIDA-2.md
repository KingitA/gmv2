# Segunda prueba integral — salida de mercadería (desde cero)

Armado el 27/10/2026 a partir de una auditoría nueva de la base y del código (main `09a3c1c`).
La primera prueba (23 al 27/10) está en [`PRUEBA-INTEGRAL-SALIDA.md`](PRUEBA-INTEGRAL-SALIDA.md); sus recomendaciones se tomaron como ejemplo y se chequearon una por una contra la base.
Aviso para los otros agentes: [`AVISO-AGENTES-PRUEBA-2.md`](AVISO-AGENTES-PRUEBA-2.md).

## Reglas de esta prueba (no se negocian)

1. **Cero comprobantes fiscales.** Ni facturas, ni notas de crédito, ni notas de débito. Solo Presupuestos (PRES) y Reversas (REV). Si sale uno fiscal, es un error encontrado: se anota, se para y se decide con Juan.
2. **Los datos reales no se tocan:** comprobantes con CAE, artículos, clientes, proveedores y los pedidos reales (contenido, artículos, condiciones). Si algo real molesta para la prueba, se esconde, y queda anotado en "Cosas escondidas o forzadas" para deshacerlo después.
3. **Se verifica en la base, no solo en la pantalla.** Cada casilla se tilda cuando cuadra en las dos.
4. **Cada problema va con número** (P2-01, P2-02…) a la tabla "Problemas encontrados", con su dueño. Si no le corresponde claramente a un agente existente, el dueño es **Cambios general** (agente nuevo, Juan 27/10). No se arregla código de otra área: se le escribe el traspaso al agente dueño.
5. **Nada pasa a main sin el OK de Juan.** Este documento vive en la rama `prueba-integral-2`.

## Control fiscal (se corre en cada fase)

Hora de inicio de la prueba: **27/10/2026 15:19:50** (hora de Argentina) → en la consulta: `'2026-10-27 15:19:50-03'`.

```sql
SELECT tipo_comprobante, numero_comprobante, created_at
FROM comprobantes_venta
WHERE created_at >= '2026-10-27 15:19:50-03' AND tipo_comprobante NOT IN ('PRES', 'REV')
  AND COALESCE(observaciones, '') NOT ILIKE 'APERTURA GM%';   -- la apertura copia las FA/NC viejas, sin CAE
-- tiene que dar 0 filas, y además:
SELECT count(*) FROM arca_solicitudes_cae WHERE created_at >= '2026-10-27 15:19:50-03';  -- 0
SELECT count(*) FROM comprobantes_venta WHERE cae IS NOT NULL AND created_at >= '2026-10-27 15:19:50-03';  -- 0
```

**Por dónde puede salir un fiscal** (verificado en el código el 27/10: no hay ningún "candado" que lo frene, Juan decidió el 23/10 no ponerlo):
- Generar un comprobante con el método del cliente o de un renglón en "Factura".
- El 10 % de contado sobre una factura: sale **solo** al confirmar el cobro.
- Devolver un artículo "blanco" que no tiene comprobante: sale una NC con período.
- Refacturar un pedido cubierto por una NC fiscal compartida: sale una ND automática.
- Anular una factura (sale la NC).

1190, 199 y 556 tienen CUIT y son Responsable Inscripto: si algo sale fiscal, sale **A con CAE real**. Los clientes PRUEBA no tienen CUIT (saldría B, igual de fiscal). Antes de cada "Generar" se mira que diga **Presupuesto**, también en cada renglón.

---

## Decisiones de Juan (27/10)

- [x] D1. Apertura con el reporte **completo** del sistema viejo (ensayo real del día del pase). Falta el `.chr` de ese día.
- [x] D2. Cliente 3 "TEST-R1 REFACTURAR": Juan lo borró con el tacho en `/clientes`. **Verificado en la base:** el tacho no lo borra, lo **desactiva**; sigue existiendo con el código 3 y con su pedido 001990, sus comprobantes y su cobro. Lo de plata lo borra la puesta a cero y el pedido lo pasa a "eliminado" el script de la 0.3. El código 3 sigue ocupado: en el reporte viejo del 23/10 **no hay** cliente 3, así que hoy no molesta; se vuelve a mirar con el reporte nuevo (2.3).
- [x] D3. Lista de 556 → Neco. **Verificado:** 1190, 199 y 556 están en Neco y en Presupuesto.
- [x] D4. Bancos y cajas arrancan en **$0**. Juan los ajusta a diario: cada "Ajuste manual de saldo" que haga durante la prueba se anota en la tabla de la 1.8, y el control final es: saldo = suma de los movimientos de la prueba + ajustes anotados.
- [x] D5. Aviso escrito para los agentes: [`AVISO-AGENTES-PRUEBA-2.md`](AVISO-AGENTES-PRUEBA-2.md).
- [x] D6. Más clientes de prueba, para cubrir todo lo que puede pasar en un viaje (ver "Los clientes de la prueba").

---

## Lo que encontré en la auditoría (27/10, 13:30)

### Acceso
- Repositorio: main al día con GitHub (`09a3c1c`). La única rama sin pasar es `finanzas-panel`, con un solo commit de notas (no cambia nada).
- Base: lectura OK con el usuario de solo lectura. Las tablas protegidas (rendiciones, remitos, cajas, mobile_*) me dan 0 aunque tengan datos: esas las verifico por pantalla.
- NuStar conectado: vendedor **0.4.6**, chofer **0.3.6**, depósito **0.3.2** (las últimas).

### Tus cuentas hoy (Juan Cruz Rossi)
| Qué | Hoy | Después de la puesta a cero |
|---|---|---|
| Cuenta personal (cliente 194) | a favor $54.429,71 (comisiones de la 1ª prueba) | $0 |
| Billetera vendedor (8146a51a) | $0 en el tablero | $0, sin movimientos |
| Billetera chofer (d6ac25bb) | $0 en el tablero, los movimientos suman $1.000 (problema 29 de la 1ª) | $0, sin movimientos |
| Comisión "vendida" | $96.197 de los pedidos de prueba 001939-001941 + $7.709 del pedido real 001986 | $0 (ver A2 y A4) |
| Viajes | "PRUEBA" (completado) y "BAHIA · 24/10" (cancelado) | ninguno |

### Saldos de clientes hoy
- 1190 CHEN: debe $17.743,69 · 199 URQUIZA: $0 · 556 FITTERER: a favor $20.000.
- Cliente 3 "TEST-R1 REFACTURAR" (desactivado): debe $26.500.
- Los clientes 1019, 1094, 482, 581 y 676 tienen movimientos que se cancelan ($0): son los 12 comprobantes con CAE. **Se conservan.**

### Plata
- Bancos y cajas con saldos de prueba y ajustes del 26 y 27/10 → todo a $0 (D4).
- Cheques: 1 de prueba en cartera ($100.000) → se borra. Los 3 echeqs propios entregados a proveedores → **se conservan**.

### Pedidos
- 1.640 en "sistema viejo", 302 eliminados.
- **47 reales nuevos en "impreso"** (del 26/10 06:53 al 27/10 13:05): pasan a "sistema viejo". Ninguno es de 1190, 199 o 556.
- De prueba: 001939 y 001940 (entregados), 001941 (listo para enviar), 001942 (pendiente de facturación) y 001990 (cliente 3, entregado).

### Comprobantes
- 15 sin CAE (todos PRES o REV, de prueba) → se borran. 12 con CAE (suman $0) → se conservan.
- Fiscales nuevos desde el 23/10 14:45: **0**.

### Lo que la puesta a cero NO cubre, y otros hallazgos
| # | Qué | Por qué importa | Qué hacemos |
|---|---|---|---|
| A1 | Cliente 3 "TEST-R1 REFACTURAR", creado el 27/10 11:06 por un agente | La importación del sistema viejo reconoce a los clientes **por código**, también a los desactivados. Si el reporte trae un cliente 3, su deuda real iría a este cliente. | Hoy el reporte no tiene cliente 3. El script de la 0.3 pasa su pedido a "eliminado" y le cambia el código a "PRUEBA-R1". Se mira de nuevo en la 2.3. |
| A2 | Pedido real **001986** (cliente 705 CALZETTA), vendido **con tu usuario** el 27/10 06:54 | Si queda en la cola se mezcla con la prueba y te suma comisión. | Pasa a "sistema viejo" (esas comisiones no se cuentan: verificado en el código). Durante la prueba, **no cargues ventas reales con tu usuario**, o avisame para pasarlas cada mañana. |
| A3 | Otros agentes **prueban en la base de producción** (A1 es de hoy) | Si alguien cobra, genera o crea clientes mientras probamos, los controles al peso no cierran. | Aviso escrito (D5). |
| A4 | Pedidos de prueba de la 1ª prueba y el 001990: la puesta a cero no borra pedidos | Quedarían "entregados" sin comprobante, con comisión a tu nombre y apareciendo en fichas. | Pasan a "eliminado" con el script de la 0.3 (no se borran, se guarda copia). |
| A5 | Tabla vieja `finanzas_saldos` (312 renglones, de abril a julio) | La usa el gráfico de evolución de Finanzas. No la toca la puesta a cero. | No se toca. Confirmar con Juan si es real o de prueba (no frena la prueba). |
| A7 | **Un cliente nuevo sin código recibe el primer número libre** (así el de prueba agarró el 3) | Antes del pase, un cliente dado de alta en gmv2 (desde el ERP o desde la **app vendedor**) puede quedarse con un código que en el sistema viejo es de otro cliente que todavía no está en gmv2 (como 765 o 766). El día de la apertura, la deuda de ese cliente iría al nuevo. | **Regla de Juan (27/10): el cliente nuevo recibe el número siguiente al más alto** (hoy 90028 → 90029). Traspaso P2-01. En la prueba, los clientes PRUEBA llevan 90029-90034 (los que daría la regla nueva); el reporte viejo del 23/10 llega hasta 15027. |

---

## Los clientes de la prueba

Todos con **vos de vendedor**, método **Presupuesto** y lista **Neco**. Los PRUEBA son inventados: sin CUIT, Consumidor Final, códigos 90029 a 90034 (no existen en el sistema viejo). Los das de alta vos en `/clientes` (así probamos también el alta y que aparezcan en la app). Al terminar se eliminan (cuando esté arreglado P2-02) y quedan anotados en "Cosas escondidas o forzadas".

| Cliente | Condición | Qué pasa en el viaje | Qué prueba |
|---|---|---|---|
| **199 URQUIZA** | Cuenta corriente, sin condición | Se entrega sin cobrar. Intenta devolver **más de lo vendido**. | Tope de devolución; lo devuelto de más en un PRES va al respaldo 0002-00000001 como "sistema viejo" (C2/#25/C8). Después lo cobra el **vendedor** desde la app (efectivo + transferencia con 10 % contado). |
| **1190 CHEN** (pedido A) | "Cobrar lo de este viaje" + 10 % contado | **Devolución antes del cobro**; paga con **cheque** (foto). | 10 % sobre el comprobante completo (#33/C3); lectura del cheque; cheque en cartera. |
| **1190 CHEN** (pedido B) | Cuenta corriente | Se entrega con un **pago parcial** en efectivo. | Refacturar un pedido entregado con pago parcial (R1/R3), Fase 8b. |
| **556 FITTERER** | Tiene deuda vieja (apertura) + "no entregar si no paga lo anterior" | Intenta entregar sin cobrar → no deja. Cobra → entrega → **anula el cobro** → vuelve a pendiente. Cobra de nuevo con 10 % y **después** hace una devolución. | Bloqueo (R4/C7); 10 % en el otro orden (tiene que dar igual que 1190). Su pedido A va **parcial 30 de 36**; su pedido B queda **todo faltante** y no viaja. |
| **PRUEBA 1** (90029) | Contado efectivo | Paga **de más** → "Dejar $X a cuenta". | Saldo a favor; después se usa en `/caja` contra otro comprobante. |
| **PRUEBA 2** (90030) | Contado efectivo | Paga **apenas menos** (menos del 1 %) → "Ajuste por redondeo". | El ajuste lo confirma la oficina al rendir. |
| **PRUEBA 3** (90031) | Contado | **No entregado** (cerrado), con motivo. | La mercadería vuelve; el pedido se reprograma para el **segundo viaje** (Fase 6b). |
| **PRUEBA 4** (90032) | Contado | Paga con **un cheque que cubre también la deuda de PRUEBA 5** ("Agregar cliente para cobrar"). | Cobro conjunto: un solo cheque imputado a dos clientes. |
| **PRUEBA 5** (90033) | **Retira en mostrador** (no viaja) | Retira en el depósito sin pagar; su deuda se cobra con el cheque de PRUEBA 4. | Pedido sin viaje; cobro de un cliente que no está en el viaje. |
| **PRUEBA 6** (90034) | **Retenido** (en la ficha: retener entregas) | Aparece bloqueado solo; paga **solo con transferencia**. | Bloqueo automático por retención; transferencia que va a "por confirmar" y no a la rendición (#35). |

Además, en el viaje: **gastos** de nafta (con el vehículo), peón y comida; **fondo** entregado al chofer; un **faltante** chico al rendir.

**Formas de pago cubiertas:** efectivo justo, de más (a cuenta), de menos con redondeo, parcial con saldo pendiente, transferencia sola, cheque solo, mixto efectivo + transferencia, un cheque para dos clientes, cuenta corriente sin cobrar, cobro del vendedor fuera del viaje, pago en la oficina, uso de saldo a favor.
**Situaciones de entrega cubiertas:** entregado, entregado con devolución (antes y después del cobro), devolución de más, preparado parcial, todo faltante, no entregado y reprogramado, bloqueado por deuda, bloqueado por retención, retira en mostrador.

---

## Fase 0 — Preparación

- [x] 0.1 Auditoría de base, código, apps y cuentas de Juan (27/10, 13:30).
- [x] 0.2 Decisiones D1-D6 (27/10).
- [x] 0.3 (aplicado por Juan 27/10; verificado: las 3 funciones prueba2_* instaladas, todavía no se corrió) Script complementario `supabase/migrations/20261027d_prueba2_preparar.sql` (escrito 27/10, rama `prueba-integral-2`; probado en lectura: encuentra los 5 pedidos, 18 renglones de kardex y el cliente 3; hoy se niega porque esos pedidos todavía tienen 9 comprobantes, como corresponde antes de la puesta a cero). Juan lo aplica en Supabase (instala las funciones, no cambia datos). Con simulacro y copia en `archivo_pruebas`, pasa a "eliminado" los pedidos 001939, 001940, 001941, 001942 y 001990, y le cambia el código al cliente 3 a "PRUEBA-R1". No toca nada real.
- [x] 0.4 Aviso pasado a todos los agentes (Juan, 27/10 15:05).
- [x] 0.5 NuStar 27/10 15:07: las 3 apps con 0 pendientes de enviar (capturas). Vendedor mostraba la cuenta a favor $54.429,71 de la 1ª prueba; depósito 28 pedidos para preparar y 2 recepciones.
- [x] 0.6 Reporte del 27/10 (`Desktop/facimpagasclientesxcodigo.chr`), leído con el lector del ERP: 1.883 renglones, 251 clientes, 0 errores de lectura, todos los clientes cuadran, saldo total **$704.019.017,98**. No trae cliente 3 ni códigos 90029-90034. 556 debe $3.784.286 (los 2 PRES del 12/06). 199 y 1190 no deben. **Trae a JUAN CRUZ ROSSI (194) con $131.642,05** en 5 PRES del 02/10 al 26/10 (ver 2.4).

## Fase 1 — Todo a cero

Se corre en el editor SQL de Supabase, en este orden. Cada paso con su simulacro primero, que revisamos juntos.

- [x] 1.1 Foto antes (27/10 15:06): 618 clientes (600 activos), 3.293 artículos, 94 proveedores, 1.994 pedidos (1.640 sistema viejo, 302 eliminados, 47 impreso, 3 entregado, 1 listo para enviar, 1 pendiente de facturación), 80.063 renglones, 12 con CAE ($0), 3 echeqs propios. Prueba: 15 comprobantes sin CAE, 4 cheques, 5 cobros, 4 devoluciones, 13 mov. billetera, 0 comisiones cobradas, 2 viajes, 4 preparaciones, 21 mov. de caja, 39 asientos.
- [x] 1.2 `SELECT * FROM cc_puesta_a_cero_simulacro();` → revisamos → `SELECT cc_puesta_a_cero('PONER A CERO');`
  - Simulacro 27/10 ~15:15, coincide con la foto: se borran 15 comprobantes sin CAE, 27 asientos, 5 cobros, 18 imputaciones, 5 recibos, 2 rendiciones, 4 devoluciones, 13 mov. billetera, 1 cheque, 21 mov. de caja, 6 saldos a cero, 2 fondos/gastos; se conservan 12 con CAE, 12 asientos y 6 imputaciones de esos, 3 echeqs, 60.539 comisiones vendidas y los 1.994 pedidos. Controlado aparte: 0 pedidos con la marca de 10 % contado (la puesta a cero la limpia) y 0 extractos bancarios enganchados.
  - Ejecutada por Juan 27/10 ~15:20. Verificado en la base: 0 comprobantes sin CAE, 12 con CAE ($0), 12 asientos, 0 cobros, 0 devoluciones, 0 billetera, 0 mov. de caja, 3 cheques (los echeqs), todas las cajas, bancos, inversiones y billeteras en $0; clientes, artículos, proveedores y pedidos iguales a la foto.
  - Simulacro de la limpieza: 2 viajes, 3 paradas, 1 chofer, 3 zonas, 8 historial, 0 remitos, 4 preparaciones, 2 pedidos a los que se les saca el viaje; BLOQUEA = 0.
- [x] 1.3 (27/10 ~15:25, verificado: 0 viajes, 0 paradas, 0 preparaciones, 0 pedidos con viaje) `SELECT * FROM prueba_limpieza_simulacro();` (la última fila tiene que dar 0) → `SELECT prueba_limpieza('LIMPIAR');`
- [x] 1.4 (hecho 27/10 ~15:30, verificado: los 5 pedidos en eliminado, 18 renglones de kardex marcados, cliente 3 ahora PRUEBA-R1 e inactivo; simulacro 27/10 ~15:25: 5 pedidos, 18 renglones de kardex, cliente 3; BLOQUEA = 0) `SELECT * FROM prueba2_preparar_simulacro();` (la última fila tiene que dar 0) → `SELECT prueba2_preparar('PREPARAR');`
- [x] 1.5 (hecho 27/10 15:19:50: 47 pedidos movidos, copia archivo_pruebas.pedidos_estado_previo_20261027_151950; simulacro 27/10 ~15:30: 47 impreso del 26 al 27/10, 0 con viaje) `SELECT * FROM pedidos_sistema_viejo_simulacro(now(), '{}');` → `SELECT pedidos_pasar_a_sistema_viejo(now(), '{}', 'PASAR');` (pasan los reales nuevos, incluido el 001986).
- [x] 1.6 (27/10 15:22, verificado: 1.687 pedidos en sistema viejo y 307 eliminados, ninguno en otro estado; ningún cliente con saldo distinto de $0; el resto como en la 1.2) Foto después: 0 comprobantes sin CAE, 12 con CAE ($0), 0 cobros, 0 devoluciones, 0 billetera, 0 comisiones cobradas, 0 viajes, 0 preparaciones, cola vacía, todos los saldos en $0, bancos y cajas en $0, clientes/artículos/proveedores sin cambios contra la 1.1.
- [x] 1.7 Hora de inicio: 27/10 15:19:50. Control fiscal a esa hora = 0. **Anotar la hora de inicio** (arriba, en "Control fiscal") y en el aviso.
- [x] 1.8 Bancos y cajas en $0 (D4), verificado 15:22. Cada ajuste que Juan haga durante la prueba se anota acá:

| Fecha y hora | Cuenta | Ajuste | Motivo |
|---|---|---|---|
| 28/10 12:41 | Caja chica | +$50.000 | Juan, para poder entregar el fondo al chofer (la caja arrancó en $0) |

  Si la caja chica en $0 no deja entregarle el fondo al chofer (5.6), es un hallazgo: se anota y Juan carga un monto de prueba en la caja chica (va a esta tabla).
- [x] 1.9 (27/10 15:22: Juan apretó; en la base 0 movimientos nuevos, 0 billetera, 0 comisiones cobradas) `/personal` → "Poner al día": comisiones $0 y la cuenta de Juan en $0.
- [x] 1.10 (verificado en la base 15:22; las pantallas se ven en las fases siguientes) Pantallas del ERP en cero: "Pendientes de revisar" al día, caja del día sin movimientos, `/personal` todo en $0, fichas de 199/1190/556 en $0, cola del depósito vacía, sin viajes, tablero de Finanzas con billeteras en $0.
- [x] 1.11 (27/10 15:22, capturas: vendedor plata en mano $0, cuenta $0, 9 clientes; chofer sin viaje, entró con mail; depósito 0 pedidos para preparar, quedan 2 recepciones de mercadería pendientes = oficina #4, no es de esta prueba; las 3 con 0 pendientes de enviar) Apps: borrar datos de las 3 apps y entrar de nuevo, **una con usuario y otra con mail** (T1). Vendedor: plata en mano $0, cuenta $0, comisiones $0. Chofer: sin viaje, billetera $0. Depósito: 0 pedidos.

## Fase 2 — Importación de deudas del sistema viejo (`/apertura`)

- [x] 2.1 (27/10 ~15:30, captura de Juan) 251 clientes, 1.883 renglones, total $704.019.017,98 (igual a mi lectura). Se cargan **247 por $691.994.778,70**; **4 con error por $12.024.239,28** quedan aparte sin frenar al resto (247 + 4 = total, al peso). Vista previa del `.chr` completo: los clientes con error van **aparte** y no frenan al resto (#5).
- [x] 2.2 (verificado en la base: PRES viejos en 0002, FA/NC/ND con su número original 0002, sin CAE y sin pedidos a ARCA; las REV viejas quedaron en 0001, ver P2-05) En la vista previa: el texto libre entra como ajuste (#6), las cuentas de empleados van a la cuenta personal (#7), se toma la **segunda** columna de saldo (#8), los PRES viejos quedan en punto de venta **0002** (#18).
- [x] 2.3 (errores: 56 y 1381 "cambió de dueño", 765 y 766 "no existe en gmv2" = oficina #9, ya sabidos; avisos que igual cargan: nombre 622 y 817; CUIT distinto 830, 1249, 1470, 1501 → ver P2-04; nada cae en el cliente 3 ni en 90029-90034) Casos raros: 56 y 1381 (cambiaron de dueño), 765 y 766 (no existen en gmv2), que **nada** caiga en el cliente 3 (A1) ni en los PRUEBA 90029-90034.
- [x] 2.4 (verificado: 194 es cuenta personal, saldo $131.642,05) El reporte trae a Juan (194) con $131.642,05. **Decisión de Juan 27/10: entra como deuda.** Verificar que vaya a su cuenta personal y no a un cliente. Para el control final, la cuenta de Juan arranca en −$131.642,05.
- [x] 2.5 (Juan 27/10 ~15:35: 1.290 comprobantes, 71 entregas a cuenta, 508 ajustes, 0 duplicados; en la base 1.869 asientos de 247 clientes, saldo **$691.994.778,70** = lo previsto, al peso) Confirmar. Total importado = total del reporte, al peso.
- [ ] 2.6 La deuda de 556 se ve igual en la base, la ficha del ERP, la antigüedad del tablero y la app vendedor.
- [x] 2.7 (0 comisiones nuevas; 0 con CAE; 0 pedidos a ARCA) La apertura no genera comisiones. Control fiscal = 0.

## Fase 3 — Altas y venta desde la app Vendedor

- [x] 3.1 (28/10, verificado en la base: 90029-90034 con Juan de vendedor, Presupuesto, Consumidor Final, sin CUIT, Neco, Bahía Blanca zona BAHIA, Efectivo; PRUEBA 5 retira en mostrador. El sistema proponía el código **3** = P2-01 confirmado. PRUEBA 6 sin retener: P2-08) Alta en `/clientes` de PRUEBA 1 a 6 con los códigos 90029-90034, vos de vendedor, Presupuesto, Neco. PRUEBA 5 "Retira en mostrador". PRUEBA 6 con "retener entregas".
- [x] 3.2 (28/10, Juan) Los 6 aparecen en la app vendedor después de "Actualizar", con saldo $0.
- [x] 3.3 (28/10 11:11-11:22: 002015 199 $318.366,48; 002016 1190-A $40.570,50 con 10 % contado [bonif_pedido.contado_todo]; 002017 1190-B $359.420,76; 002018 556-A $262.060,44 — sin renglón de 36: el más grande es de **60**, se preparan 50; 002019 556-B $46.587,84; 002020-002025 PRUEBA 1 a 6. Los de PRUEBA 1 a 4 nacieron en revisión (primer pedido, regla del 09/10); PRUEBA 5 y 6 ya en pendiente cuando miré; Juan pasó todos a pendiente) Pedidos desde la app: 199; 1190-A (10 % contado tildado al finalizar, el total en vivo cambia, #13); 1190-B; 556-A (un renglón de 36); 556-B (va a quedar todo faltante); PRUEBA 1 a 6, uno cada uno.
- [x] 3.4 (todos los renglones Presupuesto; 26 renglones de comisión vendida por $83.511,51; fiscales 0; la app muestra los 001986/001830 como "SISTEMA VIEJO" con nombre lindo) Ningún renglón en "Factura". Comisión vendida igual en la app y en la base. Los pedidos aparecen en el ERP con vos de vendedor.

## Fase 4 — Preparación en la app Depósito

- [x] 4.1 (28/10 11:31-11:41, verificado) Preparar completos todos menos 556-A y 556-B.
- [x] 4.2 (002018: renglón 60 → 50 PARCIAL, total 86 de 96; falta ver "50 de 60" en el ERP) 556-A parcial: 30 de 36. El ERP muestra "30 de 36" (#14).
- [ ] 4.3 (002019: 2 renglones FALTANTE, 0 de 20, quedó en pendiente_facturacion; falta ver el aviso en el ERP) 556-B todo faltante: avisa; se puede volver a pendiente o eliminar; no aparece como cobrable en ningún lado (#17/#39).
- [x] 4.4 NO existe en la app → P2-18.

## Fase 5 — Gestión en el ERP

- [ ] 5.1 Condiciones de cada pedido según la tabla de clientes.
- [ ] 5.2 (28/10 12:09-12:19: PRES 0025 002018 $242.164,04 = 50 de 60 OK; PRES 0026 002016 $40.570,50 + REV 0025 10 % $4.057,05; PRES 0027 002015; 0028 002017; 0029 002020; **0030 002021 y 0030 002022 = P2-22** (12:28 anulado el de 002022 → REV 0026; 12:30 regenerado PRES 0033 $272.709,24; saldo PRUEBA 3 OK; pedido quedó "facturado" = P2-24); 0031 002024; 0032 002023. Todos PRES, sin CAE, 0 pedidos a ARCA. Falta 002025 PRUEBA 6) Generar comprobantes: **antes, mirar que diga Presupuesto.** 556-A se factura por 30, no por 36 (#15). Control fiscal = 0.
- [x] 5.3 (002021 PRUEBA 2, Neco → Bahía: $13.045,32 → $11.647,56; P2-21) Modificar un pedido después de preparado: cambiar la lista (nunca el método a Factura) y repreciar (#16).
- [ ] 5.4 PRUEBA 5 retira en mostrador: se le entrega sin viaje y queda debiendo.
- [x] 5.5 (002015 2, 002016 1, 002017 1, 002018 0 + 1 pallet, PRUEBA 1 30, 2 25, 3 32, 4 16, 6 25; hoja: 132 + 1 pal.; P2-26/P2-27) Bultos y pallets cargados en el ERP; el remito y la hoja de ruta los toman (#22).
- [x] 5.6 (viaje PRUEBA2 96240d81…, chofer Juan, BOXER, 8 paradas solo de clientes de prueba, 9 pedidos en viaje; hoja con PRES 0001-000000xx bien; P2-25, P2-28) Armar el viaje con vos de chofer y un vehículo, con 199, 1190 (A y B), 556-A y PRUEBA 1, 2, 3, 4 y 6. Hoja de ruta con los números de PRES bien (#21).
- [x] 5.7 (556: candado + cobrar lo anterior $3.784.286, motivo "debe mucho"; PRUEBA 6: candado + cobrar lo de este viaje $114.291,72, motivo "cliente nuevo"; retención por cliente solo desde Jarvis) Bloqueos: 556 "no entregar si no paga lo anterior"; PRUEBA 6 aparece bloqueado solo por la retención.
- [x] 5.8 (12:42: caja chica −$50.000 → billetera chofer d6ac +$50.000, en la base y en viajes_fondos; caja chica quedó en $0) Entregarle fondo al chofer desde la caja chica. La caja baja y la billetera sube lo mismo, en la base y en el tablero.
- [x] 5.9 Despachado 28/10 12:44. Control fiscal = 0.

## Fase 6 — Entregas desde la app Chofer (primer viaje)

- [x] 6.1 (CHEN muestra $399.991,26 = P2-28 confirmado en la app) El viaje aparece con todas las paradas, las deudas y la billetera = fondo. 556 y PRUEBA 6 con el candado.
- [x] 6.2 (DEV-00001 2 aceite baby $8.105,08 — es del 002017, va al PRES 0028; cheque $28.408,37 al PRES 0026 = P2-29) **1190-A:** devolución parcial **antes** de cobrar → cobra con **cheque** (foto) con 10 % contado. El 10 % sale sobre el comprobante completo.
- [x] 6.3 ($100.000 efectivo) **1190-B:** entregado con pago parcial en efectivo → "Dejar el saldo pendiente".
- [x] 6.4 (DEV-00002 36 trapos consorcio: 24 al PRES 0027 + 12 al respaldo 0002-00000001 creado en $0 = C8 OK; la pantalla no avisa = P2-31) **199:** intentar devolver más de lo vendido → no deja; la pantalla muestra artículo y cantidad. Lo devuelto de más en el PRES va al respaldo 0002-00000001 (C8). Entregado sin cobrar.
- [ ] 6.5 (no deja entregar sin cobrar OK; cheque $3.784.286; la parada se cerró sola; anular cobro no encontrado = P2-33 → se repite en el 2º viaje) **556:** intentar entregar sin cobrar → no deja. Cobrar → entregar → **anular el cobro** → la parada vuelve a pendiente (R4/C7). Volver a cobrar (deuda vieja + pedido) con 10 % y **después** registrar una devolución: el 10 % tiene que salir con la misma regla que 6.2.
- [x] 6.6 ($60.000 efectivo) **PRUEBA 1:** paga de más en efectivo → "Dejar $X a cuenta".
- [x] 6.7 ($11.600, [AJUSTE:47.56]) **PRUEBA 2:** paga apenas menos (menos del 1 %) → "Ajuste por redondeo".
- [x] 6.8 (no_entregado "Cerrado") **PRUEBA 3:** no entregado, con motivo.
- [x] 6.9 (cheque: $66.209,52 PRUEBA 4 + $591.517 PRUEBA 5; P2-34) **PRUEBA 4:** un cheque que cubre su comprobante **y** la deuda de PRUEBA 5 ("Agregar cliente para cobrar").
- [x] 6.10 (transferencia $114.291,72 en estado pendiente, fuera de la billetera = #35 OK) **PRUEBA 6:** paga solo con transferencia (foto) → se desbloquea y se entrega.
- [x] 6.11 (nafta 20.000, peón 10.000, comida 5.000; los 3 **sin vehículo** en la base, ver 7.2) Gastos: nafta (con el vehículo), peón y comida.
- [x] 6.12 (esperado en mano $186.600 = cobró 171.600 + fondo 50.000 − gastos 35.000; declaró $185.600; viaje en_rendicion; la billetera anotó +$1.000 de diferencia, ver 7.1) Finalizar. La propuesta de rendición = efectivo cobrado + fondo − gastos. Las transferencias **no** están (#35). Declarar $1.000 menos de lo que corresponde.

## Fase 7 — Rendición del chofer en el ERP (`/caja`)

- [x] 7.1 (28/10 13:29: contó $185.600 → caja chica $185.600; diferencia $1.000 a la cuenta 194 (debe), NO a la billetera; billetera chofer $0 en la base y en la app; P2-38) Aceptar la rendición: el faltante de $1.000 va **solo** a tu cuenta personal, no a la billetera (#29).
- [x] 7.2 (3 gastos aprobados, vehículo BOXER asignado solo) Los gastos se aprueban al aceptar, con el vehículo (#43).
- [x] 7.3 (no lo pidió: entró solo = P2-37) El ajuste por redondeo de PRUEBA 2 se confirma acá.
- [x] 7.4 (DEV-00001 → REV 0001-00000028 $8.105,08; DEV-00002 → REV 0001-00000027 $67.751,28 incl. los 12 del respaldo; aviso del respaldo visible; sin NC, sin CAE) Revisar las devoluciones: aceptar/rechazar. Salen REV, **nunca NC**. Control fiscal = 0.
- [x] 7.5 (PRUEBA 6 $114.291,72 → Credicoop 13:32) "Transf. por confirmar": las de PRUEBA 6 están ahí y entran al banco recién al confirmarlas (#35).
- [x] 7.6 (3 papeles en cartera: Credicoop 123 $28.408,37, Nación 124 $3.784.286, Provincia 126 $657.726,52 compartido; P2-36) Cheques de 1190 y PRUEBA 4 en cartera; el de PRUEBA 4 imputado a PRUEBA 4 y a PRUEBA 5.
- [x] 7.7 (app: efectivo en mano $0, "Debés $94.066,93" = base) Billetera del chofer en $0 en la base, en el tablero de Finanzas y en la app (#29/#36).
- [x] 7.8 (002022 listo_para_enviar, sin viaje) PRUEBA 3 vuelve a quedar listo para un viaje nuevo.

## Fase 6b — Segundo viaje (corto)

- [x] 6b.1 (viaje PRUEBA3, sin fondo, candado + cobrar lo de este viaje; billetera arrancó en $0) Viaje nuevo solo con PRUEBA 3. La billetera arranca en $0 (sin arrastrar nada del primero).
- [x] 6b.2 (14:12 cobro $245.438 con 10 % contado [AJUSTE 0,32] → para anular hubo que **reabrir la parada a mano** (P2-33: con la parada cerrada no aparece Anular; la reapertura automática R4 no se vio) → anulado; 14:13 cobro $245.000 [AJUSTE 438,32] anulado; 14:13:55 cobro $245.000 [10 % CONTADO, AJUSTE 438,32] vigente; cada anulación revirtió la billetera; después DEV-00003 1 unidad $17.746,82 contra PRES 0033 = orden cobro → devolución) Entregado y cobrado en efectivo justo.
- [x] 6b.3 (14:39: $245.000 a caja chica → $430.600; ajuste $438,32 entró solo sin mostrarse = P2-37; REV 0029 10 % contado **$27.270,92 = 10 % del PRES completo** (#33 OK); DEV-00003 → REV 0030 **$15.972,14 = 90 % de $17.746,82** (renglón bonificado: no se devuelve el 10 % dos veces); PRUEBA 3 queda **a favor $15.972,14**; comisión $6.074,37; billetera chofer $0 en saldo, movimientos siguen sumando $1.000 = P2-38; viaje completado) Rendición sin diferencia. Billetera en $0 en las 3 vistas.

## Fase 8 — Vendedor: cobro y rendición

- [x] 8.1 (14:45: $100.000 efectivo + $125.500 transferencia a MercadoPago, par [CONTADO_PAR]; REV 0031 10 % $25.061,52 una sola vez (R6 OK; base ver P2-41); ajuste $53,68; URQUIZA $0) Cobrar a 199 desde la app: efectivo + transferencia, con 10 % contado.
- [x] 8.2 ($10.000 → cuenta 194 "retiro" debe) Retiro de efectivo a cuenta de comisión: va a tu cuenta personal.
- [x] 8.3 (14:47: $90.000 a caja grande) Rendición desde la app; confirmarla en el ERP.
- [x] 8.4 ($125.500 → MercadoPago al confirmarla, fuera de la rendición = #35 OK) La transferencia aparece en "Transf. por confirmar", no en la rendición.
- [x] 8.5 (saldo $0 y movimientos suman $0: +100.000 −10.000 −100.000 +10.000; comisión 0027 $10.638,15) Billetera vendedor en $0 en la base, el tablero y la app (#36).

## Fase 8b — Refacturar un pedido entregado con pago parcial (R1/R3)

- [x] 8b.1 (29/10 10:41-10:43: REV 0032 anula PRES 0028; Bahía; PRES 0035 $339.161,76; pedido sigue entregado; $100.000 + REV dev pasaron al nuevo: saldo $231.056,68; P2-43) 1190-B: anular comprobantes → cambiar la lista → repreciar → emitir PRES. El pedido sigue "entregado" y el pago parcial pasa al comprobante nuevo.
- [x] 8b.2 (002020: frena al final, no de entrada = P2-44; nada cambió) Con un pedido cobrado al 100 % (1190-A), el botón no deja.
- [x] 8b.3 Control fiscal = 0 (sin ND) (acá es donde puede saltar una ND automática).

## Fase 8c — En la oficina (`/caja`)

- [x] 8c.1 (10:49: $217.947,64 efectivo + REV 0033 10 % $24.216,40 → 556 $0) 556 paga lo que le queda. Imputar no ofrece el pedido todo faltante (#39).
- [ ] 8c.2 PRUEBA 1 usa su saldo a favor contra un comprobante nuevo (o se le devuelve, según lo que ofrezca la pantalla).
- [x] 8c.3 (CHEN pagó los $8.105,08 que quedaron en el PRES 0026; caja chica $656.652,72) 1190-B paga el saldo del comprobante refacturado.

## Fase 9 — Billeteras, cuentas y comisiones

- [x] 9.1 (29/10: app vendedor $62.516,98, Playroom $62.517, base $62.516,98 en 9 comisiones; /personal y app "debe $80.125,07" = 131.642,05 + 1.000 diferencia + 10.000 retiro − 62.516,98) Comisión ganada **igual** en la app vendedor, en `/personal` y en el Playroom (#41/#42/#10).
- [x] 9.2 (131.642,05 apertura + 1.000 diferencia + 10.000 retiro − 62.516,98 comisiones = $80.125,07, cada renglón con su origen) Tu cuenta personal = comisiones ganadas − retiros − faltante de rendición. Cada movimiento con su origen.
- [x] 9.3 (tablero de Finanzas: todas las billeteras $0; app vendedor $0; app chofer $0 pero con datos viejos = P2-47; Finanzas: efectivo $746.653, bancos $239.792, cheques $4.470.421 = base) Billeteras de chofer y vendedor en $0 en las 4 vistas (base, tablero, app, `/personal`).
- [x] 9.4 (29/10: 199 $0, 556 $0, 1190 $231.056,68 (PRES 0035 refacturado), PRUEBA 1 a favor $8.503,56, PRUEBA 3 a favor $15.972,14, PRUEBA 2/4/5/6 $0) Saldo de cada cliente de la prueba, a mano contra la base: todos en $0 salvo los que quedan debiendo a propósito.
- [x] 9.5 (caja chica $656.652,72 = 50.000 ajuste − 50.000 fondo + 185.600 + 245.000 + 217.947,64 + 8.105,08; caja grande $90.000; Credicoop $114.291,72; MercadoPago $125.500; 3 cheques en cartera $4.470.420,89; cuadra al peso) Cajas y bancos: saldo = movimientos de la prueba + ajustes anotados en la 1.8, al peso.
- [x] 9.6 Control fiscal final = 0; 0 pedidos a ARCA; 12 con CAE y 3 echeqs igual que al inicio; artículos 3.293 y proveedores 94 sin cambios (clientes 625 = 618 + 6 PRUEBA + 1 alta real de la oficina).

## Fase 10 — Cierre

- [x] 10.1 (29/10, ver "Resumen final") Resumen de problemas por gravedad y por dueño; traspasos escritos.
- [ ] 10.2 Lo que dejó la prueba en la base y cómo se limpia el día del pase.
- [ ] 10.3 Script para borrar por número los pedidos de esta prueba y eliminar los clientes PRUEBA (la puesta a cero no borra pedidos ni clientes).

---

## Antes de terminar la prueba (Juan 27/10)

- [ ] P2-04: CUITs distintos (830, 1249, 1470, 1501), YOU JUNJUN con dos códigos (249 y 766), y los 4 clientes con error (56, 765, 766, 1381). Una vez arreglados, volver a subir el reporte (lo cargado no se duplica).
- [ ] P2-05: REV viejas en 0001.

## Cada mañana mientras dure la prueba

> **28/10, decisión de Juan:** el pase diario a "sistema viejo" **no se corre** mientras haya gente trabajando con pedidos reales en gmv2. Los pedidos reales quedan en la cola; Juan trabaja solo sobre los de los clientes de prueba. Controles que hago yo en cada fase: que el viaje, la preparación y los comprobantes de la prueba tengan **solo** clientes de prueba, y que ningún pedido real cambie de estado por la prueba. El control fiscal mira además a qué cliente pertenece cualquier comprobante nuevo (uno de un cliente real lo hace la oficina, no la prueba).

- [ ] Pasar los pedidos reales nuevos: `SELECT pedidos_pasar_a_sistema_viejo(now(), '{1190,199,556,90029,90030,90031,90032,90033,90034}', 'PASAR');`
- [ ] **Ojo:** si entra un pedido **real** de 1190, 199 o 556, no se pasa solo (están excluidos) y se mezcla con la prueba. Lo miro yo cada mañana y lo anotamos.
- [ ] Control fiscal = 0.

## Cosas escondidas o forzadas durante la prueba

| Fecha | Qué | Dónde | Cómo se deshace | ¿Deshecho? |
|---|---|---|---|---|
| 29/10 | Pedido de Juan: artículos con precio_base vacío (1.293, 50 activos) pasan a $1 | `articulos` (copia en archivo_pruebas.articulos_precio_null_20261029) | Volver a NULL con la copia | — |
| 27/10 | Cliente 3 "TEST-R1 REFACTURAR" desactivado por Juan (tacho) | `clientes` | Era de prueba de un agente: no se deshace | — |
| | Clientes PRUEBA 1 a 6 (90029-90034) dados de alta | `clientes` | Eliminarlos al terminar (10.3) | |

## Problemas encontrados durante la prueba

| # | Fase | Qué pasó | Gravedad | Dueño | Estado |
|---|---|---|---|---|---|
| P2-01 | Auditoría | Alta de cliente toma el primer número libre (así el de prueba agarró el 3). **Regla de Juan:** el siguiente al más alto (hoy 90029), en el ERP, en la app vendedor y en la base. | Media (para el pase) | Cambios general | traspaso escrito (PENDIENTES-ERP-SALIDA §8) |
| P2-02 | 0 (D2) | El tacho de `/clientes` **desactiva** el cliente en vez de eliminarlo; sigue con su código, pedidos, comprobantes y deuda. **Regla de Juan:** eliminar de verdad; si tiene deuda, cartel "¿Asumir deuda y eliminarlo de todas formas?". Decisiones de Juan 27/10: con CAE queda escondido y código libre; deuda asumida → caja de ajustes (P2-03); sin deuda se conservan pedidos y comprobantes. | Media | Cambios general | traspaso escrito (PENDIENTES-ERP-SALIDA §8) |
| P2-04 | 2 | Apertura, datos de la oficina: (a) CUIT distinto entre el sistema viejo y gmv2 en 830, 1249, 1470 y 1501 (830 y 1470 parecen errores de tipeo; **1249 GIMENO ADRIANA y 1501 XUE GUIPING tienen CUITs totalmente distintos**: revisar que sea el mismo cliente antes del pase). (b) **YOU JUNJUN** figura en el sistema viejo con dos códigos (249 y 766); en gmv2 solo está el 249. (c) 56, 1381, 765, 766 siguen pendientes (oficina #9). | Media (antes del pase) | Oficina (Juan) | abierto |
| P2-05 | 2 | La apertura pasó los PRES viejos a 0002 (#18) pero las **REV viejas quedaron en 0001** (0001-00067473 a 0001-00120976), el mismo punto de venta que usan las REV nuevas (van por 0001-00000025). No chocan por años, pero confunde. ¿Pasarlas también a 0002? | Baja | Cuentas corrientes (pregunta a Juan) | abierto |
| P2-06 | 3 | Listado de `/clientes-pedidos`: falta la dirección del cliente al lado del nombre (pedido de Juan). | Baja | Frontend | traspaso escrito (PENDIENTES-ERP-SALIDA §8) |
| P2-07 | 3 | Entrega por transporte: falta elegir flete en origen o en destino. | Media | Cambios general | traspaso escrito |
| P2-08 | 3 | "Retener entregas" no se puede marcar desde la ficha del cliente, solo desde Viajes o Jarvis. PRUEBA 6 se retiene desde Viajes en la Fase 5. | Media | Frontend | traspaso escrito |
| P2-09 | 3 | "Retira en Mostrador" guarda condicion_entrega pero no retira_en_deposito, que es lo que mira el precio para no cobrar flete (a verificar con el pedido de PRUEBA 5). | Media | Cambios general | traspaso escrito |
| P2-10 | 3 | El alta no limpia el nombre ("PRUEBA 2 " con espacio, "prueba1" en minúsculas). | Baja | Frontend | traspaso escrito |
| P2-11 | 3 | App vendedor: al terminar un pedido, el botón principal tiene que ser "Volver al inicio", después "Ver mis pedidos" y en chico "Nuevo pedido para…". | Baja | App Vendedor | traspaso escrito (PENDIENTES-APPS-SALIDA) |
| P2-12 | 3 | App vendedor: hay que apretar "+" para cargar el artículo; tiene que alcanzar con escribir la cantidad. | Media | App Vendedor | traspaso escrito |
| P2-13 | 3 | App vendedor: un pedido nuevo arranca con todo abierto como el anterior; tiene que arrancar con categorías, subcategorías, novedades, ofertas, habituales y proveedor cerrados. | Baja | App Vendedor | traspaso escrito |
| P2-14 | 3 | App vendedor: el teclado tapa el campo de cantidad de los artículos de la mitad de abajo. | Media | App Vendedor | traspaso escrito |
| P2-15 | 3 | ERP: los pedidos "en revisión" no aparecen en /clientes-pedidos salvo con el filtro "Todos". | Media | Frontend | traspaso escrito |
| P2-16 | 4 | App depósito: la cantidad separada arranca completa con lo pedido; tiene que arrancar vacía. | Alta | App Depósito | traspaso escrito |
| P2-17 | 4 | App depósito: el teclado tapa Aceptar/Rechazar. | Media | App Depósito | traspaso escrito |
| P2-18 | 4 | App depósito: no hay "Reiniciar preparación" ni forma de soltar un pedido abierto por error (quedó el real 001945 en preparación). | Alta | App Depósito | traspaso escrito |
| P2-19 | 4 | App depósito: al finalizar, elegir "Cargar bultos" o "Dejar para después del control". | Media | App Depósito | traspaso escrito |
| P2-20 | 4 | 001945, 001956 y 001972 (reales) volvieron de sistema viejo a impreso sin registro de quién. | Media | Cambios general | traspaso escrito; preguntar a Juan si fue la oficina |
| **P2-22** | 5 | **GRAVÍSIMO: dos pedidos generados casi a la vez salieron con el mismo número (PRES 0001-00000030 para 002021 y 002022).** La numeración no tiene candado ni índice único (también NC/REV y ND). Regla de Juan: PROHIBIDO; cola de facturación para las 5 máquinas, y botón "Facturar" para varios pedidos juntos. | **Crítica, frena el pase** | Cambios general (con Cuentas corrientes) | traspaso escrito |
| P2-21 | 5 | "Guardar pedido" deja la pantalla en el mismo lugar; tiene que volver a donde estaba. | Baja | Frontend | traspaso escrito |
| P2-23 | 5 | Pedido con 10 % contado: el PRES figura "parcial" y la REV "pagado" sin que el cliente haya pagado nada. | Media | Frontend (con Cuentas corrientes) | traspaso escrito |
| P2-24 | 5 | Anular los comprobantes de un pedido "facturado" lo deja en "facturado"; tiene que volver a "pendiente de facturación" (si ya está en viaje/entregado, se queda). | Media | Listas de precios + Cuentas corrientes | traspaso escrito |
| P2-25 | 5 | Al tildar pedidos, "subir a un viaje" no lista el viaje ya creado. | Media | Hojas de ruta/viajes | hecho en rama viajes-p2 (39837fe), falta merge |
| P2-26 | 5 | Unificar "Pedidos del viaje" con la lista: cruz roja para sacar y bultos editables, el campo vacío y no 0 (sale "036"). | Baja | Hojas de ruta/viajes | hecho en rama viajes-p2 (39837fe), falta merge |
| P2-27 | 5 | Hoja de ruta: "2 / 1 pal." no se entiende; escribir "2 bultos + 1 pallet". | Baja | Hojas de ruta/viajes | hecho en rama viajes-p2 (39837fe), falta merge |
| P2-28 | 5 | Hoja de ruta: CHEN figura $399.991,26 sin restar la REV del 10 % ya emitida ($395.934,21) y sin avisar que es de contado. | Media | Hojas de ruta/viajes | a verificar en la app |
| P2-29 | 6 | App chofer: la devolución de CHEN (atada al PRES 0028) se restó del PRES 0026 al cobrarlo: el 0026 queda debiendo $8.105,08. | Alta | App Chofer + Cuentas corrientes | traspaso escrito |
| P2-30 | 6 | App chofer: el monto del cobro no separa miles mientras se escribe. | Media | App Chofer | traspaso escrito |
| P2-31 | 6 | App chofer: devolución de más en PRES (36 de 24) no avisa nada; la base sí la reparte bien (24 + 12 al respaldo 0002-00000001). | Media | App Chofer | traspaso escrito |
| P2-32 | 6 | App chofer: cartel "Datos al… Actualizar" siempre visible. | Baja | App Chofer | traspaso escrito |
| P2-33 | 6 | App chofer: cobrar en la parada bloqueada la cerró sola como entregada; no se encontró "Anular" el cobro → R4/C7 sin probar, se repite en el 2º viaje. | Alta | App Chofer | traspaso escrito |
| P2-34 | 6 | App chofer: "Agregar cliente para cobrar" borra los datos del agregado; hubo que volver a buscarlo. | Media | App Chofer | traspaso escrito |
| P2-35 | 6 | App chofer: pantalla del viaje confusa. Cada parada: cliente, dirección, bultos, cobrar sí o sí y "Confirmar parada"; el resto adentro. | Alta | App Chofer | traspaso escrito |
| P2-36 | 7 | /caja muestra el cheque compartido de PRUEBA 4+5 como dos cheques; en la base es uno ($657.726,52) y quedó con color "PENDIENTE". | Media | Frontend + Cuentas corrientes | traspaso escrito |
| P2-37 | 7 | El ajuste por redondeo de PRUEBA 2 ($47,56) entró solo, sin verse en la rendición; tiene que ir a la caja de ajustes. | Media | Cuentas corrientes (con P2-03) | traspaso escrito |
| P2-38 | 7 | Billetera del chofer: saldo $0 (bien) pero los movimientos suman $1.000 (la diferencia quedó como renglón suelto). | Baja | Cuentas corrientes | traspaso escrito |
| P2-39 | 6b | El pedido no copia la forma de entrega del cliente (002024 de PRUEBA 5 "retira en mostrador" quedó vacío) → no aparece en /mostrador "Para retirar". 358 de 361 pedidos desde el 01/10 la tienen vacía. | Media | Cambios general | traspaso escrito |
| P2-40 | 6b | /mostrador "Para retirar": un pedido pagado (saldo $0) no se puede entregar (solo "Cobrar efectivo y entregar", deshabilitado); solo cobra efectivo. | Media | Frontend + Cambios general | traspaso escrito |
| P2-41 | 8 | 10 % contado de URQUIZA: la base restó también los 12 devueltos al respaldo del sistema viejo ($25.061,52 en vez de $27.319,90); la REV de la devolución se imputó entera al PRES 0027. | Media | Cuentas corrientes | regla de Juan 29/10: 10 % por comprobante, también los del sistema viejo → correcto $27.319,90 |
| P2-42 | 8 | App vendedor: el 10 % contado se muestra como "saldo proyectado a favor" y confunde. | Baja | App Vendedor | traspaso escrito |
| P2-43 | 8b | La devolución de CHEN (precio Neco) quedó acreditada a ese precio después de refacturar el pedido a Bahía. | Baja | Listas de precios + Cuentas corrientes | a verificar |
| P2-44 | 8b | "Anular comprobantes" no aparece bloqueado en un pedido cobrado al 100 % (frena recién al final) y muestra el éxito del pedido anterior. Nada cambió en la base. | Media | Frontend | traspaso escrito |
| P2-45 | 9 | Importar pedido por archivo: cruz para borrar un renglón LOW. | Media | Frontend | traspaso escrito |
| P2-46 | 9 | **La sesión del ERP se cierra cada ~10 minutos** (4 personas trabajando). | **Alta** | Cambios general | traspaso escrito |
| P2-47 | 9 | App chofer: no se actualiza sola; mostraba datos de hace 21 h (deuda vieja y $245.000 "camino a oficina" ya rendidos). | Media | App Chofer | traspaso escrito |
| P2-48 | 9 | NC por devolución de una factura del sistema viejo: tiene que salir por el precio final justo ($100), con IVA y percepciones adentro; hoy suma la percepción IIBB encima. | Alta (fiscal) | Cuentas corrientes | regla de Juan 29/10, traspaso escrito |
| P2-03 | 0 | Idea de Juan: **caja de ajustes**, un solo lugar con todos los ajustes de plata (redondeos de cualquier lugar donde se cobre, ajustar saldo, deuda asumida, sobrantes; **no** apertura ni ajustes de cajas/bancos) para ver cuánto se ajusta. | Media (antes del pase) | Cambios general | idea aprobada; se redondea después de la prueba |


## Resumen final (29/10)

**48 problemas anotados (P2-01 a P2-48).** Ningún comprobante fiscal emitido en toda la prueba, 0 pedidos a ARCA, datos reales intactos. Cajas, bancos, cheques, billeteras, cuentas de clientes, cuenta personal de Juan y comisiones cuadran al peso en la base, el ERP y las apps.

### Frenan el pase
| # | Qué | Dueño |
|---|---|---|
| P2-22 | Dos comprobantes con el mismo número (sin candado ni cola de facturación) | Cambios general + Cuentas corrientes |
| P2-46 | La sesión del ERP se cierra cada ~10 minutos | Cambios general |
| P2-29 | La app chofer resta la devolución del comprobante equivocado (cobra de menos) | App Chofer + Cuentas corrientes |
| P2-33 | Cobrar cierra la parada sola y no se puede anular el cobro (R4/C7 sin probar) | App Chofer |
| P2-35 | Pantalla del viaje del chofer confusa (rediseño) | App Chofer |
| P2-16 | Depósito: la cantidad separada arranca completa | App Depósito |
| P2-18 | Depósito: no se puede reiniciar ni soltar un pedido abierto | App Depósito |
| P2-04 | Datos de la oficina para la apertura (CUITs, YOU JUNJUN, 56/1381/765/766) | Oficina (Juan) |

### Por dueño
- **Cambios general:** P2-01, P2-02, P2-03 (después de la prueba), P2-07, P2-09, P2-20, P2-22, P2-39, P2-40, P2-46.
- **Frontend:** P2-06, P2-08, P2-10, P2-15, P2-21, P2-23, P2-36, P2-40, P2-44, P2-45.
- **Cuentas corrientes:** P2-05, P2-37, P2-38, P2-41, P2-48; consulta en P2-22, P2-23, P2-29, P2-36, P2-43.
- **Listas de precios y descuentos:** P2-24, P2-43.
- **Hojas de ruta/viajes:** P2-25, P2-26, P2-27, P2-28.
- **App Vendedor:** P2-11, P2-12, P2-13, P2-14, P2-42.
- **App Depósito:** P2-16, P2-17, P2-18, P2-19.
- **App Chofer:** P2-28 (app), P2-29, P2-30, P2-31, P2-32, P2-33, P2-34, P2-35, P2-47.
- **Oficina (Juan):** P2-04.

### Lo que anduvo bien (arreglos de la 1ª prueba confirmados)
Puesta a cero y apertura completa (247 clientes al peso, empleados a su cuenta personal, PRES viejos en 0002); preparación parcial (50 de 60) facturada por lo preparado; pedido todo faltante eliminado; candado "no entregar sin cobrar"; devolución de más en PRES al respaldo 0002-00000001; 10 % contado sobre el comprobante completo y devolución bonificada al 90 %; cobro partido efectivo + transferencia con una sola REV del 10 %; transferencias fuera de la rendición y confirmadas en /caja; diferencia de rendición solo a la cuenta personal; billeteras en $0 en base, tablero y apps; gastos aprobados con vehículo; refacturar un pedido entregado con pago parcial (sigue entregado, lo pagado pasa al nuevo); comisiones iguales en app, /personal y Playroom; login con usuario y con mail.

### Queda de la prueba en la base (para limpiar el día del pase)
Pedidos 002015-002025 (002019 eliminado), viajes PRUEBA2 y PRUEBA3, PRES 0025-0035 y REV 0025-0033, DEV-00001 a 00003, cobros y recibos REC-0060 a 0070, 3 cheques de terceros, movimientos de caja/bancos, clientes PRUEBA 1 a 6 (90029-90034) y el respaldo 0002-00000001 de URQUIZA. La puesta a cero borra la plata; **pedidos y clientes PRUEBA necesitan el script de la 10.3**.
