import "@gm/core/styles.css"
import { montarApp } from "@gm/core"
import { DATASETS } from "./datasets"
import { rutas } from "./rutas"

void montarApp({
  config: { app: "chofer", apiBase: __API_BASE__, version: __APP_VERSION__, datasets: DATASETS },
  nombreApp: "Chofer",
  rutas,
})
