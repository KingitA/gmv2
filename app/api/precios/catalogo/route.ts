import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireAuth } from '@/lib/auth'

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

export async function GET(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("cliente_id")
    const vendedorId = searchParams.get("vendedor_id")
    const incluirDesglose = searchParams.get("incluir_desglose") === "true"

    if (!clienteId && !vendedorId) {
      return NextResponse.json({ error: "Se requiere cliente_id o vendedor_id" }, { status: 400, headers: corsHeaders })
    }

    let supabase
    try {
      supabase = await createClient()
    } catch (dbError) {
      console.error("[v0] Error conectando a Supabase:", dbError)
      return NextResponse.json(
        { error: "Error de conexión a base de datos", detalle: String(dbError) },
        { status: 503, headers: corsHeaders },
      )
    }

    if (clienteId) {
      try {
        const resultado = await calcularPreciosParaCliente(supabase, clienteId, incluirDesglose)
        return NextResponse.json(resultado, { headers: corsHeaders })
      } catch (calculoError) {
        console.error("[v0] Error calculando precios para cliente:", calculoError)
        return NextResponse.json(
          {
            id: clienteId,
            nombre: "Error al calcular precios",
            articulos: [],
            metadata: {},
            error: String(calculoError),
          },
          { status: 200, headers: corsHeaders },
        )
      }
    }

    if (vendedorId) {
      try {
        const { data: clientes, error: clientesError } = await supabase
          .from("clientes")
          .select("id, nombre")
          .eq("vendedor_id", vendedorId)
          .eq("activo", true)

        if (clientesError) {
          console.error("[v0] Error obteniendo clientes:", clientesError)
          return NextResponse.json(
            { error: "Error obteniendo clientes del vendedor", detalle: String(clientesError) },
            { status: 500, headers: corsHeaders },
          )
        }

        if (!clientes || clientes.length === 0) {
          return NextResponse.json(
            {
              vendedor_id: vendedorId,
              clientes: [],
              mensaje: "No se encontraron clientes para este vendedor",
            },
            { headers: corsHeaders },
          )
        }

        const resultados = await Promise.all(
          clientes.map(async (cliente) => {
            try {
              return await calcularPreciosParaCliente(supabase, cliente.id, incluirDesglose)
            } catch (error) {
              console.error(`[v0] Error calculando precios para cliente ${cliente.id}:`, error)
              return {
                id: cliente.id,
                nombre: cliente.nombre,
                articulos: [],
                metadata: {},
                error: String(error),
              }
            }
          }),
        )

        return NextResponse.json(
          {
            vendedor_id: vendedorId,
            clientes: resultados,
            total_clientes: resultados.length,
          },
          { headers: corsHeaders },
        )
      } catch (vendedorError) {
        console.error("[v0] Error procesando vendedor:", vendedorError)
        return NextResponse.json(
          { error: "Error procesando vendedor", detalle: String(vendedorError) },
          { status: 500, headers: corsHeaders },
        )
      }
    }
  } catch (error) {
    console.error("[v0] Error crítico en endpoint de precios:", error)
    return NextResponse.json(
      { error: "Error interno del servidor", detalle: String(error) },
      { status: 500, headers: corsHeaders },
    )
  }

  return NextResponse.json({ error: "Solicitud inválida" }, { status: 400, headers: corsHeaders })
}

