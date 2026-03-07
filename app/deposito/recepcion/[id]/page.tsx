import { createClient } from "@/lib/supabase/server"
import { redirect } from 'next/navigation'
import { RecepcionProcess } from "@/components/deposito-recepcion/recepcion-process"

export default async function RecepcionDetallePage({ params }: { params: Promise<{ id: string }> }) {
    const supabase = await createClient()
    const { id } = await params

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect("/deposito/login")
    }

    // Get user profile with role
    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle()

    if (!profile || profile.rol !== "deposito") {
        redirect("/deposito")
    }

    return (
        <div className="min-h-screen bg-background">
            <RecepcionProcess recepcionId={id} userId={user.id} />
        </div>
    )
}
