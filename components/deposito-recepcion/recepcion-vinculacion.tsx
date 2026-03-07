
"use client"

import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Check, Link as LinkIcon, AlertTriangle, ArrowRight, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"

interface RecepcionVinculacionProps {
    recepcion: any
    onUpdate: () => void
    onNext: () => void
}

export function RecepcionVinculacion({ recepcion, onUpdate, onNext }: RecepcionVinculacionProps) {
    const { toast } = useToast()

    // Flatten all items from all documents
    const ocrItems = useMemo(() => {
        if (!recepcion.documentos) return []

        let allItems: any[] = []
        recepcion.documentos.forEach((doc: any) => {
            if (doc.datos_ocr?.items) {
                doc.datos_ocr.items.forEach((item: any, index: number) => {
                    allItems.push({
                        ...item,
                        docId: doc.id,
                        uniqueId: `${doc.id}-${index}`, // unique key
                    })
                })
            }
        })
        return allItems
    }, [recepcion.documentos])

    // Local state for linked items during this session
    const [linkedStatus, setLinkedStatus] = useState<Record<string, boolean>>({})
    const [knownMappings, setKnownMappings] = useState<Set<string>>(new Set())

    // Fetch known mappings on mount
    const [isLoadingMappings, setIsLoadingMappings] = useState(true)

    // Helper to normalize text for consistent matching (same as backend)
    const normalizeText = (text: string | null | undefined): string => {
        if (!text) return "";
        return text
            .toLowerCase()
            .trim()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
            .replace(/[^a-z0-9\s]/g, "") // Remove non-alphanumeric except spaces
            .replace(/\s+/g, " "); // Collapse multiple spaces
    };

    // Effect to fetch initial mappings
    useEffect(() => {
        const fetchMappings = async () => {
            const proveedorId = recepcion.proveedor_id || recepcion.orden_compra?.proveedor_id

            if (!proveedorId) {
                setIsLoadingMappings(false)
                return
            }

            try {
                const res = await fetch(`/api/proveedores/${proveedorId}/mappings`)
                if (res.ok) {
                    const data = await res.json()
                    // Normalize the fetched descriptions to match our local normalization logic
                    const mappingSet = new Set<string>(data.map((m: any) => normalizeText(m.descripcion_proveedor)))
                    setKnownMappings(mappingSet)
                }
            } catch (err) {
                console.error("Error fetching mappings", err)
            } finally {
                setIsLoadingMappings(false)
            }
        }
        fetchMappings()
    }, [recepcion.proveedor_id, recepcion.orden_compra?.proveedor_id])

    const handleLinkArticle = async (ocrItem: any, article: any) => {
        try {
            const response = await fetch(`/api/recepciones/${recepcion.id}/vincular`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    articulo_id: article.id,
                    descripcion_proveedor: ocrItem.descripcion_ocr,
                    codigo_proveedor: ocrItem.codigo_visible,
                    cantidad_a_sumar: ocrItem.cantidad,
                    precio_unitario: ocrItem.precio_unitario // Pass for heuristic
                })
            })

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}))
                throw new Error(errData.error || "Error vinculando artículo")
            }

            toast({
                title: "Artículo Vinculado",
                description: `"${ocrItem.descripcion_ocr}" ahora es "${article.descripcion}"`,
            })

            // Add to known mappings so it disappears from list
            const normalized = normalizeText(ocrItem.descripcion_ocr)
            setKnownMappings(prev => new Set(prev).add(normalized))

            setLinkedStatus(prev => ({ ...prev, [ocrItem.uniqueId]: true }))
            onUpdate()

        } catch (error) {
            console.error(error)
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo vincular el artículo."
            })
        }
    }

    // Prepare list of system articles for ComboBox
    const systemArticles = useMemo(() => {
        if (!recepcion.items) return []
        return recepcion.items.map((i: any) => i.articulo)
    }, [recepcion.items])

    // Calculate visible items
    const visibleItems = ocrItems.filter(item => {
        const normalized = normalizeText(item.descripcion_ocr);
        return !knownMappings.has(normalized);
    });

    const allLinked = ocrItems.length > 0 && visibleItems.length === 0;

    return (
        <Card className="h-full flex flex-col">
            <CardHeader>
                <CardTitle>Vinculación de Artículos</CardTitle>
                <CardDescription>
                    Asociá los items detectados en la factura con tus productos internos.
                    El sistema recordará esta asociación para el futuro.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
                {isLoadingMappings ? (
                    <div className="flex items-center justify-center h-40">
                        <p className="text-muted-foreground animate-pulse">Cargando vinculaciones...</p>
                    </div>
                ) : ocrItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-muted-foreground border-2 border-dashed rounded-lg">
                        <p>No se detectaron items para vincular.</p>
                        <p className="text-sm">Subí documentos en el paso anterior.</p>
                    </div>
                ) : allLinked ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-green-700 bg-green-50/30 border-2 border-dashed border-green-200 rounded-lg">
                        <Check className="h-10 w-10 mb-2" />
                        <p className="font-semibold text-lg">¡Todo vinculado!</p>
                        <p className="text-sm text-green-600">Todos los items detectados ya están asociados a productos del sistema.</p>
                        <Button variant="outline" size="sm" className="mt-4 border-green-200 hover:bg-green-100 text-green-800" onClick={() => setKnownMappings(new Set())}>
                            Ver todos (incluyendo vinculados)
                        </Button>
                    </div>
                ) : (
                    <div className="relative w-full overflow-auto">
                        <div className="mb-2 text-xs text-muted-foreground flex justify-between">
                            <span>Mostrando {visibleItems.length} items pendientes de vincular</span>
                            <span className="text-green-600 font-medium">
                                {ocrItems.length - visibleItems.length} items ocultos (ya vinculados)
                            </span>
                        </div>
                        <table className="w-full caption-bottom text-sm text-left">
                            <thead className="[&_tr]:border-b">
                                <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Descripción Detectada</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground w-[100px]">Código</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground text-right w-[80px]">Cant.</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground w-[300px]">Artículo en Sistema</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground w-[40px]"></th>
                                </tr>
                            </thead>
                            <tbody className="[&_tr:last-child]:border-0">
                                {visibleItems.map((item) => {
                                    const isLinked = linkedStatus[item.uniqueId] || false

                                    return (
                                        <tr key={item.uniqueId} className={`border-b transition-colors hover:bg-muted/50 ${isLinked ? 'bg-green-50/50' : ''}`}>
                                            <td className="p-4 align-middle">
                                                <span className="font-medium">{item.descripcion_ocr}</span>
                                                {item.confidence < 0.8 && (
                                                    <Badge variant="outline" className="ml-2 text-yellow-600 border-yellow-200 text-[10px]">
                                                        Dudoso
                                                    </Badge>
                                                )}
                                            </td>
                                            <td className="p-4 align-middle font-mono text-xs">{item.codigo_visible || "-"}</td>
                                            <td className="p-4 align-middle text-right">{item.cantidad}</td>
                                            <td className="p-4 align-middle">
                                                {isLinked ? (
                                                    <div className="flex items-center text-green-700 gap-2 text-xs font-semibold">
                                                        <Check className="h-4 w-4" />
                                                        Vinculado
                                                    </div>
                                                ) : (
                                                    <ArticleSelector
                                                        articles={systemArticles}
                                                        onSelect={(article) => handleLinkArticle(item, article)}
                                                    />
                                                )}
                                            </td>
                                            <td className="p-4 align-middle">
                                                {/* Button to ignore/delete can go here */}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
            <div className="p-6 pt-0 mt-auto flex justify-end">
                <Button onClick={onNext} className="gap-2">
                    Continuar a Conteo Físico
                    <ArrowRight className="h-4 w-4" />
                </Button>
            </div>
        </Card>
    )
}

function ArticleSelector({ articles, onSelect }: { articles: any[], onSelect: (a: any) => void }) {
    const [open, setOpen] = useState(false)

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={open} className="w-[280px] justify-between text-xs h-8">
                    <span className="truncate">Seleccionar artículo...</span>
                    <LinkIcon className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                    <CommandInput placeholder="Buscar artículo..." />
                    <CommandList>
                        <CommandEmpty>No encontrado.</CommandEmpty>
                        <CommandGroup>
                            {articles.map((article) => (
                                <CommandItem
                                    key={article.id}
                                    value={article.descripcion} // Search by description
                                    onSelect={() => {
                                        onSelect(article)
                                        setOpen(false)
                                    }}
                                    className="text-xs"
                                >
                                    <Check className={cn("mr-2 h-4 w-4 opacity-0")} />
                                    <div className="flex flex-col">
                                        <span>{article.descripcion}</span>
                                        <span className="text-muted-foreground text-[10px]">{article.sku}</span>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
