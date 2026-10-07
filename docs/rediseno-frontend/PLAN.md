# Rediseño del frontend — CLIENTES y PROVEEDORES

Rama: `rediseno-frontend` (worktree `Desktop/gmv2-frontend`). Relevamiento: 07/10/2026, sobre producción (navegando el ERP con el usuario del dueño) + lectura completa del código + base en solo lectura.

---

## 1. Lo que encontré recorriendo el sistema como usuario

### Lo que anda bien y NO voy a tocar (solo reubicar)
- **Vencimientos**: calendario mensual, "cinta de pagos" que suma lo seleccionado, filtros por forma de pago, alertas ⚠ de descuentos sin aplicar. Es la mejor pantalla del sistema; se reutiliza tal cual dentro de PROVEEDORES.
- **Panel de pedido** (lateral): ya tiene Generar, Vista previa, Imprimir, Repreciar, Registrar pago, Editar, Eliminar, Cambiar estado, Asignar viaje, comprobantes/remitos, email original. Se reutiliza el MISMO componente (se extrae, no se copia).
- **Ficha de cliente, cuenta corriente, editor de pedido, hoja de ruta del viaje, Nueva OP (con retención RG 830), verificación de OC**: tienen URL propia y funcionan. Se enlazan, no se reescriben.
- **Finanzas, Artículos, Playroom**: quedan exactamente como están (solo pasan a ser pestañas).

### Lo que incomoda o está roto (visto en pantalla)
| # | Problema | Dónde |
|---|---|---|
| 1 | 1.462 pedidos en una sola lista, sin paginar; 1.120 son "impreso" de hace más de 30 días | /clientes-pedidos |
| 2 | Solo se filtra por estado: no hay vendedor, zona, fecha ni viaje; no hay selección múltiple ni suma | /clientes-pedidos |
| 3 | Abrir un pedido no cambia la URL → "atrás" te saca de la pantalla y perdés filtros y pedido | casi todo el sistema |
| 4 | Modales angostos y cortados: el componente base fija 512 px y le gana al ancho que pide cada pantalla; 46 modales sin scroll ni alto máximo | modal de artículos, proveedores, tablas, etc. |
| 5 | El celular no está contemplado: menú lateral fijo de 230 px, sin menú hamburguesa; además el sistema **bloquea el zoom** en el teléfono | todo |
| 6 | No se actualiza solo: solo el picking del pedido abierto. Lo que carga otro no aparece hasta refrescar | todo |
| 7 | Dashboard: dice "1.446 en proceso" pero "Pedidos activos" aparece vacío y la distribución se corta en 1.000 | / |
| 8 | Clientes muestra "NO HAY CLIENTES REGISTRADOS" 3-4 s antes de cargar | /clientes |
| 9 | Ficha de cliente con dos botones de guardar distintos | /clientes/[id] |
| 10 | Botón "MOSTRADOR" en pedidos abre la carga manual de pedido, no el mostrador | /clientes-pedidos |
| 11 | `/imports` da 404 (la bandeja real es /clientes-pedidos/import-review y solo se llega desde el chat de IA) | — |
| 12 | Pagos de clientes: los pasos saltan de 1 a 3 | /pagos-clientes |
| 13 | Link roto en cuenta corriente: `/pedidos/...` no existe | /clientes/[id]/cuenta-corriente |
| 14 | "Marcar pagado" de un vencimiento de proveedor: el calendario lo prohíbe (obliga OP) pero la vista Lista lo permite → inconsistencia | /vencimientos |
| 15 | Hay 3 formularios para crear vencimiento y 2 para editarlo, cada uno con campos distintos | vencimientos/finanzas |
| 16 | Modal de artículo: todo mezclado sin títulos (proveedor, IVA, orden de depósito, precios, segmento) | /articulos (se ve en fase posterior) |

