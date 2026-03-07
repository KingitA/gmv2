"use server"

import { createClient } from "@/lib/supabase/server"
import { ClienteOffline, ProductoOffline, ConfiguracionOffline } from "@/lib/types/sync"
import { calcularPrecioBase } from "@/lib/pricing"
import { nowArgentina } from "@/lib/utils" // Usamos la del server que tiene la logica de costo

export async function getSyncData(vendedorId?: string) {
    const supabase = await createClient()

    // 1. Obtener Configuración Global
    let { data: configData } = await supabase.from("configuracion_precios").select("*").limit(1).single()

    const config: ConfiguracionOffline = {
        iva_ventas_porcentaje: configData?.iva_ventas_porcentaje || 21.0,
        iva_mixto_porcentaje: configData?.iva_mixto_porcentaje || 10.5
    }

    const gastosOperativos = configData?.porcentaje_gastos_operativos || 3.0
    const ivaComprasGlobal = configData?.iva_compras_porcentaje || 21.0 // Solo referencial si faltara en articulo

    // 2. Obtener Productos (Todos los activos)
    // Optimizamos la query para traer solo lo necesario
    const { data: articulos } = await supabase
        .from("articulos")
        .select(`
      id, sku, descripcion, precio_compra, 
      descuento1, descuento2, descuento3, descuento4, 
      porcentaje_ganancia, iva_compras, iva_ventas,
      stock_actual, unidad_medida,
      proveedor:proveedores(tipo_descuento),
      categoria:categorias(nombre)
    `)
        .eq("activo", true)

    const productos: ProductoOffline[] = (articulos || []).map(a => {
        // Pre-calcular Precio Base (Server Side)
        // Esto es CLAVE: El telefono no calcula desde precio lista proveedor.
        // El telefono arranca del "Precio Base" (Costo + Ganancia + Gastos).

        // a. Costo Bruto
        let precio = a.precio_compra || 0
        const d = {
            d1: a.descuento1 || 0, d2: a.descuento2 || 0, d3: a.descuento3 || 0, d4: a.descuento4 || 0
        }

        // Safely access proveedor (could be array or object depending on supabase types)
        const prov = Array.isArray(a.proveedor) ? a.proveedor[0] : a.proveedor
        const tipoDesc = prov?.tipo_descuento || "cascada"

        // Safely access categoria
        const cat = Array.isArray(a.categoria) ? a.categoria[0] : a.categoria
        const catNombre = cat?.nombre || "General"

        if (tipoDesc === "cascada") {
            if (d.d1 > 0) precio = precio * (1 - d.d1 / 100)
            if (d.d2 > 0) precio = precio * (1 - d.d2 / 100)
            if (d.d3 > 0) precio = precio * (1 - d.d3 / 100)
        } else {
            const sum = d.d1 + d.d2 + d.d3
            if (sum > 0) precio = precio * (1 - sum / 100)
        }
        // Descuento 4 siempre cascada
        if (d.d4 > 0) precio = precio * (1 - d.d4 / 100)
        const costoBruto = precio

        // b. Costo Final (Solo para saber, pero el precio base se calcula sobre bruto usualmente, 
        // segun pricing.ts calcularPrecioBase usa costoBruto)
        // Espera, check pricing.ts: calcularPrecioBase(costoBruto, ...)
        // Si, correcto.

        // c. Precio Base
        const ganancia = a.porcentaje_ganancia || 20
        const pBase = costoBruto * (1 + (ganancia + gastosOperativos) / 100)

        return {
            id: a.id,
            sku: a.sku,
            nombre: a.descripcion,
            descripcion: a.descripcion,
            precio_base: pBase,
            iva_compras: a.iva_compras || "factura",
            iva_ventas: a.iva_ventas || "factura",
            porcentaje_ganancia: ganancia,
            categoria: catNombre,
            stock_disponible: a.stock_actual || 0,
            unidad_medida: a.unidad_medida || "unidad"
        }
    })

    // 3. Obtener Clientes (Asignados al vendedor)
    // Si no se pasa vendedorId, traemos vacio o todos? Asumimos que viene filtered por row level security, 
    // pero mejor filtrar explicito si tenemos el ID.

    let queryClientes = supabase.from("clientes").select(`
    id, nombre, razon_social, condicion_pago,
    nivel_puntaje, retira_en_deposito, 
    exento_iva, exento_iibb, percepcion_iibb,
    vendedor_id,
    vendedor:vendedores(comision_perfumeria, comision_bazar_limpieza),
    localidad:localidades(
        id, nombre,
        zona:zonas(tipo_flete, porcentaje_flete, transporte:transportes(porcentaje_flete))
    )
  `)

    if (vendedorId) {
        queryClientes = queryClientes.eq("vendedor_id", vendedorId)
    }

    const { data: clientesData } = await queryClientes

    const clientes: ClienteOffline[] = (clientesData || []).map(c => {
        // 1. Resolver Flete
        let fletePorcentaje = 0

        const loc = Array.isArray(c.localidad) ? c.localidad[0] : c.localidad
        if (loc?.zona) {
            const zona = Array.isArray(loc.zona) ? loc.zona[0] : loc.zona

            // Transp could be further nested
            const transp = Array.isArray(zona.transporte) ? zona.transporte[0] : zona.transporte

            if (zona.tipo_flete === "transporte" && transp) {
                fletePorcentaje = transp.porcentaje_flete || 0
            } else if (zona.tipo_flete === "propio") {
                fletePorcentaje = zona.porcentaje_flete || 0
            }
        }

        const vend = Array.isArray(c.vendedor) ? c.vendedor[0] : c.vendedor
        const vendedor = vend || { comision_perfumeria: 0, comision_bazar_limpieza: 0 }

        return {
            id: c.id,
            nombre: c.nombre || c.razon_social || "Sin Nombre",
            condicion_venta: c.condicion_pago || "cta_cte",
            nivel_puntaje: c.nivel_puntaje || "REGULAR",
            retira_en_deposito: c.retira_en_deposito || false,
            exento_iva: c.exento_iva || false,
            exento_iibb: c.exento_iibb || false,
            percepcion_iibb: c.percepcion_iibb || 0,
            porcentaje_flete: fletePorcentaje,
            comisiones: {
                perfumeria: vendedor.comision_perfumeria || 0,
                bazar_limpieza: vendedor.comision_bazar_limpieza || 0
            }
        }
    })

    // 4. Retornar paquete
    // Timestamp para saber cuando fue la ultima actualizacion
    return {
        timestamp: nowArgentina(),
        config,
        productos,
        clientes
    }
}
