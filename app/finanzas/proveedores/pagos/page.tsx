import { redirect } from "next/navigation"

// E-64 (16/11/2026): esta pantalla pagaba a proveedores por un circuito viejo
// (RPC fin_crear_pago_proveedor) que movía saldos sin kardex, sin cuenta
// corriente y sin retención. Se retiró: los pagos a proveedores se hacen
// únicamente con Órdenes de pago.
export default function PagosProveedoresRetirada() {
  redirect("/ordenes-pago")
}
