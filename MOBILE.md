# MOBILE.md — Apps Android de GMV2 (vendedor · chofer · depósito)

> **Fuente de verdad** para las sesiones que portan cada módulo a su APK. Leé esto
> entero antes de tocar `mobile/`. Rama de trabajo: `apks-fundacion` (nunca `main`
> sin confirmación del dueño: producción se despliega desde `main`).

---

## 0. TL;DR para la próxima sesión

1. `cd mobile && npm install` (una vez). Tests del motor: `npm test` (44 tests).
2. Tu app vive en `mobile/apps/<app>/src`. Todo lo compartido está en
   `mobile/packages/core` (`@gm/core`, `@gm/core/ui`). **No dupliques** lógica: si dos
   apps la necesitan, va al core.
3. **Lecturas** ⇒ dataset replicado (`lib/mobile/sync/datasets.ts` en el servidor +
   `DATASETS` en tu app) y `useDataset`/`useFila` en la UI. Nunca `fetch` directo en
   una pantalla para mostrar datos.
4. **Escrituras** ⇒ `runtime.outbox.encolar({ tipo, payload, etiqueta })` y un handler
   en `lib/mobile/outbox/handlers.ts`. Nunca `fetch` POST directo desde una pantalla.
5. **Pantallas** ⇒ una ruta por pantalla; sheets/modales/pasos con `useOverlay` /
   `usePaso`; tabs/filtros con `useParamEstado`. Nunca `useState` para algo que el
   usuario percibe como pantalla (§8).
6. **Precios** ⇒ `@gm/pricing` (`prepararMotorCliente`) sobre la réplica. Jamás un
   precio "estimado" (§5).
7. Build: `npm run build:apks -- --apps <app> --notas "qué cambió"` ⇒
   `dist-apks/<app>-v<versión>.apk` (§13).

---

## 1. Arquitectura y por qué

```
┌─────────────── APK (com.gm.<app>) ───────────────┐        ┌──────── ERP (Next 16 / Vercel) ────────┐
│ WebView (Capacitor 8) sirviendo dist/ LOCAL        │        │ /api/mobile/auth/*   login/refresh      │
│  React 19 + react-router 8 (rutas del módulo)      │ HTTPS  │ /api/mobile/sync/*   réplica            │
│  @gm/core: Replica · Outbox · Auth · Sincronizador ├───────►│ /api/mobile/outbox   mutaciones         │
│  IndexedDB (réplica, outbox, meta)                 │ Bearer │ /api/vendedor|chofer|deposito/* (igual) │
│  Android Keystore (refresh token)                  │        │ lib/pricing (motor isomórfico)          │
│  Plugins: app, network, secure-storage, GmLector   │        │ Supabase (service role solo servidor)   │
└────────────────────────────────────────────────────┘        └─────────────────────────────────────────┘
```

| Decisión | Elegido | Por qué (y descartado) |
|---|---|---|
| Contenedor | **Capacitor 8** con bundle local (`webDir: dist`, sin `server.url`) | Reusa React/TS y el código del ERP (motor de precios). Abre en ~0,45 s en el NuStar. *Descartado:* WebView remota (prohibido: requiere red para abrir); React Native / Kotlin nativo (reescritura total, no comparte el motor de precios). |
| UI | Vite + React 19 + Tailwind 4, SPA por app | Next no aporta nada dentro de un APK (no hay SSR) y sus server actions no existen offline. |
| Router | **react-router 8** `createBrowserRouter` | Historial real del WebView; `window.history.state.idx` permite decidir el botón atrás (§8). |
| Base local | **IndexedDB** (`idb`) | Sin plugin nativo: mismo código en WebView, navegador (dev) y tests (fake-indexeddb). Volumen chico (miles de filas). Transacciones atómicas. *Descartado:* SQLite (`@capacitor-community/sqlite`): plugin nativo extra y sin beneficio a este volumen. Revisar si un dataset supera ~50 MB. |
| Acceso a datos | **Todo por API routes con Bearer** | Según las migraciones del repo, las tablas centrales **no tienen RLS**: supabase-js directo desde el APK con la anon key expondría todo. Las API routes ya encapsulan permisos y lógica. El APK **no contiene ninguna key de Supabase**. |
| Invalidación de precios | **Sondeo corto** `GET /api/mobile/sync/estado` cada 15 s con la app en primer plano | Realtime de Supabase exigiría la anon key en el APK + publicar tablas sin RLS. El sondeo es 1 fila, barato, y dispara el delta en segundos. Background: al volver a primer plano + periódico. |
| Sync de lecturas | **Snapshot** (hash) para datasets chicos, **delta** por log de cambios para grandes | El log (`mobile_cambios`, alimentado por triggers) no depende de columnas `updated_at` que no se pudieron verificar en producción, y captura borrados. |
| Escrituras | **Outbox** FIFO con clave de idempotencia UUID del dispositivo | Operación offline real; reintentos seguros (§4). |

---

## 2. Estructura

