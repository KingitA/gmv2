# Catálogo navegable del Módulo Vendedor — Handoff

**Fecha:** 2026-07-07 · **Commit:** `4859c0d` · **Estado:** en producción (Vercel auto-deploy desde main)

Este documento explica todo lo implementado en el rediseño del catálogo de `/vendedor/pedido/nuevo` para que otra sesión pueda continuar el trabajo sin releer el diff.

---

## 1. Qué pidió el usuario

Rediseñar el frontend de armado de pedidos del vendedor (app móvil para Samsung Tab A9), inspirado en una captura de referencia de una app de venta directa (tarjetas pastel con ilustraciones line-art):

1. Agregar **Novedades** (últimos artículos cargados al sistema) a las vistas existentes (habituales, ofertas, buscar).
2. Layout del home del catálogo: **barra buscadora arriba** → **3 banners lado a lado** (Novedades, Ofertas, Habituales) → **3 tarjetas de rubro con ilustraciones**.
3. Al entrar a un **rubro**: todas sus categorías como tarjetas. Al entrar a **Ofertas/Novedades/Habituales**: solo las categorías que tienen artículos dentro de ese filtro, y al abrir una categoría, solo los artículos de esa categoría que cumplen el filtro (ej. ofertas de esa categoría).
4. Tarjetas también para categorías y subcategorías.
5. **Restricción:** no tocar backend. El usuario autorizó explícitamente (2026-07-07) la única excepción: **endpoints GET de solo lectura** en `app/api/vendedor/`. Cero escrituras, cero migraciones, cero cambios en pedidos/precios. Cualquier cambio de backend futuro fuera de eso requiere pedirle permiso de nuevo.

## 2. Datos en la DB (ya existían — NO se migró nada)

Supabase, proyecto `ugkttgqgyhvkprpdmqql`. Verificado por conexión readonly (string en la memoria `project-gmv2`):

- **`rubros`** (3): Perfumería, Limpieza, Bazar. Columnas: `id, nombre, slug, orden`.
- **`categorias`** (43): `id, rubro_id, nombre, orden`. Ej: Perfumería→CABELLO (354 arts), Limpieza→AROMATIZANTES DE AMBIENTE (260), Bazar→COCINA Y VAJILLA (157).
- **`subcategorias`** (208): `id, categoria_id, nombre, orden`.
- **`articulos`**: tiene `rubro_id`, `categoria_id`, `subcategoria_id` (FKs reales: `articulos_rubro_id_fkey`, etc.) e `imagen_url`. De 3.207 activos: 3.149 con rubro, 3.110 con categoría y subcategoría, 374 con imagen. OJO: también existen columnas **legacy de texto** `rubro`, `categoria`, `subcategoria` (varchar) — por eso los joins usan alias `rubro_info`/`categoria_info`/`subcategoria_info` (un alias igual al nombre de una columna existente chocaría).
- "Novedades" = artículos activos ordenados por `created_at desc`. Funciona bien: hay ingresos recientes con imagen.

## 3. Cambios de backend (solo lectura, autorizados)

### 3.1 Nuevo: `app/api/vendedor/catalogo/route.ts`

`GET /api/vendedor/catalogo` → `{ rubros: [{ id, nombre, slug, categorias: [{ id, nombre, cantidad, subcategorias: [{ id, nombre, cantidad }] }] }] }`

- Protegido con `requireVendedor()` como el resto del módulo.
- Devuelve la taxonomía completa con **conteo de artículos activos** por categoría y subcategoría. Filtra categorías con 0 artículos.
- Los conteos se calculan trayendo `categoria_id, subcategoria_id` de todos los artículos activos **paginado de a 1000** (PostgREST corta en 1000 filas; hoy son ~3.200 → 4 páginas) y agrupando en JS. Si el catálogo creciera mucho, considerar una vista o RPC (requeriría permiso del usuario por ser migración).

### 3.2 Modificado: `app/api/vendedor/articulos/route.ts`

