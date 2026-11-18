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
- **Mínimo no sujeto de Ganancias para transporte (17/11):** «Sí, estás en lo correcto, el mínimo es de 67.170» → migración `20261117r_retencion_transporte_minimo.sql`: fila nueva de transporte vigente desde el 01/11/2026 con mínimo $67.170 (alícuota 0,25 %, sin cambios); la de 6.700 queda cerrada el 31/10/2026. Mercadería no se toca (224.000, 2 %).
- **Qué espera del pago (17/11):** ver los vencimientos y, según el tipo: transferencia → de qué banco sale; cheque de tercero → que el sistema sugiera con cuál pagar según monto, fecha, color y condiciones del proveedor; cheque propio físico → cuánto y cuándo hay que hacerlo; e-cheq → como transferencia; efectivo → cuánto separar y para quién. Y la cuenta corriente del proveedor sencilla, con pagos, retenciones y comprobantes.

### Respuestas de Juan a las dudas de la Tanda 0-A (16/11, textuales)

7. **¿Un comprobante de proveedor sin orden de compra debe generar la deuda en cuenta corriente al validarse?** — «Si, debe crearla.» → **Hecho en `entrada-t0a-compras-recepcion`**: validar genera el movimiento de cuenta corriente con o sin OC; sin proveedor no valida.
8. **Artículo pedido por bulto sin unidades por bulto cargadas: ¿bloquear la OC o la recepción?** — «No, prefiero que no bloquee nada, a lo sumo nos daremos cuenta (en triple verificacion) cuando carguemos un articulo con precio unitario al mismo precio que el bulto, o en todo caso se actualizara el precio a precio unitario = precio de bulto. Pero dejalo asi, son cosas a tener en cuenta en el dia a dia del trabajador.» → **Queda como está**: se toma 1 unidad por bulto y se avisa en rojo (app y verificación). Nada para la Tanda 1.
9. **Renglón de factura que no es mercadería (flete): ¿alcanza con quitarlo para poder validar?** — «Mientras quede discriminado el renglon de flete o cual sea si, no hay problema. Lo que no puede pasar es una factura de $100 neto + 21% de iva +3% de flete, no puede cargarse como $121. debe ser $124. Si la unica solucion es discriminarlo, discriminalo.» → **Hecho en la rama**: el renglón no se borra, se marca "No es mercadería" (`match_estado = 'no_mercaderia'`), se ve en la verificación como "Otros conceptos facturados" y la deuda es siempre el total del comprobante ($124). **Para la Tanda 1 (T1-B):** que esos conceptos tengan destino contable propio (cuenta del transporte / gasto) y aparezcan en el PDF y en la cuenta corriente discriminados.
10. **¿Un remito debe poder validarse (sin deuda)?** — Primero: «No entiendo tu pregunta. A que llamar "validar"?». Aclarado, el 17/11: «No tiene sentido validar un remito, lo que buscamos con esta validación es que las cantidades y precios estén bien, un remito solo va a traer cantidades, y sin precio no deberíamos poder validar una orden de compra. Lo que sí podemos es validar cantidades, pero no nos debería permitir cerrar la OC.» → **Hecho en `entrada-t0a2-remito`**: el remito no tiene botón Validar y la ruta y la función lo rechazan (migración `20261117a_remito_no_se_valida.sql`, el merge no depende de ella); figura como "Remito: controla cantidades". "Finalizar OC" lo decide el servidor (`POST /api/ordenes-compra/[id]/finalizar`, regla en `lib/compras/finalizar-oc.ts`): hace falta al menos una factura o adquisición validada, ningún comprobante con precios / NC / ND sin validar, y que todo artículo recibido figure en una factura validada; con solo remitos la orden queda abierta y avisa "Falta la factura para controlar precios".
11. **Hasta instalar la APK nueva el operario tiene que contar en la unidad de la OC: ¿se publica antes de volver a recibir?** — «si, se publica apk nuevo antes de la proxima prueba» → **Código hecho en la rama, APK sin generar** (el encargo de la Tanda 0-A era no generarla). La publica el orquestador antes de la próxima prueba, con la migración `20261116a` aplicada (PENDIENTES-APPS R1).

### Decisiones de Juan sobre diferencias (17/11, textuales)

12. **Cargo al transporte: ¿con IVA o neto?** — «Respecto a lo del transporte sí, debe cobrarse todo, neto + impuestos» → **Hecho en `entrada-t1b-diferencias`**: el cargo al transporte va por el total con IVA.
13. **Tolerancia de precio y suma de renglones** — «Bien, siempre y cuando no afecte al total de la factura... por ejemplo, dos ítems de $10 cada uno deberían sumar $20. Si el subtotal es $21 hay un error, no hay problema con redondear centavos, el tema es que a través de este redondeo podemos llegar a tener diferencia entre la suma de los ítems y el total del comprobante.» → **Hecho en la rama**: (a) tolerancia de precio de 0,5 % por unidad con tope de $1.000 netos por línea (`TOLERANCIA_PRECIO` / `TOPE_DIFERENCIA_PESOS` en `lib/compras/diferencias.ts`); (b) regla dura E-46: los renglones (todos, también los "no es mercadería") tienen que sumar el neto del comprobante, y neto + IVA + percepciones + impuestos internos + otros impuestos el total (la retención de Ganancias no cuenta: no viene en la factura); solo se toleran centavos (diferencia menor a $1: `TOLERANCIA_SUMA_PESOS` en `lib/compras/control-suma.ts`). Si no cierra, la verificación lo muestra arriba en rojo con los dos números y el comprobante NO se puede validar (lo controla la ruta y la función SQL, migración `20261117d`); (c) ningún redondeo cambia la deuda: es siempre el total de la factura.
14. **Mercadería de más (sobrante)** — «En caso de que llegue mercadería de más debe aparecer un cartel para ver si se recibe y esperamos factura, o solo se recibe, ajusta stock pero no se paga de más. Esto para cuando envían mercadería bonificada.» → **Hecho en `entrada-t1b-diferencias`**: al resolver un sobrante la ventana pregunta, sin opción por defecto: (a) *Se recibe y esperamos la factura* → queda una nota de débito esperada (`comprobantes_compra` tipo ND, estado `esperada`, origen `sobrante`) por las unidades de más al precio neto de la orden + IVA, asociada a la factura; se ve en "Notas esperadas" y se quita cuando se carga la factura real; (b) *Se recibe sin cargo (bonificado)* → el stock queda como entró, sin deuda ni nota, y el `ultimo_costo` baja prorrateado (neto facturado × unidades pagadas ÷ unidades recibidas), sin tocar la lista; (c) *Se devuelve* → sale del stock. En los tres casos la deuda sigue siendo el total de la factura.
15. **Cómo se aplican los descuentos del proveedor** — «Lo aclara en la ficha del proveedor, hay dos opciones: En cascada / sobre precio lista.» → **Hecho en `entrada-t1b-diferencias`**: el neto de compra sale de una sola función, `netoCompra(lista, descuentos, tipo)` en `lib/compras/diferencias.ts`, que usa `proveedores.tipo_descuento` (`cascada`: uno sobre el otro; `sobre_lista`: se suman y se aplican sobre la lista; sin dato: cascada). La usan la verificación, las diferencias de precio, la regla de suma (también la función SQL de `20261117d`), el costo al validar y el kardex de la corrección de conteo. T1-A arma la misma función con la misma firma: se unifican al integrar. Fuera de esta rama (son de T1-A): el total de la orden al crearla y el PDF de la orden, que siguen en cascada.

### Respuestas de Juan a las dudas de la Tanda 1-A (17/11, textuales)

16. **¿La orden que recibe el proveedor separa lo que viene con y sin factura?** — «No, la orden de compra debe figurar un solo pedido, 10 en negro 5 en blanco, la orden de compra = 15. Si te referís a orden de pago sí, debe distinguir entre blanco y negro.» → **Hecho T1-A**: el PDF, el Excel y el mail al proveedor muestran un solo pedido (artículos, cantidades, precios) y un solo total sin impuestos, con una sola condición de pago. La separación blanco / negro queda interna: provisión en cuenta corriente, vencimientos estimados y nuestra pantalla.
17. **¿"Mixto" es mitad con factura y mitad sin?** — «Sí, la proporción varía según proveedor.» → **Hecho T1-A**: `proveedores.mixto_pct_factura` (% con factura; el resto sin), en la ficha, en el importador del Excel (columna opcional "Mixto: % con factura") y copiado a la orden (`ordenes_compra.mixto_pct_factura`, editable). Sin dato: 50 % y aviso.
18. **¿Hay proveedores cuyos descuentos se suman en vez de ir en cascada?** — «Lo aclara en la ficha del proveedor, hay dos opciones: En cascada / sobre precio lista.» → **Hecho T1-A**: la orden respeta `proveedores.tipo_descuento`. Función única y pura `netoCompra(lista, descuentos, tipo)` en `lib/compras/neto-compra.ts` (en SQL: `oc_neto_unitario`). **T1-B tiene que usarla en la verificación** (hoy calcula siempre en cascada).
19. **¿Hacen falta los estados "confirmada" y "en camino"?** — «No los agregamos, es indistinto, la orden de compra llega cuando depósito comienza con el scaneo.» → **Hecho T1-A**: no se muestran. Estados visibles: sin enviar, enviada, recibida en parte / recibida (los marca el depósito), finalizada, cancelada. La base los sigue admitiendo; si una orden los tuviera se ve como Enviada.
20. **¿De qué cuenta salen las órdenes y cómo se prueba sin molestar a los proveedores?** — «megasur.proveedores@gmail.com es la cuenta, ojo igual, si hacemos pruebas con mails reales de los proveedores nos puede llegar una compra con la que estamos haciendo pruebas. Todos los mails de prueba deben salir de megasur.proveedores@gmail.com a juancruzrossi072@gmail.com, cuando pasemos a producción se pasan a los mail que corresponde.» → **Hecho T1-A**: ajuste único en la base (`compras_envio_ajustes`, migración 20261117n): cuenta de envío, **MODO PRUEBA encendido por defecto** y dirección de prueba (editable). Con el modo prueba encendido TODO mail de orden de compra va solo a la dirección de prueba (ni proveedor ni copias), con "[PRUEBA]" en el asunto y un cartel en la vista previa; en la orden queda la dirección real a la que salió. Se apaga solo desde "Envío de órdenes" en el listado de órdenes, solo un admin, escribiendo la frase "A partir de ahora los mails van a los proveedores reales"; cada cambio queda con quién y cuándo (`compras_envio_ajustes_historial`). Si el ajuste no se puede leer, no se envía nada. Si la cuenta de envío no está conectada, el botón lo dice y explica cómo conectarla. **Un envío en modo prueba NO pasa la orden a "enviada"** (arreglo de la revisión, rama `entrada-t1-oc-fin`): queda pendiente y en el listado figura "Enviada a prueba" (gris) con la fecha; solo un envío real la pasa a `enviada`. Cada envío, real o de prueba, queda en `ordenes_compra_envios` con `modo_prueba`, quién, cuándo y a qué dirección salió.