```
MOBILE.md                         ← este archivo
lib/pricing/                      ← motor de precios (ERP + apps)
  isomorfico.ts                     frontera del paquete @gm/pricing (solo módulos puros)
  calculator.ts formula-evaluator.ts segmento.ts calcular-precio-pedido.ts  (ya existían)
  resolver.ts                       lista/método/bonif por ítem (extraído de lib/actions/pedidos.ts)
  motor.ts                          precioArticuloParaCliente / prepararMotorCliente
  vigencia.ts                       programados + reconstrucción "a fecha X"
  cargar-insumos.ts                 (NO isomórfico) carga insumos desde Supabase en el servidor
lib/mobile/
  contrato.ts                       tipos del protocolo HTTP (compartidos con las apps: @gm/contrato)
  sesion.ts auth-server.ts          sesión bearer, login/refresh, registro de dispositivos
  sync/motor.ts sync/datasets.ts    motor snapshot/delta + registro de datasets
  outbox/idempotencia.ts outbox/handlers.ts   idempotencia + registro de mutaciones
  precios-integridad.ts             re-verificación de precios de pedidos offline
app/api/mobile/{auth/login,auth/refresh,auth/logout,sync/[dataset],sync/estado,outbox}
app/api/precios-programados + app/tablas/precios-programados   (ERP: vigencia programada)
supabase/migrations/20260918_mobile_fundacion.sql              (aditiva; ver §10)
mobile/
  package.json                      workspaces: packages/*, apps/*
  vite.app.ts tsconfig.base.json    config compartida (alias @gm/pricing, @gm/contrato)
  packages/core/                    @gm/core
    src/db/idb.ts                     esquema IndexedDB (meta, rows, outbox, kv)
    src/sync/replica.ts outbox.ts sincronizador.ts reloj.ts
    src/auth/auth.ts net/api.ts net/errores.ts
    src/nav/atras.ts nav/hooks.ts     navegación (§8)
    src/scanner/detector.ts lector.ts lector de códigos (§11)
    src/platform/*                    Capacitor: red, almacén seguro, ciclo de vida
    src/react/*                       GmProvider, hooks, montarApp()
    src/ui/*                          Encabezado, Frescura, ListaVirtual, Hoja, Login, Pendientes
    test/*.test.ts                    invariantes (vitest)
  packages/capacitor-lector/        plugin nativo GmLector (broadcast intent)
  apps/{vendedor,chofer,deposito}/  src/ + android/ + capacitor.config.ts + version.json + CHANGELOG.md
  scripts/build-apks.mjs crear-keystores.mjs entorno.mjs
dist-apks/                          salida de APKs (gitignored)
```

Imports en las apps: `@gm/core`, `@gm/core/ui`, `@gm/core/styles.css`, `@gm/pricing`,
`@gm/contrato`. El ERP web no importa nada de `mobile/`.

---

## 3. Arranque (requisito "abre sin red")

`montarApp()` → `crearRuntime()` abre IndexedDB, lee la sesión del Keystore, carga
metas y outbox **sin ningún request**, y pinta. La red se usa después
(`Sincronizador.iniciar()`). Medido en el NuStar 65-sp: **TotalTime 440 ms** en frío
(presupuesto: < 3 s). Bundle chofer: 384 KB JS (121 KB gzip), APK 3,3 MB.

---

## 4. Contratos del motor de sync

### 4.1 Réplica (lecturas)

`GET /api/mobile/sync/<dataset>?cursor=<opaco>` → `RespuestaSync`
(`lib/mobile/contrato.ts`):

```ts
{ dataset, modo: "snapshot"|"delta", cursor, generado_at /* hora servidor */,
  sin_cambios, upserts: FilaReplica[] /* {id, ...} */, deletes: string[] }
```

- **snapshot**: el cliente reemplaza el dataset entero. Cursor `s:<hash>`; si el
  cliente ya tiene ese hash, `sin_cambios: true` y no viaja nada.
- **delta**: cursor `d:<seq>:`. El servidor lee `mobile_cambios` (seq > cursor, más
  una re-lectura de 3 min por commits fuera de orden), recarga SOLO las filas
  afectadas y devuelve como `deletes` las que ya no existen o salieron del alcance
  del usuario. Cae a snapshot si: el log no existe (migración sin aplicar), el cursor
  quedó antes del log retenido (30 días) o hay > 4000 cambios.
- Alcance = el del usuario (cargas con el cliente Supabase del bearer). El log se lee
  con service role (solo metadatos).

Invariantes del cliente (`packages/core/src/sync/replica.ts`, tests en `test/replica.test.ts`):

| | |
|---|---|
| R1 | Un sync se aplica atómico (filas + cursor en una transacción) o no se aplica. |
| R2 | snapshot reemplaza; delta solo toca upserts/deletes. |
| R3 | El cursor solo avanza con datos aplicados. |
| R4 | Un error de sync no borra datos: queda en `meta.error` y la UI sigue mostrando la réplica. |
| R5 | Un solo sync en vuelo por dataset. |
| R6 | La frescura es la hora del **servidor** (`generado_at`), no la del reloj del equipo. |

**Frescura visible**: todo dato leído de la réplica se muestra con `<Frescura dataset="…" />`
("Datos al 18/09 14:30 (hace 3 min)" + botón Actualizar; ámbar si está viejo).

**Cuándo sincroniza** (`Sincronizador`): al abrir, al volver a primer plano, al
recuperar red, sondeo de `/sync/estado` cada 15 s en primer plano (si cambió
`cambios_seq` ⇒ re-sync de datasets `invalidable`), periódico por dataset (`cadaMs`).
Orden: **primero se envía el outbox, después se lee.**

**Agregar un dataset** (sesión de cada app):
1. Servidor: `DatasetDef` en `lib/mobile/sync/datasets.ts` (`nombre`, `roles`,
   `tablas` si es delta, `cargar(ctx, ids?)`). Si ya existe un GET del módulo con la
   forma correcta, envolvelo con `llamarGET` (ej. `chofer_viajes`): cero duplicación.
