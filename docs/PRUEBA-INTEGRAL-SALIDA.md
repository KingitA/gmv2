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
7. **Cada cliente paga por un camino distinto** (23/10), para ver cómo se comporta cada uno:

| Cliente | Cómo paga | Qué se prueba |
|---|---|---|
| **1190** CHEN XIANG RONG (Punta Alta) | **Al chofer, con la entrega bloqueada** hasta que pague | Bloqueo de entrega, cobro contado con 10 % (REV), desbloqueo y entrega, rendición del chofer |
| **199** DISTRIBUIDORA URQUIZA (Punta Alta) | **Al vendedor, desde la app** | Entrega a cuenta corriente, cobro del vendedor (efectivo + cheque), retiro de comisión, rendición del vendedor, comisión ganada |
| **556** FITTERER SANTAGADA (Bahía Blanca) | **En la oficina, desde /caja** | Entrega a cuenta corriente, pago por transferencia en /caja (pendiente hasta controlar el banco), "imputar a lo más viejo" o "dejar a cuenta" |

   Si querés cambiar quién paga por dónde, se cambia esta tabla y listo.

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
- [x] 0.2 Código: estado "Sistema viejo" en las pantallas. Fuera de la cola, del armado de viajes, del calendario de pedidos sueltos y de los pedidos cobrables (ERP, ficha del vendedor y del chofer). Rama `prueba-integral`.
- [x] 0.3 SQL `supabase/migrations/20261023_prueba_integral.sql` (Juan lo aplica en Supabase): agrega el estado e instala cuatro funciones que no hacen nada hasta que se las llama:
  - pasar a "Sistema viejo" (con simulacro);
  - limpieza complementaria de viajes, remitos de viaje y preparación del depósito (con simulacro).
- [x] 0.4 Pasar la rama a main y desplegar **antes** de mover los pedidos. Así ninguna pantalla se encuentra con un estado que no conoce. (En main 23/10, 1ec4f89; SQL aplicado por Juan y verificado 23/10; Vercel lo publicó 23/10.)
- [x] 0.5 Avisar a los otros agentes el día y la hora de la puesta a cero.
- [ ] 0.6 Anotar en `docs/PENDIENTES-APPS.md` que las apps muestren "Sistema viejo" con nombre lindo (hoy mostrarían el texto crudo).

## Fase 1 — Todo a cero

- [x] 1.1 Foto de la base antes (23/10): 617 clientes, 3.293 artículos, 94 proveedores, 1.937 pedidos, 12 con CAE (suman $0), 3 echeqs propios; prueba: 119 comprobantes, $33,7 M de saldo, 46 cobros, 13 devoluciones, 71 mov. billetera, 124 comisiones cobradas, 438 cheques, 28 viajes, 26 preparaciones.
- [x] 1.2 `SELECT * FROM cc_puesta_a_cero_simulacro();` → revisamos juntos.
- [x] 1.3 `SELECT cc_puesta_a_cero('PONER A CERO');`
- [x] 1.4 `SELECT * FROM prueba_limpieza_simulacro();` (la última fila tiene que dar 0) → `SELECT prueba_limpieza('LIMPIAR');`
- [x] 1.5 `SELECT * FROM pedidos_sistema_viejo_simulacro(now(), '{}');` → `SELECT pedidos_pasar_a_sistema_viejo(now(), '{}', 'PASAR');`
  - Todavía no hay pedidos de prueba, así que se pasan todos, también los viejos de 1190, 199 y 556.
  - Durante la prueba, cada mañana, para mover los pedidos reales nuevos sin tocar los de prueba: `SELECT pedidos_pasar_a_sistema_viejo(now(), '{1190,199,556}', 'PASAR');`
- [x] 1.6 Foto después (23/10, 14:45): 1.937 pedidos (1.640 en Sistema viejo y 297 eliminados), 12 comprobantes (todos con CAE, suman $0), 12 asientos, 6 imputaciones, 3 cheques (echeqs propios), 0 cobros, devoluciones, billetera, comisiones cobradas, viajes y preparaciones; saldo de todos los clientes $0; clientes, artículos y proveedores sin cambios. Copias: archivo_pruebas.*_20261023_1444, *_20261023_144512 y pedidos_estado_previo_20261023_144528.
- [x] 1.7 Juan cargó los saldos (23/10, 15:00; "Ajuste manual de saldo" en Finanzas). **Saldos de partida, para controlar al final:**

