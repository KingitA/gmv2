
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), ".env.local");
const envConfig = fs.readFileSync(envPath, "utf-8").split("\n").reduce((acc, line) => {
    const [key, val] = line.split("=");
    if (key && val) acc[key.trim()] = val.trim();
    return acc;
}, {} as Record<string, string>);

const supabase = createClient(envConfig["NEXT_PUBLIC_SUPABASE_URL"]!, envConfig["SUPABASE_SERVICE_ROLE_KEY"]!);

async function checkDistinctValues() {
    const cols = ['condicion_pago', 'condicion_entrega', 'metodo_facturacion', 'condicion_iva'];

    for (const col of cols) {
        // Supabase no tiene distinct() directo simple en JS client para arrays de strings facilmente sin rpc o select
        // Hacemos un fetch de todos (o limit 1000) y filtramos en JS para rapido
        const { data } = await supabase.from("clientes").select(col).limit(1000);
        if (data) {
            const values = [...new Set(data.map(d => d[col]).filter(Boolean))];
            console.log(`\nDISTINCT ${col}:`, values);
        }
    }
}

checkDistinctValues();
