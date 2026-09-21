import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@gm/pricing": r("../../../lib/pricing/isomorfico.ts"),
      "@gm/contrato": r("../../../lib/mobile/contrato.ts"),
      "@gm/deposito": r("../../../lib/deposito/bonificados.ts"),
      "@gm/vendedor": r("../../../lib/vendedor/isomorfico.ts"),
      "@gm/core": r("./src/index.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["fake-indexeddb/auto"],
    include: ["test/**/*.test.ts"],
  },
})
