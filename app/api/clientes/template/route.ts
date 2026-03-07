import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { requireAuth } from '@/lib/auth'

export async function GET() {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const headers = [
            "nombre_razon_social",
            "cuit",
            "direccion",
            "provincia",
            "telefono",
            "mail",
            "condicion_iva",
            "metodo_facturacion",
            "condicion_pago",
            "tipo_canal",
            "nro_iibb",
            "exento_iibb",
            "exento_iva",
            "percepcion_iibb",
            "puntaje",
        ]

        const explicaciones = [
            "Obligatorio. Ej: Juan Perez o Empresa SA", // nombre
            "Opcional. Ej: 20-12345678-9", // cuit
            "Opcional.", // direccion
            "Opcional.", // provincia
            "Opcional.", // telefono
            "Opcional. Email de contacto.", // mail
            "Responsable Inscripto | Monotributo | Consumidor Final | Sujeto Exento | No Categorizado", // condicion_iva
            "Factura | Final | Presupuesto", // metodo_facturacion
            "Efectivo | Transferencia | Cheque al día | Cheque 30 días | Cheque 30/60/90", // condicion_pago
            "Mayorista | Minorista | Consumidor Final", // tipo_canal
            "Opcional.", // nro_iibb
            "SI o NO", // exento_iibb
            "SI o NO", // exento_iva
            "Opcional, en formato numero ej: 1.5", // percepcion_iibb
            "Opcional, del 0 al 100", // puntaje
        ]

        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.aoa_to_sheet([headers, explicaciones])

        // Ajustar anchos aprox.
        const wscols = headers.map(() => ({ wch: 20 }))
        wscols[0] = { wch: 30 } // nombre
        wscols[6] = { wch: 25 } // cond iva
        ws["!cols"] = wscols

        XLSX.utils.book_append_sheet(wb, ws, "Clientes")

        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

        return new NextResponse(buf, {
            status: 200,
            headers: {
                "Content-Disposition": 'attachment; filename="plantilla_clientes.xlsx"',
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
        })
    } catch (error) {
        console.error("[Template Clientes ERROR]", error)
        return NextResponse.json({ error: "Error generando plantilla" }, { status: 500 })
    }
}
