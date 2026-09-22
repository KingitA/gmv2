# MOBILE.md — Apps Android de GMV2 (vendedor · chofer · depósito)

> **Fuente de verdad** para las sesiones que portan cada módulo a su APK. Leé esto
> entero antes de tocar `mobile/`. La fundación (Sesión 0) está en `main` y validada
> en producción (§15). Cada sesión trabaja en su propia rama desde `main` y **nunca
> hace push a `main` sin confirmación explícita del dueño**: producción se despliega
> desde `main`.

---

## 0. TL;DR para la próxima sesión

1. `cd mobile && npm install` (una vez). Tests del motor: `npm test` (93 tests).
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
8. **OBLIGATORIO antes de cada commit/merge: `npm run typecheck:movil` en verde**
   (raíz del repo). Si tocás un archivo del ERP, agregalo primero a
   `scripts/typecheck-movil.alcance.json` (§14). `next build` NO detecta errores de
   tipo: así llegó a producción el `ReferenceError` del 18/09.

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

**Refresco parcial** (desde la sesión Vendedor, aditivo): `GET /api/mobile/sync/<ds>?ids=a,b`
→ `RespuestaParcial { dataset, generado_at, upserts, deletes }` para los datasets que declaran
`porIds` (caros por fila: cuenta corriente de un cliente, detalle de un viaje). El cliente lo
aplica como parche (`replica.refrescarIds`): no mueve cursor ni frescura. Máx. 25 ids.

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
(la activa, o la suya **aparcada** tras un cambio de turno: §7) · O9 el parche de
réplica (`resultado.replica`) se aplica ANTES de marcar el item enviado. El FIFO es
**por usuario**. `enviar({forzar:true})` ignora el backoff: lo usa el sincronizador
cuando sabe que el servidor responde (volvió la red / primer plano / el sondeo
contestó), así lo acumulado sin señal sale en segundos y no en "hasta 5 min".

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

**Parche de réplica** (desde la sesión Depósito, genérico): si el handler devuelve
`{ ..., replica: [{ dataset, upserts, deletes }] }`, el dispositivo vuelca esas filas
a su réplica (`Replica.parchear`, sin mover cursor ni frescura) antes de dar la
operación por enviada. Con eso la pantalla nunca "vuelve atrás" entre el envío y el
próximo sync. **Overlay optimista**: `useNoEnviados()` (lectura sincrónica, por
índice) da las operaciones pendientes/rechazadas; cada app superpone las suyas sobre
la réplica con funciones puras (ver `apps/deposito/src/datos/overlay.ts`). Un
rechazo dispara un re-sync inmediato.

