
import { createClient } from "@/lib/supabase/server"
import { notFound, redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { PedidoWizard } from "@/components/viajante/pedido-wizard"

export default async function NuevaPedidoPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const supabase = await createClient()

    // Verify User
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/viajante/login")

    // Get Actual Salesperson ID (CRM ID)
    // The auth.users.id is NOT the vendedor_id in the database.
    // We need to find the record in 'usuarios_crm' or 'vendedores' that matches this email.
    const { data: crmUser } = await supabase
        .from("usuarios_crm")
        .select("id, vendedor_id") // Fetch vendedor_id too
        .eq("email", user.email)
        .single()

    const vendedorId = crmUser?.vendedor_id || crmUser?.id || user.id

    // Get Client
    const { data: cliente } = await supabase
        .from("clientes")
        .select("*, vendedor:vendedores(*), localidad:localidades(zona:zonas(*))")
        .eq("id", id)
        .single()

    if (!cliente) notFound()

    return (
        <div className="space-y-6 h-full flex flex-col">
            <div className="flex items-center gap-4 shrink-0">
                <Button variant="ghost" size="icon" asChild>
                    <Link href={`/viajante/clientes/${id}`}>
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">Nuevo Pedido</h1>
                    <p className="text-muted-foreground text-sm">
                        {cliente.razon_social}
                    </p>
                </div>
            </div>

            <div className="flex-1">
                {/* The Wizard handles the state of the order creation */}
                {/* Pass the correct vendedorId found in CRM table */}
                <PedidoWizard cliente={cliente} userId={vendedorId} />
            </div>
        </div>
    )
}
