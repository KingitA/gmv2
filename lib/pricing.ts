// Sistema completo de cálculo de precios (Server Side)
// Orquesta la obtención de datos y delega el cálculo matemático a `pricing-calc.ts`

import { createClient } from "@/lib/supabase/server"
import {
  calcularPrecioVentaOffline,
  calcularPrecioFinalOffline,
} from "@/lib/pricing-calc"

// Importar interfaces viejas y re-exportarlas o mapearlas para compatibilidad
// Por simplicidad, re-definimos las interfaces del servidor aqui extendiendo o usando las de sync
import { ClienteCalc, ArticuloCalc, ConfigCalc } from "@/lib/types/sync"

// Interfaces Legadas (Server Side Full Data)
export interface ArticuloPrecio {
  id: string
  descripcion: string
  precio_compra: number
  descuento1: number
  descuento2: number
  descuento3: number
  descuento4: number
  porcentaje_ganancia: number
  iva_compras: "factura" | "adquisicion_stock" | "mixto"
  iva_ventas: "factura" | "presupuesto"
  proveedor_id: string
  categoria: string
  proveedor?: any
}

export interface ProveedorPrecio {
  id: string
  tipo_descuento: "cascada" | "sobre_lista"
  percepcion_iva: number
  percepcion_iibb: number
  retencion_ganancias: number
  retencion_iibb: number
}

export interface ClientePrecio {
  id: string
  nivel_puntaje: "PREMIUM" | "REGULAR" | "RIESGO" | "CRITICO"
  retira_en_deposito: boolean
  exento_iva: boolean
  exento_iibb: boolean
  percepcion_iibb: number
  vendedor_id: string
  nombre: string
  localidad?: any
  vendedor?: any
}

export interface VendedorPrecio {
  id: string
  comision_perfumeria: number
  comision_bazar_limpieza: number
  nombre: string
}

export interface ConfiguracionPrecios extends ConfigCalc {
  porcentaje_gastos_operativos: number
  iva_compras_porcentaje: number
  // Inherits iva_ventas_porcentaje, iva_mixto_porcentaje
}

export interface DesglosePrecio {
  // Costos
  precio_lista: number
  descuento1_monto: number
  descuento2_monto: number
  descuento3_monto: number
  descuento4_monto: number
  costo_bruto: number
  iva_compras_monto: number
  flete_compra_monto: number
  costo_final: number

  // Precio Base
  ganancia_monto: number
  gastos_operativos_monto: number
  precio_base: number

  // Precio Venta
  flete_venta_monto: number
  recargo_puntaje_porcentaje: number
  recargo_puntaje_monto: number
  precio_antes_comision: number
  comision_vendedor_porcentaje: number
  comision_vendedor_monto: number
  precio_venta_neto: number

  // Precio Final
  impuestos_monto: number
  tipo_impuesto: string
  precio_final: number
  precio_final_redondeado: number
}

// Constantes
const GASTOS_OPERATIVOS_DEFAULT = 3.0

// Función auxiliar para redondear
function redondear(valor: number): number {
  return Math.round(valor)
}

