import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';

// Usage: npx tsx scripts/backfill-embeddings.ts

// Manual .env loading for standalone script
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const val = values.join('=').trim().replace(/^["'](.*)["']$/, '$1'); // Remove quotes
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

const FORCE = process.argv.includes('--force');

async function main() {
    console.log(`Starting embedding backfill (Gemini)... ${FORCE ? '[FORCE MODE]' : ''}`);

    // 1. Get total count
    let query = supabase.from('articulos').select('*', { count: 'exact', head: true });
    if (!FORCE) {
        query = query.is('embedding', null);
    }

    const { count, error: countError } = await query;
    if (countError) throw countError;

    console.log(`Found ${count} articles to process.`);

    let processed = 0;
    let totalErrors = 0;

    while (true) {
        // Process in batches
        let batchQuery = supabase
            .from('articulos')
            .select('id, descripcion, sku, ean13, categoria, precio_compra, proveedor:proveedor_id(nombre)')
            .limit(50)
            .order('id'); // Consistent ordering for pagination if needed

        if (!FORCE) {
            batchQuery = batchQuery.is('embedding', null);
        } else {
            // In force mode, we use offset to avoid re-processing the same ones in the same run
            // though for 700 items simple limit might be risky if we don't track IDs
            batchQuery = batchQuery.range(processed, processed + 49);
        }

        const { data: batch, error: batchError } = await batchQuery;

        if (batchError) {
            console.error("Batch error:", batchError);
            break;
        }

        if (!batch || batch.length === 0) break;

        console.log(`Processing batch of ${batch.length}...`);

        for (const article of batch) {
            if (!article.descripcion) {
                console.log(`Skipping article ${article.id} (no description)`);
                continue;
            }

            try {
                const model = genAI.getGenerativeModel({ model: "models/gemini-embedding-001" });

                const p: any = article;
                const proveedorNombre = Array.isArray(p.proveedor) ? p.proveedor[0]?.nombre : p.proveedor?.nombre;

                // New WEIGHTED text: repeat description to give it more signal than provider
                const textToEmbed = `
            Producto: ${p.descripcion}
            Descripción: ${p.descripcion}
            SKU: ${p.sku || ""}
            Proveedor: ${proveedorNombre || ""}
            Categoría: ${p.categoria || ""}
        `.trim().replace(/\n/g, " ");

                const result = await model.embedContent(textToEmbed);
                const embedding = result.embedding.values;

                const { error: updateError } = await supabase
                    .from('articulos')
                    .update({ embedding })
                    .eq('id', article.id);

                if (updateError) throw updateError;

            } catch (e) {
                console.error(`Error processing ${article.id}:`, e);
                totalErrors++;
            }
        }

        processed += batch.length;
        console.log(`Progress: ${processed}/${count}`);

        // Stop if we've reached the count or no more results
        if (processed >= (count || 0)) break;
    }

    console.log(`Backfill complete! Processed: ${processed}, Errors: ${totalErrors}`);
}

main().catch(console.error);
