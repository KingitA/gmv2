# Prueba integral — salida de mercadería (ensayo general antes de producción)

Armado el 23/10/2026. Es la lista que vamos tildando juntos con Juan. Cada casilla se tilda recién cuando lo vimos funcionar con nuestros ojos (pantalla del ERP, app o consulta a la base).

## Reglas de esta prueba

- **Nunca se emite un comprobante fiscal a propósito** (factura, nota de crédito, nota de débito con CAE). Todo se hace en presupuesto (PRES) y reversa (REV).
- **No se bloquea nada en el código** (decisión de Juan, 23/10): si en algún paso sale una factura o una NC, es un **error encontrado**. Se anota en "Problemas encontrados" y se anula con su nota de crédito o débito. Al final de cada fase se controla con una consulta: "comprobantes fiscales nuevos = 0".
- **No se tocan los datos reales**: artículos, clientes, proveedores, pedidos reales y los 12 comprobantes con CAE (hoy suman $0). Lo que haya que esconder o forzar se anota en "Cosas escondidas o forzadas".
- Todo lo que se cambia o borra en la base se copia antes al archivo (`archivo_pruebas`), con foto antes y después.

## Decisiones de Juan (23/10)

1. **Puesta a cero de toda la base** (no solo de Juan).
2. Nadie factura desde gmv2 todavía; los fiscales los emitió Juan y están anulados (suman $0).
3. Los 30 pedidos reales que movieron las pruebas viejas vuelven a su lugar.
4. **Estado nuevo "Sistema viejo"** para los pedidos reales cargados antes del corte (ya entregados y cobrados en el otro sistema): salen de la cola del depósito, del armado de viajes y de los "pedidos cobrables" de las fichas. Los 30 movidos también terminan ahí, que es su estado real.
5. **El stock no es real** (hay artículos con stock nulo): no se controla ni se devuelve.
6. **Clientes de prueba: 1190, 199 y 556**, con lista Neco presupuesto. Se puede cambiar alguno a lista Bahía, pero **sin tocar el método de facturación**.

## Lo que encontré en la auditoría (23/10)

### Tus cuentas hoy (Juan Cruz Rossi)

| Qué | Cómo está | Qué pasa |
|---|---|---|
| Cuenta personal ("ROSSI JUAN CRUZ") | Debe $122.000 (un retiro de prueba) | Se borra con la puesta a cero |
| Billetera de vendedor | $6.311,05 y 36 movimientos de prueba | Se borra con la puesta a cero |
| Comisiones "cobradas" | 108 renglones ($454.029) | Se borran con la puesta a cero |
| Comisiones "vendidas" | 502 renglones ($2.098.224) | **No se tocan**: salen de las ventas reales |
| Viajes donde sos chofer | 10 viajes de prueba, 6 abiertos | Los borra la limpieza complementaria |
| URQUIZA (199) | Saldo $293.966,69 de prueba | Se borra con la puesta a cero |

### Los 3 clientes de prueba

| Código | Cliente | Localidad / zona | Método | Lista | Ojo |
|---|---|---|---|---|---|
| 1190 | CHEN XIANG RONG | Punta Alta / PUNTA ALTA | Presupuesto | Neco | Saldo $0. 1 pedido real impreso |
| 199 | DISTRIBUIDORA URQUIZA | Punta Alta / PUNTA ALTA | Presupuesto | Neco | Condición por proveedor: Presupuesto con 10 % dto. 6 pedidos reales impresos y 5 "facturados" por pruebas viejas |
| 556 | FITTERER SANTAGADA SA | Bahía Blanca / BAHIA | Presupuesto | Neco | 1 impreso y 1 "facturado" por pruebas viejas |

- Los tres son Responsable Inscripto con CUIT: si algo saliera fiscal, saldría **Factura A / NC A**.
- Los tres tienen a Juan como vendedor y **no** son cuentas de empleado (esas no pasan por el depósito).
- Mientras dure la prueba, conviene **no cargar pedidos reales** a estos 3 clientes desde gmv2: se mezclarían con los de prueba.

