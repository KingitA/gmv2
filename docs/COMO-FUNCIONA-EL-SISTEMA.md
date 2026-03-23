# CÓMO ENTRA Y SALE LA INFORMACIÓN EN EL SISTEMA GM ERP
## Guía completa — Explicada en simple

---

# PARTE 1: RECEPCIÓN AUTOMÁTICA POR GMAIL

## ¿Cómo se entera el sistema de que llegó un mail?

Hay DOS formas de que el sistema se entere:

**Forma 1 — Gmail nos avisa al instante (Webhook)**
Cuando llega un mail a megasur.clientes@gmail.com o megasur.proveedores@gmail.com, Google manda una señal automática al sistema diciendo "ey, llegó un mail nuevo". El sistema recibe esa señal y se pone a trabajar.
(archivo: `app/api/ai/gmail/webhook/route.ts`)

**Forma 2 — El sistema pregunta cada tanto (Cron)**
Una vez al día a medianoche, el sistema revisa todas las cuentas de Gmail conectadas buscando mails nuevos. Es como un respaldo por si el Webhook falla.
(archivo: `app/api/cron/gmail-sync/route.ts` + configuración en `vercel.json`)

**Forma 3 — Vos le decís "sincronizá" a mano**
Desde el chat del sistema (GM Brain), podés hacer clic en el botón de sincronizar Gmail. Hace lo mismo que el Cron pero al momento.
(archivo: `app/api/ai/gmail/sync/route.ts`)

---

## ¿Qué pasa cuando se detecta un mail nuevo? (El pipeline completo)

### Paso 1 — Descargar el mail
El sistema se conecta a Gmail con los tokens de Google que se guardaron cuando conectaste las cuentas, y descarga: remitente, destinatario, asunto, cuerpo del mail, y todos los archivos adjuntos.
(archivo: `lib/ai/gmail.ts` — funciones `fetchRecentEmails` y `fetchNewEmailsSinceHistory`)

### Paso 2 — Extraer contenido de los adjuntos
Si el mail tiene adjuntos (PDF, Excel, imágenes), el sistema usa **Gemini** (la IA de Google) para "leerlos": le manda la imagen o el PDF y Gemini le devuelve el texto que hay adentro (OCR). Para Excel, lo parsea directamente sin IA.
(archivo: `lib/ai/attachment-content-extractor.ts`)

### Paso 3 — Clasificar el mail con Claude
El sistema le pasa a **Claude** (nuestra IA) todo junto: quién mandó el mail, a qué casilla llegó (clientes o proveedores), el asunto, el texto del mail, y el contenido extraído de los adjuntos. Claude analiza todo y decide qué tipo de mail es.
(archivo: `lib/ai/claude.ts` — función `classifyAndExtract`)

Las instrucciones que le damos a Claude para que clasifique están en:
(archivo: `lib/ai/prompts.ts` — constante `SYSTEM_PROMPT_UNIFIED_CLASSIFIER`, línea 104)

Claude devuelve un JSON con:
- **classification**: qué tipo de mail es (pedido, factura_proveedor, pago, cambio_precio, reclamo, etc.)
- **entityType**: si es cliente o proveedor
- **entityName**: nombre de quién mandó
- **confidence**: qué tan seguro está (0 a 1)
- **datos extraídos**: según el tipo, extrae datos específicos (items de factura, montos de pago, datos de cheque, etc.)

### Paso 4 — Guardar el mail en la base de datos
El mail se guarda en la tabla `ai_emails` con toda su info y clasificación.
Los adjuntos se suben al storage de Supabase y se registran en `ai_email_attachments`.
La clasificación se guarda en `ai_classifications`.
(archivo: `lib/ai/email-processor-pipeline.ts` — función `processIncomingEmail`)

### Paso 5 — Procesar según la clasificación
Según lo que Claude decidió, el mail va a un procesador diferente:

---

## Si es "PEDIDO" — Un cliente pide mercadería

