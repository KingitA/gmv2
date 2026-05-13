import { createClient } from "@/lib/supabase/server"
import Link from "next/link"

function ars(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n)
}

export default async function ViajantesPage() {
  const supabase = await createClient()

  const { data: vendedores } = await supabase
    .from("vendedores")
    .select("id, nombre, comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus, activo")
    .eq("activo", true)
    .order("nombre")

  // Balance y comisiones pendientes por viajante
  const viajantesIds = (vendedores ?? []).map(v => v.id)

  const { data: balances } = await supabase
    .from("billetera_movimientos")
    .select("viajante_id, monto")
    .in("viajante_id", viajantesIds)

  const { data: comisionesPendientes } = await supabase
    .from("comisiones")
    .select("viajante_id, monto")
    .in("viajante_id", viajantesIds)
    .eq("tipo", "cobrada")
    .eq("pagado", false)

  const balanceMap = new Map<string, number>()
  for (const m of balances ?? []) {
    balanceMap.set(m.viajante_id, (balanceMap.get(m.viajante_id) ?? 0) + Number(m.monto))
  }

  const pendienteMap = new Map<string, number>()
  for (const c of comisionesPendientes ?? []) {
    pendienteMap.set(c.viajante_id, (pendienteMap.get(c.viajante_id) ?? 0) + Number(c.monto))
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Viajantes</h1>
        <p className="text-white/40 text-sm mt-1">Billeteras y comisiones de vendedores</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(vendedores ?? []).map(v => {
          const balance = balanceMap.get(v.id) ?? 0
          const pendiente = pendienteMap.get(v.id) ?? 0
          return (
            <Link
              key={v.id}
              href={`/viajantes/${v.id}`}
              className="block rounded-xl p-5 transition-all hover:scale-[1.01]"
              style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="font-semibold text-white text-base">{v.nombre}</p>
                  <p className="text-white/30 text-xs mt-0.5">
                    L/B {v.comision_limpieza_bazar ?? 0}% · P0 {v.comision_perfumeria_0 ?? 0}% · P+ {v.comision_perfumeria_plus ?? 0}%
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                  Activo
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/40 text-xs">Balance billetera</span>
                  <span className={`font-mono font-bold text-sm ${balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {ars(balance)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/40 text-xs">Comisiones pendientes</span>
                  <span className={`font-mono text-sm ${pendiente > 0 ? 'text-amber-400 font-semibold' : 'text-white/20'}`}>
                    {pendiente > 0 ? ars(pendiente) : '—'}
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