### Funciones repetidas (riesgo de duplicar datos — NO se duplica nada nuevo)
- Generar comprobantes: panel del pedido **y** "Pedidos sin facturar" de Comprobantes de venta.
- Cobranza multi-cliente: `/cobranzas/nueva` **y** modo multi de `/pagos-clientes` (misma API).
- Importación de pedidos: cola en memoria de la pantalla de pedidos **y** bandeja `/clientes-pedidos/import-review`.
- Dos pantallas cambian el estado del pedido "a mano" salteando las reglas (`mostrador` → entregado, `comprobantes-venta` → facturado). Lo anoto; no lo toco en esta etapa.

---

## 2. Cómo va a quedar

### Navegación nueva (reemplaza el menú lateral)
Barra superior tipo pestañas de explorador: **CLIENTES · PROVEEDORES · ARTÍCULOS · FINANZAS · PLAYROOM · AJUSTES**.
- En celular: la barra se vuelve un menú inferior (íconos grandes) y cada pestaña muestra sus accesos en un menú "⋯".
- Cada pestaña tiene una fila de accesos secundarios (chips) con lo que hoy está en el menú lateral de esa área.
- Las URLs viejas siguen funcionando (nadie pierde favoritos; las apps de celular no se tocan).
- Visibilidad por rol: igual que hoy (FINANZAS y Usuarios solo admin; vencimientos de sueldos/socios solo admin).

### CLIENTES (pantalla de inicio del sistema)
1. **Calendario de viajes** arriba: muestra **esta semana**; botón "ver mes" lo despliega; flechas para meses anteriores/posteriores. Cada viaje muestra zona, chofer, cantidad de pedidos y total. Click → hoja de ruta (pantalla existente). Arrastrar un viaje a otro día = cambia la fecha (ya existe). "+ Programar viaje" (el diálogo existente).
2. **Pedidos** abajo, en tabla compacta (una fila por pedido):
   - Filtros: estado, vendedor, zona, fecha (desde/hasta), viaje (con/sin), prioridad, búsqueda. **Por defecto: últimos 30 días, sin entregados ni eliminados** (los viejos se ven cambiando el filtro).
   - Todo filtro queda en la URL: atrás/adelante y copiar el link a un compañero funciona.
   - Selección múltiple con **suma de total y bultos** en una barra fija abajo. Acciones en lote: asignar a viaje, cambiar prioridad, imprimir.
   - Prioridad: columna con selector (Urgente/Alta/Normal), además del arrastre que ya existe.
   - Click en un pedido → el mismo panel lateral de hoy, pero con `?pedido=001755` en la URL.
   - **Arrastrar pedidos** (uno o varios seleccionados) a un viaje o a un día del calendario:
     - sobre un viaje → se agrega al viaje (misma función que usa hoy la hoja de ruta);
     - sobre un día sin viaje → si son 2 o más de la misma zona: "Hay N pedidos de ZONA para el JUEVES 9. ¿Crear un viaje?" → crea el viaje con el diálogo de siempre y les asigna los pedidos.
3. **Botones de acción**: Importar pedido (archivos/IA), Pedido manual, Mostrador (el verdadero), Programar viaje.
4. **Accesos** (chips): Fichas de clientes · Cuentas corrientes · Comprobantes emitidos · Revisión de devoluciones · Caja (cobranzas y rendiciones) · Viajantes · Transportes. (Ver aclaraciones 5 y 7.)

### PROVEEDORES
1. **Calendario de vencimientos** arriba (el de hoy), con modo semana por defecto y "ver mes".
   - Filtros de hoy + proveedor + tipo; "cinta de pagos" con la suma de lo seleccionado.
   - **Arrastrar un vencimiento a otro día** = cambia la fecha (nuevo; usa la API existente).
   - Click → **un único** diálogo "Editar pago" con TODOS los campos (fecha, monto, forma, modalidad, concepto, descuentos aplicados, estimado, validez, observaciones) + Generar OP / Marcar pagado / Recalcular desde ficha / Eliminar. Se unifican los 2 diálogos de edición y los 3 de alta en uno solo (mismo guardado de siempre).