## Problemas

### A. Orden de compra

| id | Problema | Verif. |
|---|---|---|
| ~~E-01~~ | ~~Pantalla vieja `app/ordenes-compra/[id]/articulos` suma stock (`incrementar_stock`) en cada guardado y borra el detalle. Se entra desde la cuenta corriente del proveedor.~~ **Hecho T0-A: la pantalla redirige a la verificación; el link de la cuenta corriente también.** | C |
| ~~E-02~~ | ~~"Usar sugerencia" copia unidades como bultos (pide N bultos en vez de N unidades).~~ **Hecho T0-A: "usar" convierte a bultos enteros hacia arriba (mismo camino que Jarvis).** | C |
| ~~E-03~~ | ~~No existe el envío por mail. PDF/Excel solo descargan; el ícono es "Send".~~ **Hecho T1-A: botón “Enviar al proveedor” con vista previa editable; sale por Gmail con el PDF (y Excel opcional), registra cuándo / quién / a quién y pasa la orden a `enviada`; se puede reenviar.** | C |
| ~~E-04~~ | ~~La OC no tiene condición de pago (columnas existen, nadie las escribe); no se ve en el PDF.~~ **Hecho T1-A: la orden copia el acuerdo de pago del proveedor (`ordenes_compra.acuerdo_pago` + `condicion_pago`), editable en la orden, impreso en el PDF y en el mail.** | C, B |
| ~~E-05~~ | ~~La OC no genera vencimientos; nacen recién al validar la factura.~~ **Hecho T1-A: al guardar nacen vencimientos ESTIMADOS (`es_estimado`, `referencia_tipo = 'orden_compra'`), uno por canal o por cuota. Falta que validar llame a `oc_vencimiento_estimado_reemplazar` (T1-B).** | C, B |
| ~~E-06~~ | ~~Tres fuentes de plazo distintas: `pago_blanco_*`/`dias_vencimiento` (validar), `plazo_dias`/`plazo_desde` (mail), ficha (`plazo_dias`).~~ **Hecho T1-A (parcial): fuente única en `lib/compras/acuerdo-pago.ts`; ya no leen plazos de legado la OC, el PDF, los mails de facturas, el recálculo de vencimientos ni la ficha. Falta `armarPlan` de validar (T1-B, usa `dias_vencimiento` de respaldo).** | C |
| ~~E-07~~ | ~~Crear/editar OC sin transacción; numeración con carrera; editar reescribe la provisión sin impuestos y no actualiza el kardex pendiente.~~ **Hecho T1-A: `oc_guardar` (migración 20261117n): número por secuencia, cabecera, detalle, provisión, vencimientos estimados y en camino, todo o nada; editar pasa por la misma función.** | C |
| ~~E-08~~ | ~~Provisión mal calculada: IVA fijo 21 %, suma el % de retención de Ganancias como deuda.~~ **Hecho T1-A: provisión por canal (con factura: neto + IVA 21 % + percepciones; sin factura: neto), según `articulos.iva_compras`; sin la retención de Ganancias.** | C |
| ~~E-09~~ | ~~Estados `enviada`, `confirmada`, `en_camino`, `cancelada`, `finalizada` no se escriben o los rechaza el CHECK. No hay cancelar (solo borrar).~~ **Hecho: CHECK en T0-A (20261116b). T1-A: `oc_cancelar` (no borra; revierte provisión, en camino y estimados; solo sin recepción ni comprobantes), `enviada` al mandar el mail, detalle de la orden en cualquier estado. `confirmada` y `en_camino` se muestran pero nadie las escribe todavía (duda para Juan).** | C, B |
| ~~E-10~~ | ~~Fecha estimada de entrega usa días de pago; RPC `calcular_avg_dias_recepcion` no existe; no se edita.~~ **Hecho T1-A: fecha de entrega editable; por defecto el promedio real de las últimas recepciones del proveedor, si no `proveedores.dias_entrega`, si no 7 días.** | C, B |
| ~~E-11~~ | ~~Crear la OC pisa `articulos.precio_compra` y descuentos sin historial.~~ **Hecho T1-A: la orden ya no toca `articulos.precio_compra` ni los descuentos; guarda el precio de ficha al momento y muestra la diferencia. El costo lo actualiza la factura validada (T1-B, E-23).** | C |
| ~~E-12~~ | ~~Diálogo de OC: muestra todo el catálogo sin stock ni venta; sin total, sin guardar-en-curso, doble click crea dos; listado sin total/fecha/creador; `select *` pesado.~~ **Hecho T1-A: diálogo con stock, en camino, venta y sugerencia por artículo, precio por unidad y por bulto, filtros, totales con y sin impuestos, guardado con estado y clave contra el doble click; listado liviano con total, entrega, creador, envío, buscador y filtro.** | C |
| ~~E-13~~ | ~~OC de faltantes e importación desde archivo asumen 1 unidad por bulto; ítems sin artículo llegan al insert.~~ **Hecho T0-A: el servidor lee las unidades por bulto de la base y rechaza renglones sin artículo.** | C |
| ~~E-14~~ | ~~Proveedor del artículo: la tabla usa `articulos.proveedor_id`, la sugerencia `articulos_proveedores` (18 filas).~~ **Hecho T1-A: una sola fuente (`idsArticulosDeProveedor`): ficha + vinculados, para la tabla y la sugerencia.** | C, B |
| ~~E-15~~ | ~~Código muerto en `app/ordenes-compra/page.tsx` y pantalla huérfana `[id]/comprobantes`.~~ **Hecho T1-A: `page.tsx` reescrito sin el código muerto; `[id]/comprobantes` redirige a la verificación (`revisar-matches.tsx` sigue en uso).** | C |

### B. Precios de compra

| id | Problema | Verif. |
|---|---|---|
| E-20 | Aplicar lista de proveedor ignora la fecha de vigencia, no usa `precios_programados`, marca `aplicada` con errores, descuento 0 = "no tocar", link roto al archivo, no acepta PDF. | C |
| E-21 | `precios_compra_historial` vacío (0 filas): el insert falla en silencio. No hay historial de costo. **T1-A: la orden ya no cambia el costo (E-11), así que no hay nada que historiar ahí; el historial va con quien actualiza el costo al validar la factura (T1-B, E-23).** | C, B |
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
| ~~E-59~~ | ~~Valores de retención a confirmar con el contador (mínimo transporte, código de régimen, condición del proveedor). Sin pantalla de edición.~~ **Pantalla hecha (T1-D):** Ajustes → Retención de Ganancias (solo admin): ver y cambiar alícuotas, mínimo no sujeto y retención mínima de cada régimen, con vigencia desde una fecha e historial. Mínimo de transporte confirmado por Juan (17/11): $67.170; lo carga `20261117r_retencion_transporte_minimo.sql` con vigencia desde el 01/11/2026 (la fila de 6.700 queda como historia). | C |
| ~~E-60~~ | ~~IIBB / IVA / SUSS fijos en 0: no hay motor.~~ **Cerrado sin motor (Juan, 16/11: solo Ganancias).** T1-D: la ruta de órdenes de pago ya no acepta IIBB / IVA / SUSS (van siempre en 0); la pantalla no los muestra. | C |
| ~~E-61~~ | `op_eliminar` borra certificados y reutiliza números sin mirar si el período ya se presentó. ~~No hay botón "Anular".~~ (T0-B agregó el botón Anular con confirmación; lo del período presentado sigue pendiente.) **Hecho (T1-D):** cada descarga del TXT de SICORE queda anotada (`retenciones_exportaciones`) y `op_eliminar` se niega si el certificado es de un período ya exportado: hay que anular (`20261117p_ordenes_pago_t1d.sql`). | C |
| ~~E-62~~ | ~~Cheque propio: no baja el banco, banco en texto libre, no se puede marcar e-cheq desde la OP, valores por defecto `S/D`.~~ **Hecho (T1-D):** cheque propio y e-cheq en la Nueva OP con cuenta bancaria real (`cuentas_bancarias`), número, fecha de pago y marca e-cheq; sugerencia de cuánto y con qué fecha según el plazo de cheques del acuerdo; al debitarse baja el saldo del banco (`cheque_propio_debitar`). Migración `20261117p_ordenes_pago_t1d.sql`. Pendiente: no se puede anular una orden cuyo cheque propio ya se debitó sin revisar el débito a mano. | C |
| ~~E-63~~ | "Marcar pagado sin OP": sin cuenta corriente, kardex ni retención (es lo que se usa hoy a diario). **Hecho (T1-D):** el atajo no se sacó. En el calendario, al elegir vencimientos de un mismo proveedor aparece "Pagar" (abre la orden de pago con todos tildados; solo admin) arriba de "Marcar como pagados"; el aviso del atajo ofrece "Pagar con orden de pago". En el formulario del vencimiento, "Pagar". Quedan `confirm()` nativos en la lista de vencimientos y en el formulario (no se tocaron). | C, B |
| ~~E-64~~ | ~~Pantalla y acciones viejas vivas: `/finanzas/proveedores/pagos`, `imputar-pago`.~~ **Hecho (T0-B):** la pantalla redirige a `/ordenes-pago`, `imputar-pago` responde 410, `crearPagoProveedor` ya no mueve plata y la RPC vieja queda sin permiso de ejecución (`20261116q`). | C |
| ~~E-65~~ | ~~Endpoints de OP y reportes de Playroom sin control de rol.~~ **Hecho (T0-B):** permisos `ordenes_pago` y `ordenes_pago_confirmar` (solo admin: Juan, 16/11, "administrativo no arma ni ejecuta pagos") y `reportes_playroom` (admin y administrativo, confirmado por Juan el 16/11) en `lib/auth.ts`. | C |
| ~~E-66~~ | ~~OP pendiente no reserva el cheque de tercero.~~ **Hecho (T1-D):** una orden pendiente reserva los cheques de tercero que eligió: `op_crear` rechaza usarlos en otra orden y la pantalla los muestra "reservado por la OP N°" (`20261117p_ordenes_pago_t1d.sql`). | C |
| ~~E-67~~ | ~~Dos pasos (crear y confirmar), sin pago parcial por comprobante, sin CBU/alias del proveedor a la vista.~~ **Hecho (T1-D):** "Pagar ahora" crea y confirma en una transacción (`op_crear_y_confirmar`, migración `20261117p_ordenes_pago_t1d.sql`) o "Dejar pendiente"; tarjeta "Cómo le pagamos" con acuerdo blanco/negro, CBU, alias, titular y si acepta cheques de terceros / e-cheq (columnas nuevas en `proveedores`, editables en la ficha fiscal); al terminar, detalle del pago listo para copiar. El pago parcial por comprobante va con E-55. | C |
| ~~E-68~~ | ~~Cuenta corriente del proveedor: sin saldo corrido, sin filtros, sin export, sin enlace a OP/certificado; retenciones sueltas.~~ **Hecho (T1-D):** pantalla nueva: saldo y cómo se compone, comprobantes sin pagar para tildar y pagar, créditos sin usar, extracto cronológico con saldo corrido y filtro por fecha (cada orden de pago en una fila con medios y retención, enlaces al PDF, al certificado y a la OC), NC esperadas a la vista, exportar a Excel y PDF. | C |
| ~~E-69~~ | Proyección de caja usa vencimientos brutos (sin retenciones ni saldo inicial). **Hecho (T1-D punto 7):** en Finanzas → "Pagos de la semana", abajo, la proyección parte del saldo real de bancos y cajas, resta los pagos ya sin la retención estimada y los cheques propios emitidos sin debitar, suma los cheques de cartera (no reservados) y depositados el día que se cobran, y muestra los estimados de órdenes de compra en columnas aparte. Lo atrasado cae en "hoy". | C |
| E-70 | Bancos: solo lectura de Mercado Pago. Sin emisión de transferencias ni e-cheq; Provincia y MP sin CBU. | C, B |
| ~~E-71~~ | No hay vista "efectivo a separar" ni "cheques propios a hacer". **Hecho (T1-D punto 7):** pantalla nueva Finanzas → "Pagos de la semana" (también desde el calendario): transferencias y e-cheq contra el saldo de cada banco, cheques de terceros sugeridos por proveedor (misma regla que la Nueva OP) y los reservados, cheques propios a hacer con su fecha, efectivo a separar por proveedor y por día contra las cajas, todo neto de la retención estimada; "lo que viene" (estimados) aparte. Cada proveedor tiene "Armar orden de pago" con sus vencimientos tildados. Sin migraciones. | C |
| ~~E-72~~ | ~~(hallazgo T0-B) `op_ganancias_bases` corta con `record "v_comp" is not assigned yet` cuando una imputación no tiene comprobante (vencimiento cargado a mano, provisión): no se podía calcular la retención ni crear la OP.~~ **Hecho (T0-B):** v5 en `20261116p` (v4 con una sentencia cambiada; no cambia el cálculo). Visto en una base local de prueba; sin verificar contra producción. | C |
| ~~E-73~~ | ~~(hallazgo T0-B) `op_confirmar` no exige estado `pendiente`: una OP `cancelada` se puede confirmar llamando a la ruta. `op_confirmar`, `op_anular` y `op_eliminar` eran ejecutables por cualquier usuario logueado.~~ **Hecho (T0-B):** chequeo de estado al entrar en `op_confirmar` v6 y permisos solo `service_role` (`20261116q`). Control de datos viejos de E-52: `scripts/control-e52-saldos-sin-imputacion.sql` (solo lectura). | C |
| ~~E-74~~ | ~~(decisión de Juan, 16/11) Pagar un vencimiento cargado a mano nunca retenía (base 0) y no había forma de marcar un proveedor exento.~~ **Hecho (T0-B):** la Nueva OP pregunta en cada vencimiento sin comprobante "¿Corresponde retener Ganancias?" (Sí/No, obligatorio; canal negro no pregunta). Con Sí, el importe pagado es la base con las reglas del motor y sale certificado. Proveedor exento (`condicion_ganancias = exento` + `ganancias_exento_hasta`, en la ficha fiscal): no retiene y la OP muestra un cartel rojo fijo; vencido, avisa y vuelve a retener. Todo en `20261116p`. **Base (Juan, 17/11):** el importe pagado ÷ 1,21 (neto sin IVA), migración `20261117a_op_ganancias_bases_neto.sql`; la pantalla muestra la cuenta. | C |

