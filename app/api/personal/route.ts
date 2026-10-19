import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getUserRoles, requireAuth, requirePermiso, tienePermiso } from "@/lib/auth"
import { getSaldosClientes } from "@/lib/cuenta-corriente/saldo"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

// Cuentas personales del personal (regla del dueño, 19/10/2026).
// La cuenta de un vendedor / chofer / depósito ES una cuenta de cliente
// (clientes.es_empleado). Ahí entran comisiones, retiros, diferencias de
// rendición, mercadería que retira y ajustes de la oficina.
//
// GET                    → listado (admin + administrativo)
// GET ?cliente_id=…      → la cuenta de empleado de UN cliente (cualquier usuario logueado; ficha del cliente)
// PATCH { cliente_id, es_empleado?, empleado_usuario_id?, vendedor_ids? } → vincular (solo admin)

const MIGRACION = "Falta aplicar la migración 20261019_cc_personal.sql (cuentas del personal)."
const ROLES_PERSONAL = ["vendedor", "chofer", "deposito"]

type Db = ReturnType<typeof createAdminClient>
type Usuario = { id: string; nombre: string; email: string | null; roles: string[]; activo: boolean }

const faltaColumna = (e: any) => !!e && (e.code === "42703" || /es_empleado|empleado_usuario_id|cuenta_cliente_id/.test(String(e.message)))
const nombreCliente = (c: any) => c?.nombre || c?.nombre_razon_social || "—"

async function cargarUsuarios(db: Db): Promise<Map<string, Usuario>> {
  const [{ data: us }, { data: rs }] = await Promise.all([
    db.from("usuarios").select("id, nombre, email, estado"),
    db.from("usuarios_roles").select("usuario_id, roles(nombre)"),
  ])
  const roles = new Map<string, string[]>()
  for (const r of (rs ?? []) as any[]) {
    if (r.roles?.nombre) roles.set(r.usuario_id, [...(roles.get(r.usuario_id) ?? []), r.roles.nombre])
  }
  const out = new Map<string, Usuario>()
  for (const u of (us ?? []) as any[]) {
    out.set(u.id, { id: u.id, nombre: u.nombre || u.email || "—", email: u.email ?? null, roles: roles.get(u.id) ?? [], activo: u.estado !== "inactivo" })
  }
  return out
}

const comisionDe = (v: any) =>
  Math.max(Number(v.comision_limpieza_bazar) || 0, Number(v.comision_perfumeria_0) || 0, Number(v.comision_perfumeria_plus) || 0)

