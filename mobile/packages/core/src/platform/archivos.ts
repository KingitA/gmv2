import { Capacitor, registerPlugin } from "@capacitor/core"

// Archivos para mostrar y compartir (PDF de comprobantes). En el equipo usa el plugin
// nativo GmArchivos (mobile/packages/capacitor-archivos): el archivo queda en la caché
// de la app, se abre con el visor del equipo y se comparte (uno o varios) con la hoja
// de compartir de Android. En el navegador (desarrollo) abre una pestaña / navigator.share.

interface GmArchivosPlugin {
  guardar(o: { nombre: string; base64: string }): Promise<{ ruta: string }>
  abrir(o: { ruta: string; tipo?: string }): Promise<void>
  compartir(o: { rutas: string[]; titulo?: string; tipo?: string }): Promise<void>
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
