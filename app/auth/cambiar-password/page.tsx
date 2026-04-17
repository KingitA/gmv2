"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { KeyRound, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react"

export default function CambiarPasswordPage() {
    const router = useRouter()
    const sb = createClient()

    const [nueva, setNueva] = useState("")
    const [confirmar, setConfirmar] = useState("")
    const [showNueva, setShowNueva] = useState(false)
    const [showConfirmar, setShowConfirmar] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [ok, setOk] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")

        if (nueva.length < 8) {
            setError("La contraseña debe tener al menos 8 caracteres")
            return
        }
        if (nueva !== confirmar) {
            setError("Las contraseñas no coinciden")
            return
        }

        setLoading(true)
        try {
            // Actualizar contraseña en Supabase Auth
            const { error: authError } = await sb.auth.updateUser({ password: nueva })
            if (authError) throw authError

            // Marcar como cambiada en la tabla usuarios
            const { data: { user } } = await sb.auth.getUser()
            if (user) {
                await sb.from("usuarios").update({ debe_cambiar_password: false }).eq("id", user.id)
            }

            setOk(true)
            setTimeout(() => {
                router.push("/")
                router.refresh()
            }, 1500)
        } catch (err: any) {
            setError(err.message || "Error al cambiar la contraseña")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
            <div className="w-full max-w-md px-4">
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200/60 overflow-hidden">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-8 py-8 text-center">
                        <div className="inline-flex items-center justify-center w-14 h-14 bg-white/10 backdrop-blur-sm rounded-xl mb-4">
                            <KeyRound className="h-7 w-7 text-white" />
                        </div>
                        <h1 className="text-2xl font-bold text-white tracking-tight">Cambiar Contraseña</h1>
                        <p className="text-slate-400 text-sm mt-1">
                            Es tu primer acceso. Elegí una contraseña nueva para continuar.
                        </p>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="px-8 py-8 space-y-5">
                        {error && (
                            <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {ok && (
                            <div className="flex items-start gap-3 bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">
                                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                                <span>Contraseña actualizada. Redirigiendo...</span>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <label htmlFor="nueva" className="block text-sm font-medium text-slate-700">
                                Nueva contraseña
                            </label>
                            <div className="relative">
                                <input
                                    id="nueva"
                                    type={showNueva ? "text" : "password"}
                                    placeholder="Mínimo 8 caracteres"
                                    value={nueva}
                                    onChange={e => setNueva(e.target.value)}
                                    required
                                    disabled={loading || ok}
                                    className="w-full px-4 py-2.5 pr-10 rounded-xl border border-slate-300 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 disabled:bg-slate-50 transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNueva(v => !v)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    tabIndex={-1}
                                >
                                    {showNueva ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label htmlFor="confirmar" className="block text-sm font-medium text-slate-700">
                                Confirmar contraseña
                            </label>
                            <div className="relative">
                                <input
                                    id="confirmar"
                                    type={showConfirmar ? "text" : "password"}
                                    placeholder="Repetí la contraseña"
                                    value={confirmar}
                                    onChange={e => setConfirmar(e.target.value)}
                                    required
                                    disabled={loading || ok}
                                    className="w-full px-4 py-2.5 pr-10 rounded-xl border border-slate-300 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 disabled:bg-slate-50 transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmar(v => !v)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    tabIndex={-1}
                                >
                                    {showConfirmar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading || ok || !nueva || !confirmar}
                            className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white text-sm font-semibold rounded-xl hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Guardando...
                                </>
                            ) : ok ? (
                                <>
                                    <CheckCircle2 className="h-4 w-4" />
                                    Listo
                                </>
                            ) : (
                                "Guardar nueva contraseña"
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    )
}
