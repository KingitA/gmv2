# Pedido para el agente del "cerebro" de Megasur (Playroom)

**De:** sesión del rediseño frontend.
**Fecha:** 10/10/2026.
**Para:** la sesión que va a desarrollar la inteligencia artificial de Playroom.

## 1. Qué es Playroom (definición del dueño)

Playroom es el área de reportes del ERP: un lugar donde se puede **"jugar" sin tocar nada**, y que con el tiempo va a ser **lo más importante del sistema**. Ahí vive la IA, una especie de "Jarvis" para los operarios. El dueño la imagina así:
- Se le pregunta **por texto** y responde **por texto**.
- **Lee la base de datos**, interpreta ideas, propone las suyas y muestra **tablas y gráficos**.
- Por ahora se llama **"Megasur"**. El nombre definitivo se decide más adelante.

**Reglas no negociables:**
- **Solo lectura.** Megasur nunca escribe, modifica ni borra nada en la base. Puede *sugerir* acciones ("te sugiero pedir el pago antes del próximo envío"), pero nunca ejecutarlas. Ninguna herramienta del cerebro puede hacer INSERT, UPDATE ni DELETE.
- **Los comprobantes fiscales no se tocan nunca**, ni siquiera desde otra parte del sistema.
- El dueño **no programa**. Explicale en palabras simples qué hiciste y qué tiene que probar.
- Correr `npm run typecheck:movil` antes de commitear (ver `MOBILE.md` §14).
- No pushear a `main` sin el OK del dueño.

## 2. Reparto del trabajo (para no pisarnos)

| | **Sesión de diseño** (rama `playroom`) | **Sesión del cerebro** (vos) |
|---|---|---|
| Hace | Pantallas: tablero, tarjetas, catálogo de indicadores, chat (cómo se ve cada mensaje, tabla y gráfico), informes con el estilo nuevo | La inteligencia: prompt, herramientas, modelo, consultas, resumen del día, avisos |
| Archivos | `app/playroom/**` (páginas), `components/playroom/**`, `app/api/playroom/tablero/**` (indicadores del tablero) | `app/api/playroom/chat/**`, las rutas nuevas de la sección 4, y lo que quieras crear en `lib/playroom/cerebro/**` |
| No toca | El cerebro (prompt, herramientas, modelo) | Los componentes de pantalla de `components/playroom/**` |

Si necesitás cambiar algo del lado del otro, avisá al dueño y lo coordinamos. Lo que nos une es el **contrato de la sección 4**: si los dos lo respetamos, las pantallas y el cerebro encajan solos.

## 3. Lo que ya existe (punto de partida)

