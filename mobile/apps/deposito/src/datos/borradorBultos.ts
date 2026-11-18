// Control de bultos a medio cargar, guardado en el equipo por orden: salir con "atrás" (o que
// el teclado cierre la pantalla), cambiar de pantalla o cerrar la app NO pierde lo escrito.
// Se borra recién cuando el control queda registrado (o salteado a propósito).

export interface BorradorBultos {
  transporte: string
  declarados: string
  recibidos: string
  obs: string
}

export const BORRADOR_BULTOS_VACIO: BorradorBultos = { transporte: "", declarados: "", recibidos: "", obs: "" }

const clave = (ordenId: string) => `gm.deposito.bultos.${ordenId}`
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "")
const soloDigitos = (v: unknown) => texto(v, 6).replace(/\D/g, "")

/** Lo guardado para esa orden, saneado (nunca tira: sin almacenamiento devuelve vacío). */
export function leerBorradorBultos(ordenId: string): BorradorBultos {
  try {
    const crudo = localStorage.getItem(clave(ordenId))
    if (!crudo) return BORRADOR_BULTOS_VACIO
    const b = JSON.parse(crudo) as Partial<BorradorBultos> | null
    if (!b || typeof b !== "object") return BORRADOR_BULTOS_VACIO
    return { transporte: texto(b.transporte, 64), declarados: soloDigitos(b.declarados), recibidos: soloDigitos(b.recibidos), obs: texto(b.obs, 500) }
  } catch {
    return BORRADOR_BULTOS_VACIO
  }
}

export function guardarBorradorBultos(ordenId: string, b: BorradorBultos): void {
  try {
    const vacio = !b.transporte && !b.declarados && !b.recibidos && !b.obs
    if (vacio) localStorage.removeItem(clave(ordenId))
    else localStorage.setItem(clave(ordenId), JSON.stringify(b))
  } catch { /* sin almacenamiento: queda solo en memoria de esta pantalla */ }
}

export function borrarBorradorBultos(ordenId: string): void {
  try { localStorage.removeItem(clave(ordenId)) } catch { /* nada que borrar */ }
}

/**
 * ¿Se puede registrar el control? Hacen falta LOS DOS números (remito y contados).
 * Devuelve por qué no, o null si está completo. Función pura (la usa la pantalla y el test).
 */
export function faltaParaRegistrarBultos(b: Pick<BorradorBultos, "declarados" | "recibidos" | "obs">): string | null {
  if (b.declarados === "" && b.recibidos === "") return "Cargá los bultos del remito y los que contaste"
  if (b.declarados === "") return "Falta cargar los bultos según el remito"
  if (b.recibidos === "") return "Falta cargar los bultos que contaste"
  const decl = Number(b.declarados)
  const recib = Number(b.recibidos)
  if (!(decl > 0)) return "Los bultos del remito tienen que ser más de cero"
  if (decl !== recib && !b.obs.trim()) return "Los números no coinciden: escribí qué pasó"
  return null
}
