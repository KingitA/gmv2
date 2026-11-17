import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core"
import type { PlataformaActualizacion } from "../actualizacion/actualizador"

// Archivos para mostrar y compartir (PDF de comprobantes). En el equipo usa el plugin
// nativo GmArchivos (mobile/packages/capacitor-archivos): el archivo queda en la caché
// de la app, se abre con el visor del equipo y se comparte (uno o varios) con la hoja
// de compartir de Android. En el navegador (desarrollo) abre una pestaña / navigator.share.

interface GmArchivosPlugin {
  guardar(o: { nombre: string; base64: string }): Promise<{ ruta: string }>
  abrir(o: { ruta: string; tipo?: string }): Promise<void>
  compartir(o: { rutas: string[]; titulo?: string; tipo?: string }): Promise<void>
  // Actualización de la app (MOBILE.md → "Actualización desde la app")
  puedeInstalar(): Promise<{ valor: boolean }>
  abrirPermisoInstalar(): Promise<void>
  descargarApk(o: { url: string; sha256: string; nombre: string }): Promise<{ ruta: string; sha256: string }>
  instalarApk(o: { ruta: string }): Promise<void>
  addListener(evento: "progresoDescarga", fn: (p: { bajado: number; total: number }) => void): Promise<PluginListenerHandle>
}
const GmArchivos = registerPlugin<GmArchivosPlugin>("GmArchivos")
const nativo = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("GmArchivos")

export interface Archivo {
  nombre: string
  blob: Blob
  /** Ruta en la caché de la app (solo en el equipo) */
  ruta?: string
}

function base64De(blob: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""))
    r.onerror = () => mal(r.error)
    r.readAsDataURL(blob)
  })
}

/** Deja el archivo listo para abrir/compartir (en el equipo: lo escribe en la caché). */
export async function guardarArchivo(nombre: string, blob: Blob): Promise<Archivo> {
  if (!nativo()) return { nombre, blob }
  const { ruta } = await GmArchivos.guardar({ nombre, base64: await base64De(blob) })
  return { nombre, blob, ruta }
}

/** Lo abre con el visor del equipo (PDF: el visor ya trae "compartir"). */
export async function abrirArchivo(a: Archivo, tipo = "application/pdf"): Promise<void> {
  if (nativo() && a.ruta) return GmArchivos.abrir({ ruta: a.ruta, tipo })
  window.open(URL.createObjectURL(a.blob), "_blank")
}

/** Hoja de compartir con UNO o VARIOS archivos (WhatsApp, mail, Drive…). */
export async function compartirArchivos(archivos: Archivo[], titulo = "Compartir", tipo = "application/pdf"): Promise<void> {
  if (!archivos.length) return
  if (nativo()) {
    const rutas = archivos.map((a) => a.ruta).filter((r): r is string => !!r)
    return GmArchivos.compartir({ rutas, titulo, tipo })
  }
  const files = archivos.map((a) => new File([a.blob], a.nombre, { type: tipo }))
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (nav.share && nav.canShare?.({ files })) return nav.share({ files, title: titulo })
  for (const a of archivos) abrirArchivoDescarga(a)
}

function abrirArchivoDescarga(a: Archivo) {
  const link = document.createElement("a")
  link.href = URL.createObjectURL(a.blob)
  link.download = a.nombre
  link.click()
}

// ─── Actualización de la app ─────────────────────────────────────────────────

/** sha256 en hex minúscula (navegador / tests). */
export async function sha256Hex(datos: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", datos)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function errorCon(codigo: string, mensaje: string, mensajeUsuario?: string) {
  return Object.assign(new Error(mensaje), { code: codigo, mensajeUsuario })
}

/**
 * En el equipo: plugin nativo (baja directo a la caché, verifica el sha256 en Java y abre
 * el instalador de Android). En el navegador (desarrollo): baja con fetch y verifica el
 * sha256, pero no instala.
 */
export function plataformaActualizacion(): PlataformaActualizacion {
  if (nativo()) {
    return {
      puedeInstalar: async () => (await GmArchivos.puedeInstalar()).valor,
      abrirPermisoInstalar: () => GmArchivos.abrirPermisoInstalar(),
      async descargar(o, alAvanzar) {
        const h = await GmArchivos.addListener("progresoDescarga", (p) => alAvanzar(p.bajado, p.total))
        try {
          return (await GmArchivos.descargarApk(o)).ruta
        } finally {
          await h.remove()
        }
      },
      instalar: (ruta) => GmArchivos.instalarApk({ ruta }),
    }
  }
  return {
    puedeInstalar: async () => true,
    abrirPermisoInstalar: async () => {},
    async descargar(o, alAvanzar) {
      let r: Response
      try {
        r = await fetch(o.url, { cache: "no-store" })
      } catch {
        throw errorCon("RED", "sin red")
      }
      if (!r.ok || !r.body) throw errorCon("RED", `HTTP ${r.status}`)
      const total = Number(r.headers.get("Content-Length")) || 0
      const partes: Uint8Array[] = []
      let bajado = 0
      const lector = r.body.getReader()
      for (;;) {
        const { done, value } = await lector.read()
        if (done) break
        partes.push(value)
        bajado += value.length
        alAvanzar(bajado, total)
      }
      const todo = new Uint8Array(bajado)
      let k = 0
      for (const p of partes) { todo.set(p, k); k += p.length }
      if ((await sha256Hex(todo.buffer)) !== o.sha256.toLowerCase()) throw errorCon("SHA", "sha256 distinto")
      return o.nombre
    },
    async instalar() {
      throw errorCon("WEB", "sin instalador", "Descargada y verificada. En el navegador no se instala: solo en el equipo.")
    },
  }
}
