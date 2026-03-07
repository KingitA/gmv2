
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
    console.error("Faltan variables de entorno SUPABASE_URL o SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function checkData() {
    console.log("Chequeando articulos con proveedor...");

    // 1. Contar total articulos
    const { count: total, error: err1 } = await supabase.from("articulos").select("*", { count: "exact", head: true });
    if (err1) console.error("Error contando articulos:", err1.message);
    else console.log(`Total Articulos: ${total}`);

    // 2. Contar articulos con proveedor (join inner)
    const { count: conProveedor, error: err2 } = await supabase.from("articulos").select("*, proveedor:proveedores!inner(*)", { count: "exact", head: true });
    if (err2) console.error("Error contando con proveedor:", err2.message);
    else console.log(`Articulos con Proveedor asignado (!inner): ${conProveedor}`);

    // 3. Ver estructura de un articulo de ejemplo
    const { data: example } = await supabase.from("articulos").select("*, proveedor:proveedores(*)").limit(1).single();
    // console.log("Ejemplo de articulo:", example);
}

checkData();
