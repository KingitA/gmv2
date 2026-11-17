# Prueba integral de ENTRADA de mercadería — problemas y plan

Fecha del relevamiento: 16/11/2026 (main `266af55`). Lo lleva el orquestador; los agentes tachan acá lo que cierran.

Alcance: precios de compra → orden de compra (OC) → envío al proveedor → recepción en depósito → comprobantes (OCR) → verificación y diferencias → cuenta corriente del proveedor → vencimientos → orden de pago (OP), retenciones, bancos/cheques/caja → reportes y Jarvis.

Cómo se hizo: lectura completa del código de cada tramo + consulta de solo lectura a la base de producción. **No se probó en pantalla** (escribe en producción). Cada problema dice si está verificado en código (C), en la base (B) o es supuesto (S).

## Reglas para todo agente que tome una tanda

1. Rama y worktree propios desde `origin/main` (`git worktree add ../gmv2-<rama> -b <rama> origin/main`). Push de la rama, **nunca a main**: los merges los hace el orquestador.
2. `npm run typecheck:movil` obligatorio antes de cada entrega (mirar el texto `✓ typecheck:movil OK`, no la última línea). Si se toca `mobile/`: `cd mobile && npm test`.
3. Formatos: leer `docs/FORMATOS.md`. Solo helpers de `lib/formato` e inputs `InputMonto`, `DateInputAR`, `InputCUIT`.
4. Migraciones: solo escritas en `supabase/migrations/` (idempotentes, `hoy_ar()`, `timestamptz`). No se aplican: el orquestador se las pasa a Juan. El código debe tolerar que la migración todavía no esté aplicada, o avisar claramente que el merge depende de ella.
5. Nada de datos en producción. Nada fiscal (ARCA).
6. Toda operación que toque stock, cuenta corriente, vencimientos o caja va en UNA función SQL transaccional e idempotente (no secuencias de inserts desde la ruta o el navegador).
7. Sin `alert()`/`confirm()` nativos en pantallas que se toquen: usar los diálogos/toasts del sistema.
8. Si el cambio toca una app (`mobile/`), anotarlo en `docs/PENDIENTES-APPS.md`.
9. Reporte final: qué se hizo por id (E-xx), archivos, migraciones nuevas, cómo probarlo, qué quedó afuera.

## Estado de los datos (base, 16/11)

- 10 OC, 12 recepciones, 13 comprobantes de compra, 1 OP (pendiente). Circuito casi sin uso real: lo que se usa a diario es `vencimientos` (668, cargados a mano, ninguno atado a OC/comprobante).
- Proveedores (96): 18 con mail, 54 con CUIT, 2 con acuerdo de pago cargado, 0 con CBU, los 96 con el mismo régimen de Ganancias (valor por defecto).
- Los 13 comprobantes siguen en `pendiente_recepcion`; hay duplicados y números inventados (`PENDIENTE-…`, `GMAIL-ADD-…`).
- En 72 líneas recibidas: nunca `precio_verificado`, nunca destino de diferencia. `cuenta_corriente_transportes` vacía.
- `ordenes_compra.estado` tiene un CHECK que solo admite `pendiente`, `recibida_parcial`, `recibida_completa`, `cancelada`: **`finalizada` y `enviada` las rechaza la base**.
- OC-000010 HORNAL (13/11): pedido en bultos (2 bultos × 24 u) y el stock recibió `+2`. Las 7 líneas entraron como unidades. Stock real mal cargado.

## Decisiones de Juan (16/11)

1. Todo lo de compras es dato de prueba (OC, recepciones, comprobantes de compra, cuenta corriente de proveedores, OP, stock). **Los `vencimientos` NO**: son sus anotaciones reales, no se tocan ni se borran.
2. El stock actual es de prueba: antes de producción se carga desde ajustes de depósito. No hace falta corregir OC-000010.
3. Bancos: no tienen Interbanking. Se puede adoptar si resuelve el problema y cuesta poco (tope: no más del 1 % mensual sobre lo que hoy pagan). A investigar antes de la Tanda 2.
4. Retenciones: **solo Ganancias**. 2 % a proveedores de mercadería, 0,25 % a transportes, salvo exentos. No hay IIBB/IVA/SUSS: E-60 se cierra sin motor (ocultar esos campos). Falta la condición "exento" en la ficha (hoy solo `inscripto` / `no_inscripto`).
   Confirmado por Juan: el mínimo no sujeto de $224.000 mensual por proveedor (mercadería) está bien aplicado; el motor nuevo es el correcto, no el TXT del sistema viejo. Pendiente: mínimo de transporte (seed 6.700, ¿67.170?).
5. Plazo de pago: depende del proveedor, desde la emisión de la factura o desde la recepción. Fuente única = `proveedores.pago_blanco_*` / `pago_negro_*` (ya tienen `*_desde` = `factura` | `recepcion`). `plazo_dias`, `plazo_desde`, `dias_vencimiento` y `condicion_pago` quedan como legado a retirar (E-06).
6. Datos de proveedores: Juan completa `docs/entrada/proveedores-para-completar.xlsx` (sin commitear) y se importa. Hay que escribir el importador y agregar las columnas que falten (mail de OC, alias, titular, acepta cheques de terceros / e-cheq, exento y vencimiento del certificado, días de entrega).

### Decisiones de Juan sobre pagos (16 y 17/11, textuales)

