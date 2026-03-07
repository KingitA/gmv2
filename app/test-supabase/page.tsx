export const dynamic = 'force-dynamic'
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

export default function TestSupabasePage() {
    const [resultado, setResultado] = useState<string>('');
    const [cargando, setCargando] = useState(false);
    const [envVars, setEnvVars] = useState<{ url?: string, hasKey: boolean }>({ hasKey: false });

    useEffect(() => {
        // Las variables de entorno solo están disponibles después del montaje en el cliente
        setEnvVars({
            url: process.env.NEXT_PUBLIC_SUPABASE_URL,
            hasKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        });
    }, []);

    const testConexion = async () => {
        setCargando(true);
        setResultado('Probando conexión...');

        try {
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

            if (!url || !key) {
                setResultado('❌ ERROR: Variables de entorno no definidas\n' +
                    `URL: ${url || 'NO DEFINIDA'}\n` +
                    `KEY: ${key ? 'DEFINIDA' : 'NO DEFINIDA'}`);
                setCargando(false);
                return;
            }

            setResultado(`✅ Variables encontradas:\nURL: ${url}\n\nProbando conexión...`);

            const supabase = createClient(url, key);

            // Test simple: obtener tablas
            const { data, error } = await supabase
                .from('clientes')
                .select('id, nombre')
                .limit(1);

            if (error) {
                setResultado(`❌ ERROR de Supabase:\n${JSON.stringify(error, null, 2)}`);
            } else {
                setResultado(`✅ CONEXIÓN EXITOSA!\n\nDatos recibidos: ${JSON.stringify(data, null, 2)}`);
            }
        } catch (error: any) {
            setResultado(`❌ ERROR de JavaScript:\n${error.message}\n\nStack:\n${error.stack}`);
        } finally {
            setCargando(false);
        }
    };

    return (
        <div className="min-h-screen p-8">
            <h1 className="text-3xl font-bold mb-6">Test de Conexión Supabase</h1>

            <button
                onClick={testConexion}
                disabled={cargando}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
            >
                {cargando ? 'Probando...' : 'Probar Conexión'}
            </button>

            {resultado && (
                <pre className="mt-6 p-4 bg-gray-100 rounded-lg overflow-auto max-h-96 text-sm">
                    {resultado}
                </pre>
            )}

            <div className="mt-8 border-t pt-6">
                <h2 className="text-xl font-bold mb-4">Variables de Entorno (Client-Side)</h2>
                <ul className="space-y-2">
                    <li>NEXT_PUBLIC_SUPABASE_URL: {envVars.url || '❌ NO DEFINIDA'}</li>
                    <li>NEXT_PUBLIC_SUPABASE_ANON_KEY: {envVars.hasKey ? '✅ DEFINIDA' : '❌ NO DEFINIDA'}</li>
                </ul>
            </div>
        </div>
    );
}

