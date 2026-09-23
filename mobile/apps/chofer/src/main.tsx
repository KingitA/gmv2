import "./tema.css"
import { montarApp } from "@gm/core"
import { DATASETS, DS } from "./datasets"
import { rutas } from "./rutas"

void montarApp({
  // Los datasets dependen del chofer logueado (sus viajes, su billetera): al ingresar otro
  // usuario en el mismo equipo se limpia la réplica del anterior (default del core).
  config: { app: "chofer", apiBase: __API_BASE__, version: __APP_VERSION__, datasets: DATASETS },
  nombreApp: "Chofer",
  rutas,
}).then((rt) => {
  // Cada operación del viaje vuelve con el parche de la hoja de ruta, la ficha del cliente y
  // la billetera (lib/mobile/outbox/chofer.ts). Cinturón y tiradores: si el parche no llegó
  // (o el viaje cambió de estado), se re-lee lo que resume el inicio.
  rt.outbox.onAplicado((item) => {
    if (item.tipo === "viaje.finalizar" || item.tipo === "viaje.iniciar") void rt.sync.dataset(DS.me).catch(() => {})
  })
})
