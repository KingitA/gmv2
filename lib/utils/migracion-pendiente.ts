/**
 * ¿El error es porque todavía no se aplicó una migración? Sirve para que el código
 * nuevo siga andando por el camino anterior hasta que la migración esté en la base.
 *
 * Cuidado con el 42883 ("function … does not exist"): también sale cuando la función
 * que SÍ existe llama adentro a otra cosa que no existe. Por eso se mira el NOMBRE:
 * solo es "falta la migración" si la función que falta es exactamente la esperada.
 * Cualquier otro error se propaga (nunca se cae en silencio al camino viejo).
 */
export function faltaLaFuncion(error: unknown, nombre: string): boolean {
  const e = error as { code?: string; message?: string; hint?: string | null } | null
  if (!e) return false
  const msg = String(e.message || "")
  const nombraLaFuncion = new RegExp(`(^|[^a-z0-9_])${nombre}\\s*\\(`, "i").test(msg)
  // PGRST202: PostgREST no encuentra en su caché la función que se llamó por RPC. Si la pista dice
  // "quizás quisiste llamar a <esa misma función>", la función EXISTE pero con otra firma (o la
  // caché está vieja): eso no es "falta la migración", es un error que hay que ver. Se propaga.
  if (e.code === "PGRST202") {
    if (new RegExp(`(^|[^a-z0-9_])${nombre}([^a-z0-9_]|$)`, "i").test(String(e.hint || ""))) return false
    return nombraLaFuncion || !/\(/.test(msg)
  }
  if (e.code === "42883" || /could not find the function|does not exist/i.test(msg)) return nombraLaFuncion
  return false
}

/** Falta una columna (42703 de Postgres / PGRST204 de PostgREST). */
export function faltaLaColumna(error: unknown): boolean {
  const e = error as { code?: string } | null
  return !!e && (e.code === "42703" || e.code === "PGRST204")
}
