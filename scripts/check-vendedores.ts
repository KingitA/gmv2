
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceKey);

async function checkVendedores() {
    console.log("--- VENDEDORES ---");
    const { data: vendedores, error } = await supabase.from("vendedores").select("*");
    if (error) console.error(error);
    else console.table(vendedores);

    console.log("--- USUARIOS CRM ---");
    const { data: usuarios, error: err2 } = await supabase.from("usuarios_crm").select("*");
    if (err2) console.error(err2);
    else console.table(usuarios);
}

checkVendedores();