### E. Reportes, Jarvis, IA

| id | Problema | Verif. |
|---|---|---|
| ~~E-80~~ | Jarvis no lee compras, recepciones, cuenta corriente de proveedores, retenciones ni NC esperadas. **Hecho (T2-B):** nueve herramientas nuevas y cinco vigías; ver "Tanda 2-B". | C |
| ~~E-81~~ | No hay reportes de compras. El reporte de IVA no resta NC ni filtra estados. **Hecho (T2-B):** informe "Compras y proveedores" en Playroom (7 reportes) y el IVA compras lo calcula la base (validados, resta NC). | C |
| ~~E-82~~ | Modelos viejos: `claude-sonnet-4-6` (mails, Excel), `claude-haiku-4-5`, `claude-opus-4-8`; Gemini 2.5 en 4 lugares. **Hecho (T2-B, en main 2b5fd1f6).** | C |
| ~~E-83~~ | Jarvis: deuda a proveedores calculada distinto según la tool; no hay período "últimos 12 meses"; tabla de precios sin `claude-fable-5-2`. **Hecho (T2-B):** una sola deuda (cuenta corriente + anotado a mano sin comprobante) en todas las herramientas; períodos `ultimos_12_meses` y `anio_anterior`; precio agregado. | C |

### F. Prueba en pantalla del 17/11 (producción + NuStar, OC-000011 de prueba)

Probado OK en pantalla: E-02 (sugerencia en bultos), E-30/E-40 (2 bultos × 24 → +48 al stock, una vez), E-32 (validar bloquea renglones sin vincular; una sola deuda y un solo vencimiento), E-09 (estado `finalizada`), E-37 (OCR caído → documento "no leído", sin comprobante vacío), remito sin botón Validar ("Remito: controla cantidades"), retención en vencimiento a mano (pregunta Sí/No, base ÷ 1,21).

| id | Problema visto en pantalla | Tanda |
|---|---|---|
| E-90 | **Resolver un faltante contra el proveedor resta stock que nunca entró**: recibidos 150 (stock 228), al resolver "Proveedor" por las 50 u facturadas de más el stock bajó a 178. **Hecho 17/11 (rama `entrada-t1b-diferencias`, 1ª entrega): resolver un faltante no toca el stock; solo baja si se pide expresamente devolver mercadería que entró.** | ~~T1-B (urgente)~~ |
| E-91 | **NC esperada mal calculada**: usa precio de lista sin el descuento y sin IVA. Diferencia de precio real (1.450,00 − 1.415,05) × 48 = $1.677,60 neto; generó $2.097,12 = (1.812,50 − 1.768,81) × 48. Faltante 50 u × $556,83 = $27.841,50 neto; generó $34.802,00 = 50 × 696,04. **Hecho 17/11 (1ª entrega): la cuenta la hace el servidor con `lib/compras/diferencias.ts` (netos a centavos + IVA discriminado): $1.677,60 + IVA = $2.029,90 y $27.841,50 + IVA = $33.688,22. Una línea y tipo se resuelve una sola vez (`recepciones_diferencias`, migración `20261117b`, el merge no depende de ella).** | ~~T1-B (urgente)~~ |
| E-92 | Un faltante figura como OK: recibido 3 de 4 bultos → verificación "OK" + cartel chico "Incompleto", "Artículos OK 2/2", OC `recibida_completa`, línea verde en la app. | T1-B / T1-C |
| E-93 | App: Finalizar no pide confirmación ni muestra resumen aunque falte mercadería. Tocar un renglón no deja cargar cantidad (hay que ir a Buscar artículo). | T1-C |
| E-94 | "Resolver diferencia" abre siempre en "mercadería" aunque la diferencia sea de precio, no muestra los precios ni el importe de la diferencia ni el impacto. | T1-B |
| E-95 | Quedan `confirm()` nativos en verificación (eliminar comprobante, validar, finalizar). El error del OCR se muestra crudo en inglés y desaparece al recargar (el documento "no leído" no queda a la vista). | T1-B |
| E-96 | Lentitud: ~~listado de OC ~7 s en blanco~~ **(hecho T1-A: una llamada liviana + indicador de carga)**, verificación 12–35 s ("Ya casi está…"). | T1-B |
| E-97 | Tras eliminar un comprobante queda el aviso "2 ítems sin vincular". Columnas de NC esperada con encabezado `ESPERADA-1794…`. "Total facturado" resta NC sin IVA. Total OC $179.288,70 al crear vs $179.288,40 en verificación. Subtítulo "HO — Triple verificación". | T1-B |
| E-98 | Kardex de compra sin `precio_costo` y `ultimo_costo` en 0 después de validar; quedan kardex `compra` pendientes con fecha futura (fecha estimada) además del de la recepción. | T1-B |
| E-99 | El vencimiento que nace al validar no tiene forma de pago si el proveedor no tiene acuerdo cargado. ~~Una OC finalizada queda sin acceso a la verificación.~~ **(hecho T1-A: botón Verificación en el listado y en el detalle)** ~~En Nueva OP dos vencimientos del mismo día e importe se ven idénticos (no muestra forma de pago).~~ **T1-D hecho:** la Nueva OP muestra en cada vencimiento la forma de pago, modalidad, validez del cheque, canal y observaciones. | T1-A / T1-D |
| ~~E-100~~ | Una leyenda como "sin valor fiscal" en la factura hace que el OCR la clasifique como Adquisición (negro) y no lea neto/IVA. Pedir confirmación del tipo cuando hay CUIT + CAE + letra. **Hecho (T2-B):** con CUIT + CAE + letra el tipo sale Factura A/B/C y la lectura lleva el aviso "CONFIRMÁ EL TIPO". | T2-B |
| ~~E-101~~ | Gemini sin crédito el 17/11 (402): OCR caído sin que nadie se entere. Falta un vigía/alerta de saldo o de fallas de OCR. **Hecho (T2-B):** cada rechazo por saldo o cuota (402 / 429) se anota en `ia_fallas` y deja un aviso en la bandeja de Jarvis. | T2-B |

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

## Tanda 1-B — recepción, diferencias y verificación (17/11, rama `entrada-t1b-diferencias`)

**Hecho** (nada probado en pantalla ni contra una base; `typecheck:movil` OK y pruebas de `mobile/` en verde):

