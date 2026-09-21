import { redirect } from "next/navigation"

// Los viajes se programan desde el calendario (fecha + zonas); el resto se
// completa en el detalle del viaje.
export default function NuevoViajePage() {
  redirect("/viajes?programar=1")
}