export async function GET(request: NextRequest) {
  const clienteId = request.nextUrl.searchParams.get("cliente_id")
  if (clienteId) return getDeCliente(clienteId)

  const auth = await requirePermiso("revisar_devoluciones")
  if (auth.error) return auth.error
  try {
    const db = createAdminClient()
    const { data: cuentasRaw, error } = await db
      .from("clientes")
      .select("id, codigo_cliente, nombre, nombre_razon_social, empleado_usuario_id")
      .eq("es_empleado", true)
      .order("nombre")
    if (error) {
      if (faltaColumna(error)) return NextResponse.json({ error: MIGRACION }, { status: 500 })
      throw error
    }
    const cuentas = (cuentasRaw ?? []) as any[]

    const [usuarios, vendedores, saldos] = await Promise.all([
      cargarUsuarios(db),
      fetchAllRows<any>(() =>
        db.from("vendedores")
          .select("id, nombre, activo, usuario_id, cuenta_cliente_id, comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus")
          .order("nombre"),
      ),
      getSaldosClientes(db, cuentas.map((c) => c.id)),
    ])

    const usuariosVinculados = new Set(cuentas.map((c) => c.empleado_usuario_id).filter(Boolean) as string[])
    const vendPorCuenta = new Map<string, any[]>()
    for (const v of vendedores) {
      if (!v.cuenta_cliente_id) continue
      vendPorCuenta.set(v.cuenta_cliente_id, [...(vendPorCuenta.get(v.cuenta_cliente_id) ?? []), v])
    }
    const resumenVend = (v: any) => ({ id: v.id, nombre: v.nombre, activo: v.activo !== false })

    const filas = cuentas.map((c) => {
      const s = saldos.get(c.id)
      const u = c.empleado_usuario_id ? usuarios.get(c.empleado_usuario_id) : null
      return {
        id: c.id,
        codigo_cliente: c.codigo_cliente ?? null,
        nombre: nombreCliente(c),
        saldo_real: s?.saldo_real ?? 0,
        saldo_proyectado: s?.saldo_proyectado ?? 0,
        usuario: u ? { id: u.id, nombre: u.nombre, roles: u.roles } : c.empleado_usuario_id ? { id: c.empleado_usuario_id, nombre: "Usuario borrado", roles: [] } : null,
        vendedores: (vendPorCuenta.get(c.id) ?? []).map(resumenVend),
      }
    })

    // Vendedores que cobran comisión y no tienen dónde acreditarla
    const vendedores_sin_cuenta = vendedores
      .filter((v) => v.activo !== false && comisionDe(v) > 0 && !v.cuenta_cliente_id && !(v.usuario_id && usuariosVinculados.has(v.usuario_id)))
      .map((v) => ({ id: v.id, nombre: v.nombre, usuario: v.usuario_id ? usuarios.get(v.usuario_id)?.nombre ?? null : null }))

    // Personal de calle / depósito sin cuenta vinculada
    const personal = [...usuarios.values()].filter((u) => u.activo && u.roles.some((r) => ROLES_PERSONAL.includes(r)))
    const usuarios_sin_cuenta = personal
      .filter((u) => !usuariosVinculados.has(u.id))
      .map((u) => ({ id: u.id, nombre: u.nombre, roles: u.roles }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))

    // Para el editor: usuarios del personal (no clientes) y todos los códigos de vendedor
    const usuariosElegibles = [...usuarios.values()]
      .filter((u) => u.roles.some((r) => r !== "cliente"))
      .map((u) => ({ id: u.id, nombre: u.nombre, roles: u.roles, activo: u.activo, cuenta_cliente_id: cuentas.find((c) => c.empleado_usuario_id === u.id)?.id ?? null }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))

    return NextResponse.json({
      puede_editar: tienePermiso(auth.roles, "caja"),
      cuentas: filas,
      vendedores_sin_cuenta,
      usuarios_sin_cuenta,
      usuarios: usuariosElegibles,
      vendedores: vendedores.map((v) => ({ ...resumenVend(v), cuenta_cliente_id: v.cuenta_cliente_id ?? null })),
    })
  } catch (error: any) {
    console.error("[personal] GET:", error)
    return NextResponse.json({ error: error?.message || "No se pudo leer el personal" }, { status: 500 })
  }
}