| id | Qué quedó |
|---|---|
| E-90, E-91 | Resolver una diferencia no toca stock; importes con netos a centavos + IVA (`lib/compras/diferencias.ts`). La diferencia de precio va sobre las unidades RECIBIDAS y el faltante sobre las que no llegaron (no se reclama dos veces). Una resolución por orden + artículo + tipo. |
| E-92, E-39 | Lo pedido que no llegó ni se facturó es "Falta recibir" (ámbar, cuenta como diferencia). La orden queda `recibida_parcial`; el depósito recibe el resto en otra entrega (`numero_tanda` + 1, solo lo pendiente) y la oficina la cierra sin el resto desde Finalizar (`aceptar_faltantes`). |
| E-94, E-44, E-43 | Ventana "Resolver diferencia" nueva (precio, cantidad o las dos; pedido / recibido / facturado; importe con IVA; vista previa). Sobrantes y no pedidos: aceptar o devolver. Foto o PDF al lado de la tabla. Corregir lo que contó el depósito con registro de quién (`20261117c`). |
| E-42 | Lo bonificado (sin cargo) no es diferencia de precio ni baja el costo. |
| E-34 | "La empresa asume" un precio: copia lista + descuentos de la factura; con precios distintos o descuento al pie deja solo `ultimo_costo` y avisa. |
| E-23, E-98, E-21 | Validar valoriza el kardex de la recepción y deja `ultimo_costo` (con el descuento al pie repartido); cada cambio de último costo queda en `precios_compra_historial`. El **precio de lista** del artículo NO cambia al validar: cambia solo cuando alguien elige "la empresa asume" en una diferencia de precio, y ese cambio lo anota la misma función SQL en la misma transacción. |
| E-31 | Una sola fuente: compra confirmada = kardex de la recepción; el kardex pendiente de la orden es "en camino" y baja a lo que falta recibir (`lib/compras/costo-y-kardex.ts`). Validar ya no lo confirma. |
| E-46 | Regla dura de suma de renglones (decisión 13). |
| E-95 | Sin `confirm()`/`alert()` nativos en la verificación (`components/ui/confirmar.tsx`). Documento "no leído" a la vista, con reintentar la lectura y cargar el comprobante a mano. |
| E-96 | Verificación en una llamada al servidor con consultas en paralelo; deja los tiempos por etapa en el registro si tarda más de 3 s (`[verificación OC …] lenta: {…}`). **No se midió contra producción**: hay que mirar ese registro después del deploy. |
| E-97 | Aviso de renglones sin vincular, encabezados de NC esperada, total facturado, total de la orden, subtítulo y orden finalizada en solo lectura. |

**Migraciones de esta tanda** (escritas, sin aplicar; cualquier orden; no tocan datos):

| Archivo | Para qué | Sin aplicarla |
|---|---|---|
| `20261117b_recepcion_resolver_diferencia.sql` | Tabla `recepciones_diferencias` + función que resuelve todo o nada | Solo se puede elegir "la empresa lo asume"; proveedor, transporte y devoluciones contestan que falta la migración |
| `20261117c_recepcion_corregir_conteo.sql` | Corregir lo recibido desde la oficina, con registro | El botón avisa que falta y no cambia nada |
| `20261117d_validar_renglones_suman.sql` | La función de validar también controla la suma | El servidor ya lo controla antes de llamarla: es la segunda barrera |

**Hecho después (17/11):** el control "neto + impuestos = total" suma también `impuestos_internos` y `otros_impuestos` (se cargan a mano y los pide la lectura automática); E-45: el cargo al transporte muestra y deja asentado el control de bultos de esa entrega; E-47: se retiraron `/api/deposito/recepciones/documento`, `/api/recepciones` (GET/POST) y `/api/recepciones/[id]` (GET), que nadie llamaba, y la pantalla huérfana `/ordenes-compra/[id]/comprobantes` ahora redirige a la verificación (escribía comprobantes directo desde el navegador, sin ningún control).

**No se retiró, y por qué:** `processOCRData` (en `/api/recepciones/[id]/ocr`) solo corre para recepciones SIN orden de compra, que ya no se pueden crear (las creaba `/api/recepciones`): queda para las que existan. `runArticleLevelOCR` (`lib/ai/email-invoice-processor.ts`) sigue en uso por las facturas que entran por mail; hace lo mismo que `matchAndCreateDetalle` con otra lógica y habría que unificarlo cuando se toque el circuito de mails (ya cumple la convención de cantidades).

**Sobrante (decisión 14 de Juan):** hecho; la pantalla de notas de crédito pasó a llamarse "Notas esperadas de proveedores" y lista aparte la mercadería de más que falta facturar. Una nota de débito esperada no se puede registrar como nota de crédito (la ruta lo rechaza). La conciliación con la factura real es manual: se carga la factura en la orden y se quita la esperada de la lista.

### Arreglos de la revisión de la rama completa (17/11)

1. **Regla de suma**: entran impuestos internos y otros impuestos; sale la retención de Ganancias. Primero se controla la cabecera (neto + impuestos = total) y, si no cierra, se dice eso y no se culpa a los renglones.
2. **Redondeo**: el importe de cada renglón se calcula de las dos formas (cantidad × lista × descuentos redondeado una vez, o cantidad × neto por unidad ya redondeado); pasa si cualquiera cierra. Igual en la función SQL (`20261117d`).
3. **Factura B / C sin IVA leído**: neto = total (menos percepciones e impuestos) e IVA = 0; ya no se inventa total ÷ 1,21. El mensaje dice "en total" en lugar de "neto".
4. **Recepción en parte con dos equipos**: un conteo o control de bultos que llega cuando la entrega ya se finalizó se rechaza (`recepcion_finalizada`) y deja un aviso (`mobile_alertas_integridad`, tipo `recepcion_tardia`) que la oficina ve en la verificación de la orden. La entrega siguiente la abre solo "Iniciar recepción" (`recepcion.iniciar` capturado después del cierre, o entrar a la orden en la web). Un `recepcion.cerrar` tardío no abre nada.
5. **Costo al validar**: incluye el descuento al pie; una segunda factura de la misma orden no revaloriza el kardex que valorizó la primera (cada factura valoriza las entregas a las que quedó ligada); volver a validar una factura ya validada no corre el costo de nuevo.
6. **Historial de costos**: "la empresa asume" y "bonificado" lo anotan dentro de la función SQL; el cambio de último costo al validar lo anota la aplicación y, si falla, avisa en pantalla. Columnas nuevas en `precios_compra_historial` (`ultimo_costo`, `origen`, `comprobante_compra_id`, `orden_compra_id`, `usuario_id`) dentro de `20261117b`.
7. **Devolver unidades**: solo en diferencia de cantidad con destino proveedor o empresa (ruta y función).
8. `ORDER BY fecha_comprobante DESC NULLS LAST` al elegir la factura asociada.
9. Lo contado "fuera de la orden" no descuenta lo pendiente de la orden.
10. El kardex de una corrección de conteo se valoriza al neto (el de la compra que corrige, o último costo, o lista menos descuentos).
11. `sincronizarKardexEnCamino` trata sola como cerrada una orden finalizada o cancelada. **Hoy ninguna pantalla cancela órdenes**: quien agregue "cancelar orden" (T1-A) tiene que llamarla después de cambiar el estado.

12. **E-cheq** (pedido de T1-A): si el acuerdo del proveedor dice `echeq`, el vencimiento que arma la validación queda con forma de pago `cheque` en vez de vacío. Al integrar, el mapeo pasa a `lib/compras/acuerdo-pago.ts`.

**Limpieza única** (no es migración, la corre el dueño): `scripts/entrada-limpieza-kardex-en-camino.sql` — borra, con copia de respaldo, las compras duplicadas que dejaba la validación vieja y el "en camino" de órdenes cerradas o ya recibidas.

**Límite conocido (app Depósito v0.5.2 instalada):** la app manda "iniciar" una sola vez por orden mientras está abierta. Si el mismo equipo cierra una entrega y, sin cerrar la app, quiere contar la siguiente de la misma orden, los conteos se rechazan con un mensaje que le dice que cierre y abra la app. Anotado en `docs/PENDIENTES-APPS.md`.

**Queda:** la devolución con su kardex dentro de la misma transacción (hoy el stock y el registro van en la transacción y el kardex se anota después; si falla, avisa).

**Coordinación con T1-A (orden de compra), pendiente hasta que su migración `20261117n` esté en main:**
- Hecho acá: el depósito también ve órdenes `enviada`, `confirmada` y `en_camino` (`ESTADOS_A_RECIBIR`).
- Falta: llamar a `oc_vencimiento_estimado_reemplazar` al validar y al finalizar; usar `ordenes_compra.total_*` para el total de la orden; reemplazar `armarPlan` por `lib/compras/acuerdo-pago.ts`; decidir si `oc_kardex_pendiente_sincronizar` y `sincronizarKardexEnCamino` conviven (la de T1-A rehace lo pendiente al guardar la orden; la de acá lo baja con cada entrega).
- Para T1-A / E-99: la verificación ya abre una orden finalizada en solo lectura; falta el acceso desde el listado.

**Dudas de negocio abiertas para Juan:**
1. ~~Factura con un impuesto sin campo para cargarlo.~~ Resuelto: las columnas `impuestos_internos` y `otros_impuestos` ya existían; ahora entran en el control y se pueden cargar.
2. ~~Sobrante aceptado sin anotar que el proveedor lo va a facturar.~~ Resuelto con la decisión 14.

## Tanda 1 — cableado entre la orden de compra y la validación (17/11, rama `entrada-t1-cableado`, sobre `entrada-t1-integra`)

| Punto | Qué quedó |
|---|---|
| Vencimiento estimado | Al validar una factura, el vencimiento ESTIMADO de la orden baja por el total del comprobante en su canal (factura = blanco, adquisición = negro) y desaparece al llegar a cero: `oc_vencimiento_estimado_reemplazar(orden, canal, total)`. Con la migración `20261117u` lo hace la misma función que valida, en la misma transacción; sin ella, el servidor lo hace apenas termina de validar. Al finalizar la orden se quita lo que quede. Nunca toca un vencimiento que no sea un estimado de esa orden. |
| Total de la orden | La verificación muestra `ordenes_compra.total_neto` (lo guarda `oc_guardar`); en una orden anterior, la misma cuenta de `lib/compras/oc-totales.ts`. |
| Plazo y forma de pago | `armarPlan` usa `lib/compras/acuerdo-pago.ts`: el acuerdo copiado en la orden (o el de la ficha, con el plazo viejo como respaldo), e-cheq = cheque, desde factura o recepción, y un vencimiento por cuota ("30/60/90"). Las cuotas necesitan la migración `20261117u`; sin ella sale un solo vencimiento (primera cuota, por el total). Sin plazo acordado ni fecha en el comprobante sigue avisando "sin vencimiento". |
| Descuentos y redondeo | Una sola función: `netoCompra` de `lib/compras/neto-compra.ts` (ya no existen `precioNeto` ni `netoDocumento` en `diferencias.ts`). **Un solo redondeo en todo el circuito:** el neto por unidad no se redondea; se redondea el importe (unidades × neto), una vez, a centavos. Lo usan la orden, la verificación, las diferencias, las notas esperadas y el costo. Efecto: el caso de la prueba (48 u, 1.450,00 contra 1.768,81 − 20 % = 1.415,048) da $1.677,70 neto en vez de $1.677,60, que es exactamente total facturado menos total de la orden. La regla de suma sigue aceptando también la factura de un proveedor que redondea el unitario. En SQL, la regla de suma usa `oc_neto_unitario`. |
| E-cheq | El paso medio → forma de pago está solo en `formaPagoVencimiento` de `lib/compras/acuerdo-pago.ts`. |
| Provisión | Cada comprobante baja la provisión de su canal (una orden mixta tiene dos). Al finalizar, `oc_cerrar_estimados` quita la provisión que quede, los vencimientos estimados y el "en camino", en una transacción. |
| Kardex "en camino" | Antes de la primera recepción lo escribe `oc_kardex_pendiente_sincronizar` (al crear, editar o cancelar la orden). Desde la primera recepción lo ajusta `sincronizarKardexEnCamino` (cada entrega, cada validación, al finalizar). No se pisan: una orden con recepción no se puede editar ni cancelar. |
| Estados | `ESTADOS_A_RECIBIR` = pendiente, enviada, recibida_parcial. "confirmada" y "en_camino" no existen. |

