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
- [x] 4.5 (verificado en la 5.3: PRES 0001-00000021 por $638.813,76, con 30 PACKx2 y sin BATMAN) Al generar los comprobantes, el 001941 tiene que salir **por lo preparado**: sin el BATMAN y con 30 PACKx2 en vez de 36. Es decir **$638.813,76** ($722.880,96 − $57.697,44 del BATMAN − 6 × $4.394,96), y su comisión baja en la misma proporción. El 001942 no debería generar comprobante, o tiene que avisar que no hay nada para facturar.

## Fase 5 — Gestión en el ERP

- [x] 5.1 Modificar un pedido ya preparado (001941, "Pendiente Facturación"): **el ERP no deja**. Todo queda bloqueado salvo la condición de entrega, que es la regla actual (después de preparar no se edita). Juan quiere poder cambiar lista y método y que se reprecie solo: problema 16.
- [x] 5.2 Condición de pago: Juan confirma (23/10) que **se puede cambiar antes de preparar** (ya lo hizo en otras pruebas). Cuando el depósito termina el último artículo, se bloquea igual que la lista y el método (problema 16).
- [x] 5.3 Comprobantes generados (23/10, 18:36 a 18:51). **Solo PRES; fiscales nuevos: 0.**

| Pedido | Comprobante | Importe | Qué tiene |
|---|---|---|---|
| 001939 URQUIZA | **PRES 0001-00000019** | $518.287,20 | Las 2 bolsas de ARNANUK (240 de 60x90 y 120 de 80x110) con su 10 %. Sale **aparte** por la condición especial del proveedor |
| 001939 URQUIZA | **PRES 0001-00000020** | $1.790.928,36 | Aceite, bolbilla, PACKx2 (360), shampoo |
| 001941 FITTERER | **PRES 0001-00000021** | $638.813,76 | **Por lo preparado**: 30 PACKx2 (no 36), sin el BATMAN faltante |
| 001940 CHEN | **PRES 0001-00000022** | $154.329,05 | Los 4 artículos completos |
| 001942 FITTERER | — | — | Todo faltante: el sistema dice "Comprobantes generados exitosamente:" con la lista **vacía**, no genera nada y el pedido queda en "Pendiente Facturación" (problema 17) |

  Cada renglón del comprobante tiene la misma cantidad y el mismo precio que el pedido, con el % de oferta y el 10 % de ARNANUK. 001941 también generó el **Remito X 0001-00000034**.
- [x] 5.4 Los PRES suman a la cuenta de cada cliente (un asiento "presupuesto" por comprobante):
  - **199 URQUIZA $2.309.215,56**: los 2 PRES;
  - **556 FITTERER $4.423.099,76**: $3.784.286,00 de la apertura más el PRES de $638.813,76;
  - **1190 CHEN $154.329,05**.
- [x] 5.4b Stock: bajó **solo lo que salió**. Por ejemplo, el PACKx2 bajó 360 + 30; el BATMAN y los HORNAL del 001942 no bajaron.
- [x] 5.4c Comisión: quedó vinculada a cada comprobante.
  - 001939: $73.135,90.
  - 001940: $7.222,82.
  - **001941: bajó de $17.922,67 a $15.838,36** (sin el BATMAN y con 30 PACKx2), lo que confirma que el arreglo del problema 15 también corrige la comisión.
  - 001942: sus renglones de comisión y de kardex se borraron al intentar generar, porque no tiene nada para facturar.
