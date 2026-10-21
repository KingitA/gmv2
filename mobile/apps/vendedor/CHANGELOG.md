# GM Vendedor — CHANGELOG

Formato: una sección por versión publicada (la agrega `npm run build:apks` con el
texto de `--notas`). Más nueva arriba.

## v0.4.2 (versionCode 11) — 2026-10-21

- Ficha del cliente: el saldo proyectado muestra de dónde sale (cobros sin confirmar, 10% contado, devoluciones) y dice A favor cuando corresponde

## v0.4.1 (versionCode 10) — 2026-10-21

- Rendición: propone el efectivo cobrado menos lo que retiraste (antes el retiro quedaba a tu favor si no tocabas el número)

## v0.4.0 (versionCode 9) — 2026-10-19

- Billetera en dos cajitas y retiro de la cuenta personal; 10% contado con la regla del 07/10; Resumen con el proyectado de lo guardado sin enviar; devoluciones valuadas como el servidor; descuento general y contado por pedido; condiciones por proveedor/marca; mercadería por cupo eligiendo artículos; sin precio base no se vende

## v0.3.1 (versionCode 8) — 2026-10-14

- Resumen de cuenta en Cobrar (igual al ERP); tocar un comprobante abre su PDF para compartir y se pueden compartir varios; cartel Datos al solo si hace mas de 15 min; formatos nuevos de fecha, moneda y CUIT

## v0.3.0 (versionCode 7) — 2026-10-14

- Lista y metodo por segmento a la vista; venta a cliente nuevo (comparar listas, datos al final, sin senal); ficha por segmento como el ERP; primer pedido de un cliente en revision de oficina; nunca un pedido sin lista o metodo; saldo de billetera unico; Precios agrega columnas; foto de cheques con lectura validada

## v0.2.3 (versionCode 6) — 2026-09-23

- Colores nuevos (sistema Megasur): barra azul, fondos claros, ofertas en ámbar, pendientes de enviar en lavanda. Mismas pantallas y funciones

## v0.2.2 (versionCode 5) — 2026-09-23

- Validada contra producción: el alta de un cliente se ve en la cartera al instante; la lista de artículos comprados (devoluciones) vuelve a cargar

## v0.2.1 (versionCode 4) — 2026-09-21

- Cartel cuando hace mas de 24 hs que no se actualizan los precios; un cobro rechazado por la oficina se ve en el inicio y ya no traba lo cargado despues

## v0.2.0 (versionCode 3) — 2026-09-21

- App Vendedor completa: pedidos, clientes, cobros, devoluciones, billetera, viajes y precios, funcionando sin señal
- Todas las pantallas del módulo web `/vendedor`, con las mismas funciones y reglas: inicio, billetera y comisiones, rendiciones, mis pedidos y detalle, pedido nuevo (catálogo por rubro, proveedor, novedades, ofertas y habituales; búsqueda; ficha del artículo; condiciones del pedido; carrito), clientes (listado, ficha, nuevo, cobrar, devolución), estadísticas, viajes, precios y pago
- Sin señal: el catálogo, los precios, la cartera con saldos, los pedidos y los viajes están en el equipo. El precio se calcula en el equipo con el mismo motor que factura
- El pedido a medio cargar se guarda solo en el equipo (no se pierde si se cierra la app). Al confirmarlo queda "pendiente de enviar", se puede editar o descartar, y se envía solo cuando vuelve la señal, una sola vez
- Cobros, devoluciones, altas y cambios de ficha, y viajes también se pueden cargar sin señal; lo cobrado queda reservado para no cobrarlo dos veces
- Botón atrás: siempre vuelve a la pantalla anterior (ficha de artículo, foto, panel del cliente, detalle de comisión, etc.); en el inicio minimiza la app
- Con conexión solamente: rendir, leer la foto de un cheque/transferencia, consulta BCRA, abrir PDF de facturas y remitos, crear localidades y zonas, e identificar un producto por foto (la foto del código de barras sí funciona sin señal)
- Probada en el NuStar 65-sp contra un servidor de prueba con el catálogo real (1.841 artículos): búsqueda en 53–185 ms, arranque en frío 1,1–1,3 s, botón atrás físico. Pendiente: prueba contra el sistema real (requiere publicar el servidor y aplicar la migración `20260921_mobile_vendedor.sql`)

## v0.1.1 (versionCode 2) — 2026-09-18

- Fix: la sesión guardada no se restauraba en arranque en frío sin red (prefijo del almacén seguro); lectura del Keystore con reintentos

## v0.1.0 (versionCode 1) — 2026-09-18

- Shell de la fundación móvil (sin módulos portados)