### Arreglos de la revisión final del cableado (18/11, rama `entrada-t1-cableado2`)

1. **El vencimiento real de una factura de una orden nace en UN solo lugar: al validar.** El procesador de mails (`lib/ai/email-invoice-processor.ts`) ya no crea el vencimiento ni descuenta el estimado cuando la factura es de una orden: deja el comprobante y la deuda en la cuenta corriente, y el pago sigue a la vista por el vencimiento estimado hasta que se valida. Al validar salen las cuotas del acuerdo y se descuenta el estimado, una sola vez. Como segunda barrera, el paso 7 de `20261117u` (y el servidor sin la u) solo descuenta el estimado si el vencimiento nació en esa misma validación. Las facturas por mail SIN orden siguen como antes (no hay estimado que descontar).
2. **Finalizar una orden con parte con factura y parte sin factura:** cada parte necesita su comprobante validado (factura / adquisición). Si falta, `/finalizar` contesta 409 `falta_comprobante_del_canal` con los importes; la pantalla lo avisa antes y solo cierra con confirmación expresa (`aceptar_canal_sin_comprobante`), diciendo cuánta deuda provisoria y cuánto vencimiento estimado se cancelan. La pantalla muestra los avisos que devuelve `/finalizar`.
3. **Una nota de débito con orden de compra** no baja la provisión ni el estimado de la orden.

### Arreglos de la segunda revisión del cableado (18/11, rama `entrada-t1-cableado3`)

1. **Pago antes de validar:** una factura de una orden que entró por mail deja la deuda en la cuenta corriente y se puede pagar con una orden de pago antes de validarla. Al validar, las cuotas nacen por el total y enseguida se acomodan al saldo real del movimiento (paso 8 de `20261117u`, con `op_vencimientos_sincronizar_movimiento` de la `p`): lo ya pagado no vuelve a aparecer como pendiente, y la pantalla avisa cuánto estaba pagado.
2. **NC / ND por mail con orden:** ya no convierten la provisión de la orden. Solo una factura o una adquisición la convierte; la nota entra como movimiento propio.
3. **Adquisición, un solo valor:** el procesador de mails guarda `Adquisicion` (antes `ADQ`). Al leer se aceptan los dos (`esAdquisicion` en `lib/compras/finalizar-oc.ts`, y la función SQL), porque hay comprobantes viejos con `ADQ`.
4. **Sin la migración u**, validar un comprobante de una orden de compra contesta "falta aplicar la migración 20261117u" y no hace nada (el servidor pregunta `entrada_cableado_version()`). Se quitó el camino por partes.

### Prueba en producción del 18/11 (OC-000012, HORNAL) — rama `entrada-t1-ocr-match`

1. **Un renglón leído que no se guardó** (FA 0003-00045711: se leyeron rollo aluminio y rollo film, quedó solo el film). En el código no hay ninguna deduplicación entre documentos ni filtro de "ya documentado": lo que se guarda en `datos_ocr.items` es lo que sale de interpretar el JSON que devuelve la IA. Si la IA repite la lista `items` (o pone una adentro de otra parte del JSON), al interpretarlo queda solo la última. **Arreglo** (`lib/services/lectura-renglones.ts`): se recorre el texto de la lectura y se juntan todas las listas de renglones; si el texto menciona más renglones de los que quedaron, se avisa. Y un renglón que no se puede guardar en el comprobante (error de la base) ya no queda solo en el registro del servidor: se avisa en pantalla con su descripción. Los avisos salen al subir el documento y quedan en `datos_ocr.avisos`. **Sin confirmar contra el dato real:** no se pudo leer el `raw_text` de producción desde esta sesión; si el texto de `fa2.png` no tiene la lista repetida, hay que mirarlo de nuevo.
2. **Sugerencia de un artículo de otro proveedor** (190138 de HORNAL sugerido al 961950 de YASH). El motor comparaba el código solo contra las equivalencias aprendidas (`articulos_proveedores`), nunca contra el SKU, y después buscaba por parecido en todo el catálogo. **Arreglo** (`lib/matching/compra.ts` + `matcher.ts`): el código exacto gana siempre (SKU del artículo de la orden o del proveedor, código de proveedor, EAN); por parecido se elige primero entre los artículos de la orden, después del proveedor; uno de otro proveedor es el último recurso, nunca se asigna solo y en "Revisar matches" sale marcado "Artículo de otro proveedor".
3. **Número con un cero de más** ("0001-000008821"): el número se guarda con el formato del papel, punto de venta de 4 (o 5) dígitos y número de 8 (`formatearNumeroComprobante`), en la lectura automática, la carga a mano y la edición.

4. **Dos documentos subidos juntos** (dato del orquestador: la misma factura subida sola se leyó completa). La pantalla ahora sube los archivos de a uno (cada uno espera al anterior), lo documentado de la recepción se lee fresco antes de sumar, y la lectura avisa al cargar si los renglones leídos no suman el neto del comprobante, si vinieron renglones fuera de la lista principal o si se usó el modelo de respaldo. La causa exacta sigue sin confirmarse contra el dato real.
5. **Agregar un renglón a mano**: se elige la unidad (unidades o bultos de N), con descuentos D1..D4, y se ve a cuántas unidades equivale, el neto por unidad y el importe antes de guardar. No se precarga nada de la orden (se muestra como referencia). Cuenta en `lib/compras/renglon-manual.ts`.
6. **Corregir y borrar un renglón** de un comprobante sin validar (botón "Ver los renglones"): acomoda lo documentado de la recepción y queda anotado quién, cuándo, antes y después en `comprobantes_compra_cambios` (migración `20261118a_comprobantes_compra_cambios.sql`, independiente; sin ella se hace igual y queda en el registro del servidor).
7. **Borrar un comprobante** se lleva también su archivo (foto o PDF): ya no queda suelto en la lista de la verificación.

### Prueba en producción de punta a punta (18/11, OC-000012) — segunda parte, misma rama

8. **Costo con reclamo al proveedor.** Si la diferencia de precio se reclama (nota de crédito esperada), el último costo del artículo y el kardex de la compra quedan al precio de la ORDEN; si la empresa la acepta, al facturado. Vale en los dos órdenes: resolver y después validar, o validar y después resolver (al resolver se recalcula el costo de ese artículo con las facturas ya validadas de la orden). La vista previa de la ventana dice lo mismo que pasa. `lib/compras/costo-y-kardex.ts`.
9. **La provisión baja por lo facturado**, igual que el vencimiento estimado: un comprobante por una parte de la orden ya no se lleva la provisión entera del canal. Migración `20261118c_provision_baja_por_lo_facturado.sql` (va después de la u). El procesador de mails hace lo mismo: si la factura es por menos que la provisión, la provisión queda por el resto y la deuda entra como movimiento propio.
10. **Pestaña que se cuelga en la verificación.** No se pudo medir con el navegador desde la sesión de trabajo: la causa NO está confirmada. Se corrigió lo que la pantalla hacía de más en cada refresco: (a) el enlace firmado de la foto cambia en cada carga y el visor volvía a descargar y dibujar la imagen cada vez (ahora conserva el enlace mientras sea el mismo documento); (b) "Revisar matches" volvía a pedir los renglones de todos los comprobantes cada vez que la pantalla se dibujaba (al abrir un cartel, por ejemplo) porque recibía una lista nueva en cada dibujado. Si vuelve a pasar, hace falta el perfil del navegador.
11. **Nombre del proveedor en lugar de la sigla** en la cuenta corriente (la sigla va chica al lado) y en la lista de órdenes de pago.

### Arreglos de la revisión de `entrada-t1-ocr-match` (18/11)

1. **La provisión se baja una sola vez.** La validación la baja solo cuando el movimiento de deuda nace ahí (`v_mov_nuevo`); si la factura entró por mail, el procesador ya la bajó (o la convirtió) al dejar la deuda. `20261118c` corta si falta la `20261118b`. Con orden de compra y sin la función de validar, el servidor contesta "falta migración" (ya no hay camino por partes).
2. **Dos lecturas a la vez, resuelto en la base** (`20261118e_recepcion_documentado_atomico.sql`, independiente): lo documentado de una línea se suma en un solo UPDATE (`recepcion_item_sumar_documentado`, lo usan la oficina, la app Depósito, el mail, "Revisar matches" y los renglones a mano) y el comprobante provisorio lo decide la base con la orden bloqueada (`comprobante_provisorio_obtener`). Sin la migración sigue el camino anterior.
3. **Matching:** "el código es el SKU" corre solo en compras y después de la equivalencia aprendida del proveedor. Un código de barras que cae en un artículo de otro proveedor queda sugerido y marcado, nunca asignado solo.
4. El mail y la recepción sin orden pasan el contexto de compra. Al corregir un renglón se usa un solo factor de bulto para lo de antes y lo nuevo, sin pisar el factor de la recepción.

### Faltante de un artículo facturado en dos comprobantes (18/11, OC-000013) — rama `entrada-t1-faltante-canal`

El aluminio se facturó 36 u en la factura (con IVA) y 36 u en la adquisición (sin factura), y llegaron 36. La nota de crédito esperada salió por $26.526,65 ($21.922,85 + $4.603,80 de IVA): se tomaba el IVA del primer renglón del artículo, como si lo que faltó fuera de la factura.

Ahora, cuando lo facturado del artículo está en más de un comprobante y el importe cambia según cuál sea (otro IVA u otro precio):
- la ventana pregunta **a qué comprobante corresponde lo que faltó**, con el importe y el IVA de cada opción a la vista. Por defecto, el sin factura (adquisición) primero;
- el importe del reclamo (o del cargo al transporte) usa el precio y el IVA de ese comprobante. Si faltan más unidades de las que trae el elegido, el resto sale del otro con su IVA;
- la nota de crédito esperada queda **asociada a ese comprobante** y la descripción lo dice.

Sin migración: la cuenta está en `lib/compras/diferencias.ts` (`faltante_de`, `cantidad.opciones`); la asociación de la nota esperada la corrige el servidor después de crearla. No cambia la devolución de mercadería que entró ni la diferencia de precio, que siguen usando el promedio del artículo.

