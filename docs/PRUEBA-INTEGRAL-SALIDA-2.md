# Segunda prueba integral — salida de mercadería (desde cero)

Armado el 27/10/2026 a partir de una auditoría nueva de la base y del código (main `09a3c1c`).
La primera prueba (23 al 27/10) está en [`PRUEBA-INTEGRAL-SALIDA.md`](PRUEBA-INTEGRAL-SALIDA.md); sus recomendaciones se tomaron como ejemplo y se chequearon una por una contra la base.

## Reglas de esta prueba (no se negocian)

1. **Cero comprobantes fiscales.** Ni facturas, ni notas de crédito, ni notas de débito. Solo Presupuestos (PRES) y Reversas (REV). Si sale uno fiscal, es un error encontrado: se anota, se para y se decide con Juan.
2. **Los datos reales no se tocan:** comprobantes con CAE, artículos, clientes, proveedores y los pedidos reales (contenido, artículos, condiciones). Si algo real molesta para la prueba, se esconde, y queda anotado en "Cosas escondidas o forzadas" para deshacerlo después.
3. **Se verifica en la base, no solo en la pantalla.** Cada casilla se tilda cuando cuadra en las dos.
4. **Cada problema va con número** a la tabla "Problemas encontrados", con su dueño. No se arregla código de otra área: se le escribe el traspaso al agente dueño.
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

Los 3 clientes de prueba tienen CUIT y son Responsable Inscripto: si algo sale fiscal, sale **A con CAE real**. Antes de cada "Generar" se mira que diga Presupuesto.

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
| Billetera vendedor (8146a51a) | $0 en el tablero, pero sus movimientos suman distinto | $0, sin movimientos |
| Billetera chofer (d6ac25bb) | $0 en el tablero, los movimientos suman $1.000 (problema 29 de la 1ª) | $0, sin movimientos |
| Comisión "vendida" | $96.197 de los pedidos de prueba 001939-001941 + $7.709 del pedido real 001986 | $0 (ver A2 y A4) |
| Viajes | "PRUEBA" (completado) y "BAHIA · 24/10" (cancelado) | ninguno |

### Saldos de clientes hoy
- 1190 CHEN: debe $17.743,69 · 199 URQUIZA: $0 · 556 FITTERER: a favor $20.000.
- **Cliente 3 "TEST-R1 REFACTURAR": debe $26.500.** Lo creó otro agente HOY a las 11:06 para probar el refacturado (pedido 001990, PRES 0001-00000023/24, REV 0001-00000024, un cobro de $21.506). Ver A1.
- Los clientes 1019, 1094, 482, 581 y 676 tienen movimientos que se cancelan ($0): son los 12 comprobantes con CAE. **Se conservan.**

### Plata
- Bancos con "Ajuste manual de saldo" cargados el 26/10 y hoy 27/10 a las 07:10. Caja chica $4.096.296 y caja grande $10.990.000 (mezcla de prueba). Todo eso va a $0 y lo volvés a cargar vos.
- Cheques: 1 de prueba en cartera ($100.000) → se borra. Los 3 echeqs propios entregados a proveedores → **se conservan**.

### Pedidos
- 1.640 en "sistema viejo", 302 eliminados.
- **47 reales nuevos en "impreso"** (entraron del 26/10 06:53 al 27/10 13:05): pasan a "sistema viejo". Ninguno es de 1190, 199 o 556.
- De prueba: 001939 y 001940 (entregados), 001941 (listo para enviar), 001942 (pendiente de facturación) y 001990 (cliente 3, entregado).

### Comprobantes
- 15 sin CAE (todos PRES o REV, de prueba) → se borran.
- 12 con CAE (5 FA, 6 NCA, 1 NDA, suman $0) → se conservan.
- Fiscales nuevos desde el 23/10 14:45: **0**. Bien.

