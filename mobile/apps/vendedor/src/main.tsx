import "@gm/core/styles.css"
import { montarApp } from "@gm/core"
import { DATASETS, DS } from "./datasets"
import { rutas } from "./rutas"

void montarApp({
  // Los datasets dependen del vendedor logueado (su cartera, sus pedidos): al ingresar
  // otro usuario en el mismo equipo se limpia la réplica del anterior (default del core).
  config: { app: "vendedor", apiBase: __API_BASE__, version: __APP_VERSION__, datasets: DATASETS },
  nombreApp: "Vendedor",
  rutas,
}).then((rt) => {
  // Plata y pedidos mueven la billetera, comisiones y el resumen del inicio: son datasets de
  // varias filas (no se pueden parchear de a una) ⇒ se re-leen apenas la operación se aplicó.
  rt.outbox.onAplicado((item) => {
    if (/^(cobro|pedido)\./.test(item.tipo)) {
      void rt.sync.dataset(DS.billetera).catch(() => {})
      void rt.sync.dataset(DS.me).catch(() => {})
    }
    if (item.tipo === "cliente.crear") void rt.sync.dataset(DS.preciosClientes).catch(() => {})
  })
})
