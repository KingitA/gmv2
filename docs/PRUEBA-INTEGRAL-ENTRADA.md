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

## Problemas

### A. Orden de compra

| id | Problema | Verif. |
|---|---|---|
| E-01 | Pantalla vieja `app/ordenes-compra/[id]/articulos` suma stock (`incrementar_stock`) en cada guardado y borra el detalle. Se entra desde la cuenta corriente del proveedor. | C |
| E-02 | "Usar sugerencia" copia unidades como bultos (pide N bultos en vez de N unidades). | C |
| E-03 | No existe el envío por mail. PDF/Excel solo descargan; el ícono es "Send". | C |
| E-04 | La OC no tiene condición de pago (columnas existen, nadie las escribe); no se ve en el PDF. | C, B |
| E-05 | La OC no genera vencimientos; nacen recién al validar la factura. | C, B |
| E-06 | Tres fuentes de plazo distintas: `pago_blanco_*`/`dias_vencimiento` (validar), `plazo_dias`/`plazo_desde` (mail), ficha (`plazo_dias`). | C |
| E-07 | Crear/editar OC sin transacción; numeración con carrera; editar reescribe la provisión sin impuestos y no actualiza el kardex pendiente. | C |
| E-08 | Provisión mal calculada: IVA fijo 21 %, suma el % de retención de Ganancias como deuda. | C |
| E-09 | Estados `enviada`, `confirmada`, `en_camino`, `cancelada`, `finalizada` no se escriben o los rechaza el CHECK. No hay cancelar (solo borrar). | C, B |
| E-10 | Fecha estimada de entrega usa días de pago; RPC `calcular_avg_dias_recepcion` no existe; no se edita. | C, B |
| E-11 | Crear la OC pisa `articulos.precio_compra` y descuentos sin historial. | C |
| E-12 | Diálogo de OC: muestra todo el catálogo sin stock ni venta; sin total, sin guardar-en-curso, doble click crea dos; listado sin total/fecha/creador; `select *` pesado. | C |
| E-13 | OC de faltantes e importación desde archivo asumen 1 unidad por bulto; ítems sin artículo llegan al insert. | C |
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
| E-30 | **Bultos vs unidades**: la OC va en bultos, la app muestra "u" y el stock suma lo contado tal cual. | C, B |
| E-31 | Kardex `compra` duplicado: el pendiente de la OC se confirma al validar y además queda el de la recepción. | C |
| E-32 | `validar` sin control de estado ni transacción: doble click = doble deuda y doble vencimiento; valida remitos en $0; no bloquea líneas sin match; el primer comprobante borra toda la provisión. | C |
| E-33 | `cerrar` (resolver diferencia) no es idempotente; "proveedor" resta stock que nunca entró; sobrante tratado como faltante; NC esperada sin IVA; precio neto comparado con lista. | C |
| E-34 | "Empresa absorbe" guarda el neto en `precio_compra` (lista): descuento aplicado dos veces. | C |
| E-35 | Nota de débito se registra como nota de crédito. | C |
| E-36 | Duplicados de comprobante: sin número cada foto crea otro `PENDIENTE-…`; factura de 3 hojas = 3 comprobantes; la misma factura en dos OC. | C, B |
| E-37 | OCR: modelo escrito a mano (`gemini-2.5-flash`) en 4 archivos sin respaldo; si falla crea un comprobante vacío marcado como procesado. | C |
| E-38 | App: una foto por vez, sin PDF, sin offline, el operario no ve lo leído, no comprime (límite 4,5 MB). | C |
| E-39 | No hay recepción parcial real (segunda tanda nunca se abre); finalizar cierra la OC. | C, B |
| E-40 | Stock sin atomicidad en `finalizarRecepcion` (lee y escribe). | C |
| E-41 | Borrar el último documento pone en 0 lo documentado, incluso lo cargado a mano. | C |
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
| E-55 | Pago parcial marca el vencimiento entero como pagado (no hay saldo en el vencimiento). | C |
| E-56 | Dos fuentes de saldo (`comprobantes_compra.saldo_pendiente` e `imputaciones_proveedores`) que divergen; las NC quedan pendientes para siempre. | C |
| E-57 | Ganancias: acumulado mensual con fechas cruzadas (fecha OP vs fecha de confirmación). | C |
| E-58 | Comprobante sin OC: base de retención 0. | C |
| E-59 | Valores de retención a confirmar con el contador (mínimo transporte, código de régimen, condición del proveedor). Sin pantalla de edición. | C |
| E-60 | IIBB / IVA / SUSS fijos en 0: no hay motor. | C |
| E-61 | `op_eliminar` borra certificados y reutiliza números sin mirar si el período ya se presentó. ~~No hay botón "Anular".~~ (T0-B agregó el botón Anular con confirmación; lo del período presentado sigue pendiente.) | C |
| E-62 | Cheque propio: no baja el banco, banco en texto libre, no se puede marcar e-cheq desde la OP, valores por defecto `S/D`. | C |
| E-63 | "Marcar pagado sin OP": sin cuenta corriente, kardex ni retención (es lo que se usa hoy a diario). | C, B |
| ~~E-64~~ | ~~Pantalla y acciones viejas vivas: `/finanzas/proveedores/pagos`, `imputar-pago`.~~ **Hecho (T0-B):** la pantalla redirige a `/ordenes-pago`, `imputar-pago` responde 410, `crearPagoProveedor` ya no mueve plata y la RPC vieja queda sin permiso de ejecución (`20261116q`). | C |
| ~~E-65~~ | ~~Endpoints de OP y reportes de Playroom sin control de rol.~~ **Hecho (T0-B):** permisos `ordenes_pago` y `ordenes_pago_confirmar` (solo admin: Juan, 16/11, "administrativo no arma ni ejecuta pagos") y `reportes_playroom` (admin y administrativo, confirmado por Juan el 16/11) en `lib/auth.ts`. | C |
| E-66 | OP pendiente no reserva el cheque de tercero. | C |
| E-67 | Dos pasos (crear y confirmar), sin pago parcial por comprobante, sin CBU/alias del proveedor a la vista. | C |
| E-68 | Cuenta corriente del proveedor: sin saldo corrido, sin filtros, sin export, sin enlace a OP/certificado; retenciones sueltas. | C |
| E-69 | Proyección de caja usa vencimientos brutos (sin retenciones ni saldo inicial). | C |
| E-70 | Bancos: solo lectura de Mercado Pago. Sin emisión de transferencias ni e-cheq; Provincia y MP sin CBU. | C, B |
| E-71 | No hay vista "efectivo a separar" ni "cheques propios a hacer". | C |
| ~~E-72~~ | ~~(hallazgo T0-B) `op_ganancias_bases` corta con `record "v_comp" is not assigned yet` cuando una imputación no tiene comprobante (vencimiento cargado a mano, provisión): no se podía calcular la retención ni crear la OP.~~ **Hecho (T0-B):** v5 en `20261116p` (v4 con una sentencia cambiada; no cambia el cálculo). Visto en una base local de prueba; sin verificar contra producción. | C |
| E-73 | (hallazgo T0-B, sin tocar) `op_confirmar` no exige estado `pendiente`: una OP `cancelada` se puede confirmar llamando a la ruta. `op_confirmar`, `op_anular` y `op_eliminar` eran ejecutables por cualquier usuario logueado (esto último sí queda cerrado en `20261116q`). | C |

### E. Reportes, Jarvis, IA

| id | Problema | Verif. |
|---|---|---|
| E-80 | Jarvis no lee compras, recepciones, cuenta corriente de proveedores, retenciones ni NC esperadas. | C |
| E-81 | No hay reportes de compras. El reporte de IVA no resta NC ni filtra estados. | C |
| E-82 | Modelos viejos: `claude-sonnet-4-6` (mails, Excel), `claude-haiku-4-5`, `claude-opus-4-8`; Gemini 2.5 en 4 lugares. | C |
| E-83 | Jarvis: deuda a proveedores calculada distinto según la tool; no hay período "últimos 12 meses"; tabla de precios sin `claude-fable-5-2`. | C |

## Plan por tandas

**Tanda 0 — frenar daños (solo código, sin decisiones de negocio).** Dos agentes en paralelo, archivos disjuntos.
- T0-A Compras/recepción: E-01, E-02, E-09 (CHECK), E-13, E-30, E-32, E-35, E-36 (dedupe), E-37, E-40, E-41.
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
