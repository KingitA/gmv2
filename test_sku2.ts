import { createClient } from "@supabase/supabase-js"
import * as fs from 'fs'

const envStr = fs.readFileSync(".env.local", "utf-8")
const SUPABASE_URL = envStr.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1] || ""
const SUPABASE_KEY = envStr.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1] || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function test() {
    const { data, error } = await supabase
        .from("articulos")
        .select("*")
        .limit(1)
    console.log("schema:", data, error)
}
test()
