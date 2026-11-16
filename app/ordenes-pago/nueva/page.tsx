import Link from "next/link"
import NuevaOrdenPagoPage from "./NuevaOPClient"
import { getCurrentUserWithRoles, tienePermiso } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Armar una orden de pago es solo de admin (lib/auth.ts → PERMISOS.ordenes_pago).
// Se corta al entrar: antes un usuario sin permiso llenaba todo y recién fallaba al guardar.
export default async function Page() {
    const usuario = await getCurrentUserWithRoles()
    if (!usuario || !tienePermiso(usuario.roles, "ordenes_pago")) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-6">
                <div className="max-w-md rounded-xl border bg-white p-6 text-center space-y-3">
                    <h1 className="text-lg font-bold">No tenés permiso para armar órdenes de pago</h1>
                    <p className="text-sm text-muted-foreground">
                        Las órdenes de pago a proveedores las arma y las confirma solo un administrador.
                        Si hay que pagar algo, avisale a quien administra.
                    </p>
                    <Link href="/vencimientos" className="inline-block text-sm font-medium text-blue-700 underline">
                        Volver a Pagos y vencimientos
                    </Link>
                </div>
            </div>
        )
    }
    return <NuevaOrdenPagoPage />
}
