"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Search, Package, User } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

type Articulo = {
  id: string
  descripcion: string
  categoria: string
  precio_compra: number
  descuento1: number
  descuento2: number
  descuento3: number
  descuento4: number
  porcentaje_ganancia: number
  iva_compras: string
  iva_ventas: string
  proveedor_id: string
}

type Cliente = {
  id: string
  nombre: string
  razon_social: string
  nivel_puntaje: string
  retira_deposito: boolean
  zona_id: string
  localidad_id: string
  vendedor_id: string
}

type DesglosePrecio = {
  precio_lista: number
  descuento1_monto: number
  descuento2_monto: number
  descuento3_monto: number
  descuento4_monto: number
  costo_bruto: number
  iva_compras_monto: number
  flete_compra_monto: number
  costo_final: number
  ganancia_monto: number
  gastos_operativos_monto: number
  precio_base: number
  flete_venta_monto: number
  recargo_puntaje_monto: number
  comision_vendedor_monto: number
  precio_venta_neto: number
  impuestos_monto: number
  precio_final: number
  precio_final_redondeado: string
}

export default function ConsultaPreciosPage() {
  const [busquedaArticulo, setBusquedaArticulo] = useState("")
  const [busquedaCliente, setBusquedaCliente] = useState("")
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [articuloSeleccionado, setArticuloSeleccionado] = useState<Articulo | null>(null)
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [desglose, setDesglose] = useState<DesglosePrecio | null>(null)
  const [loadingArticulos, setLoadingArticulos] = useState(false)
  const [loadingClientes, setLoadingClientes] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    const buscarArticulos = async () => {
      if (busquedaArticulo.length < 2) {
        setArticulos([])
        return
      }

      setLoadingArticulos(true)
      const { data, error } = await supabase
        .from("articulos")
        .select("*")
        .eq("activo", true)
        .ilike("descripcion", `%${busquedaArticulo}%`)
        .limit(10)

      if (error) {
        console.error("[v0] Error buscando artículos:", error)
      } else {
        setArticulos(data || [])
      }
      setLoadingArticulos(false)
    }

    const timer = setTimeout(buscarArticulos, 300)
    return () => clearTimeout(timer)
  }, [busquedaArticulo])

  useEffect(() => {
    const buscarClientes = async () => {
      if (busquedaCliente.length < 2) {
        setClientes([])
        return
      }

      setLoadingClientes(true)
      const { data, error } = await supabase
        .from("clientes")
        .select("*")
        .eq("activo", true)
        .or(`nombre.ilike.%${busquedaCliente}%,razon_social.ilike.%${busquedaCliente}%`)
        .limit(10)

      if (error) {
        console.error("[v0] Error buscando clientes:", error)
      } else {
        setClientes(data || [])
      }
      setLoadingClientes(false)
    }

    const timer = setTimeout(buscarClientes, 300)
    return () => clearTimeout(timer)
  }, [busquedaCliente])

  useEffect(() => {
    if (articuloSeleccionado && clienteSeleccionado) {
      calcularPrecio()
    } else {
      setDesglose(null)
    }
  }, [articuloSeleccionado, clienteSeleccionado])

  const calcularPrecio = async () => {
    if (!articuloSeleccionado || !clienteSeleccionado) return

    try {
      console.log("[v0] Calculando precio para:", {
        articulo: articuloSeleccionado.descripcion,
        cliente: clienteSeleccionado.nombre || clienteSeleccionado.razon_social,
      })

      const { data: proveedor } = await supabase
        .from("proveedores")
        .select("tipo_descuento")
        .eq("id", articuloSeleccionado.proveedor_id)
        .single()

      let porcentaje_flete_zona = 0
      if (clienteSeleccionado.localidad_id) {
        const { data: localidad } = await supabase
          .from("localidades")
          .select("zona_id, zonas(porcentaje_flete, tipo_flete)")
          .eq("id", clienteSeleccionado.localidad_id)
          .single()

        if (localidad?.zonas) {
          porcentaje_flete_zona = localidad.zonas.porcentaje_flete || 0
          console.log("[v0] Flete de zona:", porcentaje_flete_zona, "%")
        }
      }

      let comision_porcentaje = 6 // Default 6%
      if (clienteSeleccionado.vendedor_id) {
        const { data: vendedor } = await supabase
          .from("vendedores")
          .select("comision_perfumeria, comision_bazar_limpieza")
          .eq("id", clienteSeleccionado.vendedor_id)
          .single()

        if (vendedor) {
          const categoria = articuloSeleccionado.categoria?.toLowerCase() || ""
          if (categoria.includes("perfumeria") || categoria.includes("perfume")) {
            comision_porcentaje = vendedor.comision_perfumeria || 6
          } else {
            comision_porcentaje = vendedor.comision_bazar_limpieza || 6
          }
          console.log("[v0] Comisión vendedor:", comision_porcentaje, "%")
        }
      }

      // PASO 1: COSTO BRUTO
      const precio_lista = articuloSeleccionado.precio_compra
      let precio_con_descuentos = precio_lista

      if (proveedor?.tipo_descuento === "cascada") {
        // Descuentos en cascada
        precio_con_descuentos = precio_lista * (1 - (articuloSeleccionado.descuento1 || 0) / 100)
        precio_con_descuentos = precio_con_descuentos * (1 - (articuloSeleccionado.descuento2 || 0) / 100)
        precio_con_descuentos = precio_con_descuentos * (1 - (articuloSeleccionado.descuento3 || 0) / 100)
        precio_con_descuentos = precio_con_descuentos * (1 - (articuloSeleccionado.descuento4 || 0) / 100)
      } else {
        // Descuentos sobre precio lista
        const descuento_total =
          (articuloSeleccionado.descuento1 || 0) +
          (articuloSeleccionado.descuento2 || 0) +
          (articuloSeleccionado.descuento3 || 0) +
          (articuloSeleccionado.descuento4 || 0)
        precio_con_descuentos = precio_lista * (1 - descuento_total / 100)
      }

      const costo_bruto = precio_con_descuentos

      // PASO 2: COSTO FINAL
      const iva_compras_monto = costo_bruto * 0.21 // 21% IVA
      const flete_compra_monto = costo_bruto * 0.03 // 3% flete compra
      const costo_final = costo_bruto + iva_compras_monto + flete_compra_monto

      // PASO 3: PRECIO BASE
      const ganancia_monto = costo_bruto * ((articuloSeleccionado.porcentaje_ganancia || 0) / 100)
      const gastos_operativos_monto = costo_bruto * 0.03 // 3% gastos operativos
      const precio_base = costo_bruto + ganancia_monto + gastos_operativos_monto

      // PASO 4: PRECIO VENTA
      const flete_venta_monto = clienteSeleccionado.retira_deposito ? 0 : precio_base * (porcentaje_flete_zona / 100)

      console.log("[v0] Flete venta:", {
        retira_deposito: clienteSeleccionado.retira_deposito,
        porcentaje: porcentaje_flete_zona,
        monto: flete_venta_monto,
      })

      let recargo_puntaje_monto = 0
      const nivel = clienteSeleccionado.nivel_puntaje?.toUpperCase()
      if (nivel === "RIESGO") {
        recargo_puntaje_monto = precio_base * 0.05 // 5%
      } else if (nivel === "CRITICO") {
        recargo_puntaje_monto = precio_base * 0.15 // 15%
      }
      // PREMIUM y REGULAR no tienen recargo

      const subtotal = precio_base + flete_venta_monto + recargo_puntaje_monto
      const precio_venta_neto = subtotal / (1 - comision_porcentaje / 100)
      const comision_vendedor_monto = precio_venta_neto - subtotal

      // PASO 5: IMPUESTOS
      let impuestos_monto = 0
      const iva_compras = articuloSeleccionado.iva_compras
      const iva_ventas = articuloSeleccionado.iva_ventas

      if (iva_ventas === "factura") {
        impuestos_monto = precio_venta_neto * 0.21 // 21% IVA discriminado
      } else if (iva_ventas === "presupuesto") {
        if (iva_compras === "adquisicion_stock") {
          impuestos_monto = 0 // Sin impuestos
        } else if (iva_compras === "mixto") {
          impuestos_monto = precio_venta_neto * 0.105 // 10.5% IVA incluido
        } else {
          impuestos_monto = precio_venta_neto * 0.21 // 21% IVA incluido
        }
      }

      const precio_final = precio_venta_neto + impuestos_monto
      const precio_final_redondeado = Math.ceil(precio_final)

      console.log("[v0] Precio calculado:", precio_final_redondeado)

      setDesglose({
        precio_lista,
        descuento1_monto: precio_lista * ((articuloSeleccionado.descuento1 || 0) / 100),
        descuento2_monto: precio_lista * ((articuloSeleccionado.descuento2 || 0) / 100),
        descuento3_monto: precio_lista * ((articuloSeleccionado.descuento3 || 0) / 100),
        descuento4_monto: precio_lista * ((articuloSeleccionado.descuento4 || 0) / 100),
        costo_bruto,
        iva_compras_monto,
        flete_compra_monto,
        costo_final,
        ganancia_monto,
        gastos_operativos_monto,
        precio_base,
        flete_venta_monto,
        recargo_puntaje_monto,
        comision_vendedor_monto,
        precio_venta_neto,
        impuestos_monto,
        precio_final,
        precio_final_redondeado: `$${precio_final_redondeado}`,
      })
    } catch (error) {
      console.error("[v0] Error calculando precio:", error)
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6 normal-case">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Consulta de Precios</h1>
          <p className="text-muted-foreground">Busca artículos y clientes para ver el precio final en tiempo real</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Búsqueda de Artículos */}
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Buscar Artículo
            </CardTitle>
            <CardDescription>Escribe para buscar artículos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por descripción..."
                value={busquedaArticulo}
                onChange={(e) => setBusquedaArticulo(e.target.value)}
                className="pl-10"
              />
            </div>

            {loadingArticulos && <p className="text-sm text-muted-foreground">Buscando...</p>}

            {busquedaArticulo.length >= 2 && articulos.length === 0 && !loadingArticulos && (
              <p className="text-sm text-muted-foreground">No se encontraron artículos</p>
            )}

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {articulos.map((art) => (
                <div
                  key={art.id}
                  onClick={() => {
                    setArticuloSeleccionado(art)
                    setBusquedaArticulo(art.descripcion)
                    setArticulos([])
                  }}
                  className={`p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${
                    articuloSeleccionado?.id === art.id ? "bg-blue-50 border-blue-500" : ""
                  }`}
                >
                  <p className="font-medium">{art.descripcion}</p>
                  <p className="text-sm text-muted-foreground">{art.categoria}</p>
                </div>
              ))}
            </div>

            {articuloSeleccionado && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-medium text-green-800">✓ Artículo seleccionado</p>
                <p className="text-sm text-green-700">{articuloSeleccionado.descripcion}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Búsqueda de Clientes */}
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Buscar Cliente
            </CardTitle>
            <CardDescription>Escribe para buscar clientes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o razón social..."
                value={busquedaCliente}
                onChange={(e) => setBusquedaCliente(e.target.value)}
                className="pl-10"
              />
            </div>

            {loadingClientes && <p className="text-sm text-muted-foreground">Buscando...</p>}

            {busquedaCliente.length >= 2 && clientes.length === 0 && !loadingClientes && (
              <p className="text-sm text-muted-foreground">No se encontraron clientes</p>
            )}

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {clientes.map((cli) => (
                <div
                  key={cli.id}
                  onClick={() => {
                    setClienteSeleccionado(cli)
                    setBusquedaCliente(cli.nombre || cli.razon_social)
                    setClientes([])
                  }}
                  className={`p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${
                    clienteSeleccionado?.id === cli.id ? "bg-blue-50 border-blue-500" : ""
                  }`}
                >
                  <p className="font-medium">{cli.nombre || cli.razon_social}</p>
                  <p className="text-sm text-muted-foreground">Nivel: {cli.nivel_puntaje || "Regular"}</p>
                </div>
              ))}
            </div>

            {clienteSeleccionado && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-medium text-green-800">✓ Cliente seleccionado</p>
                <p className="text-sm text-green-700">
                  {clienteSeleccionado.nombre || clienteSeleccionado.razon_social}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Desglose de Precio */}
      {desglose && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Costos */}
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-lg">1. Costos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Precio Lista:</span>
                <span className="font-medium">${desglose.precio_lista.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>Descuento 1:</span>
                <span>-${desglose.descuento1_monto.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>Descuento 2:</span>
                <span>-${desglose.descuento2_monto.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>Descuento 3:</span>
                <span>-${desglose.descuento3_monto.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>Descuento 4:</span>
                <span>-${desglose.descuento4_monto.toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-semibold">
                <span>Costo Bruto:</span>
                <span>${desglose.costo_bruto.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-blue-600">
                <span>IVA Compras:</span>
                <span>+${desglose.iva_compras_monto.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-blue-600">
                <span>Flete Compra:</span>
                <span>+${desglose.flete_compra_monto.toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold text-lg">
                <span>Costo Final:</span>
                <span>${desglose.costo_final.toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Precio Base */}
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-lg">2. Precio Base</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Costo Bruto:</span>
                <span className="font-medium">${desglose.costo_bruto.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-green-600">
                <span>Ganancia:</span>
                <span>+${desglose.ganancia_monto.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-green-600">
                <span>Gastos Operativos:</span>
                <span>+${desglose.gastos_operativos_monto.toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold text-lg">
                <span>Precio Base:</span>
                <span>${desglose.precio_base.toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Precio Final */}
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-lg">3. Precio Final</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Precio Base:</span>
                <span className="font-medium">${desglose.precio_base.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-blue-600">
                <span>Flete Venta:</span>
                <span>+${desglose.flete_venta_monto.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-orange-600">
                <span>Recargo Puntaje:</span>
                <span>+${desglose.recargo_puntaje_monto.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-purple-600">
                <span>Comisión Vendedor:</span>
                <span>+${desglose.comision_vendedor_monto.toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-semibold">
                <span>Precio Venta Neto:</span>
                <span>${desglose.precio_venta_neto.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-blue-600">
                <span>Impuestos:</span>
                <span>+${desglose.impuestos_monto.toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold text-xl text-green-600">
                <span>PRECIO FINAL:</span>
                <span>{desglose.precio_final_redondeado}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}


