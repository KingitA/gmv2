# Resumen de sesión — La Caja del Día y cuentas corrientes (05–10/08/2026)

Sesión de trabajo sobre el circuito diario de cobranzas: nueva pantalla **La Caja
del Día** (`/caja`), rediseño de la cuenta corriente de clientes, y una serie de
bugs estructurales del circuito de pagos/imputaciones/bonificaciones que las
pruebas reales destaparon y se corrigieron.

---

## 1. La Caja del Día (`/caja`) — pantalla nueva

Reemplaza la hoja de caja de Google Drive: libro diario unificado de la plata en
una sola pantalla a ancho completo, para roles **admin + administrativo**
(acceso directo en el menú, sección Finanzas).

**Etapa 1 — Ver** (`f1e50a6`)
- `GET /api/caja?fecha=`: combina kardex_contable del día + pagos pendientes +
  rendiciones abiertas, enriquecido (clientes, proveedores, cuentas, cheques, OPs).
- Navegación por día ‹ ›, pestañas por tipo (Cobros / Transferencias / Echeqs /
  Proveedores / Rendiciones / Internos), búsqueda, panel de arqueo de caja chica,
  contadores de pendientes y totales del día.
- Estados en palabras; cuando requieren acción, **el estado es el botón**.

**Etapa 2 — Operar** (`cd27405`)
- Barra de registro rápido: cliente + método + monto. El **efectivo entra a la
  caja al instante** (confirma en el acto con la caja elegida); transferencias /
  echeqs / cheques quedan pendientes hasta su **Confirmar / Aceptar** en la fila.
- **⇄ Mover plata**: transferencias entre cuentas, egresos por categoría y
  **🚚 A cuenta viaje** (caja → billetera del chofer/viajante, con dual-write
  kardex + billetera vía `POST /api/caja/entregar-billetera`).
- Confirmación/rechazo inline (mismo circuito que Revisión de Pagos), color de
  cheque BLANCO/NEGRO cuando corresponde, **anular recibo** desde la fila (⊘).

**Etapa 3 — Control de rendiciones** (`004a7b2`)
- Botón **Controlar** en la fila violeta "Esperando la plata": checklist físico
  cheque por cheque contra lo declarado (con el cobrador adelante), efectivo
  declarado vs contado, diferencia localizada en el ítem exacto, confirmar CON
  diferencia auditada (forzar explícito). La rendición no entra al arqueo hasta
  ese control.

**Etapa 4 — Cierre del día** (`004a7b2`, simplificado en `04f7fdc`)
- **Cerrar el día**: arqueo (esperado vs contado), verificación en lote de los
  cobros del día (segunda firma) y diferencia como ajuste auditado con nota
  obligatoria. Los retiros de comisión de viajantes ahora también quedan en el
  kardex (`RETIRO_BILLETERA`, dual-write en `/api/viajantes/[id]/retiro`).

## 2. Registro de cobros — funcionalidades

- **Imputación como choferes/vendedores** (`53b403a`): `ComprobantesSelector`
  compartido — pedidos completos con un tilde, comprobantes dentro del pedido,
  anticipos a pedidos sin facturar (con 10% al 90%), chip verde "Dto. ctdo".
  También en el modal **Imputar** (cobros confirmados con plata sin aplicar).
- **OCR en la barra** (`916204f`): subir foto, sacar foto o **pegar captura
  (Ctrl+V)**. Detecta cheque/echeq/transferencia y precarga método, banco,
  número, vencimiento, monto y CUIT. La foto queda adjunta al pago siempre.
