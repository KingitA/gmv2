'use client';
import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import { CandidateCard } from './CandidateCard';
import { ImportItemRaw, MatchCandidate } from '@/lib/matching/types';
import { Button } from '@/components/ui/button';
import { ManualMatchDialog } from './ManualMatchDialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Filter } from 'lucide-react';

interface ImportItem {
    id: string;
    status: string;
    raw_data: ImportItemRaw;
    match_confidence: number;
    match_details: {
        candidates: MatchCandidate[];
    };
}

export function MatchReviewTable({ importId, providerId }: { importId: string, providerId?: string }) {
    const [items, setItems] = useState<ImportItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'pending' | 'high_confidence'>('pending');
    const supabase = getSupabase();

    useEffect(() => {
        loadItems();
    }, [importId]);

    // ... (rest of function body)



    async function loadItems() {
        setLoading(true);
        const { data } = await supabase
            .from('import_items')
            .select('*')
            .eq('import_id', importId)
            .order('match_confidence', { ascending: false }); // Highest confidence match first

        if (data) setItems(data as any);
        setLoading(false);
    }

    const filteredItems = items.filter(i => {
        if (filter === 'pending') return i.status === 'pending';
        if (filter === 'high_confidence') return i.status === 'pending' && i.match_confidence > 0.8;
        return true;
    });



    /*
    const filteredItems = items.filter(i => {
        if (filter === 'pending') return i.status === 'pending';
        if (filter === 'high_confidence') return i.status === 'pending' && i.match_confidence > 0.8;
        return true;
    });
    */

    // State for manual match dialog
    const [manualMatchItem, setManualMatchItem] = useState<ImportItem | null>(null);

    async function handleApprove(itemId: string, skuId: string, method: string, score: number) {
        // Optimistic Update
        setItems(current => current.map(item =>
            item.id === itemId ? { ...item, status: 'approved' } : item
        ));

        // If manual match, close dialog
        if (method === 'manual_search') {
            setManualMatchItem(null);
        }

        const res = await fetch('/api/match/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                import_item_id: itemId,
                selected_sku_id: skuId,
                match_method: method,
                score: score
            })
        });

        if (!res.ok) {
            console.error("Failed to approve");
            // Revert on failure (omitted for brevity)
        }
    }

    async function handleReject(itemId: string) {
        setItems(current => current.map(item =>
            item.id === itemId ? { ...item, status: 'rejected' } : item
        ));

        await fetch('/api/match/reject', {
            method: 'POST',
            body: JSON.stringify({ import_item_id: itemId, reason: 'Manual rejection' })
        });
    }

    if (loading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="space-y-4">
            <div className="flex gap-2 mb-4">
                <Button variant={filter === 'pending' ? 'default' : 'outline'} onClick={() => setFilter('pending')}>
                    Solo Pendientes ({items.filter(i => i.status === 'pending').length})
                </Button>
                <Button variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>
                    Todos
                </Button>
            </div>

            <div className="grid gap-4">
                {filteredItems.map(item => (
                    <div key={item.id} className="p-4 border rounded-lg bg-card shadow-sm flex gap-4">
                        {/* Left: Raw Data */}
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-lg">{item.raw_data.description}</div>
                            <div className="text-sm text-muted-foregrounds flex gap-3 mt-1">
                                {item.raw_data.code && <Badge variant="secondary">Code: {item.raw_data.code}</Badge>}
                                {item.raw_data.ean && <Badge variant="secondary">EAN: {item.raw_data.ean}</Badge>}
                                {item.raw_data.price && <div>${item.raw_data.price}</div>}
                            </div>
                            {item.status !== 'pending' && <Badge className="mt-2" variant={item.status === 'approved' ? 'default' : 'destructive'}>{item.status}</Badge>}

                            {item.status === 'pending' && (
                                <Button variant="ghost" size="sm" className="mt-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleReject(item.id)}>
                                    Rechazar / No Vincular
                                </Button>
                            )}
                        </div>

                        {/* Right: Candidates */}
                        <div className="w-[300px] flex-shrink-0 space-y-2">
                            {item.status === 'pending' ? (
                                <>
                                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Sugerencias Intelligence</div>
                                    {item.match_details.candidates && item.match_details.candidates.length > 0 ? (
                                        item.match_details.candidates.slice(0, 3).map((candidate, idx) => (
                                            <CandidateCard
                                                key={candidate.sku_id}
                                                candidate={candidate}
                                                onApprove={(skuId, method, score) => handleApprove(item.id, skuId, method, score)}
                                                isBest={idx === 0}
                                            />
                                        ))
                                    ) : (
                                        <div className="text-sm text-muted-foreground italic p-2 bg-slate-50 rounded">
                                            No se encontraron sugerencias.
                                            <Button
                                                variant="link"
                                                className="h-auto p-0 text-xs text-blue-600"
                                                onClick={() => setManualMatchItem(item)}
                                            >
                                                Busqueda manual...
                                            </Button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                item.status === 'approved' && <div className="text-sm text-green-600 font-medium p-4 border rounded-lg bg-green-50 flex items-center justify-center h-full">Vinculado Correctamente</div>
                            )}
                        </div>
                    </div>
                ))}
                {filteredItems.length === 0 && <div className="text-center p-10 text-muted-foreground">Listado vacío</div>}
            </div>

            <ManualMatchDialog
                open={!!manualMatchItem}
                onOpenChange={(open) => !open && setManualMatchItem(null)}
                itemName={manualMatchItem?.raw_data.description || ""}
                providerId={providerId}
                onSelect={(skuId, method, score) => manualMatchItem && handleApprove(manualMatchItem.id, skuId, method, score)}
            />
        </div>
    );
}
