"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, Package, FileText, ArrowRight, RefreshCw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { Check, ChevronsUpDown, Plus } from "lucide-react"

interface OrdenCompra {
    id: string
    numero: string
    fecha: string
    proveedor: string
    cuit_proveedor: string
    estado: string
    items_count: number
    observaciones: string
}

interface RecepcionDashboardProps {
    userId: string
}

export function RecepcionDashboard({ userId }: RecepcionDashboardProps) {
    const [ordenes, setOrdenes] = useState<OrdenCompra[]>([])
    const [proveedores, setProveedores] = useState<{ id: string, nombre: string }[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isStarting, setIsStarting] = useState<string | null>(null)
    const [openProvider, setOpenProvider] = useState(false)
    const [selectedProvider, setSelectedProvider] = useState("")
    const [isCreatingDirect, setIsCreatingDirect] = useState(false)
    const router = useRouter()
    const { toast } = useToast()

    const fetchOrdenes = async () => {
        setIsLoading(true)
        try {
            const [ro, rp] = await Promise.all([
                fetch("/api/recepciones/ordenes-pendientes"),
                fetch("/api/proveedores")
            ])
            if (!ro.ok) throw new Error("Error al cargar órdenes")
            const dataO = await ro.json()
            setOrdenes(dataO)

            if (rp.ok) {
                const dataP = await rp.json()
                setProveedores(dataP)
            }
        } catch (error) {
            console.error(error)
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudieron cargar los datos.",
            })
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchOrdenes()
    }, [])

    const handleIniciarRecepcion = async (ordenId: string) => {
        setIsStarting(ordenId)
        try {
            const response = await fetch("/api/recepciones", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    orden_compra_id: ordenId,
                    usuario_id: userId
                })
            })

            if (!response.ok) throw new Error("Error al iniciar recepción")

            const data = await response.json()

            toast({
                title: data.isNew ? "Recepción Iniciada" : "Continuando Recepción",
                description: `Redirigiendo a la recepción de la orden...`,
            })

            router.push(`/deposito/recepcion/${data.id}`)
        } catch (error) {
            console.error(error)
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo iniciar la recepción.",
            })
            setIsStarting(null)
        }
    }

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Cargando órdenes pendientes...</span>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h2 className="text-2xl font-bold tracking-tight">Órdenes Pendientes</h2>
                <div className="flex gap-2 w-full md:w-auto">
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button variant="default">
                                <Plus className="mr-2 h-4 w-4" />
                                Recepción Directa
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Nueva Recepción Directa</DialogTitle>
                                <DialogDescription>
                                    Seleccioná un proveedor para iniciar una recepción sin Orden de Compra.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="py-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Proveedor</label>
                                    <Popover open={openProvider} onOpenChange={setOpenProvider}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                aria-expanded={openProvider}
                                                className="w-full justify-between"
                                            >
                                                {selectedProvider
                                                    ? proveedores.find((p) => p.id === selectedProvider)?.nombre
                                                    : "Seleccionar proveedor..."}
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[400px] p-0">
                                            <Command>
                                                <CommandInput placeholder="Buscar proveedor..." />
                                                <CommandEmpty>No se encontró el proveedor.</CommandEmpty>
                                                <CommandGroup className="max-h-64 overflow-y-auto">
                                                    {proveedores.map((p) => (
                                                        <CommandItem
                                                            key={p.id}
                                                            onSelect={() => {
                                                                setSelectedProvider(p.id)
                                                                setOpenProvider(false)
                                                            }}
                                                        >
                                                            <Check
                                                                className={cn(
                                                                    "mr-2 h-4 w-4",
                                                                    selectedProvider === p.id ? "opacity-100" : "opacity-0"
                                                                )}
                                                            />
                                                            {p.nombre}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </div>
                            <Button
                                className="w-full"
                                disabled={!selectedProvider || isCreatingDirect}
                                onClick={async () => {
                                    setIsCreatingDirect(true)
                                    try {
                                        const response = await fetch("/api/recepciones", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                                proveedor_id: selectedProvider,
                                                usuario_id: userId
                                            })
                                        })
                                        if (!response.ok) throw new Error("Error al crear recepción")
                                        const data = await response.json()
                                        router.push(`/deposito/recepcion/${data.id}`)
                                    } catch (err) {
                                        toast({ variant: "destructive", title: "Error", description: "No se pudo crear la recepción." })
                                    } finally {
                                        setIsCreatingDirect(false)
                                    }
                                }}
                            >
                                {isCreatingDirect && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Iniciar Recepción
                            </Button>
                        </DialogContent>
                    </Dialog>
                    <Button variant="outline" onClick={fetchOrdenes}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Actualizar
                    </Button>
                </div>
            </div>

            {ordenes.length === 0 ? (
                <Card className="bg-muted/50 border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                        <Package className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium">No hay órdenes pendientes</h3>
                        <p className="text-muted-foreground max-w-sm mt-2">
                            No se encontraron órdenes de compra pendientes de recepción en este momento.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {ordenes.map((orden) => (
                        <Card key={orden.id} className="flex flex-col hover:shadow-md transition-shadow">
                            <CardHeader className="pb-3">
                                <div className="flex justify-between items-start">
                                    <Badge variant={orden.estado === 'recibida_parcial' ? "secondary" : "outline"}>
                                        {orden.estado === 'recibida_parcial' ? 'Parcial' : 'Pendiente'}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                        {new Date(orden.fecha).toLocaleDateString()}
                                    </span>
                                </div>
                                <CardTitle className="mt-2 flex items-center gap-2">
                                    <FileText className="h-5 w-5 text-primary" />
                                    {orden.numero}
                                </CardTitle>
                                <CardDescription className="font-medium text-foreground">
                                    {orden.proveedor}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1 text-sm">
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    <div className="text-muted-foreground">CUIT:</div>
                                    <div>{orden.cuit_proveedor || "-"}</div>
                                    <div className="text-muted-foreground">Items:</div>
                                    <div>{orden.items_count}</div>
                                </div>
                                {orden.observaciones && (
                                    <div className="bg-muted/50 p-2 rounded text-xs italic mt-2">
                                        "{orden.observaciones}"
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="pt-2">
                                <Button
                                    className="w-full"
                                    onClick={() => handleIniciarRecepcion(orden.id)}
                                    disabled={isStarting === orden.id}
                                >
                                    {isStarting === orden.id ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Iniciando...
                                        </>
                                    ) : (
                                        <>
                                            Recibir Mercadería
                                            <ArrowRight className="ml-2 h-4 w-4" />
                                        </>
                                    )}
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
