import type { CapacitorConfig } from "@capacitor/cli"

// UI 100% local: el bundle (dist/) viaja dentro del APK. NO hay server.url:
// la app nunca carga una URL remota (ver MOBILE.md → "Arquitectura").
const config: CapacitorConfig = {
  appId: "com.gm.chofer",
  appName: "GM Chofer",
  webDir: "dist",
  android: {
    // Sin contenido mixto ni depuración remota en release
    // Solo para probar contra un Next local por http (GM_DEV_HTTP=1 npx cap sync).
    // build-apks.mjs sincroniza SIN esta variable: los release nunca lo tienen.
    allowMixedContent: process.env.GM_DEV_HTTP === "1",
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: "https",
    // Solo el ERP (datos). Cualquier otra navegación se abre fuera de la app.
    allowNavigation: [],
  },
}

export default config
