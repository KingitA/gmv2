import "@gm/core/styles.css"
import { montarApp } from "@gm/core"
import { DATASETS } from "./datasets"
import { rutas } from "./rutas"

void montarApp({
  // replicaPorUsuario: false — todos los operarios ven la misma cola: el cambio de
  // turno no borra ni re-descarga la réplica (MOBILE.md → "Depósito")
  config: { app: "deposito", apiBase: __API_BASE__, version: __APP_VERSION__, datasets: DATASETS, replicaPorUsuario: false },
  nombreApp: "Depósito",
  rutas,
})