### Toda la base

- 25 clientes con saldo (total $33,7 M), todo de prueba.
- Comprobantes: 46 PRES, 29 REV y 25 facturas sin CAE (todo de prueba); 12 con CAE (reales, se conservan).
- 30 pedidos reales movidos por pruebas viejas (8 facturados, 3 entregados, 3 en viaje, 11 en preparación, 5 en viajes de prueba).
- 1.610 pedidos reales "impreso". **Siguen entrando pedidos reales todos los días** (104 desde el 15/10): por eso el pase a "Sistema viejo" se puede volver a correr.
- 28 viajes, todos de prueba.

### Caminos por donde puede salir un fiscal (lo que hay que mirar con lupa)

1. **Generar comprobantes** de un pedido: si un renglón, una marca o un proveedor dice "Factura", sale FA aunque el cliente diga "Presupuesto".
2. **10 % contado**: se emite solo al confirmar un cobro. Si el comprobante es PRES sale REV; si es FA sale NC A.
3. **Devolución que no quedó atada a su presupuesto**: el sistema decide por la condición del cliente y del artículo (la app vendedor pone "factura" por defecto).
4. **Anular** desde el ERP (de un PRES sale REV, sin ARCA) y **nota de débito** (siempre fiscal: no se usa en la prueba).

---

## Fase 0 — Preparación

- [x] 0.1 Auditoría: base, código y cuentas de Juan (23/10).
- [ ] 0.2 Código: estado "Sistema viejo" en las pantallas. Fuera de la cola, del armado de viajes, del calendario de pedidos sueltos y de los pedidos cobrables (ERP, ficha del vendedor y del chofer). Rama `prueba-integral`.
- [ ] 0.3 SQL (Juan lo aplica en Supabase): agrega el estado e instala cuatro funciones que no hacen nada hasta que se las llama:
  - pasar a "Sistema viejo" (con simulacro);
  - limpieza complementaria de viajes, remitos de viaje y preparación del depósito (con simulacro).
- [ ] 0.4 Pasar la rama a main y desplegar **antes** de mover los pedidos. Así ninguna pantalla se encuentra con un estado que no conoce.
- [ ] 0.5 Avisar a los otros agentes el día y la hora de la puesta a cero.
- [ ] 0.6 Anotar en `docs/PENDIENTES-APPS.md` que las apps muestren "Sistema viejo" con nombre lindo (hoy mostrarían el texto crudo).

## Fase 1 — Todo a cero

- [ ] 1.1 Foto de la base antes.
- [ ] 1.2 `SELECT * FROM cc_puesta_a_cero_simulacro();` → revisamos juntos.
- [ ] 1.3 `SELECT cc_puesta_a_cero('PONER A CERO');`
- [ ] 1.4 `SELECT * FROM prueba_limpieza_simulacro();` (la última fila tiene que dar 0) → `SELECT prueba_limpieza('LIMPIAR');`
- [ ] 1.5 `SELECT * FROM pedidos_sistema_viejo_simulacro(now(), '{1190,199,556}');` → `SELECT pedidos_pasar_a_sistema_viejo(now(), '{1190,199,556}', 'PASAR');`
  - **Ojo:** los pedidos reales viejos de los 3 clientes de prueba también hay que pasarlos. Se corre una segunda vez sin excluir a nadie, **antes** de cargar el primer pedido de prueba.
- [ ] 1.6 Foto después. Tienen que quedar: los 12 con CAE, los 3 echeqs propios, todos los clientes, artículos y proveedores, y todos los pedidos (en "Sistema viejo" o "Eliminado").
- [ ] 1.7 Juan carga los saldos reales de bancos y caja.
- [ ] 1.8 Verificar en cero: tu cuenta personal, billetera de vendedor y de chofer, comisiones cobradas, viajes (ninguno), saldos de todos los clientes, cola del depósito vacía.
- [ ] 1.9 Borrar datos o volver a iniciar sesión en las 3 apps del NuStar. Verificar que muestran todo en cero y la cola vacía.

