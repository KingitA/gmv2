"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, UserCheck, UserX, Eye, Clock, CheckCircle2, XCircle, AlertCircle, Pencil, Link2 } from "lucide-react"
import { createBrowserClient } from "@supabase/ssr"
import { nowArgentina, todayArgentina } from "@/lib/utils"

type Usuario = {
  id: string
  email: string
  nombre: string
  telefono: string | null
  cuit: string | null
  direccion: string | null
  rol: "pendiente" | "vendedor" | "cliente"
  estado: "pendiente_aprobacion" | "activo" | "rechazado" | "suspendido"
  observaciones: string | null
  motivo_rechazo: string | null
  fecha_registro: string
  fecha_aprobacion: string | null
  usuario_aprobador: string | null
  vendedor_id: string | null
  cliente_id: string | null
}

type Vendedor = {
  id: string
  nombre: string
  email: string
  activo: boolean
}

type Cliente = {
  id: string
  nombre: string
  razon_social: string
  cuit: string
  activo: boolean
}

export default function UsuariosCRMPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [filteredUsuarios, setFilteredUsuarios] = useState<Usuario[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [filterEstado, setFilterEstado] = useState<string>("todos")
  const [filterRol, setFilterRol] = useState<string>("todos")
  const [selectedUsuario, setSelectedUsuario] = useState<Usuario | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [actionType, setActionType] = useState<"aprobar" | "rechazar" | "ver" | "editar">("ver")
  const [rolAsignado, setRolAsignado] = useState<"vendedor" | "cliente">("cliente")
  const [motivoRechazo, setMotivoRechazo] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [loading, setLoading] = useState(false)

  const [editForm, setEditForm] = useState({
    nombre: "",
    email: "",
    telefono: "",
    cuit: "",
    direccion: "",
    rol: "cliente" as "vendedor" | "cliente",
    estado: "activo" as "pendiente_aprobacion" | "activo" | "rechazado" | "suspendido",
    observaciones: "",
    vendedor_id: null as string | null,
    cliente_id: null as string | null,
  })

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  useEffect(() => {
    fetchUsuarios()
    fetchVendedores()
    fetchClientes()
  }, [])

  useEffect(() => {
    filterUsuarios()
  }, [searchTerm, filterEstado, filterRol, usuarios])

  const fetchUsuarios = async () => {
    const { data, error } = await supabase
      .from("usuarios_crm")
      .select("*")
      .order("fecha_registro", { ascending: false })

    if (error) {
      console.error("[v0] Error fetching usuarios:", error)
      return
    }

    setUsuarios(data || [])
  }

  const fetchVendedores = async () => {
    const { data, error } = await supabase
      .from("vendedores")
      .select("id, nombre, email, activo")
      .eq("activo", true)
      .order("nombre")

    if (error) {
      console.error("[v0] Error fetching vendedores:", error)
      return
    }

    setVendedores(data || [])
  }

  const fetchClientes = async () => {
    const { data, error } = await supabase
      .from("clientes")
      .select("id, nombre, razon_social, cuit, activo")
      .eq("activo", true)
      .order("nombre")

    if (error) {
      console.error("[v0] Error fetching clientes:", error)
      return
    }

    setClientes(data || [])
  }

  const filterUsuarios = () => {
    let filtered = usuarios

    if (searchTerm) {
      filtered = filtered.filter(
        (u) =>
          u.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
          u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          u.cuit?.includes(searchTerm),
      )
    }

    if (filterEstado !== "todos") {
      filtered = filtered.filter((u) => u.estado === filterEstado)
    }

    if (filterRol !== "todos") {
      filtered = filtered.filter((u) => u.rol === filterRol)
    }

    setFilteredUsuarios(filtered)
  }

  const handleAprobar = (usuario: Usuario) => {
    setSelectedUsuario(usuario)
    setActionType("aprobar")
    setRolAsignado("cliente")
    setObservaciones("")
    setDialogOpen(true)
  }

  const handleRechazar = (usuario: Usuario) => {
    setSelectedUsuario(usuario)
    setActionType("rechazar")
    setMotivoRechazo("")
    setDialogOpen(true)
  }

  const handleVer = (usuario: Usuario) => {
    setSelectedUsuario(usuario)
    setActionType("ver")
    setDialogOpen(true)
  }

  const handleEditar = (usuario: Usuario) => {
    setSelectedUsuario(usuario)
    setActionType("editar")
    setEditForm({
      nombre: usuario.nombre,
      email: usuario.email,
      telefono: usuario.telefono || "",
      cuit: usuario.cuit || "",
      direccion: usuario.direccion || "",
      rol: usuario.rol === "pendiente" ? "cliente" : usuario.rol,
      estado: usuario.estado,
      observaciones: usuario.observaciones || "",
      vendedor_id: usuario.vendedor_id,
      cliente_id: usuario.cliente_id,
    })
    setDialogOpen(true)
  }

  const confirmarAprobacion = async () => {
    if (!selectedUsuario) return

    setLoading(true)

    try {
      const { error: updateError } = await supabase
        .from("usuarios_crm")
        .update({
          rol: rolAsignado,
          estado: "activo",
          fecha_aprobacion: nowArgentina(),
          usuario_aprobador: "admin",
          observaciones: observaciones || null,
        })
        .eq("id", selectedUsuario.id)

      if (updateError) throw updateError

      await supabase.from("usuarios_crm_historial").insert({
        usuario_id: selectedUsuario.id,
        estado_anterior: selectedUsuario.estado,
        estado_nuevo: "activo",
        rol_anterior: selectedUsuario.rol,
        rol_nuevo: rolAsignado,
        motivo: `Usuario aprobado como ${rolAsignado}. ${observaciones || ""}`,
        usuario_modificador: "admin",
      })

      await fetchUsuarios()
      setDialogOpen(false)
    } catch (error) {
      console.error("[v0] Error aprobando usuario:", error)
      alert("Error al aprobar usuario")
    } finally {
      setLoading(false)
    }
  }

  const confirmarRechazo = async () => {
    if (!selectedUsuario || !motivoRechazo.trim()) {
      alert("Debe ingresar un motivo de rechazo")
      return
    }

    setLoading(true)

    try {
      const { error: updateError } = await supabase
        .from("usuarios_crm")
        .update({
          estado: "rechazado",
          motivo_rechazo: motivoRechazo,
          fecha_aprobacion: nowArgentina(),
          usuario_aprobador: "admin",
        })
        .eq("id", selectedUsuario.id)

      if (updateError) throw updateError

      await supabase.from("usuarios_crm_historial").insert({
        usuario_id: selectedUsuario.id,
        estado_anterior: selectedUsuario.estado,
        estado_nuevo: "rechazado",
        rol_anterior: selectedUsuario.rol,
        rol_nuevo: selectedUsuario.rol,
        motivo: `Usuario rechazado: ${motivoRechazo}`,
        usuario_modificador: "admin",
      })

      await fetchUsuarios()
      setDialogOpen(false)
    } catch (error) {
      console.error("[v0] Error rechazando usuario:", error)
      alert("Error al rechazar usuario")
    } finally {
      setLoading(false)
    }
  }

  const confirmarEdicion = async () => {
    if (!selectedUsuario) return

    if (!editForm.nombre.trim() || !editForm.email.trim()) {
      alert("Nombre y email son obligatorios")
      return
    }

    setLoading(true)

    try {
      const cambios: any = {
        nombre: editForm.nombre.trim(),
        email: editForm.email.trim(),
        telefono: editForm.telefono.trim() || null,
        cuit: editForm.cuit.trim() || null,
        direccion: editForm.direccion.trim() || null,
        rol: editForm.rol,
        estado: editForm.estado,
        observaciones: editForm.observaciones.trim() || null,
        vendedor_id: editForm.vendedor_id,
        cliente_id: editForm.cliente_id,
      }

      if (editForm.estado === "activo" && !selectedUsuario.fecha_aprobacion) {
        cambios.fecha_aprobacion = nowArgentina()
        cambios.usuario_aprobador = "admin"
      }

      const { error: updateError } = await supabase.from("usuarios_crm").update(cambios).eq("id", selectedUsuario.id)

      if (updateError) throw updateError

      await supabase.from("usuarios_crm_historial").insert({
        usuario_id: selectedUsuario.id,
        estado_anterior: selectedUsuario.estado,
        estado_nuevo: editForm.estado,
        rol_anterior: selectedUsuario.rol,
        rol_nuevo: editForm.rol,
        motivo: "Usuario editado manualmente desde el ERP",
        usuario_modificador: "admin",
      })

      await fetchUsuarios()
      setDialogOpen(false)
    } catch (error) {
      console.error("[v0] Error editando usuario:", error)
      alert("Error al editar usuario")
    } finally {
      setLoading(false)
    }
  }

  const getVendedorNombre = (vendedorId: string | null) => {
    if (!vendedorId) return null
    const vendedor = vendedores.find((v) => v.id === vendedorId)
    return vendedor?.nombre
  }

  const getClienteNombre = (clienteId: string | null) => {
    if (!clienteId) return null
    const cliente = clientes.find((c) => c.id === clienteId)
    return cliente?.nombre || cliente?.razon_social
  }

  const getEstadoBadge = (estado: string) => {
    switch (estado) {
      case "pendiente_aprobacion":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
            <Clock className="w-3 h-3 mr-1" />
            Pendiente
          </Badge>
        )
      case "activo":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Activo
          </Badge>
        )
      case "rechazado":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            <XCircle className="w-3 h-3 mr-1" />
            Rechazado
          </Badge>
        )
      case "suspendido":
        return (
          <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
            <AlertCircle className="w-3 h-3 mr-1" />
            Suspendido
          </Badge>
        )
      default:
        return <Badge variant="outline">{estado}</Badge>
    }
  }

  const getRolBadge = (rol: string) => {
    switch (rol) {
      case "vendedor":
        return <Badge className="bg-blue-100 text-blue-800">Vendedor</Badge>
      case "cliente":
        return <Badge className="bg-purple-100 text-purple-800">Cliente</Badge>
      case "pendiente":
        return <Badge variant="secondary">Sin asignar</Badge>
      default:
        return <Badge variant="secondary">{rol}</Badge>
    }
  }

  const pendientesCount = usuarios.filter((u) => u.estado === "pendiente_aprobacion").length

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gestión de Usuarios CRM</h1>
          <p className="text-muted-foreground mt-1">Administra los usuarios registrados desde el CRM</p>
        </div>
        {pendientesCount > 0 && (
          <Badge variant="destructive" className="text-lg px-4 py-2">
            {pendientesCount} pendiente{pendientesCount !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Nombre, email o CUIT..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={filterEstado} onValueChange={setFilterEstado}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendiente_aprobacion">Pendiente</SelectItem>
                  <SelectItem value="activo">Activo</SelectItem>
                  <SelectItem value="rechazado">Rechazado</SelectItem>
                  <SelectItem value="suspendido">Suspendido</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={filterRol} onValueChange={setFilterRol}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendiente">Sin asignar</SelectItem>
                  <SelectItem value="vendedor">Vendedor</SelectItem>
                  <SelectItem value="cliente">Cliente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuarios ({filteredUsuarios.length})</CardTitle>
          <CardDescription>Lista de usuarios registrados desde el CRM</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>CUIT</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha Registro</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsuarios.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No se encontraron usuarios
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsuarios.map((usuario) => (
                    <TableRow key={usuario.id}>
                      <TableCell className="font-medium">{usuario.nombre}</TableCell>
                      <TableCell>{usuario.email}</TableCell>
                      <TableCell>{usuario.cuit || "-"}</TableCell>
                      <TableCell>{getRolBadge(usuario.rol)}</TableCell>
                      <TableCell>{getEstadoBadge(usuario.estado)}</TableCell>
                      <TableCell>{new Date(usuario.fecha_registro).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="sm" onClick={() => handleVer(usuario)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditar(usuario)}
                          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        {usuario.estado === "pendiente_aprobacion" && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleAprobar(usuario)}
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            >
                              <UserCheck className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRechazar(usuario)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <UserX className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl bg-white dark:bg-gray-900">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {actionType === "aprobar" && "Aprobar Usuario"}
              {actionType === "rechazar" && "Rechazar Usuario"}
              {actionType === "ver" && "Detalles del Usuario"}
              {actionType === "editar" && "Editar Usuario"}
            </DialogTitle>
            <DialogDescription className="normal-case">
              {selectedUsuario?.nombre} - {selectedUsuario?.email}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {actionType === "editar" ? (
              <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="normal-case">Nombre *</Label>
                    <Input
                      value={editForm.nombre}
                      onChange={(e) => setEditForm({ ...editForm, nombre: e.target.value })}
                      placeholder="Nombre completo"
                      className="normal-case"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="normal-case">Email *</Label>
                    <Input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      placeholder="email@ejemplo.com"
                      className="normal-case"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="normal-case">Teléfono</Label>
                    <Input
                      value={editForm.telefono}
                      onChange={(e) => setEditForm({ ...editForm, telefono: e.target.value })}
                      placeholder="+54 9 11 1234-5678"
                      className="normal-case"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="normal-case">CUIT</Label>
                    <Input
                      value={editForm.cuit}
                      onChange={(e) => setEditForm({ ...editForm, cuit: e.target.value })}
                      placeholder="20-12345678-9"
                      className="normal-case"
                    />
                  </div>

                  <div className="col-span-2 space-y-2">
                    <Label className="normal-case">Dirección</Label>
                    <Input
                      value={editForm.direccion}
                      onChange={(e) => setEditForm({ ...editForm, direccion: e.target.value })}
                      placeholder="Calle 123, Ciudad"
                      className="normal-case"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="normal-case">Rol *</Label>
                    <Select
                      value={editForm.rol}
                      onValueChange={(v) => setEditForm({ ...editForm, rol: v as "vendedor" | "cliente" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cliente">Cliente</SelectItem>
                        <SelectItem value="vendedor">Vendedor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="normal-case">Estado *</Label>
                    <Select
                      value={editForm.estado}
                      onValueChange={(v) =>
                        setEditForm({
                          ...editForm,
                          estado: v as "pendiente_aprobacion" | "activo" | "rechazado" | "suspendido",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pendiente_aprobacion">Pendiente de Aprobación</SelectItem>
                        <SelectItem value="activo">Activo</SelectItem>
                        <SelectItem value="rechazado">Rechazado</SelectItem>
                        <SelectItem value="suspendido">Suspendido</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {editForm.rol === "vendedor" && (
                    <div className="col-span-2 space-y-2">
                      <Label className="normal-case flex items-center gap-2">
                        <Link2 className="w-4 h-4" />
                        Vincular con Vendedor del ERP
                      </Label>
                      <Select
                        value={editForm.vendedor_id || "sin_vincular"}
                        onValueChange={(v) =>
                          setEditForm({ ...editForm, vendedor_id: v === "sin_vincular" ? null : v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar vendedor..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sin_vincular">Sin vincular</SelectItem>
                          {vendedores.map((vendedor) => (
                            <SelectItem key={vendedor.id} value={vendedor.id}>
                              {vendedor.nombre} - {vendedor.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Vincula este usuario con un vendedor existente en el ERP para que pueda ver sus comisiones y
                        clientes asignados.
                      </p>
                    </div>
                  )}

                  {editForm.rol === "cliente" && (
                    <div className="col-span-2 space-y-2">
                      <Label className="normal-case flex items-center gap-2">
                        <Link2 className="w-4 h-4" />
                        Vincular con Cliente del ERP
                      </Label>
                      <Select
                        value={editForm.cliente_id || "sin_vincular"}
                        onValueChange={(v) => setEditForm({ ...editForm, cliente_id: v === "sin_vincular" ? null : v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar cliente..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sin_vincular">Sin vincular</SelectItem>
                          {clientes.map((cliente) => (
                            <SelectItem key={cliente.id} value={cliente.id}>
                              {cliente.nombre || cliente.razon_social} - {cliente.cuit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Vincula este usuario con un cliente existente en el ERP para que pueda ver su cuenta corriente e
                        historial de compras.
                      </p>
                    </div>
                  )}

                  <div className="col-span-2 space-y-2">
                    <Label className="normal-case">Observaciones</Label>
                    <Textarea
                      value={editForm.observaciones}
                      onChange={(e) => setEditForm({ ...editForm, observaciones: e.target.value })}
                      placeholder="Observaciones adicionales..."
                      rows={3}
                      className="normal-case"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border">
                <div>
                  <Label className="text-xs text-gray-500 dark:text-gray-400 normal-case">Nombre</Label>
                  <p className="font-medium mt-1 normal-case">{selectedUsuario?.nombre}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500 dark:text-gray-400 normal-case">Email</Label>
                  <p className="font-medium mt-1 normal-case">{selectedUsuario?.email}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500 dark:text-gray-400 normal-case">Teléfono</Label>
                  <p className="font-medium mt-1 normal-case">{selectedUsuario?.telefono || "-"}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500 dark:text-gray-400 normal-case">CUIT</Label>
                  <p className="font-medium mt-1 normal-case">{selectedUsuario?.cuit || "-"}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-gray-500 dark:text-gray-400 normal-case">Dirección</Label>
                  <p className="font-medium mt-1 normal-case">{selectedUsuario?.direccion || "-"}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500 dark:text-gray-400 normal-case">ROL</Label>
                  <div className="mt-1">{getRolBadge(selectedUsuario?.rol || "")}</div>
                </div>
                <div>
                  <Label className="text-xs text-gray-500 dark:text-gray-400 normal-case">Estado</Label>
                  <div className="mt-1">{getEstadoBadge(selectedUsuario?.estado || "")}</div>
                </div>
                {selectedUsuario?.rol === "vendedor" && selectedUsuario?.vendedor_id && (
                  <div className="col-span-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <Label className="text-xs text-blue-700 dark:text-blue-300 normal-case flex items-center gap-2">
                      <Link2 className="w-4 h-4" />
                      Vinculado con Vendedor
                    </Label>
                    <p className="font-medium mt-1 text-blue-900 dark:text-blue-100 normal-case">
                      {getVendedorNombre(selectedUsuario.vendedor_id) || "Vendedor no encontrado"}
                    </p>
                  </div>
                )}
                {selectedUsuario?.rol === "cliente" && selectedUsuario?.cliente_id && (
                  <div className="col-span-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                    <Label className="text-xs text-purple-700 dark:text-purple-300 normal-case flex items-center gap-2">
                      <Link2 className="w-4 h-4" />
                      Vinculado con Cliente
                    </Label>
                    <p className="font-medium mt-1 text-purple-900 dark:text-purple-100 normal-case">
                      {getClienteNombre(selectedUsuario.cliente_id) || "Cliente no encontrado"}
                    </p>
                  </div>
                )}
                {selectedUsuario?.fecha_aprobacion && (
                  <div className="col-span-2">
                    <Label className="text-xs text-gray-500 dark:text-gray-400 normal-case">Fecha de Aprobación</Label>
                    <p className="mt-1 text-sm normal-case">
                      {new Date(selectedUsuario.fecha_aprobacion).toLocaleString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                    </p>
                  </div>
                )}
                {selectedUsuario?.observaciones && (
                  <div className="col-span-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                    <Label className="text-xs text-yellow-700 dark:text-yellow-300 normal-case">Observaciones</Label>
                    <p className="mt-1 text-sm text-yellow-900 dark:text-yellow-100 normal-case">
                      {selectedUsuario.observaciones}
                    </p>
                  </div>
                )}
                {selectedUsuario?.motivo_rechazo && (
                  <div className="col-span-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                    <Label className="text-xs text-red-700 dark:text-red-300 normal-case">Motivo de Rechazo</Label>
                    <p className="mt-1 text-sm text-red-900 dark:text-red-100 normal-case">
                      {selectedUsuario.motivo_rechazo}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            {actionType === "aprobar" && (
              <Button onClick={confirmarAprobacion} disabled={loading}>
                {loading ? "Aprobando..." : "Aprobar Usuario"}
              </Button>
            )}
            {actionType === "rechazar" && (
              <Button variant="destructive" onClick={confirmarRechazo} disabled={loading}>
                {loading ? "Rechazando..." : "Rechazar Usuario"}
              </Button>
            )}
            {actionType === "editar" && (
              <Button onClick={confirmarEdicion} disabled={loading}>
                {loading ? "Guardando..." : "Guardar Cambios"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