| Cuenta | Saldo inicial | Nota |
|---|---|---|
| Banco Credicoop | $13.443.379,93 | real |
| Banco Nación | $97.838,56 | real |
| Banco Provincia | $525.328,78 | real |
| MercadoPago | $1.806.871,54 | real |
| Caja (chica) | $100.000,00 | redondo, para la prueba |
| Caja (grande) | $10.000.000,00 | redondo, para la prueba |
| Cheques en cartera | ninguno | si entra un cheque en la prueba, se ve cómo funciona |

  Al terminar: cada caja y banco tiene que dar el saldo inicial más lo que entró en la prueba y menos lo que salió, y cada movimiento tiene que tener su origen (cobro, rendición, entrega de fondo, gasto).
- [x] 1.8 Verificar en cero (23/10, 14:50, en el ERP):
  - Pendientes de revisar: "Está todo al día".
  - Caja del día: 0 movimientos y efectivo esperado $0.
  - /personal: las 17 cuentas en $0, la de Juan también.
  - Ficha de URQUIZA: saldo $0 y pedidos viejos en "sistema viejo".
  - Cola del depósito (web): 0 pedidos.
  - Viajes: ninguno.
- [x] 1.9 Apps del NuStar (23/10, 14:55): datos borrados (`pm clear`), equipo reiniciado y Juan inició sesión de nuevo.
  - Vendedor 0.4.3: plata en mano $0, cuenta $0, 9 clientes en $0. Cobrar a URQUIZA: "Sin comprobantes" y "No hay pedidos sin facturar" (antes ofrecía los pedidos viejos).
  - Chofer 0.3.2: sin viaje; billetera $0 y cuenta $0.
  - Depósito 0.3.0: 0 pedidos para preparar.
- [ ] 1.10 `/personal` → "Poner al día" en la cuenta de Juan: tiene que dar comisiones $0 (pendiente V3 del agente vendedor: "Mercadería cobrada" y "Comisiones ganadas" tienen que coincidir).

## Fase 2 — Importación de deudas del sistema viejo

**Revisión del reporte real** (`pruebafacimpagasclientesxcodigo.chr`, del 23/10). Lo leí en mi PC con el mismo lector que usa `/apertura`, sin tocar la base:
- 1.859 renglones de 249 clientes; total pendiente $675.632.433,83 (igual al total general del reporte).
- **Hoy `/apertura` no deja confirmar este archivo**: alcanza con que un solo cliente tenga error para frenar todo, y hay unos 34 con error (ver problemas 5 a 9).
- Los clientes de prueba en el sistema viejo:
  - 1190 y 199 no deben nada;
  - **556 debe $3.784.286,00**, en 2 presupuestos del 12/06/2026: 0001-00117929 por $548.283,00 y 0001-00117930 por $3.236.003,00.
- **Para no frenar la prueba**: armé `C:\Users\INTEL PC1\Desktop\apertura-prueba-556.chr`, con **solo los 2 renglones de 556**, tal cual el original. La vista previa local da 0 errores. La importación completa queda como tarea antes del pase (problemas 5 a 9).

- [x] 2.1 `/apertura` con `apertura-prueba-556.chr`. La vista previa tiene que mostrar 1 cliente, 2 presupuestos y $3.784.286,00, sin errores.
- [x] 2.2 Confirmar la carga (Juan, 23/10 ~15:05).
- [x] 2.3 La deuda de 556 ($3.784.286,00 al 12/06) se ve igual en todos lados (23/10, 15:11):
  - base: 2 PRES "APERTURA GM" y libro $3.784.286,00;
  - ficha del ERP: "Nos debe $3.784.286";
  - antigüedad del tablero de Finanzas: "más de 90 días" $3.784.286;
  - app vendedor, después de "Actualizar": $3.784.286,00 con PRES 0001-00117929 y 0001-00117930 pendientes.
  - La app chofer se ve en la 6.1 (hoy no tiene viaje).
