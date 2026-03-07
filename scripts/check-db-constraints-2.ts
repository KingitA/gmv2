
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
    console.log("Testing more states...");
    const states = ["confirmado", "enviado", "entregado", "cancelado", "archivado"];

    for (const st of states) {
        const { error } = await supabase.from("pedidos").insert({
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