2. **Lista** de vencimientos abajo con los mismos filtros (en la URL) y selección múltiple con suma.
3. **Botones**: Nuevo pago/gasto · Nueva orden de compra · Nueva orden de pago.
4. **Accesos**: Proveedores (fichas + ficha fiscal) · Cuentas corrientes · Órdenes de pago · Órdenes de compra · NC esperadas · Listas de precios · Retenciones (planilla / TXT SICORE).

### ARTÍCULOS · FINANZAS · PLAYROOM
Sin cambios de contenido. Solo heredan el arreglo general de modales (ancho/scroll).

### AJUSTES
Una pantalla con todo lo de configuración, agrupado:
- **Personas**: Usuarios y roles · Viajantes/vendedores · Usuarios portal B2B (usuarios-crm)
- **Logística**: Zonas · Localidades · Vehículos · Transportes · Condiciones de entrega
- **Comercial**: Listas de precio · Condiciones de pago · Tipos de canal · Precios programados
- **Artículos**: Marcas · Rubros/categorías · Tipos de bulto · Tipos de fracción
- **Fiscal y bancos**: Bancos/cuentas · Padrón IIBB
- (Más adelante, si querés: cajas, numeración de comprobantes, datos de la empresa — hoy no tienen pantalla y algunas están fijas en el código.)

### Arreglos generales (todo el sistema)
- Modales: alto máximo de pantalla con scroll interno, ancho real según lo que pide cada uno, a pantalla completa en el celular. Se arregla en el componente base → mejora los 76 modales de una sola vez.
- Habilitar el zoom en el teléfono.
- Actualización EN VIVO en todas las pantallas principales (ver aclaración 9).
- Esperas con barra de progreso y mensajes, nunca "no hay datos" mientras carga (aclaración 10).

---

## 3. Lo que NO cambio
- Ninguna regla de negocio, cálculo de precios, comprobantes, OP, retenciones, cuentas corrientes ni caja.
- Ninguna API ni tabla (no hay migraciones en este plan).
- Las apps de vendedor, chofer y depósito.
- Las pantallas de detalle existentes (editor de pedido, ficha de cliente, hoja de ruta, nueva OP, verificación de OC): se enlazan tal cual.
- No borro pantallas viejas: quedan accesibles por URL hasta que confirmes que no se usan.

---

