import { createClient } from "@supabase/supabase-js"
import * as fs from 'fs'

const envStr = fs.readFileSync(".env.local", "utf-8")
const SUPABASE_URL = envStr.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1] || ""
const SUPABASE_KEY = envStr.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1] || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function test() {
    console.log("Searching for sku 338613...")
    const { data, error } = await supabase
        .from("articulos")
        .select("id, descripcion, sku, precio_base")
        .ilike("sku", "%338613%")
    console.log("ilike sku:", data, error)

    const { data: d2 } = await supabase
        .from("articulos")
        .select("id, descripcion, sku")
        .ilike("descripcion", "%338613%")
    console.log("ilike descripcion:", d2)
}
test()
