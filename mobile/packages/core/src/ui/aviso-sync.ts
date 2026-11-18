/**
 * Qué decir en la barra de datos cuando la última actualización falló. Antes decía siempre
 * "último intento falló", también cuando el problema era que la sesión había vencido: el
 * operario tocaba "Actualizar" una y otra vez sin saber que tenía que volver a ingresar.
 * Función pura (test: test/aviso-sync.test.ts).
 */
export function avisoErrorSync(error: string | null | undefined, ctx: { sinSesion: boolean; online: boolean }): string {
  // sin sesión no hay nada que actualizar, haya o no un error guardado
  if (ctx.sinSesion) return " · Sesión vencida: volvé a ingresar"
  if (!error) return ""
  if (/sesi[oó]n|401|no autorizado|unauthorized/i.test(error)) return " · Sesión vencida: volvé a ingresar"
  if (!ctx.online) return " · sin señal: se actualiza solo cuando vuelva"
  return " · último intento falló"
}
