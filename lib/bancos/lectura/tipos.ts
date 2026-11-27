/**
 * Lectura de movimientos del banco (Tanda 1 del plan de bancos, docs/bancos/PLAN-BANCOS.md).
 * Tipos compartidos por la IA (capturas), los lectores de archivos (PDF/Excel) y las APIs.
 * Isomórfico y sin dependencias: lo prueba mobile/packages/core/test/bancos-lectura.test.ts.
 */

/** Qué banco es: decide el prompt de la IA, el lector del PDF y cómo se identifica cada renglón. */
export type BancoLectura = "nacion" | "provincia" | "credicoop" | "mp" | "otro"

/**
 * De dónde salió el movimiento (columna fuente_detalle). Dos fuentes distintas del mismo banco
 * NO comparten la clave del renglón (la captura de Nación trae hora; el PDF mensual, número de
 * comprobante): entre familias distintas se compara por día + importe (ver clasificarContraExistentes).
 */
export type OrigenLectura = "captura" | "archivo" | "pdf" | "api"

/** Un renglón tal como lo devolvió la IA o un lector (puede venir con textos: se normaliza después). */
export interface FilaLeida {
  fecha: string | number | null
  hora?: string | null
  concepto?: string | null
  detalle?: string | null
  contraparte_nombre?: string | null
  contraparte_cuit?: string | null
  contraparte_cbu?: string | null
  debito?: number | string | null
  credito?: number | string | null
  /** Con signo (crédito +, débito −) cuando el banco muestra una sola columna */
  monto?: number | string | null
  /** Saldo después del movimiento, si el banco lo muestra por renglón */
  saldo?: number | string | null
  /** Número de comprobante / operación / REFERENCE_ID / idTransaccion */
  referencia?: string | null
  /** El lector ya sabe que el renglón está mal (p. ej. el día del PDF no cierra) */
  problema?: string | null
}

/** Una captura o un archivo leído. Las filas van en el orden en que se ven. */
export interface Lectura {
  nombre: string
  origen: OrigenLectura
  filas: FilaLeida[]
  /** "nuevo_primero" = homebanking (lo último arriba); "viejo_primero" = extractos y Excel */
  orden: "nuevo_primero" | "viejo_primero"
  /** Saldo de la cuenta que se ve en la pantalla (encabezado), si se ve */
  saldo_cuenta?: number | null
  saldo_inicial?: number | null
  saldo_final?: number | null
  periodo_desde?: string | null
  periodo_hasta?: string | null
}

export type EstadoFila = "nuevo" | "ya_estaba" | "sin_control" | "error"

/** Un renglón normalizado, con su clave (referencia_externa) y lo que se decidió de él. */
export interface MovLeido {
  fecha: string
  hora: string | null
  concepto: string
  detalle: string
  contraparte_nombre: string | null
  /** "xx-xxxxxxxx-x" (docs/FORMATOS.md), solo si el dígito verificador da */
  contraparte_cuit: string | null
  contraparte_cbu: string | null
  monto: number
  saldo: number | null
  referencia: string | null
  /** referencia_externa: misma fila del banco ⇒ misma clave, venga de la captura que venga */
  clave: string
  origen: OrigenLectura
  estado: EstadoFila
  problema: string | null
  /** Índice de la lectura (captura/archivo) y del renglón dentro de ella */
  lectura: number
  fila: number
}

/** Un movimiento que ya está en la base (para no duplicar). */
export interface MovExistente {
  referencia_externa: string
  fecha: string
  monto: number
  fuente_detalle: OrigenLectura | null
  saldo_banco?: number | null
}

/** Saldo del banco que se pudo leer, con cuándo vale. */
export interface SaldoLeido {
  saldo: number
  /** "ahora" = el saldo de la pantalla en el momento de subirla; si no, el día (AAAA-MM-DD) al que corresponde */
  al: "ahora" | string
  fuente: string
}