async function calcularPreciosParaCliente(supabase: any, clienteId: string, incluirDesglose: boolean) {
  try {
    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", clienteId)
      .single()

    if (clienteError) {
      console.error("[v0] Error al buscar cliente:", clienteError)
    }

    if (!cliente) {
      return {
        id: clienteId,
        nombre: "Cliente no encontrado",
        articulos: [],
        metadata: {},
      }
    }

    let localidad = null
    let zona = null
    let vendedorInfo = null

    if (cliente.localidad_id) {
      const { data: localidadData } = await supabase
        .from("localidades")
        .select("*, zonas(*)")
        .eq("id", cliente.localidad_id)
        .single()

      localidad = localidadData
      zona = localidadData?.zonas
    }

    if (cliente.vendedor_id) {
      const { data: vendedorData } = await supabase
        .from("vendedores_info")
        .select("*")
        .eq("usuario_id", cliente.vendedor_id)
        .single()

      vendedorInfo = vendedorData
    }

    console.log("[v0] Cliente encontrado:", cliente.nombre)
    console.log("[v0] Zona del cliente:", zona?.nombre || "Sin zona")

    const { data: config } = await supabase.from("configuracion_precios").select("*").single()
    const gastos_operativos = config?.gastos_operativos || 3

    const { data: articulos, error: articulosError } = await supabase
      .from("articulos")
      .select("*, proveedores(*)")
      .eq("activo", true)

    if (articulosError) {
      console.error("[v0] Error obteniendo artículos:", articulosError)
      return {
        id: clienteId,
        nombre: cliente.nombre,
        articulos: [],
        metadata: {
          lista_precio: "LISTA_A",
          condicion_venta: cliente.condicion_pago || "CONTADO",
          descuento_cliente: 0,
        },
        error: String(articulosError),
      }
    }

    console.log("[v0] Artículos activos encontrados:", articulos?.length || 0)

    if (!articulos || articulos.length === 0) {
      return {
        id: clienteId,
        nombre: cliente.nombre,
        articulos: [],
        metadata: {
          lista_precio: "LISTA_A",
          condicion_venta: cliente.condicion_pago || "CONTADO",
          descuento_cliente: 0,
        },
      }
    }

    const productosConPrecio = (articulos as any[]).map((articulo: any) => {
      try {
        let costoBruto = articulo.precio_compra || 0
        const d1 = articulo.descuento1 || 0
        const d2 = articulo.descuento2 || 0
        const d3 = articulo.descuento3 || 0
        const d4 = articulo.descuento4 || 0

        let descuentoTotalPorcentaje = 0

        if (articulo.proveedores?.tipo_descuento === "cascada") {
          costoBruto = costoBruto * (1 - d1 / 100)
          costoBruto = costoBruto * (1 - d2 / 100)
          costoBruto = costoBruto * (1 - d3 / 100)
          costoBruto = costoBruto * (1 - d4 / 100)
          descuentoTotalPorcentaje = (1 - costoBruto / (articulo.precio_compra || 1)) * 100
        } else {
          const descuentoTotal = d1 + d2 + d3
          costoBruto = costoBruto * (1 - descuentoTotal / 100)
          costoBruto = costoBruto * (1 - d4 / 100)
          descuentoTotalPorcentaje = descuentoTotal + d4
        }

        const iva = 21
        const fleteCompra = 0
        const costoFinal = costoBruto * (1 + iva / 100) * (1 + fleteCompra / 100)

        const ganancia = articulo.porcentaje_ganancia || 0
        const precioBase = costoBruto * (1 + ganancia / 100) * (1 + gastos_operativos / 100)

        let fleteVenta = 0
        if (cliente.retira_en_deposito) {
          fleteVenta = 0
        } else {
          fleteVenta = zona?.porcentaje_flete || 0
        }

        let recargoPuntaje = 0
        const puntajeCliente = cliente.puntaje || 0
        if (puntajeCliente < 50)
          recargoPuntaje = 15
        else if (puntajeCliente < 70) recargoPuntaje = 5

        let precioVenta = precioBase * (1 + fleteVenta / 100) * (1 + recargoPuntaje / 100)

        const categoriaArticulo = articulo.categoria?.toLowerCase() || ""

        let comisionVendedor = 0
        if (categoriaArticulo.includes("perfumeria")) {
          comisionVendedor = vendedorInfo?.comision_perfumeria || 0
        } else {
          comisionVendedor = vendedorInfo?.comision_bazar_limpieza || 0
        }

        precioVenta = precioVenta / (1 - comisionVendedor / 100)

        let precioFinal = precioVenta
        let impuestosPorcentaje = 0
        let impuestosAplicados = ""

        const ivaCompras = articulo.iva_compras || "factura"
        const ivaVentas = articulo.iva_ventas || "factura"

        if (ivaVentas === "factura") {
          const ivaVenta = 21
          const retencion = cliente.retencion_iibb || 0
          const percepcion = cliente.exento_percepciones ? 0 : cliente.percepcion_iibb || 0

          impuestosPorcentaje = ivaVenta + retencion + percepcion
          precioFinal = precioVenta * (1 + impuestosPorcentaje / 100)
          impuestosAplicados = `IVA ${ivaVenta}% + Ret ${retencion}% + Perc ${percepcion}%`
        } else if (ivaVentas === "presupuesto") {
          if (ivaCompras === "adquisicion_stock") {
            impuestosPorcentaje = 0
            precioFinal = precioVenta
            impuestosAplicados = "Sin impuestos"
          } else if (ivaCompras === "mixto") {
            impuestosPorcentaje = 10.5
            precioFinal = precioVenta * 1.105
            impuestosAplicados = "IVA 10.5% incluido"
          } else {
            impuestosPorcentaje = 21
            precioFinal = precioVenta * 1.21
            impuestosAplicados = "IVA 21% incluido"
          }
        }

        precioFinal = Math.round(precioFinal)

        const resultado: any = {
          id: articulo.id,
          sku: articulo.sku || "",
          descripcion: articulo.descripcion || "",
          categoria: articulo.categoria || "Sin categoría",
          precio_base: Math.round(precioBase),
          precio_final: precioFinal,
          descuento_aplicado: Math.round(descuentoTotalPorcentaje * 100) / 100,
          flete: Math.round(fleteVenta * 100) / 100,
          impuestos: Math.round(impuestosPorcentaje * 100) / 100,
          comision: Math.round(comisionVendedor * 100) / 100,
          stock_disponible: articulo.stock_actual || 0,
          unidades_por_bulto: articulo.unidades_por_bulto || 1,
        }

        if (incluirDesglose) {
          resultado.desglose = {
            paso1_costo_bruto: Math.round(costoBruto * 100) / 100,
            paso2_costo_final: Math.round(costoFinal * 100) / 100,
            paso3_precio_base: Math.round(precioBase * 100) / 100,
            paso4_precio_venta: Math.round(precioVenta * 100) / 100,
            paso5_precio_final: precioFinal,
            descuentos: { d1, d2, d3, d4 },
            tipo_descuento: articulo.proveedores?.tipo_descuento || "cascada",
            ganancia_porcentaje: ganancia,
            flete_venta_porcentaje: fleteVenta,
            recargo_puntaje_porcentaje: recargoPuntaje,
            comision_vendedor_porcentaje: comisionVendedor,
            impuestos_aplicados: impuestosAplicados,
            retira_deposito: cliente.retira_en_deposito,
            zona: zona?.nombre || "Sin zona",
          }
        }

        return resultado
      } catch (articuloError) {
        console.error(`[v0] Error calculando precio de artículo ${articulo.id}:`, articuloError)
        return {
          id: articulo.id,
          sku: articulo.sku || "",
          descripcion: articulo.descripcion || "",
          categoria: "Error",
          precio_base: 0,
          precio_final: 0,
          descuento_aplicado: 0,
          flete: 0,
          impuestos: 0,
          comision: 0,
          stock_disponible: 0,
          unidades_por_bulto: 1,
          error: String(articuloError),
        }
      }
    })

    console.log("[v0] Productos con precio calculados:", productosConPrecio.length)

    return {
      id: clienteId,
      nombre: cliente.nombre || "Sin nombre",
      articulos: productosConPrecio,
      metadata: {
        lista_precio: "LISTA_A",
        condicion_venta: cliente.condicion_pago || "CONTADO",
        descuento_cliente: 0,
      },
    }
  } catch (error) {
    console.error("[v0] Error crítico en calcularPreciosParaCliente:", error)
    return {
      id: clienteId,
      nombre: "Error al procesar cliente",
      articulos: [],
      metadata: {},
      error: String(error),
    }
  }
}