- **SELECT ampliado**: se agregaron `imagen_url, rubro_id, categoria_id, subcategoria_id` y los joins `rubro_info:rubro_id(nombre), categoria_info:categoria_id(nombre), subcategoria_info:subcategoria_id(nombre)` (mismo patrón que el `marca:marca_id(descripcion)` que ya existía).
- **`mapArticulo` ampliado**: expone `imagen_url, rubro_id, categoria_id, subcategoria_id, rubro_nombre, categoria_nombre, subcategoria_nombre`.
- **Nueva vista `novedades`**: activos por `created_at desc`, límite 80. Filtros opcionales `categoria`/`subcategoria`.
- **Nueva vista `categoria`**: catálogo completo de una categoría (`categoria` obligatorio, `subcategoria` opcional), orden alfabético, límite 500. Se usa al navegar por rubro.
- **Vista `ofertas`**: ganó filtros opcionales `categoria`/`subcategoria` y el límite subió de 100 a 300 (el agrupado por categoría se hace client-side sobre la lista completa; con 100 se podían perder categorías).
- **Sin cambios**: `habituales` (misma lógica de frecuencia por cliente) y `buscar` (motor híbrido). Todo retrocompatible: los params nuevos son opcionales.

API resultante: `GET /api/vendedor/articulos?vista=habituales|ofertas|novedades|categoria|buscar&cliente=&q=&categoria=&subcategoria=`

## 4. Frontend

### 4.1 Nuevo: `app/vendedor/pedido/nuevo/catalogo-ui.tsx`

Sistema visual del catálogo. **La firma del diseño: cada rubro tiene un tinte propio que codifica la taxonomía** y acompaña rubro → categorías → contexto.

- **`Tinte`** = `{ bg, bgSoft, ink, accent, border }` (hex).
- **`tinteRubro(nombreOrSlug)`**: matchea por nombre normalizado (sin acentos) → Perfumería **malva** (`#F2EBF7`/`#5C3F70`/`#9B72B0`), Limpieza **aqua** (`#E3F2EF`/`#1F5F55`/`#4BA396`), Bazar **arena** (`#F8EFE2`/`#7C5327`/`#C68A52`). Fallback neutro gris.
- **Tintes de vistas**: `TINTE_NOVEDADES` (verde), `TINTE_OFERTAS` (coral), `TINTE_HABITUALES` (ámbar).
- **`ArteRubro`**: 3 ilustraciones SVG line-art inline dibujadas a mano (stroke `currentColor`, relleno con `accent` al 14%): frasco de perfume con atomizador y gotas; rociador con burbujas; olla humeante con cubiertos. Se eligen por nombre del rubro.
- **`IconoCategoria`**: ~26 mini-íconos SVG (24×24, stroke 1.9) mapeados por **regex sobre el nombre normalizado** de la categoría (`/cabello/`, `/bucal|dental/`, `/termo|mate/`, `/iluminacion|electricidad|pila/`, etc.). Cubre las 43 categorías actuales; ícono genérico de caja como fallback. **Si se agregan categorías nuevas en la DB, agregar su keyword acá** (orden importa: gana el primer match del array `ICONOS`).
- Detalle: la normalización usa `/[̀-ͯ]/g` con escapes explícitos (una versión anterior con caracteres combinantes literales en el regex era frágil).

### 4.2 Reescrito: `app/vendedor/pedido/nuevo/page.tsx`

**Lo que NO cambió** (copiado tal cual del original): selector de cliente, sheet de detalle de artículo con precio en vivo (`previewPrecioArticulo` server action), carrito, barra flotante, pantalla de confirmación (`createPedido`), pantalla de éxito, método de facturación override, observaciones. **No tocar nada de eso sin necesidad.**

**Lo que cambió — máquina de navegación client-side:**

```ts
type Filtro = "novedades" | "ofertas" | "habituales"
type Ctx = { tipo: Filtro } | { tipo: "rubro"; rubroId; rubroNombre }
type Nav = { s: "home" } | { s: "cats"; ctx: Ctx } | { s: "arts"; ctx: Ctx; catId; catNombre; rubroNombre }
```

