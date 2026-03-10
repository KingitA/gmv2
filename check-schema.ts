import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: 'C:/Users/Usuario/.gemini/antigravity/scratch/gmv2/.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  const { data: pedidosColumns } = await supabase.rpc('get_table_columns_by_name', { table_name: 'pedidos' }).catch(() => ({ data: 'rpc get_table_columns_by_name failed' }))
  console.log('pedidos columns rpc:', pedidosColumns)

  // fallback if rpc doesn't exist: insert a bad record to see error, or select 1 row to see shape
  const { data: p } = await supabase.from('pedidos').select('*').limit(1)
  console.log('pedidos sample:', p?.[0] ? Object.keys(p[0]) : 'no data')

  const { data: pd } = await supabase.from('pedidos_detalle').select('*').limit(1)
  console.log('pedidos_detalle sample:', pd?.[0] ? Object.keys(pd[0]) : 'no data')
}

main()
