# Plan de adecuación fiscal ARCA/ARBA — GM ERP v2

Resultado de auditoría (11/06/2026) contrastando el sistema contra RG 1415, RG 4540, RG 5003,
RG 5329/5334, RG 5614/5616 (Ley 27.743), RG 4597 y regímenes IIBB de RN/LP/PBA.
Cada ítem fue validado con el responsable del sistema. Aplicar en el orden listado.

## Contexto del emisor

- SRL Responsable Inscripto, CUIT 30-71022924-0, Bahía Blanca (PBA).
- Convenio Multilateral en PBA, Chubut, La Pampa y Río Negro.
- Único punto de venta electrónico habilitado: **0007**. Documentos internos (PRES/REM/REV): PV 0001.
- No se trabajan artículos al 10,5% (todo 21%). FA a monotributistas es correcto (Ley 27.618 + RG 5003/2021).
- **PRES y REV son documentos internos: nunca deben llegar a ARCA ni aparecer en ningún
  reporte fiscal, export IVA, QR ni consulta relacionada con ARCA.** Si algún reporte los incluye, corregirlo.

## Tareas

### 1. CRÍTICO — Enviar `CondicionIVAReceptorId` en FECAESolicitar (RG 5616/2024)

- `lib/arca/tipos.ts`: agregar tabla `CONDICION_IVA_RECEPTOR_ID` → 1=Responsable Inscripto,
  4=Sujeto Exento, 5=Consumidor Final, 6=Responsable Monotributo. Mapear desde `clientes.condicion_iva`
  (misma lógica de matching que `determinarTipoFactura`). Si no mapea → bloquear emisión con error claro
  (nunca asumir default).
- `lib/arca/wsfev1.ts`: agregar campo `condicionIVAReceptorId` a `SolicitudCAE` y emitir
  `<ar:CondicionIVAReceptorId>` dentro de `FECAEDetRequest`.
- Actualizar TODOS los call sites: `app/api/comprobantes-venta/generar/route.ts`,
  `generar-nd/route.ts`, `generar-nc-reversa/route.ts`, `[id]/anular/route.ts`.

### 2. CRÍTICO — Corregir percepciones (RG 5329/5334)

En `lib/comprobantes/calcular-percepciones.ts` y sus llamadores:

- **Percepción IVA solo a Responsables Inscriptos.** A monotributistas NO se les percibe ni IVA ni IIBB
  (hoy se percibe a todo el que no tenga `exento_iva`). Pasar la condición IVA del cliente a
  `calcularPercepciones` y aplicar percepciones únicamente si el receptor es RI.
- **Mínimo legal:** si el monto de percepción IVA calculado es ≤ $3.000 por operación (RG 5334/2023),
  la percepción es $0.
- Se mantiene: flag `exento_iva`/`exento_iibb` manual como exclusión, 3% sobre el neto total
  (decisión del negocio: no se discrimina por rubro de artículo).

### 3. M1 — Leyenda de Transparencia Fiscal (Ley 27.743 / RG 5614)

En `lib/pdf/comprobante-template.tsx`:

- QUITAR la franja "Transparencia Fiscal" de las Facturas A (es redundante, el IVA ya va discriminado).
- AGREGAR en Facturas B (y NCB/NDB): leyenda **"Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)"**
  seguida de **"IVA Contenido: $X"** (el IVA que ya está calculado en `total_iva`) y
  "Otros Impuestos Nacionales Indirectos: $0,00" si no hay.

### 4. Notas de crédito — comprobantes asociados (RG 4540)

- Soportar **uno o más** comprobantes asociados por NC/ND (`CbtesAsoc` ya soporta array en `wsfev1.ts`;
  extender el flujo de generación y la DB si hace falta para N asociados).
- Si la NC no tiene comprobante asociado detectable (caso migración de sistema), **exigir ingreso manual**
  del/los comprobantes asociados en la UI al momento de generar — no permitir emitir NC fiscal sin asociado.

### 5. Punto de venta unificado: 0007

- Todo comprobante electrónico (FA/FB/NCA/NCB/NDA/NDB) sale por PV **0007**, leído de
  `configuracion_empresa.arca_punto_venta` (verificar que en DB esté en 7).
- Eliminar fallbacks dispersos: `?? 3` en `generar/route.ts` (config), `?? '0007'` en el armado del QR,
  `?? '1'`/`'0001'` en anular. Una sola fuente: la config; si falta, error explícito, no default.
- PRES/REM/REV siguen en PV 0001 (interno, sin CAE).

### 6. Cita normativa del QR y pie del PDF

- El QR fiscal corresponde a la **RG 4892/2020** (no "RG 4291"). Corregir comentarios en
  `lib/pdf/generar.ts` y los textos impresos en `comprobante-template.tsx`
  ("Emitido conforme RG 4291" → RG 4892/2020; revisar la mención a RG 1415 que está bien).

### 7. M3 — Export Libro IVA Digital (RG 4597) en paralelo al reporte legacy

- Mantener el reporte actual `/api/reportes/iva-ventas` (el contador lo usa hace años).
- Agregar un export nuevo con el **formato oficial de ARCA** (archivos de Comprobantes de Ventas y
  Alícuotas de Ventas, registro de ancho fijo) según `libro-iva-digital-especificaciones.pdf` (raíz del repo).
- Solo comprobantes fiscales (excluir PRES/REV). Todo a alícuota 21% (código 0005).
  Es para mostrárselo al contador y que decida si lo adopta.

### 8. M4 — Padrón de alícuotas IIBB

- Normalizar `clientes.provincia` a catálogo cerrado de jurisdicciones (códigos CM 901-924),
  con migración de los valores libres existentes.
- Nueva tabla `padron_iibb` (cuit, jurisdiccion, alicuota_percepcion, vigencia_desde, vigencia_hasta)
  + endpoint/UI de importación del padrón oficial (Río Negro publica por contribuyente; La Pampa:
  alícuota general por norma + agravada para no inscriptos).
- Cálculo de percepción IIBB: buscar padrón vigente por CUIT+jurisdicción; fallback a alícuota general
  de la jurisdicción; `clientes.percepcion_iibb` queda como override manual de excepción.
- Alerta en UI si el padrón cargado está vencido.
- Mantener: no se percibe IIBB a clientes de PBA (no somos agentes ARBA), ni a monotributistas (tarea 2),
  ni exentos.

### 9. Reporte ventas por jurisdicción (insumo CM05)

- Nuevo reporte: ventas netas por jurisdicción/provincia de destino por período (datos ya existen en
  `kardex.provincia_destino`), **solo comprobantes fiscales** (excluir PRES/REV explícitamente).
- Export CSV. Es el insumo para que el contador arme coeficientes del CM05.

## Fuera de alcance (decisión del negocio)

- Retenciones IIBB a proveedores (módulo proveedores a medio armar — se hará más adelante).
- Discriminación de la percepción RG 5329 por rubro de artículo.
- Alícuotas IVA distintas de 21%.
