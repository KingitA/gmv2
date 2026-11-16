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
| E-50 | `ordenes_pago.monto_total` suma las retenciones dos veces. | C |
| E-51 | Crear OP no es transaccional: puede quedar sin medios o sin imputaciones y devolver éxito. | C |
| E-52 | Imputar por vencimiento no baja la factura en cuenta corriente: queda pagable otra vez; doble imputación posible. | C |
| E-53 | "Generar OP" desde el calendario no preselecciona nada. | C |
| E-54 | No se valida sobreimputación; dos OP sobre la misma factura confirman las dos. | C |
| E-55 | Pago parcial marca el vencimiento entero como pagado (no hay saldo en el vencimiento). | C |
| E-56 | Dos fuentes de saldo (`comprobantes_compra.saldo_pendiente` e `imputaciones_proveedores`) que divergen; las NC quedan pendientes para siempre. | C |
| E-57 | Ganancias: acumulado mensual con fechas cruzadas (fecha OP vs fecha de confirmación). | C |
| E-58 | Comprobante sin OC: base de retención 0. | C |
| E-59 | Valores de retención a confirmar con el contador (mínimo transporte, código de régimen, condición del proveedor). Sin pantalla de edición. | C |
| E-60 | IIBB / IVA / SUSS fijos en 0: no hay motor. | C |
| E-61 | `op_eliminar` borra certificados y reutiliza números sin mirar si el período ya se presentó. No hay botón "Anular". | C |
| E-62 | Cheque propio: no baja el banco, banco en texto libre, no se puede marcar e-cheq desde la OP, valores por defecto `S/D`. | C |
| E-63 | "Marcar pagado sin OP": sin cuenta corriente, kardex ni retención (es lo que se usa hoy a diario). | C, B |
| E-64 | Pantalla y acciones viejas vivas: `/finanzas/proveedores/pagos`, `imputar-pago`. | C |
| E-65 | Endpoints de OP y reportes de Playroom sin control de rol. | C |
| E-66 | OP pendiente no reserva el cheque de tercero. | C |
| E-67 | Dos pasos (crear y confirmar), sin pago parcial por comprobante, sin CBU/alias del proveedor a la vista. | C |
| E-68 | Cuenta corriente del proveedor: sin saldo corrido, sin filtros, sin export, sin enlace a OP/certificado; retenciones sueltas. | C |
| E-69 | Proyección de caja usa vencimientos brutos (sin retenciones ni saldo inicial). | C |
| E-70 | Bancos: solo lectura de Mercado Pago. Sin emisión de transferencias ni e-cheq; Provincia y MP sin CBU. | C, B |
| E-71 | No hay vista "efectivo a separar" ni "cheques propios a hacer". | C |

### E. Reportes, Jarvis, IA

| id | Problema | Verif. |
|---|---|---|
| E-80 | Jarvis no lee compras, recepciones, cuenta corriente de proveedores, retenciones ni NC esperadas. | C |
| E-81 | No hay reportes de compras. El reporte de IVA no resta NC ni filtra estados. | C |
| E-82 | Modelos viejos: `claude-sonnet-4-6` (mails, Excel), `claude-haiku-4-5`, `claude-opus-4-8`; Gemini 2.5 en 4 lugares. | C |
| E-83 | Jarvis: deuda a proveedores calculada distinto según la tool; no hay período "últimos 12 meses"; tabla de precios sin `claude-fable-5-2`. | C |

## Plan por tandas

**Tanda 0 — frenar daños (solo código, sin decisiones de negocio).** Dos agentes en paralelo, archivos disjuntos.
- ~~T0-A Compras/recepción: E-01, E-02, E-09 (CHECK), E-13, E-30, E-32, E-35, E-36 (dedupe), E-37, E-40, E-41.~~ **Hecho 16/11, rama `entrada-t0a-compras-recepcion`** (ver "Tanda 0-A" abajo).
- T0-B Pagos: E-50, E-51, E-52, E-53, E-54, E-64, E-65.

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
| `20261116a_recepcion_unidades.sql` | `recepciones_items.unidad_conteo` + rastro de lo sumado, función `recepcion_aplicar_stock` | El stock igual sube en unidades (regla en el código); la suma sigue siendo "leer y escribir" y la app nueva no puede contar "en otra unidad" que la de la OC |
| `20261116b_ordenes_compra_estados.sql` | CHECK de `ordenes_compra.estado` con `enviada, confirmada, en_camino, finalizada` | "Finalizar OC" valida los comprobantes y avisa en pantalla que la orden no pasó a finalizada (antes fallaba callado) |
| `20261116c_comprobante_compra_validar.sql` | función `comprobante_compra_validar` (todo o nada) | Validar aplica las mismas reglas paso a paso, con el cambio de estado como compuerta |

El merge NO depende de ninguna: el código detecta si están y, si no, sigue por el camino anterior ya corregido.

**Regla de unidades (E-30), para todo lo que venga después:** `lib/deposito/unidades.ts` es la única fuente. `cantidad_oc` va en la unidad de la línea de la OC (`tipo_cantidad`, vacío = bulto), `cantidad_fisica` en `unidad_conteo` (vacío = la de la OC; fuera de OC = unidad), `cantidad_documentada` y todo lo que toca stock/kardex en unidades base. La verificación compara las tres en unidades y precio neto por unidad.

**Encontrado de paso (no estaba en el relevamiento):**

- `validar` escribía `validado_por` / `validado_at`, que no figuran en ningún script ni migración (la tabla tiene `usuario_validador` / `fecha_validacion`), y no miraba el error. Si esas columnas no existen, el comprobante **nunca pasaba a "validado"** y cada click generaba otra deuda y otro vencimiento: explicaría que los 13 comprobantes sigan en `pendiente_recepcion`. Ahora se usan las columnas originales y el estado cambia aunque falle el dato de auditoría. **Verificar en la base** (`select column_name from information_schema.columns where table_name = 'comprobantes_compra'`).
- Una recepción creada por la oficina al subir la factura queda en `borrador`; `finalizarRecepcion` solo aceptaba `en_proceso` y desde depósito quedaba reintentando "otro equipo está finalizando" para siempre. Ahora acepta las dos.
- La factura que entra por mail (`lib/ai/email-invoice-processor.ts`) convierte la provisión de la OC en "factura" y crea su vencimiento; al validar después ese comprobante se generaba un segundo movimiento y un segundo vencimiento. Ahora validar adopta ese movimiento. El procesador de mails en sí no se tocó (usa otra fuente de plazo: E-06).
- `app/api/comprobantes-compra/[id]/lineas` (renglón agregado a mano) suma `cantidad_documentada` sin convertir a unidades. La verificación ya no depende de ese campo (compara por el detalle del comprobante), pero conviene unificarlo en T1-B.
- Comprobante SIN orden de compra: validar no genera movimiento en la cuenta corriente (solo el vencimiento). Se dejó igual; decidir en T1-D (E-58).
- No se puede "des-validar" un comprobante (el mensaje al borrar un documento validado lo sugiere, pero no existe). T1-B.
- Quedan `confirm()` nativos en verificación y comprobantes (E-44) y `alert()` en `app/ordenes-compra/page.tsx` (E-12): solo se pasaron a avisos del sistema los de las funciones que se tocaron.
