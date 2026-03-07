export interface ProductoOffline {
    id: string
    sku: string
    nombre: string
    descripcion: string
    // Datos Base para cálculo
    precio_base: number // Costo Base con ganancia y gastos ya aplicados (Precio Base en pricing.ts)
    iva_compras: "factura" | "adquisicion_stock" | "mixto"
    iva_ventas: "factura" | "presupuesto"
    porcentaje_ganancia: number
    categoria: string // Para comisiones
    stock_disponible: number
    unidad_medida: string

    // Datos crudos por si se necesita recalcular desde cero (opcional, para modo avanzado)
    // precio_compra: number
    // descuentos: { d1: number, d2: number, d3: number, d4: number }
}

export interface ClienteOffline {
    id: string
    nombre: string
    condicion_venta: string
    // Factores de Precio
    nivel_puntaje: "PREMIUM" | "REGULAR" | "RIESGO" | "CRITICO"
    retira_en_deposito: boolean
    exento_iva: boolean
    exento_iibb: boolean
    percepcion_iibb: number
    porcentaje_flete: number // Ya resuelto según zona/transporte
    comisiones: {
        perfumeria: number
        bazar_limpieza: number
    }
}

export interface ConfiguracionOffline {
    iva_ventas_porcentaje: number
    iva_mixto_porcentaje: number
    // Otros valores globales si son requeridos
}

// Interfaces usadas por el motor de cálculo (compatibles con lo que había en pricing.ts)
export interface ArticuloCalc {
    id: string
    precio_base: number // El precio base ya calculado por el servidor
    iva_compras: "factura" | "adquisicion_stock" | "mixto"
    iva_ventas: "factura" | "presupuesto"
    categoria: string
}

export interface ClienteCalc {
    nivel_puntaje: "PREMIUM" | "REGULAR" | "RIESGO" | "CRITICO"
    retira_en_deposito: boolean
    exento_iva: boolean
    exento_iibb: boolean
    percepcion_iibb: number
    porcentaje_flete: number
    comisiones: {
        perfumeria: number
        bazar_limpieza: number
    }
}

export interface ConfigCalc {
    iva_ventas_porcentaje: number
    iva_mixto_porcentaje: number
}
