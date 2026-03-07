"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { nowArgentina, todayArgentina } from "@/lib/utils"

export async function createPago(data: {
  cliente_id: string
  monto: number
  metodo: "efectivo" | "transferencia" | "cheque" | "tarjeta"
  referencia?: string
  observaciones?: string
  fecha_pago?: string
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: usuarioCrm } = await supabase
    .from("usuarios_crm")
    .select("rol, vendedor_id")
    .eq("email", user.email)
    .single()

  if (!usuarioCrm || (usuarioCrm.rol !== "vendedor" && usuarioCrm.rol !== "admin")) {
    throw new Error("No autorizado")
  }

  const { data: cliente } = await supabase.from("clientes").select("vendedor_id").eq("id", data.cliente_id).single()

  if (!cliente) throw new Error("Cliente no encontrado")

  if (usuarioCrm.rol === "vendedor" && cliente.vendedor_id !== usuarioCrm.vendedor_id) {
    throw new Error("No autorizado para crear pagos para este cliente")
  }

  // Create payment record
  const { data: pago, error: pagoError } = await supabase
    .from("pagos")
    .insert({
      cliente_id: data.cliente_id,
      viajante_id: usuarioCrm.rol === "vendedor" ? user.id : null,
      monto: data.monto,
      metodo: data.metodo,
      referencia: data.referencia,
      status: "pendiente",
      fecha_pago: data.fecha_pago || todayArgentina(),
      observaciones: data.observaciones,
    })
    .select()
    .single()

  if (pagoError) throw pagoError

  // Get current account balance
  const { data: cuentaActual } = await supabase
    .from("cuenta_corriente")
    .select("saldo")
    .eq("cliente_id", data.cliente_id)
    .single()

  const nuevoSaldo = (cuentaActual?.saldo || 0) - data.monto

  // Create account movement (haber)
  await supabase.from("movimientos_cuenta").insert({
    cliente_id: data.cliente_id,
    tipo: "haber",
    concepto: `Pago ${data.metodo} ${data.referencia ? `- Ref: ${data.referencia}` : ""}`,
    importe: data.monto,
    saldo_resultante: nuevoSaldo,
    fecha: data.fecha_pago || nowArgentina(),
    referencia: `PAGO-${pago.id}`,
  })

  // Update cuenta corriente balance
  await supabase.from("cuenta_corriente").update({ saldo: nuevoSaldo }).eq("cliente_id", data.cliente_id)

  revalidatePath("/viajante/clientes")
  revalidatePath(`/viajante/clientes/${data.cliente_id}`)
  return pago
}

export async function updatePagoStatus(pagoId: string, status: "pendiente" | "aprobado" | "rechazado") {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  if (profile?.role !== "admin") {
    throw new Error("Solo administradores pueden aprobar pagos")
  }

  const { error } = await supabase.from("pagos").update({ status }).eq("id", pagoId)

  if (error) throw error

  revalidatePath("/admin/pagos")
  return { success: true }
}

export async function getPagosByCliente(clienteId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: usuarioCrm } = await supabase
    .from("usuarios_crm")
    .select("rol, vendedor_id, cliente_id")
    .eq("email", user.email)
    .single()

  if (!usuarioCrm) throw new Error("Usuario no encontrado")

  // Verify authorization
  const { data: cliente } = await supabase.from("clientes").select("vendedor_id").eq("id", clienteId).single()

  if (!cliente) throw new Error("Cliente no encontrado")

  if (usuarioCrm.rol === "vendedor") {
    if (cliente.vendedor_id !== usuarioCrm.vendedor_id) {
      throw new Error("No autorizado para ver pagos de este cliente")
    }
  } else if (usuarioCrm.rol === "cliente") {
    if (clienteId !== usuarioCrm.cliente_id) {
      throw new Error("No autorizado para ver estos pagos")
    }
  } else if (usuarioCrm.rol !== "admin") {
    throw new Error("No autorizado")
  }

  const { data, error } = await supabase
    .from("pagos")
    .select(
      `
      *,
      viajante:viajante_id(nombre_completo)
    `,
    )
    .eq("cliente_id", clienteId)
    .order("fecha_pago", { ascending: false })

  if (error) throw error
  return data
}

export async function getPagosPendientes() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data, error } = await supabase
    .from("pagos")
    .select(
      `
      *,
      clientes:cliente_id(razon_social, zona),
      viajante:viajante_id(nombre_completo)
    `,
    )
    .eq("status", "pendiente")
    .order("fecha_pago", { ascending: false })

  if (error) throw error
  return data
}

export async function getViajanteComisiones() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data, error } = await supabase
    .from("comisiones")
    .select(
      `
      *,
      pedidos:pedido_id(
        numero_pedido,
        total,
        clientes:cliente_id(razon_social)
      )
    `,
    )
    .eq("viajante_id", user.id)
    .order("created_at", { ascending: false })

  if (error) throw error
  return data
}

export async function marcarComisionPagada(comisionId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  if (profile?.role !== "admin") {
    throw new Error("Solo administradores pueden marcar comisiones como pagadas")
  }

  const { error } = await supabase
    .from("comisiones")
    .update({
      pagado: true,
      fecha_pago: todayArgentina(),
    })
    .eq("id", comisionId)

  if (error) throw error

  revalidatePath("/admin/comisiones")
  revalidatePath("/viajante/comisiones")
  return { success: true }
}
