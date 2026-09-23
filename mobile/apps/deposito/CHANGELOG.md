# GM Depósito — CHANGELOG

Formato: una sección por versión publicada (la agrega `npm run build:apks` con el
texto de `--notas`). Más nueva arriba.

## v0.2.3 (versionCode 6) — 2026-09-22

- Foto del articulo en la ficha: el catalogo vuelve a bajar completo tras el cambio de version del dataset

## v0.2.2 (versionCode 5) — 2026-09-22

- Build de diagnostico: DevTools del WebView abierto

## v0.2.1 (versionCode 4) — 2026-09-22

- Descripción del artículo en dos líneas (antes se cortaba) y ficha del artículo al tocar el renglón: foto, SKU, marca y unidades por bulto

## v0.2.0 (versionCode 3) — 2026-09-18

Primera versión completa: réplica fiel del módulo web `/deposito`, offline-tolerante.

- **Inicio** con la cantidad de pedidos / órdenes / devoluciones pendientes.
- **Preparar pedidos**: cola por prioridad con progreso en curso; picking completo sin señal
  (cantidad, parcial, faltante por swipe, volver a pendiente, bonificados recalculados igual que
  el servidor, finalizar). El progreso de un pedido a medias sobrevive a cerrar la app o perder WiFi.
- **Varios operarios en el mismo pedido**: cada renglón es de quien lo marca primero (🔒 con el
  nombre); si dos lo marcan a la vez sin señal, el segundo ve el rechazo con el motivo y "Entendido".
- **Lector**: el gatillo abre la cantidad del renglón; un segundo gatillo sobre el mismo artículo
  confirma sin tocar la pantalla. Buscar y tocar sigue siendo de primera (mercadería sin etiqueta);
  la búsqueda es local y los artículos del pedido / la OC salen primero.
- **Recibir mercadería**: control de bultos, conteo, faltantes, artículos fuera de OC y finalizar,
  todo sin señal (incluso si la recepción todavía no existe en el servidor). Fotos + OCR: solo con señal.
- **Devoluciones** y **Modificación de artículos** (stock, datos, recorridos por orden de depósito /
  proveedor / categoría / sin código, retoma donde quedó).
- **Cambio de usuario** sin perder lo pendiente: lo que dejó sin enviar un operario se envía solo, a su
  nombre, aunque ya haya ingresado otro. El login recuerda los usuarios del equipo.
- **Aviso de pedido urgente** en cualquier pantalla. Botón atrás: siempre a la pantalla anterior;
  en el inicio minimiza.
- Al recuperar la señal, lo pendiente se envía en segundos (sin esperar reintentos largos).

Probado en: **NuStar 65-sp real** (Android 14, WebView 127) — arranque en frío 0,46–0,60 s; picking
sin red, app matada desde recientes y reabierta sin perder nada, atrás físico hasta minimizar, envío
único al reconectar. Esas pruebas corrieron contra el ERP falso (`mobile/scripts/mock-deposito.mjs`).
**Pendiente con backend real**: requiere desplegar la rama `apk-deposito` en `main` (ver MOBILE.md →
"Depósito · Puesta en marcha"). **Lector físico**: este NuStar no tiene servicio de escaneo; la ráfaga
se simuló con `adb input text` (tiempos irregulares) — validar el doble gatillo con un lector real.

## v0.1.1 (versionCode 2) — 2026-09-18

- Fix: la sesión guardada no se restauraba en arranque en frío sin red (prefijo del almacén seguro); lectura del Keystore con reintentos

## v0.1.0 (versionCode 1) — 2026-09-18

- Shell de la fundación móvil (sin módulos portados)

