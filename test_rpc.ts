import { createClient } from "@supabase/supabase-js"
import * as fs from 'fs'

const envStr = fs.readFileSync(".env.local", "utf-8")
const SUPABASE_URL = envStr.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1] || ""
const SUPABASE_KEY = envStr.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1] || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function test() {
    const { data, error } = await supabase.rpc("match_documents", {
        query_embedding: Array(768).fill(0),
        match_threshold: 0,
        match_count: 1,
    })
    if (data && data.length > 0) {
        console.log("Vector match columns:", Object.keys(data[0]))
    } else {
        console.log(error)
    }
}
test()