**Retirar** (desde la sesión Vendedor): `outbox.retirar(key)` saca del outbox una operación
que TODAVÍA NO SALIÓ (pendiente o rechazada; una que está viajando no se toca) para que el
usuario la corrija. La corrección es una operación NUEVA (O2 intacto). Si un envío anterior
llegó y se perdió la respuesta, el duplicado lo evita el id LÓGICO del payload
(`pedido.local_id` ⇒ `pedidos.movil_local_id` UNIQUE), no la clave del outbox.

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
- **Regla de facturación**: el pedido se factura a los precios que el vendedor TENÍA A
  LA VISTA al capturarlo: los vigentes a `min(capturado_at, precios_al)`, donde
  `precios_al` es la frescura más vieja de los datasets `precios_*` del equipo (viaja en
  el pedido). Es una precisión de la sesión Vendedor sobre la regla original ("vigentes en
  `capturado_at`"): con esa sola, un cambio hecho en el ERP mientras el equipo no tiene
  señal daba SIEMPRE diferencia (el equipo no puede conocer un cambio que no recibió) y
  el pedido se facturaba a un precio distinto del que vio el cliente, que es justo lo que
  el requisito prohíbe. Así el recálculo da idéntico por construcción y una diferencia
  vuelve a significar bug o dato corrupto (detalle en §18). **Tope (decisión del dueño,
  21/09/2026): si al capturar hacía MÁS DE 24 HS que el equipo no actualizaba precios, la
  garantía se pierde** — rige el precio del sistema cuando INGRESA el pedido, no hay alerta
  de integridad (la diferencia es esperable) y la app muestra un cartel fijo. Regla pura y
  compartida: `lib/vendedor/vigencia-precios.ts`. Al sincronizar,
  el handler `pedido.crear` llama `verificarPreciosCapturados()` (`lib/mobile/precios-integridad.ts`):
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
- **Equipos compartidos entre turnos** (`runtime.cambiarUsuario()`): si el que se va
  tiene operaciones sin enviar, su sesión queda **aparcada** en el Keystore
  (`Auth.aparcar`); el outbox la usa SOLO para enviar lo que ese usuario capturó
  (`tokenAparcado`, con refresh propio) y se descarta y revoca sola cuando ya no le
  queda nada pendiente, o cuando el mismo usuario vuelve a ingresar. No se puede
  "retomar" sin contraseña. Sin pendientes es un logout normal. El login recuerda
  los emails usados en el equipo (chips). `SesionMovil.user.nombre` viene en el login.
  `ConfigApp.replicaPorUsuario: false` (depósito) evita re-descargar la réplica al
  cambiar de usuario cuando los datasets no dependen de quién mira.

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
| `vendedor/*` | ✅ migrado — ver "Vendedor → Navegación" (§18) | |
| `chofer/[viajeId]/cliente/[clienteId]` | `showCobroSheet`, `showDevolucionSheet` | `?ver=cobro`, `?ver=devolucion` |
| `chofer/billetera` | `showGastoSheet` | `?ver=gasto` |
| `chofer/[viajeId]` | `showConfirmFinalizar` | `?ver=finalizar` |
| `deposito/*` | ✅ migrado — ver "Depósito → Navegación" (§17) | |

`lib/vendedor/use-back-trap.ts` queda para la web; **no se usa en las apps**.

---

## 9. Matriz endpoint → estrategia

R = réplica (dataset) · O = outbox (tipo) · L = online-only. Tablas según el código
de cada route (introspección de la base bloqueada en esta sesión; verificar).

### Vendedor ✅ (implementado — detalle en §18)
| Endpoint web | Estrategia en la app |
|---|---|
| GET `me` | R `vendedor_me` (envuelve el GET) |
| GET `clientes` | R `vendedor_clientes` (lista + campos de ficha + bonificaciones, por lote); búsqueda y filtros LOCALES |
| GET `cliente/[id]`, `cliente/[id]/bonificaciones`, `cliente/[id]/comprados`, `articulos?vista=habituales` | R `vendedor_cc` (una fila por cliente; refresco parcial `?ids=` al abrir la ficha con señal) |
| POST `clientes` | O `cliente.crear` (id generado en el equipo) |
| PATCH `cliente/[id]` | O `cliente.editar` (CAS por campo; también reasignar vendedor) |
| PUT `cliente/[id]/bonificaciones` | O `cliente.bonificaciones` |
| GET `articulos` (6 vistas), `catalogo`, `proveedores`, `articulos-ventas`, `precios-listas`, `catalogos-ficha`, `zonas`, `cuentas-bancarias` | R `vendedor_articulos` (delta) + R `vendedor_catalogos`; vistas y búsqueda LOCALES |
| POST `zonas`, `localidades` | **L** (dedupe contra toda la base; alta rara) — antes figuraban como O |
| GET `pedidos`, `pedidos/[id]` | R `vendedor_pedidos` (delta; 90 días + vivos, tope 250) |
| server actions `createPedido`, `agregarItemPedido`, `actualizarCantidadItem`, `eliminarItemPedido`, `aplicarCondicionesPedidoVendedor`, `confirmarPedidoVendedor` | borrador LOCAL durable + O `pedido.crear` / `pedido.editar` (una operación con el estado final) |
| server action `softDeletePedido` *(no estaba en la matriz)* | O `pedido.eliminar` (idempotente) |
| server actions `previewPrecioArticulo`, `previewPreciosArticulos`, `previewPreciosListas` *(la última no estaba)* | motor local (`@gm/pricing`) sobre `precios_*` |
| GET `billetera`, `comisiones`, `comisiones/detalle`, `pagos-pendientes`, `estadisticas`, `/api/viajante/rendiciones` | R `vendedor_billetera` (filas por id; detalle de comisión de los 150 pedidos más recientes; el resto **L** con estado vacío) |
| GET/POST `viajes`, GET/PATCH `viajes/[id]` *(el PATCH tiene dos acciones)* | R `vendedor_viajes` · O `viaje.crear`, `viaje.cliente_no_va` (absoluto), `viaje.estado` (idempotente) |
| `/api/viajante/cobro`, `cobro/[id]`, `devolucion` | O `cobro.registrar`, `cobro.anular`, `devolucion.registrar` (id generado en el equipo) |
| `/api/viajante/rendir` | **L** (RPC atómica de plata) |
| POST `buscar-foto` | código de barras: LOCAL (BarcodeDetector + catálogo) · identificar por foto: **L** (IA) |
| `/api/pagos-clientes/ocr`, `/api/bcra/deudor/*`, PDF de comprobantes y remitos | **L** |

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

### Depósito ✅ (implementado — detalle en §17)
| Endpoint web | Tablas | Estrategia en la app |
|---|---|---|
| GET `pedidos` · POST `picking` (abrir) | pedidos, pedidos_detalle, picking_sesiones, picking_items | R `deposito_pedidos` (delta) · O `picking.abrir` |
| PATCH/POST `picking/item` | pedidos_detalle, picking_items, picking_sesiones, kardex, listas_precio | O `picking.item` (absoluto, renglón de un solo operario) · O `picking.cerrar` (idempotente) |
| GET `picking?q=` (búsqueda) · `buscarArticulosDeposito` | articulos | búsqueda LOCAL sobre R `deposito_articulos` (delta) |
| GET/POST/PATCH `recepciones` | ordenes_compra(_detalle), recepciones, recepciones_items, articulos, movimientos_stock, kardex | R `deposito_recepciones` · O `recepcion.iniciar` / `.conformidad` / `.item` (absoluto) / `.cerrar` (idempotente) |
| `/api/recepciones/[id]/ocr` (POST/DELETE) | recepciones_documentos + IA | **L** (foto + OCR): `api.postForm` / `api.delete`, deshabilitado sin señal |
| `/api/transportes`, proveedores, tipos de bulto/fracción | transportes, proveedores, tipos_* | R `deposito_catalogos` |
| GET/POST `devoluciones` | devoluciones(_detalle), articulos, movimientos_stock | R `deposito_devoluciones` · O `devolucion.recibir` (idempotente) |
| server actions `lib/actions/deposito` (stock, datos, INEXISTENTE, listados, adyacente) | articulos | R `deposito_articulos` + O `stock.ajustar` / `articulo.datos` (CAS por campo) / `articulo.inexistente`; listados y anterior/siguiente calculados localmente |
| GET/POST `ajustes-stock`, POST `recepciones/documento` | — | no los usa ninguna pantalla web hoy: sin portar |

---

## 10. Cambios de backend

**Hechos en esta sesión** (retrocompatibles; `npm run build` del ERP pasa):
- `lib/supabase/server.ts`: soporte Bearer. `lib/supabase/middleware.ts`: CORS para apps.
- `lib/pricing/{resolver,motor,vigencia,isomorfico,cargar-insumos}.ts`; `lib/actions/pedidos.ts` usa el resolver extraído y el motor en los previews (mismas salidas).
- `app/api/mobile/*`, `lib/mobile/*`, `app/api/precios-programados`, `app/tablas/precios-programados`.
- Migración `supabase/migrations/20260918_mobile_fundacion.sql` — **aditiva, idempotente, verificada con el parser de Postgres (libpg_query)**. Crea: `mobile_cambios` (+ trigger en articulos, articulos_descuentos, listas_precio, listas_precio_reglas, clientes, bonificaciones, cliente_proveedor_condicion, cliente_marca_condicion, precios_programados), `precio_insumos_historial` (+ trigger y versión base), `precios_programados` + `aplicar_precios_programados()`, `mobile_idempotencia`, `mobile_dispositivos`, `mobile_alertas_integridad`, `mobile_pruebas_sync`. Los triggers **nunca** bloquean una escritura del ERP (EXCEPTION → WARNING). Si hay pg_cron, agenda la materialización (cada minuto) y la purga (diaria).

**Sesión Depósito** (retrocompatibles; la web `/deposito` usa las mismas funciones y devuelve lo mismo):
- `lib/deposito/{picking,recepciones,devoluciones,articulos,bonificados}.ts`: lógica extraída de
  las routes y server actions. `bonificados.ts` es puro y lo importa la app (`@gm/deposito`).
- Picking: el renglón se **reclama antes** de escribir la cantidad (`ux_picking_items_renglon`,
  23505 ⇒ "Ya lo preparó X"); cerrar dos veces = una. Recepción: finalizar con candado por
  `fecha_fin` + guarda por kardex (reintentar nunca duplica stock); get-or-create de la tanda.
  Devolución: confirmar idempotente (guarda por `movimientos_stock`).
- `lib/mobile/sync/deposito.ts` (5 datasets), `lib/mobile/outbox/deposito.ts` (11 handlers),
  `lib/mobile/outbox/tipos.ts`. Motor: `DatasetDef.requiereLogDe` (delta solo si el trigger existe).
- Migración `supabase/migrations/20260919_mobile_deposito.sql` — **aditiva, idempotente, PENDIENTE
  de aplicar en producción**: triggers de log en pedidos, pedidos_detalle, ordenes_compra,
  recepciones, recepciones_items, devoluciones + tabla `deposito_ajustes_movil`. La app funciona
  sin ella (snapshot + refresco periódico de 45 s); con ella la cola se entera en segundos.
- `typecheck:movil`: `lib/deposito/`, `app/api/deposito/` y `lib/actions/deposito.ts` pasan al alcance en cero.

**Sesión Vendedor** (retrocompatibles; la web `/vendedor` usa las mismas funciones y devuelve lo mismo):
- `lib/vendedor/{ficha-cliente,detalle-pedido,bonificaciones,comprados,habituales,comisiones-detalle}.ts`:
  lógica extraída de las routes (la route llama a la misma función). `lib/vendedor/isomorfico.ts`
  = frontera de lo que importa la app (`@gm/vendedor`: orden de listados, búsqueda local, estados).
- `lib/mobile/sync/vendedor.ts` (8 datasets), `lib/mobile/outbox/vendedor.ts` (12 handlers),
  `lib/mobile/contexto-captura.ts` (precios a la captura; ver §18), `lib/mobile/uuid.ts`.
- `lib/actions/pedidos.ts`: sus 6 helpers de LECTURA de insumos consultan `capturaActual()`.
  Sin contexto (toda la web) devuelven lo de siempre; el contexto solo lo abre el handler del
  outbox (AsyncLocalStorage: un cliente remoto no lo puede fijar).
- POST `/api/vendedor/clientes`, `/api/vendedor/viajes`, `/api/viajante/devolucion`: aceptan un
  `id` (UUID) opcional generado en el equipo. Motor de sync: `DatasetDef.porIds` + `?ids=`.
- `precios-integridad.ts`: un cliente creado DESPUÉS de la vigencia (alta offline) usa su ficha actual.
- Migración `supabase/migrations/20260921_mobile_vendedor.sql` — **aditiva, idempotente,
  OBLIGATORIA para enviar pedidos desde la app**: `pedidos.movil_local_id UUID` + índice UNIQUE
  parcial. Sin ella el pedido queda PENDIENTE en el equipo (nada se pierde) hasta aplicarla.
- `lib/cobranzas/errores.ts` + 422 en `/api/viajante/cobro` (POST/DELETE) para rechazos de negocio (§18).
- `typecheck:movil`: `lib/vendedor/`, `app/api/vendedor/`, `app/api/viajante/cobro/`, `lib/cobranzas/{crear,errores}.ts` y `lib/actions/cobranzas.ts` pasan al alcance en cero.

**Pendientes por sesión de app**:
- Datasets y handlers de la tabla §9 (cada uno reusando la lógica existente; extraer a `lib/` lo que hoy vive en route handlers/server actions).
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
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" install -r dist-apks\chofer-v0.1.1.apk
```
(o copiar el APK al equipo y abrirlo). Actualizar encima conserva sesión, réplica y
outbox. Un APK firmado con otra clave (como el `com.gm.vendedor` v1.1 viejo, ya
desinstalado del NuStar el 18/09) hay que desinstalarlo antes de instalar el nuevo.

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

### Cómo publicar una actualización (ciclo del mes de prueba: 4-5 releases por app)

1. **Rama**: trabajar en la rama de la app (`apk-deposito`, …) partiendo de `main` al día.
2. **Cambiar y probar sin backend**: `node mobile/scripts/mock-deposito.mjs` +
   `VITE_API_BASE=http://localhost:3999` (`apps/deposito/.env.development.local`) +
   `npm run dev:deposito` → http://localhost:5175 (cualquier email, contraseña "x").
   El mock tiene idempotencia real y atajos (`/__mock/red?on=0&usuario=juan`,
   `/__mock/urgente?id=p1`, `/__mock/estado`) para repetir las pruebas de ruta,
   interrupción y concurrencia en minutos.
3. **Chequeos obligatorios**: `cd mobile && npm test` y, en la raíz, `npm run typecheck:movil`.
4. **¿El cambio toca el servidor?** (`lib/`, `app/api/`, migraciones) ⇒ primero se
   mergea a `main` **con OK del dueño** y se espera el deploy; recién después se
   reparte el APK. Una app nueva contra un servidor viejo ve "Operación desconocida"
   (queda rechazada, nada se pierde); un servidor nuevo con apps viejas funciona siempre
   (los cambios de protocolo son aditivos).
5. **Build**: `cd mobile && npm run build:apks -- --apps deposito --notas "qué cambió, en palabras del operario"`
   (`--bump patch` por defecto: arreglos; `--bump minor`: función nueva). Sale
   `dist-apks/deposito-v<versión>.apk`, firmado y verificado.
6. **Completar `apps/<app>/CHANGELOG.md`** (el script deja una línea) y commitear
   `version.json` + `CHANGELOG.md`. Push de la rama.
7. **Instalar encima** en cada handheld: `adb install -r dist-apks\deposito-v<versión>.apk`
   (o copiar el APK y abrirlo). Conserva sesión, réplica y operaciones sin enviar.
   Nunca desinstalar para actualizar: se perdería el outbox pendiente.
8. **Verificar en el equipo**: abre sin login, el contador ⇪ sigue igual, la versión
   nueva figura al pie del inicio.
9. Si algo sale mal: reinstalar el APK anterior **no** funciona encima (Android no deja
   bajar de versionCode): se publica un patch nuevo con el arreglo.

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
- **`npm run typecheck:movil` (raíz) — CHEQUEO OBLIGATORIO**, antes de cada commit
  y de pedir cualquier merge a `main`. Falla si:
  1. hay **cualquier** error de tipo en el **alcance móvil**
     (`scripts/typecheck-movil.alcance.json`: `lib/pricing/`, `lib/mobile/`,
     `lib/supabase/`, `lib/actions/pedidos.ts`, `app/api/mobile/`, precios
     programados y los endpoints chofer/vendedor corregidos);
  2. algún archivo del resto del repo tiene **más** errores que su base
     (`scripts/typecheck-movil.base.json`: 76 errores preexistentes en 36 archivos; la
     base **solo puede bajar**);
  3. el `tsc` del ERP **aborta** (sin memoria, señal, exit inesperado): nunca cuenta
     como verde;
  4. el typecheck `strict` de `mobile/` (core + 3 apps) tiene errores.

  **Reglas para las sesiones:**
  - Todo archivo del ERP que la sesión cree o modifique se agrega a
    `scripts/typecheck-movil.alcance.json` **en el mismo commit** (queda protegido en
    cero de ahí en más). Si arrastraba errores viejos, se arreglan ahí.
  - Si la base baja (se arregló algo viejo): `npm run typecheck:movil --
    --actualizar-base` y commitear el JSON. Nunca editar la base a mano para subirla.
  - Tarda ~1 min (tsc completo con 8 GB de heap; lo configura el script).
  - Verificado que detecta el incidente real: quitar el import de
    `limpiarCentinela` en `pedidos.ts` ⇒ ✗ con los 7 usos; un error nuevo fuera del
    alcance ⇒ ✗ "la base solo puede bajar".
- Typecheck solo de las apps: `cd mobile && npm run typecheck` (ya incluido arriba).
- ERP: `npm run build` en la raíz debe seguir pasando.
- Aceptación en equipo (checklist): ver §15.

---

## 15. Estado

> **SESIÓN 0 (FUNDACIÓN): CERRADA Y VALIDADA EN PRODUCCIÓN — 18/09/2026.**
> En `main` desde el merge `b5a08ce` + hotfix `c3b0978` (deploy gmv2.vercel.app).
> Las sesiones por app arrancan desde `main`.

Leyenda: ✅ hecho y verificado · 🟡 hecho, sin verificar en real (motivo indicado) ·
⏳ trabajo de las sesiones por app.

| Ítem | Estado |
|---|---|
| Auditoría (endpoints→tablas, subpantallas, cambios de backend, riesgos) | ✅ (§8, §9, §10, §16) |
| Workspace `mobile/` con 3 proyectos Capacitor (`com.gm.vendedor/chofer/deposito`) | ✅ compilan; typecheck strict limpio |
| Motor offline: réplica + outbox + sincronizador + reloj, con tests | ✅ 81 tests (core + depósito + vendedor); validado en equipo |
| Motor de precios isomórfico extraído, ERP usando el mismo código | ✅ en producción (preview verificado por el dueño + flujos de pedido probados) |
| Migración `20260918_mobile_fundacion.sql` | ✅ aplicada en producción; log de cambios, idempotencia e historial verificados en vivo |
| Vigencia programada (ERP + dispositivo + materialización) | ✅ probada en producción: aplicada por **pg_cron** a la hora exacta (ver abajo) |
| Historial de insumos | ✅ versión cerrada/abierta exactamente en la vigencia programada |
| Re-verificación de precios de pedidos offline (`verificarPreciosCapturados`) | 🟡 tests ✅; cableada en `pedido.crear` / `pedido.editar`; se ejercita en real al probar la app Vendedor contra el backend |
| Auth de dispositivo (Keystore, refresh, revocación) + Bearer en servidor | ✅ en equipo y **contra producción** (chofer v0.1.1 release) |
| Navegación: convención + hooks + botón atrás | ✅ en equipo |
| Lector: wedge + broadcast (plugin nativo) | ✅ compila; 🟡 el NuStar conectado no tiene servicio de escaneo habilitado |
| Pipeline de build firmado + keystores + CHANGELOG | ✅ las 3 apps v0.1.1 (versionCode 2) firmadas y verificadas |
| Chofer v0.1.1 **release** en el NuStar contra gmv2.vercel.app | ✅ login, viajes reales, reloj 2 s de desfasaje |
| Vendedor viejo v1.1 (`com.gm.vendedor`, otra firma) | ✅ desinstalado del NuStar |
| **App Depósito completa** (Sesión 3) | ✅ **CERRADA 18/09/2026**: en `main` (merge `3862a9a`), migraciones aplicadas, APK `deposito-v0.2.0` en el NuStar, checklist contra producción superado y base verificada idéntica (§17). Pendientes del mes de prueba: §17 |
| **App Vendedor completa** (Sesión 1) | 🟡 en la rama `apk-vendedor`: app, servidor, mock y tests ✅; probada en navegador y en el equipo contra el mock. **Falta** (requiere al dueño): aplicar la migración, merge a `main` y prueba contra el backend real con un usuario vendedor (§18) |
| Datasets/handlers y pantallas de chofer | ⏳ sesión Chofer (hoy solo el esqueleto de la fundación) |

### Validación en producción (18/09/2026)

| Prueba | Resultado |
|---|---|
| Deploy del merge | ✅ activo ~165 s después del push; rutas públicas/protegidas sanas; CORS de apps OK |
| Precio programado de prueba (SKU 100651, inactivo, sin pedidos): 4576.174634 → 4800, vigencia 11:38:00 | ✅ aplicado **11:38:00.07** por pg_cron (70 ms, sin ningún dispositivo logueado); historial `2998` cerrado y `4781` abierto a las 11:38:00; log `seq 8` |
| Reversión | ✅ precio de nuevo en **4576.174634**; programado, versiones de historial y log de la prueba borrados; historial original `2998` reabierto. Único rastro no reversible: `articulos.updated_at` = 18/09 11:38 (lo fija un trigger) |
| Chofer v0.1.1 release contra producción | ✅ login, viaje activo y últimos viajes reales |
| Flujos de pedido tras el hotfix (clientes/pedidos TEST-FUNDACION, luego borrados) | ✅ importación IA, pedido desde ERP, ítem bonificado, módulo vendedor web (comisión 5 % correcta) |
| Datos de prueba | ✅ 0 residuos (verificado por id y por texto). Números de pedido 001554–001556 consumidos (saltos en la numeración) |

**Incidente post-merge (resuelto):** la refactorización de precios dejó dos llamadas
al nombre viejo (`limpiarCentinela`, `getDescuentoViajante`) → `ReferenceError` en
`createPedido` y `agregarItemBonificado` (importación de pedidos en 500 entre 11:25 y
12:01). Hotfix `c3b0978`. Sin pérdida de datos: en esa ventana no entraron mails ni
se crearon pedidos. Causa de fondo: `ignoreBuildErrors: true` + el `tsc` completo del
repo se quedaba sin memoria (incluía `mobile/node_modules`) y abortaba sin reportar
errores. Ahora `tsconfig.json` excluye `mobile/` y `tsc` termina (~55 s con
`NODE_OPTIONS=--max-old-space-size=8192`). Línea base: **76 errores de tipo
preexistentes, ninguno de la fundación**. Para que no se repita quedó el chequeo
obligatorio **`npm run typecheck:movil`** (§14): alcance móvil en cero + base del
resto que solo puede bajar + un tsc que aborta nunca cuenta como verde.

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

0. **Chequeo de tipos**: `next.config.mjs` sigue con `ignoreBuildErrors: true` (76
   errores preexistentes), mitigado con el chequeo obligatorio `npm run
   typecheck:movil` (§14). Activar la verificación de tipos en el build de Next
   queda para cuando la base llegue a cero.
   **Pendiente documentado (decisión del dueño: no tocar en la Sesión 0):**
   referencias rotas PREEXISTENTES, fuera de la fundación, que dan `ReferenceError`
   si alguien usa esa función/pantalla:
   - `app/api/articulos/[id]/packaging/route.ts` y `app/api/articulos/mappings/route.ts`
     → `createClient` no importado;
   - `app/ordenes-compra/page.tsx` → `supabase` no definido (2 usos);
   - `lib/actions/clientes.ts` → `updateClienteEmbedding` no definido;
   - `lib/pricing.ts` (motor legacy de pedidos manuales) → `calcularPrecioVentaOffline`,
     `calcularPrecioFinalOffline` no definidos.
   Están en la base de `typecheck:movil`; al arreglarlas, bajar la base.
1. **Introspección de la base bloqueada** en esta sesión (permiso del entorno): el
   esquema se infirió de `supabase/migrations/` y `scripts/`, que están incompletos
   (tablas centrales creadas fuera de migraciones). Ya confirmado en producción: las
   tablas con trigger tienen `id`, pg_cron activo, `viajes`/`pedidos` sin RLS
   efectiva para anon (ver 2).
2. **RLS (confirmado)**: con la anon key pública (la del bundle web) se leen filas de
   `viajes`, `pedidos` y `usuarios` sin sesión. Las apps no dependen de RLS (todo por
   API con Bearer), pero es un riesgo del ERP a resolver aparte.
3. **Keystore del chofer viejo perdido**: el APK viejo `com.gm.chofer` (si está en
   algún equipo) debe desinstalarse antes del nuevo.
4. **Reloj del handheld**: mitigado con `Reloj` (desfasaje medido). Un equipo que
   nunca tuvo red desde que se cambió la hora usa el último desfasaje conocido.
5. **pg_cron**: activo y verificado (materializó un programado a la hora exacta).
6. `.env.vercel`: sacado del repo y en `.gitignore` (queda en el historial de git).

---

## 17. Depósito (com.gm.deposito) — Sesión 3

Réplica fiel de `app/deposito/` (sin funciones nuevas), offline-tolerante. Código:
`mobile/apps/deposito/src` (`datasets.ts`, `datos/` = búsqueda local + overlay + hooks,
`pantallas/`, `rutas.tsx`). Servidor: `lib/deposito/*`, `lib/mobile/{sync,outbox}/deposito.ts`.

### Datos
| Dataset | Modo | Refresco | Contenido |
|---|---|---|---|
| `deposito_pedidos` | delta (`pedidos`, `pedidos_detalle`) · invalidable | segundos (sondeo 15 s) + 45 s | pedidos `pendiente/en_preparacion/impreso` con renglones, artículo (EAN, bulto, `orden_deposito`), quién tomó cada renglón y lo necesario para recalcular bonificados |
| `deposito_recepciones` | snapshot | 60 s + al entrar | = GET web: OCs pendientes + última recepción |
| `deposito_devoluciones` | snapshot | 2 min + al entrar | = GET web |
| `deposito_articulos` | delta (`articulos`) · invalidable | segundos | catálogo activo: códigos, stock, orden, proveedor, categoría, fracción, marca |
| `deposito_catalogos` | snapshot | 30 min | proveedores, tipos de bulto/fracción, transportes |

Ninguno depende del usuario ⇒ `replicaPorUsuario: false`. Todo stock mostrado sale de la
réplica con su `<Frescura>` (ámbar a los 10 min); lo ajustado sin enviar lleva la marca
"⇪ sin enviar". `orden_deposito`: hoy la web **no** ordena el picking por él (la lista
sale en el orden del pedido) y la app lo respeta; sí lo usa, igual que la web, el
recorrido Anterior/Siguiente de Modificación de artículos (calculado sobre la réplica).

### Picking offline y política de concurrencia
- **Progreso persistente**: cada renglón marcado es una operación del outbox (durable
  al instante). La pantalla = réplica + operaciones sin enviar (overlay), así un picking
  a medias sobrevive a cerrar la app, cambiar de pantalla o perder WiFi, sin guardar nada
  aparte. Finalizar sin señal saca el pedido de la cola ("N finalizados sin enviar").
- **Bonificados**: se recalculan en el equipo con `lib/deposito/bonificados.ts`, la
  misma función que usa el servidor ⇒ offline se ven (y se confirman) las mismas unidades.
- **Política (la del backend web, ahora blindada)**: un pedido lo preparan VARIOS
  operarios a la vez; **un renglón es de quien lo marca primero**. Otro operario lo ve
  con 🔒 y el nombre, y no puede tocarlo; devolverlo a pendiente lo libera. No hay lock
  de pedido.
  - Servidor: el reclamo se inserta en `picking_items` ANTES de escribir la cantidad
    (índice único `ux_picking_items_renglon`); el que pierde la carrera recibe 409 y su
    cantidad **no** se escribe ⇒ nunca hay picking duplicado ni pisado.
  - Dos equipos sin señal sobre el mismo renglón: gana el primero que sincroniza; al
    otro la operación le vuelve **rechazada** ("Ya lo preparó Ana…"), visible en la
    pantalla del pedido con "Entendido", y la lista se re-sincroniza sola.
  - Valores ABSOLUTOS por renglón + clave de idempotencia ⇒ reenviar es inocuo.
    `picking.cerrar` es idempotente (dos operarios finalizando = un cierre); si al
    cerrar quedan renglones pendientes (otro los liberó) ⇒ rechazo y el pedido vuelve a la cola.
  - Renglón sobre pedido ya cerrado ⇒ rechazo ("El pedido ya se cerró").
- **Recepción**: todo se direcciona por la OC (la recepción se crea sola en el servidor:
  se puede empezar a contar sin señal). Conteo absoluto por artículo (último escritor
  gana), primer control de bultos registrado vale, finalizar idempotente con candado.
- **Stock**: el ajuste es un conteo del operario y se aplica siempre; si el stock cambió
  entre el conteo y el sync queda una alerta `stock_conteo` en `mobile_alertas_integridad`.
  `deposito_ajustes_movil` audita cada ajuste (incluye el motivo) y evita la doble suma.
- **Datos de artículo**: compare-and-set por campo; lo que otro cambió no se pisa y
  vuelve como rechazo explicando qué campo.

### Renglón del artículo y ficha (22/09/2026, pedido del dueño tras el primer uso)
**Problema:** la descripción iba en UNA línea a 22 px y se cortaba a los ~14 caracteres:
"PROTECTOR ANATÓMICO S/D ROSA x20u" se leía "PROTECTOR ANAT" y no se distinguía de
"…C/D VERDE x40u". Medido en el mock con datos del largo real (360×800):

| | antes | ahora |
|---|---|---|
| caracteres visibles | 13–15 (de 39–54) | 36–44 |
| alto del renglón | 105 px | 90 px |
| renglones en pantalla | 3 | 4 |

**Cómo:** descripción en DOS líneas a 17 px (`DESCRIPCION` en `ui.tsx`, line-clamp 2) y
alto ganado en el resto: `Encabezado` 56 → 44 px y `Frescura` más fina (props `compacto`
**opt-in** del core: chofer y vendedor quedan igual), cabecera del pedido/recepción en dos
renglones, barra de progreso más fina y la ayuda del swipe solo mientras el pedido no se
empezó. El catálogo real tiene mediana 33 caracteres y p90 45: entran casi todos; lo que
no entra se lee en la ficha.

**Ficha del artículo** (`pantallas/comunes/FichaArticulo.tsx`): un TOQUE en el renglón la
abre (picking y recepción) con foto, descripción completa, SKU, marca, unidades por bulto
y EAN. Es un overlay `?ficha=<articulo_id>`: el botón atrás la cierra sin salir de la
pantalla, y si el operario escanea con la ficha abierta, la pantalla de cantidad REEMPLAZA
la entrada (atrás vuelve a la lista, no a la ficha).
- El swipe para marcar faltante no cambia: en `TarjetaSwipe`, un dedo que se movió más de
  6 px (swipe o scroll) nunca cuenta como toque.
- Los datos salen de la réplica (`deposito_articulos`), así que la ficha abre sin señal.
  La FOTO es lo único que viaja por red: `articulos.imagen_url`, bucket **público**
  `articulos-imagenes` (no vence, no hay que firmarla), la tienen ~42 % de los artículos y
  suma ~133 KB a la réplica. Sin foto cargada, sin señal o si la URL no resuelve, la ficha
  dice el motivo en vez de mostrar una imagen rota. **Pendiente del mes de prueba:** un
  artículo que nunca se vio con WiFi no muestra la foto offline (el WebView solo cachea lo
  ya visto); si molesta, habría que guardar las fotos en la réplica.

### Lector
`useLector` en toda pantalla donde hoy se identifica un artículo. En la lista del
pedido / recepción el gatillo abre la cantidad del renglón; **un segundo gatillo sobre
el mismo artículo confirma** la cantidad mostrada (sin tocar la pantalla); otro código
ahí da error y no pierde nada. Buscar y tocar es siempre posible (mercadería sin
etiqueta). `useCampoSinRafaga`: el lector-teclado tipea en el input con foco; al
detectarse la lectura se restaura el valor previo (bug real encontrado en el NuStar:
un segundo escaneo dejaba la cantidad en 0). Cantidades de 7+ cifras se rechazan.

### Navegación — matriz del botón atrás (verificada en navegador y con el botón físico del NuStar)
| Pantalla | Ruta | Atrás va a |
|---|---|---|
| Inicio | `/` | minimiza (el proceso y el outbox siguen vivos) |
| Cambiar de usuario (hoja) | `/?ver=salir` | cierra la hoja |
| Cola de pedidos | `/preparar` (`?plegados=` replace) | Inicio |
| Pedido (lista) | `/preparar/:id` | Cola — **el progreso queda "en curso"** |
| Buscar artículo | `/preparar/:id/buscar` (`?q=` replace) | Pedido |
| Cantidad | `/preparar/:id/item/:detId` | Pedido (desde Buscar se entra con replace; "Volver al scanner" = replace a Buscar) |
| Faltantes | `/preparar/:id/faltantes` | Pedido |
| Finalizar con bonificados (hoja) | `?ver=finalizar` | cierra la hoja · confirmar ⇒ Cola |
| Aviso de pedido urgente | `?urgente=<id>` sobre la pantalla actual | cierra el aviso · "¡Preparar!" = replace al pedido |
| Órdenes a recibir | `/recibir` | Inicio |
| Recepción (control de bultos o lista) | `/recibir/:id` | Órdenes |
| Buscar / Cantidad / Faltantes | `/recibir/:id/{buscar,item/:articuloId,faltantes}` | Recepción (mismas reglas que picking) |
| Documentos (online-only) | `/recibir/:id/documentos` | Recepción |
| Devoluciones | `/devoluciones` | Inicio |
| Buscar artículo del camión | `/devoluciones/buscar` | Devoluciones |
| Devoluciones con ese artículo | `/devoluciones/articulo/:artId` | Devoluciones ("Buscar otro" = replace a Buscar) |
| Confirmar devolución | `/devoluciones/:id` | la pantalla desde la que se abrió |
| Modificación de artículos | `/articulos` (`?q= ?prov= ?cat=` replace) | Inicio |
| Filtro proveedor / categoría (hoja) | `?ver=prov` · `?ver=cat` | cierra la hoja |
| Listado navegable | `/articulos/lista?rec=…` | Modificación de artículos |
| Editor de artículo | `/articulos/:id?rec=…` (`?tab=` y Anterior/Siguiente = replace) | Listado (o búsqueda), con autoguardado de datos |
| Enviar a INEXISTENTE (hoja) | `?ver=inexistente` | cierra la hoja |
| Operaciones pendientes | `/pendientes` | la pantalla anterior |

### Usuarios y turnos
El módulo trabaja con **un usuario por operario** (el picking registra quién preparó
cada renglón). Cambiar de usuario (ícono del inicio) es inmediato: sin borrar la
réplica y sin perder lo pendiente del anterior (sesión aparcada, §7). Medido: 54 ms
hasta el inicio del operario siguiente; lo pendiente del anterior salió a su nombre.

### Diferencias con la web (impuestas por navegación / offline / plataforma)
- Encabezado del core (atrás, "En línea/Sin red", contador ⇪) en lugar del header web.
- El aviso de urgente sale de la réplica (no hay Realtime ni keys en el APK).
- Fotos + OCR de recepción: botón único "📷 Documentos" → pantalla online-only.
- `confirm()` nativos ⇒ hojas con historial. "Cambiar a Chofer" no existe (es otro APK).
- La búsqueda es local (todas las palabras, sin acentos) en vez del motor trigram/vector.
- Inicio con contadores por módulo. Fecha de la OC sin corrimiento de huso.

### Incidente del preview (18/09/2026): cola vacía y fotos que no abren — causas PREEXISTENTES
Revisando el preview de la rama, el dueño vio la cola de `/deposito` vacía y no pudo abrir
las fotos de facturas. **Ninguna de las dos venía de la rama ni de la migración** (la web
no depende de `20260919_mobile_deposito.sql`); las dos están igual en producción:

1. **Cola vacía** — `GET /api/deposito/pedidos` (sin tocar por la rama) hacía
   `pedidos + pedidos_detalle embebido + ORDER BY + LIMIT`. Postgres arma los renglones de
   TODOS los pedidos de la cola antes de ordenar; con **1.285 pedidos / 53.867 renglones**
   (1.267 `impreso` acumulados desde abril) supera el statement timeout de 8 s — medido:
   hasta una página de 20 muere a los 8 s, sin `ORDER` tarda 0,5 s. La route devolvía 500
   y la pantalla, al no recibir un array, mostraba "0 pedidos" **sin ningún error**. Aunque
   terminara, la respuesta pesaba **21 MB** (Vercel corta en 4,5 MB).
   *Fix:* `lib/deposito/cola.ts` — pedidos sin embeber + conteos por tandas (1.286 pedidos
   en 0,51 MB); la pantalla ahora muestra el error si la API falla. Migración
   `20260919_idx_pedidos_detalle_pedido.sql` (índice por `pedido_id`: contar los renglones
   de 100 pedidos tardaba ~4 s) — opcional, acelera todo el ERP.
2. **Fotos** — viven en el bucket **privado** `comprobantes`; `url_imagen` guarda una URL
   firmada por 7 días (o una "public" que un bucket privado nunca sirve). Pasada la semana
   no abre ninguna desde depósito (la pantalla de OC del ERP sí, porque re-firma al leer).
   *Fix:* `firmarDocumentosRecepcion()` firma al servir (POST `/api/deposito/recepciones`,
   que usan la web y la app). Verificado: 9 de 12 abren; las 3 restantes son registros sin
   archivo (`mock-storage.com`, una subida fallida `error-upload/…`, un `null`, de mayo/junio).

**Regla que queda:** nunca embeber una tabla de renglones en un listado con `ORDER`/`LIMIT`;
y un listado que recibe un error lo muestra (un "vacío" silencioso tapó esto).

### Alcance de la cola en el handheld (DECIDIDO por el dueño, 18/09/2026)
La cola completa (21 MB) no se puede replicar. `DIAS_IMPRESO = 7` en
`lib/mobile/sync/deposito.ts`: se replican todos los `pendiente` y `en_preparacion`, los
`impreso` de los últimos **7 días** y cualquier pedido con picking empezado (medido: 97
pedidos, 3.832 renglones, 1,95 MB, 2,5 s). La web sigue mostrando la cola completa.
En delta, un `impreso` que envejece no genera evento: sale del equipo en el próximo snapshot.

### PENDIENTE (tarea aparte, DESPUÉS de cerrar esta app): depurar los `impreso` viejos
**No se tocó ningún pedido.** Propuesta para la limpieza pre-producción; se ejecuta solo con
OK del dueño, paso por paso.

*Foto del 18/09/2026 (solo lectura):* pedidos por estado — impreso 1.268 · eliminado 269 ·
en_preparacion 13 · facturado 6 · pendiente 5 · en_viaje 3 · en_venta 1. De los impresos,
**1.189 tienen más de 7 días**: ninguno con viaje asignado; 6 con comprobante de venta, 2 con
remito, 211 con movimientos en kardex, 1 con sesión de picking ⇒ **214 con alguna evidencia
de haberse despachado** y **975 sin ninguna** (abr 82 · may 219 · jun 167 · jul 196 · ago 189 ·
sep 122). Mientras sigan en `impreso`, la cola web crece sin techo (hoy carga en segundos
gracias a `lib/deposito/cola.ts`, pero son 1.286 filas que nadie va a preparar).

1. **Qué pedidos exactamente.** Solo `estado = 'impreso'` con `created_at` anterior a una
   fecha de corte que fija el dueño, y **sin** picking empezado (`picking_sesiones`
   EN_PROGRESO) ni renglones con `estado_item` distinto de PENDIENTE. Antes de tocar nada se
   exporta el listado (número, cliente, fecha, total, evidencia) para que el dueño lo revise
   y saque a mano los que sí haya que preparar. Se tratan como DOS grupos:
   - *A — con evidencia* (comprobante / remito / kardex): ya salieron del depósito.
   - *B — sin evidencia*: hay que decidir uno por uno o por período (¿se entregaron por fuera
     del sistema?, ¿son pruebas de la carga inicial?, ¿nunca se hicieron?).
2. **A qué estado pasarían.** A decidir con el dueño, porque define reportes y cuenta
   corriente: grupo A ⇒ el estado que el ERP ya usa para lo despachado (`facturado` si tiene
   comprobante; si no, el que corresponda al circuito real — hoy hay solo 6 `facturado`, así
   que ese circuito todavía no es la norma). Grupo B ⇒ **no** inventar un estado nuevo ni usar
   `eliminado` a ciegas (la purga nocturna `/api/cron/purge-deleted-orders` los borraría de
   verdad): o pasan al mismo estado que A si el dueño confirma que se entregaron, o quedan
   como están. Un UPDATE de `estado` no mueve stock ni kardex (verificar triggers de
   `pedidos` antes: `trg_mobile_cambios` solo loguea).
3. **Cómo se revierte.** Antes del UPDATE: tabla de respaldo
   `pedidos_depuracion_20260918 (pedido_id PK, estado_anterior, depurado_at, lote)` poblada
   con el mismo filtro dentro de la misma transacción. Revertir un lote =
   `UPDATE pedidos p SET estado = d.estado_anterior FROM pedidos_depuracion_… d WHERE p.id =
   d.pedido_id AND d.lote = X AND p.estado = <estado nuevo>` (la última condición evita pisar
   un pedido que alguien tocó después). Se hace por lotes chicos (un mes por vez), verificando
   después de cada uno: conteo por estado, la cola de depósito, saldos de cuenta corriente y
   comisiones sin cambios. La tabla de respaldo se conserva hasta el cierre de la limpieza.
4. **Prevención.** Decidir con el dueño qué paso del circuito saca un pedido de `impreso`
   (hoy solo el picking digital lo hace); con la app en uso, los pedidos se cierran solos.

### Puesta en marcha — HECHA (18/09/2026)
1. ✅ `apk-deposito` → `main` (merge `3862a9a`, autorizado por el dueño tras verificar el preview); deploy OK.
2. ✅ Migraciones aplicadas por el dueño en el SQL Editor, en este orden:
   `20260919_idx_pedidos_detalle_pedido.sql` (contar renglones de 100 pedidos: ~4.000 ms → 222 ms;
   la consulta vieja que daba timeout: 427 ms) y `20260919_mobile_deposito.sql` (log de cambios
   de `pedidos` activo; `deposito_ajustes_movil` creada).
3. ✅ Cola web verificada por el dueño en producción (antes del merge estaba VACÍA: el error
   silencioso estaba vivo).
4. ✅ NuStar con `deposito-v0.2.0` (instalado encima del esqueleto) y sesión de un usuario `deposito`.

### Checklist contra PRODUCCIÓN en el NuStar 65-sp (18/09/2026) — SUPERADO
Datos de prueba creados por el dueño desde el ERP y marcados `TEST-DEPOSITO`: cliente, pedido
001566 (3 renglones) y OC-000010 (1 renglón, HALEON). Foto de solo lectura antes y después
(`scripts/foto-deposito.cjs`: filas de 18 tablas, numeración, stock de los 3.271 artículos).

| Prueba | Resultado |
|---|---|
| Cola real en el equipo | ✅ 98 pedidos (alcance 7 días), 001566 incluido |
| Ruta: abrir con red → **modo avión real** → renglón por búsqueda manual, faltante por swipe, salir a la cola y volver → reconectar | ✅ a los 14 s las 2 operaciones aplicadas **1 vez**; `picking_items` a nombre del operario |
| Interrupción: matada desde recientes en modo avión | ✅ reabre sin login en 500 ms; "En progreso · ⇪ 2 sin enviar" |
| Concurrencia: NuStar sin red marca un renglón; otro usuario (web) marca el mismo; reconectar | ✅ gana la web; al NuStar le vuelve **rechazado** "Ya lo preparó FABIAN…" con "Entendido", contador rojo; servidor sin duplicar |
| Cierre del pedido | ✅ `pendiente_facturacion` una vez; sale de la cola del equipo (98 → 97) |
| Recepción empezada y terminada sin red (la recepción no existía en el servidor): bultos 1/1, conteo, finalizar | ✅ aplicada 1 vez: stock 100 → 101, 1 kardex, 1 movimiento, OC `recibida_completa` |
| **Reintento del cierre de recepción** (bug del stock duplicado) | ✅ 2 reintentos con la misma función del handler ⇒ `ya_finalizada`; stock 101, 1 kardex, 1 movimiento |
| Limpieza | ✅ borrado por id (3 picking_items, 2 sesiones, 5 kardex, 1 movimiento, recepción+item, OC+detalle, pedido+3 renglones, cliente, 9 de `mobile_idempotencia`) y stock 101 → 100 con compare-and-set. **Foto final: IDÉNTICA** en las 18 tablas, numeración (`001565` / `OC-000009`) y stock; 0 residuos por texto. Queda solo lo no reversible: entradas del log `mobile_cambios` (se purgan a los 30 días) y `updated_at` del artículo |

Aprendido en la prueba: crear un pedido desde el ERP escribe 3 filas "venta" en kardex pero
**no** descuenta `stock_actual`; crear una OC escribe una fila "compra" en estado pendiente
ligada por `orden_compra_id` (hay que contarlas al limpiar datos de prueba).

### PENDIENTES DEL MES DE PRUEBA (no bloquean el uso)
1. **Gatillo del lector físico.** El NuStar de pruebas no tiene servicio de escaneo (el dueño
   está averiguando con el proveedor si este equipo trae lector). `adb input text` no emula bien
   la ráfaga (a veces la detecta, a veces no). Validar con un lector real: abrir la cantidad
   desde la lista, **segundo gatillo = confirmar**, código de otro artículo = error sin perder
   nada, y que la ráfaga no ensucie el campo de cantidad ni el buscador (`useCampoSinRafaga`).
   Si el firmware usa broadcast: `configurarBroadcast(accion, extra)` (§11).
2. **Pantalla de fotos de recepción con documentos reales**: sacar foto de remito/factura
   (cámara del equipo), OCR, abrir con el ojito (URL firmada al servir) y eliminar. La OC de
   prueba no tenía documentos; la firma de URLs se verificó en la web (9 de 12 fotos abren; las
   otras 3 no tienen archivo).
3. **Devoluciones con el flujo real de chofer** (ver abajo).
4. Gestos con el dedo (swipe, objetivos táctiles): los prueba el depósito; acá se hicieron por adb.
   Incluye el TOQUE que abre la ficha del artículo y que el swipe siga saliendo natural.
5. Detalles vistos en el equipo: en Buscar, con el teclado abierto, la lista de resultados queda
   chica (los botones del pie ocupan lugar); en la cola, "⇪ N sin enviar" se parte en dos líneas.
   Resuelto el 22/09: la descripción del artículo se cortaba a los ~14 caracteres (ver arriba).
6. Tarea aparte ya anotada: depuración de los `impreso` viejos (arriba).

### Devoluciones: FUERA del checklist contra producción (decisión del dueño, 18/09/2026)
No hay devoluciones cargadas en el sistema (0 filas). El flujo de la app (listado, buscar por
artículo, confirmar vendible / no vendible, `devolucion.recibir` idempotente) quedó probado solo
contra el mock. Se valida en el **mes de prueba con el flujo real**: el chofer registra la
devolución y depósito la recibe. Verificar ahí: que aparece en el handheld, que al confirmar
el stock de lo vendible sube UNA vez y que la devolución queda `confirmado`.

### Resultados de las pruebas de esta sesión (18/09/2026)
| Prueba | Dónde | Resultado |
|---|---|---|
| Ruta: cola con red → sin red: gatillo, 2º gatillo confirma, búsqueda manual + parcial, faltante → **recarga** → progreso intacto → finalizar → reconectar | navegador + mock | ✅ 7 operaciones, cada una aplicada **1 vez**; pedido cerrado 1 vez; servidor = pantalla |
| Concurrencia: Juan (sin señal) y Ana (con señal) marcan el mismo renglón | 2 instancias + mock | ✅ gana Ana; a Juan le vuelve rechazado con motivo y "Entendido"; su otro renglón entra; 🔒 en ambas pantallas; sin duplicados |
| Bonificados offline (10 %) | navegador + mock | ✅ 4 u calculadas en el equipo = 4 u que fijó el servidor |
| Recepción iniciada y terminada sin señal (bultos, fuera de OC, artículo sin EAN por búsqueda manual, finalizar) | navegador + mock | ✅ 12 operaciones aplicadas 1 vez; OC cerrada 1 vez |
| Cambio de usuario con 2 pendientes | navegador + mock | ✅ 54 ms; lo de Juan se envió **como Juan** con Pedro logueado; sesión aparcada descartada |
| Aviso de urgente en otra pantalla | navegador + mock | ✅ 3 s; atrás lo cierra |
| Lista de 6.000 artículos | navegador | ✅ 15 filas en el DOM; abre en ~20 ms |
| Arranque en frío | **NuStar 65-sp** | ✅ 457–598 ms |
| Interrupción: picking sin red → **matar desde recientes** → abrir | **NuStar 65-sp** | ✅ abre sin login, progreso y contador ⇪ intactos |
| Atrás físico: teclado → Buscar → Pedido → Cola → Inicio → minimiza | **NuStar 65-sp** | ✅ proceso vivo al minimizar |
| Reconexión | **NuStar 65-sp** | ✅ todo aplicado 1 vez al volver a primer plano |
| Lector físico | — | 🟡 este equipo no tiene servicio de escaneo; ráfaga simulada con `adb input text` (tiempos irregulares). Validar el doble gatillo con un lector real |
| Backend real (handlers contra Supabase) | — | 🟡 tipado y build en verde; sin ejecutar: necesita el deploy en `main` y un usuario `deposito` |

---

## 18. Vendedor (com.gm.vendedor) — Sesión 1

Réplica fiel de `app/vendedor/` (sin funciones nuevas), offline-first. Código:
`mobile/apps/vendedor/src` (`datasets.ts`, `datos/` = búsqueda local · motor de precios ·
borrador · overlay · hooks, `pantallas/`, `rutas.tsx`). Servidor: `lib/vendedor/*`,
`lib/mobile/{sync,outbox}/vendedor.ts`, `lib/mobile/contexto-captura.ts`.

### Datos
| Dataset | Modo | Refresco | Contenido |
|---|---|---|---|
| `precios_*` (5, de la fundación) | delta · invalidable | **segundos** (sondeo 15 s) + al abrir + 5–10 min | insumos del motor: nunca un precio calculado |
| `vendedor_articulos` | delta (`articulos`) · invalidable | segundos | catálogo vendible con la forma de la web + `proveedor_id`, `created_at`, `codigo_bulto`, `sigla` (lo que el servidor usaba para resolver vistas y códigos) |
| `vendedor_catalogos` | snapshot | 30 min | 7 filas = los GET de la web: taxonomía, proveedores, ventas 180 d, listas permitidas, catálogos de ficha, cuentas bancarias, zonas |
| `vendedor_clientes` | snapshot (por lote) | 3 min + al entrar | cartera: fila del listado + campos de la ficha + bonificaciones + saldos real/proyectado |
| `vendedor_cc` | snapshot + **parcial** | 15 min · al abrir la ficha con señal se re-lee SOLO ese cliente | = GET `cliente/[id]` + comprados (devoluciones) + habituales |
| `vendedor_pedidos` | delta (`pedidos`, `pedidos_detalle`) · invalidable | segundos | 90 días + todos los vivos (tope 250), cada uno = GET `pedidos/[id]` |
| `vendedor_billetera` | snapshot | 10 min + tras cada cobro/pedido aplicado | billetera, comisiones ×2, detalle de comisión de los 150 pedidos más recientes, pagos por rendir, rendiciones, estadísticas |
| `vendedor_viajes` | snapshot + parcial | 10 min | listado + detalle de los viajes en curso y los 5 últimos |
| `vendedor_me` | snapshot | 5 min | = GET `me` |

Dependen del vendedor ⇒ `replicaPorUsuario` default (otro usuario en el equipo limpia la réplica).
Medido con la cartera más grande (86 clientes) y el catálogo real (1.841 artículos vendibles,
2.015 con insumos de precio): el fixture completo pesa 3,1 MB.

### Pedido sin señal
- **Borrador durable.** En la web el carrito ES un pedido `en_venta` guardado ítem a ítem en la
  base; sin señal eso no existe. Acá es un borrador por cliente en IndexedDB
  (`datos/borradores.ts`), persistido en cada cambio: matar la app a mitad de un pedido no
  pierde nada ("Pedido a medio cargar" en el inicio y en Mis pedidos). Guarda artículos y
  cantidades, **nunca precios**.
- **Una operación.** Confirmar = `pedido.crear` (o `pedido.editar`) con el estado FINAL de los
  renglones, condiciones, observaciones y `precios_al`. El borrador se suelta recién después de
  que la operación quedó durable en el outbox.
- **Pendiente de enviar.** Se ve en Mis pedidos (sin número: lo da la oficina) con su detalle
  completo. **Editable y descartable hasta que sincroniza** (`outbox.retirar`): editar lo devuelve
  al borrador con el MISMO `local_id`; al reconfirmar viaja una operación nueva. Si el envío
  anterior había llegado y se perdió la respuesta, el servidor lo encuentra por
  `pedidos.movil_local_id` y lo lleva al estado final en vez de duplicar.
- **Servidor** (`aplicarPedido`): valida cliente (activo, asignado), pedido editable
  (`esPedidoEditable` ⇒ si pasó a facturación, rechazo con `motivoBloqueo`), reconstruye insumos,
  verifica precios, y ejecuta las MISMAS server actions que la web (`createPedido` /
  `aplicarCondicionesPedidoVendedor` + reconciliar renglones con `agregarItemPedido` /
  `actualizarCantidadItem` / `eliminarItemPedido` + `confirmarPedidoVendedor`). `createPedido` no es
  transaccional: si se corta a mitad, el reintento entra por `movil_local_id` y completa lo que falte.
- **Editar un pedido ya confirmado**: los renglones que ya tenía conservan SU precio mientras no
  cambien las condiciones (la web tampoco los re-precia) ⇒ viajan con `precio_fijo` y no se
  re-verifican; los nuevos y los de un `en_venta` salen del motor. Desde el detalle del pedido
  las cantidades se guardan solas (una `pedido.editar` con `confirmar:false`; la pendiente
  anterior del mismo pedido se reemplaza).
- **"Guardar en la ficha"** desde el panel 👤: encola `cliente.editar` + `cliente.bonificaciones`
  Y deja esos valores como condiciones del pedido en curso. Motivo: sin señal la ficha cambia
  recién al sincronizar, y el servidor reconstruye la ficha a `precios_al` (anterior): si no
  viajaran en el pedido, el pedido saldría con las condiciones viejas.

### Precios: vigencia = lo que el vendedor tenía a la vista (decisión de esta sesión)
`precios_al` = frescura (hora del SERVIDOR) más vieja de los 5 datasets `precios_*` al confirmar.
El servidor recalcula con los insumos vigentes a `min(capturado_at, precios_al)`.
- **Por qué**: con "vigentes a `capturado_at`" a secas, un cambio de precio hecho en el ERP con
  el equipo sin señal produce SIEMPRE diferencia (el equipo no puede conocerlo), se factura a un
  precio que el cliente no vio y la "alerta de integridad" pasa a ser ruido diario. Con
  `precios_al` el recálculo da idéntico por construcción; una diferencia vuelve a ser bug o dato
  corrupto ⇒ alerta al admin y se factura el precio del servidor, sin avisarle al vendedor.
- **Regla CONFIRMADA por el dueño (21/09/2026), con tope de 24 hs.** Un equipo unas horas sin
  señal vende con la lista de esa mañana, como la lista impresa que usaban (a la vista:
  `<Frescura>` "Precios al dd/mm hh:mm", ámbar pasados 30 min). Pero si al tomar el pedido hacía
  **más de 24 hs** que el equipo no actualizaba precios (`capturado_at − precios_al > 24 h`):
  - el servidor NO honra el precio del equipo: usa los insumos vigentes **al ingresar el pedido**
    (`vigenciaDelPedido()` → `garantizada: false`), no corre `verificarPreciosCapturados` (una
    diferencia es esperable, no una alerta) y devuelve `precios_garantizados: false`;
  - la app muestra, mientras dure, el cartel rojo fijo **"HACE MAS DE 24HS NO SE ACTUALIZAN
    DATOS, LA EMPRESA NO SE RESPONSABILIZA POR DIFERENCIA DE PRECIOS"** en el inicio, todo el
    catálogo, el carrito (que además aclara que el total es orientativo) y Precios
    (`usePreciosVencidos`, se re-evalúa cada minuto y desaparece apenas entra un sync).
  - Cuenta la antigüedad **al capturar**, no lo que tardó en sincronizar: un pedido tomado con
    precios frescos que sale 3 días después se respeta.
  - Una sola definición para servidor y app: `lib/vendedor/vigencia-precios.ts` (`@gm/vendedor`).
- **Cómo se inyecta sin tocar el camino web**: los 6 helpers de lectura de insumos de
  `lib/actions/pedidos.ts` consultan `capturaActual()` (AsyncLocalStorage). Un parámetro en una
  server action lo podría fijar un cliente remoto; un contexto en memoria del proceso, no.
- Cambios **programados**: el equipo los aplica solo a la hora exacta aun sin red
  (`useInsumosBase` re-renderiza en `proximaVigencia`).
- Medido: motor sobre los 2.015 artículos reales = 50 ms (0,025 ms por artículo).

### Búsqueda
Local sobre la réplica (`datos/busqueda.ts`), mismo orden que `hybridSearchIds`: código (exacto
sku/EAN/bulto → prefijo de sku) → texto (todas las palabras, sin acentos, también pegadas, con
el puntaje de `search_articulos`) → tolerancia a errores de tipeo por trigramas si lo exacto trae
menos de 4. **No está** la pata vectorial (embeddings, necesita red) ni los alias de proveedor.
**Prioridad por filtro activo** = la de la web: dentro de un filtro / proveedor / categoría se
busca SOLO en ese listado (`filtrarLocal`), y "Buscar en todo el catálogo" es explícito.
El texto de búsqueda vive en estado local y se guarda en la URL con 250 ms de retardo
(`useBusqueda`): escribir cada tecla en la URL re-renderizaba todo el árbol de rutas.

### Navegación — matriz del botón atrás
Verificada en navegador (`history.back()`) y con el **botón físico del NuStar** (flujo de pedido).
Replace = no agrega historial (atrás sale de la pantalla).

| Pantalla | Ruta | Atrás va a |
|---|---|---|
| Inicio | `/` | **minimiza** (proceso y outbox vivos). No existe ruta del ERP |
| Cerrar sesión (hoja) | `/?ver=salir` | cierra la hoja |
| Billetera | `/billetera` (`?tab=` `?comTipo=` replace) | pantalla anterior |
| Detalle de comisión | `/billetera/comisiones/:pedidoId?tipo=` | **Billetera en la pestaña comisiones** (abierto sin historial: `/billetera?tab=comisiones`) |
| Rendiciones | `/rendiciones` (`?abierta=` replace) · `?ver=confirmar` | Billetera · cierra la hoja |
| Mis pedidos | `/pedidos` (`?estado=` replace) | pantalla anterior |
| Pedido | `/pedidos/:id` (`local:<id>` = pendiente de enviar) | Mis pedidos (o la pantalla desde la que se abrió) |
| …quitar renglón / eliminar / descartar / foto | `?ver=quitar:<id>` · `?ver=eliminar` · `?ver=descartar` · `?foto=` | cierra la hoja · confirmar eliminar/descartar ⇒ Mis pedidos |
| Elegir cliente | `/pedido/nuevo` (`?q=` replace) | pantalla anterior. Elegir = **replace** (como la web): atrás desde el catálogo NO vuelve al selector |
| Catálogo | `/pedido/nuevo/:clienteId` (`?q=` replace) | pantalla anterior — **el pedido en curso queda guardado** |
| Proveedores | `…/proveedores` | Catálogo |
| Árbol de un proveedor | `…/proveedor/:provId` (`?q=` replace) | Proveedores |
| Novedades / Ofertas / Habituales | `…/filtro/:tipo` (`?q=` replace) | Catálogo |
| Rubro (tarjetas) | `…/rubro/:rubroId` | Catálogo |
| Categoría (lista) | `…/rubro/:rubroId/:catId` (`?q=` `?sub=` replace) | Rubro |
| Ficha del artículo | `?ver=articulo:<id>` sobre cualquier nivel | cierra la ficha (mismo nivel del catálogo) |
| Foto grande | `?foto=<url>` | la ficha / el listado |
| Panel del cliente (condiciones) | `?ver=cliente` | cierra el panel · "Ficha" y "Cuenta corriente" = replace |
| Buscar con la cámara | `?ver=buscar-foto` | cierra · elegir = replace a la ficha del artículo |
| Carrito | `…/carrito` | el nivel del catálogo donde estaba |
| Descartar pedido (hoja) | `…/carrito?ver=descartar` | cierra · confirmar ⇒ 2 atrás (el catálogo) |
| Pedido confirmado | `…/listo` (**replace** del carrito) | el catálogo, vacío (= "nuevo pedido para X"): nunca a un carrito ya enviado |
| Clientes | `/clientes` (`?q=` `?filtro=` `?localidad=` replace) | pantalla anterior |
| Cliente nuevo | `/clientes/nuevo` · `?ver=localidad` · `?ver=duplicado` | Clientes · cierra la hoja · guardar = replace a la ficha / al pedido |
| Ficha | `/clientes/:id` · `?ver=editar` · `?ver=bonif` · `?hoja=localidad` · `?conf=reasignar\|eliminar` | pantalla anterior · cada hoja se cierra sola |
| Cobrar | `/clientes/:id/cobrar` (`?tab=` `?abierto=` `?metodo=` replace) · `?ver=falta` | Ficha · cierra el diálogo · registrar = replace a la ficha |
| Devolución | `/clientes/:id/devolucion` (`?q=` replace; `?ok=1` replace) | Ficha |
| Devolución · catálogo | `/clientes/:id/devolucion/catalogo` | Devolución (la lista en curso sobrevive: sessionStorage) |
| Pago | `/pago` (`?q=` `?deuda=` replace) | Inicio |
| Estadísticas | `/estadisticas` | Inicio |
| Viajes · nuevo · detalle | `/viajes` · `/viajes/nuevo` (crear = replace al detalle) · `/viajes/:id` · `?ver=completar` | Inicio · Viajes · Viajes · cierra la hoja |
| Precios | `/precios` (`?q=` `?orden=` `?c=` replace) · `?ver=agregar` · `?foto=` | Inicio · cierra la hoja |
| Operaciones pendientes | `/pendientes` (core) | la pantalla anterior |

### Políticas de conflicto (complementa §6)
- `pedido.crear` / `pedido.editar`: arriba. Cliente dado de baja o reasignado ⇒ rechazo con motivo.
- `pedido.eliminar`: ya eliminado ⇒ éxito; con comprobante vivo o fuera de estado editable ⇒ rechazo.
- `cliente.crear`: el `id` lo genera el equipo ⇒ reenviar no duplica, y un pedido tomado al
  cliente nuevo (FIFO: va después) ya lo referencia. CUIT existente ⇒ rechazo indicando cuál.
  El equipo reproduce la regla de lista del servidor (la del viajante si la impone) para que el
  precio offline coincida.
- `cliente.editar`: CAS por campo; lo aplicable se aplica y lo pisado por otro vuelve como rechazo
  listando los campos.
- **Cobro rechazado ≠ error transitorio** (corregido en esta rama). Las RPC `cobranza_crear` /
  `cobranza_anular` rechazan por regla de negocio con `RAISE EXCEPTION` ⇒ SQLSTATE **P0001**
  (comprobante anulado, no es del cliente, lo imputado supera el pago…). Antes la route lo devolvía
  como **500**: la app lo reintentaba para siempre y, por FIFO, TRABABA todo lo cargado después.
  Ahora `lib/cobranzas/errores.ts` lo clasifica (`ErrorReglaCobranza`) y
  `/api/viajante/cobro` (POST y DELETE) responde **422** `{ error, mensaje, codigo:
  "regla_negocio", reintentable:false }`; cualquier otro error sigue siendo 500 = transitorio.
  Retrocompatible: `error` lleva el mismo texto y la web ya trataba todo `!res.ok` igual; los
  otros llamadores de `crearCobranza` / `anularCobranza` reciben el mismo `message`. En la app el
  cobro queda **rechazado** (sale de la cola, lo de atrás se envía), deja de reservar el
  comprobante, y el motivo se ve en el **inicio**, en la ficha y en Cobrar hasta tocar "Entendido".
  Limitación preexistente de la web: un cobro a VARIOS clientes no es transaccional entre clientes
  (la app siempre cobra de a uno).
- `cobro.registrar`: payload = body de la web; la clave de idempotencia del outbox es la que la
  route ya usaba (`cobranza_crear` deduplica). Lo cobrado sin señal RESERVA los comprobantes en el
  equipo (overlay = `en_cobro` del servidor): no se puede cobrar dos veces lo mismo.
- `cobro.anular`: ya anulado ⇒ éxito. `devolucion.registrar` / `viaje.crear`: id del equipo.
  `viaje.cliente_no_va`: valor absoluto. `viaje.estado`: transición idempotente.

### Diferencias con la web (impuestas por navegación / offline / plataforma)
- Encabezado del core (atrás · En línea/Sin red · ⇪) + `<Frescura>`; los subtítulos van en una
  franja debajo. `alert()`/`confirm()` ⇒ toast y hojas con historial.
- El carrito guarda en el equipo y envía al confirmar (la web autoguardaba ítem a ítem); por eso
  existe "Descartar este pedido" y el aviso "Pedido a medio cargar".
- Logout: `runtime.salir()` (no deja salir con operaciones sin enviar).
- Alta de zona/localidad, rendir, OCR de comprobantes, BCRA, PDF de comprobantes/remitos e
  identificar un producto por foto: **online-only**, deshabilitados sin red con el motivo a la
  vista. La foto del **código de barras** sí funciona sin señal (se lee en el equipo).
- Un viaje creado sin señal muestra sus clientes recién cuando se envía (la zona de cada cliente
  la resuelve el servidor).
- Los tres mapas de estados de pedido de la web (distintos entre sí) quedaron en uno (`ui.tsx`).
- Conocido: si se reasigna el vendedor de un cliente sin señal, la lista que impone el nuevo
  viajante se ve recién al sincronizar.

### Resultados de las pruebas (21/09/2026)
Mock del ERP (`mobile/scripts/mock-vendedor.mjs`, idempotencia real) con el **catálogo real** de
solo lectura (`fixture-vendedor.mjs`: 1.841 artículos, 86 clientes). Sin datos escritos en producción.

| Prueba | Dónde | Resultado |
|---|---|---|
| Búsqueda global hasta pintar (50 filas) | **NuStar 65-sp**, bundle de producción | ✅ **53–185 ms** ("shampoo" 101 · "deterg" 58 · error de tipeo "lavandna" 185 · sin resultados 160). Motor de búsqueda puro: 1–30 ms |
| Filtro activo: "shampoo" dentro de Kenvue | navegador, datos reales | ✅ 13 resultados, todos Kenvue; 0 de Algabo (que tiene 10) |
| Arranque en frío (proceso muerto desde recientes) | **NuStar 65-sp** | ✅ **0,84 s** con el release v0.2.0 firmado · 1,09–1,31 s con el APK de prueba (debug), sin login |
| Ruta sin servidor: buscar → precio → 2 artículos → confirmar → matar la app → reabrir → reconectar | **NuStar 65-sp** | ✅ pendiente intacto tras matar; al reconectar sincronizó en 3 s, **1 aplicación**, total servidor = total equipo = $ 98.800,80 |
| Interrupción a mitad de pedido | **NuStar 65-sp** y navegador | ✅ "Pedido a medio cargar" con sus 2 artículos |
| Cambio de precio con el equipo sin señal a mitad de pedido | navegador | ✅ el pedido viajó con `precios_al` anterior al cambio y al precio que vio el vendedor; después el equipo recibió el precio nuevo |
| Editar un pedido pendiente (3 → 5 u) antes de sincronizar | navegador | ✅ llega UNA vez con 5 u (mismo `local_id`, 1 creación) |
| Cobro sin señal por el total de una factura | navegador | ✅ "✓ Cuadra", saldo proyectado $ 0 con el real a la vista, pago "⇪ Sin enviar", 1 aplicación; atrás no vuelve al formulario enviado |
| Atrás físico: panel cliente → ficha artículo → árbol proveedor → proveedores → catálogo → inicio → minimiza | **NuStar 65-sp** | ✅ (proceso vivo al minimizar) |
| Atrás: detalle de comisión → pestaña comisiones → inicio; pestañas sin historial | navegador | ✅ |
| Tope de 24 hs: precios envejecidos 25 h sin red → cartel en inicio, catálogo y carrito → pedido → reconectar | navegador | ✅ cartel con el texto exacto; el pedido llegó marcado `precios_garantizados: false`; al sincronizar el cartel desapareció |
| Cobro rechazado por regla de negocio con un pedido encolado DETRÁS | navegador | ✅ pedido → cobro **rechazado** → pedido siguiente aplicado; contador rojo "1 rechazada", motivo visible en el inicio ("el comprobante … está anulado — no se puede cobrar"), "Entendido" lo saca |
| Tests | `cd mobile && npm test` | ✅ 93 (28 de esta sesión: búsqueda, carrito, overlays, `outbox.retirar`, vigencia con tope de 24 hs, clasificación P0001 / transitorio, cola que no se traba + regresión del 500) |
| `npm run typecheck:movil` | raíz | ✅ alcance 0 · mobile 0 · base 75/75 |
| Modo avión con el interruptor del equipo | — | 🟡 "sin señal" se simuló cortando el túnel `adb reverse` (servidor inalcanzable de verdad) para no tocar ajustes del equipo. El camino "red caída según Android" es el de la fundación, ya validado con Chofer y Depósito |
| Backend real (datasets y handlers contra Supabase) | — | 🟡 tipado y tests en verde; **sin ejecutar**: necesita la migración, el deploy en `main` y un usuario vendedor. La re-verificación de precios contra el historial real se ejercita ahí |

### Puesta en marcha — PENDIENTE (requiere al dueño)
1. Revisar la rama `apk-vendedor` (preview de Vercel) y autorizar el merge a `main`.
2. Aplicar `supabase/migrations/20260921_mobile_vendedor.sql` (aditiva: una columna + un índice).
3. Instalar `dist-apks/vendedor-v0.2.0.apk` e ingresar con un usuario vendedor.
4. Checklist contra producción con datos `TEST-VENDEDOR` (mismo método que Depósito, con foto
   antes/después): pedido sin señal → 1 pedido, total al centavo, 0 filas en
   `mobile_alertas_integridad`; cambio de precio real con el equipo en modo avión; cobro y
   devolución; alta de cliente + pedido sin señal; rechazo por pedido ya facturado.
5. En esa prueba, verificar el rechazo real: anular un comprobante desde el ERP con un cobro
   suyo sin enviar en el equipo ⇒ al reconectar debe volver RECHAZADO con el motivo (confirma que
   PostgREST entrega `code: "P0001"` para los `RAISE` de `cobranza_crear`; si llegara otro código,
   se ajusta `SQLSTATE_REGLA_NEGOCIO` en `lib/cobranzas/errores.ts`).

### Probar sin backend
`cd mobile && node scripts/fixture-vendedor.mjs` (una vez; solo lectura; el JSON tiene datos reales
de clientes y está en `.gitignore`) → `node scripts/mock-vendedor.mjs` (3998) →
`apps/vendedor/.env.development.local` con `VITE_API_BASE=http://localhost:3998` →
`npm run dev:vendedor` → http://localhost:5174 (cualquier email, contraseña "x"). Atajos:
`/__mock/red?on=0|1`, `/__mock/precio?sku=&base=`, `/__mock/estado-pedido?numero=&estado=`,
`/__mock/estado`, `/__mock/reset`. En el equipo: `VITE_API_BASE=http://localhost:3998 npx vite build`,
`GM_DEV_HTTP=1 npx cap sync android`, `gradlew assembleDebug`, `adb reverse tcp:3998 tcp:3998`,
`adb install`. Con `GM_DEV_HTTP=1` el WebView queda inspeccionable (chrome://inspect); el script de
release borra esa variable: un release nunca lo lleva.
