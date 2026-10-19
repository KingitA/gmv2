"use client"

// ─── Cuentas del personal (regla del dueño, 19/10/2026) ─────────────────────
// La cuenta personal de un vendedor / chofer / depósito ES su cuenta de
// cliente (clientes.es_empleado): mismo libro mayor, mismo saldo. Ahí entran
// comisiones, retiros, diferencias de rendición, mercadería que retira y
// ajustes de la oficina. Estas cuentas NO cuentan como deuda de clientes.
// Datos: GET /api/personal. Vincular (usuario y códigos de vendedor): PATCH, solo admin.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { useToast } from "@/hooks/use-toast"
import { AlertTriangle, Link2, Loader2, RefreshCw, UserRound } from "lucide-react"
import { moneda } from "@/lib/formato"

type Vend = { id: string; nombre: string; activo: boolean; cuenta_cliente_id?: string | null }
type Cuenta = {
  id: string
  codigo_cliente: string | null
  nombre: string
  saldo_real: number
  saldo_proyectado: number
  usuario: { id: string; nombre: string; roles: string[] } | null
  vendedores: Vend[]
}
type Datos = {
  puede_editar: boolean
  cuentas: Cuenta[]
  vendedores_sin_cuenta: Array<{ id: string; nombre: string; usuario: string | null }>
  usuarios_sin_cuenta: Array<{ id: string; nombre: string; roles: string[] }>
  usuarios: Array<{ id: string; nombre: string; roles: string[]; activo: boolean; cuenta_cliente_id: string | null }>
  vendedores: Vend[]
}

const NINGUNO = "__ninguno__"
const ROL_LABEL: Record<string, string> = { vendedor: "Vendedor", chofer: "Chofer", deposito: "Depósito", admin: "Admin", administrativo: "Administrativo", mostrador: "Mostrador" }
const roles = (rs: string[]) => rs.map((r) => ROL_LABEL[r] ?? r).join(", ")

function Saldo({ real, proyectado }: { real: number; proyectado: number }) {
  const tono = (n: number) => (n > 0.005 ? "text-alerta-600" : n < -0.005 ? "text-exito-600" : "text-neutro-500")
  const txt = (n: number) => (Math.abs(n) < 0.005 ? "Al día" : n > 0 ? "Debe" : "A su favor")
  return (
    <div className="text-right">
      <p className={`font-bold tabular-nums ${tono(real)}`}>{moneda(Math.abs(real))}</p>
      <p className="text-[11px] text-neutro-500">{txt(real)} · real</p>
      {Math.abs(proyectado - real) > 0.009 && (
        <p className="mt-0.5 text-[11px] text-neutro-600">
          Proyectado: <b className="tabular-nums">{proyectado < 0 ? "a favor " : ""}{moneda(Math.abs(proyectado))}</b>
        </p>
      )}
    </div>
  )
}