- **Quién arma y confirma órdenes de pago:** «La orden la va a armar solo admin. Administrativo no tiene el poder de ejecutar un pago.»
- **Pagar un importe distinto al del vencimiento:** «Se puede pagar mas, no hay problema. En este caso puede pasar como ajuste o como entrega a cuenta del proveedor.»
- **Eliminar una orden pagada:** solo admin («Si, queda solo para admin»).
- **Reportes de Playroom:** «Admin y administrativo».
- **Retención al pagar un vencimiento cargado a mano:** «el sistema debe preguntarnos si corresponde retenerle, ya que un vencimiento cargado a mano puede ser un comprobante NO fiscal (adquisición de stock, un cheque rechazado) y a estos no corresponde retenerle. En caso de poner que SÍ retenemos, genera la misma. Si el proveedor es EXENTO nos lo debe aclarar un cartel que no se nos escape.» Base = importe ÷ 1,21 (17/11).
- **Pagar menos que un vencimiento cargado a mano (17/11):** «dale, agregalo» → opción "Con este pago queda cancelado" por vencimiento (sin marcar por defecto): marcada, el vencimiento queda pagado y la diferencia queda como descuento / ajuste (`vencimientos.monto_ajuste`); sin marcar, queda pendiente por lo que falta. Migración `20261117p_ordenes_pago_t1d.sql`.
- **Vencimiento pagado en varias partes (17/11):** «ok» → al final figura pagado por el total y enlazado a la última orden. Mientras está pendiente, `monto` es lo que falta; el total queda en `monto_original` y lo pagado en `monto_pagado` (se ve en el formulario del vencimiento y Jarvis lo informa).
- **Migración única de la Tanda 1-D:** `20261117p_ordenes_pago_t1d.sql` reemplaza a las seis que se habían escrito por separado (cada función definida una sola vez). Los datos para pagarle al proveedor (CBU, alias, titular, acepta cheques de terceros / e-cheq) son las columnas de `20261117m_proveedores_datos_compra.sql` (Tanda 1-A) y se cargan en la ficha del proveedor; la orden de pago solo los muestra.
- **Períodos presentados ante ARCA:** bajar el TXT de SICORE no cierra nada; el período se cierra con "Marcar presentado ante ARCA" en Órdenes de pago (solo admin). Hasta esa fecha no se elimina una orden con certificado (se anula) ni se crea o confirma una orden con retención fechada ahí.
- **Provisiones de órdenes de compra:** no son deuda. En la cuenta corriente van aparte ("Comprometido por órdenes de compra"), fuera del saldo y fuera de lo pagable.
- **Fecha que manda para la retención de Ganancias (17/11):** «Sí, tiene que ser según fecha de confirmación» → acumulado mensual, lo ya retenido, fecha del certificado y período SICORE por la fecha de confirmación de la orden (con "Pagar ahora" es el mismo día). El control de período presentado ante ARCA va contra esa fecha.
- **Qué espera del pago (17/11):** ver los vencimientos y, según el tipo: transferencia → de qué banco sale; cheque de tercero → que el sistema sugiera con cuál pagar según monto, fecha, color y condiciones del proveedor; cheque propio físico → cuánto y cuándo hay que hacerlo; e-cheq → como transferencia; efectivo → cuánto separar y para quién. Y la cuenta corriente del proveedor sencilla, con pagos, retenciones y comprobantes.

### Respuestas de Juan a las dudas de la Tanda 0-A (16/11, textuales)

7. **¿Un comprobante de proveedor sin orden de compra debe generar la deuda en cuenta corriente al validarse?** — «Si, debe crearla.» → **Hecho en `entrada-t0a-compras-recepcion`**: validar genera el movimiento de cuenta corriente con o sin OC; sin proveedor no valida.
8. **Artículo pedido por bulto sin unidades por bulto cargadas: ¿bloquear la OC o la recepción?** — «No, prefiero que no bloquee nada, a lo sumo nos daremos cuenta (en triple verificacion) cuando carguemos un articulo con precio unitario al mismo precio que el bulto, o en todo caso se actualizara el precio a precio unitario = precio de bulto. Pero dejalo asi, son cosas a tener en cuenta en el dia a dia del trabajador.» → **Queda como está**: se toma 1 unidad por bulto y se avisa en rojo (app y verificación). Nada para la Tanda 1.
9. **Renglón de factura que no es mercadería (flete): ¿alcanza con quitarlo para poder validar?** — «Mientras quede discriminado el renglon de flete o cual sea si, no hay problema. Lo que no puede pasar es una factura de $100 neto + 21% de iva +3% de flete, no puede cargarse como $121. debe ser $124. Si la unica solucion es discriminarlo, discriminalo.» → **Hecho en la rama**: el renglón no se borra, se marca "No es mercadería" (`match_estado = 'no_mercaderia'`), se ve en la verificación como "Otros conceptos facturados" y la deuda es siempre el total del comprobante ($124). **Para la Tanda 1 (T1-B):** que esos conceptos tengan destino contable propio (cuenta del transporte / gasto) y aparezcan en el PDF y en la cuenta corriente discriminados.
10. **¿Un remito debe poder validarse (sin deuda)?** — Primero: «No entiendo tu pregunta. A que llamar "validar"?». Aclarado, el 17/11: «No tiene sentido validar un remito, lo que buscamos con esta validación es que las cantidades y precios estén bien, un remito solo va a traer cantidades, y sin precio no deberíamos poder validar una orden de compra. Lo que sí podemos es validar cantidades, pero no nos debería permitir cerrar la OC.» → **Hecho en `entrada-t0a2-remito`**: el remito no tiene botón Validar y la ruta y la función lo rechazan (migración `20261117a_remito_no_se_valida.sql`, el merge no depende de ella); figura como "Remito: controla cantidades". "Finalizar OC" lo decide el servidor (`POST /api/ordenes-compra/[id]/finalizar`, regla en `lib/compras/finalizar-oc.ts`): hace falta al menos una factura o adquisición validada, ningún comprobante con precios / NC / ND sin validar, y que todo artículo recibido figure en una factura validada; con solo remitos la orden queda abierta y avisa "Falta la factura para controlar precios".
11. **Hasta instalar la APK nueva el operario tiene que contar en la unidad de la OC: ¿se publica antes de volver a recibir?** — «si, se publica apk nuevo antes de la proxima prueba» → **Código hecho en la rama, APK sin generar** (el encargo de la Tanda 0-A era no generarla). La publica el orquestador antes de la próxima prueba, con la migración `20261116a` aplicada (PENDIENTES-APPS R1).