- [x] 2.4 Los comprobantes de la apertura **no** generan comisión (0 comisiones). Fiscales nuevos: 0 (los 2 comprobantes nuevos son PRES).
- [ ] 2.5 (antes del pase, no frena la prueba) Importación completa: resolver los problemas 5 a 9 y repetir la vista previa con el reporte de ese día.

## Fase 3 — Venta desde la app Vendedor

> **Todo pedido de prueba lleva "PRUEBA" en las observaciones**, para que nadie de la oficina o del depósito lo prepare o despache de verdad. Desde el lunes 26/10 la oficina sigue importando e imprimiendo pedidos reales como siempre: van a aparecer en la cola junto con los de prueba, y Juan trabaja solo los suyos.

- [x] 3.1 **001939 — URQUIZA (199):** 5 artículos y 540 unidades por $2.017.121,16; después 3.4 le sumó un renglón. Las 2 bolsas de ARNANUK llevan el 10 % de su condición por proveedor (por ejemplo, la bolsa consorcio 80x110 de $2.094,38 a $1.884,94). Todo en Presupuesto y lista Neco.
- [~] 3.2 **001940 — CHEN XIANG RONG (1190):** 4 artículos, 31 unidades, $154.329,05. **No se pudo marcar como contado**: ni la app ni el ERP tienen esa opción al tomar el pedido (problema 13). Hoy el 10 % contado se aplica recién al cobrar, así que se prueba en la 6.3 cuando el chofer cobre.
- [x] 3.3 **001941 — FITTERER (556):** 5 artículos, 180 unidades, $722.880,96.
- [x] 3.4 Sin señal (modo avión): Juan **editó** el 001939 y le agregó 240 bolsas consorcio 60x90 (+$292.094,40). Al volver la señal se mandó una sola vez: el mismo pedido quedó con 6 renglones, 780 unidades y $2.309.215,56, sin duplicados.
- [x] 3.5 556 pasado a lista **Bahía** en el ERP; el pedido **001942** (3 artículos HORNAL, 100 unidades, $115.545,25) salió con lista Bahía en cada renglón y método Presupuesto. Fueron artículos distintos a los del pedido anterior, así que no hay una comparación del mismo artículo entre las dos listas.
- [x] 3.6 Los 4 pedidos llegaron con el total **exacto** que mostró la app (los renglones suman lo mismo que el total). Todos entraron como "pendiente" (no "en revisión", porque los clientes ya tenían pedidos) y no salió ningún fiscal.
- [~] 3.7 Comisión "vendida": **el cálculo está bien**, renglón por renglón. Da $104.058,65: 001939 $73.135,90, 001940 $7.222,82, 001941 $17.922,67 y 001942 $5.777,26.
  - Va 5 % en limpieza y bazar, y en perfumería 5 % (negro) o 3 % (blanco).
  - En los artículos "blancos" vendidos en presupuesto se calcula sin IVA (÷1,21), como dice la regla del motor.
  - **Pero la pantalla del vendedor muestra mal el total y los números de pedido**: ver problemas 10 y 11.
- Números de pedido: **001939** (199), **001940** (1190), **001941** y **001942** (556). Solo el 001939 tiene "Prueba" en observaciones: a los otros 3 hay que agregárselo desde el ERP (5.1).

## Fase 4 — Preparación en la app Depósito

- [x] 4.1 La cola mostró solo los 4 pedidos de prueba. Ningún pedido real fuera de "Sistema viejo" (23/10, ~18:20).
- [x] 4.2 Preparados completos: **001939** (URQUIZA, 6 renglones) y **001940** (CHEN, 4 renglones).
- [x] 4.3 **001941** (FITTERER) con faltantes:
  - PACKx2 ULTRA BLANCO: 30 de 36, queda "PARCIAL";
  - Cepillo BATMAN: 0 de 12, "FALTANTE";
  - CEPILLO KIDS: Juan lo marcó faltante y después lo volvió al pedido, y quedó bien, 24 de 24 "COMPLETO";
  - el resto, completo.
