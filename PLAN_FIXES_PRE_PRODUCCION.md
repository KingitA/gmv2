# Plan de implementación — Fixes pre-producción facturación electrónica

Resultado de la auditoría del 11/06/2026 (post tareas 1-9 del `PLAN_AUDITORIA_FISCAL_ARCA.md`).
Objetivo: dejar el sistema 100% habilitado para emitir FA/FB, NCA/NCB y NDA/NDB en producción
sin ninguna inconsistencia entre ARCA, la DB, el PDF y los reportes del contador.

## Contexto del emisor (NO cambiar)

- CUIT **30-71022924-0**, SRL Responsable Inscripto, PV fiscal único **0007** (leído de
  `configuracion_empresa.arca_punto_venta`, sin defaults). PV 0001 solo documentos internos.
- Todo a IVA 21%. FA a monotributistas (Ley 27.618, leyenda ya implementada en el PDF).
- **PRES y REV son internos: jamás deben llegar a ARCA ni a reportes fiscales.** Esto hoy se
  cumple (gating por `REQUIERE_CAE`, exclusión en los 4 reportes) — no romperlo.
- Primera semana se factura **solo a clientes de Provincia de Buenos Aires** → la percepción
  IIBB queda en $0 por diseño (no somos agentes ARBA). El padrón IIBB de RN/LP queda
  diferido (ver Tarea 6).

## Estado verificado (no tocar, ya funciona)

- RG 5616 `CondicionIVAReceptorId` en los 4 flujos, con bloqueo si no mapea.
- QR RG 4892 correcto (validado decodificando los QR de los comprobantes reales emitidos).
- NC de devolución con `CbtesAsoc` obligatorios (RG 4540) y bloqueo sin asociado.
- Anulación: comprobante inverso espejo con CAE y asociado.
- Sincronización de numeración con `FECompUltimoAutorizado` antes de cada emisión.
- Percepción IVA RG 5329/5334: 3% solo a RI, mínimo $3.000 por operación.
- Ya hay 3 comprobantes reales emitidos OK: FA 0007-00000001/2 y NCA 0007-00000001.

---

## Tarea 1 — CRÍTICO: aplicar bonificaciones ANTES de solicitar el CAE

**Archivo:** `app/api/comprobantes-venta/generar/route.ts`

**Problema:** hoy `generarComprobante()` solicita el CAE con los totales SIN descuentos, y
recién en el paso 7 se insertan las líneas negativas (Bonificación Mercadería 100% /
General / Viajante) y se actualizan `total_neto/total_iva/total_factura` en DB. Resultado:
ARCA registra un importe mayor al de la factura impresa/QR/DB. Hay ~25 clientes con
bonificaciones activas que lo disparan en cuanto se les facture.

**Implementación:**
1. Mover TODO el cálculo de descuentos del paso 7 a ANTES de llamar `generarComprobante()`:
   por grupo, calcular `totalBonificados` (ítems `es_bonificado`), y los % de bonif
   general/viajante sobre la base sin bonificados — exactamente la misma aritmética actual.
2. Pasar a `generarComprobante()` las líneas de descuento ya calculadas para que:
   - `totalNeto` y `totalIva` sean los valores POST-descuento (descuento neto = monto/1.21,
     IVA del descuento = resto, igual que hoy).
   - Las **percepciones se calculen sobre el neto descontado** (hoy se calculan sobre el
     neto bruto — también queda mal el mínimo de $3.000).
   - `solicitarCAE` reciba `impNeto/impIva/impTrib/impTotal` finales.
   - El insert en `comprobantes_venta` ya tenga los totales definitivos y el detalle incluya
     las líneas negativas desde el inicio (un solo insert de detalle).
3. Eliminar el UPDATE de totales del paso 7 (dejar solo la lógica de reducción de comisión
   del viajante, que no toca el comprobante).
4. Los grupos PRES siguen igual (sin CAE) pero con los descuentos aplicados en el mismo
   momento, para que la aritmética sea idéntica.
