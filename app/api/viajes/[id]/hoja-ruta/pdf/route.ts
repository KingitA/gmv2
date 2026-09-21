import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer"
import React, { type JSXElementConstructor, type ReactElement } from "react"
import { armarHojaRuta } from "@/lib/viajes/hoja-ruta"
import { esTripulante } from "@/lib/viajes/chofer"
import { getUserRoles } from "@/lib/auth"
import { ERP_ROLES } from "@/lib/role-utils"
import { HojaRutaPDF } from "@/lib/pdf/hoja-ruta-template"

// GET /api/viajes/[id]/hoja-ruta/pdf — la hoja de ruta imprimible.
// Se genera al vuelo con los datos del momento (no se guarda): oficina la
// imprime al despachar; la tripulación del viaje también puede abrirla.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params

    const hoja = await armarHojaRuta(supabase, id)
    if (!hoja) return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 })

    const roles = await getUserRoles(auth.user.id)
    const esOficina = roles.some((r) => (ERP_ROLES as readonly string[]).includes(r))
    if (!esOficina && !(await esTripulante(supabase, id, auth.user.id, hoja.viaje.titular_id))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    const element = React.createElement(HojaRutaPDF, { data: hoja }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
    const buffer = await renderToBuffer(element)
    const nombre = hoja.viaje.nombre.replace(/[^\w\-]+/g, "_").slice(0, 60)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="HojaRuta_${nombre}.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    console.error("[viajes] Error en GET hoja-ruta/pdf:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