## Problemas

### A. Orden de compra

| id | Problema | Verif. |
|---|---|---|
| ~~E-01~~ | ~~Pantalla vieja `app/ordenes-compra/[id]/articulos` suma stock (`incrementar_stock`) en cada guardado y borra el detalle. Se entra desde la cuenta corriente del proveedor.~~ **Hecho T0-A: la pantalla redirige a la verificación; el link de la cuenta corriente también.** | C |
| ~~E-02~~ | ~~"Usar sugerencia" copia unidades como bultos (pide N bultos en vez de N unidades).~~ **Hecho T0-A: "usar" convierte a bultos enteros hacia arriba (mismo camino que Jarvis).** | C |
| E-03 | No existe el envío por mail. PDF/Excel solo descargan; el ícono es "Send". | C |
| E-04 | La OC no tiene condición de pago (columnas existen, nadie las escribe); no se ve en el PDF. | C, B |
| E-05 | La OC no genera vencimientos; nacen recién al validar la factura. | C, B |
| E-06 | Tres fuentes de plazo distintas: `pago_blanco_*`/`dias_vencimiento` (validar), `plazo_dias`/`plazo_desde` (mail), ficha (`plazo_dias`). | C |
| E-07 | Crear/editar OC sin transacción; numeración con carrera; editar reescribe la provisión sin impuestos y no actualiza el kardex pendiente. | C |
| E-08 | Provisión mal calculada: IVA fijo 21 %, suma el % de retención de Ganancias como deuda. | C |
| E-09 | Estados `enviada`, `confirmada`, `en_camino`, `cancelada`, `finalizada` no se escriben o los rechaza el CHECK. No hay cancelar (solo borrar). **CHECK hecho T0-A (migración 20261116b, sin aplicar); estados y cancelar siguen para T1-A.** | C, B |
| E-10 | Fecha estimada de entrega usa días de pago; RPC `calcular_avg_dias_recepcion` no existe; no se edita. | C, B |
| E-11 | Crear la OC pisa `articulos.precio_compra` y descuentos sin historial. | C |
| E-12 | Diálogo de OC: muestra todo el catálogo sin stock ni venta; sin total, sin guardar-en-curso, doble click crea dos; listado sin total/fecha/creador; `select *` pesado. | C |
| ~~E-13~~ | ~~OC de faltantes e importación desde archivo asumen 1 unidad por bulto; ítems sin artículo llegan al insert.~~ **Hecho T0-A: el servidor lee las unidades por bulto de la base y rechaza renglones sin artículo.** | C |
| E-14 | Proveedor del artículo: la tabla usa `articulos.proveedor_id`, la sugerencia `articulos_proveedores` (18 filas). | C, B |
| E-15 | Código muerto en `app/ordenes-compra/page.tsx` y pantalla huérfana `[id]/comprobantes`. | C |

### B. Precios de compra

| id | Problema | Verif. |
|---|---|---|
| E-20 | Aplicar lista de proveedor ignora la fecha de vigencia, no usa `precios_programados`, marca `aplicada` con errores, descuento 0 = "no tocar", link roto al archivo, no acepta PDF. | C |
| E-21 | `precios_compra_historial` vacío (0 filas): el insert falla en silencio. No hay historial de costo. | C, B |
| E-22 | Listas que llegan por mail van a `importaciones_articulos`, circuito paralelo a `listas_proveedores` (0 filas). | C, B |
| E-23 | El costo no se actualiza al recibir ni al validar la factura; `ultimo_costo` queda en 0. | C, B |

### C. Recepción (app Depósito y oficina)