## 4. Etapas (cada una se prueba en un preview antes de seguir)
1. **Cimientos**: barra de pestañas + versión celular, arreglo de modales, zoom, helper de URL, refresco automático. Nada cambia de lugar todavía salvo el menú.
2. **CLIENTES**: calendario semana/mes de viajes + tabla de pedidos con filtros, selección, suma, prioridad, panel con URL.
3. **Arrastrar pedidos** a viajes/días + sugerencia "crear viaje".
4. **PROVEEDORES**: calendario semana/mes + arrastre de vencimientos + diálogo único de edición + lista con selección.
5. **AJUSTES** + accesos de cada pestaña + arreglos sueltos (#7–#13).
6. Revisión completa en PC, notebook y celular con distintos zoom → merge a main.

---

## Estado

**Etapa 1 (07/10/2026) — hecha en la rama, falta prueba del dueño en preview:**
- Barra de pestañas (`components/layout/top-nav.tsx`, config `lib/navegacion.ts`) reemplaza al menú lateral; en celular, pestañas abajo. Contenido scrollea en `#erp-main`. Apps (depósito/chofer/vendedor) y login sin cambios. Inicio del ERP = `/clientes-pedidos`.
- Zoom libre en el ERP, bloqueado en las apps (`generateViewport` + header `x-pathname` del middleware).
- Modales: ancho real del que llama, alto máximo de pantalla con scroll, ancho completo en celular (Dialog, AlertDialog, Sheet). Barras de scroll visibles siempre (globals.css).
- URL: pedido abierto/búsqueda/estado en Pedidos; mes en Viajes; vista en Vencimientos y Cuenta corriente; día y pestaña en Caja.
- En vivo (requiere la migración): Pedidos, Viajes, hoja de ruta, Vencimientos (calendario y lista), Clientes, Caja, Comprobantes de venta, Órdenes de pago, Devoluciones, Proveedores.
- Esperas con barra + mensajes: importación de pedido por archivo, lista de pedidos, clientes, viajes, calendario de vencimientos.
- Arreglos: link roto de cuenta corriente → abre el pedido; "No hay clientes" falso mientras carga.

**Etapa estilo visual (07/10/2026) — hecha en la rama, falta prueba del dueño:**
- Paleta Megasur en todo el ERP (`app/megasur-tema.css`, mismas familias que la app Vendedor), tipografía Archivo, interfaz sin mayúsculas forzadas (datos de tablas siguen en mayúscula; apps de calle sin cambios).
- Componentes base: campos más altos y legibles, etiquetas con jerarquía, encabezados de tabla suaves, modales con bordes y sombra nuevos.
- Fichas por secciones (`components/ficha/ficha.tsx`): Artículo (`components/articulos/ficha-articulo.tsx`) y Proveedor (`components/proveedores/ficha-proveedor.tsx`). **Solo presentación**: mismos campos, mismas conversiones y mismo guardado. La "escalera de precio" de la maqueta se DESCARTÓ por pedido del dueño: precio base y contado vienen de la importación de artículos; el frontend no calcula precios.
- Vitrina local `/dev/vitrina` (solo `next dev`, 404 en producción) para revisar componentes sin iniciar sesión.

**Etapa 2 CLIENTES (07/10/2026) — hecha en la rama, falta prueba del dueño:**
- `/clientes-pedidos` ahora es "Pedidos y viajes": calendario de viajes (semana por defecto, mes con un botón, navegable, ocultable; en celular agenda vertical) + filtros (estados, vendedor, zona, prioridad, con/sin viaje, fechas; por defecto pendiente+impreso de 30 días) + tabla (prioridad editable en la fila, orden por columnas, tarjetas en celular) + selección múltiple con suma de total y bultos + acciones en lote (subir a viaje, prioridad).
- Arrastrar pedidos (uno o la selección) a un viaje → se suben con la API de siempre (avisa si son de otra zona). A un día → si son todos de la misma zona: usa el viaje de esa zona de ese día si existe, si no ofrece programarlo y los sube. Zonas distintas nunca se juntan solas.
- Panel del pedido y TODAS sus acciones sin cambios (mismo código). Botones: Importar pedido (archivo), Mostrador, Programar viaje.
- Calendario y "Programar viaje" pasaron a piezas compartidas con /viajes (`components/viajes/calendario-viajes.tsx`, `programar-viaje-dialog.tsx`, `lib/viajes/use-viajes-rango.ts`).
- Pendiente etapa 3: pedido suelto con fecha de entrega (necesita la migración de `pedidos.fecha_entrega`).

## 5. Decisiones pendientes del dueño
Respondidas por el dueño el 07/10/2026:
1. **Lista de pedidos por defecto**: solo `pendiente` e `impreso` de los últimos 30 días (los demás, cambiando filtros). No se limpia nada de la base.
2. **Pedido suelto a un día sin viaje**: se agrega una **fecha de entrega** al pedido. Requiere migración (la aplica el dueño): `pedidos.fecha_entrega date null`. Reglas propuestas: el calendario muestra en cada día los pedidos "sueltos" (con fecha y sin viaje) agrupados por zona; si en un día hay 2+ de la misma zona sugiere crear viaje; al asignar a un viaje, la fecha que manda es la del viaje (se iguala `fecha_entrega` a la del viaje). Las apps no la leen (columna opcional, no rompe nada).
3. **Marcar pagado sin OP (proveedor)**: permitido con aviso ("no mueve caja, ni cuenta corriente, ni retenciones") desde calendario y lista. Se identifica como "pagado sin OP" = `estado='pagado'` y `orden_pago_id` vacío con proveedor (sin columna nueva).
4. **Dashboard**: se elimina del menú; CLIENTES es la pantalla de inicio. `/` queda accesible hasta confirmar, después se borra.

Aclaraciones del dueño (07/10/2026, segunda ronda):
5. **Importación desde el mail vía IA = código muerto** (nunca anduvo, no se retoma por ahora). No se enlaza la "Bandeja de importaciones" (`/clientes-pedidos/import-review`) ni nada del circuito de emails. La importación por ARCHIVO (botón "Nuevo pedido") sí se usa en producción y se mantiene.
6. **Un día puede tener pedidos sueltos y viajes a la vez.** Pedidos de zonas distintas NUNCA se juntan solos en un viaje nuevo: solo se sugiere crear viaje para pedidos de la MISMA zona, y siempre lo confirma el usuario.
7. **Cobranzas y rendiciones se manejan desde `/caja`.** CLIENTES enlaza a Caja; no se enlazan Pagos de clientes / Revisión de pagos / Cobranzas (siguen existiendo por URL).
8. **Botón MOSTRADOR**: el que existe en Pedidos (abre `/clientes-pedidos/nuevo`) ES el mostrador para el dueño y anda bien. Se conserva tal cual; si en el código figura como "pedido manual" se renombra a Mostrador, no se reemplaza. `/mostrador` (Venta/Retirar/Devolución) no se enlaza.
9. **Actualización EN VIVO ya**, no polling: migración `20261007_realtime_erp.sql` (la aplica el dueño) + hook `lib/hooks/use-realtime.ts`.
10. **Esperas**: nunca un redondel girando solo. Barra de progreso + mensajes que van cambiando ("Leyendo archivo… Descifrando cantidades… Obteniendo SKUs…"): `components/ui/carga-progreso.tsx`. Se aplica en cada pantalla que se toque.
11. **Fecha de entrega es opcional**: un pedido sin fecha no traba nada; aparece en el ERP según su estado como siempre.

---

## Anexo técnico (para retomar)
- Menú actual: `components/layout/sidebar.tsx` (NAV_SECTIONS) + `components/layout/main-content.tsx` (pl-[230px]); roles por header `x-user-roles` (`app/layout.tsx`), reglas en `lib/role-utils.ts`.
- Bug de ancho de modales: `components/ui/dialog.tsx` usa `max-w-[calc(100%-2rem)] sm:max-w-lg`; twMerge descarta el `max-w-*` sin prefijo del que llama y queda `sm:max-w-lg`. Sin max-h ni overflow por defecto.
- Viewport: `app/layout.tsx` `maximumScale:1, userScalable:false`.
- Pedidos: `app/clientes-pedidos/page.tsx` (1696 líneas). Panel = Sheet líneas ~1258-1641 → extraer a `components/pedidos/` y usarlo en la vieja y la nueva pantalla. Estados en `lib/pedidos/estados.ts` (la página tiene una copia propia).
- Asignar a viaje: `POST /api/viajes/[id]/pedidos {agregar:[ids]}` con guarda `puedeAsignarViaje`. Prioridad: `PATCH /api/pedidos/prioridad` (1-3). Crear viaje: `POST /api/viajes`. Mover viaje: `PATCH /api/viajes/[id] {fecha}`.
- Zona del pedido: cliente → localidad → `localidades.zona_id`; viajes ↔ `viaje_zonas`.
- Vencimientos: `components/finanzas/calendario-pagos.tsx`, `vencimiento-edit-dialog.tsx`, `nuevo-gasto-dialog.tsx`; API `app/api/vencimientos/route.ts` (PUT genérico sirve para cambiar fecha). Proyección neta: `/api/finanzas/proyeccion-retenciones`.
- Realtime: publicación `supabase_realtime` solo incluye `pedidos` (07/10/2026). El canal de `pedidos_detalle` del ERP no recibe nada.
- Volumen: 1.755 pedidos (1.431 impreso, 1.120 con más de 30 días), 534 vencimientos, 22 zonas, 18 viajes. Statement timeout 8 s; no embeber `pedidos_detalle` en listados.
- `/validacion` está muerta (solo loading.tsx). `/imports/[id]` es de importaciones de proveedores, no de pedidos.