2. Delta: la tabla debe tener el trigger `trg_mobile_cambios` con el `ref` correcto
   (id de la fila del dataset). Agregalo en una migración nueva con el mismo patrón.
3. App: `{ nombre, prioridad, invalidable?, cadaMs? }` en `DATASETS`.

### 4.2 Outbox (escrituras)

`POST /api/mobile/outbox` con `MutacionOutbox`:
`{ idempotency_key /*UUID v4 del equipo*/, tipo, payload, capturado_at, device_id, app, app_version }`

| Respuesta | Significado | Cliente |
|---|---|---|
| 200 `aplicado` | aplicada ahora | marca **enviado** |
| 200 `duplicado` | la clave ya se había aplicado; devuelve el resultado original | marca **enviado** |
| 422 `rechazado` | regla de negocio; nunca se aplicará | marca **rechazado**, lo muestra; el usuario lo descarta |
| 409 `reintentable:false` | misma clave con otro payload (bug) | **rechazado** |
| 409 `reintentable:true`, 5xx, red, timeout | transitorio | **pendiente**, backoff 2 s → 5 min |
| 401 | sesión inválida | pendiente; se reenvía tras volver a ingresar |

Invariantes (`packages/core/src/sync/outbox.ts`, tests en `test/outbox.test.ts`):
O1 persiste antes de devolver · O2 la clave nunca cambia · O3 FIFO estricto (un
transitorio frena a los siguientes) · O4 rechazo no bloquea · O5 single-flight ·
O6 crash en "enviando" ⇒ pendiente (reenvío resuelto como duplicado) · O7 sin sesión
no envía · O8 cada item solo se envía con la sesión del usuario que lo capturó
(y no se puede cerrar sesión con pendientes).

Servidor (`app/api/mobile/outbox/route.ts`): reserva la clave en `mobile_idempotencia`
(`procesando`) → handler → `aplicado|rechazado` guardando el resultado; error
transitorio ⇒ libera la reserva. Reserva huérfana (> 2 min) se re-toma con CAS.

**Contrato de un handler** (`lib/mobile/outbox/handlers.ts`):
- `validar(payload)` → string = rechazo definitivo.
- `aplicar(ctx, m)` → resultado; `throw new RechazoNegocio(msg)` para rechazo definitivo;
  cualquier otra excepción = transitoria.
- **Debe ser idempotente por sí mismo** (segunda defensa): guardar `idempotency_key`
  en la fila de negocio con índice UNIQUE y, ante `23505`, devolver la existente; o
  hacer todo en una RPC transaccional. Así un crash entre "aplicar" y "completar la
  reserva" nunca duplica.
- Reusar la lógica existente: el handler llama a la misma función que la API route
  web (extraerla a `lib/` si hoy vive dentro del route handler o de una server action).
- `m.capturado_at` es la hora (corregida contra el servidor, ver `Reloj`) en que el
  operario hizo la operación: usala para todo lo que dependa del momento (precios).

UI: contador de pendientes **siempre visible** en el `Encabezado` (ámbar = pendientes,
rojo = rechazadas); `/pendientes` lista cada operación con su estado.

### 4.3 Reloj

`Reloj` mide el desfasaje dispositivo↔servidor en cada `/sync/estado` y corrige
`capturado_at` y la aplicación de precios programados. Offline usa el último
desfasaje conocido.

---

## 5. Precios (requisito innegociable)

**El precio que muestra la app es siempre el de facturación.** No hay precios
"estimados": el dispositivo replica los **insumos** y calcula con el **mismo código**
que el servidor.

- **Motor isomórfico**: `lib/pricing/isomorfico.ts` (alias `@gm/pricing`).
  `prepararMotorCliente(insumos, overrides).precio(articulo)` devuelve
  `precio, precioNeto, contado, ivaIncluido, especial, bonif*, listaId, metodoRaw…`.
  `previewPrecioArticulo` y `previewPreciosArticulos` (ERP web) ya usan este motor;
  `createPedido`/`agregarItemPedido` usan el mismo `resolver.ts`. Un test verifica que
  el paquete no importa nada fuera de `lib/pricing`.
- **Insumos replicados** (vendedor): `precios_articulos` (columnas de precio +
  descuentos tipados), `precios_listas`, `precios_reglas`, `precios_programados`,
  `precios_clientes` (listas/métodos de la ficha + condiciones por proveedor/marca +
  bonificaciones activas). Todos `invalidable` (se refrescan en segundos).
- **Regla de facturación**: el pedido se factura a los precios vigentes en
  `capturado_at`. Al sincronizar, el handler `pedido.crear` (sesión vendedor) debe
  llamar `verificarPreciosCapturados()` (`lib/mobile/precios-integridad.ts`):
  reconstruye los insumos a esa hora (`precio_insumos_historial` + programados),
  recalcula y compara. **Diferencia ⇒ alerta en `mobile_alertas_integridad` para el
  admin** y se factura con el precio del servidor (el dispositivo nunca dicta
  precios). Al vendedor no se le muestra ninguna "corrección".
- **Vigencia programada**: `/tablas/precios-programados` (admin/administrativo) carga
  cambios con fecha/hora (artículo: precio base/compra/ganancia/bonif/especial; lista:
  recargos). Los flujos existentes siguen "rigiendo ya" (default intacto). Los
  dispositivos descargan los pendientes y los aplican solos
  (`aplicarProgramados(…, reloj.ahora())`; `proximaVigencia()` para re-renderizar a
  la hora exacta). La base los materializa con `aplicar_precios_programados()`
  (pg_cron cada minuto + oportunista en `/sync/estado`), registrando el historial con
  `vigente_desde = vigencia programada`.
