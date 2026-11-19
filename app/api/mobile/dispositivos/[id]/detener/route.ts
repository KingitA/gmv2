import { accionSonar } from "../accion"

// POST /api/mobile/dispositivos/[id]/detener  { app } — apaga la alarma del equipo.
export const dynamic = "force-dynamic"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return accionSonar(request, (await params).id, "detener")
}