### Lo que la puesta a cero NO cubre (hallazgos de la auditoría)
| # | Qué | Por qué importa | Propuesta |
|---|---|---|---|
| A1 | **Cliente 3 "TEST-R1 REFACTURAR"**, creado hoy por un agente, con el **código 3** | La importación del sistema viejo busca a los clientes **por código**. Si en el sistema viejo existe un cliente 3 con deuda, esa deuda real se le cargaría a este cliente de prueba. Además ensucia la cuenta corriente. | Sacarle el código (pasa a "PRUEBA-R1") y desactivarlo, con el script de la 1.5. |
| A2 | Pedido **001986** (cliente 705 CALZETTA), vendido **con tu usuario** el 27/10 06:54 | Es una venta real, no de prueba. Si queda en la cola, se mezcla con la prueba y te suma comisión. | Pasa a "sistema viejo" con el resto (las comisiones de "sistema viejo" no se cuentan: verificado en el código). Durante la prueba, **no cargues ventas reales con tu usuario**, o avisame para pasarlas cada mañana. |
| A3 | Otros agentes **están probando en la base de producción** (A1 es de hoy) | Si alguien cobra, genera o crea clientes mientras probamos, los controles al peso no cierran y no sabemos qué es de quién. | Avisar a todos los agentes: desde la hora de inicio, nadie prueba en producción salvo esta sesión. |
| A4 | **Pedidos de prueba de la 1ª prueba y el 001990**: la puesta a cero no borra pedidos | Quedarían "entregados" sin comprobante, con su comisión "vendida" a tu nombre y apareciendo en fichas. | Pasarlos a "eliminado" (no se borran, se guarda la copia). Las comisiones de pedidos eliminados no se cuentan (verificado). |
| A5 | Tabla vieja `finanzas_saldos` (312 renglones, de abril a julio) | La usa el gráfico de evolución de Finanzas. No la toca la puesta a cero. | No se toca. Solo confirmar con Juan si esos números son reales o de prueba (no frena la prueba). |
| A6 | Lista de precios de 556 quedó en **Bahía** (1ª prueba, 3.5) | Cambia los precios de los pedidos de prueba de 556. | Decide Juan: vuelve a Neco o queda. |

---

## Decisiones que necesito de Juan antes de arrancar

- [ ] D1. **Apertura:** ¿cargamos el reporte **completo** del sistema viejo (ensayo real del día del pase) o solo los 3 clientes de prueba? Recomiendo el completo: es lo que más falló en la 1ª prueba y la puesta a cero del pase lo vuelve a borrar igual. Necesito el `.chr` de hoy.
- [ ] D2. Cliente 3 TEST-R1 → ¿le saco el código y lo desactivo? (recomendado)
- [ ] D3. Lista de 556: ¿Neco o Bahía?
- [ ] D4. Saldos reales de bancos y cajas para cargar después de la puesta a cero (los tenés a mano).
- [ ] D5. ¿Les avisás vos a los otros agentes que no prueben en producción, o les dejo el aviso escrito?

---

## Fase 0 — Preparación

- [x] 0.1 Auditoría de base, código, apps y cuentas de Juan (27/10, 13:30).
- [ ] 0.2 Avisar a los agentes: hora de inicio, nadie prueba en producción, nada nuevo a main que toque la salida sin avisar (D5).
- [ ] 0.3 Script complementario `20261027d_prueba2_preparar.sql` (lo escribo con tu OK): con simulacro y copia en `archivo_pruebas`, pasa a "eliminado" los pedidos 001939, 001940, 001941, 001942 y 001990, y le saca el código al cliente 3 (A1, A4). No toca nada real.
- [ ] 0.4 NuStar: en las 3 apps, que no quede nada "pendiente de sincronizar" antes de borrar datos (si queda algo, se pierde).
- [ ] 0.5 Juan tiene: el `.chr` del sistema viejo de hoy (D1) y los saldos de bancos y cajas (D4).

## Fase 1 — Todo a cero

