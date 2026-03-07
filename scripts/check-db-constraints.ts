
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

async function checkConstraint() {
    // Intento obtener info del constraint
    // A veces no se puede leer information_schema directo por permisos, pero probemos.
    // Sino, intentaremos insertar valores comunes y ver cual falla menos... O leer el error completo si pudieramos.

    // Query raw SQL via RPC is restricted usually.
    // We can try to guess by listing column definition?

    console.log("Testing known states...");
    const states = ["Pendiente", "pendiente", "Borrador", "borrador", "En Proceso", "Completado", "Cancelado"];

    for (const st of states) {
        // Hacemos un insert dummy que fallara por otros motivos (ej foreign keys) pero si pasa el check de estado, el error será diferente.
        const { error } = await supabase.from("pedidos").insert({
            // random UUIDs that likely dont exist, so FK error expected
            cliente_id: "00000000-0000-0000-0000-000000000000",
            vendedor_id: "00000000-0000-0000-0000-000000000000",
            fecha: new Date().toISOString(),
            estado: st,
            total: 0,
            numero_pedido: "TEST-" + st
        });

        if (error) {
            if (error.message.includes("pedidos_estado_check")) {
                console.log(`❌ State '${st}' VIOLATES constraint.`);
            } else {
                console.log(`✅ State '${st}' seems VALID (Error was: ${error.message})`);
            }
        }
    }
}

checkConstraint();
