import fs from 'fs'
import path from 'path'

// load env vars from .env.local manually
const envPath = path.resolve('C:/Users/Usuario/.gemini/antigravity/scratch/gmv2/.env.local')
const envOutput = fs.readFileSync(envPath, 'utf8')
const envKeys: Record<string, string> = {}
envOutput.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) envKeys[match[1]] = match[2].trim()
})

const supabaseUrl = envKeys['NEXT_PUBLIC_SUPABASE_URL']
const supabaseKey = envKeys['SUPABASE_SERVICE_ROLE_KEY']

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing keys')
  process.exit(1)
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(supabaseUrl, supabaseKey)

  // order 000050
  const { data: p, error: pe } = await sb.from('pedidos').select('*').eq('numero_pedido', 50).single()
  console.log('PEDIDO:', p)
  if (pe) console.log('ERROR:', pe)

  if (p) {
    const { data: pd, error: pde } = await sb.from('pedidos_detalle').select('*, articulos(*)').eq('pedido_id', p.id)
    console.log('DETALLES:', JSON.stringify(pd, null, 2))
    if (pde) console.log('PD-ERROR:', pde)
  }
}
main()