- [x] 4.3b **001942** (FITTERER, lista Bahía): los 3 renglones marcados **faltante** (0 preparado), para ver qué hace el sistema con un pedido que no tiene nada para entregar.
- [x] 4.4 Los 4 pasaron a "Pendiente Facturación". La ficha del pedido en el ERP muestra quién preparó y cuándo ("Juan Cruz · 18:19–18:21"), y cada renglón tiene un color (rojo faltante, naranja parcial, verde completo). Ver problema 14.
- [ ] 4.5 (se ve en la 5.3) Al generar los comprobantes: el 001941 tiene que salir **por lo preparado**, sin el BATMAN y con 30 PACKx2 en vez de 36. El 001942 no debería generar comprobante, o tiene que avisar que no hay nada para facturar.

## Fase 5 — Gestión en el ERP

- [ ] 5.1 Modificar un pedido: sacar un renglón y cambiar una cantidad.
- [ ] 5.2 Cambiar la condición de pago de un pedido.
- [ ] 5.3 Generar comprobantes: **solo PRES**. Consulta: fiscales nuevos = 0.
- [ ] 5.4 Los PRES suman a la cuenta del cliente.
- [ ] 5.5 Armar el viaje: solo ofrece pedidos de prueba; asignar chofer (Juan) y vehículo.
- [ ] 5.6 Bloquear la entrega de **1190** hasta que pague (retener entregas): el chofer ve el aviso.
- [ ] 5.7 Entregar fondo al chofer: aparece en su billetera.
- [ ] 5.8 Despachar el viaje.

## Fase 6 — Entregas desde la app Chofer

- [ ] 6.1 El viaje aparece con sus paradas y el saldo de cada cliente (deuda vieja + viaje, sin contar dos veces).
- [ ] 6.2 **1190 (paga al chofer):** la app no deja entregar mientras no pague.
- [ ] 6.3 1190 paga contado total con el 10 % → sale **REV**, nunca NC → se desbloquea y se entrega.
- [ ] 6.4 **199 (paga al vendedor):** entrega completa a cuenta corriente, sin cobrar. Una devolución de un renglón, atada a su presupuesto.
- [ ] 6.5 **556 (paga en la oficina):** entrega completa a cuenta corriente, sin cobrar.
- [ ] 6.5b (opcional) Bloqueado que no paga: no se entrega y el pedido vuelve sin viaje.
- [ ] 6.6 Un gasto del viaje (nafta).
- [ ] 6.7 Parte del recorrido sin señal: todo sincroniza al volver, sin duplicados.
- [ ] 6.8 Finalizar: la app propone lo que hay que entregar (efectivo cobrado + fondo − gastos).

## Fase 7 — Rendición del chofer en el ERP

- [ ] 7.1 La rendición aparece en Caja → Pendientes de revisar.
- [ ] 7.2 Rendir con una diferencia chica a propósito (por ejemplo $1.000 de menos): va a la cuenta personal del chofer.
- [ ] 7.3 Confirmar: el cobro de 1190 entra a su cuenta (saldo $0) y los pedidos entregados pasan a "entregado".
- [ ] 7.4 La devolución **no** se confirma sola: espera al depósito.
- [ ] 7.5 Depósito acepta la devolución (un renglón sí y otro con la cantidad cambiada).
- [ ] 7.6 La oficina emite la **REV** de la devolución desde la bandeja. Consulta: fiscales nuevos = 0.

## Fase 8 — Rendición del vendedor

- [ ] 8.1 **199 (paga al vendedor):** el vendedor cobra desde la app una parte en efectivo y otra con un cheque (pago parcial: queda saldo).
- [ ] 8.2 El vendedor retira su comisión desde la app.
- [ ] 8.3 El vendedor envía la rendición: propone efectivo − retiros.
- [ ] 8.4 La oficina confirma: la transferencia queda pendiente hasta controlar el banco.
- [ ] 8.5 Rechazar un pago a propósito: vuelve a la deuda del cliente, no al vendedor.

## Fase 8b — Pago en la oficina (/caja)

- [ ] 8b.1 **556 (paga en la oficina):** registrar en /caja una transferencia por una parte de la deuda: queda pendiente hasta controlar el banco.
- [ ] 8b.2 Confirmarla: baja el saldo de 556.
- [ ] 8b.3 Registrar un pago sin comprobante indicado: aparecen "Imputar a lo más viejo" y "Dejar a cuenta". Probar una de las dos.
- [ ] 8b.4 La ficha de 556 muestra lo mismo en el ERP, en la app vendedor y en la app chofer.