Se corre en el editor SQL de Supabase, en este orden. Cada paso con su simulacro primero, que revisamos juntos.

- [ ] 1.1 Foto de la base antes (la saco yo): clientes, artículos, proveedores, pedidos, comprobantes con CAE, echeqs propios.
- [ ] 1.2 `SELECT * FROM cc_puesta_a_cero_simulacro();` → revisamos → `SELECT cc_puesta_a_cero('PONER A CERO');`
- [ ] 1.3 `SELECT * FROM prueba_limpieza_simulacro();` (la última fila tiene que dar 0) → `SELECT prueba_limpieza('LIMPIAR');`
- [ ] 1.4 Script de la 0.3: simulacro → ejecución.
- [ ] 1.5 `SELECT * FROM pedidos_sistema_viejo_simulacro(now(), '{}');` → `SELECT pedidos_pasar_a_sistema_viejo(now(), '{}', 'PASAR');` (pasan los 47+ reales nuevos, incluido el 001986).
- [ ] 1.6 Foto después: 0 comprobantes sin CAE, 12 con CAE ($0), 0 cobros, 0 devoluciones, 0 billetera, 0 comisiones cobradas, 0 viajes, 0 preparaciones, cola vacía, todos los saldos en $0, clientes/artículos/proveedores sin cambios contra la 1.1.
- [ ] 1.7 **Anotar la hora de inicio** (arriba, en "Control fiscal").
- [ ] 1.8 Juan carga los saldos de bancos y cajas ("Ajuste manual de saldo" en Finanzas). Saldos de partida:

| Cuenta | Saldo inicial | Nota |
|---|---|---|
| Banco Credicoop | | |
| Banco Nación | | |
| Banco Provincia | | |
| MercadoPago | | |
| Caja chica | | |
| Caja grande | | |
| Cheques en cartera | ninguno | |

  Al final, cada caja y banco tiene que dar: saldo inicial + lo que entró en la prueba − lo que salió, al peso.
- [ ] 1.9 `/personal` → "Poner al día": comisiones $0 y la cuenta de Juan en $0.
- [ ] 1.10 Pantallas del ERP en cero: "Pendientes de revisar" al día, caja del día sin movimientos, `/personal` todo en $0, ficha de URQUIZA en $0, cola del depósito vacía, sin viajes, tablero de Finanzas con billeteras en $0.
- [ ] 1.11 Apps: borrar datos de las 3 apps y entrar de nuevo, **una con usuario y otra con mail** (T1). Vendedor: plata en mano $0, cuenta $0, comisiones $0. Chofer: sin viaje, billetera $0. Depósito: 0 pedidos.

## Fase 2 — Importación de deudas del sistema viejo (`/apertura`)