// PASO 1: Calcular Costo Bruto (Se mantiene aqui o se mueve, es logica de servidor principalmente para armar el precio base)
export function calcularCostoBruto(
  precioLista: number,
  descuentos: { d1: number; d2: number; d3: number; d4: number },
  tipoDescuento: "cascada" | "sobre_lista",
): { costoBruto: number; desglose: any } {
  let precio = precioLista
  const desglose = {
    precio_lista: precioLista,
    descuento1_monto: 0,
    descuento2_monto: 0,
    descuento3_monto: 0,
    descuento4_monto: 0,
  }

  if (tipoDescuento === "cascada") {
    // Descuentos en cascada
    if (descuentos.d1 > 0) {
      desglose.descuento1_monto = precio * (descuentos.d1 / 100)
      precio = precio * (1 - descuentos.d1 / 100)
    }
    if (descuentos.d2 > 0) {
      desglose.descuento2_monto = precio * (descuentos.d2 / 100)
      precio = precio * (1 - descuentos.d2 / 100)
    }
    if (descuentos.d3 > 0) {
      desglose.descuento3_monto = precio * (descuentos.d3 / 100)
      precio = precio * (1 - descuentos.d3 / 100)
    }
  } else {
    // Descuentos sobre precio lista
    const descuentoTotal = descuentos.d1 + descuentos.d2 + descuentos.d3
    if (descuentoTotal > 0) {
      const montoDescuento = precioLista * (descuentoTotal / 100)
      desglose.descuento1_monto = precioLista * (descuentos.d1 / 100)
      desglose.descuento2_monto = precioLista * (descuentos.d2 / 100)
      desglose.descuento3_monto = precioLista * (descuentos.d3 / 100)
      precio = precioLista - montoDescuento
    }
  }

  // Descuento 4 (fuera de factura) siempre se aplica sobre el precio actual
  if (descuentos.d4 > 0) {
    desglose.descuento4_monto = precio * (descuentos.d4 / 100)
    precio = precio * (1 - descuentos.d4 / 100)
  }

  return {
    costoBruto: precio,
    desglose,
  }
}

// PASO 2: Calcular Costo Final
export function calcularCostoFinal(
  costoBruto: number,
  ivaComprasPorcentaje: number,
  fletePorcentaje: number,
  proveedor: ProveedorPrecio,
): { costoFinal: number; desglose: any } {
  // Flete se calcula sobre el costo bruto (antes de impuestos)
  const fleteMonto = costoBruto * (fletePorcentaje / 100)

  // IVA se calcula sobre el costo bruto
  const ivaMonto = costoBruto * (ivaComprasPorcentaje / 100)

  // Percepciones y retenciones
  const percepcionIvaMonto = costoBruto * (proveedor.percepcion_iva / 100)
  const percepcionIibbMonto = costoBruto * (proveedor.percepcion_iibb / 100)
  const retencionGananciasMonto = costoBruto * (proveedor.retencion_ganancias / 100)
  const retencionIibbMonto = costoBruto * (proveedor.retencion_iibb / 100)

  const costoFinal =
    costoBruto +
    ivaMonto +
    percepcionIvaMonto +
    percepcionIibbMonto +
    retencionGananciasMonto +
    retencionIibbMonto +
    fleteMonto

  return {
    costoFinal,
    desglose: {
      costo_bruto: costoBruto,
      iva_compras_monto: ivaMonto,
      percepcion_iva_monto: percepcionIvaMonto,
      percepcion_iibb_monto: percepcionIibbMonto,
      retencion_ganancias_monto: retencionGananciasMonto,
      retencion_iibb_monto: retencionIibbMonto,
      flete_compra_monto: fleteMonto,
    },
  }
}

// PASO 3: Calcular Precio Base
export function calcularPrecioBase(
  costoBruto: number,
  porcentajeGanancia: number,
  porcentajeGastosOperativos: number = GASTOS_OPERATIVOS_DEFAULT,
): { precioBase: number; desglose: any } {
  const gananciaMonto = costoBruto * (porcentajeGanancia / 100)
  const gastosOperativosMonto = costoBruto * (porcentajeGastosOperativos / 100)
  const precioBase = costoBruto + gananciaMonto + gastosOperativosMonto

  return {
    precioBase,
    desglose: {
      ganancia_monto: gananciaMonto,
      gastos_operativos_monto: gastosOperativosMonto,
    },
  }
}