## Fase 2 — Importación de deudas del sistema viejo

- [ ] 2.1 `/apertura` con el reporte "Comprobantes Impagos de Clientes" del sistema viejo. Vista previa: no falta ningún cliente y el total da igual al reporte.
- [ ] 2.2 Confirmar la carga.
- [ ] 2.3 Verificar la deuda de 1190, 199 y 556 (si tienen) en la ficha del ERP, en la app vendedor y en la antigüedad de deuda: los tres tienen que dar lo mismo que el reporte.
- [ ] 2.4 Los comprobantes de la apertura **no** generan comisión.
- [ ] 2.5 Si ninguno de los 3 tiene deuda vieja, la apertura de 1 o 2 comprobantes viejos para uno de ellos se arma a mano (vista previa juntos).

## Fase 3 — Venta desde la app Vendedor

- [ ] 3.1 Pedido a 199 (URQUIZA) con varios artículos de distintas marcas y rubros, alguno bonificado (prueba la condición por proveedor con 10 %).
- [ ] 3.2 Pedido a 1190 marcado contado.
- [ ] 3.3 Pedido a 556.
- [ ] 3.4 Un pedido hecho **sin señal** (modo avión) que se envía al volver: no se duplica.
- [ ] 3.5 Cambiar a un cliente de lista Neco a lista Bahía (sin tocar método) y hacerle un pedido: los precios cambian como corresponde.
- [ ] 3.6 Los pedidos llegan al ERP con los mismos precios y totales que mostró la app.
- [ ] 3.7 Comisión "vendida" visible en la app y en el ERP con el % correcto por rubro.
- Números de pedido: ……

## Fase 4 — Preparación en la app Depósito

- [ ] 4.1 La cola muestra **solo** los pedidos de prueba (nada de "Sistema viejo").
- [ ] 4.2 Preparar uno completo.
- [ ] 4.3 Preparar uno con un faltante.
- [ ] 4.4 El ERP muestra lo preparado y el faltante.

## Fase 5 — Gestión en el ERP

- [ ] 5.1 Modificar un pedido: sacar un renglón y cambiar una cantidad.
- [ ] 5.2 Cambiar la condición de pago de un pedido.
- [ ] 5.3 Generar comprobantes: **solo PRES**. Consulta: fiscales nuevos = 0.
- [ ] 5.4 Los PRES suman a la cuenta del cliente.
- [ ] 5.5 Armar el viaje: solo ofrece pedidos de prueba; asignar chofer (Juan) y vehículo.
- [ ] 5.6 Bloquear la entrega de un cliente (retener entregas): el chofer ve el aviso.
- [ ] 5.7 Entregar fondo al chofer: aparece en su billetera.
- [ ] 5.8 Despachar el viaje.

## Fase 6 — Entregas desde la app Chofer

- [ ] 6.1 El viaje aparece con sus paradas y el saldo de cada cliente (deuda vieja + viaje, sin contar dos veces).
- [ ] 6.2 199: entrega completa y cobro **parcial** en efectivo + un cheque.
- [ ] 6.3 1190: entrega y cobro contado total con el 10 %: sale **REV**, nunca NC.
- [ ] 6.4 Una devolución de un renglón, atada a su presupuesto.
- [ ] 6.5 Cliente bloqueado: no se entrega y el pedido vuelve.
- [ ] 6.6 Un gasto del viaje (nafta).
- [ ] 6.7 Parte del recorrido sin señal: todo sincroniza al volver, sin duplicados.
- [ ] 6.8 Finalizar: la app propone lo que hay que entregar (efectivo cobrado + fondo − gastos).

## Fase 7 — Rendición del chofer en el ERP

- [ ] 7.1 La rendición aparece en Caja → Pendientes de revisar.
- [ ] 7.2 Rendir con una diferencia chica a propósito (por ejemplo $1.000 de menos): va a la cuenta personal del chofer.
- [ ] 7.3 Confirmar: los cobros entran a la cuenta de los clientes, el cheque queda en cartera, el pedido entregado pasa a "entregado" y el bloqueado vuelve sin viaje.
- [ ] 7.4 La devolución **no** se confirma sola: espera al depósito.
- [ ] 7.5 Depósito acepta la devolución (un renglón sí y otro con la cantidad cambiada).
- [ ] 7.6 La oficina emite la **REV** de la devolución desde la bandeja. Consulta: fiscales nuevos = 0.