- **Limitaciones conocidas**: los joins `rubros.slug` y `proveedores.tipo_descuento`
  no se versionan (se toma el valor actual); cambios programados solo sobre columnas
  (no alta/baja de descuentos tipados). Si el proyecto no tiene pg_cron, los pedidos
  web tomados después de una vigencia y antes de que algún equipo sondee
  `/sync/estado` usan el precio anterior ⇒ **habilitar pg_cron** (ver §10).

---

## 6. Políticas de conflicto por operación

Base común: clave de idempotencia por operación (dos envíos = una aplicación),
validación con las mismas reglas que la web, `capturado_at` como momento de negocio.

| Operación (tipo) | App | Política |
|---|---|---|
| `pedido.crear` | vendedor | Una clave por pedido. Precios a `capturado_at` con re-verificación (§5). Si el cliente fue desactivado/reasignado entre captura y sync ⇒ rechazado con motivo. Stock: misma regla que la web al crear. |
| `pedido.editar` (ítems/condiciones) | vendedor | Solo si `esPedidoEditable(estado)` al aplicar; si el pedido pasó a preparación/facturación ⇒ rechazado con `motivoBloqueo()`. Ítems se envían como **estado final de la línea** (cantidad absoluta), no como deltas ⇒ reenviar es inocuo. |
| `cliente.editar` | vendedor | **Compare-and-set por campo**: el payload lleva `{campo: {antes, despues}}`; se aplica cada campo cuyo valor actual == `antes`; los que otro usuario cambió mientras tanto ⇒ rechazo parcial listando esos campos. Dos vendedores sobre el mismo cliente solo chocan en el mismo campo. |
| `cliente.crear` | vendedor | Dedupe por CUIT/código: si ya existe ⇒ rechazado indicando el existente. |
| `cobro.registrar` | vendedor, chofer | Plata: nunca se fusiona ni se descarta. Se imputa a lo pendiente **al aplicar**; excedente queda a cuenta (igual que la web). |
| `cobro.anular` | vendedor, chofer | Solo si no está rendido/confirmado al aplicar; si no ⇒ rechazado. |
| `devolucion.registrar` | vendedor, chofer, depósito | Precio de la mercadería = último precio de venta al cliente a `capturado_at` (`precio-historico`). |
| `gasto.registrar` | chofer | Append-only; la clave evita duplicados. |
| `viaje.finalizar` | chofer | Transición idempotente: si ya estaba finalizado ⇒ éxito (duplicado). Requiere outbox del viaje vacío (FIFO lo garantiza). |
| `picking.item` | depósito | **Valor absoluto** de cantidad preparada por línea; último escritor gana por línea; si el pedido ya se cerró ⇒ rechazado. |
| `recepcion.item` | depósito | Igual que picking (conteo absoluto por ítem). |
| `stock.ajustar` | depósito | Se envía como **conteo** (cantidad observada + stock que veía el operario). El servidor aplica el conteo; si el stock cambió entre captura y sync, registra la diferencia como alerta (no se descarta el conteo). |
| rendiciones, OCR de comprobantes, BCRA, fotos | — | **Online-only** (§9): requieren al servidor en el momento. La UI lo indica y deshabilita sin red. |

---

## 7. Auth de dispositivo

- Login una vez: `POST /api/mobile/auth/login {email, password, app}` → `SesionMovil`
  (access + refresh token, roles). Valida que el usuario tenga el rol de la app.
- El refresh token se guarda en **Android Keystore** (`@aparajita/capacitor-secure-storage`).
  Al abrir, la sesión se restaura sin red.
- `Auth.accessToken()` renueva si faltan < 2 min (single-flight: con rotación de
  refresh tokens dos renovaciones paralelas se invalidan entre sí).
- **Solo se vuelve al login si el servidor responde 401** al refresh (revocada,
  usuario sin rol, dispositivo dado de baja en `mobile_dispositivos.revocado`). Un
  error de red nunca desloguea.
- Servidor: `lib/supabase/server.ts#createClient()` detecta `Authorization: Bearer`
  y crea un cliente sin cookies con ese JWT (RLS como el usuario; `getUser()` lo
  valida). Por eso **todos** los endpoints existentes (`requireAuth`,
  `requireVendedor`) funcionan con la app sin tocarlos. La web (cookies) no cambia.
- CORS solo para orígenes de las apps (`https://localhost`, `capacitor://localhost`,
  dev de Vite) en `lib/supabase/middleware.ts`; sin credenciales.
- El APK contiene **cero** secretos (ni siquiera la anon key): solo la URL del ERP.

**Matriz de autenticación**: todas las llamadas de las apps van a API routes con
Bearer. supabase-js directo: **ninguna** (sin RLS verificada no es seguro). Las 4
pantallas web que hoy usan supabase-js del navegador
(`app/vendedor/page.tsx`, `chofer/[viajeId]/cliente/[clienteId]`, `deposito/layout.tsx`,
`deposito/preparar-pedidos/page.tsx`) deben pasar a datasets/endpoints al portarse.

---

## 8. Navegación

Regla: **toda pantalla que el usuario percibe como pantalla es una entrada de historial.**

