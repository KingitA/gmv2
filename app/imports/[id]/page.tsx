import { createClient } from '@supabase/supabase-js';
import { MatchReviewTable } from '@/components/matching/MatchReviewTable';
import { notFound } from 'next/navigation';

export default async function ImportReviewPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    // Initialize server-side safe client
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: importHeader } = await supabase
        .from('imports')
        .select('*')
        .eq('id', id)
        .single();

    if (!importHeader) return notFound();

    return (
        <div className="container mx-auto py-10">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Revisión de Importación</h1>
                    <p className="text-muted-foreground">
                        {importHeader.type.toUpperCase()} • {new Date(importHeader.created_at).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
                    </p>
                </div>
                <div className="text-right">
                    <div className="font-mono text-xs text-muted-foreground">{id}</div>
                    <div className={`text-sm font-semibold capitalize ${importHeader.status === 'completed' ? 'text-green-600' : 'text-blue-600'}`}>
                        {importHeader.status}
                    </div>
                </div>
            </div>

            <div className="bg-slate-50 border rounded-lg p-6 mb-8">
                <h2 className="text-lg font-semibold mb-2">Resumen</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-muted-foreground block">Archivo</span>
                        {importHeader.meta?.filename || 'N/A'}
                    </div>
                    <div>
                        <span className="text-muted-foreground block">Proveedor ID</span>
                        {importHeader.meta?.provider_id || 'N/A'}
                    </div>
                    <div>
                        <span className="text-muted-foreground block">Total Items</span>
                        {importHeader.meta?.total_items ?? 'Unknown'}
                    </div>
                </div>
            </div>

            <MatchReviewTable importId={id} providerId={importHeader.meta?.provider_id} />
        </div>
    );
}