- `app/api/playroom/chat/route.ts`: el cerebro actual.
  - Claude (`claude-sonnet-4-6`) con un ciclo de herramientas.
  - Herramientas: `consultar_ventas`, `consultar_stock`, `consultar_clientes`, `consultar_comisiones`.
  - Usa el cliente admin de Supabase y `requireAuth()`.
  - Recibe `{ mensaje, historial }` y devuelve texto.
  - Sos libre de reescribirlo entero. Los modelos actuales son la familia Claude 5 (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`): elegí el que convenga.
- **RPCs de Postgres ya hechos** (agregan en la base, rápidos): `playroom_chat_ventas`, `playroom_chat_stock`, `playroom_articulos_vendidos`, `playroom_comisiones_viajantes`, `playroom_rotacion_kardex`, `playroom_articulo_clientes`.
- **Fuentes de datos clave:**
  - `kardex`: todas las ventas renglón por renglón. Tiene `tipo_movimiento` 'venta' / 'nota_credito_venta', `pedido_eliminado`, costo, margen, vendedor, cliente y artículo.
  - `comprobantes_venta`.
  - `v_saldo_clientes`: el saldo de cada cliente desde el libro mayor. Es **la fuente única de deuda**; la columna `clientes.saldo_cuenta_corriente` no existe.
  - `pagos_clientes` / `pagos_detalle`.
  - `pedidos`.
  - `vencimientos`: lo que se le paga a proveedores.
  - `cheques`.
  - `ordenes_compra`.
- **Escala real:** unos 12 mil renglones de venta por mes en `kardex`, unos 600 clientes y unos 2.000 artículos. **Vercel corta cada pedido a los 8 segundos** y la respuesta no puede pasar de **4,5 MB**. Agregá en Postgres (RPC), no traigas filas sueltas a Node.
- **Consulta de solo lectura para probar:** hay un usuario de la base de solo lectura. El dueño te pasa los datos de conexión.

## 4. El contrato entre pantallas y cerebro

### 4.1 Chat: `POST /api/playroom/chat`

Recibe:
```json
{ "mensaje": "¿Qué clientes de Tres Arroyos deben más de 60 días?", "historial": [ ... ] }
```
`historial` tiene el formato de mensajes de la API de Anthropic, como hoy.

Devuelve (todo opcional salvo `respuesta`):
```json
{
  "respuesta": "Son 4 clientes y suman **$ 3,2 M** con más de 60 días…",
  "bloques": [ /* tablas, gráficos o números: ver 4.2 */ ],
  "consultado": ["Cuentas corrientes de 41 clientes de Tres Arroyos", "Comprobantes de los últimos 120 días"],
  "sugerencias": ["Mostrámelo por antigüedad", "¿Quién es su viajante?"],
  "historial": [ /* el historial actualizado para la próxima pregunta */ ]
}
```
- `respuesta`: Markdown simple (negritas, listas, párrafos). **Las tablas y los gráficos no van en el Markdown, van en `bloques`.** El chat los dibuja con el estilo del sistema.
- `consultado`: qué revisó para responder, en palabras simples. Se muestra arriba de la respuesta ("Revisé…"). Es lo que da confianza.
- `sugerencias`: 2 o 3 preguntas para seguir. Se muestran como botones.

### 4.2 Bloques (lo que el chat dibuja y lo que se puede fijar en el tablero)

```ts
type Formato = "pesos" | "numero" | "porcentaje" | "fecha" | "texto"

type Bloque =
  | { tipo: "numero"; titulo: string; valor: number; formato: Formato
      comparacion?: { texto: string; tono: "bien" | "mal" | "neutro" }   // "▲ 12% vs. septiembre"
      recalcular?: Recalcular }
  | { tipo: "tabla"; titulo: string
      columnas: { clave: string; titulo: string; formato?: Formato }[]
      filas: Record<string, string | number | null>[]
      total?: Record<string, number>                                     // fila de totales opcional
      recalcular?: Recalcular }
  | { tipo: "grafico"; titulo: string; forma: "barras" | "lineas" | "torta"
      x: { clave: string; titulo?: string; formato?: Formato }
      series: { clave: string; titulo: string }[]                        // 1 o más series
      datos: Record<string, string | number | null>[]
      formato?: Formato                                                  // formato de los valores
      recalcular?: Recalcular }

// Cómo volver a pedir el mismo dato con información fresca (para tarjetas fijadas)
type Recalcular = { herramienta: string; parametros: Record<string, unknown> }
```

**Reglas para los bloques:**
- Montos siempre como **número** (no como texto "$ 1.234"). El formato lo pone la pantalla.
- Fechas como `"YYYY-MM-DD"`.
- Máximo unas 50 filas por tabla y 60 puntos por gráfico. Si hay más, resumí y avisalo en `respuesta`.
- Cada bloque que se pueda **"📌 Fijar en el tablero"** necesita `recalcular`. Con eso la tarjeta fijada se actualiza sola cada vez que se abre Playroom. Si un bloque no tiene `recalcular`, se puede fijar igual, pero queda como foto del momento.

### 4.3 Recalcular una tarjeta fijada: `POST /api/playroom/recalcular`

Recibe un `Recalcular` y devuelve **un solo `Bloque`** con los datos de hoy:
```json
{ "herramienta": "deuda_por_antiguedad", "parametros": { "zona": "Tres Arroyos" } }
```
Debe ser rápido: sin IA, solo la consulta.
- Si la herramienta ya no existe, devolver 404 con `{ "error": "…" }`. La tarjeta muestra "Este dato ya no se puede actualizar".

### 4.4 Resumen del día: `GET /api/playroom/resumen-del-dia`

```json
{ "texto": "Octubre viene **12% arriba** de septiembre… El jueves vencen **$ 9,2 M** a proveedores.", "generado_at": "2026-10-10T09:00:00-03:00" }
```
- Dos o tres oraciones, como lo contaría un gerente: ventas, cobranza, pagos que vienen y algo raro si lo hay.
- Markdown simple. Las negritas se resaltan.
- Conviene **guardarlo y no generarlo en cada visita**: una vez por día o por hora, con cache. Si no hay resumen, devolver `{ "texto": null }` y la pantalla lo oculta.

### 4.5 "Lo que Megasur notó": `GET /api/playroom/novedades`

```json
{ "items": [
  { "id": "clientes-sin-compra-2026-10",
    "tono": "alerta",                         // "alerta" | "atencion" | "oportunidad"
    "titulo": "9 clientes que compraban todos los meses no compran hace 45 días",
    "detalle": "Entre ellos Distribuidora Urquiza y JDM Market. Juntos eran $ 6,1 M por mes.",
    "acciones": [ { "texto": "Ver la lista", "pregunta": "Listame los clientes habituales que no compran hace 45 días" },
                  { "texto": "¿Por qué pudo pasar?", "pregunta": "…" } ] }
] }
```
- Cada acción **no ejecuta nada**: manda su `pregunta` al chat.
- Ideas que el dueño ya vio en la maqueta:
  - clientes habituales que dejaron de comprar;
  - margen de un rubro que bajó después de una lista nueva de un proveedor;
  - artículo que se vende mucho más que antes y se queda sin stock;
  - deuda vencida que crece.
- Mismo criterio que el resumen: calcular cada tanto y guardar, no en cada visita.

## 5. Lo que la pantalla ya resuelve (no lo dupliques)

- **Indicadores fijos del tablero** (catálogo de tarjetas): los calcula la sesión de diseño en `GET /api/playroom/tablero`, sin IA. Catálogo:
  - ventas del mes, de hoy y ticket promedio;
  - margen bruto;
  - clientes que compraron este mes;
  - top 5 artículos;
  - cobrado del mes y deuda vencida;
  - cobros pendientes de verificar en Caja;
  - clientes que más deben;
  - pedidos para preparar, entregados hoy y viajes en la calle;
  - devoluciones del mes;
  - pagos de los próximos 7 días;
  - órdenes de compra abiertas;
  - cheques en cartera;
  - stock valorizado;
  - artículos sin movimiento.

  Si el cerebro necesita esos números, **puede llamar a ese endpoint** o reutilizar sus consultas en lugar de recalcularlos distinto. Así el chat y el tablero nunca dicen números diferentes.
- **Dónde se guardan las tarjetas fijadas:** por ahora en la computadora de cada usuario. Más adelante, si hace falta que el tablero siga al usuario entre PCs, se crea una tabla. Proponelo al dueño si lo ves necesario.

## 6. Cómo probar con las pantallas

- Mientras la sesión de diseño termina el chat nuevo, el chat actual (`components/playroom/ChatDrawer.tsx`) sigue andando con `respuesta`.
- Los campos nuevos (`bloques`, `consultado`, `sugerencias`) no rompen nada: el chat viejo los ignora y el nuevo los dibuja.
- Para probar el contrato sin pantalla, usá `curl` o un script contra `/api/playroom/chat` con una sesión iniciada. Mirá que `bloques` cumpla los tipos de la sección 4.2.
- **Al terminar:**
  1. avisale al dueño qué rutas quedaron listas;
  2. la sesión de diseño conecta las pantallas;
  3. se prueba todo junto en un preview;
  4. con el OK del dueño, se pasa a `main`.
