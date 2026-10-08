import { redirect } from "next/navigation"

// El dashboard viejo se eliminó (pedido del dueño, 08/10/2026): la pantalla de
// inicio del ERP es CLIENTES → Pedidos y viajes. Links viejos a "/" llegan ahí.
export default function Inicio() {
  redirect("/clientes-pedidos")
}