| Qué es | Cómo | ¿Historial? |
|---|---|---|
| Pantalla / detalle | ruta propia (`/viajes/:id/pedidos/:pid`) | sí |
| Paso de wizard | `usePaso(total)` → `?paso=N` | sí (atrás = paso anterior) |
| Sheet, modal, zoom de foto, confirmación | `useOverlay("nombre")` → `?ver=nombre` + `<Hoja>` | sí (atrás lo cierra) |
| Tabs | `useParamEstado("tab")` | no (replace): atrás sale de la pantalla |
| Filtros, búsqueda, orden | `useParamEstado(...)` | no (replace) |

**Botón atrás físico** (`nav/atras.ts`, instalado por `montarApp`): con historial ⇒
`back`; abierto directo en un detalle ⇒ padre lógico (`/a/b/c` → `/a/b`); en `/` ⇒
**minimiza** (el outbox sigue vivo). El bundle solo tiene rutas del módulo; cualquier
URL desconocida redirige a `/`: **no existe forma de llegar a una ruta del ERP**.
La flecha del `Encabezado` usa la misma decisión.

**Inventario a migrar** (hoy son `useState` + `useBackTrap`):

| Pantalla web | Estado actual | En la app |
|---|---|---|
| `vendedor/billetera` | `tab`, `pedidoSel`, `detalle` | `?tab=`; `/billetera/comisiones/:pedidoId` |
| `vendedor/pedido/nuevo` | `nav` (catálogo), `sel`, `verCarrito`, `verCliente`, `subSel`, `zoomFoto`, `buscarFoto` | `/pedido/nuevo/catalogo/:rubro/:cat`, `?ver=articulo:<id>`, `?ver=carrito`, `?ver=cliente`, `?ver=foto` |
| `vendedor/precios` | `catSel`, `subSel`, `verAgregar`, `zoomFoto` | rutas por categoría + overlays |
| `vendedor/clientes/[id]/cobrar` | `tab`, `abierto` | `?tab=`; `?ver=comprobante:<id>` |
| `vendedor/clientes/[id]/devolucion` | `modoCatalogo` | `/clientes/:id/devolucion/catalogo` |
| `chofer/[viajeId]/cliente/[clienteId]` | `showCobroSheet`, `showDevolucionSheet` | `?ver=cobro`, `?ver=devolucion` |
| `chofer/billetera` | `showGastoSheet` | `?ver=gasto` |
| `chofer/[viajeId]` | `showConfirmFinalizar` | `?ver=finalizar` |
| `deposito/recibir-mercaderia/[id]` | `vistaFaltantes` | `/recibir/:id/faltantes` |
| `deposito/preparar-pedidos/[id]` | `vistaFaltantes` | `/preparar/:id/faltantes` |
| `deposito/devoluciones` | `vista` | rutas por vista |
| `deposito` (home) | `selected` | `/articulos/:id` |
| `deposito/ajustar-stock` | `panelFiltro` | `?ver=filtro` |

`lib/vendedor/use-back-trap.ts` queda para la web; **no se usa en las apps**.

---

## 9. Matriz endpoint → estrategia

R = réplica (dataset) · O = outbox (tipo) · L = online-only. Tablas según el código
de cada route (introspección de la base bloqueada en esta sesión; verificar).

### Vendedor
| Endpoint | Tablas | Estrategia |
|---|---|---|
| GET `me` | usuarios, clientes, pedidos, pagos_clientes, rendiciones, rendicion_items, billetera_movimientos, comisiones, viajes | R `vendedor_me` (envolver GET) |
| GET `clientes`, `cliente/[id]` | clientes, v_saldo_clientes, pagos_clientes, comprobantes_venta, pedidos, devoluciones, imputaciones, listas_precio, vendedores, profiles | R `vendedor_clientes` (lista + ficha); saldos: snapshot |
| POST `clientes` | clientes | O `cliente.crear` |
| PATCH `cliente/[id]` | clientes | O `cliente.editar` (CAS por campo) |
| GET/PUT `cliente/[id]/bonificaciones` | bonificaciones, clientes | R `precios_clientes` ✅ / O `cliente.bonificaciones` |
| GET `cliente/[id]/comprados` | comprobantes_venta_detalle, articulos, clientes | R (por cliente, snapshot) |
| GET `articulos`, `catalogo`, `proveedores`, `articulos-ventas` | articulos, rubros, categorias, subcategorias, proveedores, v_articulos_ventas, pedidos_detalle | R `vendedor_catalogo` (+ `precios_articulos` ✅) |
| GET `precios-listas`, `catalogos-ficha`, `zonas`, `cuentas-bancarias` | listas_precio, zonas, localidades, condiciones_*, cuentas_bancarias | R (snapshot, chicos) |
| POST `zonas`, `localidades` | zonas, clientes_zonas, localidades | O |
| GET `pedidos`, `pedidos/[id]` | pedidos, comprobantes_venta, remitos, condiciones, bonificaciones | R `vendedor_pedidos` |
| **server actions** `createPedido`, `agregarItemPedido`, `actualizarCantidadItem`, `eliminarItemPedido`, `aplicarCondicionesPedidoVendedor`, `confirmarPedidoVendedor`, `previewPrecio*` | pedidos, pedidos_detalle, kardex, comisiones, condiciones | O `pedido.crear` / `pedido.editar` (armar el pedido completo en el equipo y enviarlo en UNA mutación); previews ⇒ motor local |
| GET `billetera`, `comisiones`, `comisiones/detalle`, `pagos-pendientes`, `estadisticas` | billetera_movimientos, comisiones, kardex, pagos_clientes, rendiciones | R (snapshot) |
| GET/POST/PATCH `viajes`, `viajes/[id]` | viajes, viaje_zonas, viajes_clientes, clientes_zonas | R / O `viaje.*` |
| POST `buscar-foto`, `buscar-foto/confirmar` | articulos, articulos_alias, marcas | L (IA) |
| `/api/viajante/cobro`, `cobro/[id]`, `devolucion` | pagos_clientes, pagos_detalle, devoluciones | O `cobro.registrar`, `cobro.anular`, `devolucion.registrar` |
| `/api/viajante/rendir`, `rendiciones` | rendiciones | L |
| `/api/pagos-clientes/ocr`, `/api/bcra/deudor/*`, `/api/transportes` | — | L |

