export const dynamic = 'force-dynamic'
"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Search, Save, Upload } from "lucide-react"
import type { Articulo, Proveedor } from "@/lib/types"
import { ImportPriceListDialog } from "@/components/articulos/ImportPriceListDialog"

export default function PreciosArticulosPage() {
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [proveedorFiltro, setProveedorFiltro] = useState<string>("todos")
  const [articulosEditados, setArticulosEditados] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadProveedores()
    loadArticulos()
  }, [proveedorFiltro])

  const loadProveedores = async () => {
    const { data } = await supabase.from("proveedores").select("*").eq("activo", true).order("nombre")
    if (data) setProveedores(data)
  }

  const loadArticulos = async () => {
    let query = supabase.from("articulos").select("*, proveedor:proveedores(nombre)").eq("activo", true)

    if (proveedorFiltro !== "todos") {
      query = query.eq("proveedor_id", proveedorFiltro)
    }

    const { data } = await query.order("descripcion")
    if (data) setArticulos(data)
  }

  const actualizarPrecio = (articuloId: string, campo: keyof Articulo, valor: number) => {
    setArticulos((prev) => prev.map((art) => (art.id === articuloId ? { ...art, [campo]: valor } : art)))
    setArticulosEditados((prev) => new Set(prev).add(articuloId))
  }

  const guardarCambios = async () => {
    const articulosParaActualizar = articulos.filter((art) => articulosEditados.has(art.id))

    for (const articulo of articulosParaActualizar) {
      const { error } = await supabase
        .from("articulos")
        .update({
          precio_compra: articulo.precio_compra,
          descuento1: articulo.descuento1,
          descuento2: articulo.descuento2,
          descuento3: articulo.descuento3,
          descuento4: articulo.descuento4,
        })
        .eq("id", articulo.id)

      if (error) {
        alert(`Error al actualizar ${articulo.descripcion}: ${error.message}`)
        return
      }
    }

    alert(`${articulosParaActualizar.length} artículos actualizados exitosamente`)
    setArticulosEditados(new Set())
  }

  const calcularPrecioNeto = (articulo: Articulo) => {
    let precio = articulo.precio_compra || 0
    precio = precio * (1 - (articulo.descuento1 || 0) / 100)
    precio = precio * (1 - (articulo.descuento2 || 0) / 100)
    precio = precio * (1 - (articulo.descuento3 || 0) / 100)
    precio = precio * (1 - (articulo.descuento4 || 0) / 100)
    return precio
  }

  const articulosFiltrados = articulos.filter(
    (art) =>
      art.descripcion.toLowerCase().includes(searchTerm.toLowerCase()) ||
      art.sku.includes(searchTerm) ||
      (art.ean13 && art.ean13.includes(searchTerm)),
  )

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Gestión de Precios</h1>
        <div className="flex gap-2">
          <ImportPriceListDialog
            proveedores={proveedores}
            onImportSuccess={(updates) => {
              const nuevosArticulos = [...articulos]
              const updatesMap = new Map(updates.map(u => [u.articulo_id, u]))

              let count = 0
              const updatedIds = new Set(articulosEditados)

              const updatedList = nuevosArticulos.map(art => {
                if (updatesMap.has(art.id)) {
                  const update: any = updatesMap.get(art.id)
                  count++
                  updatedIds.add(art.id)
                  return {
                    ...art,
                    precio_compra: update.precio_compra,
                    descuento1: update.descuento1
                    // Add more fields if implemented
                  }
                }
                return art
              })

              setArticulos(updatedList)
              setArticulosEditados(updatedIds)
              alert(`Se aplicaron ${count} actualizaciones. Revisá los cambios resaltados y guardá.`)
            }}
          />
          <Button onClick={guardarCambios} disabled={articulosEditados.size === 0}>
            <Save className="mr-2 h-4 w-4" />
            Guardar Cambios ({articulosEditados.size})
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Proveedor</Label>
              <Select value={proveedorFiltro} onValueChange={setProveedorFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los proveedores</SelectItem>
                  {proveedores.map((prov) => (
                    <SelectItem key={prov.id} value={prov.id}>
                      {prov.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Buscar artículo</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Buscar por descripción, SKU o EAN13..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="min-w-[250px]">Artículo</TableHead>
                  <TableHead className="w-40">Proveedor</TableHead>
                  <TableHead className="w-40">Precio Base</TableHead>
                  <TableHead className="w-32">D1 %</TableHead>
                  <TableHead className="w-32">D2 %</TableHead>
                  <TableHead className="w-32">D3 %</TableHead>
                  <TableHead className="w-32">D4 %</TableHead>
                  <TableHead className="w-40">Precio Neto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articulosFiltrados.map((articulo) => {
                  const editado = articulosEditados.has(articulo.id)
                  return (
                    <TableRow key={articulo.id} className={editado ? "bg-yellow-50" : ""}>
                      <TableCell className="min-w-[250px]">
                        <div className="font-medium">{articulo.descripcion}</div>
                        <div className="text-sm text-muted-foreground">
                          SKU: {articulo.sku}
                          {articulo.ean13 && ` | EAN: ${articulo.ean13}`}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{articulo.proveedor?.nombre || "-"}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={articulo.precio_compra || ""}
                          onChange={(e) =>
                            actualizarPrecio(articulo.id, "precio_compra", Number.parseFloat(e.target.value) || 0)
                          }
                          className={`w-full ${editado ? "border-yellow-500" : ""}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={articulo.descuento1 || ""}
                          onChange={(e) =>
                            actualizarPrecio(articulo.id, "descuento1", Number.parseFloat(e.target.value) || 0)
                          }
                          className={`w-full ${editado ? "border-yellow-500" : ""}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={articulo.descuento2 || ""}
                          onChange={(e) =>
                            actualizarPrecio(articulo.id, "descuento2", Number.parseFloat(e.target.value) || 0)
                          }
                          className={`w-full ${editado ? "border-yellow-500" : ""}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={articulo.descuento3 || ""}
                          onChange={(e) =>
                            actualizarPrecio(articulo.id, "descuento3", Number.parseFloat(e.target.value) || 0)
                          }
                          className={`w-full ${editado ? "border-yellow-500" : ""}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={articulo.descuento4 || ""}
                          onChange={(e) =>
                            actualizarPrecio(articulo.id, "descuento4", Number.parseFloat(e.target.value) || 0)
                          }
                          className={`w-full ${editado ? "border-yellow-500" : ""}`}
                        />
                      </TableCell>
                      <TableCell className="font-bold text-green-600">
                        ${calcularPrecioNeto(articulo).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {articulosFiltrados.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No se encontraron artículos con los filtros aplicados
        </div>
      )}
    </div>
  )
}

