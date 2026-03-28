// Usage: npx tsx scripts/backfill-proveedores-clientes.ts
// Options: --force (re-generate all, even existing), --only=proveedores, --only=clientes

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';

// Manual .env loading for standalone script
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const val = values.join('=').trim().replace(/^["'](.*)["']$/, '$1');
            if (!process.env[key.trim()]) {
                process.env[key.trim()] = val;
            }
        }
    });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "models/gemini-embedding-001" });

const FORCE = process.argv.includes('--force');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1] : null;

async function generateEmbedding(text: string): Promise<number[]> {
    const clean = text.replace(/\n/g, " ").trim();
    const result = await (model as any).embedContent({
        content: { parts: [{ text: clean }], role: "user" },
        outputDimensionality: 768,
    });
    return result.embedding.values;
}

async function backfillTable(
    table: string,
    select: string,
    buildText: (row: any) => string
) {
    console.log(`\n── Backfill ${table} ──────────────────────`);

    let countQuery = supabase.from(table).select('*', { count: 'exact', head: true });
    if (!FORCE) countQuery = countQuery.is('embedding', null);
    const { count, error: countError } = await countQuery;
    if (countError) throw countError;

    console.log(`Found ${count} records to process${FORCE ? ' (force mode)' : ' (without embedding)'}.`);

    let processed = 0;
    let errors = 0;

    while (true) {
        let batchQuery = supabase.from(table).select(select).limit(50).order('id');
        if (!FORCE) {
            batchQuery = batchQuery.is('embedding', null);
        } else {
            batchQuery = batchQuery.range(processed, processed + 49);
        }

        const { data: batch, error: batchError } = await batchQuery;
        if (batchError) { console.error("Batch error:", batchError); break; }
        if (!batch || batch.length === 0) break;

        for (const row of batch) {
            try {
                const text = buildText(row);
                if (!text.trim()) { console.log(`Skipping ${row.id} (no text)`); continue; }
                const embedding = await generateEmbedding(text);
                const { error } = await supabase.from(table).update({ embedding }).eq('id', row.id);
                if (error) throw error;
                process.stdout.write('.');
            } catch (e) {
                console.error(`\nError processing ${table} ${row.id}:`, e);
                errors++;
            }
        }

        processed += batch.length;
        console.log(` ${processed}/${count}`);
        if (processed >= (count || 0)) break;
    }

    console.log(`Done ${table}: ${processed} processed, ${errors} errors.`);
}

async function main() {
    console.log(`Starting backfill${FORCE ? ' [FORCE]' : ''}${only ? ` [only: ${only}]` : ''}...`);

    if (!only || only === 'proveedores') {
        await backfillTable(
            'proveedores',
            'id, nombre, cuit, direccion',
            (row) => `Proveedor: ${row.nombre} Nombre: ${row.nombre} CUIT: ${row.cuit || ''} Dirección: ${row.direccion || ''}`
        );
    }

    if (!only || only === 'clientes') {
        await backfillTable(
            'clientes',
            'id, nombre, razon_social, cuit, direccion, localidad, provincia, tipo_canal',
            (row) => `Cliente: ${row.nombre} Nombre: ${row.nombre} Razón social: ${row.razon_social || ''} CUIT: ${row.cuit || ''} Dirección: ${row.direccion || ''} Localidad: ${row.localidad || ''} ${row.provincia || ''} Canal: ${row.tipo_canal || ''}`
        );
    }

    console.log('\nBackfill complete!');
}

main().catch(console.error);
