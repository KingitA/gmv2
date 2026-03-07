
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

async function checkDetalleColumns() {
    const { data: items, error } = await supabase.from("pedidos_detalle").select("*").limit(1);
    if (error) console.error(error);
    else console.log(items.length > 0 ? Object.keys(items[0]) : "Table empty but exists");
}

checkDetalleColumns();
