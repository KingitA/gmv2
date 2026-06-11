# Plan de fixes FINAL — habilitación 100% producción facturación electrónica

Resultado de la auditoría del 11/06/2026 sobre commit `38e8d08` (post planes
`PLAN_AUDITORIA_FISCAL_ARCA.md` y `PLAN_FIXES_PRE_PRODUCCION.md`, ambos ya implementados).

**Estado verificado: ARCA, QR, totales de DB y reportes están correctos y consistentes.**
Lo que queda son 5 fixes acotados. Al completarlos, el sistema queda habilitado al 100%
para FA/FB, NCA/NCB y NDA/NDB en producción.

## Contexto del emisor (NO cambiar — ya verificado en DB)

- CUIT **30-71022924-0**, SRL Responsable Inscripto. PV fiscal **0007** leído de
  `configuracion_empresa.arca_punto_venta` (= 7 en DB), ambiente producción. Sin defaults.
- Todo a IVA 21%. FA a monotributistas con leyenda Ley 27.618 (ya implementado).
- No se emite Factura C (un RI emite solo A y B — correcto como está).
- **PRES y REV son internos: jamás tocan ARCA, QR ni reportes fiscales. Hoy se cumple
  en los 5 flujos y los 4 reportes — ningún cambio puede romper esto.**
- Comprobantes reales ya emitidos: FA 0007-00000001 (anulada con NCA 0007-00000001 espejo)
  y FA 0007-00000002. Numeración local sincronizada con ARCA.

---

## Fix 1 — CRÍTICO: PDF/detalle con bonificación general/viajante muestra el descuento DOS veces

**Archivos:** `lib/pdf/comprobante-template.tsx`, `app/api/comprobantes-venta/generar/route.ts`

**Problema:** desde que las bonificaciones se aplican antes del CAE, el detalle del
comprobante incluye líneas negativas ("Bonificación General X%", "Desc. Viajante X%",
"Bonificación Mercadería 100%"). Pero el template **además** multiplica el precio de cada
línea normal por `factDesc = 1 − d1% − d2%` (líneas 334-338 del template). Resultado: el
descuento aparece dos veces y la suma de líneas del PDF no cuadra con el "Subtotal gravado"
del pie. Adicionalmente, la línea negativa se inserta con monto **IVA incluido**
(`lineasDescuento.monto` es % del subtotal final) mezclada entre líneas que son netas.

El TOTAL del pie y lo declarado a ARCA están bien — es un defecto de consistencia interna
del comprobante impreso y del detalle en DB. Afecta a los 23 clientes con bonificaciones
activas. **Nada de esto está validado aún con una factura real porque esas FA no se
emitieron — corregir antes de facturarles.**

**Implementación (elegir esta, no otra):**
1. En `generar/route.ts`, insertar las líneas de descuento en `comprobantes_venta_detalle`
   con el monto **NETO** (`monto / 1.21` para comprobantes fiscales; en PRES el monto va
   como está, con IVA incluido, porque todas sus líneas son finales). Así todas las líneas
   del detalle fiscal quedan en la misma base (neta) y `SUM(precio_total) == total_neto`
   exacto en centavos. Ajustar el redondeo para que cierre contra el `descNeto` ya usado
   en el cálculo de totales (usar el MISMO valor, no recalcular).
2. En `comprobante-template.tsx`, **eliminar `factDesc` del cálculo de `neto` y `sub` por
   línea** (mostrar el precio pleno de cada ítem). El descuento queda visible únicamente
   como línea negativa, igual que lo ve ARCA y la DB. Mantener las columnas Bon 1/Bon 2
   como informativas (los % del cliente) pero sin afectar los números.
   - En comprobantes B la línea negativa también debe mostrarse ×1.21 (IVA incluido),
     coherente con las demás líneas B. Ojo con la condición `esBonifMerc` actual: hoy
     excluye del ×1.21 a toda línea negativa asumiendo que viene con IVA incluido — tras
     el punto 1 las líneas negativas quedan netas, así que deben multiplicarse igual.
3. Verificación obligatoria (sin emitir contra ARCA): generar el PDF de un comprobante de
   prueba con `renderToBuffer` usando datos sintéticos con bonificación general 10% +
   mercadería bonificada, y comprobar aritméticamente:
   `suma de líneas mostradas (positivas − negativas) == Subtotal del pie` en A y en B.

**Criterio de aceptación:** para una FA con bonificación: `SUM(detalle.precio_total)
== comprobantes_venta.total_neto` en DB, y en el PDF la suma visual de la columna
Subtotal == "Subtotal gravado 21%". En FB ídem contra el "Subtotal" con IVA incluido.

## Fix 2 — CRÍTICO: anulación invierte mal las líneas de bonificación

**Archivo:** `app/api/comprobantes-venta/[id]/anular/route.ts` (paso 8, ~línea 250)

**Problema:** al copiar el detalle del original a la NC/ND espejo se hace `Math.abs()`
sobre `precio_unitario` y `precio_total`. Si la factura original tenía líneas negativas de
bonificación, en el comprobante inverso quedan como cargos POSITIVOS: el detalle/PDF de la
NCA espejo suma más que el total y no cuadra.

**Implementación:** preservar el signo original de cada línea al copiar el detalle
(quitar los `Math.abs()` de `precio_unitario` y `precio_total`; la cantidad puede seguir
en valor absoluto). Los totales de cabecera del inverso no se tocan (ya son espejo exacto,
verificado con la NCA 0007-00000001 real).

**Criterio de aceptación:** anular (en un entorno de prueba de datos, sin llamar a ARCA,
o con mock de `solicitarCAE`) una factura sintética con línea de bonificación →
`SUM(detalle.precio_total)` del inverso == `|total_neto|` del inverso, con la línea de
bonificación negativa.