| id | Problema | Verif. |
|---|---|---|
| ~~E-30~~ | ~~**Bultos vs unidades**: la OC va en bultos, la app muestra "u" y el stock suma lo contado tal cual.~~ **Hecho T0-A: stock, kardex y movimientos en unidades; app y oficina dicen "2 bultos × 24 u = 48 u". Falta APK (PENDIENTES-APPS R1). El stock de OC-000010 no se corrige (decisión 2 de Juan).** | C, B |
| E-31 | Kardex `compra` duplicado: el pendiente de la OC se confirma al validar y además queda el de la recepción. | C |
| ~~E-32~~ | ~~`validar` sin control de estado ni transacción: doble click = doble deuda y doble vencimiento; valida remitos en $0; no bloquea líneas sin match; el primer comprobante borra toda la provisión.~~ **Hecho T0-A: función `comprobante_compra_validar` (migración 20261116c); sin ella, mismas reglas con compuerta de estado.** | C |
| E-33 | `cerrar` (resolver diferencia) no es idempotente; "proveedor" resta stock que nunca entró; sobrante tratado como faltante; NC esperada sin IVA; precio neto comparado con lista. | C |
| E-34 | "Empresa absorbe" guarda el neto en `precio_compra` (lista): descuento aplicado dos veces. | C |
| ~~E-35~~ | ~~Nota de débito se registra como nota de crédito.~~ **Hecho T0-A: la ND queda como `ND`, suma deuda (`nota_debito`) y genera vencimiento.** | C |
| ~~E-36~~ | ~~Duplicados de comprobante: sin número cada foto crea otro `PENDIENTE-…`; factura de 3 hojas = 3 comprobantes; la misma factura en dos OC.~~ **Hecho T0-A (duplicados): mismo proveedor + clase + número normalizado en cualquier OC ⇒ aviso 409; las fotos sin número van a UN comprobante provisorio por orden y tipo. La factura de varias hojas CON número repetido en cada hoja se rechaza como duplicada: multipágina real queda para T1-C (E-38).** | C, B |
| ~~E-37~~ | ~~OCR: modelo escrito a mano (`gemini-2.5-flash`) en 4 archivos sin respaldo; si falla crea un comprobante vacío marcado como procesado.~~ **Hecho T0-A: los 4 usan `lib/ai/gemini-model.ts` (principal + respaldo); lectura fallida o sin renglones ⇒ documento "no leído", sin comprobante.** | C |
| E-38 | App: una foto por vez, sin PDF, sin offline, el operario no ve lo leído, no comprime (límite 4,5 MB). | C |
| E-39 | No hay recepción parcial real (segunda tanda nunca se abre); finalizar cierra la OC. | C, B |
| ~~E-40~~ | ~~Stock sin atomicidad en `finalizarRecepcion` (lee y escribe).~~ **Hecho T0-A: función `recepcion_aplicar_stock` (migración 20261116a), marca por línea; finalizar dos veces suma una.** | C |
| ~~E-41~~ | ~~Borrar el último documento pone en 0 lo documentado, incluso lo cargado a mano.~~ **Hecho T0-A: solo se limpia lo que aplicó el documento borrado.** | C |
| E-42 | Bonificados (100 %) aparecen como diferencia de precio; no existe "sin cargo". | C |
| E-43 | Artículo no pedido: solo se puede vincular a otro, no aceptar ni devolver. | C |
| E-44 | Oficina: `alert/confirm`, una decisión por artículo, sin vista previa del impacto, la foto no se ve al lado, no se puede corregir lo contado. | C |
| E-45 | Transporte: solo cantidad; sin vínculo con bultos no conformes ni descuento del flete. | C, B |
| E-46 | No se compara total del detalle contra total de la factura al validar. | C |
| E-47 | Caminos duplicados/viejos: `/api/deposito/recepciones/documento`, `processOCRData`, `runArticleLevelOCR`. | C |

### D. Pagos, retenciones, tesorería

