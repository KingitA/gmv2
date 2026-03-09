'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export function LogoutButton() {
    const router = useRouter()

    const handleLogout = async () => {
        const supabase = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )
        await supabase.auth.signOut()
        router.push('/auth/login')
    }

    return (
        <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
            title="Cerrar sesión"
        >
            <LogOut className="h-4 w-4" />
            SALIR
        </button>
    )
}