/** Ficha del cliente: ¿es cuenta de empleado?, de quién y qué códigos de vendedor cobran ahí. */
async function getDeCliente(clienteId: string) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const db = createAdminClient()
    const { data: c, error } = await db
      .from("clientes")
      .select("id, es_empleado, empleado_usuario_id")
      .eq("id", clienteId)
      .maybeSingle()
    if (error) {
      if (faltaColumna(error)) return NextResponse.json({ error: MIGRACION, sin_migracion: true }, { status: 500 })
      throw error
    }
    if (!c) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    const [roles, { data: vend }, { data: u }] = await Promise.all([
      getUserRoles(auth.user.id),
      db.from("vendedores").select("id, nombre, activo").eq("cuenta_cliente_id", clienteId).order("nombre"),
      c.empleado_usuario_id
        ? db.from("usuarios").select("id, nombre, email").eq("id", c.empleado_usuario_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    return NextResponse.json({
      es_empleado: !!c.es_empleado,
      usuario: c.empleado_usuario_id ? { id: c.empleado_usuario_id, nombre: (u as any)?.nombre || (u as any)?.email || "Usuario borrado" } : null,
      vendedores: ((vend ?? []) as any[]).map((v) => ({ id: v.id, nombre: v.nombre, activo: v.activo !== false })),
      puede_editar: tienePermiso(roles, "caja"),
    })
  } catch (error: any) {
    console.error("[personal] GET cliente:", error)
    return NextResponse.json({ error: error?.message || "No se pudo leer la cuenta" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    const b = await request.json().catch(() => null)
    const clienteId = typeof b?.cliente_id === "string" ? b.cliente_id : ""
    if (!clienteId) return NextResponse.json({ error: "Falta la cuenta (cliente)" }, { status: 400 })

    const tocaUsuario = b.empleado_usuario_id !== undefined
    const usuarioId: string | null = tocaUsuario ? (typeof b.empleado_usuario_id === "string" && b.empleado_usuario_id ? b.empleado_usuario_id : null) : null
    const tocaVend = Array.isArray(b.vendedor_ids)
    const vendedorIds: string[] = tocaVend ? [...new Set((b.vendedor_ids as unknown[]).filter((x): x is string => typeof x === "string" && !!x))] : []
    if (b.es_empleado !== undefined && typeof b.es_empleado !== "boolean") {
      return NextResponse.json({ error: "es_empleado tiene que ser sí o no" }, { status: 400 })
    }

    const db = createAdminClient()
    const { data: cliente, error: errC } = await db
      .from("clientes")
      .select("id, nombre, nombre_razon_social, es_empleado, empleado_usuario_id")
      .eq("id", clienteId)
      .maybeSingle()
    if (errC) {
      if (faltaColumna(errC)) return NextResponse.json({ error: MIGRACION }, { status: 500 })
      throw errC
    }
    if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

    // Vincular un usuario o códigos de vendedor la marca como cuenta de empleado;
    // desmarcarla suelta todos sus vínculos.
    const esEmpleado: boolean =
      b.es_empleado === false ? false : b.es_empleado === true || (tocaUsuario && !!usuarioId) || (tocaVend && vendedorIds.length > 0) ? true : !!cliente.es_empleado
    const usuarioFinal: string | null = !esEmpleado ? null : tocaUsuario ? usuarioId : cliente.empleado_usuario_id ?? null
    const vendFinal: string[] | null = !esEmpleado ? [] : tocaVend ? vendedorIds : null // null = no tocar

    if (usuarioFinal) {
      const [{ data: u }, { data: otra }] = await Promise.all([
        db.from("usuarios").select("id, nombre, email").eq("id", usuarioFinal).maybeSingle(),
        db.from("clientes").select("id, nombre, nombre_razon_social").eq("empleado_usuario_id", usuarioFinal).neq("id", clienteId).limit(1).maybeSingle(),
      ])
      if (!u) return NextResponse.json({ error: "Ese usuario no existe" }, { status: 400 })
      if (otra) {
        return NextResponse.json(
          { error: `${(u as any).nombre || (u as any).email} ya tiene su cuenta personal: ${nombreCliente(otra)}. Desvinculalo de esa cuenta primero (cada persona tiene una sola cuenta).`, error_code: "USUARIO_YA_VINCULADO", cliente_id: (otra as any).id },
          { status: 409 },
        )
      }
    }

    let movidos: Array<{ id: string; nombre: string; desde: string }> = []
    if (vendFinal && vendFinal.length) {
      const { data: vs, error: errV } = await db.from("vendedores").select("id, nombre, cuenta_cliente_id").in("id", vendFinal)
      if (errV) {
        if (faltaColumna(errV)) return NextResponse.json({ error: MIGRACION }, { status: 500 })
        throw errV
      }
      if ((vs ?? []).length !== vendFinal.length) return NextResponse.json({ error: "Algún código de vendedor no existe" }, { status: 400 })
      const otras = ((vs ?? []) as any[]).filter((v) => v.cuenta_cliente_id && v.cuenta_cliente_id !== clienteId)
      if (otras.length) {
        const { data: cs } = await db.from("clientes").select("id, nombre, nombre_razon_social").in("id", otras.map((v) => v.cuenta_cliente_id))
        const nom = new Map(((cs ?? []) as any[]).map((c) => [c.id, nombreCliente(c)]))
        movidos = otras.map((v) => ({ id: v.id, nombre: v.nombre, desde: nom.get(v.cuenta_cliente_id) ?? "otra cuenta" }))
      }
    }

    const { error: errU } = await db
      .from("clientes")
      .update({ es_empleado: esEmpleado, empleado_usuario_id: usuarioFinal })
      .eq("id", clienteId)
    if (errU) {
      if ((errU as any).code === "23505") {
        return NextResponse.json({ error: "Ese usuario ya está vinculado a otra cuenta personal (cada persona tiene una sola).", error_code: "USUARIO_YA_VINCULADO" }, { status: 409 })
      }
      throw errU
    }

    if (vendFinal) {
      // Exactamente esos códigos apuntan a esta cuenta: se sueltan los que sobran
      let q = db.from("vendedores").update({ cuenta_cliente_id: null }).eq("cuenta_cliente_id", clienteId)
      if (vendFinal.length) q = q.not("id", "in", `(${vendFinal.join(",")})`)
      const { error: e1 } = await q
      if (e1) throw e1
      if (vendFinal.length) {
        const { error: e2 } = await db.from("vendedores").update({ cuenta_cliente_id: clienteId }).in("id", vendFinal)
        if (e2) throw e2
      }
    }

    return NextResponse.json({ success: true, es_empleado: esEmpleado, empleado_usuario_id: usuarioFinal, movidos })
  } catch (error: any) {
    console.error("[personal] PATCH:", error)
    return NextResponse.json({ error: error?.message || "No se pudo guardar" }, { status: 500 })
  }
}