- [x] 5.5 Viaje **"PRUEBA"** del 25/10 (PUNTA ALTA + BAHIA, chofer Juan Cruz, sin vehículo). Lleva 3 paradas con 3 pedidos: 1 URQUIZA (#001939), 2 CHEN (#001940) y 3 FITTERER (#001941). El 001942 (todo faltante) no se subió. Los números de la hoja coinciden con la base:
  - este viaje: $3.102.358,37;
  - saldos anteriores: $3.784.286,00 (la apertura de FITTERER);
  - total a cobrar: $6.886.644,37;
  - "cobrar sí o sí": $3.938.615,05 (lo anterior de FITTERER más el pedido de CHEN).
  - Aparece además un viaje "BAHIA · 24/10" creado el 23/10 a las 18:36 y **cancelado**; no lleva nada.
- [x] 5.6 Instrucciones por parada (**cambio de Juan, 25/10**):
  - **URQUIZA**: sale sin condición.
  - **CHEN**: "Cobrar viaje", es decir que tiene que pagar este pedido.
  - **FITTERER**: **entrega bloqueada** si no cobra lo anterior, con la nota "DEBE MUCHO DE LO ANTERIOR" y "cobrar sí o sí $3.784.286,00".

  El bloqueo es de la parada, no del cliente: la ficha de FITTERER no queda retenida. Que el chofer vea el aviso se controla en la 6.1.
- [x] 5.7 Fondo de **$50.000 de caja chica** al chofer (25/10, 12:28):
  - caja chica: de $100.000 a **$50.000**;
  - billetera del chofer: **+$50.000** ("A cuenta viaje PRUEBA");
  - movimiento de caja: "TRANSFERENCIA_INTERNA" de la caja a la billetera.
- [x] 5.8 Viaje **despachado**: los 3 pedidos pasaron a "en viaje".

## Fase 6 — Entregas desde la app Chofer

- [x] 6.1 El viaje aparece en la app chofer con sus 3 paradas y con los carteles que corresponden: en FITTERER "🔒 NO ENTREGAR SIN COBRAR — DEBE MUCHO DE LO ANTERIOR" y "COBRAR SÍ O SÍ" (Juan, 25/10).
- [x] 6.2 **1190 CHEN ("Cobrar viaje")**, 25/10 a las 13:02. Devolución de las naftalinas (vencidas, no vendibles), cobro contado con el 10 % y entrega.
  - La app pidió **$91.890,70** y se pagó con un **cheque Credicoop de $100.000 a 31 días** (vence el 25/11). Sobran **$8.109,30**.
  - El cobro quedó "pendiente de rendición" con la marca [10% CONTADO], y el cheque "EN_VERIFICACION" (no entra a cartera hasta confirmar).
  - **Pero se cargaron DOS devoluciones de las mismas 6 naftalinas** (DEV-00001 y DEV-00002, $23.502,72 cada una): se devolvieron 12 de 6 vendidas (problema 25).
  - Los $91.890,70 salen de $154.329,05 × 0,9 − $47.005,44: el 10 % se aplicó **antes** de restar las devoluciones (problema 26).
  - La REV del 10 % sale al confirmar la rendición (7.x).
- [x] 6.3 **199 URQUIZA:** entregado sin cobrar (13:04), con dos devoluciones:
  - **DEV-00003:** las 240 bolsas consorcio 60x90 de este pedido, vendibles, $292.094,40, atada al PRES 0001-00000019 (el de ARNANUK). Correcto.
  - **DEV-00004:** 3 bolsas residuo 45x60 de **otro pedido**, vendibles, $1.502,94. Quedó atada al PRES 0001-00000020, que **no tiene ese artículo** (problema 28).
- [✗] 6.4 **556 FITTERER (bloqueado): FALLÓ.** La app **dejó marcarlo "entregado" sin cobrar** (25/10, 12:39, motivo de no cobro "No estaba el que paga"). Ver problema 23.
- [x] 6.4b Corregido a mano: la parada de FITTERER pasó a **"no entregado"** (motivo "No pagó"). La app pide además "por qué no cobró", un segundo texto que sobra (problema 24). Después, "pasate que junté algo": **cobro de $20.000 en efectivo** a cuenta de lo anterior, que quedó "pendiente de rendición". Sugerencia: que **no pague** y el pedido **vuelva sin viaje** (6.5), así después paga en /caja (Fase 8b) y se prueban los dos caminos.
- [ ] 6.5 El pedido no entregado vuelve sin viaje, y su comprobante y su deuda quedan como estaban.
- [x] 6.6 Gasto de **nafta $25.000** ("declarado"), descontado de la billetera.
- [ ] 6.7 Parte del recorrido sin señal: todo sincroniza al volver, sin duplicados.
- [x] 6.8 Viaje finalizado (13:07), "en rendición". La app propone **$45.000 en efectivo + 1 cheque**: $50.000 de fondo + $20.000 cobrados − $25.000 de nafta. La billetera de la base da lo mismo. Muestra "cobrado $120.000" y "total a cobrar $6.546.041,59", que es el total del viaje menos las devoluciones ($340.602,78).

## Fase 7 — Rendición del chofer en el ERP

- [x] 7.1 La rendición apareció en Caja → Pendientes de revisar.
- [x] 7.2 Se rindieron **$44.000** (declaró $45.000), con $1.000 de menos a propósito, más el cheque.
  - **Caja chica:** de $50.000 a **$94.000**.
  - **Cuenta personal de Juan (194):** "diferencia_rendicion" **debe $1.000**.
  - **Billetera del chofer:** queda con **$1.000** "en mano" (problema 29).
- [x] 7.3 Rendición confirmada; el viaje quedó **"completado"**.
  - **001939 y 001940** pasaron a "entregado". El **001941** (no entregado) volvió a **"listo para enviar" sin viaje**.
  - **Cheque** $100.000: de "en verificación" a **"EN_CARTERA"**, color **NEGRO** porque pagó un presupuesto.
  - **CHEN:** el cobro de $100.000 quedó imputado al PRES 0001-00000022. Salió la **REV 0001-00000018 por $15.432,91** (10 % contado, **sin CAE**) y se cruzó con el mismo PRES. El PRES quedó "parcial" con **$38.896,14** pendiente, que baja cuando salga la REV de la devolución.
  - El 10 % se calculó sobre los **$154.329,05 completos**, naftalinas devueltas incluidas: confirma el problema 26.
  - **FITTERER:** los $20.000 bajaron su deuda a **$4.403.099,76**. Quedaron **a cuenta**, sin imputar a ningún comprobante (se decide en la 8b).
- [x] 7.4 Las devoluciones **no** se confirmaron solas al rendir: quedaron esperando al depósito.
- [x] 7.5 Depósito revisó: **DEV-00002 rechazada** (la duplicada, queda en $0) y **aceptadas DEV-00001** ($23.502,72), **DEV-00003** ($292.094,40) y **DEV-00004** ($1.502,94).
  - Consecuencia del problema 25: CHEN pagó calculando las dos devoluciones, así que con una sola aceptada **queda debiendo $17.743,69** (ver 7.6).
- [x] 7.6 Reversas de las devoluciones emitidas desde el ERP (25/10, 13:18 a 13:19). **Todas REV, sin CAE; fiscales nuevos: 0.** Cada una quedó cruzada con su PRES.

| Devolución | Reversa | Importe | Contra |
|---|---|---|---|
| DEV-00004 (URQUIZA, 3 bolsas 45x60) | REV 0001-00000019 | $1.502,94 | PRES 0001-00000020 (no tiene ese artículo: problema 28) |
| DEV-00001 (CHEN, 6 naftalinas) | REV 0001-00000020 | **$21.152,45** | PRES 0001-00000022 |
| DEV-00003 (URQUIZA, 240 bolsas 60x90) | REV 0001-00000021 | $292.094,40 | PRES 0001-00000019 |

  - La de CHEN se valuó **al 90 %** ($23.502,72 × 0,9), porque ese presupuesto tuvo el 10 % contado: "tal cual se facturó".
  - **Saldos:**
    - **CHEN $17.743,69**: $154.329,05 − $15.432,91 del 10 % − $100.000 del cheque − $21.152,45. Es lo mismo que ($154.329,05 − $23.502,72) × 0,9 − $100.000, así que **en la cuenta el 10 % queda bien aplicado**;
    - **URQUIZA $2.015.618,22**: $2.309.215,56 − $292.094,40 − $1.502,94. Al PRES 0019 le quedan $226.192,80 (las bolsas 80x110);
    - **FITTERER $4.403.099,76**, sin cambios;
    - **Juan (cuenta personal) debe $1.000**.
  - **Stock:** volvieron 240 bolsas 60x90 y 3 bolsas 45x60, que eran vendibles. Las naftalinas no volvieron, porque estaban vencidas.
  - DEV-00001, 00003 y 00004 quedaron "facturado"; DEV-00002 "rechazado".

## Fase 8 — Rendición del vendedor

- [x] 8.1 **199 URQUIZA**, cobro desde la app vendedor (25/10, 13:24): **$1.000.000 en efectivo + transferencia Credicoop $784.600 = $1.784.600**, "pendiente de rendición". El resto se cerró con un **ajuste de $96,66**.
  - El cobro salió con la marca **[10% CONTADO]**: la app aplicó el 10 % sobre los comprobantes. $2.015.618,22 − 10 % de los totales **originales** ($230.921,56) = $1.784.696,66 = $1.784.600 + $96,66. Ver problema 33.
  - No hubo cheque en este cobro.
  - La app muestra el pedido 001939 en "Facturados" por $2.015.618 con los 2 PRES, pero **sin las reversas** de las devoluciones (problema 31).
- [x] 8.2 Retiro de **$10.000** desde la app. La cuenta personal de Juan pasó a **debe $11.000**: $1.000 de la diferencia del chofer + $10.000 del retiro, que es lo correcto (regla 13: el retiro baja la plata en mano y se debita de la cuenta). Pero la tarjeta de inicio "Plata de la empresa en tu mano" sigue diciendo **$1.000.000** en vez de $990.000 (problema 32).
- [x] 8.3 Rendición enviada a la oficina. La app propuso bien: "cobraste $1.000.000, retiraste $10.000, llevás **$990.000**". La transferencia no se cuenta como plata en mano, y está bien.
- [x] 8.3b (antes de confirmar) Comisión ganada: **todavía ninguna**, y es correcto. La comisión se gana cuando el comprobante queda **saldado del todo** (regla 27) y el PRES de CHEN todavía debe $17.743,69. Los de URQUIZA quedan saldados recién al confirmar este cobro.
- [x] 8.4 Rendición del vendedor confirmada (25/10, 13:33), "como si el efectivo hubiese entrado a caja grande".
  - **Caja grande:** de $10.000.000 a **$10.990.000**.
  - **Credicoop:** de $13.443.379,93 a **$14.227.979,93**. La transferencia de $784.600 **entró directo al banco** al confirmar (problema 35).
  - **URQUIZA saldado ($0):** el cobro quedó imputado ($174.354,64 al PRES 0019 y $1.610.245,36 al PRES 0020). Salió la **REV 0001-00000022 por $230.921,56** (10 % contado, sin CAE) y el ajuste de $96,66 por redondeo. Ambos PRES quedaron "pagado".
  - **El 10 % se calculó sobre los totales originales**: confirma el problema 33, con **$29.359,74 de descuento de más**.
  - **Comisión ganada**, acreditada en la cuenta personal de Juan:
    - PRES 0001-00000020: $42.457,46 ("cobrado $1.610.245,36 de $1.790.928,36");
    - PRES 0001-00000019: $8.717,73;
    - total **$51.175,19**.
  - **Cuenta personal de Juan (194): a favor $40.175,19** = $51.175,19 de comisión − $10.000 del retiro − $1.000 de la diferencia del chofer.
  - **Billetera del vendedor: −$10.000** (problema 36).
  - Fiscales nuevos: 0.
- [ ] 8.5 Rechazar un pago a propósito: vuelve a la deuda del cliente, no al vendedor. (No se hizo en la rendición del vendedor; se puede probar en /caja.)

## Fase 8b — Pago en la oficina (/caja)

- [x] 8b.1 **556 FITTERER en /caja** (25/10, 13:38). Juan registró un cobro **en efectivo de $3.980.790 a caja chica, con 10 % contado**, sobre los 3 PRES: los 2 de la apertura más el 0001-00000021.
  - Se confirmó en el acto, como manda la regla del efectivo en oficina.
  - **Caja chica:** de $94.000 a **$4.074.790**.
  - Salió la **REV 0001-00000023 por $442.309,98** (10 % de $4.423.099,76, sin CAE). Los 3 PRES quedaron "pagado".
- [x] 8b.2 **Saldo de FITTERER: −$20.000 (a favor).** Los $20.000 que había dado al chofer no se tuvieron en cuenta al calcular el cobro: pagó todo y además le quedan $20.000 a favor (problema 37). Al cobro le sobran $0,22 sin imputar.
- [~] 8b.3 Al imputar los $0,22 que sobraron, aparecen "Proponer lo más viejo" y "Dejar a cuenta". Pero el modal ofrece como anticipo el **pedido 001942 por $115.545,25**, que es el pedido con todo faltante que no se va a facturar nunca (problema 39). También muestra el 001941 como "$722.880,96 Saldado", que es el total del pedido y no lo facturado (problema 14).
- [ ] 8b.4 La ficha de 556 muestra lo mismo en el ERP, en la app vendedor y en la app chofer.

## Fase 9 — Billeteras, cuentas y comisiones

- [~] 9.1 Billetera del chofer.
  - **La app chofer muestra bien** (capturas del 25/10, 13:44): efectivo en mano **$0,00**, 0 cheques, "Tu cuenta: a favor $54.429,71 · Retiros $10.000,00", viaje PRUEBA "FINALIZADO" y la nafta "a revisar en oficina" (problema 43).
  - **En la base y en el tablero de Finanzas**, la billetera del chofer quedó en **$1.000** y no en $0. La diferencia está **también** en la cuenta personal (problema 29). Además, en el tablero de Finanzas figura como "Billetera d6ac25bb", sin nombre (problema 40).
- [~] 9.2 Billetera del vendedor.
  - **La app vendedor muestra bien**: "Plata de la empresa en tu mano $0,00", "Tu cuenta $54.429,71 a tu favor", "Comisiones ganadas $65.429,71", "Retiros $10.000,00" y "Para retirar $54.429,71".
  - **En la base y en el tablero de Finanzas** quedó en **−$10.000** (problema 36). En los movimientos de la app se ve la causa: cobro $1.000.000 + transferencia $784.600 − retiro $10.000 − rendición $1.784.600.
  - **Cuenta personal, bien:** comisiones $65.429,71 a favor, menos el retiro de $10.000 y la diferencia de $1.000 = **$54.429,71 a favor**. Se ve igual en `/personal` y en el "para retirar" de la app (API).
- [x] 9.3 La comisión se ganó **solo** en los comprobantes saldados:
  - URQUIZA, PRES 19 y 20: $51.175,19;
  - FITTERER, PRES 21: $14.254,52, que es su comisión de $15.838,36 × 90 % por el contado;
  - **CHEN no**, porque todavía debe $17.743,69, y está bien.

  La devolución y el 10 % la bajaron en proporción a lo cobrado.
- [✗] 9.4 **No se ve igual en todos lados:**
  - `/personal` y la cuenta personal: bien;
  - app vendedor, "Mercadería cobrada" (confirmado con captura): muestra **$65.822,31** para el 001939, con "6 SKUs" (incluye las bolsas devueltas),, cuando se acreditaron $51.175,19, porque no descuenta las devoluciones (problema 41). El 001941 está bien ($14.254,52);
  - **Playroom, comisiones cobradas de octubre: $0** (problema 42).
- [~] 9.6 Saldos en el **ERP** (fuente única `/api/clientes/saldos`, real = proyectado) y en la antigüedad, todos iguales a la base:
  - **CHEN $17.743,69**, que la antigüedad del tablero muestra como "corriente";
  - **URQUIZA $0**;
  - **FITTERER −$20.000 (a favor)**.

  Falta la captura de "Mis clientes" de la app vendedor. La app chofer ya no tiene viaje, así que no muestra clientes.
- [x] 9.9 App depósito (captura): 0 pedidos para preparar y 0 devoluciones pendientes. El 001942 (todo faltante) no aparece en la cola.
- [ ] 9.10 App vendedor: en el inicio quedó un **"Pedido a medio cargar · CHEN XIANG RONG (1 artículo)"**. Es un borrador de la prueba que no se envió: hay que borrarlo antes del pase.
- [x] 9.7 **Caja y bancos cuadran al peso** con los saldos de partida (1.7):

| Cuenta | Inicio | Movimientos de la prueba | Final |
|---|---|---|---|
| Caja chica | $100.000 | −$50.000 fondo, +$44.000 rendición del chofer, +$3.980.790 FITTERER | **$4.074.790** |
| Caja grande | $10.000.000 | +$990.000 rendición del vendedor | **$10.990.000** |
| Credicoop | $13.443.379,93 | +$784.600 transferencia de URQUIZA | **$14.227.979,93** |
| Nación, Provincia, MercadoPago | sin cambios | — | sin cambios |
| Cheques en cartera | ninguno | +1 cheque de CHEN, NEGRO, $100.000 | 1 cheque |

  Los $25.000 de nafta salieron del fondo del chofer, no de una caja: $50.000 de fondo − $25.000 de nafta + $20.000 cobrados − $1.000 faltantes = los $44.000 que entraron.
- [x] 9.8 **Cero comprobantes fiscales nuevos** desde el inicio de la prueba (23/10, 14:45). Todo lo que se emitió: 6 PRES (4 de pedidos y 2 de la apertura) y 6 REV (3 del 10 % contado y 3 de devoluciones), todos sin CAE.

## Fase 10 — Cierre

- [x] 10.1 Repasar los problemas y decidir quién arregla cada uno (25/10). El resumen está abajo, en "Resumen para repartir".
- [x] 10.2 Lo que dejó la prueba en la base. Lo borra la puesta a cero del día del pase, **salvo lo marcado como "no lo borra"**:
  - pedidos de prueba **001939, 001940, 001941 y 001942**, con sus renglones, kardex y comisiones "vendidas". **No lo borra la puesta a cero: hace falta un script** (10.4);
  - viaje **PRUEBA** (56311891…) y el viaje cancelado "BAHIA · 24/10": los borra la limpieza complementaria;
  - PRES 0001-00000019 a 0001-00000022 y los 2 de la apertura de 556; REV 0001-00000018 a 0001-00000023;
  - devoluciones DEV-00001 a DEV-00004;
  - cobros, el cheque Credicoop n.º 1, los movimientos de billetera y de caja, las comisiones ganadas y los asientos de la cuenta personal de Juan;
  - stock: los movimientos de salida y entrada de la prueba. El stock no es real, así que no se devuelve;
  - lista de 556: quedó en **Bahía** (3.5). Decidir si vuelve a Neco;
  - app vendedor: borrador "Pedido a medio cargar · CHEN XIANG RONG".
  - las **2 recepciones de mercadería de prueba** de la app depósito (problema 4). **No lo borra la puesta a cero**: entran en el script de la 10.4.
- [ ] 10.3 El día del pase a producción, en este orden:
  1. avisar a los agentes y a la oficina;
  2. `SELECT cc_puesta_a_cero('PONER A CERO');` (antes, el simulacro);
  3. `SELECT prueba_limpieza('LIMPIAR');` (antes, el simulacro);
  4. borrar los 4 pedidos de prueba (script de la 10.4);
  5. `SELECT pedidos_pasar_a_sistema_viejo(now(), '{}', 'PASAR');`, sin excluir a nadie;
  6. apertura con el reporte de impagos **de ese día** (antes hay que resolver los problemas 5 a 9);
  7. cargar los saldos de bancos y cajas;
  8. "Poner al día" en `/personal`;
  9. borrar los datos de las apps en los equipos o volver a iniciar sesión.
- [ ] 10.4 Script para borrar los pedidos de prueba por número y las 2 recepciones de prueba (con simulacro y copia en archivo_pruebas): lo armo cuando Juan lo pida, antes del pase.

## Resumen para repartir (25/10)

**Traspasos para los agentes (26/10):** [`docs/PENDIENTES-APPS-SALIDA.md`](PENDIENTES-APPS-SALIDA.md) (apps chofer, vendedor y depósito) y [`docs/PENDIENTES-ERP-SALIDA.md`](PENDIENTES-ERP-SALIDA.md) (cuentas corrientes, frontend, listas de precios y descuentos, hojas de ruta/viajes y cobranzas). Cada agente tacha su parte ahí y acá.

**43 problemas anotados: 4 cerrados (1, 4, 15 y 38) y 39 abiertos. Todas las decisiones pendientes de Juan se tomaron el 26/10.**

### Antes de pasar a producción (tocan plata o frenan el pase)

| # | Qué | Quién |
|---|---|---|
| 23 | La entrega bloqueada no se bloquea: el chofer puede entregar sin cobrar | App chofer + servidor |
| 25 | Se puede devolver dos veces lo mismo (más de lo vendido) | App chofer + servidor |
| 33 | El 10 % contado se calcula sobre mercadería ya devuelta (URQUIZA: $29.359,74 de más) | Agente cuentas corrientes + app vendedor |
| 26 | La app chofer cobra de menos cuando hay devoluciones y 10 % contado | App chofer |
| 29 / 36 | Las billeteras quedan con plata "fantasma" después de rendir (chofer $1.000, vendedor −$10.000) | Agente cuentas corrientes |
| 37 | /caja no descuenta lo que el cliente ya tiene a cuenta: el cliente paga de más | ERP (/caja) |
| 17 / 39 | Pedido con todo faltante: queda trabado y aparece como cobrable | ERP + servidor |
| 5 a 8 | La apertura no puede importar el reporte real (un error frena todo, texto libre como ajuste, cuentas del personal, segunda columna de saldo) | Servidor (/apertura) |
| 9 | Clientes 56 y 1381 con otro dueño y otro CUIT; 765 y 766 no existen; falta el listado completo | Oficina + listado de Claude |
| 10 / 41 / 42 | Las comisiones se muestran mal: "sin cobrar" inflado, "mercadería cobrada" sin devoluciones, Playroom en $0 | Servidor + app vendedor |

### Importantes para el día a día

| # | Qué | Quién |
|---|---|---|
| 16 / 19 / 20 | Cambiar condiciones después de preparar, y botón "Anular comprobantes" para refacturar | ERP + servidor |
| 13 | Marcar un pedido como contado al venderlo | App vendedor + ERP | **Decisión de Juan (26/10):** al **finalizar el pedido** en la app aparece un cartel con un **checkbox de 10 % contado**. Si el cliente ya tiene el contado por defecto, aparece tildado; si no, se puede tildar ahí. Afecta el **total del pedido en vivo**: mientras se levanta el pedido en la calle, el total ya se ve con el 10 % incluido si corresponde | Decidido 26/10, falta hacerlo |
| 2 | Iniciar sesión en las apps con el nombre de usuario | Las 3 apps |
| 43 | El gasto del chofer queda "a revisar" para siempre | ERP + servidor | **Decisión de Juan (26/10):** los gastos se aprueban **en la rendición**: al aceptarla, la oficina carga el gasto (nafta, camión, peón, hotel u otro) asociado al **vehículo** o al concepto que corresponda | Decidido 26/10; hecho 26/10 (839f9db) |
| 27 | La parada dice "cobró de menos" cuando sobró plata | App chofer / servidor |
| 31 / 32 | App vendedor: el pedido no muestra las reversas; la plata en mano no descuenta el retiro | App vendedor |
| 14 | No se ve "preparado 30 de 36" ni el total que se va a facturar | ERP |
| 22 | Nadie carga los bultos | Juan define + app depósito | **Decisión de Juan (26/10):** por ahora los bultos se cargan **en el ERP**, en cualquier momento antes de finalizar el viaje; al despachar ya deberían estar. Pueden ser **bultos o pallets**. **No bloquea**: un pedido sin bultos se despacha igual, sin alerta | Decidido 26/10; hecho 26/10 (e0b8b3f) |

### Detalles visuales y datos

| # | Qué | Quién |
|---|---|---|
| 3 | "−$0,00" en la billetera del chofer | App chofer |
| 11 | Pedidos sin número en la lista de comisiones | Servidor |
| 21 | "PRES 0001-0001-…" en la hoja de ruta | ERP |
| 24 | "No entregado" pide dos textos | App chofer |
| 30 | Números sin formato en los textos de la rendición | Servidor |
| 40 | El chofer figura como "d6ac25bb" en el tablero | ERP |
| 12 | Artículo con proveedor "INEXISTENTE" y otro sin rubro | Oficina |

### Decisiones de Juan (26/10)

| # | Decisión |
|---|---|
| 4 | Las 2 recepciones de la app depósito son de prueba: se borran antes del pase |
| 13 | Checkbox "10 % contado" al finalizar el pedido; viene tildado si el cliente lo tiene por defecto, y el total en vivo ya lo incluye |
| 18 | Los PRES del sistema viejo entran como PV 2 ("0002-…"); gmv2 sigue en PV 1 |
| 22 | Los bultos (o pallets) se cargan en el ERP antes de finalizar el viaje; no bloquean el despacho |
| 28 | La devolución va contra un comprobante anterior con ese artículo (negro → REV, blanco → NC, salvo cliente todo negro o todo blanco); si no hay ninguno, contra el 0002-00000001 |
| 34 | El color del cheque queda con la regla actual, pero se puede cambiar en /caja y en la cartera |
| 35 | Las transferencias se confirman en /caja apenas se controla el banco; las rendiciones solo llevan efectivo y cheques |
| 43 | Los gastos del viaje se aprueban al aceptar la rendición, asociados al vehículo o al concepto |

### Por responsable (para pasarle a cada agente)

- **Agente app chofer:** 3, 23, 24, 25, 26, 27 y 2.
- **Agente app vendedor:** 2, 13, 31, 32, 33 (cálculo del 10 %) y 41.
- **Agente app depósito:** 2 y 22.
- **Agente cuentas corrientes:** 28, 29, 33, 35 y 36.
- **Servidor / ERP, nuevo por las decisiones del 26/10:** 18 (PV 2 en la apertura), 22 (bultos en el ERP), 34 (cambiar el color en /caja y en la cartera), 35 (transferencias a /caja, fuera de la rendición) y 43 (gastos al aceptar la rendición).
- **Servidor / ERP:** 5 a 8, 10, 11, 14, 16, 17, 19, 20, 21, 30, 37, 39, 40, 42 y 43, más la parte de servidor de 23 y 25.
- **Oficina:** 9 y 12, el borrador de la app vendedor y la lista de 556.

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
| 5 | 2 | **Apertura: un cliente con error frena todo el archivo.** Con el reporte real hay unos 34 clientes con error, así que no se importa nada. Que importe los que están bien y muestre aparte los que hay que corregir | Servidor (/apertura) | Hecho 26/10 (cuentas corrientes) |
| 6 | 2 | **Apertura: renglones que no son comprobantes.** 72 renglones en 15 clientes comunes ($65,4 M) con texto libre ("CHEQUE RECH (YASH)", "ECHEQ", "10%", "COMISION JULIO", nombres de personas; casi todos en GRONDONA CHRISTIAN, cód. 1000). **Decisión de Juan (23/10): entran como AJUSTE**, lo mismo que hace hoy "Ajustar saldo" en la cuenta corriente del cliente, con el texto original como concepto | Servidor (/apertura) | Hecho 26/10 (cuentas corrientes) |
| 7 | 2 | **Apertura: cuentas de empleados, socios y viajantes** (15 cuentas, 805 renglones, $12,7 M: retiros, sueldos, comisiones, diferencias de rendición). **Decisión de Juan (23/10): van a la cuenta personal de cada uno**, y lo que no es comprobante entra como ajuste (igual que el problema 6) | Servidor (/apertura) | Hecho 26/10 (cuentas corrientes) |
| 8 | 2 | **Apertura: 17 clientes cuyo saldo "no cuadra".** El reporte trae dos columnas de saldo y el lector compara con la primera. **Juan confirmó (23/10) que la buena es la segunda**: por ejemplo DELLI GUSTAVO (169) debe $2.804.921,57, que es la suma de lo pendiente. Hay que cambiar el lector para que compare con la segunda columna | Servidor (lector del .chr) | Hecho 26/10 (cuentas corrientes) |
| 9 | 2 | **Apertura: clientes que faltan o cambiaron de dueño** (detalle abajo). Con CUIT distinto, **la deuda iría al cliente equivocado** hasta que se actualicen en gmv2. Falta además el listado completo de clientes que están en el sistema viejo y no en gmv2 | Oficina (clientes) + Claude arma el listado | Pendiente |
| 10 | 3.7 | **Comisiones del vendedor: "sin cobrar" suma de más.** La app (`/api/vendedor/comisiones`) muestra $2.368.414,82 sin cobrar, pero lo de esta prueba es $104.058,65. El resto son $1.917.710,02 de 21 pedidos en "Sistema viejo" (esas comisiones se liquidan en el sistema viejo) y $346.646,15 de 10 pedidos **eliminados**: el kardex los sigue marcando como no eliminados. Lo mismo puede pasar en el Playroom | Servidor | Hecho 26/10 (cuentas corrientes; falta aplicar 20261026c_comisiones_salida.sql) |
| 11 | 3.7 | **Comisiones del vendedor: pedidos sin número.** En la lista, 001940, 001941 y 001942 aparecen como "—": el kardex no guarda el número del pedido cuando el pedido viene de la app (pasa en 9.143 de 11.279 renglones del último mes). Conviene tomar el número del pedido y no del kardex | Servidor | Hecho 26/10 (cuentas corrientes; falta aplicar 20261026c_comisiones_salida.sql) |
| 12 | 3 | Artículo "Cepillo Dent BATMAN/M.MARAVILLA" con proveedor "INEXISTENTE", y "PACKx2 ULTRA BLANCO x90g" sin rubro. Son datos de artículos para corregir | Oficina (artículos) | Anotado 23/10 |
| 13 | 3.2 | **No se puede marcar un pedido como contado al venderlo.** Ni la app vendedor ni el ERP tienen esa opción. Hoy el 10 % contado solo aparece al **cobrar** (app vendedor, chofer o /caja), y el pedido lo registra recién ahí. Juan espera poder marcarlo al tomar el pedido | App vendedor + ERP (Juan define cómo) | Servidor y ERP: hecho 26/10 (8f907c8, `bonif_pedido.contado_todo`); falta la app (V1) |
| 14 | 4.4 / 5 | (Juan lo vio también en el modal de edición y en el de un pedido ya facturado, que dice "TOTAL $722.881" cuando el PRES es de $638.813,76) ERP, ficha del pedido después de preparar: el renglón muestra lo **pedido** (36 u.) y un color, pero no **cuánto se preparó** (30 de 36), y el total sigue diciendo $722.880,96 como si fuera completo. Conviene mostrar "preparado 30 de 36" y el total que se va a facturar | ERP (pantalla) | Anotado 23/10 |
| 15 | 4.5 | **GRAVE: al generar el comprobante se factura lo PEDIDO y no lo PREPARADO.** `generar` (app/api/comprobantes-venta/generar/route.ts:222-284) saltea los renglones FALTANTE, pero en un renglón PARCIAL usa la cantidad pedida: el 001941 saldría con 36 PACKx2 cuando se prepararon 30. El cliente pagaría 6 unidades que no recibe, y lo mismo pasaría con la comisión y el stock. Visto leyendo el código, antes de generar nada | Servidor | **Arreglado 23/10** (`lib/pedidos/cantidad-a-facturar.ts`): el comprobante y el kardex (y con él la comisión) usan lo preparado en los renglones PARCIAL. **Verificado en la 5.3** (PRES 0021 por $638.813,76 y comisión $15.838,36) |
| 16 | 5.1 / 5.2 | **Después de preparar se bloquea todo, no solo los artículos.** Cuando el depósito termina el último artículo, el pedido pasa a "Pendiente Facturación" y solo se edita la condición de entrega. **Regla de Juan (23/10):** los artículos y las cantidades sí quedan bloqueados (son los del depósito), pero la **modalidad y las condiciones** (lista, método de facturación, condición de pago, descuentos por segmento, contado 10 %) se tienen que poder cambiar **hasta que el pedido esté facturado**, y al guardar se **reprecia solo** | ERP + servidor (Juan define) | Hecho 26/10 (8f907c8) |
| 17 | 5.3 | **Pedido con todo faltante.** "Generar" muestra "Comprobantes generados exitosamente:" con la lista vacía, no genera nada y el pedido queda en "Pendiente Facturación" para siempre. Juan quiere poder **volverlo a "pendiente"** (para prepararlo cuando haya mercadería) o **pasarlo a eliminado**. Además el mensaje tendría que decir "no hay nada para facturar: todo faltante" | ERP + servidor | Anotado 23/10 |
| 18 | 5.3 | Observación: los PRES nuevos se numeran **0001-00000019…** y los de la apertura conservan el número del sistema viejo, **0001-00117929…**, en el mismo punto de venta. Hoy no chocan, pero en la cuenta del cliente conviven dos numeraciones. Hay que decidir si gmv2 sigue la numeración del sistema viejo, usa otro punto de venta o se deja así | Juan decidió: PV 2 | Hecho 26/10 (cuentas corrientes) |
| 19 | 5 | **Rehacer los comprobantes cuando el cliente cambia cómo quiere que se le facture.** Pasa en la calle: "le pedí al vendedor todo factura", o mitad y mitad, o todo presupuesto. **Flujo que pide Juan (23/10):** (1) se emiten los comprobantes; (2) el cliente dice que lo quería distinto; (3) se **anulan** los comprobantes (PRES → REV; FA → NC, fiscal en producción); (4) el pedido vuelve a quedar con las **condiciones editables** (lista, método, condición de pago, descuentos), pero no los artículos; (5) se **reprecia**; (6) se **vuelven a emitir** según las reglas nuevas. **Hoy**, anular un comprobante emite la reversa, devuelve el stock y anula el remito, pero **el pedido queda en "Facturado"**: no se puede editar ni volver a generar. Si el pedido salió en varios comprobantes (como URQUIZA, con ARNANUK aparte), hay que anularlos todos antes de rehacerlos. Va junto con el problema 16. **Juan (25/10): la anulación no tiene que ser de a un comprobante: un solo botón "Anular pedido facturado" cancela todos sus comprobantes juntos.** Lo que ya hace bien la anulación de hoy, comprobante por comprobante: **cuenta corriente** (asienta la reversa en el haber del cliente y la cruza con el original, así el saldo vuelve a como estaba antes de emitir); **comisión** (vuelve a liquidar y, como el comprobante deja de estar saldado, revierte la comisión ganada si ya se había acreditado); **stock** (lo devuelve); **remito** (lo anula). Ojo con un detalle: si el cliente ya había pagado parte, la plata queda **a favor** del cliente y hay que imputarla al comprobante nuevo | ERP + servidor | Anotado 23/10, ampliado 25/10 |
| 20 | 5 | **Dónde va el botón del problema 19:** en el modal del pedido. Cuando el pedido ya tiene comprobantes emitidos, aparece **"Anular comprobantes"** (hoy están "Ver comprobantes", "Vista previa", "Imprimir", "Registrar pago" y "Editar pedido"). Flujo de Juan (25/10): (1) emitir comprobantes; (2) el cliente quiere refacturar, o se cambió la lista en el medio; (3) **anular comprobantes**, con un solo botón y todos juntos; (4) modificar las condiciones; (5) repreciar el pedido; (6) volver a emitir **sin tocar cantidades**, con todo lo que implica: la cuenta corriente se ajusta a lo nuevo, la comisión también, y las apps del chofer y del vendedor ven el comprobante nuevo | ERP + servidor | Anotado 25/10 |
| 21 | 5.5 | Hoja del viaje: el comprobante figura **"PRES 0001-0001-00000021"**, con el punto de venta repetido. Tendría que decir "PRES 0001-00000021" | ERP (pantalla) | Hecho 26/10 (daab2b3) |
| 22 | 5.5 | Bultos en **0** en los 3 pedidos y en la hoja de ruta: nadie los carga, ni el depósito al terminar de preparar ni la oficina. ¿Quién los carga y cuándo? | Juan decide + app depósito | Hecho 26/10 (e0b8b3f) |
| 23 | 6.4 | **GRAVE: la entrega bloqueada no se bloquea.** Con "NO ENTREGAR SIN COBRAR" en la parada, la app chofer dejó marcar FITTERER como **entregado** sin ningún cobro. El cartel es solo visual (mobile/apps/chofer/src/pantallas/Viaje.tsx:193) y el servidor tampoco lo frena (PATCH /api/chofer/viaje/[id]/parada no mira bloquear_entrega). **Regla de Juan (25/10):** mientras no se cobre lo exigido, la app **no permite** "entregado" ni "entregado parcial" y muestra **"Si no salda lo solicitado, retirar el pedido"**; solo deja "no entregado". El servidor tiene que rechazarlo también, por si llega desde una app vieja | App chofer + servidor | Hecho 26/10 (daab2b3) |
| 24 | 6.4 | App chofer: al marcar "no entregado" pide **dos textos**, por qué no se entregó y por qué no se cobró. Si no se entregó porque no pagó, el segundo sobra | App chofer | Anotado 25/10 |
| 25 | 6.2 | **Se puede devolver dos veces lo mismo.** CHEN compró 6 naftalinas y la app aceptó dos devoluciones de 6 (DEV-00001 y DEV-00002), y el servidor también. La devolución no puede superar lo vendido menos lo ya devuelto. Además, la pantalla de la devolución muestra solo "devolución" y el monto: tiene que mostrar qué artículos y cuántos | App chofer + servidor | Hecho 26/10 (cuentas corrientes, servidor; app C2 aparte) |
| 26 | 6.2 / 7.6 | **La app chofer resta las devoluciones a precio lleno en un cobro con 10 % contado.** En la cuenta corriente sale bien: la REV del 10 % va sobre el total y la REV de la devolución al 90 %, y el saldo de CHEN es el correcto (7.6). Pero al cobrar, la app pidió $154.329,05 × 0,9 − $47.005,44 = **$91.890,70**, cuando lo correcto con esas dos devoluciones era ($154.329,05 − $47.005,44) × 0,9 = **$96.591,25**: pidió $4.700,54 de menos. Es el hallazgo 14 de la auditoría de cuentas corrientes ("el chofer ve las devoluciones a valor bruto"), que sigue abierto | App chofer | Anotado 25/10 |
| 27 | 6.2 | La parada de CHEN quedó con "Cobró $100.000,00 de $154.329,05 exigidos". Lo exigido no descuenta devoluciones ni 10 %, así que parece un cobro incompleto cuando en realidad sobró plata | App chofer / servidor | Hecho 26/10 (daab2b3) |
| 28 | 6.3 | **Devolución de un artículo de otro pedido.** Las 3 bolsas residuo 45x60 quedaron atadas al PRES 0001-00000020, que no tiene ese artículo, a $500,98. Hay que definir qué pasa cuando lo devuelto no está en ningún comprobante de gmv2 (por ejemplo, porque se vendió en el sistema viejo): a qué comprobante se ata y a qué precio | Juan decide + agente cuentas corrientes | Hecho 26/10 (cuentas corrientes; negro → PRES 0002-00000001) |
| 29 | 7.2 | **Revisar: la diferencia de rendición puede contarse dos veces.** Los $1.000 que faltaron quedaron como **deuda en la cuenta personal** de Juan y, a la vez, como **$1.000 "en mano" en la billetera del chofer** ("queda en billetera del cobrador"). Si en la próxima rendición la app le pide entregar esos $1.000, los paga dos veces. Hay que definir si la diferencia va a la cuenta personal **o** queda en la billetera, no a los dos | Agente cuentas corrientes | Hecho 26/10 (cuentas corrientes; migración aplicada y verificada) |
| 30 | 7.2 | Textos del movimiento de diferencia con números sin formato: "faltan $1000.0000000000000000", "declaró $45000.00". Tienen que decir $1.000,00 y $45.000,00 (docs/FORMATOS.md) | Servidor | Hecho 26/10 (cuentas corrientes; migración aplicada y verificada) |
| 31 | 8.1 | App vendedor, pedido facturado: muestra los PRES pero **no las reversas** (devoluciones, 10 %) que bajaron el saldo. El vendedor ve $2.015.618 sin entender por qué no es $2.309.215,56 | App vendedor | Anotado 25/10 |
| 32 | 8.2 | App vendedor, inicio: "Plata de la empresa en tu mano" **no descuenta el retiro** mientras la rendición no se envía (dice $1.000.000; tendría que decir $990.000). La pantalla de Rendiciones sí lo descuenta bien, y después de rendir muestra $0,00 | App vendedor | Anotado 25/10 |
| 33 | 8.1 | **Revisar al confirmar: el 10 % contado de URQUIZA se calculó sobre los totales originales**, mercadería devuelta incluida. La app cobró $2.015.618,22 − $230.921,56. Si las devoluciones ya se revirtieron a precio lleno, el 10 % tendría que ir sobre lo que queda ($201.561,82): el cliente se lleva **$29.359,74 de más**. En CHEN no pasó porque la devolución se revirtió al 90 %. **Confirmado en la 8.4: REV 0001-00000022 por $230.921,56.** **Juan confirmó (25/10) que el cobro contado con 10 % fue a propósito**: lo que hay que revisar es la base del cálculo | Agente cuentas corrientes / app vendedor | Hecho 26/10 (cuentas corrientes) |
| 34 | 7.3 | **Color de un cheque que paga blanco y negro a la vez.** Hoy (lib/actions/color-cheque.ts): si más del 50 % de lo que paga el cheque va a presupuestos, el cheque es **NEGRO**; si no, incluido el 50/50 exacto, es **BLANCO**. La oficina puede elegirlo a mano al confirmar. Un cheque de $100.000 que paga $50.000 de factura y $50.000 de presupuesto queda entero **BLANCO**. ¿Es la regla que quiere Juan? | Juan decide | Anotado 25/10 |
| 35 | 8.4 | **La transferencia del vendedor entró directo al banco al confirmar la rendición.** La regla 21 dice que las transferencias quedan pendientes hasta que se controla el banco. Hay que definir si confirmar la rendición alcanza como control, o si tiene que ir a "Transf. por confirmar" de la caja | Juan decide + agente cuentas corrientes | Hecho 26/10 (cuentas corrientes, servidor; apps C6/V5 aparte) |
| 36 | 8.4 | **La billetera del vendedor quedó en −$10.000 después de rendir.** Movimientos: cobros $1.784.600 − retiro $10.000 − rendición $1.784.600 = −$10.000. La rendición descontó el cobro completo en vez de $1.774.600 (lo cobrado menos el retiro, que ya estaba en la cuenta personal). Si la app muestra "plata en mano −$10.000", la próxima rendición le pediría $10.000 de menos. Es pariente del problema 29 | Agente cuentas corrientes | Hecho 26/10 (cuentas corrientes; migración aplicada y verificada) |
| 37 | 8b | **/caja: el "Total a pagar" no descuenta la plata que el cliente ya tiene a cuenta.** El resumen chico dice "a favor / a cuenta −$20.000 · Saldo de la cuenta $4.403.099,76", pero el total grande y el cálculo del 10 % usan $4.423.099,76. El cliente terminó pagando de más y quedó con $20.000 a favor. La pantalla tiene que ofrecer **usar lo que está a cuenta** (lo aplica la oficina, regla 39) y mostrar el total neto | ERP (/caja) | Hecho 26/10 (cuentas corrientes) |
| 38 | 8b | **¿El 10 % contado corresponde sobre la deuda vieja?** El 10 % de FITTERER ($442.309,98) incluyó los 2 PRES de junio que vinieron del sistema viejo ($3.784.286,00 → $378.428,60 de descuento). **Juan (25/10): sí, el 10 % contado también aplica a la deuda vieja.** Está bien como funciona | — | **Cerrado: no es error** |
| 39 | 8b | **Imputar ofrece como anticipo un pedido que no se va a facturar.** El modal de imputación propuso el pedido 001942 (todo faltante, "Sin facturar (anticipo)") por $115.545,25. Un pedido con todos sus renglones faltantes no tendría que aparecer como cobrable. Es la misma raíz que el problema 17 | ERP + servidor | Anotado 25/10 |
| 40 | 9.1 | La billetera y las rendiciones del chofer figuran como **"d6ac25bb"** (un pedazo del código del usuario) en el tablero de Finanzas, en vez de "Juan Cruz" | ERP (tablero) | Anotado 25/10 |
| 41 | 9.4 | **App vendedor, "Mercadería cobrada": la comisión del pedido no descuenta las devoluciones.** El 001939 muestra $65.822,31 (comisión pactada × 90 %), pero se acreditaron $51.175,19 porque se devolvieron 240 bolsas. Es el pendiente V3 de la app vendedor ("Mercadería cobrada" y "Comisiones ganadas" tienen que coincidir) | App vendedor + servidor (/api/vendedor/comisiones) | **Hecho 26/10 por el agente vendedor (ea55e14)**: la lista sale de la cuenta personal; 001939 = $51.175,19 |
| 42 | 9.4 | **Playroom, comisiones: $0 en octubre.** El tablero lee las comisiones "cobradas" de la tabla vieja, que desde la etapa 3 de cuentas corrientes ya no se escribe. Tiene que leer la comisión acreditada en la cuenta personal | Servidor (Playroom) | Hecho 26/10 (cuentas corrientes) |
| 43 | 9.1 | **El gasto de nafta ($25.000) quedó "a revisar en oficina" después de rendir.** La rendición se confirmó, pero el gasto sigue "declarado": nadie lo aprobó ni lo rechazó. Hay que definir dónde lo revisa la oficina, si tiene que hacerlo antes de confirmar la rendición, o si confirmar la rendición ya lo aprueba | ERP + servidor (Juan define) | Hecho 26/10 (839f9db) |

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
