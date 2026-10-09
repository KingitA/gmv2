import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"

export default function Loading() {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center">
            <CargaProgreso mensajes={MENSAJES.pagos} titulo="Preparando la nueva orden de pago" />
        </div>
    )
}