### Paso 5a — Separar pedidos múltiples
Un solo mail puede tener pedidos de varios clientes. Se usa **Gemini** para analizar el texto del body y separar: "este texto es del cliente A, este del B, y el Excel adjunto es del cliente C".
(archivo: `lib/actions/ai-order-import.ts` — función `processOrderTextMulti`)

### Paso 5b — Procesar adjuntos del pedido
Si hay Excel/PDF/imagen adjunta, se descarga y se parsea con Gemini para extraer los artículos y cantidades.
- Excel: se lee directo con la librería XLSX, después Claude analiza la estructura para encontrar qué columna es "pedido" y qué columna es "descripción"
(archivo: `lib/ai/claude-xlsx-analyzer.ts`)
- PDF/Imagen: Gemini lo lee por OCR
(archivo: `lib/services/ocr.ts`)
- Los artículos extraídos se "matchean" contra la base de datos buscando cuál es el artículo correcto usando búsqueda por texto + embeddings (vectores de similaridad)
(archivo: `lib/actions/ai-order-import.ts` — función `processMatches`)

### Paso 5c — Identificar al cliente
El sistema busca quién es el cliente que hizo el pedido:
1. Primero intenta por mail del remitente (si el remitente tiene mail registrado como cliente)
2. Si no, busca si el remitente es un vendedor/viajante, y carga la lista de clientes de ese vendedor
3. Le pasa a Claude el texto del pedido ("chino 59", "208 patagones", etc.) junto con la lista de clientes, y Claude decide cuál es
(archivo: `lib/ai/email-order-processor.ts` — líneas 292-460, el prompt está en línea 410)

### Paso 5d — Detectar forma de facturación
El sistema busca en el texto del mail palabras como "presupuesto", "remito", "negro", "factura", "mitad y mitad", "final" para saber cómo facturar ese pedido.
(archivo: `lib/ai/email-order-processor.ts` — líneas 469-483)

### Paso 5e — Crear el pedido o mandarlo a revisión
- Si se encontró el cliente Y todos los artículos matchearon → se crea el pedido automáticamente en la tabla `pedidos` + `pedidos_detalle`
- Si ya existía un pedido pendiente de ese cliente → se acumulan los artículos al pedido existente
- Si falta el cliente O hay artículos sin matchear → se guarda en la tabla `imports` + `import_items` para que vos lo revises manualmente
(archivo: `lib/ai/email-order-processor.ts` — líneas 482-534)

### Paso 5f — Links de Google Drive
Si el mail tiene un link de Google Drive, el sistema intenta descargarlo y procesarlo como un adjunto más. Si falla (por permisos), crea un evento en la agenda avisando que hay un pedido por Drive que no pudo leer.
(archivo: `lib/ai/email-order-processor.ts` — líneas 197-252)

---

## Si es "FACTURA_PROVEEDOR" — Un proveedor mandó una factura

El sistema extrae los datos de la factura (tipo, número, fecha, CUIT, monto, IVA, percepciones) y:
1. Busca al proveedor en la base de datos por CUIT o nombre
2. Crea un registro en `comprobantes_proveedor`
3. Genera un movimiento en la cuenta corriente del proveedor
4. Crea un evento en la agenda avisando que hay una factura nueva con su vencimiento
(archivo: `lib/ai/email-invoice-processor.ts`)

---

## Si es "PAGO" — Alguien avisó que pagó

El sistema extrae monto, fecha, medio de pago, banco, datos de cheque/echeq, y:
1. Busca si el pagador es un cliente o proveedor
2. Registra el pago en el sistema
3. Crea un evento en la agenda para que se impute
(archivo: `lib/ai/email-payment-processor.ts`)

---

## Si es "CAMBIO_PRECIO" — Un proveedor mandó lista de precios nueva

El sistema extrae nombre del proveedor, fecha de vigencia, y los artículos con precios del adjunto. Crea una importación en la tabla `imports` de tipo `price_list` para que vos la revises y apliques.
(archivo: `lib/ai/email-pricelist-processor.ts`)

---

## Si es "RECLAMO" — Un cliente se queja

Extrae motivo, artículos afectados, urgencia, y crea un evento en la agenda.
(archivo: `lib/ai/email-reclamo-processor.ts`)

