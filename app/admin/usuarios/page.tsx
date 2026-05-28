"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { crearUsuario } from "@/lib/actions/admin/crear-usuario"
import { editarRolesUsuario } from "@/lib/actions/admin/editar-roles-usuario"
import { resetPasswordAdmin } from "@/lib/actions/admin/reset-password-admin"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Plus, Users, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Pencil } from "lucide-react"

const TODOS_LOS_ROLES = [
  { value: "admin",          label: "Admin",          desc: "Acceso total" },
  { value: "administrativo", label: "Administrativo", desc: "ERP sin finanzas/depósito" },
  { value: "deposito",       label: "Depósito",       desc: "Solo módulo depósito" },
  { value: "chofer",         label: "Chofer",         desc: "Solo módulo chofer" },
  { value: "viajante",       label: "Viajante",       desc: "En desarrollo" },
]

const ROL_COLORS: Record<string, string> = {
  admin:          "bg-purple-100 text-purple-700",
  administrativo: "bg-blue-100 text-blue-700",
  deposito:       "bg-orange-100 text-orange-700",
  chofer:         "bg-green-100 text-green-700",
  viajante:       "bg-teal-100 text-teal-700",
}

type Usuario = {
  id: string
  email: string
  nombre: string
  estado: string
  debe_cambiar_password: boolean
  created_at: string
  roles: string[]
}