### Orden de las migraciones de la Tanda 1

Las que ya están aplicadas en producción (16/11): `20261116a`, `20261116b`, `20261116c`, `20261116p`, `20261116q`, `20261117a_remito_no_se_valida`, `20261117a_op_ganancias_bases_neto`.

| Orden | Archivo | Depende de |
|---|---|---|
| 1 | `20261117b_recepcion_resolver_diferencia.sql` | `20261116a` |
| 2 | `20261117c_recepcion_corregir_conteo.sql` | `20261116a` |
| 3 | `20261117d_validar_renglones_suman.sql` | `20261116c` y `20261117a_remito_no_se_valida` (reemplaza esa función) |
| 4 | `20261117m_proveedores_datos_compra.sql` | nada |
| 5 | `20261117n_oc_guardar.sql` | conviene después de la m (lee columnas del proveedor que agrega la m) |
| 6 | `20261117p_ordenes_pago_t1d.sql` | `20261116p` y `20261116q` (corta si faltan) |
| 7 | `20261117r_retencion_transporte_minimo.sql` | independiente |
| 8 | `20261117u_cableado_oc_validar.sql` | **la d, la n y la p** (corta con mensaje si falta alguna). Sin ella el servidor no valida comprobantes de una orden de compra (avisa que falta). |
| 9 | `20261118a_comprobantes_compra_cambios.sql` | independiente (registro de renglones tocados a mano) |
| 10 | `20261118b_oc_estimados_sin_borrar.sql` | la n |
| 11 | `20261118c_provision_baja_por_lo_facturado.sql` | **la u y la 18b** (corta con mensaje si falta alguna). Reemplaza la función de validar. |
| 12 | `20261118e_recepcion_documentado_atomico.sql` | independiente (sumado atómico de lo documentado y provisorio con bloqueo) |

Aparte, una sola vez y a mano: `scripts/entrada-limpieza-kardex-en-camino.sql`.

## Tanda 1-A — orden de compra y envío al proveedor (17/11, rama `entrada-t1a-orden-compra`)

**Migraciones (escritas, SIN aplicar; idempotentes; probadas en una base Postgres local de prueba). Orden: m y después n (son independientes, pero ese es el orden natural).**

| Archivo | Qué agrega | Sin aplicarla |
|---|---|---|
| `20261117m_proveedores_datos_compra.sql` | Columnas en `proveedores`: `mail_ordenes_compra`, `cbu`, `cbu_alias`, `banco_titular`, `acepta_cheques_terceros`, `acepta_echeq`, `dias_entrega`, `transporte_habitual`, `observaciones_compra`, `pago_blanco_cuotas`, `pago_negro_cuotas`; medio de pago `echeq` | Todo anda salvo: guardar el mail para OC en la ficha (avisa) y el importador del Excel (avisa y no guarda nada) |
| `20261117n_oc_guardar.sql` | Columnas en `ordenes_compra` (acuerdo, totales, envío, cancelación, clave), en el detalle (régimen de IVA, precio de ficha), `cuenta_corriente_proveedores.canal` y `configuracion_empresa.mail_compras`; secuencia de numeración posicionada; funciones `oc_guardar`, `oc_cancelar`, `oc_marcar_enviada`, `oc_totales`, `oc_provision_sincronizar`, `oc_vencimientos_estimados_sincronizar`, `oc_vencimiento_estimado_reemplazar`, `oc_kardex_pendiente_sincronizar` | **El merge DEPENDE de ella**: sin la migración el listado, el detalle, el PDF y la recepción siguen andando, pero no se puede crear, editar, cancelar ni enviar órdenes (la pantalla lo avisa con un cartel rojo). Es compatible con el código viejo: **aplicarla ANTES del merge** |

**Reglas que quedaron escritas (una sola vez cada una):**

- **Plata de la orden** — `lib/compras/oc-totales.ts` y, igual, `oc_totales` en SQL: precio SIEMPRE por unidad; renglón = unidades × neto sin redondear, redondeado por renglón; blanco / negro por `articulos.iva_compras` (factura / adquisicion_stock / mixto = el % con factura del proveedor); IVA 21 % y percepciones solo sobre lo blanco; la retención de Ganancias no es deuda. Descuentos como los aplica el proveedor (`proveedores.tipo_descuento`): `netoCompra` en `lib/compras/neto-compra.ts`. Mixto: `mixto_pct_factura` de la orden (sin dato, 50 %).
- **Acuerdo de pago** — `lib/compras/acuerdo-pago.ts`: única fuente del plazo. La orden lo copia (`acuerdo_pago` jsonb: `{blanco: {medio, dias, cuotas, desde, plazo_cheque, entrega}, negro | null}`; negro null = igual que blanco).
- **Vencimiento estimado** — fecha estimada de entrega + días (o una fila por cuota "30/60/90"). Concepto `ESTIMADO OC-000012 — falta la factura`, `es_estimado = true`. Nunca se toca un vencimiento que no sea estimado de esa orden; uno que ya se pagó o se imputó en una OP no se borra ni se regenera.
- **Editar / cancelar** — se edita y se cancela en `pendiente / enviada / confirmada / en_camino`, sin recepción en depósito ni comprobantes cargados. El proveedor de una orden no se cambia.

**Para las otras tandas (avisado a T1-B por mensaje):**

- **T1-B — `lib/deposito/recepciones.ts:157`** lista para recibir solo `pendiente` y `recibida_parcial`: una orden **enviada** deja de verse en depósito. Hay que sumar `enviada`, `confirmada`, `en_camino`. **Sin ese cambio no conviene usar "Enviar al proveedor" en una orden que se va a recibir.**
- **T1-B** — al validar la factura, llamar `oc_vencimiento_estimado_reemplazar(orden, canal, monto)` en la misma transacción (y sin monto al finalizar la orden). Hoy solo lo hace la factura que entra por mail.
- **T1-B** — kardex pendiente aislado en `oc_kardex_pendiente_sincronizar` (E-31): vaciarla si pasa a haber otra fuente.
- **T1-B** — la provisión son hasta 2 movimientos por orden (con / sin factura); el total de la orden está en `ordenes_compra.total_*` (E-97).
- **T1-D** — los estimados aparecen en el calendario y en "Nueva OP" como vencimientos sin comprobante: marcarlos como estimados (o no dejarlos pagar) y mostrar la forma de pago. El calendario hoy no distingue `es_estimado` a la vista: se distinguen por el concepto.
- **T1-D** — CBU / alias / titular / acepta cheques de terceros / e-cheq ya tienen columna (migración m) para E-67.

**Gmail (E-03):** `users.messages.send` acepta, según la referencia de Google, cualquiera de `mail.google.com`, `gmail.modify`, `gmail.compose`, `gmail.send`. El sistema ya pide `gmail.modify` (`lib/ai/gmail.ts`), así que **no hay que agregar permisos ni reautorizar**. Si una cuenta quedó conectada sin ese permiso, el envío falla con un mensaje que dice que hay que volver a conectarla desde el asistente ("Conectar Gmail").

**Importador del Excel de proveedores:** Fichas de proveedores → "Importar datos de compra (Excel)" (solo admin). Vista previa fila por fila (antes → después), lo vacío no se modifica, una fila con error no se importa. `lib/proveedores/importar-datos.ts`, `app/api/proveedores/importar-datos`, `components/proveedores/ImportarDatosProveedoresDialog.tsx`. Necesita la migración m.

**Sin probar en pantalla:** todo lo de esta tanda se verificó con typecheck, tests (reglas puras + armado del mail) y las funciones SQL contra una base local; no se abrió en el navegador ni se mandó ningún mail.

### Revisión del 17/11 (arreglos pedidos por el orquestador)

- **Editar con comprobantes cargados (1):** la orden no se edita si tiene algún comprobante que no esté `esperada` (antes: solo si estaba validado). Misma regla que cancelar, en `oc_guardar` y en la pantalla (el botón Editar desaparece y se dice por qué). Evita la deuda y el vencimiento duplicados cuando la factura ya entró por mail.
- **Orden mixta por mail (2):** las provisiones llevan `cuenta_corriente_proveedores.canal` (columna nueva, migración n). La factura que entra por mail toma la provisión de SU canal (factura → blanco, adquisición → negro); una provisión vieja sin canal vale para cualquiera; si solo queda la del otro canal no la toca.
- **Importar desde archivo (3):** se pregunta también si el PRECIO del archivo es por bulto o por unidad (por defecto, igual que la cantidad). Por bulto se divide por las unidades por bulto del catálogo.
- **Plazo de un proveedor sin acuerdo (4):** si no tiene `pago_blanco_dias` (ni cuotas), la regla cae al dato viejo (`plazo_dias` + `plazo_desde`) en vez de 30 fijos, marcado `de_legado`: la orden, el detalle y el vencimiento dicen "acuerdo de pago sin cargar". Vale para la orden y para las facturas por mail. Sin migración de datos. **Proveedores donde el acuerdo y el dato viejo se contradicen (queda el acuerdo; Juan tiene que confirmarlos en el Excel):** ARNANUK S.A, COTY ARGENTINA SA, NEWELL BRANDS S.A. (viejo: 30 desde recepción · acuerdo: 30 desde factura); BUYANOR S.A, DESES PLAST (viejo: 30 desde recepción · acuerdo: 0 desde recepción). **Sin acuerdo, siguen con el dato viejo:** BHUO GREEN (8 desde recepción), GAETA (20 desde recepción), LUQUE WALTER (TYLFOT) (contado), OLMEDO PLUMEROS (30 desde factura).
- **E-cheq (5):** mapeo único en `lib/compras/acuerdo-pago.ts` (`formaPagoVencimiento`): e-cheq → `forma_pago = 'cheque'`. El CHECK de vencimientos solo admite efectivo / transferencia / cheque; se eligió 'cheque' porque el e-cheq tiene fecha de pago diferida y necesita `fecha_validez` (como 'transferencia' la perdería). Que sea electrónico queda en el acuerdo. Ya lo usan recalcular vencimiento y la ficha fiscal (opción E-cheq). **Falta en archivos ajenos:** `comprobantes-compra/[id]/validar/route.ts` ~88 (T1-B: con echeq deja forma_pago NULL) y `NuevaOPClient.tsx` ~496 (T1-D).
- **Estimado en el formulario de vencimiento (6):** editar el monto de un estimado de orden de compra ya no le saca la marca.
- **Fechas pasadas (7):** si la fecha de entrega de la orden ya pasó, el plazo de los estimados corre desde hoy (base y pantalla).
- **Cuenta de envío (8):** reemplazado por la decisión 16 de Juan: la cuenta sale del ajuste único de envío (`compras_envio_ajustes.cuenta_envio`), no se elige en cada envío.
- **Guardar mail en la ficha (9):** solo viene tildado cuando el proveedor no tiene ningún mail.
- **Listado (10):** sin `.in()` con cientos de ids ni `.limit(5000)`: proveedores y usuarios por tandas, comprobantes paginados, detalle solo de las órdenes viejas sin total guardado. No hizo falta una vista.
- **Eliminar físico (11):** no queda ninguno en la pantalla de órdenes; solo `/cancelar`.

