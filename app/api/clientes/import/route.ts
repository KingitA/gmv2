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

        // We expect at least one identifier column
        const hasName = headers.includes("nombre_razon_social") || headers.includes("nombre") || headers.includes("razon_social")
        const hasCode = headers.includes("codigo_cliente")
        const hasCuit = headers.includes("cuit")
        if (!hasName && !hasCode && !hasCuit) {
            return NextResponse.json({ error: "Falta columna clave: 'codigo_cliente', 'cuit', 'nombre' o 'nombre_razon_social'." }, { status: 400 })
        }

        const rows = rawData.slice(2)
        const procesadosBase = []

        for (const row of rows) {
            if (!row || row.length === 0) continue

            const val = (idx: number) => {
                if (idx === -1) return null
                return row[idx] !== undefined && row[idx] !== null && String(row[idx]).trim() !== "" ? String(row[idx]).trim() : null
            }

            const getHeaderVal = (headerName: string) => val(headers.indexOf(headerName))

            // Debe tener al menos uno de los tres identificadores
            const codigo_cliente = getHeaderVal("codigo_cliente")
            const cuit = getHeaderVal("cuit")
            // Aceptar "nombre_razon_social", "nombre" o "razon_social" como columna de nombre
            const nombre = getHeaderVal("nombre_razon_social") || getHeaderVal("nombre") || getHeaderVal("razon_social")

            if (!codigo_cliente && !cuit && !nombre) {
                continue
            }

            const parseBool = (valStr: string | null) => {
                if (!valStr) return false
                return valStr.toUpperCase() === "SI" || valStr.toUpperCase() === "SÍ" || valStr === "1" || valStr.toUpperCase() === "TRUE"
            }

            const parseFloatSafe = (valStr: string | null) => {
                if (!valStr) return 0
                const parsed = parseFloat(valStr.replace(",", "."))
                return isNaN(parsed) ? 0 : parsed
            }

            const puntaje = parseFloatSafe(getHeaderVal("puntaje")) || 0
            let nivel_puntaje = "Regular"
            if (puntaje >= 80) nivel_puntaje = "Premium"
            else if (puntaje < 40) nivel_puntaje = "Riesgo"

            const clienteData: any = {
                codigo_cliente,
                cuit,
            }
            // Llenar AMBOS campos de nombre en la DB si tenemos el dato
            if (nombre) {
                clienteData.nombre_razon_social = nombre
                clienteData.nombre = nombre
            }

            if (headers.includes("direccion")) clienteData.direccion = getHeaderVal("direccion")
            if (headers.includes("provincia")) clienteData.provincia = getHeaderVal("provincia")
            if (headers.includes("telefono")) clienteData.telefono = getHeaderVal("telefono")
            if (headers.includes("mail")) clienteData.mail = getHeaderVal("mail")
            if (headers.includes("condicion_iva")) clienteData.condicion_iva = getHeaderVal("condicion_iva")
            if (headers.includes("metodo_facturacion")) clienteData.metodo_facturacion = getHeaderVal("metodo_facturacion")
            if (headers.includes("condicion_pago")) clienteData.condicion_pago = getHeaderVal("condicion_pago")
            if (headers.includes("tipo_canal")) clienteData.tipo_canal = getHeaderVal("tipo_canal")
            if (headers.includes("nro_iibb")) clienteData.nro_iibb = getHeaderVal("nro_iibb")
            if (headers.includes("exento_iibb")) clienteData.exento_iibb = parseBool(getHeaderVal("exento_iibb"))
            if (headers.includes("exento_iva")) clienteData.exento_iva = parseBool(getHeaderVal("exento_iva"))
            if (headers.includes("percepcion_iibb")) clienteData.percepcion_iibb = parseFloatSafe(getHeaderVal("percepcion_iibb"))
            if (headers.includes("vendedor_id")) clienteData.vendedor_id = getHeaderVal("vendedor_id")
            if (headers.includes("localidad")) clienteData.localidad = getHeaderVal("localidad")
            if (headers.includes("localidad_id")) clienteData.localidad_id = getHeaderVal("localidad_id")
            if (headers.includes("observaciones")) clienteData.observaciones = getHeaderVal("observaciones")
            if (headers.includes("dias_credito")) clienteData.dias_credito = getHeaderVal("dias_credito") ? parseInt(getHeaderVal("dias_credito")!) : null
            if (headers.includes("limite_credito")) clienteData.limite_credito = parseFloatSafe(getHeaderVal("limite_credito")) || null
            if (headers.includes("descuento_especial")) clienteData.descuento_especial = parseFloatSafe(getHeaderVal("descuento_especial")) || null
            if (headers.includes("zona")) clienteData.zona = getHeaderVal("zona")
            if (headers.includes("puntaje")) {
                clienteData.puntaje = puntaje
                clienteData.nivel_puntaje = nivel_puntaje
            }

            procesadosBase.push(clienteData)
        }

        if (procesadosBase.length === 0) {
            return NextResponse.json({ error: "No se encontraron clientes válidos para importar." }, { status: 400 })
        }

        const supabase = createAdminClient()

        // Obtener clientes existentes para comparar
        // Usamos búsquedas separadas para evitar problemas con caracteres especiales en nombres
        const codigos = procesadosBase.map(c => c.codigo_cliente).filter(Boolean)
        const cuits = procesadosBase.map(c => c.cuit).filter(Boolean)

        let existingClientes: any[] = []

        // Buscar por codigo_cliente (seguro, son números/strings simples)
        if (codigos.length > 0) {
            const { data } = await supabase
                .from("clientes")
                .select("*")
                .in("codigo_cliente", codigos)
            if (data) existingClientes.push(...data)
        }

        // Buscar por CUIT (seguro, formato XX-XXXXXXXX-X)
        if (cuits.length > 0) {
            const existingIds = new Set(existingClientes.map(c => c.id))
            const { data } = await supabase
                .from("clientes")
                .select("*")
                .in("cuit", cuits)
            if (data) {
                for (const c of data) {
                    if (!existingIds.has(c.id)) existingClientes.push(c)
                }
            }
        }

        const fetchError = null // Errores se manejan individualmente arriba

        const existingMap = new Map()
        if (existingClientes) {
            existingClientes.forEach(c => {
                if (c.codigo_cliente) existingMap.set(`cod_${c.codigo_cliente}`, c)
                if (c.cuit) existingMap.set(`cuit_${c.cuit}`, c)
                if (c.nombre_razon_social) existingMap.set(`nombre_${c.nombre_razon_social}`, c)
            })
        }

        const toInsert: any[] = []
        const toUpdate: any[] = []

        for (const cliente of procesadosBase) {
            let existing = null
            if (cliente.codigo_cliente && existingMap.has(`cod_${cliente.codigo_cliente}`)) {
                existing = existingMap.get(`cod_${cliente.codigo_cliente}`)
            } else if (cliente.cuit && existingMap.has(`cuit_${cliente.cuit}`)) {
                existing = existingMap.get(`cuit_${cliente.cuit}`)
            } else if (cliente.nombre_razon_social && existingMap.has(`nombre_${cliente.nombre_razon_social}`)) {
                existing = existingMap.get(`nombre_${cliente.nombre_razon_social}`)
            }

            if (existing) {
                // Asegurar que nombre siempre esté presente al actualizar
                const updateData = { ...existing, ...cliente }
                if (!updateData.nombre && updateData.nombre_razon_social) {
                    updateData.nombre = updateData.nombre_razon_social
                }
                toUpdate.push(updateData)
            } else {
                // Nuevo cliente: Aplicamos defaults
                if (!cliente.nombre_razon_social && !cliente.nombre) {
                    // require nombre
                    continue
                }
                const nombreFinal = cliente.nombre_razon_social || cliente.nombre
                const newCliente = {
                    ...cliente,
                    nombre: nombreFinal,
                    nombre_razon_social: nombreFinal,
                    condicion_iva: cliente.condicion_iva || "Consumidor Final",
                    metodo_facturacion: cliente.metodo_facturacion || "Factura",
                    condicion_pago: cliente.condicion_pago || "Efectivo",
                    tipo_canal: cliente.tipo_canal || "Minorista",
                    exento_iibb: cliente.exento_iibb || false,
                    exento_iva: cliente.exento_iva || false,
                    percepcion_iibb: cliente.percepcion_iibb || 0,
                    puntaje: cliente.puntaje || 0,
                    nivel_puntaje: cliente.nivel_puntaje || "Regular",
                    activo: true,
                    condicion_entrega: "entregamos_nosotros"
                }
                toInsert.push(newCliente)
            }
        }

        let totalProcesados = 0

        if (toInsert.length > 0) {
            const { error: insertError } = await supabase.from("clientes").insert(toInsert)
            if (insertError) {
                console.error("[Import Clientes Insert ERROR]", insertError)
                return NextResponse.json({ error: `Error insertando: ${insertError.message}` }, { status: 500 })
            }
            totalProcesados += toInsert.length
        }

        if (toUpdate.length > 0) {
            const { error: updateError } = await supabase.from("clientes").upsert(toUpdate, { onConflict: "id" })
            if (updateError) {
                console.error("[Import Clientes Update ERROR]", updateError)
                return NextResponse.json({ error: `Error actualizando: ${updateError.message}` }, { status: 500 })
            }
            totalProcesados += toUpdate.length
        }

        return NextResponse.json({ success: true, count: totalProcesados, inserted: toInsert.length, updated: toUpdate.length })

    } catch (error: any) {
        console.error("[Import Clientes Exception]", error)
        return NextResponse.json({ error: "Error procesando el archivo de importación. " + error.message }, { status: 500 })
    }
}
