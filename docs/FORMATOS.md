# FORMATOS.md — Fecha, moneda y CUIT en todo el sistema

> Regla del dueño (10/10/2026). Vale para el ERP web, las apps (vendedor, chofer,
> depósito), la base, las importaciones, la IA y los PDFs. **No hay excepciones
> salvo las fiscales listadas abajo.**

| Dato | Lo que ve y escribe una persona | Lo que guarda la base / viaja en JSON |
|---|---|---|
| Fecha | `09/10/2026` (dd/mm/aaaa, **nunca** mm/dd) | `2026-10-09` (columna `date`) |
| Fecha y hora | `09/10/2026 14:05` en **hora argentina (GMT-3)** | instante ISO con zona `2026-10-09T17:05:00Z` (columna `timestamptz`) |
| Moneda | `$1.000,32` (punto = miles, coma = centavos) | `1000.32` (columna `numeric`, JSON number) |
| CUIT / CUIL | `20-12345678-9` | `20-12345678-9` (igual). Solo dígitos al mandarlo a ARCA / BCRA |

## Única fuente: `lib/formato`

- ERP web: `import { … } from "@/lib/formato"`
- Apps: `import { … } from "@gm/formato"` (alias al MISMO archivo)
- Pruebas: `mobile/packages/core/test/formato.test.ts` (`cd mobile && npm test`)

| Para… | Usar | Nunca |
|---|---|---|
| Mostrar una fecha | `fecha(x)` · `fechaHora(x)` · `hora(x)` · `fechaCorta(x)` | `toLocaleDateString`, `toLocaleString`, `Intl.DateTimeFormat`, `split("-").reverse()`, armar con `getDate()` |
| "Hoy" | `hoyISO()` (día argentino) | `new Date().toISOString().slice(0,10)` / `.split("T")[0]` (después de las 21 h da mañana) |
| Instante actual (timestamptz) | `ahoraISO()` | guardarlo en una columna `date` |
| Guardar en timestamptz algo de lo que solo sé el día | `mediodiaAR("2026-10-09")` | `"2026-10-09"` a secas (queda 21 h del día anterior) |
| Filtrar un día sobre timestamptz | `.gte(col, inicioDiaAR(d)).lte(col, finDiaAR(d))` | `.lte(col, "2026-10-09")` (excluye todo ese día) |
| Filtrar sobre columna `date` | `.gte(col, "2026-10-01")` | — |
| Sumar días / diferencia | `sumarDiasISO(d, n)` · `diasEntre(a, b)` | `new Date(d)` + `setDate` con hora local |
| Leer una fecha tipeada / Excel / IA | `parseFecha(x)` → `"AAAA-MM-DD"` o `null` | `new Date("05/03/2026")` (lo toma mm/dd) |
| Mostrar plata | `moneda(n)` → `$1.000,32` | `toFixed`, `toLocaleString`, `Intl.NumberFormat`, `"$" + n` |
| Mostrar número / % | `numero(n, dec)` · `entero(n)` · `porcentaje(n)` | `toFixed` en pantalla |
| Leer un monto tipeado / Excel / OCR | `parseMonto(x)` → number o `null` | `parseFloat(x)`, `Number(x.replace(",", "."))` ("1.500" → 1,5) |
| Redondear a centavos | `redondear(n)` | `Math.round(n*100)/100` |
| CSV para Excel | separador `;` + `numeroPlano(n)` (`1234,56`) | `,` como separador |
| Mostrar / guardar CUIT | `formatCuit(x)` · `normalizarCuit(x)` | guardar lo tipeado tal cual |
| Validar CUIT | `errorCuit(x)` (11 dígitos + dígito verificador; `00-00000000-0` = sin CUIT) | solo contar dígitos |
| Comparar / buscar CUIT | `mismoCuit(a, b)` · `.eq("cuit", normalizarCuit(x))` | comparar strings crudos |
| Mandar CUIT a ARCA / BCRA / QR | `cuitDigitos(x)` (y validar con `cuitValido` antes) | `replace(/-/g, "")` |

## Campos de carga (inputs)

| Dato | ERP web | Apps |
|---|---|---|
| Monto / precio / % / cantidad decimal | `<InputMonto>` (`components/ui/input-monto.tsx`) | `MontoInput` de `ui.tsx` de cada app (usa `parseMonto`) |
| Fecha | `<DateInputAR>` / `<InputFecha>` (`components/ui/date-input-ar.tsx`) | `FechaInput` de `ui.tsx` de cada app |
| CUIT | `<InputCUIT>` (`components/ui/input-cuit.tsx`) | `CuitInput` de `ui.tsx` de cada app |

**Prohibido:** `<input type="number">` para plata (el navegador toma "1.500" como 1,5) y
`<input type="date">` / `datetime-local` (se ve mm/dd en un navegador en inglés).

## Base de datos

- Columnas de instante: siempre `timestamptz` (nunca `timestamp` sin zona).
- Fecha por defecto: `default public.hoy_ar()` (nunca `CURRENT_DATE`: la base corre en UTC).
- En funciones SQL: `public.hoy_ar()` en vez de `CURRENT_DATE` / `now()::date`;
  para el día argentino de un instante: `(col at time zone 'America/Argentina/Buenos_Aires')::date`.
- CUIT: trigger `trg_normalizar_cuit` en todas las columnas de CUIT (lo deja `xx-xxxxxxxx-x`).
  Columna nueva de CUIT → agregarle el trigger (ver `20261010_formatos_cuit.sql`).
- Montos: `numeric`. Nunca texto.

## IA (Gemini / Claude) e importaciones

- En los prompts: "los documentos son de Argentina: las fechas vienen dd/mm/aaaa y los
  montos 1.234,56. Devolvé fechas como AAAA-MM-DD y montos como número JSON con punto
  decimal, sin separador de miles".
- **Siempre** pasar lo que devuelve la IA por `parseFecha` / `parseMonto` / `normalizarCuit`
  antes de guardar: la IA a veces devuelve strings.
- Excel: no usar `cellDates: true` con CSV (SheetJS lee "05/03" como mm/dd); leer el texto
  y pasarlo por `parseFecha`. Celdas numéricas de fecha: `parseFecha(número)` entiende
  el número de serie de Excel.

## Excepciones (formatos fiscales de máquina)

Formatos que exige ARCA y no se tocan: `CbteFch` y fechas `AAAAMMDD` del WSFE, libro IVA
digital, SICORE / RET_OP_GAN (montos en centavos con ceros, CUIT de ancho fijo), QR de AFIP.
Esas líneas llevan el comentario `// formato-ok: <motivo>`.

## Control automático

`npm run typecheck:movil` (obligatorio antes de commitear) corre también
`scripts/check-formatos.mjs`: falla si aparece un patrón prohibido NUEVO
(`type="number"`, `type="date"`, `toLocaleString`, `toFixed` en pantalla, `parseFloat`,
"hoy" en UTC, etc.). Lo que ya existía está contado por archivo en
`scripts/check-formatos.base.json` y **solo puede bajar**. Si un uso es legítimo
(un formato fiscal), marcar la línea con `// formato-ok: <motivo>`.