### Chofer
| Endpoint | Tablas | Estrategia |
|---|---|---|
| GET `me` | usuarios, viajes | R `chofer_me` ✅ |
| GET `viaje/[id]` | viajes, pedidos, pagos_clientes, devoluciones, remitos, comprobantes_venta, billetera_movimientos | R `chofer_viajes` ✅ |
| GET `viaje/[id]/cliente/[clienteId]` | pedidos, pedidos_detalle, comprobantes_venta, devoluciones, pagos_clientes | R `chofer_viaje_clientes` |
| POST `viaje/[id]/cobro` · DELETE `cobro/[pagoId]` | pagos_clientes, pago_comprobantes, billetera_movimientos, pedidos, rendicion_items | O `cobro.registrar` / `cobro.anular` |
| POST `viaje/[id]/devolucion` | devoluciones, devoluciones_detalle | O `devolucion.registrar` |
| POST `viaje/[id]/finalizar` | viajes | O `viaje.finalizar` |
| GET `billetera` · POST `billetera/gasto` | billetera_movimientos | R · O `gasto.registrar` |
| GET `articulo/precio-historico` | kardex, comprobantes_venta_detalle | R (último precio por cliente×artículo del viaje) |

### Depósito
| Endpoint | Tablas | Estrategia |
|---|---|---|
| GET `pedidos` · GET `picking` | pedidos, articulos | R `deposito_pedidos` |
| GET/PATCH/POST `picking/item` · POST `picking` | picking_sesiones, picking_items, pedidos_detalle, kardex, listas_precio | R + O `picking.item` (absoluto) / `picking.cerrar` |
| GET/POST/PATCH `recepciones` | recepciones, recepciones_items, ordenes_compra(_detalle), movimientos_stock, articulos | R + O `recepcion.item` / `recepcion.cerrar` |
| POST `recepciones/documento`, `/api/recepciones/[id]/ocr` | documentos | L (archivo + IA) |
| GET/POST `devoluciones` | devoluciones, devoluciones_detalle, movimientos_stock | R + O `devolucion.recibir` |
| GET/POST `ajustes-stock` | deposito_ajustes_stock, articulos | R + O `stock.ajustar` (conteo) |
| server actions `lib/actions/deposito` (home) | articulos | R `deposito_articulos` (EAN/SKU, stock) |
| `/api/articulos/buscar`, `/api/clientes/buscar` | articulos, clientes | búsqueda local sobre la réplica |

---

## 10. Cambios de backend

**Hechos en esta sesión** (retrocompatibles; `npm run build` del ERP pasa):
- `lib/supabase/server.ts`: soporte Bearer. `lib/supabase/middleware.ts`: CORS para apps.
- `lib/pricing/{resolver,motor,vigencia,isomorfico,cargar-insumos}.ts`; `lib/actions/pedidos.ts` usa el resolver extraído y el motor en los previews (mismas salidas).
- `app/api/mobile/*`, `lib/mobile/*`, `app/api/precios-programados`, `app/tablas/precios-programados`.
- Migración `supabase/migrations/20260918_mobile_fundacion.sql` — **aditiva, idempotente, verificada con el parser de Postgres (libpg_query)**. Crea: `mobile_cambios` (+ trigger en articulos, articulos_descuentos, listas_precio, listas_precio_reglas, clientes, bonificaciones, cliente_proveedor_condicion, cliente_marca_condicion, precios_programados), `precio_insumos_historial` (+ trigger y versión base), `precios_programados` + `aplicar_precios_programados()`, `mobile_idempotencia`, `mobile_dispositivos`, `mobile_alertas_integridad`, `mobile_pruebas_sync`. Los triggers **nunca** bloquean una escritura del ERP (EXCEPTION → WARNING). Si hay pg_cron, agenda la materialización (cada minuto) y la purga (diaria).

**Pendientes por sesión de app**:
- Datasets y handlers de la tabla §9 (cada uno reusando la lógica existente; extraer a `lib/` lo que hoy vive en route handlers/server actions).
- `pedido.crear` debe usar `verificarPreciosCapturados()` y guardar `idempotency_key` en `pedidos` (columna nueva + UNIQUE) — migración de la sesión vendedor.
- Pantalla de admin para `mobile_alertas_integridad` y `mobile_dispositivos` (revocar equipo).
- Si pg_cron no está habilitado: habilitarlo (Database → Extensions) y re-correr el bloque de jobs de la migración.

---

## 11. Lector de códigos

- **Keyboard wedge** (modo de fábrica): `useLector({ onCodigo })` en la pantalla;
  `DetectorWedge` distingue la ráfaga del lector (≤ 60 ms entre teclas) del tecleo
  humano; funciona sin input enfocado. Si hay un input enfocado, el input recibe el
  texto (búsqueda manual).
