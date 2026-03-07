"use client"

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Plus, Package, PackageOpen } from "lucide-react"
import type { PrecioArticulo } from "@/lib/api/erp-client"

interface CatalogoProductosProps {
  productos: PrecioArticulo[]
  onAgregarAlCarrito: (articulo: PrecioArticulo, cantidad: number, es_bulto: boolean) => void
}

export function CatalogoProductos({ productos, onAgregarAlCarrito }: CatalogoProductosProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [categoriaFilter, setCategoriaFilter] = useState("all")
  const [cantidades, setCantidades] = useState<Record<string, { cantidad: number; es_bulto: boolean }>>({})

  const categorias = useMemo(() => {
    const cats = new Set(productos.map((p) => p.categoria).filter(Boolean))
    return Array.from(cats).sort()
  }, [productos])

  const filteredProductos = useMemo(() => {
    return productos.filter((producto) => {
      const matchesSearch =
        searchTerm === "" ||
        producto.descripcion?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        producto.sku?.toLowerCase().includes(searchTerm.toLowerCase())

      const matchesCategoria = categoriaFilter === "all" || producto.categoria === categoriaFilter

      return matchesSearch && matchesCategoria
    })
  }, [productos, searchTerm, categoriaFilter])

  const handleAgregar = (producto: PrecioArticulo) => {
    const config = cantidades[producto.articulo_id] || { cantidad: 1, es_bulto: false }
    onAgregarAlCarrito(producto, config.cantidad, config.es_bulto)
    setCantidades((prev) => ({ ...prev, [producto.articulo_id]: { cantidad: 1, es_bulto: false } }))
  }

  const setCantidad = (productoId: string, cantidad: number) => {
    setCantidades((prev) => ({
      ...prev,
      [productoId]: { ...prev[productoId], cantidad },
    }))
  }

  const toggleBulto = (productoId: string) => {
    setCantidades((prev) => ({
      ...prev,
      [productoId]: {
        cantidad: prev[productoId]?.cantidad || 1,
        es_bulto: !prev[productoId]?.es_bulto,
      },
    }))
  }

  if (productos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <PackageOpen className="h-16 w-16 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No hay productos disponibles</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          El ERP no está devolviendo productos activos. Verificá que haya artículos activos en el sistema o contactá al
          administrador para revisar la configuración del catálogo.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por descripción o SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            {categorias.map((cat) => (
              <SelectItem key={cat} value={cat || ""}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Products Grid */}
      <div className="grid gap-3">
        {filteredProductos.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No se encontraron productos con los filtros aplicados</p>
            <Button
              variant="link"
              onClick={() => {
                setSearchTerm("")
                setCategoriaFilter("all")
              }}
              className="mt-2"
            >
              Limpiar filtros
            </Button>
          </div>
        ) : (
          filteredProductos.map((producto) => {
            const config = cantidades[producto.articulo_id] || { cantidad: 1, es_bulto: false }
            return (
              <div key={producto.id} className="flex items-center gap-4 rounded-lg border border-border p-4">
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-medium">{producto.descripcion}</h4>
                      <p className="text-sm text-muted-foreground">SKU: {producto.sku}</p>
                      {producto.categoria && (
                        <Badge variant="outline" className="mt-1">
                          {producto.categoria}
                        </Badge>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">
                        ${producto.precio_final.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-muted-foreground">Stock: {producto.stock_disponible}</p>
                      {producto.unidades_por_bulto && (
                        <p className="text-xs text-muted-foreground">{producto.unidades_por_bulto} un/bulto</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={config.cantidad}
                    onChange={(e) => setCantidad(producto.articulo_id, Number.parseInt(e.target.value) || 1)}
                    className="w-20"
                  />
                  {producto.unidades_por_bulto && (
                    <Button
                      variant={config.es_bulto ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleBulto(producto.articulo_id)}
                    >
                      <Package className="h-4 w-4" />
                    </Button>
                  )}
                  <Button size="sm" onClick={() => handleAgregar(producto)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Mostrando {filteredProductos.length} de {productos.length} productos
      </p>
    </div>
  )
}
