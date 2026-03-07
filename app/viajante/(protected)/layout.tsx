
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { LogOut, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { logoutViajante } from "@/lib/actions/viajante-auth"

export default async function ViajanteLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect("/viajante/login")
    }

    // Verify role
    const { data: profile } = await supabase
        .from("usuarios_crm")
        .select("*")
        .eq("email", user.email)
        .single()

    if (!profile || (profile.rol !== "viajante" && profile.rol !== "vendedor")) {
        // If logged in but not viajante/vendedor, sign out and go to login
        await supabase.auth.signOut()
        redirect("/viajante/login")
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-white px-4 shadow-sm md:px-6">
                <Link href="/viajante" className="flex items-center gap-2 font-bold text-lg md:text-xl text-primary">
                    <span className="truncate">Portal Viajante</span>
                </Link>
                <div className="ml-auto flex items-center gap-4">
                    <div className="hidden md:flex flex-col items-end">
                        <span className="text-sm font-medium">{profile.nombre}</span>
                        <span className="text-xs text-muted-foreground">{profile.email}</span>
                    </div>
                    <form action={logoutViajante}>
                        <Button variant="ghost" size="icon" title="Cerrar sesión">
                            <LogOut className="h-5 w-5" />
                            <span className="sr-only">Cerrar sesión</span>
                        </Button>
                    </form>
                </div>
            </header>
            <main className="container mx-auto p-4 md:p-6">
                {children}
            </main>
        </div>
    )
}