- **Broadcast intent**: plugin nativo `GmLector` (`mobile/packages/capacitor-lector`).
  Default `android.intent.ACTION_DECODE_DATA` / extra `barcode_string`; si el
  firmware usa otros, `configurarBroadcast(accion, extra)` (queda persistido).
- `esQrOUrl()` descarta QR/URLs escaneados por error; `lecturaOk()`/`lecturaError()`
  dan beep + vibración (mismos tonos que la web).
- **Estado en el equipo**: el NuStar 65-sp conectado **no tiene servicio de escaneo
  instalado** (no aparece ningún paquete de scanner): o es la variante sin lector o
  hay que habilitarlo en ajustes. La app depósito (shell) muestra cada lectura para
  validarlo apenas haya lector.

---

## 12. Hardware y performance

NuStar 65-sp medido por adb: Android 14 (API 34), 720×1600 @ 320 dpi (360×800 dp),
arm64-v8a, 5,7 GB RAM, WebView 127. **minSdk 26** (margen para equipos de reemplazo,
sin costo), **target/compileSdk 36** (Capacitor 8).
Presupuestos: arranque en frío < 3 s (medido 0,44 s) · listas largas con
`<ListaVirtual>` (tanstack virtual) · sin transiciones/animaciones (CSS global las
anula) · objetivos táctiles ≥ 44 px · vertical fijo.

---

## 13. Toolchain, build y distribución

### Entorno (Windows 11, reproducir desde cero)
1. **Node 22** (probado 22.21; react-router 8 pide ≥ 22.22 solo como aviso).
2. **Android Studio** (trae el JDK 21 en `C:\Program Files\Android\Android Studio\jbr`)
   y desde su SDK Manager: *Android SDK Platform 36*, *Build-Tools 36*, *Platform-Tools*.
   SDK en `%LOCALAPPDATA%\Android\Sdk`.
3. Los scripts detectan JDK y SDK solos (`scripts/entorno.mjs`); si están en otro
   lugar: `JAVA_HOME` y `ANDROID_HOME`. `adb` está en `%LOCALAPPDATA%\Android\Sdk\platform-tools`
   (no hace falta agregarlo al PATH).
4. `cd mobile && npm install`.
5. Keystores (una vez por máquina de build): `npm run keystores` → crea
   `%USERPROFILE%\.gm-keystores\{vendedor,chofer,deposito}.jks` + `.properties`
   (alias `gmvendedor`/`gmchofer`/`gmdeposito`). **Nunca al repo. Hacer backup**: sin
   ellos no se puede actualizar una app instalada (habría que desinstalar en cada
   equipo). El keystore del APK viejo de chofer (`com.gm.chofer`, alias `gmchofer`)
   **no estaba en esta máquina**: se generó uno nuevo.
6. Linux/WSL: mismo flujo con `ANDROID_HOME`/`JAVA_HOME` exportados.

### Build
```bash
cd mobile
npm run build:apks -- --notas "Descripción del cambio"                 # las 3, patch+1
npm run build:apks -- --apps chofer --bump minor --notas "Cobros offline"
npm run build:apks -- --apps chofer --debug                             # APK debug
```
Por app: typecheck → `vite build` → `cap sync android` → `gradlew assembleRelease` →
`apksigner verify` → `dist-apks/<app>-v<versionName>.apk`. `versionCode` +1 siempre;
`versionName` según `--bump`; entrada nueva en `apps/<app>/CHANGELOG.md`. Commitear
`version.json` y `CHANGELOG.md` después de publicar.

### Instalar / actualizar en el handheld
```bash
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" install -r dist-apks\chofer-v0.1.0.apk
```
(o copiar el APK al equipo y abrirlo). Actualizar encima conserva sesión, réplica y
outbox. **Atención**: el equipo tiene instalado un `com.gm.vendedor` v1.1 viejo
firmado con otra clave: hay que **desinstalarlo** antes de instalar el nuevo vendedor.

### Probar contra un Next local (sin desplegar)
```bash
# terminal 1 (raíz del repo, con .env.local)
npm run dev
# terminal 2
adb reverse tcp:3000 tcp:3000
cd mobile/apps/chofer
set VITE_API_BASE=http://localhost:3000&& set GM_DEV_HTTP=1&& npx vite build && npx cap sync android
cd android && gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
```
(el APK debug usa otra firma: desinstalar el release antes, y viceversa).

### Actualización OTA del bundle (propuesta, no implementada)
Viable sin infra paga: `@capgo/capacitor-updater` en modo **self-hosted**
(open source): el build sube `dist.zip` a Supabase Storage (bucket público de solo
lectura) o a `public/` del ERP con un `latest.json` por app; la app lo descarga en
segundo plano y lo aplica al próximo arranque (rollback automático si no arranca).
Solo sirve para cambios de JS/CSS (no plugins nativos). Para el mes de prueba,
reinstalar APK es suficiente; si se implementa, firmar los bundles (el plugin
soporta encriptación con clave propia).

---

## 14. Pruebas

- `cd mobile && npm test` — invariantes de réplica (R1–R6), outbox (O1–O8), backoff,
  lector wedge, botón atrás, motor de precios (casos dorados + isomorfismo
  dispositivo/servidor + vigencia programada) y frontera del paquete de precios.
- Typecheck: `npm run typecheck` (core + 3 apps, `strict`).
- ERP: `npm run build` en la raíz debe seguir pasando.
- Aceptación en equipo (checklist): ver §15.

---

## 15. Estado

