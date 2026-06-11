"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertTriangle, Upload, Loader2, CheckCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface JurisdiccionEstado {
  codigo: string
  nombre: string
  alicuota_general: number
  registros_total: number
  registros_vigentes: number
  vigencia_hasta: string | null
  vencido: boolean
}

export default function PadronIIBBPage() {
  const [estado, setEstado] = useState<JurisdiccionEstado[]>([])
  const [loading, setLoading] = useState(true)
  const [importando, setImportando] = useState(false)
  const [jurisdiccion, setJurisdiccion] = useState("")
  const [csv, setCsv] = useState("")
  const [reemplazar, setReemplazar] = useState(true)
  const { toast } = useToast()

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      const res = await fetch("/api/padron-iibb")
      const data = await res.json()
      setEstado(data.jurisdicciones ?? [])
      if (!jurisdiccion && data.jurisdicciones?.length) setJurisdiccion(data.jurisdicciones[0].codigo)
    } catch {
      toast({ title: "Error", description: "No se pudo cargar el estado del padrón", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  async function importar() {
    if (!jurisdiccion || !csv.trim()) {
      toast({ title: "Error", description: "Seleccioná jurisdicción y pegá el CSV", variant: "destructive" })
      return
    }
    setImportando(true)
    try {
      const res = await fetch("/api/padron-iibb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jurisdiccion, csv, reemplazar }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({
        title: "Padrón importado",
        description: `${data.importados} registros para ${data.jurisdiccion}${data.descartados ? ` · ${data.descartados} descartados` : ""}`,
      })
      setCsv("")
      cargar()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally {
      setImportando(false)
    }
  }

  const alertas = estado.filter(j => j.vencido || j.registros_total === 0)

  if (loading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">PADRÓN IIBB — ALÍCUOTAS DE PERCEPCIÓN</h1>
        <p className="text-muted-foreground">
          Padrón oficial por contribuyente para las jurisdicciones donde somos agentes de percepción.
          Prioridad de cálculo: override manual en ficha del cliente → padrón vigente → alícuota general.
        </p>
      </div>

      {alertas.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Atención: padrón desactualizado</AlertTitle>
          <AlertDescription>
            {alertas.map(j => (
              <p key={j.codigo}>
                {j.nombre}: {j.registros_total === 0
                  ? "sin padrón cargado — se usa la alícuota general"
                  : `padrón VENCIDO (última vigencia ${j.vigencia_hasta}) — se usa la alícuota general`}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {estado.map(j => (
          <Card key={j.codigo}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <CardTitle>{j.nombre} <span className="text-muted-foreground text-sm font-normal">CM {j.codigo}</span></CardTitle>
                {j.registros_vigentes > 0
                  ? <Badge className="bg-emerald-600"><CheckCircle className="h-3 w-3 mr-1" />Vigente</Badge>
                  : <Badge variant="destructive">{j.registros_total === 0 ? "Sin padrón" : "Vencido"}</Badge>}
              </div>
              <CardDescription>
                {j.registros_vigentes} CUITs vigentes de {j.registros_total} cargados
                {j.vigencia_hasta ? ` · vigencia hasta ${j.vigencia_hasta}` : ""}
                {` · alícuota general (fallback): ${j.alicuota_general}%`}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Importar padrón</CardTitle>
          <CardDescription>
            CSV con columnas: <code>cuit;alicuota;vigencia_desde;vigencia_hasta</code> (separador ; o ,).
            Ejemplo: <code>30710229240;3.50;2026-06-01;2026-06-30</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-end flex-wrap">
            <div>
              <Label className="mb-2 block">Jurisdicción</Label>
              <select
                className="border rounded-md px-3 py-2 bg-background"
                value={jurisdiccion}
                onChange={e => setJurisdiccion(e.target.value)}
              >
                {estado.map(j => <option key={j.codigo} value={j.codigo}>{j.nombre}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={reemplazar} onChange={e => setReemplazar(e.target.checked)} />
              Reemplazar el padrón anterior de la jurisdicción
            </label>
          </div>
          <Textarea
            placeholder={"cuit;alicuota;vigencia_desde;vigencia_hasta\n30710229240;3.50;2026-06-01;2026-06-30"}
            value={csv}
            onChange={e => setCsv(e.target.value)}
            rows={8}
            className="font-mono text-xs"
          />
          <Button onClick={importar} disabled={importando}>
            {importando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
            Importar padrón
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