- **`home`**: buscador (header) + grid de 3 banners (`FILTROS`, con ícono/label/sub/tinte) + tarjetas de rubro (`grid-cols-1 sm:grid-cols-3`; horizontales en teléfono, verticales en tablet). La taxonomía se carga una vez por cliente desde `/api/vendedor/catalogo` → estado `catalogo`.
- **Búsqueda**: solo en home; con texto reemplaza el contenido por resultados (debounce 400ms, `vista=buscar`). El botón ← primero limpia la búsqueda.
- **`cats` con ctx filtro**: al entrar se hace **una sola fetch** de la lista completa del filtro (`vista=novedades|ofertas|habituales`), se cachea en `listas[tipo]` (no se re-fetchea al volver a entrar) y las tarjetas de categoría salen de **agrupar client-side** por `categoria_id` (memo `categoriasCtx`), ordenadas por cantidad desc. Artículos sin categoría se agrupan en "Otros" (key `"otros"`, `catId null`). Cada tarjeta se tiñe según el rubro del artículo (`tinteRubro(a.rubro_nombre)`).
- **`cats` con ctx rubro**: tarjetas desde la taxonomía (`catalogo`), sin fetch extra.
- **`arts` con ctx filtro**: filtra `listas[tipo]` client-side por `categoria_id` — así "Ofertas → CABELLO" muestra solo ofertas de cabello. Sin fetch.
- **`arts` con ctx rubro**: fetch `vista=categoria&categoria=<id>` → estado `artsCategoria` (no cacheado entre categorías).
- **Chips de subcategoría** (`subchips`): derivados de los artículos presentes en la lista base (no de la taxonomía), con conteo, orden por cantidad; solo se muestran si hay >1; filtrado client-side (`subSel`). Se resetean al navegar.
- **Header contextual**: título/subtítulo cambian según pantalla; ← hace pop de `nav` (arts→cats→home→`router.back()`).
- **Tarjeta de artículo** (`ArticuloCard`, componente inline compartido por búsqueda/filtros/categoría): agrega **miniatura 48px** si `imagen_url` (lazy). El sheet de detalle también muestra imagen 64px. Resto igual al original (marca·proveedor, u/bulto, stock, badge -X%, ✓ cantidad en carrito).

## 5. Decisiones de diseño y trade-offs

- **Agrupado client-side vs server-side** para los filtros: las listas son chicas (ofertas ≤300, novedades ≤80, habituales ≤60), así que una fetch + agrupado en memoria evita un endpoint de conteos por filtro y hace la navegación instantánea. Los filtros server-side `categoria`/`subcategoria` en ofertas/novedades **existen pero hoy la UI no los usa** — quedaron disponibles por si las listas crecen y conviene re-fetchear filtrado.
- Si las ofertas superaran 300 artículos, el agrupado podría perder categorías → subir el límite o pasar a conteos server-side.
- Tailwind CSS 4 (clases dinámicas tipo `w-5.5` funcionan); los tintes van por `style` inline porque son hex custom por rubro, no tokens de Tailwind.
- No se agregaron fuentes externas ni dependencias. Todos los SVG son inline (sin requests).
- Chrome de la app se mantuvo **emerald** (identidad existente del módulo vendedor).

## 6. Cómo verificar

1. `npm run build` pasa limpio (verificado antes del push).
2. En la app (usuario con rol `vendedor`): `/vendedor/pedido/nuevo` → elegir cliente → debe verse buscador + 3 banners + 3 rubros ilustrados.
3. Ofertas → elegir una categoría → todos los artículos listados deben tener badge de descuento.
4. Rubro → categoría → chips de subcategoría filtran la lista.
5. Agregar al carrito y confirmar pedido: flujo intacto (precio vivo, método facturación, observaciones).

## 7. Pendientes / ideas para continuar

- **Íconos de categorías nuevas**: mantener el mapa `ICONOS` en `catalogo-ui.tsx` cuando se agreguen categorías.
- **Conteos en los banners** del home (ej. "12 ofertas"): hoy no se muestran; requeriría fetch temprano de las listas o un endpoint liviano de conteos.
- **Imágenes reales en tarjetas de categoría**: `categorias` no tiene columna de imagen; si el usuario quisiera fotos por categoría habría que agregar columna (migración → **pedir permiso**).
- **Cache de `artsCategoria`** por categoría (hoy re-fetchea al re-entrar) si se nota lento en campo.
- **Habituales** sigue siendo por cliente (frecuencia últimos 30 pedidos) — sin cambios; si el cliente es nuevo, la vista queda vacía con mensaje orientativo.
- Probar en la Tab A9 real (el usuario valida en gmv2.vercel.app tras cada push).

## 8. Reglas de trabajo de esta sesión (respetarlas)

- Clon compartido entre sesiones: **commitear solo con paths explícitos, nunca `git add -A`** (ver memoria `feedback-clon-compartido`).
- Commit + push tras cada cambio (Vercel auto-deploya main).
- Backend: solo lectura autorizada en `app/api/vendedor/`; todo lo demás (escrituras, migraciones, lógica de pedidos/precios) requiere permiso explícito del usuario.
- El usuario aplica SQL a mano en el SQL Editor de Supabase si hiciera falta (pasarle scripts listos).