5. Mantener `distribuirPercepcionesKardex` (ahora con las percepciones finales).

**Criterio de aceptación:** emitir una FA real a un cliente CON bonificación general y
verificar: importe del QR == comprobante consultado en el portal ARCA == `total_factura`
en DB == TOTAL del PDF, y que `impTotal = impNeto + impIVA + impTrib` exacto en centavos.

## Tarea 2 — CRÍTICO: NC por pago contado debe emitirse con CAE

**Archivo:** `lib/comprobantes/generar-bonificacion.ts`

**Problema:** el descuento 10% por pago contado genera NCA/NCB por **PV 0001, sin CAE y sin
asociados**. Eso crea una NC fiscal que ARCA no conoce pero que SÍ entra a los reportes IVA
(los filtros incluyen NCA/NCB sin mirar CAE) → débito fiscal declarado menor al registrado
en ARCA. Inconsistencia directa en la declaración.

**Implementación:**
1. Para NCA/NCB: replicar el flujo fiscal de `generar-nc-reversa/route.ts`:
   - PV desde `configuracion_empresa.arca_punto_venta` (0007), numeración NCA/NCB 0007
     (ya existe en `numeracion_comprobantes`), sync con `FECompUltimoAutorizado`.
   - `CondicionIVAReceptorId` del cliente (bloquear si no mapea).
   - `CbtesAsoc` = las facturas que se están bonificando (los `comprobante_ids` del input
     ya identifican las FA/FB originales — mapear tipo y número con `TIPO_CBTE_ARCA`).
   - Neto = 10% del `total_neto` de cada factura, IVA = 21% del neto, **sin percepciones**
     (es un descuento financiero; `impTrib = 0`).
   - Guardar CAE/vencimiento en el insert y generar PDF con QR (reusar `buildPDFData`,
     `generarQRBase64`, `generarYSubirPDF` como en las otras rutas).
2. Las REV por PRES siguen exactamente igual (PV 0001, sin CAE, sin QR). No tocarlas.
3. Si ARCA rechaza el CAE, NO crear la NC en DB (hoy el orden ya es CAE→insert en las otras
   rutas; mantener ese orden).

**Criterio de aceptación:** registrar un pago contado sobre una FA real → la NCA generada
tiene CAE, asociado correcto, PV 0007, QR válido, y aparece restando en el reporte IVA.

## Tarea 3 — CRÍTICO: Notas de Débito con comprobantes asociados (RG 4540)

**Archivos:** `app/api/comprobantes-venta/generar-nd/route.ts`, `lib/arca/wsfev1.ts`,
`lib/arca/tipos.ts`, y el formulario de ND en la UI.

**Problema:** la ruta de ND no envía `CbtesAsoc` ni período asociado. La RG 4540 lo exige
para NC **y ND**; ARCA muy probablemente rechace la primera NDA (nunca se emitió una).

**Implementación:**
1. `wsfev1.ts` + `tipos.ts`: agregar soporte opcional de `PeriodoAsoc`
   (`<ar:PeriodoAsoc><ar:FchDesde>YYYYMMDD</ar:FchDesde><ar:FchHasta>YYYYMMDD</ar:FchHasta></ar:PeriodoAsoc>`)
   en `FECAEDetRequest` — para ND por mora/intereses que no referencian una factura puntual.
2. `generar-nd/route.ts`: aceptar en el body `asociados: [{tipo, numero}]` (mismo formato y
   validación que `asociados_manual` de la ruta NC) **o** `periodo: {desde, hasta}`.
   Bloquear con 422 si no viene ninguno de los dos (mismo patrón que `NC_SIN_ASOCIADO`).
3. UI del formulario de ND: campo para elegir la factura original (o ingresar tipo+número
   manual) o un rango de fechas para el período.

**Criterio de aceptación:** emitir una NDA de prueba con asociado → CAE OK; intentar emitir
sin asociado ni período → bloqueo 422 antes de llamar a ARCA.