| id | Problema | Verif. |
|---|---|---|
| ~~E-50~~ | ~~`ordenes_pago.monto_total` suma las retenciones dos veces.~~ **Hecho (T0-B):** regla única escrita en `op_crear` y en la ruta: `monto_total` = lo que cancela de la deuda, `neto_a_pagar` = `monto_total` − `total_retenciones` = suma de medios. | C |
| ~~E-51~~ | ~~Crear OP no es transaccional: puede quedar sin medios o sin imputaciones y devolver éxito.~~ **Hecho (T0-B):** función SQL `op_crear` (todo o nada, con clave contra el doble click). Migración `20261116p`. | C |
| ~~E-52~~ | ~~Imputar por vencimiento no baja la factura en cuenta corriente: queda pagable otra vez; doble imputación posible.~~ **Hecho (T0-B):** el vencimiento con comprobante se imputa contra su movimiento de cuenta corriente (`op_movimiento_de`); el cargado a mano se sigue pagando contra el vencimiento. No se puede tildar la misma deuda por dos caminos. Al vencimiento sin comprobante se le puede pagar un importe distinto al anotado (Juan, 16/11: la diferencia es ajuste o entrega a cuenta). | C |
| ~~E-53~~ | ~~"Generar OP" desde el calendario no preselecciona nada.~~ **Hecho (T0-B):** llegan proveedor, vencimiento y monto; queda tildado y a la vista (la Nueva OP ahora lista también los vencimientos sin comprobante). | C |
| ~~E-54~~ | ~~No se valida sobreimputación; dos OP sobre la misma factura confirman las dos.~~ **Hecho (T0-B):** `op_validar_imputaciones` al crear (cuenta otras OP pendientes) y al confirmar (`op_confirmar` v6, migración `20261116q`): error claro en vez de absorber. | C |
| ~~E-55~~ | ~~Pago parcial marca el vencimiento entero como pagado (no hay saldo en el vencimiento).~~ **Hecho (T1-D):** importe editable por comprobante y por vencimiento en la Nueva OP. Pago parcial ⇒ el vencimiento sigue pendiente y su importe pasa a ser lo que falta (`monto_original` / `monto_pagado`); al completarse vuelve al importe original y queda pagado; anular devuelve todo. Migración `20261117p_ordenes_pago_t1d.sql` (`op_confirmar` v7, `op_anular` v4). El calendario no se tocó: lee `monto` como siempre. | C |
| ~~E-56~~ | ~~Dos fuentes de saldo (`comprobantes_compra.saldo_pendiente` e `imputaciones_proveedores`) que divergen; las NC quedan pendientes para siempre.~~ **Hecho (T1-D):** la fuente es la cuenta corriente. Las NC descontadas en una orden quedan asentadas ahí y `comprobantes_compra.saldo_pendiente` es una copia que se relee al confirmar y al anular. Migración `20261117p_ordenes_pago_t1d.sql` (trae `cc_proveedor_resincronizar_saldos()` para emparejar comprobantes viejos; no se ejecuta sola). | C |
| ~~E-57~~ | ~~Ganancias: acumulado mensual con fechas cruzadas (fecha OP vs fecha de confirmación).~~ **Hecho (T1-D):** manda la FECHA DE CONFIRMACIÓN (Juan, 17/11): el acumulado del mes, lo ya retenido, el certificado y el período de SICORE se cuentan por el día en que se confirma (`ordenes_pago.fecha_confirmacion`). Una orden pendiente se arma con la retención de ese día y se recalcula al confirmar: si cambió, la pantalla muestra la retención nueva antes de aceptar y ajusta la diferencia en la transferencia o el efectivo. | C |
| ~~E-58~~ | ~~Comprobante sin OC: base de retención 0.~~ **Hecho (T1-D):** una factura fiscal sin neto cargado ya no da base 0: se estima (imputado ÷ 1,21) y la pantalla avisa que es estimada (`op_ganancias_bases` v7, `20261117p_ordenes_pago_t1d.sql`). | C |
| ~~E-59~~ | ~~Valores de retención a confirmar con el contador (mínimo transporte, código de régimen, condición del proveedor). Sin pantalla de edición.~~ **Pantalla hecha (T1-D):** Ajustes → Retención de Ganancias (solo admin): ver y cambiar alícuotas, mínimo no sujeto y retención mínima de cada régimen, con vigencia desde una fecha e historial. No se cambió ningún valor: el mínimo de transporte (6.700) sigue pendiente de confirmar con el contador. | C |
| ~~E-60~~ | ~~IIBB / IVA / SUSS fijos en 0: no hay motor.~~ **Cerrado sin motor (Juan, 16/11: solo Ganancias).** T1-D: la ruta de órdenes de pago ya no acepta IIBB / IVA / SUSS (van siempre en 0); la pantalla no los muestra. | C |
| ~~E-61~~ | `op_eliminar` borra certificados y reutiliza números sin mirar si el período ya se presentó. ~~No hay botón "Anular".~~ (T0-B agregó el botón Anular con confirmación; lo del período presentado sigue pendiente.) **Hecho (T1-D):** cada descarga del TXT de SICORE queda anotada (`retenciones_exportaciones`) y `op_eliminar` se niega si el certificado es de un período ya exportado: hay que anular (`20261117p_ordenes_pago_t1d.sql`). | C |
| ~~E-62~~ | ~~Cheque propio: no baja el banco, banco en texto libre, no se puede marcar e-cheq desde la OP, valores por defecto `S/D`.~~ **Hecho (T1-D):** cheque propio y e-cheq en la Nueva OP con cuenta bancaria real (`cuentas_bancarias`), número, fecha de pago y marca e-cheq; sugerencia de cuánto y con qué fecha según el plazo de cheques del acuerdo; al debitarse baja el saldo del banco (`cheque_propio_debitar`). Migración `20261117p_ordenes_pago_t1d.sql`. Pendiente: no se puede anular una orden cuyo cheque propio ya se debitó sin revisar el débito a mano. | C |
| ~~E-63~~ | "Marcar pagado sin OP": sin cuenta corriente, kardex ni retención (es lo que se usa hoy a diario). **Hecho (T1-D):** el atajo no se sacó. En el calendario, al elegir vencimientos de un mismo proveedor aparece "Pagar" (abre la orden de pago con todos tildados; solo admin) arriba de "Marcar como pagados"; el aviso del atajo ofrece "Pagar con orden de pago". En el formulario del vencimiento, "Pagar". Quedan `confirm()` nativos en la lista de vencimientos y en el formulario (no se tocaron). | C, B |
| ~~E-64~~ | ~~Pantalla y acciones viejas vivas: `/finanzas/proveedores/pagos`, `imputar-pago`.~~ **Hecho (T0-B):** la pantalla redirige a `/ordenes-pago`, `imputar-pago` responde 410, `crearPagoProveedor` ya no mueve plata y la RPC vieja queda sin permiso de ejecución (`20261116q`). | C |
| ~~E-65~~ | ~~Endpoints de OP y reportes de Playroom sin control de rol.~~ **Hecho (T0-B):** permisos `ordenes_pago` y `ordenes_pago_confirmar` (solo admin: Juan, 16/11, "administrativo no arma ni ejecuta pagos") y `reportes_playroom` (admin y administrativo, confirmado por Juan el 16/11) en `lib/auth.ts`. | C |
| ~~E-66~~ | ~~OP pendiente no reserva el cheque de tercero.~~ **Hecho (T1-D):** una orden pendiente reserva los cheques de tercero que eligió: `op_crear` rechaza usarlos en otra orden y la pantalla los muestra "reservado por la OP N°" (`20261117p_ordenes_pago_t1d.sql`). | C |
| ~~E-67~~ | ~~Dos pasos (crear y confirmar), sin pago parcial por comprobante, sin CBU/alias del proveedor a la vista.~~ **Hecho (T1-D):** "Pagar ahora" crea y confirma en una transacción (`op_crear_y_confirmar`, migración `20261117p_ordenes_pago_t1d.sql`) o "Dejar pendiente"; tarjeta "Cómo le pagamos" con acuerdo blanco/negro, CBU, alias, titular y si acepta cheques de terceros / e-cheq (columnas nuevas en `proveedores`, editables en la ficha fiscal); al terminar, detalle del pago listo para copiar. El pago parcial por comprobante va con E-55. | C |
| ~~E-68~~ | ~~Cuenta corriente del proveedor: sin saldo corrido, sin filtros, sin export, sin enlace a OP/certificado; retenciones sueltas.~~ **Hecho (T1-D):** pantalla nueva: saldo y cómo se compone, comprobantes sin pagar para tildar y pagar, créditos sin usar, extracto cronológico con saldo corrido y filtro por fecha (cada orden de pago en una fila con medios y retención, enlaces al PDF, al certificado y a la OC), NC esperadas a la vista, exportar a Excel y PDF. | C |
| E-69 | Proyección de caja usa vencimientos brutos (sin retenciones ni saldo inicial). | C |
| E-70 | Bancos: solo lectura de Mercado Pago. Sin emisión de transferencias ni e-cheq; Provincia y MP sin CBU. | C, B |
| E-71 | No hay vista "efectivo a separar" ni "cheques propios a hacer". | C |
| ~~E-72~~ | ~~(hallazgo T0-B) `op_ganancias_bases` corta con `record "v_comp" is not assigned yet` cuando una imputación no tiene comprobante (vencimiento cargado a mano, provisión): no se podía calcular la retención ni crear la OP.~~ **Hecho (T0-B):** v5 en `20261116p` (v4 con una sentencia cambiada; no cambia el cálculo). Visto en una base local de prueba; sin verificar contra producción. | C |
| ~~E-73~~ | ~~(hallazgo T0-B) `op_confirmar` no exige estado `pendiente`: una OP `cancelada` se puede confirmar llamando a la ruta. `op_confirmar`, `op_anular` y `op_eliminar` eran ejecutables por cualquier usuario logueado.~~ **Hecho (T0-B):** chequeo de estado al entrar en `op_confirmar` v6 y permisos solo `service_role` (`20261116q`). Control de datos viejos de E-52: `scripts/control-e52-saldos-sin-imputacion.sql` (solo lectura). | C |
| ~~E-74~~ | ~~(decisión de Juan, 16/11) Pagar un vencimiento cargado a mano nunca retenía (base 0) y no había forma de marcar un proveedor exento.~~ **Hecho (T0-B):** la Nueva OP pregunta en cada vencimiento sin comprobante "¿Corresponde retener Ganancias?" (Sí/No, obligatorio; canal negro no pregunta). Con Sí, el importe pagado es la base con las reglas del motor y sale certificado. Proveedor exento (`condicion_ganancias = exento` + `ganancias_exento_hasta`, en la ficha fiscal): no retiene y la OP muestra un cartel rojo fijo; vencido, avisa y vuelve a retener. Todo en `20261116p`. **Base (Juan, 17/11):** el importe pagado ÷ 1,21 (neto sin IVA), migración `20261117a_op_ganancias_bases_neto.sql`; la pantalla muestra la cuenta. | C |

