import { redirect } from "next/navigation"

// La bandeja vive dentro de Caja (dueño 21/10: solo la ven los que confirman
// desde /caja). Se deja la ruta vieja para los links guardados.
export default function PendientesViejo() {
  redirect("/caja/pendientes")
}
