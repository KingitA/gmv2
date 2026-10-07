import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { PDFDocument } from "pdf-lib"
import { comprobantesDePedidos } from "@/lib/comprobantes/comprobantes-de-pedido"

const BUCKET = "comprobantes_venta"

// GET /api/comprobantes-venta/pedido/[pedidoId]/pdf
// UN solo PDF con todos los comprobantes VIVOS del pedido (facturas /
// presupuestos) y sus NC/REV (10% contado, etc.), en ese orden, para ver e
// imprimir de una vez. Los anulados no se incluyen.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ pedidoId: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const supabase = createAdminClient() // bucket privado: leer requiere service role
  const { pedidoId } = await params

  try {
    const comps = (await comprobantesDePedidos(supabase, [pedidoId])).filter((c) => !c.anulado_en)
    if (!comps.length) {
      return NextResponse.json({ error: "El pedido no tiene comprobantes emitidos." }, { status: 404 })
    }

    const destino = await PDFDocument.create()
    const faltan: string[] = []
    for (const c of comps) {
      if (!c.pdf_path) { faltan.push(`${c.tipo_comprobante} ${c.numero_comprobante}`); continue }
      const { data: blob, error } = await supabase.storage.from(BUCKET).download(c.pdf_path)
      if (error || !blob) { faltan.push(`${c.tipo_comprobante} ${c.numero_comprobante}`); continue }
      const origen = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()))
      const paginas = await destino.copyPages(origen, origen.getPageIndices())
      for (const p of paginas) destino.addPage(p)
    }
    if (destino.getPageCount() === 0) {
      return NextResponse.json({ error: `Los comprobantes no tienen PDF generado: ${faltan.join(", ")}` }, { status: 404 })
    }

    const bytes = await destino.save()
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="comprobantes-pedido.pdf"`,
        "Cache-Control": "no-store",
        ...(faltan.length ? { "X-Comprobantes-Sin-PDF": encodeURIComponent(faltan.join(", ")) } : {}),
      },
    })
  } catch (e: any) {
    console.error("[comprobantes del pedido] PDF:", e?.message || e)
    return NextResponse.json({ error: e?.message || "No se pudo armar el PDF" }, { status: 500 })
  }
}
