// Config de Vite compartida por las 3 apps (cada apps/<app>/vite.config.ts la usa).
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type UserConfigFnObject } from "vite"

const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function configApp(appDir: string, puerto: number): UserConfigFnObject {
  const version = JSON.parse(readFileSync(resolve(appDir, "version.json"), "utf8"))
  return defineConfig(({ mode }) => {
    const env = loadEnv(mode, appDir, "VITE_")
    return {
      root: appDir,
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          // Motor de precios y contrato HTTP: el MISMO código que usa el ERP web
          "@gm/pricing": resolve(RAIZ_REPO, "lib/pricing/isomorfico.ts"),
          "@gm/contrato": resolve(RAIZ_REPO, "lib/mobile/contrato.ts"),
          // Reglas puras de depósito (bonificados, estados de renglón): mismas que el servidor
          "@gm/deposito": resolve(RAIZ_REPO, "lib/deposito/bonificados.ts"),
        },
      },
      define: {
        __APP_VERSION__: JSON.stringify(version.versionName),
        __API_BASE__: JSON.stringify(env.VITE_API_BASE || "https://gmv2.vercel.app"),
      },
      server: { port: puerto, strictPort: true, fs: { allow: [RAIZ_REPO] } },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        // WebView 127 del NuStar (Chromium): ES2022 sin transpilar de más
        target: "es2022",
        sourcemap: false,
        chunkSizeWarningLimit: 800,
      },
    }
  })
}