## Tarea 4 — Factura B: precios con IVA incluido en las líneas

**Archivo:** `lib/pdf/comprobante-template.tsx` (y revisar `generar/route.ts`)

**Problema:** en comprobantes B las líneas muestran el precio NETO (la suma de líneas no
coincide con el Subtotal del pie, que sí incluye IVA). En B los precios deben ir finales,
con IVA incluido y sin discriminar (RG 1415).

**Implementación:** cuando `esFactB`, renderizar precio unitario y subtotal de línea
multiplicados por 1.21 (o mejor: pasar el precio final real desde el detalle). Verificar que
la suma de líneas == "Subtotal" del pie. No tocar la franja de Transparencia Fiscal (ya OK).

Hoy no hay clientes exentos/CF (todos reciben FA), así que no bloquea la primera semana,
pero debe quedar listo antes de cargar el primer cliente que reciba B.

## Tarea 5 — No usar `exento_iva` para anular el IVA de la operación

**Archivos:** `generar-nd/route.ts` (línea del default `iva_pct`),
`generar-nc-reversa/route.ts` (cálculo de `totalIva` y kardex).

**Problema:** `clientes.exento_iva` es la exclusión manual de **percepciones**, pero en ND y
NC se usa para poner IVA $0 en la operación. Un receptor exento igual paga IVA 21% sobre
bienes gravados (solo que no computa el crédito). Con artículos 100% al 21%, el IVA de
ND/NC debe ser siempre 21% sobre el neto.

**Implementación:** quitar la condición `exento_iva` de esos dos cálculos (IVA 21% siempre).
`exento_iva` queda solo para `calcularPercepciones`.

## Tarea 6 — Datos (operativo, en paralelo)

1. Completar **provincia** en los 262 clientes que no la tienen (mínimo: los activos que
   compran). Sin provincia no se resuelve jurisdicción IIBB ni el reporte CM05.
2. Completar CUIT en los 4 clientes sin CUIT (hoy quedan bloqueados al emitir).
3. **Antes de facturar fuera de PBA** (semana 2 en adelante): confirmar con el contador si
   la empresa está designada agente de percepción IIBB en Río Negro / La Pampa / Chubut.
   - Si SÍ: importar padrón de RN a `padron_iibb` y cargar `alicuota_general` de La Pampa
     en `jurisdicciones` (hoy están en 0 → no se percibiría nada).
   - Si NO: dejar todo en 0 y documentarlo en este archivo.

## Tarea 7 — Checklist de aceptación final (antes del OK a producción)

Ejecutar en producción con comprobantes reales chicos (se pueden anular):

- [ ] FA a cliente RI **con bonificación general** → QR == portal ARCA == PDF == DB; percepción IVA calculada sobre el neto descontado.
- [ ] FA a monotributista → leyenda Ley 27.618 en el PDF, `CondicionIVAReceptorId = 6`.
- [ ] NDA con comprobante asociado → CAE OK.
- [ ] NDA sin asociado/período → bloqueo 422 sin llamar a ARCA.
- [ ] Pago contado sobre FA → NCA con CAE, asociado y QR.
- [ ] Anulación de la FA con percepción → NCA espejo con CAE.
- [ ] PRES → PV 0001, sin CAE, ausente de los 4 reportes fiscales y sin QR.
- [ ] Reporte IVA Ventas del mes: cada renglón con CAE existe en ARCA y los totales cuadran 1:1 (validar con el contador).

## Reglas duras para el agente

- Nunca agregar defaults de punto de venta ni de condición de IVA: si falta un dato, error
  explícito y emisión bloqueada.
- Nunca crear un comprobante fiscal en DB si ARCA no devolvió CAE (orden: CAE → insert).
- No duplicar tablas ni columnas existentes en la DB.
- PRES/REV: ningún cambio puede hacer que toquen ARCA, QR o reportes fiscales.
- Commit + push después de cada tarea (deploy automático en Vercel).
