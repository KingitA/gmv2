import "./tema.css"
import { montarApp } from "@gm/core"
import { DATASETS, DS } from "./datasets"
import { rutas } from "./rutas"
import { descontarRetiro, type BilleteraData, type OpRetiro } from "./datos/billetera"

void montarApp({
  // Los datasets dependen del vendedor logueado (su cartera, sus pedidos): al ingresar
  // otro usuario en el mismo equipo se limpia la réplica del anterior (default del core).
  config: { app: "vendedor", apiBase: __API_BASE__, version: __APP_VERSION__, versionCode: __APP_VERSION_CODE__, datasets: DATASETS },
  nombreApp: "Vendedor",
  rutas,
}).then((rt) => {
  // Plata y pedidos mueven la billetera, comisiones y el resumen del inicio: son datasets de
  // varias filas (no se pueden parchear de a una) ⇒ se re-leen apenas la operación se aplicó.
  rt.outbox.onAplicado(async (item) => {
    // Retiro aplicado y el servidor NO mandó la billetera nueva (su sync puede tardar o fallar,
    // 27/11): se descuenta acá para que la mano y "para enviar a la oficina" queden bien YA
    if (item.tipo === "retiro.registrar") {
      const parches = (item.resultado as { replica?: Array<{ dataset: string; upserts?: Array<{ id: string }> }> } | null)?.replica ?? []
      const vinoBilletera = parches.some((p) => p.dataset === DS.billetera && (p.upserts ?? []).some((f) => f.id === "billetera"))
      const fila = vinoBilletera ? null : await rt.replica.una<BilleteraData & { id: string }>(DS.billetera, "billetera").catch(() => null)
      const monto = Number((item.payload as OpRetiro)?.monto) || 0
      if (fila && monto > 0) await rt.replica.parchear(DS.billetera, [{ ...descontarRetiro(fila, monto), id: "billetera" }]).catch(() => {})
    }
    if (/^(cobro|pedido|retiro)\./.test(item.tipo)) {
      void rt.sync.dataset(DS.billetera).catch(() => {})
      void rt.sync.dataset(DS.me).catch(() => {})
    }
    if (item.tipo.startsWith("cliente.")) {
      void rt.sync.dataset(DS.preciosClientes).catch(() => {})
      // Cinturón y tiradores: si el parche de réplica no trajo la fila, la trae el sync
      void rt.sync.dataset(DS.clientes).catch(() => {})
    }
  })
})
