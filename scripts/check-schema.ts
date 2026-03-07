
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
    console.error("Missing credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function checkSchema() {
    console.log("--- PEDIDOS COLUMNS ---");
    const { data: pedidos, error } = await supabase.from("pedidos").select("*").limit(1);
    if (error) console.error("Error fetching pedidos:", error);
    else if (pedidos.length > 0) console.log(Object.keys(pedidos[0]));
    else console.log("Pedidos table empty or read successfully but no data.");

    console.log("--- PEDIDO_ITEMS ---");
    // Try selecting from pedido_items
    const { data: items, error: itemsError } = await supabase.from("pedido_items").select("*").limit(1);
    if (itemsError) {
        console.error("Error access 'pedido_items':", itemsError.message);
        // Try 'items_pedido' or 'detalles_pedido' just in case
        console.log("Trying 'items_pedidos'...");
        const { error: err2 } = await supabase.from("items_pedidos").select("*").limit(1);
        if (err2) console.log("Error access 'items_pedidos':", err2.message);
    } else {
        console.log("pedido_items exists. Columns:", items.length > 0 ? Object.keys(items[0]) : "No data");
    }
}

checkSchema();