Rama `apks-fundacion`. Leyenda: ✅ hecho y verificado · 🟡 hecho, falta verificar en
equipo/producción · ⏳ pendiente.

| Ítem | Estado |
|---|---|
| Auditoría (endpoints→tablas, subpantallas, cambios de backend, riesgos) | ✅ (§8, §9, §10, §16) |
| Workspace `mobile/` con 3 proyectos Capacitor (`com.gm.vendedor/chofer/deposito`) | ✅ compilan; typecheck strict limpio |
| Motor offline: réplica + outbox + sincronizador + reloj, con tests | ✅ 44/44 tests |
| Motor de precios isomórfico extraído, ERP usando el mismo código | ✅ (ERP `npm run build` pasa) |
| Migración `20260918_mobile_fundacion.sql` | ✅ aplicada en producción (18/09); log de cambios, idempotencia e historial verificados en vivo |
| Vigencia programada (ERP + dispositivo + materialización) | 🟡 código y tests ✅; falta una prueba real con un cambio programado (y confirmar pg_cron) |
| Historial de insumos + re-verificación de precios | 🟡 tests ✅; se ejercita con `pedido.crear` (sesión vendedor) |
| Auth de dispositivo (Keystore, refresh, revocación) + Bearer en servidor | ✅ probado en equipo (login, reinicio offline, logout con revocación) |
| Navegación: convención + hooks + botón atrás | ✅ probado en equipo |
| Lector: wedge + broadcast (plugin nativo) | ✅ compila; 🟡 el equipo no tiene lector habilitado |
| Pipeline de build firmado + keystores + CHANGELOG | ✅ las 3 apps v0.1.1 (versionCode 2) firmadas y verificadas |
| APK esqueleto (chofer) en el NuStar: arranque en frío 0,44 s (release) | ✅ |
| Prueba end-to-end en equipo | ✅ ver abajo |
| Datasets/handlers de cada módulo, pantallas reales | ⏳ sesiones por app |

### Validación en equipo (18/09/2026, NuStar 65-sp, Android 14)

Contra un Next local (`adb reverse`) con la base de **producción**. Todo dato creado
se marcó `TEST-FUNDACION` y se borró al terminar (verificado: 0 residuos).

| Criterio | Resultado |
|---|---|
| Instala y corre en el NuStar | ✅ |
| Modo avión + **reinicio del equipo**: abre con la sesión guardada, sin login | ✅ (tras el fix de abajo) |
| Modo avión: muestra datos de la réplica con frescura | ✅ "Datos al 18/9 10:34 (hace 19 min)" |
| Modo avión: acepta una escritura y la marca pendiente | ✅ contador 1, "Pendiente de enviar" |
| Al reconectar sincroniza solo, sin duplicar | ✅ 1 POST, 1 fila; reenvío de la misma clave ⇒ `duplicado`; misma clave con otro payload ⇒ `conflicto` |
| Atrás: hoja → detalle → listado → inicio → minimiza | ✅ (los filtros con `replace` no agregan pasos) |
| Borrado en el servidor se propaga a la réplica | ✅ (el viaje de prueba desapareció al volver a primer plano) |

**Bugs encontrados y corregidos durante la prueba:**
1. *Sesión perdida en arranque en frío* (app): el prefijo del almacén seguro se
   aplicaba sin `await`; el primer `get` buscaba `capacitor-storage_gm.sesion` y
   mostraba el login. Fix en `platform/almacen-seguro.ts` + reintentos de lectura en
   `Auth` (el Keystore del NuStar tarda >500 ms tras reiniciar). Tests de regresión en
   `test/auth.test.ts`.
2. *Chofer sin viajes* (ERP, **existente en producción**): `/api/chofer/me`,
   `/api/chofer/viaje/[id]` y `/api/vendedor/me` hacían `zonas(nombre)` desde
   `viajes`, ambiguo desde que existe `viaje_zonas` ("more than one relationship
   was found"); el error se ignoraba y el módulo chofer mostraba 0 viajes. Fix:
   `zonas!zona_id(...)` (misma forma de respuesta). **Afecta también a la web
   actual en `main`.**

**Nota de prueba**: no usar `adb shell am force-stop` para simular cierres: en este
equipo deja el renderer del WebView marcado "process is bad" hasta reiniciar.
Cerrar desde recientes o reiniciar el equipo.

---

## 16. Riesgos y decisiones abiertas

1. **Introspección de la base bloqueada** en esta sesión (permiso del entorno): el
   esquema se infirió de `supabase/migrations/` y `scripts/`, que están incompletos
   (tablas centrales creadas fuera de migraciones). Verificar con la base real:
   columnas `id` en tablas con trigger, RLS efectiva, pg_cron.
2. **RLS**: si en producción las tablas centrales no tienen RLS, la anon key del
   bundle web da acceso amplio. Las apps no dependen de RLS (todo por API), pero es
   un riesgo del ERP a revisar aparte.
3. **Keystore del chofer viejo perdido**: el APK viejo `com.gm.chofer` (si está en
   algún equipo) debe desinstalarse antes del nuevo.
4. **Reloj del handheld**: mitigado con `Reloj` (desfasaje medido). Un equipo que
   nunca tuvo red desde que se cambió la hora usa el último desfasaje conocido.
5. **pg_cron**: sin él, la materialización de programados depende del sondeo de
   dispositivos (ver §5).
6. `.env.vercel` está versionado en el repo (contiene `VERCEL_OIDC_TOKEN`, de vida
   corta); conviene sacarlo del control de versiones.
