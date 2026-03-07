
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Manually parse .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
const envConfig = fs.readFileSync(envPath, "utf-8").split("\n").reduce((acc, line) => {
    const [key, val] = line.split("=");
    if (key && val) acc[key.trim()] = val.trim();
    return acc;
}, {} as Record<string, string>);

const supabaseUrl = envConfig["NEXT_PUBLIC_SUPABASE_URL"];
const serviceKey = envConfig["SUPABASE_SERVICE_ROLE_KEY"];

if (!supabaseUrl || !serviceKey) {
    console.error("Missing credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function checkVendedores() {
    console.log("--- VENDEDORES ---");
    const { data: vendedores, error } = await supabase.from("vendedores").select("*");
    if (error) console.error("Error fetching vendedores:", error.message);
    else console.table(vendedores);

    console.log("--- USUARIOS CRM ---");
    const { data: usuarios, error: err2 } = await supabase.from("usuarios_crm").select("*");
    if (err2) console.error("Error fetching usuarios_crm:", err2.message);
    else console.table(usuarios);

    // Verify 'pedidos' table structure for draft status
    console.log("--- TABLA PEDIDOS (Sample) ---");
    const { data: pedidos } = await supabase.from("pedidos").select("*").limit(1);
    console.log(pedidos);
}

checkVendedores();
