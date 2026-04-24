
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ManualMatchDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (skuId: string, method: string, score: number) => void;
    itemName: string;
    providerId?: string;
}

export function ManualMatchDialog({ open, onOpenChange, onSelect, itemName, providerId }: ManualMatchDialogProps) {
    const [term, setTerm] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const supabase = createClient();

    useEffect(() => {
        if (open && itemName) {
            // Auto-search logic
            const cleanName = itemName.replace(/[0-9]/g, '').trim().split(' ').slice(0, 2).join(' ');
            if (cleanName.length > 2) {
                setTerm(cleanName);
                search(cleanName);
            } else {
                setTerm('');
                setResults([]);
            }
        }
    }, [open, itemName]);

    async function search(query: string) {
        if (!query || query.length < 2) return;
        setLoading(true);

        const cleanQuery = query.trim();
        const pendingResults: Map<string, any> = new Map();

        console.log("Searching for:", cleanQuery);

        // 1. Search in Provider Links (if providerId exists) - Highest Priority
        if (providerId && providerId !== 'undefined') {
            const { data: linkData, error: linkError } = await supabase
                .from('articulos_proveedores')
                .select(`
                    articulo_id,
                    codigo_proveedor,
                    articulos (id, descripcion, sku, ean13)
                `)
                .eq('proveedor_id', providerId)
                .or(`codigo_proveedor.ilike.%${cleanQuery}%,descripcion_proveedor.ilike.%${cleanQuery}%`) // Removed space
                .limit(5);

            if (linkError) {
                console.error("Error searching provider links:", JSON.stringify(linkError, null, 2));
            } else if (linkData) {
                linkData.forEach((link: any) => {
                    if (link.articulos) {
                        const art = Array.isArray(link.articulos) ? link.articulos[0] : link.articulos;
                        // Map sku/ean13 to legacy properties if needed by UI, or update UI to use new props
                        pendingResults.set(art.id, {
                            ...art,
                            codigo_interno: art.sku, // Map for UI compatibility
                            codigo_barras: art.ean13, // Map for UI compatibility
                            source: 'provider_link'
                        });
                    }
                });
            }
        }

        // 2. Search in Articles (Global) - Description & Codes
        const { data: artData, error: artError } = await supabase
            .from('articulos')
            .select('id, descripcion, sku, ean13')
            .or(`descripcion.ilike.%${cleanQuery}%,sku.ilike.%${cleanQuery}%,ean13.ilike.%${cleanQuery}%`) // Removed spaces
            .limit(10);

        if (artError) {
            console.error("Error searching articles:", JSON.stringify(artError, null, 2));
        } else if (artData) {
            artData.forEach((art: any) => {
                if (!pendingResults.has(art.id)) {
                    pendingResults.set(art.id, {
                        ...art,
                        codigo_interno: art.sku, // Map for UI compatibility
                        codigo_barras: art.ean13, // Map for UI compatibility
                        source: 'global_search'
                    });
                }
            });
        }

        setResults(Array.from(pendingResults.values()));
        setLoading(false);
    }

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        search(term);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Vinculación Manual</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="p-3 bg-muted rounded-md text-sm">
                        Buscando coincidencia para: <span className="font-semibold">{itemName}</span>
                    </div>

                    <form onSubmit={handleSearch} className="flex gap-2">
                        <Input
                            placeholder="Buscar artículo interno..."
                            value={term}
                            onChange={e => setTerm(e.target.value)}
                            autoFocus
                        />
                        <Button type="submit" disabled={loading}>
                            {loading ? <Loader2 className="animate-spin" /> : <Search16 />}
                        </Button>
                    </form>

                    <div className="border rounded-md divide-y max-h-[300px] overflow-y-auto">
                        {results.map(r => (
                            <div key={r.id} className="p-3 flex justify-between items-center hover:bg-slate-50">
                                <div>
                                    <div className="font-medium">{r.descripcion}</div>
                                    <div className="text-xs text-muted-foreground flex gap-2">
                                        <span>SKU: {r.sku || r.codigo_interno}</span>
                                        {(r.ean13?.length || r.codigo_barras) && <span>EAN: {Array.isArray(r.ean13) ? r.ean13.join(', ') : (r.ean13 || r.codigo_barras)}</span>}
                                    </div>
                                </div>
                                <Button size="sm" onClick={() => onSelect(r.id, 'manual_search', 1.0)}>
                                    Vincular
                                </Button>
                            </div>
                        ))}
                        {results.length === 0 && !loading && (
                            <div className="p-4 text-center text-muted-foreground text-sm">
                                {term ? "No se encontraron resultados" : "Ingrese un término para buscar"}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function Search16() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
        </svg>
    )
}
