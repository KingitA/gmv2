import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"

export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <CargaProgreso mensajes={MENSAJES.viajes} titulo="Cargando viaje" />
    </div>
  )
}
