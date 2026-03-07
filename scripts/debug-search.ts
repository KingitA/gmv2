import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';

// Manual .env parser
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.join('=').trim().replace(/^["']|["']$/g, '');
        }
    });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const geminiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY!;

console.log("--- DEBUGGER START ---");
console.log("Supabase URL:", supabaseUrl ? "OK" : "MISSING");
console.log("Service Key:", serviceKey ? "OK" : "MISSING");
console.log("Gemini Key:", geminiKey ? "OK" : "MISSING");

if (!supabaseUrl || !serviceKey || !geminiKey) {
    console.error("Missing credentials. Aborting.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);
const genAI = new GoogleGenerativeAI(geminiKey);

async function runDebug() {
    const searchTerm = "carefree";
    console.log(`\nTesting search for term: "${searchTerm}"...`);

    try {
        // 1. Generate Embedding
        console.log("1. Generating embedding with models/gemini-embedding-001...");
        const model = genAI.getGenerativeModel({ model: "models/gemini-embedding-001" });
        const result = await model.embedContent(searchTerm);
        const embedding = result.embedding.values;
        console.log(`   Embedding generated. Length: ${embedding.length} (Expected: 3072)`);

        // 2. Vector Search RPC
        console.log("2. Calling match_documents RPC...");
        const { data: vectorResults, error: rpcError } = await supabase.rpc("match_documents", {
            query_embedding: embedding,
            match_threshold: 0.1, // Very low threshold to ensure matches
            match_count: 50,
        });

        if (rpcError) {
            console.error("   RPC Error:", rpcError);
        } else {
            console.log(`\n   --- VECTOR SEARCH MATCHES (RPC) ---`);
            console.log(`   Found ${vectorResults?.length || 0} matches with threshold 0.1:`);
            if (vectorResults && vectorResults.length > 0) {
                vectorResults.forEach((r: any, i: number) => {
                    console.log(`   ${i + 1}. [Sim: ${r.similarity.toFixed(4)}] ${r.nombre} (SKU: ${r.sku})`);
                });
            } else {
                console.warn("   No confirmed matches from vector search.");
            }
            console.log(`   -----------------------------------\n`);
        }

        // 3. DB Hydration
        if (vectorResults && vectorResults.length > 0) {
            console.log("3. Hydrating full products from DB...");
            const ids = vectorResults.map((r: any) => r.id);
            const { data: dbProducts, error: dbError } = await supabase
                .from("articulos")
                .select(`
                    id, descripcion, sku, stock_actual, precio_compra, activo,
                    proveedor:proveedores!left(nombre, codigo_proveedor)
                `)
                .in("id", ids);

            if (dbError) {
                console.error("   DB Error:", dbError);
            } else {
                console.log(`   DB Success. Retrieved ${dbProducts?.length || 0} products.`);
                dbProducts?.forEach((p: any) => {
                    console.log(`      - ${p.descripcion} | Prov: ${p.proveedor?.nombre || "NULL"} | Stock: ${p.stock_actual}`);
                });
            }
        }

    } catch (e) {
        console.error("CRITICAL ERROR during process:", e);
    }
    console.log("--- DEBUGGER END ---");
}

runDebug();