export default function PersonalPage() {
  const { toast } = useToast()
  const [data, setData] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState<string | null>(null)
  const [selUsuario, setSelUsuario] = useState<string>(NINGUNO)
  const [selVend, setSelVend] = useState<Set<string>>(new Set())
  const [guardando, setGuardando] = useState(false)
  const [nuevo, setNuevo] = useState<{ id: string; nombre?: string; razon_social?: string } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await fetch("/api/personal")
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || "No se pudo leer el personal"); setData(null) }
      else { setData(j); setError(null) }
    } catch {
      setError("No se pudo leer el personal")
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const abrirEditor = (c: Cuenta) => {
    setEditando(c.id)
    setSelUsuario(c.usuario?.id ?? NINGUNO)
    setSelVend(new Set(c.vendedores.map((v) => v.id)))
  }

  const patch = async (body: Record<string, unknown>) => {
    setGuardando(true)
    try {
      const r = await fetch("/api/personal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast({ title: "No se guardó", description: j.error || "Error al guardar", variant: "destructive" }); return null }
      return j
    } catch {
      toast({ title: "No se guardó", description: "Sin conexión con el servidor", variant: "destructive" })
      return null
    } finally {
      setGuardando(false)
    }
  }

  const guardar = async (clienteId: string) => {
    const j = await patch({ cliente_id: clienteId, empleado_usuario_id: selUsuario === NINGUNO ? null : selUsuario, vendedor_ids: [...selVend] })
    if (!j) return
    const movidos = (j.movidos ?? []) as Array<{ nombre: string; desde: string }>
    toast({
      title: "Cuenta vinculada",
      description: movidos.length ? `Se pasaron a esta cuenta: ${movidos.map((m) => `${m.nombre} (estaba en ${m.desde})`).join(", ")}` : undefined,
    })
    setEditando(null)
    cargar()
  }

  const desmarcar = async (c: Cuenta) => {
    if (!window.confirm(`¿Sacar "${c.nombre}" de las cuentas del personal? Se sueltan su usuario y sus códigos de vendedor; los movimientos de la cuenta no se tocan.`)) return
    if (await patch({ cliente_id: c.id, es_empleado: false })) {
      toast({ title: "Ya no es cuenta del personal" })
      setEditando(null)
      cargar()
    }
  }

  const marcarNuevo = async () => {
    if (!nuevo) return
    if (await patch({ cliente_id: nuevo.id, es_empleado: true })) {
      toast({ title: "Marcada como cuenta del personal", description: "Ahora vinculá el usuario y los códigos de vendedor." })
      setNuevo(null)
      await cargar()
      setEditando(nuevo.id)
      setSelUsuario(NINGUNO)
      setSelVend(new Set())
    }
  }

  const puedeEditar = !!data?.puede_editar

  // "Poner al día": comisiones de comprobantes ya saldados y diferencias de
  // rendición anotadas antes de vincular la cuenta (idempotente, solo admin).
  const [reconciliando, setReconciliando] = useState(false)
  const ponerAlDia = async () => {
    setReconciliando(true)
    try {
      const r = await fetch("/api/cuenta-personal/reconciliar", { method: "POST" })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "No se pudo poner al día")
      toast({
        title: "Cuentas al día",
        description: `${j.comisiones_posteadas} movimientos de comisión y ${j.diferencias_posteadas} diferencias de rendición cargados.${j.vendedores_sin_cuenta?.length ? ` ${j.vendedores_sin_cuenta.length} vendedores siguen sin cuenta vinculada.` : ""}`,
      })
      cargar()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally {
      setReconciliando(false)
    }
  }

  return (
    <div className="container mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <UserRound className="h-6 w-6" /> Cuentas del personal
          </h1>
          <p className="text-sm text-muted-foreground">
            La cuenta personal de cada vendedor, chofer y depósito: comisiones, retiros, diferencias de rendición, mercadería que retira y ajustes.
            No cuenta como deuda de clientes.
          </p>
        </div>
        <div className="flex gap-2">
          {puedeEditar && (
            <Button
              variant="outline"
              onClick={ponerAlDia}
              disabled={reconciliando}
              title="Carga las comisiones de comprobantes ya saldados y las diferencias de rendición que quedaron sin cuenta. Se puede usar las veces que haga falta: no duplica."
            >
              {reconciliando ? "Poniendo al día…" : "Poner al día"}
            </Button>
          )}
          <Button variant="outline" onClick={cargar} disabled={cargando} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-alerta-200 bg-alerta-50">
          <CardContent className="py-4 text-sm text-alerta-700">{error}</CardContent>
        </Card>
      )}

      {data && (data.vendedores_sin_cuenta.length > 0 || data.usuarios_sin_cuenta.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.vendedores_sin_cuenta.length > 0 && (
            <Card className="border-ambar-200 bg-ambar-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-ambar-800">
                  <AlertTriangle className="h-4 w-4" /> Vendedores con comisión sin cuenta
                  <Badge variant="secondary" className="tabular-nums">{data.vendedores_sin_cuenta.length}</Badge>
                </CardTitle>
                <p className="text-xs text-ambar-800/80">Sus comisiones no se pueden cargar hasta vincularlos a una cuenta del personal.</p>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-wrap gap-1.5">
                  {data.vendedores_sin_cuenta.map((v) => (
                    <li key={v.id}><Badge variant="outline" className="bg-white">{v.nombre}{v.usuario ? ` · ${v.usuario}` : ""}</Badge></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {data.usuarios_sin_cuenta.length > 0 && (
            <Card className="border-ambar-200 bg-ambar-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-ambar-800">
                  <AlertTriangle className="h-4 w-4" /> Personal sin cuenta vinculada
                  <Badge variant="secondary" className="tabular-nums">{data.usuarios_sin_cuenta.length}</Badge>
                </CardTitle>
                <p className="text-xs text-ambar-800/80">Sus diferencias de rendición no se pueden cargar hasta vincularlos a una cuenta del personal.</p>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-wrap gap-1.5">
                  {data.usuarios_sin_cuenta.map((u) => (
                    <li key={u.id}><Badge variant="outline" className="bg-white">{u.nombre} · {roles(u.roles)}</Badge></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            Cuentas
            {data && <Badge variant="outline" className="tabular-nums">{data.cuentas.length}</Badge>}
          </CardTitle>
          <p className="text-xs text-muted-foreground">Saldo real = libro mayor (lo confirmado). Positivo: el empleado nos debe; a su favor: le debemos.</p>
        </CardHeader>
        <CardContent className="p-0">
          {cargando && !data ? (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
          ) : !data || data.cuentas.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Todavía no hay cuentas del personal.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-neutro-50 text-left text-xs font-semibold text-neutro-600">
                  <tr>
                    <th className="px-4 py-2">Cuenta</th>
                    <th className="px-4 py-2">Usuario</th>
                    <th className="px-4 py-2">Códigos de vendedor</th>
                    <th className="px-4 py-2 text-right">Saldo</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.cuentas.map((c) => (
                    <FilaCuenta
                      key={c.id}
                      c={c}
                      data={data}
                      puedeEditar={puedeEditar}
                      abierto={editando === c.id}
                      onAbrir={() => abrirEditor(c)}
                      onCerrar={() => setEditando(null)}
                      selUsuario={selUsuario}
                      setSelUsuario={setSelUsuario}
                      selVend={selVend}
                      setSelVend={setSelVend}
                      guardando={guardando}
                      onGuardar={() => guardar(c.id)}
                      onDesmarcar={() => desmarcar(c)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {puedeEditar && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Marcar otra cuenta como del personal</CardTitle>
            <p className="text-xs text-muted-foreground">Buscá la cuenta de cliente que usa el empleado (por ejemplo &quot;APELLIDO NOMBRE (EMPLEADO)&quot;).</p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-start gap-2">
            <div className="min-w-[260px] flex-1">
              <EntitySearchSelect<{ id: string; nombre?: string; razon_social?: string }>
                entity="clientes"
                value={nuevo}
                onSelect={setNuevo}
                placeholder="Buscar cliente por nombre…"
              />
            </div>
            <Button onClick={marcarNuevo} disabled={!nuevo || guardando} className="gap-2">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Marcar como cuenta del personal
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function FilaCuenta(props: {
  c: Cuenta
  data: Datos
  puedeEditar: boolean
  abierto: boolean
  onAbrir: () => void
  onCerrar: () => void
  selUsuario: string
  setSelUsuario: (v: string) => void
  selVend: Set<string>
  setSelVend: (s: Set<string>) => void
  guardando: boolean
  onGuardar: () => void
  onDesmarcar: () => void
}) {
  const { c, data, puedeEditar, abierto, selUsuario, setSelUsuario, selVend, setSelVend, guardando } = props
  const nombreCuenta = new Map(data.cuentas.map((x) => [x.id, x.nombre]))
  const toggle = (id: string, on: boolean) => {
    const s = new Set(selVend)
    if (on) s.add(id)
    else s.delete(id)
    setSelVend(s)
  }
  return (
    <>
      <tr className="align-top">
        <td className="px-4 py-3">
          <Link href={`/clientes/${c.id}/cuenta-corriente`} className="font-semibold text-azul-700 hover:underline">{c.nombre}</Link>
          {c.codigo_cliente && <p className="text-xs text-neutro-500">Cód. {c.codigo_cliente}</p>}
        </td>
        <td className="px-4 py-3">
          {c.usuario ? (
            <>
              <p className="font-medium">{c.usuario.nombre}</p>
              {c.usuario.roles.length > 0 && <p className="text-xs text-neutro-500">{roles(c.usuario.roles)}</p>}
            </>
          ) : (
            <span className="text-xs text-neutro-400">Sin usuario</span>
          )}
        </td>
        <td className="px-4 py-3">
          {c.vendedores.length ? (
            <div className="flex flex-wrap gap-1">
              {c.vendedores.map((v) => (
                <Badge key={v.id} variant="secondary" className={v.activo ? "" : "opacity-60"}>{v.nombre}{v.activo ? "" : " (inactivo)"}</Badge>
              ))}
            </div>
          ) : (
            <span className="text-xs text-neutro-400">—</span>
          )}
        </td>
        <td className="px-4 py-3"><Saldo real={c.saldo_real} proyectado={c.saldo_proyectado} /></td>
        <td className="px-4 py-3 text-right">
          <div className="flex flex-col items-end gap-1">
            <Link href={`/clientes/${c.id}/cuenta-corriente`} className="text-xs font-semibold text-azul-600 hover:underline">Ver cuenta →</Link>
            {puedeEditar && !abierto && (
              <Button size="sm" variant="outline" onClick={props.onAbrir} className="h-7 gap-1 text-xs"><Link2 className="h-3.5 w-3.5" /> Vincular</Button>
            )}
          </div>
        </td>
      </tr>
      {abierto && (
        <tr className="bg-azul-50/40">
          <td colSpan={5} className="px-4 py-3">
            <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
              <div>
                <p className="mb-1 text-xs font-semibold text-neutro-600">Usuario (quién usa esta cuenta)</p>
                <Select value={selUsuario} onValueChange={setSelUsuario}>
                  <SelectTrigger className="bg-white"><SelectValue placeholder="Elegí el usuario" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NINGUNO}>Sin usuario</SelectItem>
                    {data.usuarios.map((u) => (
                      <SelectItem key={u.id} value={u.id} disabled={!!u.cuenta_cliente_id && u.cuenta_cliente_id !== c.id}>
                        {u.nombre}{u.roles.length ? ` · ${roles(u.roles)}` : ""}{!u.activo ? " (inactivo)" : ""}
                        {u.cuenta_cliente_id && u.cuenta_cliente_id !== c.id ? ` — ya en ${nombreCuenta.get(u.cuenta_cliente_id) ?? "otra cuenta"}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-neutro-500">Cada persona tiene una sola cuenta.</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-neutro-600">Códigos de vendedor que cobran comisión en esta cuenta</p>
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border bg-white p-2 sm:grid-cols-2">
                  {data.vendedores.map((v) => {
                    const enOtra = v.cuenta_cliente_id && v.cuenta_cliente_id !== c.id
                    return (
                      <label key={v.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-neutro-50">
                        <Checkbox checked={selVend.has(v.id)} onCheckedChange={(on) => toggle(v.id, on === true)} className="mt-0.5" />
                        <span className={v.activo ? "" : "text-neutro-400"}>
                          {v.nombre}{v.activo ? "" : " (inactivo)"}
                          {enOtra && <span className="block text-[11px] text-ambar-700">hoy en {nombreCuenta.get(v.cuenta_cliente_id!) ?? "otra cuenta"}: si lo marcás, pasa a esta</span>}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="ghost" onClick={props.onDesmarcar} disabled={guardando} className="text-alerta-600 hover:text-alerta-700">
                No es cuenta del personal
              </Button>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={props.onCerrar} disabled={guardando}>Cancelar</Button>
                <Button size="sm" onClick={props.onGuardar} disabled={guardando} className="gap-1">
                  {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
