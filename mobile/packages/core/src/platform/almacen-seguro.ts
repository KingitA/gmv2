import { SecureStorage } from "@aparajita/capacitor-secure-storage"
import type { AlmacenSeguro } from "../auth/auth"

/**
 * Almacenamiento seguro de la sesión.
 * - Android: Keystore del sistema (AES con clave no exportable) — el refresh
 *   token no queda en texto plano en el disco ni en el backup de la app.
 * - Navegador (npm run dev): el plugin cae a localStorage. Solo desarrollo.
 */
export function crearAlmacenSeguro(prefijo: string): AlmacenSeguro {
  void SecureStorage.setKeyPrefix(`${prefijo}.`)
  return {
    async get(key) {
      const v = await SecureStorage.get(key)
      return typeof v === "string" ? v : v == null ? null : JSON.stringify(v)
    },
    async set(key, value) {
      await SecureStorage.set(key, value)
    },
    async remove(key) {
      await SecureStorage.remove(key)
    },
  }
}
