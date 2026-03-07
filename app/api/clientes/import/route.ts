import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const formData = await req.formData()
        const file = formData.get("file") as File | null

        if (!file) {
            return NextResponse.json({ error: "No se proporcionó un archivo." }, { status: 400 })
        }

        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const wb = XLSX.read(buffer, { type: "buffer" })
        const sheetName = wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]

        // Read the rows. The first row is headers, second row is the instructions. We should skip row 2 if it's the instruction.
        // Instead of using header: 1, we can get an array of arrays.
        const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][]

        if (rawData.length < 3) {
            return NextResponse.json({ error: "El archivo parece estar vacío o no tiene el formato correcto." }, { status: 400 })
        }

        const headers = rawData[0] as string[]

        // We expect the headers to be from our template
        const nameIndex = headers.indexOf("nombre_razon_social")
        if (nameIndex === -1) {
            return NextResponse.json({ error: "Falta la columna 'nombre_razon_social', que es obligatoria." }, { status: 400 })
        }

        // Process from third row (index 2) onwards since index 1 is text explanations
        const rows = rawData.slice(2)
        const clientesToInsert = []

        for (const row of rows) {
            // Si la fila está vacía, la omitimos
            if (!row || row.length === 0 || !row[nameIndex]) {
                continue
            }

            const val = (idx: number) => {
                if (idx === -1) return null
                return row[idx] !== undefined && row[idx] !== null && String(row[idx]).trim() !== "" ? String(row[idx]).trim() : null
            }

            const parseBool = (valStr: string | null) => {
                if (!valStr) return false
                return valStr.toUpperCase() === "SI" || valStr.toUpperCase() === "SÍ" || valStr === "1"
            }

            const parseFloatSafe = (valStr: string | null) => {
                if (!valStr) return 0
                const parsed = parseFloat(valStr.replace(",", "."))
                return isNaN(parsed) ? 0 : parsed
            }

            const puntaje = parseFloatSafe(val(headers.indexOf("puntaje"))) || 0
            let nivel_puntaje = "Regular"
            if (puntaje >= 80) nivel_puntaje = "Premium"
            else if (puntaje < 40) nivel_puntaje = "Riesgo"

            const cliente = {
                nombre_razon_social: val(nameIndex),
                cuit: val(headers.indexOf("cuit")),
                direccion: val(headers.indexOf("direccion")),
                provincia: val(headers.indexOf("provincia")),
                telefono: val(headers.indexOf("telefono")),
                mail: val(headers.indexOf("mail")),
                condicion_iva: val(headers.indexOf("condicion_iva")) || "Consumidor Final",
                metodo_facturacion: val(headers.indexOf("metodo_facturacion")) || "Factura",
                condicion_pago: val(headers.indexOf("condicion_pago")) || "Efectivo",
                tipo_canal: val(headers.indexOf("tipo_canal")) || "Minorista",
                nro_iibb: val(headers.indexOf("nro_iibb")),
                exento_iibb: parseBool(val(headers.indexOf("exento_iibb"))),
                exento_iva: parseBool(val(headers.indexOf("exento_iva"))),
                percepcion_iibb: parseFloatSafe(val(headers.indexOf("percepcion_iibb"))),
                puntaje: puntaje,
                nivel_puntaje: nivel_puntaje,
                activo: true,
                condicion_entrega: "entregamos_nosotros"
            }

            clientesToInsert.push(cliente)
        }

        if (clientesToInsert.length === 0) {
            return NextResponse.json({ error: "No se encontraron clientes válidos para importar." }, { status: 400 })
        }

        const supabase = createAdminClient()
        const { data, error } = await supabase.from("clientes").insert(clientesToInsert)

        if (error) {
            console.error("[Import Clientes ERROR]", error)
            return NextResponse.json({ error: `Error de BD: ${error.message}` }, { status: 500 })
        }

        return NextResponse.json({ success: true, count: clientesToInsert.length })

    } catch (error: any) {
        console.error("[Import Clientes Exception]", error)
        return NextResponse.json({ error: "Error procesando el archivo de importación. " + error.message }, { status: 500 })
    }
}
