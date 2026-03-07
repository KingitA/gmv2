import { ClienteCalc, ArticuloCalc, ConfigCalc } from "@/lib/types/sync"

// Constantes
const IVA_VENTAS_DEFAULT = 21.0
const IVA_MIXTO_DEFAULT = 10.5

// Función auxiliar para redondear
function redondear(valor: number): number {
    return Math.round(valor)
}

/**
 * Calcula el Precio de Venta Neto (Sin Impuestos)
 * Aplica Flete, Recargos por Puntaje y Comisión del Vendedor
 */
export function calcularPrecioVentaOffline(
    precioBase: number,
    cliente: ClienteCalc,
    categoriaArticulo: string
): { precioVentaNeto: number; desglose: any } {
    // 1. Flete de venta
    const fleteVentaMonto = cliente.retira_en_deposito ? 0 : precioBase * (cliente.porcentaje_flete / 100)

    // 2. Recargo por puntaje
    let recargoPorcentaje = 0
    switch (cliente.nivel_puntaje) {
        case "PREMIUM":
        case "REGULAR":
            recargoPorcentaje = 0
            break
        case "RIESGO":
            recargoPorcentaje = 5
            break
        case "CRITICO":
            recargoPorcentaje = 15
            break
    }
    const recargoPuntajeMonto = precioBase * (recargoPorcentaje / 100)

    // Precio antes de comisión
    const precioAntesComision = precioBase + fleteVentaMonto + recargoPuntajeMonto

    // 3. Comisión del Vendedor
    // Normalizamos categoría para búsqueda simple
    const cat = categoriaArticulo.toUpperCase()
    const comisionPorcentaje = cat.includes("PERFUMERIA")
        ? cliente.comisiones.perfumeria
        : cliente.comisiones.bazar_limpieza

    // Fórmula: Precio / (1 - comision%) para que la comisión sea sobre el total
    // Ejemplo: Si quiero ganar 100 y comision 10%, cobro 111.11. El 10% de 111.11 es 11.11. Quedan 100.
    const precioVentaNeto = precioAntesComision / (1 - comisionPorcentaje / 100)
    const comisionMonto = precioVentaNeto - precioAntesComision

    return {
        precioVentaNeto,
        desglose: {
            flete_venta_monto: fleteVentaMonto,
            recargo_puntaje_porcentaje: recargoPorcentaje,
            recargo_puntaje_monto: recargoPuntajeMonto,
            precio_antes_comision: precioAntesComision,
            comision_vendedor_porcentaje: comisionPorcentaje,
            comision_vendedor_monto: comisionMonto,
        },
    }
}

/**
 * Calcula el Precio Final (Con Impuestos)
 */
export function calcularPrecioFinalOffline(
    precioVentaNeto: number,
    articulo: ArticuloCalc,
    cliente: ClienteCalc,
    config: ConfigCalc // Opcional, o defaults
): { precioFinal: number; precioFinalRedondeado: number; desglose: any } {
    let impuestosMonto = 0
    let tipoImpuesto = ""

    const ivaVentasPct = config?.iva_ventas_porcentaje || IVA_VENTAS_DEFAULT
    const ivaMixtoPct = config?.iva_mixto_porcentaje || IVA_MIXTO_DEFAULT

    // Lógica de Impuestos (Simplificada de pricing.ts original)
    // Casos principales basados en iva_compras vs iva_ventas

    const ivaCompras = articulo.iva_compras || "factura"
    const ivaVentas = articulo.iva_ventas || "factura"

    if (ivaVentas === "presupuesto") {
        // PRESUPUESTO
        if (ivaCompras === "mixto") {
            // +10.5% IVA incluido
            const precioConIva = precioVentaNeto * (1 + ivaMixtoPct / 100)
            impuestosMonto = precioConIva - precioVentaNeto
            tipoImpuesto = `IVA ${ivaMixtoPct}% incluido`
        } else if (ivaCompras === "adquisicion_stock") {
            // Sin impuestos adicionales
            impuestosMonto = 0
            tipoImpuesto = "Sin impuestos"
        } else {
            // Factura -> Presupuesto: +21% (Normalmente)
            const precioConIva = precioVentaNeto * (1 + ivaVentasPct / 100)
            impuestosMonto = precioConIva - precioVentaNeto
            tipoImpuesto = `IVA ${ivaVentasPct}% incluido`
        }
    } else {
        // FACTURA ("factura")
        // Se discrimina IVA y Percepciones si corresponde
        let tasaIva = ivaVentasPct

        // Calcular IVA
        if (!cliente.exento_iva) {
            impuestosMonto += precioVentaNeto * (tasaIva / 100)
        }

        // Calcular Percepción IIBB
        if (!cliente.exento_iibb) {
            impuestosMonto += precioVentaNeto * (cliente.percepcion_iibb / 100)
        }

        tipoImpuesto = `IVA ${tasaIva}% discriminado + percepciones`
    }

    const precioFinal = precioVentaNeto + impuestosMonto
    const precioFinalRedondeado = redondear(precioFinal)

    return {
        precioFinal,
        precioFinalRedondeado,
        desglose: {
            impuestos_monto: impuestosMonto,
            tipo_impuesto: tipoImpuesto
        }
    }
}

/**
 * Función Maestra para Cliente/Offline
 * Toma el Precio Base (que viene del servidor) y aplicas las reglas del cliente
 */
export function calcularPrecioCliente(
    articulo: ArticuloCalc,
    cliente: ClienteCalc,
    config: ConfigCalc
) {
    // 1. Calcular Precio Venta (Flete + Comision + Recargos)
    const { precioVentaNeto, desglose: desgloseVenta } = calcularPrecioVentaOffline(
        articulo.precio_base,
        cliente,
        articulo.categoria
    )

    // 2. Calcular Precio Final (Impuestos)
    const { precioFinal, precioFinalRedondeado, desglose: desgloseFinal } = calcularPrecioFinalOffline(
        precioVentaNeto,
        articulo,
        cliente,
        config
    )

    return {
        precio_base: articulo.precio_base,
        precio_venta_neto: precioVentaNeto,
        precio_final: precioFinal,
        precio_final_redondeado: precioFinalRedondeado,
        desglose: {
            ...desgloseVenta,
            ...desgloseFinal
        }
    }
}
