# Plan de bancos (27/11/2026)

Objetivo de Juan: bancos al día, cada movimiento del banco explicado, transferencias de clientes que se
confirman solas, impuestos y gastos bancarios registrados, cheques trazables y Jarvis que responda
con datos reales. Bancos: Credicoop (principal), Nación (diario), MercadoPago (diario), Provincia
(cheques, sueldos, algún proveedor).

## Decisiones de Juan (27/11)
- Montos: la transferencia del banco y la cargada tienen que coincidir EXACTO (se toleran centavos de
  redondeo, < $1). "El cliente descontó $10" no existe.
- Cheque rechazado: el sistema AVISA y Juan confirma la nota de débito. No sale sola.
- Nación y Provincia: los extractos oficiales llegan tarde (Provincia una vez al mes). Se cargan
  CAPTURAS DE PANTALLA del homebanking (o el archivo de "Descargar" de la pantalla de movimientos si
  existe) 2-3 veces por día o cuando se quiera. El sistema las lee con IA y no duplica movimientos que
  ya estaban en una captura anterior.
- Quien paga por quién: una persona puede pagar por MÁS DE UN cliente (ej. paga lo suyo y lo del
  primo) y hay clientes con nombre repetido. El vínculo pagador↔cliente es de muchos a muchos y por
  CUIT cuando hay; nunca se decide por nombre de cliente solo.
- En /caja: las transferencias confirmadas solas y los créditos sin identificar aparecen juntos. Los
  sin identificar muestran el nombre de quien transfirió y un botón "Vincular"; quedan pendientes (NO
  se acreditan en ninguna cuenta corriente) hasta que alguien los vincule o confirme.
- Pruebas: Juan NO quiere que le pidan probar cada cosa. Se hace todo, se prueba internamente (sin
  tocar cuentas corrientes reales: modo propuesta / datos de octubre) y se prueba con él al final.
  Trabajamos con banco real: nada puede emitir NC ni imputar saldos por error.

## Qué trae cada banco (extractos de octubre + capturas del 24-27/11)
- Credicoop (PDF y API): renglón + segunda línea con CUIT−concepto−NOMBRE y CBU origen/destino.
  Al final del resumen: detalle de transferencias recibidas (originante, CUIT, banco) y totales del mes
  por impuesto (Ley 25.413, SIRCREB, IVA, percepción RG 2408). Cheques: "Acreditación de Valores −
  Cámara" con "Ch: número", "Pago de Cheque de Cámara".
- Nación homebanking (captura): Fecha y hora, Concepto ("CR DEBIN RED LINK", "DEB.TRAN.INTERB",
  "GRAVAMEN LEY 25413 S/DEB|S/CRED", "REG.REC.SIRCREB"), Detalle con NOMBRE + CUIT, Débito, Crédito.
  Sin saldo por renglón. Impuestos con hora 00:00:00 (pueden repetirse iguales el mismo día). Tiene
  botón "Descargar". El PDF mensual NO trae quién transfirió en "TRANSF.INT.DIST-LINKLAR".
- Provincia homebanking (captura): fecha, concepto, importe con signo y SALDO por renglón (sirve para
  encadenar y deduplicar). Reversas ("REV. IMP.DEBITO", "REVERSA INGRESOS BRUTO SIRCREB"),
  "CHEQUE/O.E. RECHAZADO", depósitos de cheques sumados en una línea.
- MercadoPago (Excel / API): RELEASE_DATE, TRANSACTION_TYPE con nombre ("Transferencia recibida X"),
  REFERENCE_ID, neto, saldo parcial. Sin CUIT. Rendimientos, "Pago de impuestos".

## Tandas
1. Lectura y saldos: carga de capturas/archivos por banco (IA), deduplicación, contraparte
   (nombre/CUIT/CBU), saldo del banco con hora vs saldo del sistema; Credicoop y MP por API programados.
2. Clasificación de impuestos y gastos por banco + reportes + herramientas de Jarvis.
3. Transferencias de clientes: pagadores aprendidos (muchos a muchos), confirmación automática solo si
   hay UNA coincidencia exacta, bandeja de créditos sin identificar en /caja con "Vincular".
4. Cheques: acreditación y débito automáticos por número/importe, alerta a las 96 h, rechazo → aviso
   y Juan confirma la ND.
5. Control diario: todo movimiento conciliado, clasificado o en bandeja; aviso de Jarvis.

Lo existente está mapeado en el relevamiento (conciliación: banco_extractos, banco_extractos_movimientos,
extracto_matchear; saldos: saldos_financieros/kardex; cobros: pagos_clientes + cobranza_confirmar;
cheques: tabla cheques; Jarvis: lib/jarvis/herramientas*.ts con consultas fijas).
