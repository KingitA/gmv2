import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// 19/10/2026 (regla del dueño): la billetera es SOLO la plata de la empresa en
// la mano. Comisiones, retiros, sueldos y ajustes van a la CUENTA PERSONAL del
// empleado (su cuenta de cliente; lib/cuenta-corriente/cuenta-personal.ts). El
// camino viejo (retiro marcando comisiones pagadas / movimiento manual de
// billetera) mezclaba las dos cosas y quedó dado de baja. Historial en git.
export async function POST() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  return NextResponse.json(
    {
      error:
        "Los retiros, sueldos y ajustes del personal ahora se cargan en su CUENTA PERSONAL (Clientes → Cuentas del personal → cuenta corriente → Ajuste). La billetera queda solo para la plata de la empresa en la mano.",
      error_code: "USAR_CUENTA_PERSONAL",
    },
    { status: 410 },
  )
}
