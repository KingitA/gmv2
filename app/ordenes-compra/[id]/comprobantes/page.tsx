"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Plus, Trash2, Edit, Save, X } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Alert, AlertDescription } from "@/components/ui/alert"
import { nowArgentina, todayArgentina } from "@/lib/utils"

export default function CargarComprobantesPage() {
  const params = useParams()
  const router = useRouter()
  const ordenId = params.id as string

  const [orden, setOrden] = useState<any>(null)
  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)

  // Formulario
  const [tipoComprobante, setTipoComprobante] = useState<string>("FA")
  const [numeroComprobante, setNumeroComprobante] = useState("")
  const [fechaComprobante, setFechaComprobante] = useState(todayArgentina())
  const [totalFacturaDeclarado, setTotalFacturaDeclarado] = useState<number>(0)

  const [totalNeto, setTotalNeto] = useState<number>(0)
  const [totalIVA, setTotalIVA] = useState<number>(0)
  const [percepcionIVA, setPercepcionIVA] = useState<number>(0)
  const [percepcionIIBB, setPercepcionIIBB] = useState<number>(0)
  const [retencionGanancias, setRetencionGanancias] = useState<number>(0)
  const [mostrarConceptos, setMostrarConceptos] = useState(false)

  const [editNeto, setEditNeto] = useState<number>(0)
  const [editIVA, setEditIVA] = useState<number>(0)
  const [editPercepIVA, setEditPercepIVA] = useState<number>(0)
  const [editPercepIIBB, setEditPercepIIBB] = useState<number>(0)
  const [editRetGanancias, setEditRetGanancias] = useState<number>(0)

  const [nuevoDescuento1, setNuevoDescuento1] = useState<number>(0)
  const [nuevoDescuento2, setNuevoDescuento2] = useState<number>(0)
  const [nuevoDescuento3, setNuevoDescuento3] = useState<number>(0)
  const [nuevoDescuento4, setNuevoDescuento4] = useState<number>(0)

  const [ajustaStock, setAjustaStock] = useState<boolean>(false)

  const TIPOS_COMPROBANTE = [
    { value: "FA", label: "Factura A" },
    { value: "FB", label: "Factura B" },
    { value: "FC", label: "Factura C" },
    { value: "Adquisicion", label: "Adquisición (IVA 0%)" },
    { value: "Reversa", label: "Reversa (IVA 0%)" },
    { value: "NC", label: "Nota de Crédito" },
  ]

  useEffect(() => {
    loadOrden()
    loadComprobantes()
  }, [ordenId])

  useEffect(() => {
    if (totalFacturaDeclarado > 0 && orden) {
      calcularConceptos()
    }
  }, [totalFacturaDeclarado, tipoComprobante, orden])

  const loadOrden = async () => {
    const { data } = await supabase
      .from("ordenes_compra")
      .select("*, proveedor:proveedores(*)")
      .eq("id", ordenId)
      .single()

    if (data) setOrden(data)
  }

  const loadComprobantes = async () => {
    const { data } = await supabase
      .from("comprobantes_compra")
      .select("*")
      .eq("orden_compra_id", ordenId)
      .order("fecha_comprobante", { ascending: false })

    if (data) setComprobantes(data)
  }

  const calcularConceptos = () => {
    const tieneIVA = tipoComprobante !== "Adquisicion" && tipoComprobante !== "Reversa"

    if (tieneIVA) {
      const factorIVA = 0.21
      const factorPercepIVA = (orden?.proveedor?.percepcion_iva || 0) / 100
      const factorPercepIIBB = (orden?.proveedor?.percepcion_iibb || 0) / 100
      const factorRetGanancias = (orden?.proveedor?.retencion_ganancias || 0) / 100
      const factorTotal = 1 + factorIVA + factorPercepIVA + factorPercepIIBB + factorRetGanancias

      const neto = totalFacturaDeclarado / factorTotal
      setTotalNeto(neto)
      setTotalIVA(neto * factorIVA)
      setPercepcionIVA(neto * factorPercepIVA)
      setPercepcionIIBB(neto * factorPercepIIBB)
      setRetencionGanancias(neto * factorRetGanancias)
    } else {
      setTotalNeto(totalFacturaDeclarado)
      setTotalIVA(0)
      setPercepcionIVA(0)
      setPercepcionIIBB(0)
      setRetencionGanancias(0)
    }

    setMostrarConceptos(true)
  }

  const crearComprobante = async () => {
    if (!numeroComprobante.trim() || totalFacturaDeclarado <= 0) {
      alert("Completá todos los campos obligatorios")
      return
    }

    const { error } = await supabase.from("comprobantes_compra").insert({
      orden_compra_id: ordenId,
      tipo_comprobante: tipoComprobante,
      numero_comprobante: numeroComprobante,
      fecha_comprobante: fechaComprobante,
      proveedor_id: orden.proveedor_id,
      total_factura_declarado: totalFacturaDeclarado,
      total_neto: totalNeto,
      total_iva: totalIVA,
      percepcion_iva_monto: percepcionIVA,
      percepcion_iibb_monto: percepcionIIBB,
      retencion_ganancias_monto: retencionGanancias,
      total_calculado: 0,
      estado: "pendiente_recepcion",
      ajusta_stock: (tipoComprobante === "NC" || tipoComprobante === "Reversa") ? ajustaStock : true,
    })

    if (error) {
      alert(`Error: ${error.message}`)
      return
    }

    alert("Comprobante vinculado exitosamente")
    setMostrarFormulario(false)
    setNumeroComprobante("")
    setTotalFacturaDeclarado(0)
    setMostrarConceptos(false)
    setAjustaStock(false) // Reset checkbox
    loadComprobantes()
  }

  const iniciarEdicion = (comp: any) => {
    setEditandoId(comp.id)
    setEditNeto(comp.total_neto || 0)
    setEditIVA(comp.total_iva || 0)
    setEditPercepIVA(comp.percepcion_iva_monto || 0)
    setEditPercepIIBB(comp.percepcion_iibb_monto || 0)
    setEditRetGanancias(comp.retencion_ganancias_monto || 0)
  }

  const guardarEdicion = async (comprobanteId: string) => {
    const { error } = await supabase
      .from("comprobantes_compra")
      .update({
        total_neto: editNeto,
        total_iva: editIVA,
        percepcion_iva_monto: editPercepIVA,
        percepcion_iibb_monto: editPercepIIBB,
        retencion_ganancias_monto: editRetGanancias,
      })
      .eq("id", comprobanteId)

    if (error) {
      alert(`Error: ${error.message}`)
      return
    }

    setEditandoId(null)
    loadComprobantes()
  }

  const eliminarComprobante = async (comprobanteId: string) => {
    if (!confirm("¿Estás seguro de eliminar este comprobante? Esta acción no se puede deshacer.")) return

    console.log("[v0] Intentando eliminar comprobante:", comprobanteId)

    const { error } = await supabase.from("comprobantes_compra").delete().eq("id", comprobanteId)

    if (error) {
      console.error("[v0] Error al eliminar comprobante:", error)
      alert(`Error al eliminar: ${error.message}\n\nDetalles: ${error.hint || "Sin detalles adicionales"}`)
      return
    }

    console.log("[v0] Comprobante eliminado exitosamente")
    alert("Comprobante eliminado exitosamente")
    loadComprobantes()
  }

  if (!orden) return <div>Cargando...</div>

  const calcularDiferencia = () => {
    const suma = totalNeto + totalIVA + percepcionIVA + percepcionIIBB + retencionGanancias
    return totalFacturaDeclarado - suma
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Cargar Comprobantes</h1>
          <p className="text-muted-foreground">
            Orden: {orden.numero_orden} - Proveedor: {orden.proveedor?.nombre}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Comprobantes Vinculados ({comprobantes.length})</CardTitle>
            <Button onClick={() => setMostrarFormulario(!mostrarFormulario)}>
              <Plus className="h-4 w-4 mr-2" />
              Vincular Nuevo Comprobante
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {mostrarFormulario && (
            <Card className="bg-muted/50">
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Tipo de Comprobante *</Label>
                    <Select value={tipoComprobante} onValueChange={setTipoComprobante}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_COMPROBANTE.map((tipo) => (
                          <SelectItem key={tipo.value} value={tipo.value}>
                            {tipo.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Número de Comprobante *</Label>
                    <Input
                      placeholder="0001-00000001"
                      value={numeroComprobante}
                      onChange={(e) => setNumeroComprobante(e.target.value)}
                    />
                  </div>
                </div>

                {(tipoComprobante === "NC" || tipoComprobante === "Reversa") && (
                  <div className="flex items-center space-x-2 p-4 bg-amber-50 border border-amber-200 rounded-md">
                    <input
                      type="checkbox"
                      id="ajusta-stock"
                      checked={ajustaStock}
                      onChange={(e) => setAjustaStock(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="ajusta-stock" className="text-sm font-medium cursor-pointer">
                      Ajusta Stock (Marcar solo si devuelve mercadería físicamente)
                    </Label>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Fecha del Comprobante *</Label>
                    <Input type="date" value={fechaComprobante} onChange={(e) => setFechaComprobante(e.target.value)} />
                  </div>

                  <div>
                    <Label>Total de la Factura *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={totalFacturaDeclarado || ""}
                      onChange={(e) => setTotalFacturaDeclarado(Number.parseFloat(e.target.value))}
                    />
                  </div>
                </div>

                {mostrarConceptos && (
                  <div className="space-y-4 border-t pt-4">
                    <h3 className="font-semibold">Desglose de Conceptos (editables)</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Total Neto</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={totalNeto}
                          onChange={(e) => setTotalNeto(Number.parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div>
                        <Label>IVA 21%</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={totalIVA}
                          onChange={(e) => setTotalIVA(Number.parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div>
                        <Label>Percepción IVA</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={percepcionIVA}
                          onChange={(e) => setPercepcionIVA(Number.parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div>
                        <Label>Percepción IIBB</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={percepcionIIBB}
                          onChange={(e) => setPercepcionIIBB(Number.parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div>
                        <Label>Retención Ganancias</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={retencionGanancias}
                          onChange={(e) => setRetencionGanancias(Number.parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>

                    {Math.abs(calcularDiferencia()) > 0.01 && (
                      <Alert>
                        <AlertDescription>
                          Diferencia de redondeo: ${calcularDiferencia().toFixed(2)}
                          <br />
                          <span className="text-xs text-muted-foreground">
                            Suma de conceptos: $
                            {(totalNeto + totalIVA + percepcionIVA + percepcionIIBB + retencionGanancias).toFixed(2)} |
                            Total factura: ${totalFacturaDeclarado.toFixed(2)}
                          </span>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMostrarFormulario(false)
                      setMostrarConceptos(false)
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={crearComprobante}>Vincular Comprobante</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="w-32">Total Neto</TableHead>
                  <TableHead className="w-28">IVA 21%</TableHead>
                  <TableHead className="w-28">Percep. IVA</TableHead>
                  <TableHead className="w-28">Percep. IIBB</TableHead>
                  <TableHead className="w-28">Ret. Ganancias</TableHead>
                  <TableHead className="w-32 font-bold">Total Final</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comprobantes.map((comp) => {
                  const estaEditando = editandoId === comp.id
                  const totalFinal = comp.total_factura_declarado

                  return (
                    <TableRow key={comp.id}>
                      <TableCell>{comp.tipo_comprobante}</TableCell>
                      <TableCell className="font-medium">{comp.numero_comprobante}</TableCell>
                      <TableCell>{new Date(comp.fecha_comprobante).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>

                      <TableCell>
                        {estaEditando ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-full"
                            value={editNeto}
                            onChange={(e) => setEditNeto(Number.parseFloat(e.target.value) || 0)}
                          />
                        ) : (
                          `$${(comp.total_neto || 0).toFixed(2)}`
                        )}
                      </TableCell>

                      <TableCell>
                        {estaEditando ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-full"
                            value={editIVA}
                            onChange={(e) => setEditIVA(Number.parseFloat(e.target.value) || 0)}
                          />
                        ) : comp.total_iva > 0 ? (
                          `$${comp.total_iva.toFixed(2)}`
                        ) : (
                          "-"
                        )}
                      </TableCell>

                      <TableCell>
                        {estaEditando ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-full"
                            value={editPercepIVA}
                            onChange={(e) => setEditPercepIVA(Number.parseFloat(e.target.value) || 0)}
                          />
                        ) : comp.percepcion_iva_monto > 0 ? (
                          `$${comp.percepcion_iva_monto.toFixed(2)}`
                        ) : (
                          "-"
                        )}
                      </TableCell>

                      <TableCell>
                        {estaEditando ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-full"
                            value={editPercepIIBB}
                            onChange={(e) => setEditPercepIIBB(Number.parseFloat(e.target.value) || 0)}
                          />
                        ) : comp.percepcion_iibb_monto > 0 ? (
                          `$${comp.percepcion_iibb_monto.toFixed(2)}`
                        ) : (
                          "-"
                        )}
                      </TableCell>

                      <TableCell>
                        {estaEditando ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-full"
                            value={editRetGanancias}
                            onChange={(e) => setEditRetGanancias(Number.parseFloat(e.target.value) || 0)}
                          />
                        ) : comp.retencion_ganancias_monto > 0 ? (
                          `$${comp.retencion_ganancias_monto.toFixed(2)}`
                        ) : (
                          "-"
                        )}
                      </TableCell>

                      <TableCell className="font-bold text-primary">${totalFinal.toFixed(2)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {estaEditando ? (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => guardarEdicion(comp.id)}>
                                <Save className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setEditandoId(null)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => iniciarEdicion(comp)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => eliminarComprobante(comp.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-between text-lg">
              <span>Total NETO (sin impuestos):</span>
              <span className="font-semibold">
                ${comprobantes.reduce((sum, comp) => sum + (comp.total_neto || 0), 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-xl font-bold border-t pt-2">
              <span>Total FINAL con impuestos:</span>
              <span className="text-primary">
                ${comprobantes.reduce((sum, comp) => sum + comp.total_factura_declarado, 0).toFixed(2)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
