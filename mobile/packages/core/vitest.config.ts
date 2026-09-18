import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@gm/pricing": r("../../../lib/pricing/isomorfico.ts"),
      "@gm/contrato": r("../../../lib/mobile/contrato.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["fake-indexeddb/auto"],
    include: ["test/**/*.test.ts"],
  },
})