// PASO 4: Calcular Precio Venta (Wrapper Compatible)
export function calcularPrecioVenta(
  precioBase: number,
  cliente: ClientePrecio,
  vendedor: VendedorPrecio,
  fletePorcentaje: number,
  categoriaArticulo: string,
): { precioVentaNeto: number; desglose: any } {

  // Adaptador para usar la nueva logica shared
  const clienteCalc: ClienteCalc = {
    nivel_puntaje: cliente.nivel_puntaje,
    retira_en_deposito: cliente.retira_en_deposito,
    exento_iva: cliente.exento_iva,
    exento_iibb: cliente.exento_iibb,
    percepcion_iibb: cliente.percepcion_iibb,
    porcentaje_flete: fletePorcentaje,
    comisiones: {
      perfumeria: vendedor.comision_perfumeria,
      bazar_limpieza: vendedor.comision_bazar_limpieza
    }
  }

  return calcularPrecioVentaOffline(precioBase, clienteCalc, categoriaArticulo)
}

// PASO 5: Calcular Precio Final (Wrapper Compatible)
export function calcularPrecioFinal(
  precioVentaNeto: number,
  articulo: ArticuloPrecio,
  cliente: ClientePrecio,
  config: ConfiguracionPrecios,
): { precioFinal: number; precioFinalRedondeado: number; desglose: any } {

  // Adaptador
  const articuloCalc: ArticuloCalc = {
    id: articulo.id,
    precio_base: 0, // No se usa en este paso
    iva_compras: articulo.iva_compras,
    iva_ventas: articulo.iva_ventas,
    categoria: articulo.categoria
  }

  // cliente.vendedor_id es string, pero necesitamos las comisiones para ClienteCalc?
  // Espera, calcularPrecioFinalOffline no usa comisiones, solo flete y fiscales.
  // Ponemos valores dummy en comisiones.
  const clienteCalc: ClienteCalc = {
    nivel_puntaje: cliente.nivel_puntaje,
    retira_en_deposito: cliente.retira_en_deposito,
    exento_iva: cliente.exento_iva,
    exento_iibb: cliente.exento_iibb,
    percepcion_iibb: cliente.percepcion_iibb,
    porcentaje_flete: 0, // No se recalcula flete aqui
    comisiones: { perfumeria: 0, bazar_limpieza: 0 }
  }

  return calcularPrecioFinalOffline(precioVentaNeto, articuloCalc, clienteCalc, config)
}