---

## Si es cualquier otra cosa (consulta, spam, otro, cambio_impositivo)

Crea un evento genérico en la agenda con el título y descripción que sugirió Claude. No hace nada más automáticamente.
(archivo: `lib/ai/email-processor-pipeline.ts` — líneas 290-317)

---

# PARTE 2: IMPORTACIONES MANUALES

## Importar clientes desde Excel

Desde la pantalla de Clientes, subís un archivo Excel con las columnas correspondientes (código_cliente, nombre, dirección, etc.). El sistema:
1. Lee el Excel con la librería XLSX
2. Compara cada fila con los clientes existentes (por código, CUIT, o nombre)
3. Si el cliente ya existe → lo actualiza
4. Si no existe → lo crea
5. Resuelve vendedores por nombre y localidades por nombre
(archivo: `app/api/clientes/import/route.ts`)

Hay una plantilla descargable para saber qué columnas usar:
(archivo: `app/api/clientes/template/route.ts`)

---

## Importar lista de precios de un proveedor (manual)

Desde la pantalla de Artículos, subís un Excel/imagen con la lista de precios. El sistema:
1. Si es imagen → la manda a Gemini para OCR
2. Si es Excel → la parsea directo
3. Cada artículo extraído se "matchea" contra el catálogo usando el motor de matching (código de proveedor, EAN, nombre normalizado, embeddings)
4. Muestra los resultados para que apruebes/corrijas los matcheos
5. Cuando aprobás, actualiza los precios en la base de datos
(archivo: `app/api/articulos/import-prices/route.ts`)
(motor de matching: `lib/matching/matcher.ts`)
(parser de lista de precios: `lib/parsing/price_list_parser.ts`)

---

## Importar lista de precios a tabla de importaciones

Similar al anterior pero guarda todo en la tabla `imports` + `import_items` para revisión posterior. Se usa cuando querés comparar precios antes de aplicar.
(archivo: `app/api/import/price_list/route.ts`)

---

## Importar orden de compra (OC)

Desde la pantalla de Órdenes de Compra, subís un archivo (Excel o imagen) de lo que le querés comprar a un proveedor. El sistema:
1. Parsea el archivo (OCR con Gemini si es imagen, XLSX si es Excel)
2. Matchea los artículos contra el catálogo
3. Te muestra los resultados para que armes la OC
(archivo: `app/api/ordenes-compra/import/route.ts`)
(OCR: `lib/services/ocr.ts`)
(matching: `lib/services/matching.ts`)

---

## Crear pedido manual (desde la pantalla)

Desde la pantalla /clientes-pedidos podés crear un pedido a mano eligiendo cliente, artículos y cantidades. El sistema:
1. Busca al cliente con todos sus datos
2. Calcula precios usando el motor de precios (descuentos cascada, IVA, flete, comisiones, puntaje)
3. Verifica stock
4. Crea el pedido en `pedidos` + `pedidos_detalle`
5. Reserva el stock
(archivo: `app/api/pedidos/route.ts`)

**OJO**: Este es el motor de precios viejo que calcula todo automáticamente. Los pedidos que entran por Gmail NO usan este motor — usan los precios que ya están en la tabla `articulos`.

---

## Importar pedido desde texto o archivo (manual)

Desde el botón "Importar Pedido" en /clientes-pedidos, podés pegar texto o subir un archivo. Usa el mismo pipeline que los pedidos por Gmail:
1. Parseo con IA
2. Matching de artículos
3. Revisión y aprobación
(componente: `components/pedidos/ImportOrderDialog.tsx`)

---

# PARTE 3: RECEPCIÓN DE MERCADERÍA

Cuando llega mercadería de un proveedor:
1. Creás una recepción vinculada a una OC (archivo: `app/api/recepciones/route.ts`)
2. Podés escanear el remito del proveedor con OCR (archivo: `app/api/recepciones/[id]/ocr/route.ts`)
3. Cargás cada item recibido con cantidad y precio (archivo: `app/api/recepciones/[id]/items/route.ts`)
4. Verificás precios contra la OC (archivo: `app/api/recepciones/[id]/items/[itemId]/verificar-precio/route.ts`)
5. Al finalizar, se actualiza el stock y la cuenta corriente del proveedor (archivo: `app/api/recepciones/[id]/finalizar/route.ts`)