## Fase 8 — Rendición del vendedor

- [ ] 8.1 El vendedor cobra en la calle lo que quedó debiendo, en efectivo y por transferencia.
- [ ] 8.2 El vendedor retira su comisión desde la app.
- [ ] 8.3 El vendedor envía la rendición: propone efectivo − retiros.
- [ ] 8.4 La oficina confirma: la transferencia queda pendiente hasta controlar el banco.
- [ ] 8.5 Rechazar un pago a propósito: vuelve a la deuda del cliente, no al vendedor.

## Fase 9 — Billeteras, cuentas y comisiones

- [ ] 9.1 Billetera del chofer: plata en mano = 0 después de rendir; la cuenta personal tiene la diferencia.
- [ ] 9.2 Billetera del vendedor: plata en mano con los cheques como unidades; en la cuenta personal, comisiones a favor y el retiro en contra.
- [ ] 9.3 La comisión se gana **solo** sobre comprobantes saldados del todo; la devolución y el 10 % contado la bajan.
- [ ] 9.4 La misma comisión se ve igual en la app vendedor, en `/personal` y en el Playroom.
- [ ] 9.5 Imputación: un pago sin comprobante → "Imputar a lo más viejo" o "Dejar a cuenta".
- [ ] 9.6 Saldos de 1190, 199 y 556: ERP = app vendedor = app chofer = antigüedad.
- [ ] 9.7 La caja del día cuadra con todo lo confirmado.
- [ ] 9.8 Consulta final: **cero comprobantes fiscales nuevos** desde que empezó la prueba.

## Fase 10 — Cierre

- [ ] 10.1 Repasar "Problemas encontrados" y decidir quién arregla cada uno.
- [ ] 10.2 Anotar los números de los pedidos de prueba (para borrarlos el día del pase).
- [ ] 10.3 El día del pase a producción:
  - puesta a cero;
  - limpieza complementaria;
  - borrar los pedidos de prueba por número;
  - pasar a "Sistema viejo" todo lo cargado hasta ese momento;
  - apertura con el reporte de ese día;
  - saldos de bancos y caja.

---

## Cosas escondidas o forzadas durante la prueba

| Fecha | Qué | Dónde | Cómo se deshace | ¿Deshecho? |
|---|---|---|---|---|
| | Pedidos reales pasados a "Sistema viejo" | tabla `pedidos` (estado anterior guardado en `archivo_pruebas.pedidos_estado_previo_*`) | Es definitivo (decisión de Juan); se puede volver atrás con la copia | — |

## Problemas encontrados durante la prueba

| # | Fase | Qué pasó | Quién lo arregla | Estado |
|---|---|---|---|---|
| 1 | Auditoría | Los pedidos viejos (impresos) figuraban como "cobrables a cuenta" en las fichas del ERP, del vendedor y del chofer | Servidor (estado Sistema viejo) | En la rama |

## Anexo — números de referencia

- Vendedor Juan Cruz: `8146a51a-b423-4a0f-b207-2b78341e1b91`. Usuario: `d6ac25bb-8204-474d-9e3c-12c2807ac2b7`. Cuenta personal: `e0208afd-d909-45b1-bedc-60d007e7b891`.
- Clientes de prueba:
  - 1190 `7366eab6-603d-41aa-a31a-806c07d41e07`;
  - 199 `6daf55b6-22df-491d-b2e3-522674ab89d7`;
  - 556 `0ba07007-10cc-426a-9692-a32df50d9e8c`.
- Consulta "fiscales nuevos" (desde el inicio de la prueba): `select tipo_comprobante, numero, created_at from comprobantes_venta where tipo_comprobante not in ('PRES','REV') and created_at >= '<inicio>'`.