### E. Reportes, Jarvis, IA

| id | Problema | Verif. |
|---|---|---|
| E-80 | Jarvis no lee compras, recepciones, cuenta corriente de proveedores, retenciones ni NC esperadas. | C |
| E-81 | No hay reportes de compras. El reporte de IVA no resta NC ni filtra estados. | C |
| E-82 | Modelos viejos: `claude-sonnet-4-6` (mails, Excel), `claude-haiku-4-5`, `claude-opus-4-8`; Gemini 2.5 en 4 lugares. | C |
| E-83 | Jarvis: deuda a proveedores calculada distinto según la tool; no hay período "últimos 12 meses"; tabla de precios sin `claude-fable-5-2`. | C |

### F. Prueba en pantalla del 17/11 (producción + NuStar, OC-000011 de prueba)

Probado OK en pantalla: E-02 (sugerencia en bultos), E-30/E-40 (2 bultos × 24 → +48 al stock, una vez), E-32 (validar bloquea renglones sin vincular; una sola deuda y un solo vencimiento), E-09 (estado `finalizada`), E-37 (OCR caído → documento "no leído", sin comprobante vacío), remito sin botón Validar ("Remito: controla cantidades"), retención en vencimiento a mano (pregunta Sí/No, base ÷ 1,21).

| id | Problema visto en pantalla | Tanda |
|---|---|---|
| E-90 | **Resolver un faltante contra el proveedor resta stock que nunca entró**: recibidos 150 (stock 228), al resolver "Proveedor" por las 50 u facturadas de más el stock bajó a 178. | T1-B (urgente) |
| E-91 | **NC esperada mal calculada**: usa precio de lista sin el descuento y sin IVA. Diferencia de precio real (1.450,00 − 1.415,05) × 48 = $1.677,60 neto; generó $2.097,12 = (1.812,50 − 1.768,81) × 48. Faltante 50 u × $556,83 = $27.841,50 neto; generó $34.802,00 = 50 × 696,04. | T1-B (urgente) |
| E-92 | Un faltante figura como OK: recibido 3 de 4 bultos → verificación "OK" + cartel chico "Incompleto", "Artículos OK 2/2", OC `recibida_completa`, línea verde en la app. | T1-B / T1-C |
| E-93 | App: Finalizar no pide confirmación ni muestra resumen aunque falte mercadería. Tocar un renglón no deja cargar cantidad (hay que ir a Buscar artículo). | T1-C |
| E-94 | "Resolver diferencia" abre siempre en "mercadería" aunque la diferencia sea de precio, no muestra los precios ni el importe de la diferencia ni el impacto. | T1-B |
| E-95 | Quedan `confirm()` nativos en verificación (eliminar comprobante, validar, finalizar). El error del OCR se muestra crudo en inglés y desaparece al recargar (el documento "no leído" no queda a la vista). | T1-B |
| E-96 | Lentitud: listado de OC ~7 s en blanco, verificación 12–35 s ("Ya casi está…"). | T1-A / T1-B |
| E-97 | Tras eliminar un comprobante queda el aviso "2 ítems sin vincular". Columnas de NC esperada con encabezado `ESPERADA-1794…`. "Total facturado" resta NC sin IVA. Total OC $179.288,70 al crear vs $179.288,40 en verificación. Subtítulo "HO — Triple verificación". | T1-B |
| E-98 | Kardex de compra sin `precio_costo` y `ultimo_costo` en 0 después de validar; quedan kardex `compra` pendientes con fecha futura (fecha estimada) además del de la recepción. | T1-B |
| E-99 | El vencimiento que nace al validar no tiene forma de pago si el proveedor no tiene acuerdo cargado. Una OC finalizada queda sin acceso a la verificación. En Nueva OP dos vencimientos del mismo día e importe se ven idénticos (no muestra forma de pago). **T1-D hecho:** la Nueva OP muestra en cada vencimiento la forma de pago, modalidad, validez del cheque, canal y observaciones. | T1-A / T1-D |
| E-100 | Una leyenda como "sin valor fiscal" en la factura hace que el OCR la clasifique como Adquisición (negro) y no lea neto/IVA. Pedir confirmación del tipo cuando hay CUIT + CAE + letra. | T2-B |
| E-101 | Gemini sin crédito el 17/11 (402): OCR caído sin que nadie se entere. Falta un vigía/alerta de saldo o de fallas de OCR. | T2-B |

