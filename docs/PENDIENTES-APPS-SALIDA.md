# Pendientes de las apps para salir a producción — 26/10/2026

**Para:** agentes de la App Chofer, la App Vendedor y la App Depósito.
**De:** sesión "prueba integral de salida de mercadería", con Juan.
**Estado:** abierto. Cada agente tacha lo suyo (`~~…~~` + fecha + versión/commit) en este mismo archivo.

---

## 1. De dónde salen estos pedidos

Entre el 23 y el 25/10 Juan hizo, con esta sesión, el **recorrido completo de salida de mercadería en producción**, como si fuera un día real, con datos de prueba. El objetivo era encontrar todo lo que falla antes de pasar a producción.

El recorrido fue este:
- se puso la base en cero;
- se importó la deuda del sistema viejo;
- se tomaron pedidos desde la app vendedor;
- se prepararon en la app depósito;
- se generaron presupuestos en el ERP;
- se armó un viaje con bloqueo de entrega y fondo para el chofer;
- se hicieron entregas, cobros, devoluciones y gastos desde la app chofer;
- se rindió el viaje y la rendición del vendedor;
- se controlaron billeteras, comisiones, caja y bancos.

- El paso a paso completo, con los números verificados en la base, está en **[`docs/PRUEBA-INTEGRAL-SALIDA.md`](PRUEBA-INTEGRAL-SALIDA.md)**. Ahí cada problema tiene un **número (#)**, el mismo que usa este documento. Si algo de acá no se entiende, buscá ese número en la tabla "Problemas encontrados" del roadmap.
- Lo que es del **servidor y del ERP** está en [`docs/PENDIENTES-ERP-SALIDA.md`](PENDIENTES-ERP-SALIDA.md). Cuando una tarea de app depende del servidor, está marcado con su dueño. **No cambies el servidor de otra área**: pedíselo a Juan.
- Las reglas de trabajo de siempre siguen valiendo ([`docs/PENDIENTES-APPS.md`](PENDIENTES-APPS.md), "Antes de empezar" y "Quién hace qué"):
  - rama propia desde `origin/main`;
  - `npm run typecheck:movil` y `cd mobile && npm test` en verde;
  - nada a `main` sin el OK de Juan;
  - anotar en la tabla antes de empezar.

### Datos de la prueba (para entender los ejemplos; NO los uses para probar)

| Qué | Dato |
|---|---|
| Clientes de prueba | **1190** CHEN XIANG RONG (Punta Alta) · **199** DISTRIBUIDORA URQUIZA (Punta Alta) · **556** FITTERER SANTAGADA (Bahía Blanca). Son clientes **reales**: no cambies sus fichas |
| Pedidos de prueba | **001939** (URQUIZA) · **001940** (CHEN) · **001941** y **001942** (FITTERER) |
| Viaje | **PRUEBA** del 25/10 (completado), chofer Juan Cruz |
| Devoluciones | DEV-00001 y **DEV-00002 (duplicada, rechazada)** de CHEN · DEV-00003 y DEV-00004 de URQUIZA |
| Comprobantes | Solo PRES y REV, **ninguno fiscal**. Seguí así: nada que pida CAE |
| Equipo | NuStar (APKs instaladas: vendedor v0.4.3, chofer v0.3.2, depósito v0.3.0; vendedor v0.4.4 compilada, sin instalar) |

Estos datos se borran el día del pase (puesta a cero). **Para probar, usá el mock o datos TEST-…**, como siempre (MOBILE.md §14), y nunca los pedidos de arriba.

### Decisiones de Juan que tocan a las apps (26/10)

Son reglas de negocio nuevas. Si algo de tu app hoy hace otra cosa, **manda la regla**.

1. **Bloqueo de entrega (#23):** con "NO ENTREGAR SIN COBRAR", si no se cobró lo exigido, no se puede marcar entregado. El chofer ve **"Si no salda lo solicitado, retirar el pedido"** y solo puede marcar "no entregado".
2. **10 % contado al vender (#13):** al **finalizar el pedido** aparece un checkbox "10 % por pago contado". Viene **tildado** si el cliente lo tiene por defecto; si no, se puede tildar ahí. **El total del pedido en vivo ya lo incluye.**
3. **Transferencias (#35):** **no pasan por las rendiciones**. El vendedor o el chofer la anota en la app; la oficina la confirma en /caja cuando ve que entró al banco. La rendición lleva **solo efectivo y cheques**. La app igual guarda y muestra a quién se le cobró y cuánto.
4. **Bultos (#22):** por ahora se cargan **en el ERP**. El depósito no tiene que hacer nada. Un pedido sin bultos se despacha igual, sin alerta.
5. **Gastos del chofer (#43):** los aprueba la oficina **al aceptar la rendición**, asociados al vehículo o al concepto (nafta, camión, peón, hotel).
6. **Devoluciones sin comprobante de origen (#28):** las asocia el servidor (va en el doc del ERP). La app no decide contra qué comprobante va.

---

### Avisos del servidor (cuentas corrientes)

- **26/10 — Apertura (#6/#7):** la deuda del sistema viejo que no es comprobante (texto libre: "CHEQUE RECH", "10%", "SEGURO AUDI", diferencias de rendición del personal…) entra como **ajuste del libro mayor**, sin comprobante. El saldo del cliente lo incluye, pero la lista de comprobantes pendientes no. La ficha del cliente (`/api/vendedor/cliente/[id]` y el dataset `vendedor_cc`) trae ahora **`ajustes_apertura`**: `[{ id, fecha, concepto, numero, monto }]` (monto + = debe, − = a favor). **App Vendedor (y Chofer si muestra pendientes):** listarlos junto a los comprobantes pendientes ("Ajuste: CHEQUE RECH (YASH) $X"), solo para mostrar, no se pueden tildar al cobrar. Sin esto, en GRONDONA CHRISTIAN (1000) faltarían $58 M en la lista.
- **26/10 — Billeteras (#29/#36), migración aplicada 26/10:** al confirmar una rendición con retiros aparece en la billetera un movimiento nuevo `referencia_tipo = "rendicion_retiros"` (crédito por lo retirado: compensa que la rendición descuenta los cobros enteros). Si la app lista movimientos, mostrarlo como "Retiros ya descontados" (no es plata nueva). Las diferencias de rendición ya no suman en la billetera del servidor (las apps ya mostraban $0, sin cambios).
- **26/10 — 10 % contado sobre lo que se quedó (#33, lado servidor de V2 y C3), ya en main:** el `nc_contado` de cada comprobante que manda el servidor (ficha del vendedor `/api/vendedor/cliente/[id]` / `vendedor_cc`, cuenta de cobro del chofer) ahora es el 10 % de **(total − NC/REV de devolución ya emitidas)**. Esa es la base acordada: **usen `nc_contado` tal cual, no lo recalculen en la app**. Para una devolución que todavía no tiene NC (cargada en el mismo cobro), el servidor la valúa neta del 10 % (`valor_cobro`), así que tampoco hay que restarle nada más.
- **26/10 — Tope de devolución en el servidor (#25, lado servidor de C2), ya en main:** al registrar una devolución que supera lo vendido en su comprobante de origen menos lo ya devuelto, el servidor responde **409** con `codigo: "TOPE_DEVOLUCION"` y un `error` legible por artículo. Por el outbox llega como rechazo con ese texto: la app lo muestra tal cual (C2 sigue con el tope en pantalla para que no llegue a pasar).
- **26/10 — Transferencias fuera de la rendición (#35, lado servidor de C6 y V5), ya en main:** un cobro con transferencia/depósito/echeq ahora crea **dos pagos** en el servidor: el físico (efectivo + cheque papel, `pendiente_rendicion`) y el digital (`pendiente`, se confirma en /caja). Respuesta de `/api/viajante/cobro`: `pagos[]` trae una entrada por pago, la digital con `transferencia_a_confirmar: true`. La billetera del servidor solo suma la parte física y **la rendición propuesta (`pagos_pendientes`) ya no trae transferencias**. Las apps: mostrar las transferencias aparte con su estado (`pendiente` = "a confirmar en oficina", `confirmado` = "confirmada"), a quién y cuánto; no sumarlas a "plata en mano" ni a la rendición. El overlay sin señal: un cobro con transferencia que todavía no salió no debe sumar la transferencia a la mano.
- **26/10 — PRES del sistema viejo con punto de venta 2 (#18):** los PRES de la apertura se graban "0002-…"; los de gmv2 siguen en "0001-…". Si la app arma o compara números de PRES, no asumir PV 1.
- **26/10 — Comisiones (#10/#11/#42), ya en main:** `/api/vendedor/comisiones` ya no cuenta en "sin cobrar" (ni en las listas) los pedidos **eliminados** ni los pasados al **sistema viejo**; cuando Juan aplique 20261026c_comisiones_salida.sql, el kardex trae siempre `numero_pedido`. La app no tiene que cambiar nada: si mostraba "—" en el número de pedido, después de la migración viene el número.
- **26/10 — Plata a favor en /caja (#37):** la lista de créditos y entregas a cuenta de la ficha del vendedor (`creditos`, `a_cuenta`, `total_a_favor`) sale ahora de `lib/cobranzas/creditos-a-favor.ts`, la misma que usa /caja. Respuesta igual que antes.
- **26/10 — Devolución de un artículo sin comprobante (#28), ya en main:** el `contexto` de devolución (`/api/vendedor/cliente/[id]/comprados`, datasets de vendedor y chofer) trae en `ultimo_presupuesto` el **PRES 0002-00000001** de respaldo del cliente (puede venir con `comprobante_venta_id: null` si todavía no se creó; el servidor lo crea al guardar). Sin 10 % contado. La app no tiene que hacer nada distinto: mostrar "Se asocia a PRES 0002-00000001" si muestra el origen. Blanco sin cambios (última factura).

### Avisos del servidor (hojas de ruta/viajes y cobranzas)

- **26/10 — Entrega bloqueada en el servidor (#23, lado servidor de C1), ya en main (daab2b3):**
  - Cada parada del viaje (`GET /api/chofer/viaje/[id]` → `paradas`, dataset `chofer_viajes`) trae **`entrega_bloqueada: boolean`** = `bloquear_entrega` y todavía no cubrió lo exigido. **Usá ese campo** para deshabilitar "Entregué todo" / "Entregué una parte"; no recalcules la regla. Para lo que todavía no se envió, el overlay ya recalcula `cobro_cumplido`: pasale también los descuentos (ver abajo) y derivá `entrega_bloqueada = bloquear_entrega && !cobro_cumplido`.
  - Texto y código compartidos en `@gm/cobro`: `TEXTO_ENTREGA_BLOQUEADA` ("Si no salda lo solicitado, retirar el pedido") y `CODIGO_ENTREGA_BLOQUEADA` ("ENTREGA_BLOQUEADA"). `cobroCumple({ minimoExigido, cobrado, descuentos })` es la regla.
  - Si igual llega un "entregado"/"entregado_parcial" de una parada bloqueada, el outbox `viaje.parada` lo **rechaza** (definitivo, no reintenta) con `codigo: "ENTREGA_BLOQUEADA"` y un `error` legible. Mostralo tal cual.
  - **Cobrar ya no cierra una parada bloqueada que no cumplió**: el cobro entra, pero la parada queda pendiente. En el overlay, `cierreDeParadaPorCobro` acepta dos campos nuevos opcionales: `bloqueada` (= `bloquear_entrega`) y `descuentos`. Pasalos para que el equipo sin señal haga lo mismo que el servidor. Sin ellos se comporta como antes.
- **26/10 — Lo exigido neto (#27), ya en main (daab2b3):** `minimo_exigido` ahora viene **neto de lo devuelto en el viaje**, y la parada trae **`descuentos_cobro`** (10 % contado y ajuste de los cobros del viaje). `cobro_cumplido` = cobrado + descuentos_cobro ≥ minimo_exigido. Si la app muestra "COBRAR SÍ O SÍ" / "cobró X de Y", usá esos campos tal cual.
- **26/10 — Bultos y pallets (#22), ya en main (e0b8b3f):** la oficina carga bultos **y pallets** por pedido en el ERP. En la hoja del viaje, `pedidos[].pallets` y `paradas[].pallets` (número, 0 si no hay). Si la app muestra "bultos a bajar", puede sumar "· N pallets" cuando haya. El depósito no hace nada (D2).
- **26/10 — Gastos del chofer (#43), ya en main (839f9db):** la oficina los aprueba o rechaza al aceptar la rendición en /caja. Después de eso el gasto deja de estar `declarado` (queda `aprobado` o `rechazado`, con `motivo_rechazo`); la app no tiene que hacer nada más que mostrar ese estado (no "a revisar" si ya no está `declarado`). Puede venir el concepto nuevo `camion` (lo pone la oficina): mostralo como "Camión". El chofer sigue cargando con las categorías de siempre.
- **26/10 — Número de comprobante (#21):** en la hoja, `pedidos[].comprobantes[].numero` ahora es "0001-00000021" (antes "0001-0001-00000021").

## 2. Quién hace qué (anotá "en curso" antes de empezar)

| Tarea | Área | Depende del servidor | Estado |
|---|---|---|---|
| C1 — Bloqueo de entrega real (#23) | App Chofer | Sí: hojas de ruta/viajes y cobranzas — **servidor listo 26/10 (daab2b3)**, ver "Avisos del servidor (hojas de ruta)" | Pendiente (ya se puede hacer) |
| C2 — No devolver más de lo vendido; mostrar qué se devuelve (#25) | App Chofer | Sí: cuentas corrientes pone el tope en el servidor | Pendiente |
| C3 — Cobro con devoluciones + 10 % contado: valuar la devolución como el servidor (#26) | App Chofer | No | Pendiente |
| C4 — "No entregado" con un solo texto si fue por falta de pago (#24) | App Chofer | No | Pendiente |
| C5 — "−$0,00" en la billetera (#3) | App Chofer | No | Pendiente |
| C6 — Transferencias fuera de la rendición (#35) | App Chofer | Sí: cuentas corrientes | Pendiente (esperar servidor) |
| V1 — Checkbox 10 % contado al finalizar el pedido y total en vivo (#13) | App Vendedor | Sí: listas de precios y descuentos guarda el contado en el pedido | Pendiente |
| V2 — Cobrar con 10 % contado: la base no incluye lo ya devuelto (#33) | App Vendedor | Sí: cuentas corrientes (la REV del 10 %) | Pendiente |
| V3 — Pedido facturado: mostrar también las reversas (#31) | App Vendedor | No | Pendiente |
| V4 — "Plata de la empresa en tu mano" descuenta los retiros (#32) | App Vendedor | No | Pendiente |
| V5 — Transferencias fuera de la rendición (#35) | App Vendedor | Sí: cuentas corrientes | Pendiente (esperar servidor) |
| ~~V6 — "Mercadería cobrada" = "Comisiones ganadas" (#41)~~ | App Vendedor | — | **Hecho 26/10** (ea55e14, APK v0.4.4 compilada). Validado: 001939 = $51.175,19 |
| T1 — Iniciar sesión con **nombre de usuario** (#2) — **toca `@gm/core` (las 3 apps)** | **App Vendedor** hace el cambio en core y en el servidor del login; chofer y depósito solo recompilan | Sí (endpoint del login, ver T1) | Pendiente |
| D1 — Recompilar con el login nuevo (T1) | App Depósito | — | Esperando T1 |
| D2 — Nada que hacer con bultos ni con pedidos todo faltante (solo para que lo sepas) | App Depósito | — | Informativo |

---

## 3. App Chofer

### C1 — El bloqueo de entrega no bloquea (#23) · GRAVE

**Qué pasó:** en el viaje PRUEBA, la parada de FITTERER tenía "🔒 NO ENTREGAR SIN COBRAR — DEBE MUCHO DE LO ANTERIOR" y "COBRAR SÍ O SÍ $3.784.286,00". Juan la marcó **"entregado" sin cobrar nada** y la app lo dejó. El servidor también lo aceptó.

**Dónde:** el cartel es solo visual (`mobile/apps/chofer/src/pantallas/Viaje.tsx:193`). Las opciones de resultado están en `Viaje.tsx:396` ("✔ Entregué todo", "◐ Entregué una parte", "✕ No entregué"). La parada trae `bloquear_entrega`, `minimo_exigido` y `cobro_cumplido`.

**Qué tiene que pasar:**
- [ ] Si `bloquear_entrega` y **no** `cobro_cumplido`: las opciones "Entregué todo" y "Entregué una parte" **no se pueden elegir** (deshabilitadas o escondidas).
- [ ] Se muestra **"Si no salda lo solicitado, retirar el pedido"**.
- [ ] Solo queda "✕ No entregué".
- [ ] Apenas se registra el cobro que cumple lo exigido (también **sin señal**, con el overlay), se habilitan las opciones de entrega.
- [ ] Si el cobro cumple solo "lo anterior" o solo "este viaje", vale lo que diga `minimo_exigido` / `cobro_cumplido`. No recalcules la regla en la app; usá lo que ya trae la parada (y el overlay para lo que todavía no se envió).
- [ ] Contá con que el servidor va a **rechazar** un "entregado" de una parada bloqueada sin cobro (lo hace hojas de ruta/viajes y cobranzas). La app tiene que mostrar ese rechazo de forma entendible y no quedarse reintentando para siempre.

**Cómo verificar:** con el mock, parada con `bloquear_entrega: true` y cobro exigido. Probá: sin cobro (no deja entregar), con cobro parcial que no llega (no deja), con cobro que cumple (deja), y lo mismo en modo avión.

### C2 — Se puede devolver dos veces lo mismo (#25) · GRAVE

**Qué pasó:** CHEN compró **6** naftalinas (PRES 0001-00000022). Juan cargó una devolución de las 6 (DEV-00001) y la app le dejó cargar **otra** de las mismas 6 (DEV-00002). Terminaron 12 devueltas de 6 vendidas. El cobro se calculó con las dos, y el cliente pagó de menos: después de que depósito rechazó la duplicada, quedó debiendo $17.743,69.
Además, la pantalla de devoluciones del chofer muestra **solo "devolución" y el monto**: no se ve qué artículos ni cuántos.

**Dónde:** `mobile/apps/chofer/src/pantallas/Devolucion.tsx` y el overlay (`datos/overlay.ts`).

**Qué tiene que pasar:**
- [ ] Por artículo, el máximo a devolver es **lo vendido menos lo ya devuelto**. "Lo ya devuelto" incluye: devoluciones confirmadas, pendientes en el servidor (de cualquier app) y las que todavía no se enviaron en el equipo.
- [ ] Si se intenta pasar el máximo: aviso claro ("Ya se devolvieron 6 de 6") y no deja.
- [ ] En la lista de devoluciones (ficha del cliente, cobro, resumen): mostrar **artículo y cantidad**, no solo el monto.
- [ ] El servidor también pone el tope (cuentas corrientes; ver el doc del ERP). Si rechaza, la app lo muestra.

### C3 — Cobro con devoluciones y 10 % contado: la app pide de menos (#26)

**Qué pasó:** CHEN, PRES de $154.329,05, con 10 % contado y devoluciones por $47.005,44 (las dos de naftalina, a precio lleno). La app pidió **$91.890,70** ($154.329,05 × 0,9 − $47.005,44). El servidor, en cambio, revierte la devolución **al 90 %** cuando el comprobante se cobró contado ("tal cual se facturó"). Con esas dos devoluciones, lo correcto era **($154.329,05 − $47.005,44) × 0,9 = $96.591,25**: la app pidió $4.700,54 de menos.
Es el hallazgo 14 de la auditoría de cuentas corrientes ("el chofer ve las devoluciones a valor bruto"), que seguía abierto.

**Qué tiene que pasar:**
- [ ] En un cobro con 10 % contado, la devolución se resta **al mismo valor con el que la va a revertir el servidor**. Usá el `valor_cobro` o valor neto que ya manda el servidor; si no viene, pedíselo a cuentas corrientes. No lo inventes en la app.
- [ ] Caso de prueba con números redondos: PRES $100.000, devolución $10.000, contado. Hay que cobrar **$81.000** = ($100.000 − $10.000) × 0,9, no $80.000.

### C4 — "No entregado" pide dos textos (#24)

**Qué pasó:** Juan marcó FITTERER "no entregado" porque no pagó. La app le pidió "por qué no se entregó" **y** "por qué no se cobró" (`Viaje.tsx:120` y `:132`).

**Qué tiene que pasar:**
- [ ] Si la parada estaba bloqueada por cobro, o el motivo de no entrega es "no pagó", **un solo texto** (o una opción rápida "No pagó") que sirva para los dos campos.
- [ ] En los demás casos, como hoy.

### C5 — "−$0,00" en la billetera (#3)

- [ ] Con gastos en cero, mostrar "$0,00" sin el signo menos. Es la misma regla que ya pidió Juan: nada de guiones ni signos sobre cero.

### C6 — Transferencias fuera de la rendición (#35) · esperar al servidor

**Regla de Juan:** la transferencia se anota en la app, la confirma la oficina en /caja cuando entró al banco, y **la rendición no la lleva**.

- [ ] Cuando cuentas corrientes tenga el servidor listo (ver el doc del ERP): la rendición del chofer propone **solo efectivo y cheques**. Las transferencias se ven aparte, con su estado ("a confirmar en oficina" / "confirmada").
- [ ] La ficha y la billetera siguen mostrando a quién se le cobró y cuánto, también por transferencia.

### Lo que NO tiene que tocar la App Chofer (para que no te sorprenda)
- El texto **"Cobró $100.000 de $154.329,05 exigidos"** de la parada (#27) lo arma el servidor: lo arregla hojas de ruta/viajes y cobranzas.
- La billetera de la base queda con $1.000 "fantasma" después de rendir (#29), pero la app muestra $0,00, que está bien. Lo arregla cuentas corrientes.

---

## 4. App Vendedor

### V1 — Checkbox "10 % por pago contado" al finalizar el pedido, con total en vivo (#13)

> **Lado servidor HECHO 26/10 (listas de precios, 8f907c8). El campo es `bonif_pedido.contado_todo`:** `true` tildado, `false` destildado, sin la clave = según cada condición. Va dentro del `bonif_pedido` que la app ya manda en el outbox del pedido (sin señal anda igual). Le gana a segmento, ficha y condiciones por proveedor/marca.
> - **Cómo arranca:** `contadoPorDefectoCliente(fichaFilas, condiciones)` de `@gm/pricing` → `"todo"` (tildado), `"parcial"` (algún segmento o proveedor: mostrarlo como "parcial — según cada proveedor" y dejar tildar o destildar todo) o `"nada"`.
> - **Por artículo:** `resolverContadoItem(cond, bonif_pedido, fichaFilas, segmento, esEspecial)` dice si ese artículo va contado. La lista Especial nunca va contado.
> - **Total en vivo:** total del pedido − 10 % de los artículos que van contado (el 10 % sale en NC/REV aparte al facturar, igual que el servidor).

**Qué pasó:** Juan quiso tomar el pedido de CHEN como contado y **no encontró dónde**. Hoy el 10 % solo aparece al **cobrar**.

**Regla de Juan (26/10):**
- [ ] Al **finalizar el pedido** aparece un cartel o fila con un checkbox **"10 % descuento pago contado"**.
- [ ] Si el cliente tiene el 10 % contado **por defecto** (ficha o segmento): aparece **tildado**.
- [ ] Si no lo tiene: se puede tildar ahí, solo para ese pedido.
- [ ] **El total del pedido se ve en vivo con el 10 % incluido** si está tildado. Juan quiere ir viendo el total real mientras levanta el pedido en la calle.
- [ ] Funciona **sin señal** (el pedido sale con la marca por el outbox).

**Depende de:** listas de precios y descuentos tiene que hacer que el pedido guarde la marca (`pedidos.pago_contado_10` u otra) y que el servidor la respete al facturar. Ya hay base: el ERP tiene "Contado 10 %" por segmento en el pedido y existen `pedido_marca_condicion` / `pedido_proveedor_condicion`. **Coordiná el nombre del campo con ese agente antes de programar.**

### V2 — Cobrar con 10 % contado: la base no incluye lo ya devuelto (#33)

**Qué pasó:** a URQUIZA le quedaban $2.015.618,22, después de dos REV de devoluciones por $293.597,34, a precio lleno. Juan le cobró contado (a propósito). La app calculó el 10 % sobre los **totales originales** de los PRES ($2.309.215,56 → $230.921,56), y el servidor emitió la REV por ese mismo importe. El cliente se llevó **$29.359,74 de descuento de más**: el 10 % de la mercadería que ya había devuelto.

**Qué tiene que pasar:**
- [ ] El 10 % contado se calcula sobre **lo que el cliente se queda**: total del comprobante menos las reversas o NC de devoluciones ya hechas. Es lo mismo que pagar con el 10 % el saldo de la mercadería.
- [ ] En el ejemplo: ($2.309.215,56 − $293.597,34) × 10 % = **$201.561,82**.
- [ ] La REV la emite el servidor (cuentas corrientes la corrige del lado del servidor). **Los dos tienen que usar la misma base**; acordala con cuentas corrientes antes de programar.

### V3 — Pedido facturado: mostrar también las reversas (#31)

**Qué pasó:** en "Mis pedidos → Facturados", el 001939 figuraba por $2.015.618 con sus 2 PRES, pero **sin las REV** de las devoluciones. El vendedor no entiende por qué no es $2.309.215,56.

- [ ] En el detalle de un pedido facturado: listar sus comprobantes **y** las reversas o NC asociadas (devolución, 10 % contado), con su número y monto.
- [ ] El total que se muestra tiene que cerrar a la vista: PRES − REV = lo que debe.

### V4 — "Plata de la empresa en tu mano" no descuenta el retiro (#32)

**Qué pasó:** Juan cobró $1.000.000 en efectivo y retiró $10.000. El inicio seguía diciendo **$1.000.000**; la pantalla de Rendiciones sí decía "llevás $990.000". Después de rendir, mostró $0,00, que está bien.

- [ ] Mientras no se rinde, la plata en mano es **efectivo cobrado − retiros**. Tiene que dar lo mismo que "llevás" en Rendiciones.

### V5 — Transferencias fuera de la rendición (#35) · esperar al servidor
Igual que C6:
- [ ] La rendición lleva solo efectivo y cheques.
- [ ] La transferencia queda "a confirmar en oficina" hasta que /caja la confirma.

**Ojo:** hoy, al confirmar la rendición del vendedor, la transferencia de $784.600 de URQUIZA **entró directo al banco**. Eso lo cambia el servidor.

### Lo que NO tiene que tocar la App Vendedor
- **"Sin cobrar hasta $2.271.578,99"** (#10) incluye comisiones de pedidos en "Sistema viejo" y de pedidos eliminados. Lo arregla el servidor (cuentas corrientes). Cuando esté, la app lo muestra bien sin cambios.
- Pedidos sin número en la lista de comisiones (#11): servidor.
- Borrador **"Pedido a medio cargar · CHEN XIANG RONG"** en el NuStar: es basura de la prueba, Juan lo borra a mano.

---

## 5. Login con nombre de usuario (#2) — T1, lo hace la App Vendedor para las 3

**Qué pasó:** las 3 apps solo dejan entrar con el **mail**. El ERP deja entrar con el **nombre de usuario** ("Nombre de usuario" en `components/auth/login-form-client.tsx`, que resuelve con `loginUser` de `lib/actions/auth`).

**Dónde:**
- `mobile/packages/core/src/auth/auth.ts:95`: `ingresar(email, password)` hace POST a `/api/mobile/auth/login` con `{ email, password, app }`;
- la pantalla de login de `@gm/core` (`packages/core/src/ui/pantallas.tsx`).

**Qué tiene que pasar:**
- [ ] El campo dice "Usuario o mail" y acepta cualquiera de los dos.
- [ ] `/api/mobile/auth/login` acepta un usuario. Si no tiene "@", lo resuelve **igual que el ERP**: reusá la misma función, no copies la lógica. Mismos errores, mismo bloqueo por rol de app.
- [ ] Las sesiones guardadas siguen andando (no hay que volver a loguearse por el cambio).
- [ ] Como toca `@gm/core`, lo hace **un solo agente (App Vendedor)**. Chofer y depósito solo recompilan su próxima APK. Avisá en la tabla cuando esté en `main`.

---

## 6. App Depósito

### D1 — Recompilar con el login nuevo (T1)
- [ ] Cuando T1 esté en `main`, la próxima APK de depósito ya lo trae. Probá entrar con usuario y con mail.

### D2 — Para que lo sepas (no hay que programar)
- **Bultos (#22):** por decisión de Juan, por ahora se cargan **en el ERP**, no en la app. No agregues nada al cierre del picking.
- **Pedido con todo faltante (#17):** en la prueba, el 001942 se cerró con los 3 renglones faltantes y quedó en "Pendiente Facturación" para siempre. Lo resuelve el ERP: va a poder volverlo a "pendiente" o eliminarlo. **La app no cambia**, pero si un pedido vuelve a "pendiente", tiene que reaparecer en la cola como cualquier otro.
- **Pedido preparado parcial:** el servidor ya factura **lo preparado** y no lo pedido (arreglo del 23/10, `lib/pedidos/cantidad-a-facturar.ts`). Sin cambios en la app.
- **Las 2 "Recibir mercadería" pendientes** que se ven en el inicio son de prueba (#4): se borran antes del pase. No las proceses.

---

## 7. Al terminar cada tarea

1. Tachala en la tabla del punto 2, con fecha y commit o versión.
2. Si cambió algo que el roadmap tiene como problema, agregá en [`docs/PRUEBA-INTEGRAL-SALIDA.md`](PRUEBA-INTEGRAL-SALIDA.md), columna "Estado" de ese #, "Hecho dd/mm (commit)".
3. CHANGELOG de la app y `MOBILE.md` si cambió una regla.
4. APK nueva: avisale a Juan para instalarla en el NuStar. Las pruebas de campo las hace él.