---

# PARTE 4: OTROS FLUJOS

## Pagos
- Registrar pago manual: `app/api/pagos/route.ts`
- Confirmar pago: `app/api/pagos/[id]/confirmar/route.ts`
- Imputar pago a proveedor: `app/api/proveedores/[id]/imputar-pago/route.ts`

## Devoluciones
- Registrar devolución: `app/api/devoluciones/route.ts`
- Confirmar devolución: `app/api/devoluciones/[id]/confirmar/route.ts`

## Comprobantes de venta
- Generar factura/remito de un pedido: `app/api/comprobantes-venta/generar/route.ts`
- Ver imagen del comprobante: `app/api/comprobantes-venta/[id]/imagen/route.ts`
- Generar nota de crédito reversa: `app/api/comprobantes-venta/generar-nc-reversa/route.ts`

## Órdenes de pago
- Crear/listar órdenes de pago: `app/api/ordenes-pago/route.ts`
- Confirmar orden de pago: `app/api/ordenes-pago/[id]/confirmar/route.ts`

## Viajes y logística
- Crear/listar viajes: `app/api/viajes/route.ts`
- Registrar pagos de viaje: `app/api/viajes/[id]/pagos/route.ts`

## Depósito
- Ver pedidos a preparar: `app/api/deposito/pedidos/route.ts`
- Picking (escanear artículos): `app/api/deposito/picking/route.ts`
- Ajustes de stock: `app/api/deposito/ajustes-stock/route.ts`

## Chat IA (GM Brain)
- Chatear con el sistema: `app/api/ai/chat/route.ts`
- Sesiones de chat: `app/api/ai/chat/sessions/route.ts`
- Agenda de eventos: `app/api/ai/agenda/route.ts`

---

# RESUMEN DE BASES DE DATOS PRINCIPALES

| Tabla | Qué guarda |
|-------|-----------|
| `ai_emails` | Todos los mails procesados |
| `ai_email_attachments` | Adjuntos de los mails |
| `ai_classifications` | Cómo clasificó la IA cada mail |
| `ai_agenda_events` | Eventos/alertas generados por la IA |
| `imports` + `import_items` | Importaciones pendientes de revisión |
| `pedidos` + `pedidos_detalle` | Pedidos de clientes |
| `clientes` | Ficha de clientes |
| `proveedores` | Ficha de proveedores |
| `articulos` | Catálogo de artículos |
| `vendedores` | Viajantes/vendedores |
| `comprobantes_proveedor` | Facturas de proveedores |
| `comprobantes_venta` | Facturas/remitos a clientes |
| `recepciones` + `recepciones_items` | Recepciones de mercadería |
| `ordenes_compra` + `ordenes_compra_detalle` | Órdenes de compra a proveedores |
| `google_tokens` | Tokens de conexión a Gmail/Drive |
| `listas_precio` | Listas de precio (Bahía, Neco, Viajante) |

---

# RESUMEN VISUAL DEL FLUJO

```
MAIL LLEGA
    ↓
Gmail nos avisa (webhook) o el cron lo detecta
    ↓
Se descarga el mail + adjuntos (lib/ai/gmail.ts)
    ↓
Gemini lee los adjuntos (lib/ai/attachment-content-extractor.ts)
    ↓
Claude clasifica todo (lib/ai/claude.ts + lib/ai/prompts.ts)
    ↓
┌─────────────────────────────────────────────┐
│ PEDIDO → identifica cliente → matchea       │
│          artículos → crea pedido o manda    │
│          a revisión                         │
│ FACTURA → busca proveedor → carga en cta cte│
│ PAGO → registra y manda a imputar           │
│ PRECIOS → crea importación para revisar     │
│ RECLAMO → crea evento en agenda             │
│ OTRO → crea evento genérico                 │
└─────────────────────────────────────────────┘
```