Datos de prueba que quedaron: OC-000011, FA 0003-00045678 (validada), 2 NC esperadas, **vencimiento HORNAL $218.969,34 al 17/12/2026 (de prueba, en el calendario real)**, stock 190039 = 178 (debería ser 228).

## Plan por tandas

**Tanda 0 — frenar daños (solo código, sin decisiones de negocio).** Dos agentes en paralelo, archivos disjuntos.
- ~~T0-A Compras/recepción: E-01, E-02, E-09 (CHECK), E-13, E-30, E-32, E-35, E-36 (dedupe), E-37, E-40, E-41.~~ **Hecho 16/11, rama `entrada-t0a-compras-recepcion`** (ver "Tanda 0-A" abajo).
- ~~T0-B Pagos: E-50, E-51, E-52, E-53, E-54, E-64, E-65.~~ Hecho en la rama `entrada-t0b-ordenes-pago` (16/11). Migraciones a aplicar, en orden: `20261116p_op_crear.sql` y `20261116q_op_confirmar_v6.sql`. **Aplicarlas ANTES del merge**: sin `op_crear` la pantalla no deja crear órdenes de pago (avisa que falta la migración); las dos son compatibles con el código viejo.

**Tanda 1 — el circuito completo como tiene que ser.**
- T1-A OC: función SQL crear/editar (E-07, E-08), condición de pago y vencimiento estimado (E-04, E-05, E-06), estados y cancelar (E-09), envío por Gmail con PDF (E-03), diálogo nuevo (E-10, E-12, E-14, E-15), historial de costo (E-11, E-21).
- T1-B Recepción + diferencias: recepción parcial (E-39), verificación nueva con foto al lado y resolución atómica por destino (E-31, E-33, E-34, E-42..E-46), costo al confirmar (E-23), limpieza (E-47).
- T1-C App Depósito: unidad clara, fotos multipágina/PDF/offline/comprimidas, mostrar lo leído (E-38).
- T1-D Pagos: OP en un paso, pago parcial, saldo único (E-55, E-56), retenciones (E-57, E-58, E-61), cheque propio/e-cheq (E-62), reserva de cheque (E-66), ficha de pago a la vista (E-67), cuenta corriente clara (E-68).

**Tanda 2 — ayuda para decidir.**
- T2-A Tesorería: agenda de pagos de la semana (qué banco, qué cheques, efectivo a separar, cheques propios a hacer), proyección de caja real (E-69, E-71), archivo de lote de transferencias/e-cheq (E-70), pagar un vencimiento = OP (E-63).
- T2-B Jarvis + reportes de compras (E-80, E-81, E-83) y modelos de IA (E-82).
- T2-C Precios de compra: listas con vigencia e historial (E-20, E-22).

**Pendiente de Juan / contador:** E-59, E-60, E-70 (qué permite cada banco), datos de proveedores (mail, CBU, acuerdo de pago), limpieza de datos de prueba de compras, corrección del stock de OC-000010.

## Tanda 0-A — hecho el 16/11 (rama `entrada-t0a-compras-recepcion`)

**Migraciones (escritas, SIN aplicar; se pueden correr en cualquier orden y más de una vez; ninguna toca datos):**

| Archivo | Qué agrega | Sin aplicarla |
|---|---|---|
| `20261116a_recepcion_unidades.sql` | `recepciones_items.unidad_conteo` + rastro de lo sumado, función `recepcion_aplicar_stock(recepcion)` (lee las unidades por bulto de la base) | El stock igual sube en unidades (regla en el código); la suma sigue siendo "leer y escribir" y la app nueva no puede contar "en otra unidad" que la de la OC |
| `20261116b_ordenes_compra_estados.sql` | CHECK de `ordenes_compra.estado` con `enviada, confirmada, en_camino, finalizada` | "Finalizar OC" valida los comprobantes y avisa en pantalla que la orden no pasó a finalizada (antes fallaba callado) |
| `20261116c_comprobante_compra_validar.sql` | función `comprobante_compra_validar` (todo o nada) | Validar aplica las mismas reglas paso a paso, con el cambio de estado como compuerta |