// Función principal Servidor
export async function calcularPrecioCompleto(articuloId: string, clienteId: string): Promise<DesglosePrecio> {
  const supabase = await createClient()

  // 1. Obtener Datos (Articulo, Cliente, Config)

  // Articulo
  const { data: articulo, error: errorArticulo } = await supabase
    .from("articulos")
    .select(`
      *,
      proveedor:proveedores(*),
      categoria:categorias(nombre)
    `)
    .eq("id", articuloId)
    .single()
  if (errorArticulo || !articulo) throw new Error("Articulo no encontrado")

  // Cliente
  const { data: cliente, error: errorCliente } = await supabase
    .from("clientes")
    .select(`
      *,
      vendedor:vendedores(*),
      localidad:localidades(
        id, nombre,
        zona:zonas(tipo_flete, porcentaje_flete, transporte:transportes(porcentaje_flete))
      )
    `)
    .eq("id", clienteId)
    .single()
  if (errorCliente || !cliente) throw new Error("Cliente no encontrado")

  // Config
  let { data: config, error: errorConfig } = await supabase.from("configuracion_precios").select("*").limit(1).single()

  // Default Config si falla
  if (errorConfig || !config) {
    config = {
      porcentaje_gastos_operativos: 3.0, iva_compras_porcentaje: 21.0, iva_ventas_porcentaje: 21.0, iva_mixto_porcentaje: 10.5
    }
  }

  // 2. Resolver Flete
  let fletePorcentaje = 0
  if (cliente.localidad?.zona) {
    const zona = cliente.localidad.zona
    if (zona.tipo_flete === "transporte" && zona.transporte) {
      fletePorcentaje = zona.transporte.porcentaje_flete || 0
    } else if (zona.tipo_flete === "propio") {
      fletePorcentaje = zona.porcentaje_flete || 0
    }
  }

  // 3. Cálculos Server-Side (Costos y Base)

  // Costo Bruto
  const { costoBruto, desglose: desgloseCostoBruto } = calcularCostoBruto(
    articulo.precio_compra || 0,
    {
      d1: articulo.descuento1 || 0,
      d2: articulo.descuento2 || 0,
      d3: articulo.descuento3 || 0,
      d4: articulo.descuento4 || 0
    },
    articulo.proveedor?.tipo_descuento || "cascada"
  )

  // Costo Final
  const { costoFinal, desglose: desgloseCostoFinal } = calcularCostoFinal(
    costoBruto,
    config.iva_compras_porcentaje,
    0, // Flete compra no aplica aqui
    articulo.proveedor || { id: "", percepcion_iva: 0, percepcion_iibb: 0, retencion_ganancias: 0, retencion_iibb: 0 }
  )

  // Precio Base
  const { precioBase, desglose: desglosePrecioBase } = calcularPrecioBase(
    costoBruto,
    articulo.porcentaje_ganancia || 20,
    config.porcentaje_gastos_operativos
  )

  // 4. Cálculos Client-Side Compatible (Venta y Final)
  // Mapeamos a las interfeces 'Calc'
  const categoriaNombre = articulo.categoria?.nombre || articulo.categoria || "BAZAR Y LIMPIEZA"
  const vendedor = cliente.vendedor || { id: "", comision_perfumeria: 0, comision_bazar_limpieza: 0, nombre: "" }

  const clienteCalc: ClienteCalc = {
    nivel_puntaje: cliente.nivel_puntaje || "REGULAR",
    retira_en_deposito: cliente.retira_en_deposito || false,
    exento_iva: cliente.exento_iva || false,
    exento_iibb: cliente.exento_iibb || false,
    percepcion_iibb: cliente.percepcion_iibb || 0,
    porcentaje_flete: fletePorcentaje,
    comisiones: {
      perfumeria: vendedor.comision_perfumeria || 0,
      bazar_limpieza: vendedor.comision_bazar_limpieza || 0
    }
  }

  const { precioVentaNeto, desglose: desgloseVenta } = calcularPrecioVentaOffline(
    precioBase,
    clienteCalc,
    categoriaNombre
  )

  const articuloCalc: ArticuloCalc = {
    id: articulo.id,
    precio_base: precioBase,
    iva_compras: articulo.iva_compras || "factura",
    iva_ventas: articulo.iva_ventas || "factura",
    categoria: categoriaNombre
  }

  const { precioFinal, precioFinalRedondeado, desglose: desgloseFinal } = calcularPrecioFinalOffline(
    precioVentaNeto,
    articuloCalc,
    clienteCalc,
    config
  )

  // Retornar todo mezclado como antes
  return {
    ...desgloseCostoBruto,
    costo_bruto: costoBruto,
    ...desgloseCostoFinal,
    costo_final: costoFinal,
    ...desglosePrecioBase,
    precio_base: precioBase,
    ...desgloseVenta,
    precio_venta_neto: precioVentaNeto,
    ...desgloseFinal,
    precio_final: precioFinal,
    precio_final_redondeado: precioFinalRedondeado,
  }
}

// Mantener funcion de catalogo
export async function calcularPreciosCatalogo(clienteId: string): Promise<any[]> {
  const supabase = await createClient()
  const { data: articulos } = await supabase.from("articulos").select("id, descripcion, categoria").eq("activo", true)

  if (!articulos) return []

  const resultados = await Promise.all(
    articulos.map(async (a) => {
      try {
        const p = await calcularPrecioCompleto(a.id, clienteId)
        return {
          articulo_id: a.id,
          descripcion: a.descripcion,
          categoria: a.categoria,
          precio_final: p.precio_final_redondeado,
          desglose: p
        }
      } catch (e) {
        // console.error(e)
        return null
      }
    })
  )
  return resultados.filter(Boolean) as any[]
}
