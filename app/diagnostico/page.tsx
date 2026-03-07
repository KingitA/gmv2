export const dynamic = 'force-dynamic'
export default function DiagnosticoPage() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const hasAnonKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

    return (
        <div className="min-h-screen p-8">
            <h1 className="text-2xl font-bold mb-4">Diagnóstico del Sistema</h1>

            <div className="space-y-4">
                <div className="border p-4 rounded">
                    <h2 className="font-bold">Variables de Entorno</h2>
                    <ul className="mt-2 space-y-1">
                        <li>✅ NEXT_PUBLIC_SUPABASE_URL: {supabaseUrl || '❌ NO DEFINIDA'}</li>
                        <li>{hasAnonKey ? '✅' : '❌'} NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
                        <li>{hasServiceKey ? '✅' : '❌'} SUPABASE_SERVICE_ROLE_KEY</li>
                    </ul>
                </div>

                <div className="border p-4 rounded">
                    <h2 className="font-bold">Rutas Disponibles</h2>
                    <ul className="mt-2 space-y-1">
                        <li><a href="/" className="text-blue-600 hover:underline">/ (Dashboard Principal)</a></li>
                        <li><a href="/choferes/login" className="text-blue-600 hover:underline">/choferes/login</a></li>
                        <li><a href="/choferes/dashboard" className="text-blue-600 hover:underline">/choferes/dashboard</a></li>
                        <li><a href="/deposito" className="text-blue-600 hover:underline">/deposito</a></li>
                        <li><a href="/crm/admin" className="text-blue-600 hover:underline">/crm/admin</a></li>
                    </ul>
                </div>

                <div className="border p-4 rounded bg-yellow-50">
                    <h2 className="font-bold">⚠️ Problemas Conocidos</h2>
                    <ul className="mt-2 space-y-1 text-sm">
                        <li>• Si ves "Failed to fetch", tu proyecto de Supabase puede estar pausado</li>
                        <li>• Verifica en https://supabase.com/dashboard que tu proyecto esté activo</li>
                        <li>• Si el proyecto está pausado, haz clic en "Restore project"</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