El merge NO depende de ninguna: el código detecta si están y, si no, sigue por el camino anterior ya corregido.

**Regla de unidades (E-30), para todo lo que venga después:** `lib/deposito/unidades.ts` es la única fuente. `cantidad_oc` va en la unidad de la línea de la OC (`tipo_cantidad`, vacío = bulto), `cantidad_fisica` en `unidad_conteo` (vacío = la de la OC; fuera de OC = unidad), `cantidad_documentada` y todo lo que toca stock/kardex en unidades base. La verificación compara las tres en unidades y precio neto por unidad.

**Encontrado de paso (no estaba en el relevamiento):**

- `validar` escribía `validado_por` / `validado_at`, que no figuran en ningún script ni migración (la tabla tiene `usuario_validador` / `fecha_validacion`), y no miraba el error. Si esas columnas no existen, el comprobante **nunca pasaba a "validado"** y cada click generaba otra deuda y otro vencimiento: explicaría que los 13 comprobantes sigan en `pendiente_recepcion`. Ahora se usan las columnas originales y el estado cambia aunque falle el dato de auditoría. **Verificar en la base** (`select column_name from information_schema.columns where table_name = 'comprobantes_compra'`).
- Una recepción creada por la oficina al subir la factura queda en `borrador`; `finalizarRecepcion` solo aceptaba `en_proceso` y desde depósito quedaba reintentando "otro equipo está finalizando" para siempre. Ahora acepta las dos.
- La factura que entra por mail (`lib/ai/email-invoice-processor.ts`) convierte la provisión de la OC en "factura" y crea su vencimiento; al validar después ese comprobante se generaba un segundo movimiento y un segundo vencimiento. Ahora validar adopta ese movimiento. El procesador de mails en sí no se tocó (usa otra fuente de plazo: E-06).
- ~~`app/api/comprobantes-compra/[id]/lineas` (renglón agregado a mano) sumaba `cantidad_documentada` sin convertir a unidades.~~ Corregido en la revisión.
- ~~Comprobante SIN orden de compra: validar no generaba movimiento en la cuenta corriente.~~ Decidido por Juan el 16/11: **sí genera la deuda** (hecho en la revisión).
- No se puede "des-validar" un comprobante (el mensaje al borrar un documento validado lo sugiere, pero no existe). T1-B.
- Quedan `confirm()` nativos en verificación y comprobantes (E-44) y `alert()` en `app/ordenes-compra/page.tsx` (E-12): solo se pasaron a avisos del sistema los de las funciones que se tocaron.

### Revisión del 16/11 (arreglos pedidos por el orquestador + respuestas de Juan)

- **`cerrar` en unidades** (regresión): la diferencia llega en unidades y los precios se llevan a precio por unidad (`precio_documentado` ÷ `factor_conversion`); 1 bulto de 24 u a $2.400 da $2.400. El costo que se guarda al "absorber" una diferencia de precio es por unidad. `valor_real` ya no se usa como precio (la pantalla manda ahí una cantidad).
- **Una sola convención en `comprobantes_compra_detalle`**: `cantidad_facturada` y `precio_unitario` tal cual la factura; `tipo_cantidad = 'bulto'` solo si esa cantidad son bultos. La cumplen el OCR, el mail, el vínculo a mano y el renglón agregado a mano; quien lee convierte con el factor de la línea de recepción.
- **Validar lo que entró por mail**: el mail ahora deja el movimiento de cuenta corriente vinculado al comprobante. Para lo anterior, `buscarMovimientoPrevio` adopta por número normalizado o, sin número, por único candidato de la orden con el mismo importe; si es ambiguo **frena** con un mensaje (no duplica). Los vencimientos que ya existen no se modifican: si el importe no coincide, avisa.
- **Todo o nada en los dos caminos**: si no se puede crear el vencimiento no se valida nada (con la función SQL, por la transacción; sin ella, se deshace lo hecho) y el mensaje sale en español.
- **Dos comprobantes sin número** con distinto total o fecha ya no se funden en un solo provisorio.
- **Duplicados**: la letra es parte del tipo (FA 1-123 y FB 1-123 son distintas); se filtra en la consulta.
- **Migración pendiente**: se cae al camino anterior solo si la función que falta es exactamente la esperada (`lib/utils/migracion-pendiente.ts`); un error de red ya no se toma como "no hay columnas".
- **`recepcion_aplicar_stock(recepcion)`** ya no recibe factores: lee `unidades_por_bulto` y la unidad de la base. Sin permiso para usuarios: la llama el servidor con el cliente de servicio.
- **Juan (1)**: un comprobante sin orden de compra también genera deuda en la cuenta corriente al validarse. Sin proveedor no se valida.
- **Juan (2)**: artículo por bulto sin unidades por bulto: no se bloquea nada, solo se avisa.
- **Juan (3)**: el renglón de flete u otro concepto **no se borra**: se marca "No es mercadería" (`match_estado = 'no_mercaderia'`), queda discriminado en la verificación ("Otros conceptos facturados") y la deuda es siempre el **total** del comprobante ($100 + 21 % + 3 % de flete = $124).
- **Juan (5)**: la APK de Depósito se publica antes de la próxima prueba (PENDIENTES-APPS R1).
- Visto y no tocado: `lib/ai/email-invoice-processor.ts` mapea a tipos `ADQ` / `REV`, que el CHECK de `comprobantes_compra.tipo_comprobante` no acepta (`Adquisicion` / `Reversa`): esas facturas por mail no crean comprobante. Para T1.
