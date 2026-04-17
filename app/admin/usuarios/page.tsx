"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { crearUsuario } from "@/lib/actions/admin/crear-usuario"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Plus, Users, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound } from "lucide-react"

type Usuario = {
    id: string
    email: string
    nombre: string
    estado: string
    debe_cambiar_password: boolean
    created_at: string
    roles: string[]
}

export default function UsuariosPage() {
    const sb = createClient()
    const [usuarios, setUsuarios] = useState<Usuario[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState(false)

    // Form state
    const [nombre, setNombre] = useState("")
    const [email, setEmail] = useState("")
    const [rol, setRol] = useState<"admin" | "vendedor">("vendedor")
    const [password, setPassword] = useState("")
    const [showPass, setShowPass] = useState(false)
    const [saving, setSaving] = useState(false)
    const [formError, setFormError] = useState("")
    const [formOk, setFormOk] = useState(false)

    const fetchUsuarios = async () => {
        setLoading(true)
        const { data: users } = await sb
            .from("usuarios")
            .select("id, email, nombre, estado, debe_cambiar_password, created_at")
            .order("created_at", { ascending: false })

        if (!users) { setLoading(false); return }

        // Fetch roles for each user
        const { data: rolesData } = await sb
            .from("usuarios_roles")
            .select("usuario_id, roles(nombre)")
            .in("usuario_id", users.map(u => u.id))

        const rolesMap: Record<string, string[]> = {}
        for (const r of (rolesData || [])) {
            if (!rolesMap[r.usuario_id]) rolesMap[r.usuario_id] = []
            const rolNombre = (r.roles as any)?.nombre
            if (rolNombre) rolesMap[r.usuario_id].push(rolNombre)
        }

        setUsuarios(users.map(u => ({ ...u, roles: rolesMap[u.id] || [] })))
        setLoading(false)
    }

    useEffect(() => { fetchUsuarios() }, [])

    const resetForm = () => {
        setNombre("")
        setEmail("")
        setRol("vendedor")
        setPassword("")
        setFormError("")
        setFormOk(false)
    }

    const handleCrear = async (e: React.FormEvent) => {
        e.preventDefault()
        setFormError("")
        if (password.length < 6) { setFormError("La contraseña temporal debe tener al menos 6 caracteres"); return }
        setSaving(true)
        try {
            await crearUsuario({ email, nombre, rolNombre: rol, passwordTemporal: password })
            setFormOk(true)
            await fetchUsuarios()
            setTimeout(() => { setOpen(false); resetForm() }, 1200)
        } catch (err: any) {
            setFormError(err.message || "Error al crear usuario")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <Users className="h-6 w-6 text-slate-600" />
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">Usuarios del Sistema</h1>
                        <p className="text-sm text-slate-500">Gestión de accesos y roles</p>
                    </div>
                </div>
                <Button onClick={() => { resetForm(); setOpen(true) }} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Nuevo Usuario
                </Button>
            </div>

            {/* Tabla */}
            {loading ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    Cargando...
                </div>
            ) : (
                <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b">
                                <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Nombre</th>
                                <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Email</th>
                                <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Rol</th>
                                <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Estado</th>
                                <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Acceso</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {usuarios.map(u => (
                                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3 font-medium text-slate-800">{u.nombre}</td>
                                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex gap-1 flex-wrap">
                                            {u.roles.map(r => (
                                                <Badge key={r} variant={r === "admin" ? "default" : "secondary"} className="text-xs capitalize">
                                                    {r}
                                                </Badge>
                                            ))}
                                            {u.roles.length === 0 && <span className="text-slate-400 text-xs">Sin rol</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge variant={u.estado === "activo" ? "outline" : "destructive"} className="text-xs">
                                            {u.estado}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3">
                                        {u.debe_cambiar_password ? (
                                            <span className="flex items-center gap-1 text-amber-600 text-xs">
                                                <KeyRound className="h-3 w-3" />
                                                Pendiente cambio de clave
                                            </span>
                                        ) : (
                                            <span className="text-slate-400 text-xs">OK</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {usuarios.length === 0 && (
                        <div className="text-center py-12 text-slate-400 text-sm">No hay usuarios registrados</div>
                    )}
                </div>
            )}

            {/* Dialog Nuevo Usuario */}
            <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v) }}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle>Nuevo Usuario</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleCrear} className="space-y-4 pt-2">
                        {formError && (
                            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
                                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                {formError}
                            </div>
                        )}
                        {formOk && (
                            <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2.5 text-sm">
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                Usuario creado correctamente
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label htmlFor="nombre">Nombre completo</Label>
                            <Input id="nombre" value={nombre} onChange={e => setNombre(e.target.value)} required disabled={saving || formOk} placeholder="Ej: Karina Laumann" />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="email">Email</Label>
                            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={saving || formOk} placeholder="usuario@ejemplo.com" />
                        </div>

                        <div className="space-y-1.5">
                            <Label>Rol</Label>
                            <Select value={rol} onValueChange={(v: any) => setRol(v)} disabled={saving || formOk}>
                                <SelectTrigger className="h-9">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="vendedor">Vendedor</SelectItem>
                                    <SelectItem value="admin">Admin</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="password">Contraseña temporal</Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPass ? "text" : "password"}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    disabled={saving || formOk}
                                    placeholder="Mínimo 6 caracteres"
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPass(v => !v)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    tabIndex={-1}
                                >
                                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            <p className="text-xs text-slate-500">El usuario deberá cambiarla en su primer acceso.</p>
                        </div>

                        <div className="flex gap-2 pt-2 border-t">
                            <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={saving}>
                                Cancelar
                            </Button>
                            <Button type="submit" className="flex-1 gap-2" disabled={saving || formOk}>
                                {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Creando...</> : "Crear Usuario"}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