- **BCRA Central de Deudores** (`8641dc0`, `3267f44`, `9f8d4ca`): consulta a
  TODOS los titulares del cheque (cuentas conjuntas), veredicto único ("se
  puede aceptar" / detalle solo del titular con deuda) y alerta especial si la
  deuda está **en el mismo banco que emitió el cheque**.
- **Cobros mixtos** (`b4e9a4a`): botón "+ Otro método" (ej. transferencia +
  efectivo). Solo-efectivo confirma al acto; con valores queda pendiente.
- **Línea de cuentas única** (`af1aaab`): `Seleccionado − NC 10% = a cobrar |
  Entregado [✓ Cuadra / Resta saldar / Sobran → a cuenta]`. El monto se toma al
  salir del campo (no baila al tipear).
- **Cartel "Falta pagar $X"** (`2a44910`): dos salidas — **ajuste por
  redondeo** (comprobante saldado + crédito auditado en cta cte, eliminable) o
  **dejar saldo pendiente** (pago parcial). Chau centavos.

## 3. Bonificación 10% pago contado — arreglos de fondo

- **Percepciones proporcionales** (`b4e9a4a`): la NC/REV devuelve el 10% de
  TODOS los componentes (neto + IVA + percepción IVA/IIBB) = exactamente 10%
  del total facturado. Va a ARCA con impTrib + Tributos igual que la factura.
  Estimaciones alineadas en las 4 pantallas.
- **No se saltea nunca** (`0023cf3`): cobro pendiente con 10% tildado → la
  intención viaja con el pago (`[10% CONTADO]` en observaciones) y el endpoint
  de confirmación (`PATCH /api/pagos/[id]/confirmar`) emite la NC/REV al
  acreditarse el valor — desde cualquier pantalla. Idempotente, excluye
  comprobantes que ya tienen el descuento.
- **La REV genera su PDF** (`7c0c526`): documento interno sin CAE ni QR.
- **Fin del "modelo pozo"** (`64ba605`): la NC/REV se imputa **directo contra
  los comprobantes bonificados** (`cc_imputar_credito`), no "al pago". Esto
  arregla el bug por el cual el recorte del endpoint de pagos (que capea las
  imputaciones al monto del pago) dejaba el 10% como saldo pendiente y el
  crédito de la NC flotando.

## 4. Cuenta corriente de clientes — rediseño

- **Extracto de cuenta** (`84f19b5`): el libro mayor visible — cada movimiento
  (facturas, pagos, NC, **ajustes** con 🗑 para eliminar) con Debe/Haber y saldo
  acumulado; la última fila cierra exacto en el Saldo Real.
- **Vistas** (`9c410be`): **Solo saldos** (default — únicamente lo que tiene
  saldo) y **Cuenta detallada** (extracto + todo, con filtro Desde/Hasta).
- **Filas "A CUENTA"** (`6e3653b`, fix `f218c4c`): plata del cliente sin aplicar
  (entregas a cuenta / sobrantes) visible con fecha en Solo saldos. Cálculo del
  "pozo": monto + créditos aplicados − imputado a débitos.
- **PDFs clickeables**: el número del comprobante abre el PDF (tabla y extracto).
- **Etiquetas exactas** (`64ba605`): Reversa ≠ Nota de crédito A ≠ Presupuesto.
- **Eliminar ajustes manuales** (`2a44910`): DELETE con validación (solo
  ajustes manuales; nada del circuito de comprobantes/pagos).

## 5. Anulaciones — bugs estructurales corregidos

- **Anuladas fuera de los cobrables** (`9f8d4ca`, `656dc4c`): un comprobante
  anulado no se cobra — filtrado en el selector compartido, app del vendedor y
  Revisión de Pagos. La anulación además **cancela automáticamente la NC
  inversa contra el original** (ambos quedan saldo 0).
- **No se anula el espejo de una anulación** (`e8c5352`): bloqueado con 422
  (anular la REV que anuló un PRES resucitaba la deuda en loop infinito).
- **PRES/REV contra-asientan al libro** (`e8c5352`): `CC_MOVIMIENTO` tenía
  PRES/REV en null (pre-backfill) → anular un presupuesto impago dejaba deuda
  fantasma en el saldo real.

## 6. Doctrinas del negocio establecidas

1. **"El pago es del cliente, no del comprobante"** — anular una venta jamás
   toca la plata entregada: queda a favor (las REV/NC espejo son documentos de
   crédito vivos).
2. **Toda NC es proporcional a TODOS los componentes de la venta** (neto + IVA
   + percepciones). Anula la vieja regla "descuento financiero sin percepciones".
3. **El 10% por pago contado no se saltea en ningún punto del sistema.**
4. Los centavos quedaron obsoletos: diferencias chicas → **ajuste por redondeo**
   auditado o saldo pendiente, a elección del operador.

## 7. Scripts SQL para el SQL Editor (correr si no se hizo)

| Script | Qué hace |
|---|---|
| `supabase/migrations/20260805_fix_imputar_nc_anulacion_wang.sql` | Cancela FA 0007-4 ↔ NC 0007-3 (Wang Zhi Bin), par previo al fix de anulación |
| `supabase/migrations/20260810_fix_urquiza_anulaciones.sql` | Urquiza: neutraliza PRES 12/13, rehabilita REV 3/4 como crédito ($4.591.534 = su pago), contra-asientos faltantes, anula REV de bonificación, borra ajuste $0,36. Saldo esperado: −3.589.534,48 |

## 8. Pendientes / notas

- Probar en producción: primera NC fiscal con percepciones contra ARCA (camino
  nuevo del pedido de CAE con Tributos) — hacerlo con un caso chico.
- El efectivo de las pruebas quedó sumado en Caja Chica (kardex); se corrige en
  el próximo cierre con arqueo (ajuste auditado) o con un egreso manual.
- Ideas anotadas sin implementar: botón "Aplicar crédito" (imputar una NC/REV a
  favor contra facturas desde la cta cte), botón "Regenerar PDF", distinción
  visual de NC de anulación vs comerciales, multi-titular BCRA en las apps de
  chofer/vendedor.
- Guía de uso y plan aprobado (artifacts): guía del encargado de cuentas
  corrientes y propuesta "La Caja del Día v3" en claude.ai/code/artifacts.
