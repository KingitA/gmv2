"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, ArrowLeft, Save, CheckCircle, AlertTriangle, FileText, Box, ClipboardCheck, Link2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import Link from "next/link"
import { RecepcionDocumentos } from "./recepcion-documentos"
import { RecepcionFisica } from "./recepcion-fisica"
import { RecepcionCotejo } from "./recepcion-cotejo"
import { RecepcionVinculacion } from "./recepcion-vinculacion"

interface RecepcionProcessProps {
    recepcionId: string
    userId: string
}

export function RecepcionProcess({ recepcionId, userId }: RecepcionProcessProps) {
    const [recepcion, setRecepcion] = useState<any>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [activeTab, setActiveTab] = useState("documentos")
    const router = useRouter()
    const { toast } = useToast()

    const fetchRecepcion = async () => {
        try {
            const response = await fetch(`/api/recepciones/${recepcionId}`)
            if (!response.ok) throw new Error("Error al cargar recepción")
            const data = await response.json()
            setRecepcion(data)
        } catch (error) {
            console.error(error)
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo cargar la información de la recepción.",
            })
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchRecepcion()
    }, [recepcionId])

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        )
    }

    if (!recepcion) return null

    return (
        <div className="flex flex-col h-screen">
            {/* Header */}
            <header className="border-b bg-background px-6 py-3 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-4">
                    <Link href="/deposito/recepcion">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-lg font-bold flex items-center gap-2">
                            Recepción {recepcion.orden_compra?.numero_orden}
                            <span className="text-sm font-normal text-muted-foreground">
                                | {recepcion.orden_compra?.proveedor?.nombre || recepcion.orden_compra?.proveedor?.razon_social}
                            </span>
                        </h1>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Iniciado: {new Date(recepcion.fecha_inicio).toLocaleDateString()}</span>
                            <span>•</span>
                            <span className="capitalize">{recepcion.estado.replace('_', ' ')}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Global Actions if needed */}
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden bg-muted/30 p-4">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                    <div className="flex justify-center mb-4">
                        <TabsList className="grid w-full max-w-2xl grid-cols-4">
                            <TabsTrigger value="documentos" className="flex items-center gap-2">
                                <FileText className="h-4 w-4" />
                                Documentos
                            </TabsTrigger>
                            <TabsTrigger value="vinculacion" className="flex items-center gap-2">
                                <Link2 className="h-4 w-4" />
                                Vinculación
                            </TabsTrigger>
                            <TabsTrigger value="fisico" className="flex items-center gap-2">
                                <Box className="h-4 w-4" />
                                Recepción Física
                            </TabsTrigger>
                            <TabsTrigger value="cotejo" className="flex items-center gap-2">
                                <ClipboardCheck className="h-4 w-4" />
                                Cotejo y Cierre
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <div className="flex-1 overflow-auto">
                        <TabsContent value="documentos" className="h-full m-0">
                            <RecepcionDocumentos
                                recepcion={recepcion}
                                onUpdate={fetchRecepcion}
                                onNext={() => setActiveTab("vinculacion")}
                            />
                        </TabsContent>

                        <TabsContent value="vinculacion" className="h-full m-0">
                            <RecepcionVinculacion
                                recepcion={recepcion}
                                onUpdate={fetchRecepcion}
                                onNext={() => setActiveTab("fisico")}
                            />
                        </TabsContent>

                        <TabsContent value="fisico" className="h-full m-0">
                            <RecepcionFisica
                                recepcion={recepcion}
                                onUpdate={fetchRecepcion}
                                onNext={() => setActiveTab("cotejo")}
                            />
                        </TabsContent>

                        <TabsContent value="cotejo" className="h-full m-0">
                            <RecepcionCotejo
                                recepcion={recepcion}
                                onUpdate={fetchRecepcion}
                            />
                        </TabsContent>
                    </div>
                </Tabs>
            </main>
        </div>
    )
}