## Fix 3 — Regenerar los 2 PDFs pendientes de comprobantes reales

**Problema:** FA 0007-00000001 y NCA 0007-00000001 (ambas del 09/06) tienen
`estado_pdf = 'pendiente'` — nunca se generó su PDF. Son comprobantes emitidos con CAE:
el cliente debe poder recibirlos.

**Implementación:** si ya existe un endpoint de regeneración de PDF, usarlo; si no,
crear `POST /api/comprobantes-venta/[id]/regenerar-pdf` que reuse `buildPDFData` +
`generarQRBase64` + `generarYSubirPDF` con los datos congelados del comprobante (CAE,
totales y fecha ORIGINALES de la DB — no recalcular nada, no tocar ARCA). Ejecutarlo para
esos 2 comprobantes. Nota: `generarYSubirPDF` sube con `upsert: false` — si hubiera un
archivo huérfano en el bucket, manejarlo (path nuevo o upsert solo en este endpoint).

**Criterio de aceptación:** ambos comprobantes con `estado_pdf = 'generado'`, PDF
descargable, QR que decodifica al importe/CAE/fecha originales (fecha 2026-06-09, no la de hoy).

## Fix 4 — ND: bloquear cliente sin CUIT y normalizar el detalle

**Archivo:** `app/api/comprobantes-venta/generar-nd/route.ts`

1. Hoy hace `clienteCuit ... || '0'`: si el cliente no tiene CUIT manda DocNro 0 a ARCA y
   espera el rechazo. Bloquear ANTES con 422 y `error_code: 'CLIENTE_SIN_CUIT'` (mismo
   patrón y mensaje que `generar/route.ts`). Aplicar el mismo bloqueo en
   `generar-nc-reversa/route.ts` (también tiene el `|| '0'`).
2. El insert de detalle usa `precio_total: subtotalNeto + subtotalIva` (con IVA), distinto
   del resto del sistema donde `precio_total` es NETO. Cambiar a `precio_total: subtotalNeto`
   para que `SUM(detalle.precio_total) == total_neto` también en ND (y el PDF regenerado
   desde DB no difiera del original).

## Fix 5 — Probar `PeriodoAsoc` de ND contra ARCA real (validación, no código)

El camino de ND con `periodo: {desde, hasta}` (sin comprobante asociado) nunca se ejercitó
contra ARCA producción. Antes de usarlo por mora/intereses: emitir UNA NDA real de monto
mínimo (ej: $1 + IVA) con período asociado a un cliente propio/de prueba, verificar CAE,
y anularla con NCA espejo. Si ARCA rechaza por el orden de elementos del XML, ajustar
`wsfev1.ts` para que `PeriodoAsoc` respete el orden del WSDL (en FECAEDetRequest el orden
oficial es: ...CondicionIVAReceptorId, CbtesAsoc, Tributos, Iva, Opcionales, Compradores,
PeriodoAsoc, Actividades). No tocar nada más del XML: el armado actual ya obtuvo CAE real
para FA con tributos y NCA con CbtesAsoc.

## Operativo (en paralelo, no bloquea PBA semana 1)

- Completar provincia en los 113 clientes activos (compraron en los últimos 6 meses) que
  no la tienen — afecta el reporte de ventas por jurisdicción (CM05), no la emisión.
- 4 clientes sin CUIT: completar o dejar que el sistema los bloquee al emitir (correcto).
- Antes de facturar fuera de PBA: confirmar con el contador si la empresa es agente de
  percepción IIBB en Río Negro / La Pampa / Chubut. Si SÍ → cargar padrón RN en
  `padron_iibb` y `alicuota_general` de LP en `jurisdicciones` (hoy 0 → no se percibe).
  Si NO → documentarlo acá y dejar todo en 0.

## Checklist de aceptación final (con comprobantes reales chicos, anulables)

- [ ] FA a cliente RI **con bonificación general** → QR == portal ARCA == PDF == DB; suma de líneas del PDF == Subtotal; percepción IVA sobre el neto descontado.
- [ ] Anulación de esa FA → NCA espejo con CAE, detalle que cuadra (bonificación en negativo).
- [ ] FA a monotributista (Maxikiosco Guidi) → leyenda Ley 27.618, receptor 6, sin percepciones.
- [ ] NDA con comprobante asociado → CAE OK. NDA sin asociado/período → 422 sin llamar a ARCA. ND a cliente sin CUIT → 422 sin llamar a ARCA.
- [ ] NDA con `PeriodoAsoc` → CAE OK (Fix 5).
- [ ] Pago contado sobre FA → NCA con CAE, asociado, QR, y resta en el reporte IVA.
- [ ] PRES → PV 0001, sin CAE, sin QR, ausente de los 4 reportes fiscales.
- [ ] FA 0007-00000001 y NCA 0007-00000001 con PDF regenerado y QR válido (Fix 3).
- [ ] Reporte IVA Ventas del mes: cada renglón existe en ARCA y cuadra 1:1 (validar con el contador).

## Reglas duras para el agente

- Nunca agregar defaults de punto de venta, CUIT ni condición de IVA: dato faltante = error explícito y emisión bloqueada.
- Nunca crear un comprobante fiscal en DB si ARCA no devolvió CAE (orden: CAE → insert). No invertir ese orden en ningún refactor.
- PRES/REV: ningún cambio puede hacer que toquen ARCA, QR o reportes fiscales.
- No duplicar tablas ni columnas en la DB. No recalcular totales de comprobantes ya emitidos (los PDFs regenerados usan los valores congelados de la DB).
- No tocar la aritmética de totales/percepciones ya validada (FA 0007-00000002 cuadra al centavo contra ARCA).
- Commit + push después de CADA fix (deploy automático en Vercel). Un commit por fix.
