import { accionSonar } from "../accion"

// POST /api/mobile/dispositivos/[id]/sonar  { app } — hace sonar el equipo (hasta 60 s).
export const dynamic = "force-dynamic"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return accionSonar(request, (await params).id, "sonar")
}
