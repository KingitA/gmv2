
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

// ID del cliente en la URL de la captura o uno conocido
// Voy a listar los primeros 5 clientes para ver el formato de los datos
async function checkClientesData() {
    const { data, error } = await supabase.from("clientes").select("*").limit(5);
    if (error) console.error(error);
    else console.log(JSON.stringify(data, null, 2));
}

checkClientesData();
