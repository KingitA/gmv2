"use client"

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Plus, Upload, Loader2, Eye, CheckCircle } from "lucide-react"
import Link from "next/link"
import { useToast } from "@/components/ui/use-toast"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"

export default function ListasProveedoresPage() {
    const supabase = createClient()
    const { toast } = useToast()
    const [listas, setListas] = useState<any[]>([])
    const [proveedores, setProveedores] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [showImportar, setShowImportar] = useState(false)
    const [filtroEstado, setFiltroEstado] = useState("")
    const [filtroProveedor, setFiltroProveedor] = useState("")

    // Import form
    const [file, setFile] = useState<File | null>(null)
    const [proveedorId, setProveedorId] = useState("")
    const [nombre, setNombre] = useState("")
    const [fechaVigencia, setFechaVigencia] = useState("")
    const [fechaFin, setFechaFin] = useState("")
    const [observaciones, setObservaciones] = useState("")
    const [importando, setImportando] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        loadListas()
        supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre")
            .then((result) => setProveedores(result.data || []))
    }, [filtroEstado, filtroProveedor])

    const loadListas = async () => {
        setLoading(true)
        const params = new URLSearchParams()
        if (filtroEstado) params.set('estado', filtroEstado)
        if (filtroProveedor) params.set('proveedor_id', filtroProveedor)
        const res = await fetch(`/api/listas-proveedores?${params}`)
        const data = await res.json()
        setListas(data.listas || [])
        setLoading(false)
    }

    const handleImportar = async () => {
        if (!file || !fechaVigencia) { toast({ variant: 'destructive', title: 'Archivo y fecha de vigencia son requeridos' }); return }
        setImportando(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('fecha_vigencia', fechaVigencia)
            if (proveedorId) formData.append('proveedor_id', proveedorId)
            if (nombre) formData.append('nombre', nombre)
            if (fechaFin) formData.append('fecha_fin', fechaFin)
            if (observaciones) formData.append('observaciones', observaciones)

            const res = await fetch('/api/listas-proveedores/importar', { method: 'POST', body: formData })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            toast({ title: 'Lista importada', description: `${data.stats.matched} artículos matcheados, ${data.stats.sin_match} sin match` })
            setShowImportar(false)
            setFile(null)
            setNombre('')
            setFechaVigencia('')
            setFechaFin('')
            setObservaciones('')
            setProveedorId('')
            loadListas()
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message })
        } finally {
            setImportando(false)
        }
    }

    const estadoColor: Record<string, string> = {
        borrador: 'bg-gray-100 text-gray-800',
        pendiente: 'bg-blue-100 text-blue-800',
        aplicada: 'bg-green-100 text-green-800',
        vencida: 'bg-red-100 text-red-800',
    }

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold">Listas de Precios de Proveedores</h1>
                <Button onClick={() => setShowImportar(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Importar Lista
                </Button>
            </div>

            <div className="flex gap-3">
                <Select value={filtroEstado} onValueChange={setFiltroEstado}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="">Todos</SelectItem>
                        <SelectItem value="pendiente">Pendiente</SelectItem>
                        <SelectItem value="aplicada">Aplicada</SelectItem>
                        <SelectItem value="vencida">Vencida</SelectItem>
                    </SelectContent>
                </Select>
                <EntitySearchSelect
                    entity="proveedores"
                    className="w-56"
                    placeholder="Todos los proveedores..."
                    value={filtroProveedor ? ((proveedores.find((p: any) => p.id === filtroProveedor) as any) ?? null) : null}
                    onSelect={(p: any) => setFiltroProveedor(p ? p.id : "")}
                />
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Proveedor</TableHead>
                                <TableHead>Nombre</TableHead>
                                <TableHead>Vigencia</TableHead>
                                <TableHead>Hasta</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={6} className="text-center h-20"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
                            ) : listas.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="text-center h-20 text-muted-foreground">Sin listas importadas aún</TableCell></TableRow>
                            ) : listas.map((lista: any) => (
                                <TableRow key={lista.id}>
                                    <TableCell>{(lista.proveedor as any)?.nombre || '—'}</TableCell>
                                    <TableCell className="font-medium">{lista.nombre || '—'}</TableCell>
                                    <TableCell>{lista.fecha_vigencia}</TableCell>
                                    <TableCell>{lista.fecha_fin || '—'}</TableCell>
                                    <TableCell>
                                        <Badge className={estadoColor[lista.estado] || ''}>{lista.estado}</Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex gap-2">
                                            <Link href={`/listas-proveedores/${lista.id}`}>
                                                <Button variant="outline" size="sm"><Eye className="h-4 w-4 mr-1" /> Ver</Button>
                                            </Link>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Import Dialog */}
            <Dialog open={showImportar} onOpenChange={setShowImportar}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Importar Lista de Precios</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Proveedor</Label>
                            <Select value={proveedorId} onValueChange={setProveedorId}>
                                <SelectTrigger><SelectValue placeholder="Seleccionar (opcional)" /></SelectTrigger>
                                <SelectContent>
                                    {proveedores.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Nombre de la lista</Label>
                            <Input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Lista Junio 2026" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label>Fecha vigencia *</Label>
                                <Input type="date" value={fechaVigencia} onChange={e => setFechaVigencia(e.target.value)} />
                            </div>
                            <div>
                                <Label>Hasta (opcional)</Label>
                                <Input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} />
                            </div>
                        </div>
                        <div>
                            <Label>Archivo (imagen, PDF o Excel)</Label>
                            <div className="border-2 border-dashed rounded-lg p-4 text-center relative hover:bg-muted/20 transition-colors cursor-pointer"
                                onClick={() => fileInputRef.current?.click()}>
                                {file ? (
                                    <div className="text-sm font-medium">{file.name}</div>
                                ) : (
                                    <div className="text-muted-foreground text-sm">
                                        <Upload className="h-6 w-6 mx-auto mb-2" />
                                        Hacé click o arrastrá un archivo
                                    </div>
                                )}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*,.pdf,.xlsx,.xls,.csv"
                                    className="hidden"
                                    onChange={e => setFile(e.target.files?.[0] || null)}
                                />
                            </div>
                        </div>
                        <div>
                            <Label>Observaciones</Label>
                            <Input value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Opcional" />
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setShowImportar(false)}>Cancelar</Button>
                            <Button onClick={handleImportar} disabled={importando || !file || !fechaVigencia}>
                                {importando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Importar y procesar
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