## Fase 9 — Billeteras, cuentas y comisiones

- [ ] 9.1 Billetera del chofer: plata en mano = 0 después de rendir; la cuenta personal tiene la diferencia.
- [ ] 9.2 Billetera del vendedor: plata en mano con los cheques como unidades; en la cuenta personal, comisiones a favor y el retiro en contra.
- [ ] 9.3 La comisión se gana **solo** sobre comprobantes saldados del todo; la devolución y el 10 % contado la bajan.
- [ ] 9.4 La misma comisión se ve igual en la app vendedor, en `/personal` y en el Playroom.
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
| 1 | Auditoría | Los pedidos viejos (impresos) figuraban como "cobrables a cuenta" en las fichas del ERP, del vendedor y del chofer | Servidor (estado Sistema viejo) | Arreglado, en main 23/10 |
| 2 | 1.9 | Las apps (vendedor, chofer, depósito) solo dejan iniciar sesión con el mail; tienen que aceptar también el nombre de usuario, como el ERP | Apps (agente de cada app) + servidor si hace falta | Anotado 23/10 |
| 3 | 1.9 | App chofer, billetera: con gastos en cero muestra "−$0,00" (signo menos sobre cero). Detalle visual | App chofer | Anotado 23/10 |
| 4 | 1.9 | App depósito: "Recibir mercadería" muestra 2 recepciones pendientes. No es parte de esta prueba (compras), pero conviene confirmar si son reales o de prueba | Juan decide | Anotado 23/10 |
| 5 | 2 | **Apertura: un cliente con error frena todo el archivo.** Con el reporte real hay unos 34 clientes con error, así que no se importa nada. Que importe los que están bien y muestre aparte los que hay que corregir | Servidor (/apertura) | Pendiente |
| 6 | 2 | **Apertura: renglones que no son comprobantes.** 72 renglones en 15 clientes comunes ($65,4 M) con texto libre ("CHEQUE RECH (YASH)", "ECHEQ", "10%", "COMISION JULIO", nombres de personas; casi todos en GRONDONA CHRISTIAN, cód. 1000). **Decisión de Juan (23/10): entran como AJUSTE**, lo mismo que hace hoy "Ajustar saldo" en la cuenta corriente del cliente, con el texto original como concepto | Servidor (/apertura) | Decidido, falta hacerlo |
| 7 | 2 | **Apertura: cuentas de empleados, socios y viajantes** (15 cuentas, 805 renglones, $12,7 M: retiros, sueldos, comisiones, diferencias de rendición). **Decisión de Juan (23/10): van a la cuenta personal de cada uno**, y lo que no es comprobante entra como ajuste (igual que el problema 6) | Servidor (/apertura) | Decidido, falta hacerlo |
| 8 | 2 | **Apertura: 17 clientes cuyo saldo "no cuadra".** El reporte trae dos columnas de saldo y el lector compara con la primera. **Juan confirmó (23/10) que la buena es la segunda**: por ejemplo DELLI GUSTAVO (169) debe $2.804.921,57, que es la suma de lo pendiente. Hay que cambiar el lector para que compare con la segunda columna | Servidor (lector del .chr) | Decidido, falta hacerlo |
| 9 | 2 | **Apertura: clientes que faltan o cambiaron de dueño** (detalle abajo). Con CUIT distinto, **la deuda iría al cliente equivocado** hasta que se actualicen en gmv2. Falta además el listado completo de clientes que están en el sistema viejo y no en gmv2 | Oficina (clientes) + Claude arma el listado | Pendiente |
| 10 | 3.7 | **Comisiones del vendedor: "sin cobrar" suma de más.** La app (`/api/vendedor/comisiones`) muestra $2.368.414,82 sin cobrar, pero lo de esta prueba es $104.058,65. El resto son $1.917.710,02 de 21 pedidos en "Sistema viejo" (esas comisiones se liquidan en el sistema viejo) y $346.646,15 de 10 pedidos **eliminados**: el kardex los sigue marcando como no eliminados. Lo mismo puede pasar en el Playroom | Servidor | Anotado 23/10 |
| 11 | 3.7 | **Comisiones del vendedor: pedidos sin número.** En la lista, 001940, 001941 y 001942 aparecen como "—": el kardex no guarda el número del pedido cuando el pedido viene de la app (pasa en 9.143 de 11.279 renglones del último mes). Conviene tomar el número del pedido y no del kardex | Servidor | Anotado 23/10 |
| 12 | 3 | Artículo "Cepillo Dent BATMAN/M.MARAVILLA" con proveedor "INEXISTENTE", y "PACKx2 ULTRA BLANCO x90g" sin rubro. Son datos de artículos para corregir | Oficina (artículos) | Anotado 23/10 |
| 13 | 3.2 | **No se puede marcar un pedido como contado al venderlo.** Ni la app vendedor ni el ERP tienen esa opción. Hoy el 10 % contado solo aparece al **cobrar** (app vendedor, chofer o /caja), y el pedido lo registra recién ahí. Juan espera poder marcarlo al tomar el pedido | App vendedor + ERP (Juan define cómo) | Anotado 23/10 |
| 14 | 4.4 | ERP, ficha del pedido después de preparar: el renglón muestra lo **pedido** (36 u.) y un color, pero no **cuánto se preparó** (30 de 36), y el total sigue diciendo $722.880,96 como si fuera completo. Conviene mostrar "preparado 30 de 36" y el total que se va a facturar | ERP (pantalla) | Anotado 23/10 |
| 15 | 4.5 | **GRAVE: al generar el comprobante se factura lo PEDIDO y no lo PREPARADO.** `generar` (app/api/comprobantes-venta/generar/route.ts:222-284) saltea los renglones FALTANTE, pero en un renglón PARCIAL usa la cantidad pedida: el 001941 saldría con 36 PACKx2 cuando se prepararon 30. El cliente pagaría 6 unidades que no recibe, y lo mismo pasaría con la comisión y el stock. Visto leyendo el código; todavía no se generó nada | Servidor | **Arreglar antes de la 5.3** |

