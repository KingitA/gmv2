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

Hora de inicio de la prueba: **______** (se anota en 1.7).

```sql
SELECT tipo_comprobante, numero_comprobante, created_at
FROM comprobantes_venta
WHERE created_at >= '<HORA DE INICIO>' AND tipo_comprobante NOT IN ('PRES', 'REV');
-- tiene que dar 0 filas
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
- [ ] 0.4 Pasarles el aviso a los agentes con la hora de inicio.
- [ ] 0.5 NuStar: en las 3 apps, que no quede nada "pendiente de sincronizar" antes de borrar datos (si queda algo, se pierde).
- [ ] 0.6 Juan tiene el `.chr` del sistema viejo del día.

## Fase 1 — Todo a cero

Se corre en el editor SQL de Supabase, en este orden. Cada paso con su simulacro primero, que revisamos juntos.

- [ ] 1.1 Foto de la base antes (la saco yo): clientes, artículos, proveedores, pedidos, comprobantes con CAE, echeqs propios.
- [ ] 1.2 `SELECT * FROM cc_puesta_a_cero_simulacro();` → revisamos → `SELECT cc_puesta_a_cero('PONER A CERO');`
- [ ] 1.3 `SELECT * FROM prueba_limpieza_simulacro();` (la última fila tiene que dar 0) → `SELECT prueba_limpieza('LIMPIAR');`
- [ ] 1.4 `SELECT * FROM prueba2_preparar_simulacro();` (la última fila tiene que dar 0) → `SELECT prueba2_preparar('PREPARAR');`
- [ ] 1.5 `SELECT * FROM pedidos_sistema_viejo_simulacro(now(), '{}');` → `SELECT pedidos_pasar_a_sistema_viejo(now(), '{}', 'PASAR');` (pasan los reales nuevos, incluido el 001986).
- [ ] 1.6 Foto después: 0 comprobantes sin CAE, 12 con CAE ($0), 0 cobros, 0 devoluciones, 0 billetera, 0 comisiones cobradas, 0 viajes, 0 preparaciones, cola vacía, todos los saldos en $0, bancos y cajas en $0, clientes/artículos/proveedores sin cambios contra la 1.1.
- [ ] 1.7 **Anotar la hora de inicio** (arriba, en "Control fiscal") y en el aviso.
- [ ] 1.8 Bancos y cajas en $0 (D4). Cada ajuste que Juan haga durante la prueba se anota acá:

| Fecha y hora | Cuenta | Ajuste | Motivo |
|---|---|---|---|
| | | | |

  Si la caja chica en $0 no deja entregarle el fondo al chofer (5.6), es un hallazgo: se anota y Juan carga un monto de prueba en la caja chica (va a esta tabla).
- [ ] 1.9 `/personal` → "Poner al día": comisiones $0 y la cuenta de Juan en $0.
- [ ] 1.10 Pantallas del ERP en cero: "Pendientes de revisar" al día, caja del día sin movimientos, `/personal` todo en $0, fichas de 199/1190/556 en $0, cola del depósito vacía, sin viajes, tablero de Finanzas con billeteras en $0.
- [ ] 1.11 Apps: borrar datos de las 3 apps y entrar de nuevo, **una con usuario y otra con mail** (T1). Vendedor: plata en mano $0, cuenta $0, comisiones $0. Chofer: sin viaje, billetera $0. Depósito: 0 pedidos.

## Fase 2 — Importación de deudas del sistema viejo (`/apertura`)

- [ ] 2.1 Vista previa del `.chr` completo: los clientes con error van **aparte** y no frenan al resto (#5).
- [ ] 2.2 En la vista previa: el texto libre entra como ajuste (#6), las cuentas de empleados van a la cuenta personal (#7), se toma la **segunda** columna de saldo (#8), los PRES viejos quedan en punto de venta **0002** (#18).
- [ ] 2.3 Casos raros: 56 y 1381 (cambiaron de dueño), 765 y 766 (no existen en gmv2), que **nada** caiga en el cliente 3 (A1) ni en los PRUEBA 90029-90034.
- [ ] 2.4 Si el reporte trae deuda de **tu** cuenta como empleado, se anota: rompe el "Juan en $0". Se decide en el momento.
- [ ] 2.5 Confirmar. Total importado = total del reporte, al peso.
- [ ] 2.6 La deuda de 556 se ve igual en la base, la ficha del ERP, la antigüedad del tablero y la app vendedor.
- [ ] 2.7 La apertura no genera comisiones. Control fiscal = 0.

## Fase 3 — Altas y venta desde la app Vendedor

- [ ] 3.1 Alta en `/clientes` de PRUEBA 1 a 6 con los códigos 90029-90034, vos de vendedor, Presupuesto, Neco. PRUEBA 5 "Retira en mostrador". PRUEBA 6 con "retener entregas".
- [ ] 3.2 Los 6 aparecen en la app vendedor después de "Actualizar", con saldo $0.
- [ ] 3.3 Pedidos desde la app: 199; 1190-A (10 % contado tildado al finalizar, el total en vivo cambia, #13); 1190-B; 556-A (un renglón de 36); 556-B (va a quedar todo faltante); PRUEBA 1 a 6, uno cada uno.
- [ ] 3.4 Ningún renglón en "Factura". Comisión vendida igual en la app y en la base. Los pedidos aparecen en el ERP con vos de vendedor.

## Fase 4 — Preparación en la app Depósito

- [ ] 4.1 Preparar completos todos menos 556-A y 556-B.
- [ ] 4.2 556-A parcial: 30 de 36. El ERP muestra "30 de 36" (#14).
- [ ] 4.3 556-B todo faltante: avisa; se puede volver a pendiente o eliminar; no aparece como cobrable en ningún lado (#17/#39).
- [ ] 4.4 "Reiniciar preparación" funciona (D3 de la app).

## Fase 5 — Gestión en el ERP

- [ ] 5.1 Condiciones de cada pedido según la tabla de clientes.
- [ ] 5.2 Generar comprobantes: **antes, mirar que diga Presupuesto.** 556-A se factura por 30, no por 36 (#15). Control fiscal = 0.
- [ ] 5.3 Modificar un pedido después de preparado: cambiar la lista (nunca el método a Factura) y repreciar (#16).
- [ ] 5.4 PRUEBA 5 retira en mostrador: se le entrega sin viaje y queda debiendo.
- [ ] 5.5 Bultos y pallets cargados en el ERP; el remito y la hoja de ruta los toman (#22).
- [ ] 5.6 Armar el viaje con vos de chofer y un vehículo, con 199, 1190 (A y B), 556-A y PRUEBA 1, 2, 3, 4 y 6. Hoja de ruta con los números de PRES bien (#21).
- [ ] 5.7 Bloqueos: 556 "no entregar si no paga lo anterior"; PRUEBA 6 aparece bloqueado solo por la retención.
- [ ] 5.8 Entregarle fondo al chofer desde la caja chica. La caja baja y la billetera sube lo mismo, en la base y en el tablero.
- [ ] 5.9 Despachar.

## Fase 6 — Entregas desde la app Chofer (primer viaje)

- [ ] 6.1 El viaje aparece con todas las paradas, las deudas y la billetera = fondo. 556 y PRUEBA 6 con el candado.
- [ ] 6.2 **1190-A:** devolución parcial **antes** de cobrar → cobra con **cheque** (foto) con 10 % contado. El 10 % sale sobre el comprobante completo.
- [ ] 6.3 **1190-B:** entregado con pago parcial en efectivo → "Dejar el saldo pendiente".
- [ ] 6.4 **199:** intentar devolver más de lo vendido → no deja; la pantalla muestra artículo y cantidad. Lo devuelto de más en el PRES va al respaldo 0002-00000001 (C8). Entregado sin cobrar.
- [ ] 6.5 **556:** intentar entregar sin cobrar → no deja. Cobrar → entregar → **anular el cobro** → la parada vuelve a pendiente (R4/C7). Volver a cobrar (deuda vieja + pedido) con 10 % y **después** registrar una devolución: el 10 % tiene que salir con la misma regla que 6.2.
- [ ] 6.6 **PRUEBA 1:** paga de más en efectivo → "Dejar $X a cuenta".
- [ ] 6.7 **PRUEBA 2:** paga apenas menos (menos del 1 %) → "Ajuste por redondeo".
- [ ] 6.8 **PRUEBA 3:** no entregado, con motivo.
- [ ] 6.9 **PRUEBA 4:** un cheque que cubre su comprobante **y** la deuda de PRUEBA 5 ("Agregar cliente para cobrar").
- [ ] 6.10 **PRUEBA 6:** paga solo con transferencia (foto) → se desbloquea y se entrega.
- [ ] 6.11 Gastos: nafta (con el vehículo), peón y comida.
- [ ] 6.12 Finalizar. La propuesta de rendición = efectivo cobrado + fondo − gastos. Las transferencias **no** están (#35). Declarar $1.000 menos de lo que corresponde.

## Fase 7 — Rendición del chofer en el ERP (`/caja`)

- [ ] 7.1 Aceptar la rendición: el faltante de $1.000 va **solo** a tu cuenta personal, no a la billetera (#29).
- [ ] 7.2 Los gastos se aprueban al aceptar, con el vehículo (#43).
- [ ] 7.3 El ajuste por redondeo de PRUEBA 2 se confirma acá.
- [ ] 7.4 Revisar las devoluciones: aceptar/rechazar. Salen REV, **nunca NC**. Control fiscal = 0.
- [ ] 7.5 "Transf. por confirmar": las de PRUEBA 6 están ahí y entran al banco recién al confirmarlas (#35).
- [ ] 7.6 Cheques de 1190 y PRUEBA 4 en cartera; el de PRUEBA 4 imputado a PRUEBA 4 y a PRUEBA 5.
- [ ] 7.7 Billetera del chofer en $0 en la base, en el tablero de Finanzas y en la app (#29/#36).
- [ ] 7.8 PRUEBA 3 vuelve a quedar listo para un viaje nuevo.

## Fase 6b — Segundo viaje (corto)

- [ ] 6b.1 Viaje nuevo solo con PRUEBA 3. La billetera arranca en $0 (sin arrastrar nada del primero).
- [ ] 6b.2 Entregado y cobrado en efectivo justo.
- [ ] 6b.3 Rendición sin diferencia. Billetera en $0 en las 3 vistas.

## Fase 8 — Vendedor: cobro y rendición

- [ ] 8.1 Cobrar a 199 desde la app: efectivo + transferencia, con 10 % contado.
- [ ] 8.2 Retiro de efectivo a cuenta de comisión: va a tu cuenta personal.
- [ ] 8.3 Rendición desde la app; confirmarla en el ERP.
- [ ] 8.4 La transferencia aparece en "Transf. por confirmar", no en la rendición.
- [ ] 8.5 Billetera vendedor en $0 en la base, el tablero y la app (#36).

## Fase 8b — Refacturar un pedido entregado con pago parcial (R1/R3)

- [ ] 8b.1 1190-B: anular comprobantes → cambiar la lista → repreciar → emitir PRES. El pedido sigue "entregado" y el pago parcial pasa al comprobante nuevo.
- [ ] 8b.2 Con un pedido cobrado al 100 % (1190-A), el botón no deja.
- [ ] 8b.3 Control fiscal = 0 (acá es donde puede saltar una ND automática).

## Fase 8c — En la oficina (`/caja`)

- [ ] 8c.1 556 paga lo que le queda. Imputar no ofrece el pedido todo faltante (#39).
- [ ] 8c.2 PRUEBA 1 usa su saldo a favor contra un comprobante nuevo (o se le devuelve, según lo que ofrezca la pantalla).
- [ ] 8c.3 1190-B paga el saldo del comprobante refacturado.

## Fase 9 — Billeteras, cuentas y comisiones

- [ ] 9.1 Comisión ganada **igual** en la app vendedor, en `/personal` y en el Playroom (#41/#42/#10).
- [ ] 9.2 Tu cuenta personal = comisiones ganadas − retiros − faltante de rendición. Cada movimiento con su origen.
- [ ] 9.3 Billeteras de chofer y vendedor en $0 en las 4 vistas (base, tablero, app, `/personal`).
- [ ] 9.4 Saldo de cada cliente de la prueba, a mano contra la base: todos en $0 salvo los que quedan debiendo a propósito.
- [ ] 9.5 Cajas y bancos: saldo = movimientos de la prueba + ajustes anotados en la 1.8, al peso.
- [ ] 9.6 Control fiscal final = 0.

## Fase 10 — Cierre

- [ ] 10.1 Resumen de problemas por gravedad y por dueño; traspasos escritos.
- [ ] 10.2 Lo que dejó la prueba en la base y cómo se limpia el día del pase.
- [ ] 10.3 Script para borrar por número los pedidos de esta prueba y eliminar los clientes PRUEBA (la puesta a cero no borra pedidos ni clientes).

---

## Cada mañana mientras dure la prueba

- [ ] Pasar los pedidos reales nuevos: `SELECT pedidos_pasar_a_sistema_viejo(now(), '{1190,199,556,90029,90030,90031,90032,90033,90034}', 'PASAR');`
- [ ] **Ojo:** si entra un pedido **real** de 1190, 199 o 556, no se pasa solo (están excluidos) y se mezcla con la prueba. Lo miro yo cada mañana y lo anotamos.
- [ ] Control fiscal = 0.

## Cosas escondidas o forzadas durante la prueba

| Fecha | Qué | Dónde | Cómo se deshace | ¿Deshecho? |
|---|---|---|---|---|
| 27/10 | Cliente 3 "TEST-R1 REFACTURAR" desactivado por Juan (tacho) | `clientes` | Era de prueba de un agente: no se deshace | — |
| | Clientes PRUEBA 1 a 6 (90029-90034) dados de alta | `clientes` | Eliminarlos al terminar (10.3) | |

## Problemas encontrados durante la prueba

| # | Fase | Qué pasó | Gravedad | Dueño | Estado |
|---|---|---|---|---|---|
| P2-01 | Auditoría | Alta de cliente toma el primer número libre (así el de prueba agarró el 3). **Regla de Juan:** el siguiente al más alto (hoy 90029), en el ERP, en la app vendedor y en la base. | Media (para el pase) | Cambios general | traspaso escrito (PENDIENTES-ERP-SALIDA §8) |
| P2-02 | 0 (D2) | El tacho de `/clientes` **desactiva** el cliente en vez de eliminarlo; sigue con su código, pedidos, comprobantes y deuda. **Regla de Juan:** eliminar de verdad; si tiene deuda, cartel "¿Asumir deuda y eliminarlo de todas formas?". Decisiones de Juan 27/10: con CAE queda escondido y código libre; deuda asumida → caja de ajustes (P2-03); sin deuda se conservan pedidos y comprobantes. | Media | Cambios general | traspaso escrito (PENDIENTES-ERP-SALIDA §8) |
| P2-03 | 0 | Idea de Juan: **caja de ajustes**, un solo lugar con todos los ajustes de plata (redondeos de cualquier lugar donde se cobre, ajustar saldo, deuda asumida, sobrantes; **no** apertura ni ajustes de cajas/bancos) para ver cuánto se ajusta. | Media (antes del pase) | Cambios general | idea aprobada; se redondea después de la prueba |
