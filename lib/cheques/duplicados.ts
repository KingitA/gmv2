// Cheques repetidos en un cobro (Juan, 27/11/2026 — cobro de GENTILI con dos cheques
// nº 30530452: "Patagonia" $1 y "BANCO PATAGONIA" $750.000, cuando en papel trajo uno solo).
//
// Regla: NO dos cheques con el mismo número del mismo cliente, salvo que sean de bancos
// distintos. El banco se compara normalizado ("Patagonia" = "BANCO PATAGONIA" =
// "Bco. Patagonia"). Lo usan la app vendedor (en el mismo cobro) y el servidor (handler del
// outbox, contra los cheques ya cargados del cliente). Puro: sin dependencias de runtime.

const PALABRAS_VACIAS = new Set(["banco", "bco", "de", "del", "la", "el", "los", "las", "sa", "s", "a", "argentina", "argentino"])

/** "BANCO PATAGONIA S.A." → "patagonia"; "Bco. de la Nación Argentina" → "nacion" */
export function claveBanco(banco: string | null | undefined): string {
  return String(banco ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((p) => p && !PALABRAS_VACIAS.has(p))
    .join(" ")
}

/** Solo dígitos y sin ceros a la izquierda: "0030 530452" → "30530452" */
export function claveNumeroCheque(numero: string | number | null | undefined): string {
  return String(numero ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "")
}

export function mismoCheque(a: { banco?: string | null; numero?: string | number | null }, b: { banco?: string | null; numero?: string | number | null }): boolean {
  const na = claveNumeroCheque(a.numero)
  return !!na && na === claveNumeroCheque(b.numero) && claveBanco(a.banco) === claveBanco(b.banco)
}

/** Índices de las filas que repiten un cheque anterior del mismo cobro (la primera no cuenta). */
export function chequesRepetidos(filas: ReadonlyArray<{ tipo?: string; banco?: string | null; numero_cheque?: string | null }>): number[] {
  const out: number[] = []
  filas.forEach((f, i) => {
    if (f.tipo && f.tipo !== "cheque") return
    if (filas.slice(0, i).some((g) => (!g.tipo || g.tipo === "cheque") && mismoCheque({ banco: g.banco, numero: g.numero_cheque }, { banco: f.banco, numero: f.numero_cheque }))) out.push(i)
  })
  return out
}

/** Índices de transferencias que repiten el N° de operación (y la cuenta) de una anterior del mismo cobro. */
export function transferenciasRepetidas(filas: ReadonlyArray<{ tipo?: string; referencia_transferencia?: string | null; cuenta_bancaria_id?: string | null }>): number[] {
  const clave = (f: { referencia_transferencia?: string | null; cuenta_bancaria_id?: string | null }) => {
    const ref = String(f.referencia_transferencia ?? "").replace(/\s+/g, "").toLowerCase()
    return ref ? `${f.cuenta_bancaria_id ?? ""}|${ref}` : ""
  }
  const out: number[] = []
  filas.forEach((f, i) => {
    if (f.tipo !== "transferencia" || !clave(f)) return
    if (filas.slice(0, i).some((g) => g.tipo === "transferencia" && clave(g) === clave(f))) out.push(i)
  })
  return out
}