### Importador de proveedores: plantilla del sistema (17/11, pedido del orquestador)

Juan va a renovar todos los datos de los proveedores con el Excel. Fichas de proveedores → "Importar datos de compra (Excel)" (solo admin):

- **Descargar plantilla**: la arma el sistema, una fila por proveedor activo con lo que tiene cargado hoy y una hoja "Cómo completar" con lo que se puede escribir en cada columna. No hay una plantilla aparte que mantener (`COLUMNAS_PLANTILLA`, `filaPlantilla`, `ayudaPlantilla` en `lib/proveedores/importar-datos.ts`). Lo que se descarga se puede volver a subir tal cual y no cambia nada (hay un test de ida y vuelta).
- **Columnas** (32): código, proveedor, CUIT, tipo, mail para la orden de compra, mail de administración, teléfono del vendedor, **cómo aplica los descuentos (cascada / sobre_lista)**, **mixto: % con factura**, **percepción IVA %**, **percepción IIBB %**, acuerdo BLANCO y NEGRO (medio, días o cuotas, desde, plazo del cheque, entrega), banco, CBU, alias, titular, acepta cheques de terceros, acepta e-cheq, retención de Ganancias, vencimiento del certificado de exento, transporte habitual, días de entrega, observaciones.
- **Plantilla anterior** (`docs/entrada/proveedores-para-completar.xlsx`): se acepta. Las columnas que no trae se ignoran (esos datos no se modifican) y la vista previa las nombra.
- **Vista previa**: resumen arriba (con cambios / sin cambios / con errores / códigos que no existen) y, proveedor por proveedor, cada campo que cambia "antes → después". Lo vacío no pisa nada; una fila con error no se importa.
- Lo que el Excel no puede expresar y por eso sale vacío (no se toca): proveedor "no inscripto" en Ganancias, régimen de servicios, y un CUIT que hoy está guardado con error.

### Conectar la cuenta de Gmail de compras (18/11, rama `entrada-t1-gmail`)

Probando en producción, el envío pedía reconectar la cuenta "desde el asistente", pero ese botón no estaba en ninguna pantalla (`components/ai/ai-chat-widget.tsx` no se monta). Ahora:

- **Órdenes de compra → Envío de órdenes**: muestra cómo está la cuenta de envío preguntándole a Google (conectada / la conexión venció o fue revocada / conectada sin permiso para enviar / no conectada) y el botón **Conectar Gmail**, con la aclaración de entrar antes a Gmail con esa cuenta en el navegador.
- El mismo botón aparece en la ventana de envío cuando la cuenta no sirve, y también si Google rechaza el envío por la conexión.
- Después de Google se vuelve a `/ordenes-compra` (antes a `/`, donde nada mostraba el resultado): el panel se abre solo con "Cuenta conectada: …" o el motivo del error, y avisa si se conectó una cuenta distinta de la de envío.
- Los mensajes de error dicen dónde está el botón (`lib/ai/gmail.ts`, `lib/compras/envio-ajustes.ts`).

### Los estimados de una orden se cancelan, no se borran (18/11, rama `entrada-t1-estimados`)

**Qué pasó en producción:** validar FA 0003-00045711 de la OC-000012 daba "vencimientos_historial es un historial: no se modifica ni se borra". Cada alta y cada cambio de un vencimiento escribe en `vencimientos_historial` (auditoría de `20261105`), que es inmutable y cuelga del vencimiento con `ON DELETE CASCADE`: **ningún vencimiento se puede borrar**. Las funciones de la orden de compra borraban los estimados, así que fallaban siempre validar, finalizar, cancelar y editar una orden.

**Arreglo — migración `20261118b_oc_estimados_sin_borrar.sql`** (no toca datos, re-ejecutable, requiere la `20261117n` ya aplicada; no toca la historia ni su disparador):

- Los estimados que se reemplazan, se recalculan o quedan sin efecto pasan a `estado = 'cancelado'`, con el motivo al final de `observaciones` ("reemplazado por el vencimiento real de la factura …", "orden … cancelada", "orden … editada: se recalculó el estimado") y el monto sin tocar.
- Al editar una orden se cancelan los estimados viejos y se insertan los nuevos.
- Factura por una parte del total: el estimado cubierto en parte baja su monto con un UPDATE (la historia lo registra).
- Función nueva `oc_vencimientos_estimados_cancelar(orden, canal, motivo, usuario)`; `oc_vencimientos_estimados_borrar` conserva el nombre y ahora cancela. Las firmas de `oc_vencimiento_estimado_reemplazar` y `oc_vencimientos_estimados_sincronizar` no cambian: `comprobante_compra_validar`, `oc_cerrar_estimados`, `oc_guardar` y `oc_cancelar` siguen llamando igual.
- El mismo texto quedó en `20261117n_oc_guardar.sql`, para que volver a correrla no reinstale las versiones que borraban.
- `app/api/comprobantes-compra/[id]/validar/route.ts`: al deshacer una validación a medias (camino sin la función SQL) ya no intenta borrar el vencimiento recién creado: lo cancela.

**Regla para todo lo que venga:** un vencimiento nunca se borra; se cancela (`estado = 'cancelado'`). No hay otro `DELETE FROM vencimientos` en las migraciones (se revisaron todas, incluidas `20261117p` y `20261117u`); el botón Eliminar del calendario ya cancelaba.

**Quién lee estimados** (revisado: ninguno muestra los cancelados): calendario (descarta `cancelado`), Nueva OP y panel de Finanzas (`estado=pendiente`), pagos de la semana, Jarvis, indicadores de Playroom y proyección de retenciones (`estado = 'pendiente'`), verificación (`pendiente` / `vencido`), detalle de la orden (distinto de `cancelado`). En la lista de vencimientos, con el filtro "Cancelado", se ven con su motivo.

Probado en una base local con el historial y su inmutabilidad creados igual que en producción, encima de la `20261117n` que está hoy en main: editar, validar en partes, finalizar y cancelar funcionan; no se borra ninguna fila y la historia registra cada cancelación.

## Tanda 1-C — app Depósito, recepción (18/11, rama `entrada-t1c-deposito`)

La app (`mobile/apps/deposito`, más una línea en `@gm/core`) y, para los documentos, el servidor. El contrato del outbox que ya existía no cambia (se AGREGA `recepcion.documento`) y la ruta de fotos de hoy tampoco: la app v0.5.3 instalada sigue funcionando igual. Detalle técnico en MOBILE.md §17 "v0.5.4" y "v0.5.5".

| id | Qué quedó |
|---|---|
| E-92 (app) | Una línea con menos de lo pedido va en ámbar ("1 de 2 bultos · faltan 36 u"), en su propio grupo "Llegó menos de lo pedido". Verde es solo lo que llegó completo. |
| E-93 | "Finalizar" con faltantes abre una confirmación con qué llegó y qué falta de cada artículo, y avisa que la orden queda abierta para recibir el resto. Tocar un renglón abre la pantalla de cantidad; la ficha queda en el botón ⓘ. |
| Control de bultos | Lo escrito no se pierde al salir con "atrás"; "Bultos OK" deshabilitado hasta cargar los dos números; "Saltear" pide confirmación. |
| E-38 | Un documento = una o varias hojas (la factura de 3 hojas es UN comprobante). Las fotos se achican al sacarlas; se puede subir un PDF. Anda sin señal: queda en la cola del equipo y sube solo. Cuando sube, el sistema lo lee y la app muestra tipo, número, total y renglones, o por qué no se pudo leer, en castellano. |
| Avisos | Con la sesión vencida la barra dice "Sesión vencida: volvé a ingresar". |

**E-38, segunda parte (hecha el 18/11, con el OK del orquestador al diseño): varias hojas = un comprobante y cola sin señal.** Toca el servidor, sobre `origin/entrada-t1-ocr-match`:

| Qué | Dónde |
|---|---|
| Migración **`20261118d_recepciones_documentos_hojas.sql`** (escrita, sin aplicar, re-ejecutable, no toca documentos existentes): columnas `hojas`, `documento_local_id` (único), `partes_esperadas`, `lectura_estado`, `lectura_iniciada_at`; funciones `recepcion_documento_guardar_hojas` y `recepcion_documento_tomar_lectura` | `supabase/migrations` |
| Outbox `recepcion.documento`: SOLO guarda las hojas y deja el documento "pendiente de leer". No llama a la lectura automática | `lib/mobile/outbox/deposito.ts`, `lib/deposito/documentos-recepcion.ts` |
| `POST /api/recepciones/[id]/ocr/leer`: lee todas las hojas en una sola lectura; dos llamadas no crean dos comprobantes | `app/api/recepciones/[id]/ocr/leer/route.ts` |
| `processWithGemini` acepta varias hojas del mismo comprobante | `lib/services/ocr.ts` |
| Borrar un documento borra todas sus hojas del bucket | `app/api/recepciones/[id]/ocr/route.ts` (DELETE) |

**Sin la migración:** la app vieja no cambia. La app nueva rechaza el envío con un mensaje claro ("Falta actualizar el sistema…"); por eso el orden es servidor y migración primero, APK después.

**Para T1-B (se lo pasa el orquestador):**
- La verificación muestra UNA imagen por documento (`url_imagen` = la primera hoja). Las hojas 2 y 3 están en `recepciones_documentos.hojas` (`[{path, nombre, mime, parte, orden}]`, rutas del bucket `comprobantes`): hay que firmarlas y mostrarlas.
- El "reintentar la lectura" de la verificación (`/api/ordenes-compra/[id]/documentos`) baja solo `storage_path`: en un documento de varias hojas lee la primera nada más. Tiene que llamar a `leerDocumentoRecepcion` (o a `archivosDeDocumento`) de `lib/deposito/documentos-recepcion.ts`, que ya trae todas y usa la compuerta.
- Un documento subido desde la app puede quedar "pendiente de leer" (`lectura_estado = 'pendiente'`) si el operario cerró la pantalla antes de que se leyera: la verificación debería mostrarlo como "falta leer" con el mismo botón.

**Arreglos de la revisión (18/11, APK v0.5.6; sobre `origin/entrada-t1-integra3`):**