- [ ] 2.1 Vista previa del `.chr`: los clientes con error van **aparte** y no frenan al resto (#5).
- [ ] 2.2 En la vista previa: el texto libre entra como ajuste (#6), las cuentas de empleados van a la cuenta personal (#7), se toma la **segunda** columna de saldo (#8), los PRES viejos quedan en punto de venta **0002** (#18).
- [ ] 2.3 Casos raros: 56 y 1381 (cambiaron de dueño), 765 y 766 (no existen en gmv2), y que **nada** caiga en el cliente 3 (A1).
- [ ] 2.4 Si el reporte trae deuda de **tu** cuenta como empleado, anotarla: rompe el "Juan en $0". Se decide en el momento.
- [ ] 2.5 Confirmar. Total importado = total del reporte, al peso.
- [ ] 2.6 La deuda de 556 se ve igual en la base, la ficha del ERP, la antigüedad del tablero y la app vendedor.
- [ ] 2.7 La apertura no genera comisiones. Control fiscal = 0.

## Fase 3 — Venta desde la app Vendedor (vos como vendedor)

| Cliente | Para qué lo usamos |
|---|---|
| 199 URQUIZA | Cuenta corriente: se entrega sin cobrar; después lo cobra el vendedor (efectivo + transferencia, con 10 % contado). Devolución de más de lo vendido. |
| 1190 CHEN | "Cobrar en el viaje" con 10 % contado: **devolución antes del cobro**. Un segundo pedido para refacturar con pago parcial. |
| 556 FITTERER | Tiene deuda vieja: "no entregar si no paga lo anterior". Preparación parcial y un pedido con todo faltante. **Cobro antes de la devolución.** |

- [ ] 3.1 Pedido 199 (varios artículos, alguno con cantidad grande para devolver).
- [ ] 3.2 Pedido 1190-A con 10 % contado tildado al finalizar (el total en vivo cambia, #13).
- [ ] 3.3 Pedido 1190-B (para refacturar en la Fase 8b).
- [ ] 3.4 Pedido 556-A con un renglón de 36 unidades (se van a preparar 30).
- [ ] 3.5 Pedido 556-B que va a quedar todo faltante.
- [ ] 3.6 Comisión vendida igual en la app y en la base. Los pedidos aparecen en el ERP con el vendedor correcto.

## Fase 4 — Preparación en la app Depósito

- [ ] 4.1 Preparar completos 199, 1190-A y 1190-B.
- [ ] 4.2 556-A parcial: 30 de 36. El ERP muestra "30 de 36" (#14).
- [ ] 4.3 556-B todo faltante: avisa; se puede volver a pendiente o eliminar; no aparece como cobrable en ningún lado (#17/#39).
- [ ] 4.4 "Reiniciar preparación" funciona (D3).

## Fase 5 — Gestión en el ERP

- [ ] 5.1 Condiciones: 199 cuenta corriente; 1190 cobrar en viaje; 556 bloqueado si no paga lo anterior.
- [ ] 5.2 Generar comprobantes: **antes, mirar que diga Presupuesto.** 556-A se factura por 30, no por 36 (#15). Control fiscal = 0.
- [ ] 5.3 Modificar un pedido después de preparado: cambiar la lista (no el método a Factura) y repreciar (#16).
- [ ] 5.4 Bultos y pallets cargados en el ERP; el remito y la hoja de ruta los toman (#22).
- [ ] 5.5 Armar el viaje con vos de chofer y un vehículo. Hoja de ruta con los números de PRES bien (#21).
- [ ] 5.6 Entregarle fondo al chofer desde la caja chica. La caja baja y la billetera sube lo mismo, en la base y en el tablero.
- [ ] 5.7 Despachar.

## Fase 6 — Entregas desde la app Chofer

- [ ] 6.1 El viaje aparece con las 3 paradas, las deudas y la billetera = fondo.
- [ ] 6.2 **1190-A:** devolución parcial **antes** de cobrar → cobro mixto efectivo + transferencia con 10 % contado (#33, R6). El 10 % se calcula sobre el comprobante completo.
- [ ] 6.3 **199:** intentar devolver más de lo vendido → no deja (C2/#25). La pantalla muestra artículo y cantidad. Lo devuelto de más en un PRES va al respaldo 0002-00000001 como "sistema viejo" (C8).
- [ ] 6.4 **556 bloqueado:** intentar entregar sin cobrar → no deja. Cobrar → entregar → **anular el cobro** → la parada vuelve a pendiente (R4/C7). Volver a cobrar con 10 % y **después** registrar una devolución: el 10 % tiene que dar lo mismo que en 6.2 (misma regla).
- [ ] 6.5 1190-B: entregar con un pago parcial (para la 8b).
- [ ] 6.6 Un cobro con cheque.
- [ ] 6.7 Una transferencia anotada: **no** entra en la rendición (#35).
- [ ] 6.8 Gasto de nafta con el vehículo (#43).
- [ ] 6.9 Finalizar. La propuesta de rendición = efectivo cobrado + fondo − gastos.

## Fase 7 — Rendición del chofer en el ERP (`/caja`)

- [ ] 7.1 Aceptar la rendición con una diferencia chica: la diferencia va **solo** a tu cuenta personal, no a la billetera (#29).
- [ ] 7.2 Los gastos se aprueban al aceptar, con el vehículo (#43).
- [ ] 7.3 Revisar las devoluciones: aceptar/rechazar. Salen REV, **nunca NC**. Control fiscal = 0.
- [ ] 7.4 "Transf. por confirmar": la del chofer está ahí y entra al banco recién al confirmarla (#35).
- [ ] 7.5 Billetera del chofer en $0 en la base, en el tablero de Finanzas y en la app (#29/#36).
- [ ] 7.6 Cajas: lo que entró = efectivo rendido. Cheque en cartera.

## Fase 8 — Vendedor: cobro y rendición

- [ ] 8.1 Cobrar a 199 desde la app: efectivo + transferencia con 10 % contado.
- [ ] 8.2 Retiro de efectivo a cuenta de comisión: va a tu cuenta personal.
- [ ] 8.3 Rendición desde la app; confirmarla en el ERP.
- [ ] 8.4 Billetera vendedor en $0 en la base, el tablero y la app (#36).
- [ ] 8.5 La transferencia aparece en "Transf. por confirmar", no en la rendición.

## Fase 8b — Refacturar un pedido entregado con pago parcial (R1/R3)

- [ ] 8b.1 1190-B: anular comprobantes → cambiar la lista → repreciar → emitir PRES. El pedido sigue "entregado" y el pago parcial pasa al comprobante nuevo.
- [ ] 8b.2 Con un pedido cobrado al 100 %, el botón no deja.
- [ ] 8b.3 Control fiscal = 0 (acá es donde puede saltar una ND automática).

## Fase 8c — Pago en la oficina (`/caja`)

- [ ] 8c.1 556 paga lo que le queda (incluida la deuda de la apertura). Imputar no ofrece el pedido todo faltante (#39).

## Fase 9 — Billeteras, cuentas y comisiones

- [ ] 9.1 Comisión ganada **igual** en la app vendedor, en `/personal` y en el Playroom (#41/#42/#10).
- [ ] 9.2 Tu cuenta personal = comisiones ganadas − retiros ± diferencias de rendición. Cada movimiento con su origen.
- [ ] 9.3 Billeteras de chofer y vendedor en $0 en las 4 vistas (base, tablero, app, `/personal`).
- [ ] 9.4 Saldos de 199, 1190 y 556 a mano contra la base.
- [ ] 9.5 Cajas y bancos cuadran al peso contra la tabla de la 1.8.
- [ ] 9.6 Control fiscal final = 0.

## Fase 10 — Cierre

- [ ] 10.1 Resumen de problemas por gravedad y por dueño; traspasos escritos.
- [ ] 10.2 Lo que dejó la prueba en la base y cómo se limpia el día del pase.
- [ ] 10.3 Script para borrar por número los pedidos de prueba de esta prueba (la puesta a cero no borra pedidos).

---

## Cada mañana mientras dure la prueba

- [ ] Pasar los pedidos reales nuevos: `SELECT pedidos_pasar_a_sistema_viejo(now(), '{1190,199,556}', 'PASAR');`
- [ ] **Ojo:** si entra un pedido **real** de 1190, 199 o 556, no se pasa solo (están excluidos) y se mezcla con la prueba. Lo miro yo cada mañana y lo anotamos.
- [ ] Control fiscal = 0.

## Cosas escondidas o forzadas durante la prueba

| Fecha | Qué | Dónde | Cómo se deshace | ¿Deshecho? |
|---|---|---|---|---|
| | | | | |

## Problemas encontrados durante la prueba

| # | Fase | Qué pasó | Gravedad | Dueño | Estado |
|---|---|---|---|---|---|
| | | | | | |
