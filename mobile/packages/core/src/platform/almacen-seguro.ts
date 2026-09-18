import { SecureStorage } from "@aparajita/capacitor-secure-storage"
import type { AlmacenSeguro } from "../auth/auth"

/**
 * Almacenamiento seguro de la sesión.
 * - Android: Keystore del sistema (AES-GCM con clave no exportable) — el refresh
 *   token no queda en texto plano en el disco ni en el backup de la app.
 * - Navegador (npm run dev): el plugin cae a localStorage. Solo desarrollo.
 *
 * IMPORTANTE: el prefijo de claves vive en el lado JS del plugin, que se carga de
 * forma asíncrona. TODA operación espera a que el prefijo esté aplicado: si no,
 * en un arranque en frío el primer get() busca con el prefijo por defecto
 * ("capacitor-storage_"), no encuentra la sesión y el operario ve el login aunque
 * esté logueado (bug encontrado en el NuStar al reiniciar sin señal).
 */
export function crearAlmacenSeguro(prefijo: string, plugin: Pick<typeof SecureStorage, "setKeyPrefix" | "get" | "set" | "remove"> = SecureStorage): AlmacenSeguro {
  let listo: Promise<void> | null = null
  const prefijoAplicado = () => (listo ??= plugin.setKeyPrefix(`${prefijo}.`).catch((e) => {
    listo = null // reintentar en la próxima operación
    throw e
  }))
  return {
    async get(key) {
      await prefijoAplicado()
      const v = await plugin.get(key)
      return typeof v === "string" ? v : v == null ? null : JSON.stringify(v)
    },
    async set(key, value) {
      await prefijoAplicado()
      await plugin.set(key, value)
    },
    async remove(key) {
      await prefijoAplicado()
      await plugin.remove(key)
    },
  }
}