| # | Qué | Dónde |
|---|---|---|
| 1 | La lectura dura hasta 300 s y es todo o nada: lo que quedó a medias se deshace y se relee; la compuerta retoma un "leyendo" de más de 6 minutos | `ocr/leer/route.ts`, `leerDocumentoRecepcion`, migración 18d |
| 2 | Documento de más de 12 MB: se lee en tandas de hojas y se unen los renglones. El motivo de "no leído" va en castellano; el error crudo, aparte (`detalle_tecnico`) | `documentos-reglas.ts`, `leerHojas` |
| 3 | `/ocr` y `/ocr/leer` piden el permiso `documentos_recepcion` (admin, administrativo, deposito) | `lib/auth.ts` y las dos rutas |
| 4 | Sin la migración: rechazo claro antes de subir nada ("Falta actualizar el sistema…: avisá a la oficina"). Encabezado de la 18d corregido | `recepcionDeDocumento`, handler |
| 5 | Si la base rechaza el envío, lo subido en ese intento se borra del bucket | `guardarHojasDocumento` |
| 6 | Todas las partes de un documento van a la recepción de la primera | `recepcionDeDocumento` |
| 7 | Una app vieja ve el documento pendiente como "no leído" | `documentoParaApp`, `firmarDocumentosRecepcion` |
| 8 | No se guardan direcciones firmadas: se guarda la ruta y se firma al mostrar | `guardarHojasDocumento`, `leerDocumentoRecepcion` |

**Lo que NO queda cerrado (para T1-B / ocr-match):** `matchAndCreateDetalle` (`lib/services/detalle.ts`) suma lo documentado a la recepción renglón por renglón y guarda el detalle del comprobante al final. Si el servidor corta la lectura justo en el medio de esa carga, las cantidades ya sumadas no tienen renglón que las respalde y `revertirComprobanteOCR` no las puede restar. Para cerrarlo del todo esa carga tiene que ser una sola transacción en la base. Tampoco se deshace sola una lectura a medias sobre un provisorio compartido con otro documento (los renglones no dicen de qué documento salieron): queda "no leído" con aviso a la oficina. La ruta vieja `POST /ocr` (web de depósito) sigue guardando la dirección firmada por 7 días; se ve bien porque todo firma de nuevo al mostrar.

**v0.5.7 (18/11, rama `entrada-t1c-hojas-archivo`, solo la app):** desde "PDF o archivo" se pueden marcar varias fotos de una vez y, con hojas ya cargadas, hay "Otra hoja desde archivo" al lado de "Otra hoja" (cámara). Así la factura que llegó por WhatsApp como 2 o 3 fotos queda en UN comprobante. Un PDF sigue yendo solo.

**Sin probar:** la lectura con varias hojas contra Gemini real, el handler contra Supabase y la pantalla en el NuStar. Probado: las dos funciones SQL en una base local (incluida la compuerta nueva) y las reglas puras (33 pruebas).

## Tanda 2-B — Jarvis de compras, reportes y alertas (19/11, rama `entrada-t2-jarvis`)

**Migración (una sola, solo lectura salvo una tabla nueva): `20261119c_jarvis_compras.sql`.** Requiere aplicadas 20261117n, 20261117p, 20261117b y 20261118d. Crea la tabla `ia_fallas` y las funciones `jarvis_cc_abiertos`, `jarvis_vencimientos_a_mano`, `jarvis_cc_proveedores`, `jarvis_compras`, `jarvis_compras_proveedor_mes`, `jarvis_compras_renglones`, `jarvis_notas_esperadas`, `jarvis_oc_pendientes`, `jarvis_oc_faltantes`, `jarvis_diferencias_compra`, `jarvis_cumplimiento_proveedores`, `jarvis_documentos_sin_leer`, `reporte_iva_compras`, y redefine `jarvis_proveedores_resumen` (misma firma) para que la deuda salga de la cuenta corriente. Sin la migración: las herramientas nuevas contestan "esa consulta todavía no está instalada", los vigías nuevos no avisan nada y el reporte de IVA muestra el crédito fiscal en cero con un aviso.

**Reglas que aplican todas las consultas**
- Comprado = comprobantes de compra **validados**. Sin remitos, sin notas esperadas, sin estimados ni provisiones de órdenes. Las notas de crédito y las reversas restan.
- "En blanco" = con factura; "en negro" = Adquisición y Reversa.
- **Deuda con un proveedor = saldo de la cuenta corriente + vencimientos cargados a mano que no tienen comprobante.** Lo comprometido por órdenes de compra no es deuda y va aparte. Motivo de sumar lo anotado a mano: los vencimientos reales de Juan (cargados antes del circuito nuevo) no tienen movimiento en la cuenta corriente; sin sumarlos, Jarvis diría "no le debemos nada" a un proveedor que tiene pagos anotados en el calendario. Un vencimiento que SÍ viene de un comprobante no se suma dos veces.

**Herramientas nuevas de Jarvis** (`lib/jarvis/herramientas-compras.ts`; todas de solo lectura, cada una devuelve `fuente`)

| Herramienta | Para qué | Quién |
|---|---|---|
| `compras` | Cuánto se compró en un período, con y sin factura; por proveedor, mes, canal o artículo | admin y administrativo |
| `ultima_compra` | Última compra de un artículo o a un proveedor: fecha, comprobante, orden, cantidad, lista, descuentos, costo neto por unidad | admin y administrativo |
| `ficha_proveedor` | Acuerdo de pago con y sin factura, CBU / alias / titular, acepta cheques o e-cheq, exento, tipo de descuento; y con qué medios se le pagó de verdad (esto último solo admin) | admin y administrativo |
| `cuenta_corriente_proveedor` | LA deuda: saldo, comprobantes abiertos, créditos, anotado a mano, comprometido aparte | admin y administrativo |
| `retenciones_proveedor` | Certificados de retención por período | **solo admin** |
| `notas_esperadas` | NC / ND esperadas y si ya llegó la real; busca por palabras del artículo o del motivo | admin y administrativo |
| `ordenes_compra_pendientes` | Qué falta recibir, desde cuándo, estado del envío, artículos que faltan | admin y administrativo |
| `diferencias_factura` | Diferencias de precio y cantidad y cómo se resolvió cada una | admin y administrativo |
| `plan_de_pagos` | La misma cuenta que Finanzas → Pagos de la semana | **solo admin** |

`proveedores` y `pagos_proveedores` ahora informan la misma deuda que `cuenta_corriente_proveedor`; `pagos_proveedores` sigue siendo el calendario (qué vence) y no suma estimados.

**Cómo probar las preguntas de Juan** (Playroom → Jarvis, con la migración aplicada)
1. "¿Cuándo fue la última compra de crema dental Colgate de 70?" → usa `ultima_compra`: fecha, comprobante, orden, cantidad y costo neto por unidad. Con un artículo sin compras validadas tiene que decir que no hay compras cargadas de eso, no "nunca se compró".
2. "¿Cómo le pagamos a Hornal?" → `ficha_proveedor`: acuerdo con y sin factura, CBU, si acepta cheques. Con usuario admin agrega cómo se le pagó de verdad; con administrativo aclara que eso solo lo ve un administrador.
3. "¿Cuánto compramos en blanco en el último año? ¿Cuánto en negro?" → `compras` con período `ultimos_12_meses`: los dos totales en una sola llamada. Comparar contra el reporte "Compras por proveedor y mes" con las mismas fechas: los totales tienen que coincidir.
4. "De Colgate devolvimos 12 cremas dentales hace unos meses, ¿me buscás si está hecha la nota de crédito?" → `notas_esperadas` con proveedor Colgate y buscar "cremas dentales": dice si llegó (número y fecha) o si se espera (desde cuándo, por cuánto). Si no hay nada anotado, lo dice.
5. "¿Cuánto le debemos a Hornal?" → `cuenta_corriente_proveedor`: tiene que dar el mismo saldo que la pantalla Proveedores → cuenta corriente, más lo anotado a mano si lo hubiera, y lo comprometido aparte.
6. "¿Qué estamos esperando que llegue?", "¿qué falta de la OC-000012?" → `ordenes_compra_pendientes`.
7. "¿Qué hay que pagar esta semana? ¿Alcanza el banco?" (admin) → `plan_de_pagos`: mismos números que Finanzas → Pagos de la semana.
8. Con usuario administrativo: "¿cuánto le retuvimos a X?" → tiene que contestar que es solo para administradores.

**Vigías nuevos** (`lib/jarvis/vigias-compras.ts`, corren con la revisión diaria): nota de crédito esperada sin llegar hace más de 30 días; orden enviada sin recibir pasada la fecha estimada; factura validada con diferencia de precio sin resolver (usa la misma cuenta que la pantalla de verificación, hasta 25 órdenes con facturas de los últimos 90 días); documento de recepción sin leer hace más de un día; y falla de la IA por saldo o cuota (E-101).

**E-101:** `lib/ai/fallas-ia.ts`. Un error 402 o 429 de Gemini (o un mensaje de facturación / cuota) se anota en `ia_fallas` y deja al instante un aviso de alerta en la bandeja de Jarvis; el vigía lo mantiene mientras haya fallas en las últimas 24 horas y lo cierra solo. Está enganchado en la lectura de comprobantes de compra (`lib/services/ocr.ts`) y en todo lo que usa `conRespaldoGemini` (cheques, extractos, legajo). Las lecturas que llaman a Gemini directo (adjuntos de mails, gasto del chofer) todavía no avisan.

**E-100:** `lib/services/ocr.ts`. La lectura pide además CUIT del emisor, CAE y letra. Con los tres, `inferirTipoComprobante` devuelve FA / FB / FC aunque haya una leyenda "sin valor fiscal" o no se hayan leído impuestos, y la lectura agrega el aviso "CONFIRMÁ EL TIPO…", que ya se muestra junto al documento. No se tocó la pantalla de verificación: la confirmación es ese aviso, no un bloqueo.

**Reportes (E-81):** Playroom → "Compras y proveedores" (`components/playroom/reportes/ReportesCompras.tsx`, `GET /api/playroom/compras`): compras por proveedor y mes, evolución del costo de un artículo, antigüedad de la deuda, retenciones por período (solo admin), órdenes pendientes de recibir, cumplimiento del proveedor y notas esperadas por antigüedad. Exportan a CSV para Excel, como los demás informes. `/api/reportes/iva`: el crédito fiscal sale de `reporte_iva_compras`.

**Límites conocidos**
- No se probó contra la base real ni con Jarvis en vivo: las consultas se probaron en una base local con datos armados (compras, deuda, notas, órdenes, diferencias, IVA) y el código pasa el typecheck.
- "Cumplimiento" y "diferencias" cuentan lo ya RESUELTO en la verificación; lo que nadie resolvió lo ve el vigía de diferencias de precio, no el reporte.
- La evolución del costo mezcla compras validadas con el historial de precios de compra; los cambios de lista hechos desde "Listas de proveedores" no figuran si esa pantalla no los anota en el historial.
- En `notas_esperadas`, una nota que llegó se reconoce porque conserva el motivo; una nota de crédito cargada suelta, sin haber estado esperada, no aparece ahí (sí en `compras`, restando).