function RolCheckboxes({ selected, onChange, disabled }: {
  selected: string[]
  onChange: (roles: string[]) => void
  disabled?: boolean
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(r => r !== v) : [...selected, v])

  return (
    <div className="grid grid-cols-1 gap-2">
      {TODOS_LOS_ROLES.map(r => (
        <label key={r.value} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${selected.includes(r.value) ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
          <input
            type="checkbox"
            checked={selected.includes(r.value)}
            onChange={() => !disabled && toggle(r.value)}
            disabled={disabled}
            className="accent-indigo-600 w-4 h-4 flex-shrink-0"
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800">{r.label}</div>
            <div className="text-xs text-slate-500">{r.desc}</div>
          </div>
        </label>
      ))}
    </div>
  )
}

export default function UsuariosPage() {
  const sb = createClient()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)

  // Nuevo usuario
  const [openNuevo, setOpenNuevo] = useState(false)
  const [nombre, setNombre] = useState("")
  const [rolesNuevo, setRolesNuevo] = useState<string[]>(["administrativo"])
  const [password, setPassword] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [savingNuevo, setSavingNuevo] = useState(false)
  const [errorNuevo, setErrorNuevo] = useState("")
  const [okNuevo, setOkNuevo] = useState(false)

  // Editar roles
  const [editTarget, setEditTarget] = useState<Usuario | null>(null)
  const [rolesEdit, setRolesEdit] = useState<string[]>([])
  const [savingEdit, setSavingEdit] = useState(false)
  const [errorEdit, setErrorEdit] = useState("")

  // Reset password
  const [resetTarget, setResetTarget] = useState<Usuario | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [showNewPass, setShowNewPass] = useState(false)
  const [savingReset, setSavingReset] = useState(false)
  const [errorReset, setErrorReset] = useState("")
  const [okReset, setOkReset] = useState(false)

  const fetchUsuarios = async () => {
    setLoading(true)
    const { data: users } = await sb
      .from("usuarios")
      .select("id, email, nombre, estado, debe_cambiar_password, created_at")
      .order("created_at", { ascending: false })

    if (!users) { setLoading(false); return }

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

  // Crear usuario
  const resetNuevo = () => { setNombre(""); setRolesNuevo(["administrativo"]); setPassword(""); setErrorNuevo(""); setOkNuevo(false) }

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorNuevo("")
    if (rolesNuevo.length === 0) { setErrorNuevo("Seleccioná al menos un rol"); return }
    if (password.length < 6) { setErrorNuevo("La contraseña temporal debe tener al menos 6 caracteres"); return }
    setSavingNuevo(true)
    try {
      await crearUsuario({ nombre, roles: rolesNuevo, passwordTemporal: password })
      setOkNuevo(true)
      await fetchUsuarios()
      setTimeout(() => { setOpenNuevo(false); resetNuevo() }, 1200)
    } catch (err: any) {
      setErrorNuevo(err.message || "Error al crear usuario")
    } finally {
      setSavingNuevo(false)
    }
  }

  // Editar roles
  const openEdit = (u: Usuario) => { setEditTarget(u); setRolesEdit([...u.roles]); setErrorEdit("") }

  const handleEditRoles = async () => {
    if (!editTarget) return
    setErrorEdit("")
    if (rolesEdit.length === 0) { setErrorEdit("Seleccioná al menos un rol"); return }
    setSavingEdit(true)
    try {
      await editarRolesUsuario(editTarget.id, rolesEdit)
      await fetchUsuarios()
      setEditTarget(null)
    } catch (err: any) {
      setErrorEdit(err.message || "Error al editar roles")
    } finally {
      setSavingEdit(false)
    }
  }

  // Reset password
  const openReset = (u: Usuario) => { setResetTarget(u); setNewPassword(""); setShowNewPass(false); setErrorReset(""); setOkReset(false) }

  const handleReset = async () => {
    if (!resetTarget) return
    setErrorReset("")
    if (newPassword.length < 6) { setErrorReset("La contraseña debe tener al menos 6 caracteres"); return }
    setSavingReset(true)
    try {
      await resetPasswordAdmin(resetTarget.id, newPassword)
      setOkReset(true)
      await fetchUsuarios()
      setTimeout(() => setResetTarget(null), 1500)
    } catch (err: any) {
      setErrorReset(err.message || "Error al resetear contraseña")
    } finally {
      setSavingReset(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-slate-600" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Usuarios del Sistema</h1>
            <p className="text-sm text-slate-500">Gestión de accesos y roles</p>
          </div>
        </div>
        <Button onClick={() => { resetNuevo(); setOpenNuevo(true) }} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo Usuario
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />Cargando...
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Nombre</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Roles</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Estado</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Acceso</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usuarios.map(u => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{u.nombre}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {u.roles.map(r => (
                        <span key={r} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${ROL_COLORS[r] || "bg-slate-100 text-slate-600"}`}>
                          {r}
                        </span>
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
                        <KeyRound className="h-3 w-3" />Pendiente cambio
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">OK</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => openEdit(u)}
                        title="Editar roles"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => openReset(u)}
                        title="Resetear contraseña"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                    </div>
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

      {/* Dialog: Nuevo Usuario */}
      <Dialog open={openNuevo} onOpenChange={v => { if (!v) resetNuevo(); setOpenNuevo(v) }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Nuevo Usuario</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCrear} className="space-y-4 pt-2">
            {errorNuevo && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{errorNuevo}
              </div>
            )}
            {okNuevo && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2.5 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0" />Usuario creado correctamente
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Nombre de usuario</Label>
              <Input value={nombre} onChange={e => setNombre(e.target.value)} required disabled={savingNuevo || okNuevo} placeholder="Ej: juancito" autoComplete="off" />
              <p className="text-xs text-slate-500">Con este nombre va a ingresar al sistema.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Roles</Label>
              <RolCheckboxes selected={rolesNuevo} onChange={setRolesNuevo} disabled={savingNuevo || okNuevo} />
            </div>
            <div className="space-y-1.5">
              <Label>Contraseña temporal</Label>
              <div className="relative">
                <Input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={savingNuevo || okNuevo}
                  placeholder="Mínimo 6 caracteres"
                  className="pr-10"
                />
                <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" tabIndex={-1}>
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-slate-500">El usuario deberá cambiarla en su primer acceso.</p>
            </div>
            <div className="flex gap-2 pt-2 border-t">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setOpenNuevo(false)} disabled={savingNuevo}>Cancelar</Button>
              <Button type="submit" className="flex-1 gap-2" disabled={savingNuevo || okNuevo}>
                {savingNuevo ? <><Loader2 className="h-4 w-4 animate-spin" />Creando...</> : "Crear Usuario"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Editar Roles */}
      <Dialog open={!!editTarget} onOpenChange={v => { if (!v) setEditTarget(null) }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Editar Roles — {editTarget?.nombre}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {errorEdit && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{errorEdit}
              </div>
            )}
            <RolCheckboxes selected={rolesEdit} onChange={setRolesEdit} disabled={savingEdit} />
            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setEditTarget(null)} disabled={savingEdit}>Cancelar</Button>
              <Button className="flex-1 gap-2" onClick={handleEditRoles} disabled={savingEdit}>
                {savingEdit ? <><Loader2 className="h-4 w-4 animate-spin" />Guardando...</> : "Guardar Roles"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: Reset Password */}
      <Dialog open={!!resetTarget} onOpenChange={v => { if (!v) setResetTarget(null) }}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Resetear Contraseña — {resetTarget?.nombre}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {errorReset && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{errorReset}
              </div>
            )}
            {okReset && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2.5 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0" />Contraseña reseteada. El usuario deberá cambiarla al ingresar.
              </div>
            )}
            {!okReset && (
              <>
                <p className="text-sm text-slate-600">Ingresá la nueva contraseña temporal para <strong>{resetTarget?.email}</strong>. El usuario deberá cambiarla al ingresar.</p>
                <div className="space-y-1.5">
                  <Label>Nueva contraseña temporal</Label>
                  <div className="relative">
                    <Input
                      type={showNewPass ? "text" : "password"}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      disabled={savingReset}
                      placeholder="Mínimo 6 caracteres"
                      className="pr-10"
                    />
                    <button type="button" onClick={() => setShowNewPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" tabIndex={-1}>
                      {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 pt-2 border-t">
                  <Button variant="outline" className="flex-1" onClick={() => setResetTarget(null)} disabled={savingReset}>Cancelar</Button>
                  <Button className="flex-1 gap-2 bg-amber-600 hover:bg-amber-700" onClick={handleReset} disabled={savingReset || !newPassword}>
                    {savingReset ? <><Loader2 className="h-4 w-4 animate-spin" />Reseteando...</> : "Resetear"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