### Detalle del problema 9

Juan (23/10): el 56 y el 1381 cambiaron de nombre estos días, y tienen otro CUIT.

| Código | En el sistema viejo | En gmv2 | Qué hay que hacer |
|---|---|---|---|
| 56 | SANJUMATO S.A., CUIT 30-71698039-8 | ERCILIA S.A.C.I., CUIT 30-51852124-8 | Actualizar en gmv2 |
| 1381 | DING DAFU, CUIT 20-96309098-7 | KE WUJIN, CUIT 27-95098430-4 | Actualizar en gmv2 |
| 765 | LA PAMPEANA DISTRIBUIDORA S.A., CUIT 30-71835473-7 | no existe | Darlo de alta |
| 766 | YOU JUNJUN, CUIT 20-95333922-7 | no existe | Darlo de alta |

El reporte de impagos solo trae a los clientes que deben. Para el listado completo hace falta exportar del sistema viejo **todos** los clientes (código, nombre y CUIT); con eso armo la comparación contra gmv2.

## Anexo — números de referencia

- Vendedor Juan Cruz: `8146a51a-b423-4a0f-b207-2b78341e1b91`. Usuario: `d6ac25bb-8204-474d-9e3c-12c2807ac2b7`. Cuenta personal: `e0208afd-d909-45b1-bedc-60d007e7b891`.
- Clientes de prueba:
  - 1190 `7366eab6-603d-41aa-a31a-806c07d41e07`;
  - 199 `6daf55b6-22df-491d-b2e3-522674ab89d7`;
  - 556 `0ba07007-10cc-426a-9692-a32df50d9e8c`.
- **Inicio de la prueba: 23/10/2026 14:45 (hora Argentina).** Fiscales antes de empezar: 12 (5 FA, 6 NCA, 1 NDA, todos con CAE).
- Consulta "fiscales nuevos" (desde el inicio de la prueba): `select tipo_comprobante, cae, created_at from comprobantes_venta where tipo_comprobante not in ('PRES','REV') and created_at >= '2026-10-23 14:45-03'`.
