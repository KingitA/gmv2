/**
 * Envío de la orden de pago al proveedor por mail, cuando queda pagada. SOLO SERVIDOR.
 *
 * Decisión de Juan (19/11/2026): «se envía la orden de pago en caso de tener alguien a quien
 * mandárselo, si no, queda cerrada sin enviar.»
 *
 * - Sale de la MISMA cuenta y con el MISMO modo prueba que las órdenes de compra
 *   (compras_envio_ajustes, lib/compras/envio-ajustes.ts): con el modo prueba encendido TODO va
 *   solo a la dirección de prueba, con [PRUEBA] en el asunto. Si ese ajuste no se puede leer, no
 *   se envía nada.
 * - Adjuntos: el PDF de la orden y, si hubo retención, el certificado.
 * - Queda registro de cada intento en ordenes_pago_envios (migración 20261119e): a quién salió de
 *   verdad, a quién habría ido, cuándo, si fue prueba, o por qué no se pudo.
 * - NUNCA hace fallar el pago: la orden ya está pagada. Si el mail falla queda "no se pudo
 *   enviar" y se reintenta desde la pantalla.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { enviarMailGmail, estadoCuentaGmail } from "@/lib/ai/gmail"
import { comoConectarCuenta, leerAjustesEnvio } from "@/lib/compras/envio-ajustes"
import { armarMime, mailADespachar, rawParaGmail, type AdjuntoMail } from "@/lib/compras/mail-orden"
import { faltaLaColumna } from "@/lib/utils/migracion-pendiente"
import { asuntoOrdenPago, cuerpoOrdenPago, mailsParaOrdenPago, porQueEseMail } from "./mail-orden-pago"
import { pdfCertificadoRetencion, pdfOrdenPago } from "./pdf"

export const MIGRACION_ENVIO_OP = "20261119e_bancos_confirmar_y_enviar.sql"

/** De dónde salió el envío: la confirmación sola por el banco, el tilde verde, o el botón de enviar / reintentar. */
export type OrigenEnvio = "banco" | "confirmacion" | "manual"

export interface ResumenEnvio {
  estado: "enviada" | "sin_mail" | "fallo"
  /** A quién salió de verdad (en modo prueba, la dirección de prueba) */
  enviado_a: string | null
  /** A quién habría ido si no fuera una prueba */
  habria_ido_a: string | null
  modo_prueba: boolean
  /** Texto para la pantalla */
  mensaje: string
  creado_at: string | null
}

const faltaTabla = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null
  return err?.code === "42P01" || err?.code === "PGRST205" || /ordenes_pago_envios/.test(String(err?.message ?? "")) && /does not exist|could not find/i.test(String(err?.message ?? ""))
}

export function mensajeDeEnvio(f: { estado: string; enviado_a?: string | null; habria_ido_a?: string | null; modo_prueba?: boolean | null; error?: string | null; mail_origen?: string | null }): string {
  if (f.estado === "enviada") {
    // A cuál mail fue y por qué (si no fue al mail para órdenes de pago de la ficha)
    const porQue = porQueEseMail(f.mail_origen)
    const base = f.modo_prueba
      ? `MODO PRUEBA: la orden de pago se mandó a ${f.enviado_a}, NO al proveedor (habría ido a ${f.habria_ido_a || "—"}).`
      : `La orden de pago se le mandó al proveedor (${f.enviado_a}).`
    return porQue ? `${base} ${porQue.replace(/^Fue/, f.modo_prueba ? "Habría ido" : "Fue")}` : base
  }
  if (f.estado === "sin_mail") return "El proveedor no tiene ningún mail cargado en su ficha: la orden quedó pagada sin enviar."
  return `No se pudo enviar la orden de pago al proveedor: ${f.error || "error desconocido"}`
}

const resumen = (f: Record<string, any>): ResumenEnvio => ({
  estado: f.estado, enviado_a: f.enviado_a ?? null, habria_ido_a: f.habria_ido_a ?? null, modo_prueba: f.modo_prueba === true,
  mensaje: mensajeDeEnvio(f as any), creado_at: f.creado_at ?? null,
})

/** El último intento de envío de cada orden (para la lista). Sin la migración devuelve un mapa vacío. */
export async function ultimosEnvios(supabase: SupabaseClient, ordenIds: string[]): Promise<Map<string, ResumenEnvio>> {
  const mapa = new Map<string, ResumenEnvio>()
  for (let i = 0; i < ordenIds.length; i += 200) {
    const { data, error } = await supabase.from("ordenes_pago_envios").select("*").in("orden_pago_id", ordenIds.slice(i, i + 200)).order("creado_at", { ascending: false })
    if (error) { if (!faltaTabla(error)) console.warn("[ordenes-pago] envíos:", error.message); return mapa }
    for (const f of (data ?? []) as Record<string, any>[]) {
      const previo = mapa.get(f.orden_pago_id)
      // Un envío que salió vale más que un intento fallido posterior a mano
      if (!previo || (previo.estado !== "enviada" && f.estado === "enviada")) mapa.set(f.orden_pago_id, resumen(f))
    }
  }
  return mapa
}

/**
 * Manda la orden de pago al proveedor y deja el registro. Devuelve qué pasó; no lanza.
 * Los envíos automáticos ("banco", "confirmacion") no repiten uno que ya salió o que quedó sin
 * mail. El botón ("manual") siempre vuelve a intentar.
 */
export async function enviarOrdenAlProveedor(supabase: SupabaseClient, opId: string, o: { usuarioId: string | null; origen: OrigenEnvio }): Promise<ResumenEnvio> {
  const sinRegistro = (mensaje: string): ResumenEnvio => ({ estado: "fallo", enviado_a: null, habria_ido_a: null, modo_prueba: false, mensaje, creado_at: null })
  try {
    // ¿La base puede registrar el envío? Si no, no sale nada (saldría el mail y no quedaría anotado)
    const previos = await supabase.from("ordenes_pago_envios").select("*").eq("orden_pago_id", opId).order("creado_at", { ascending: false })
    if (previos.error) {
      return sinRegistro(faltaTabla(previos.error)
        ? `No se envió la orden de pago al proveedor: falta aplicar la migración ${MIGRACION_ENVIO_OP}.`
        : `No se envió la orden de pago al proveedor: ${previos.error.message}`)
    }
    if (o.origen !== "manual") {
      const ya = ((previos.data ?? []) as Record<string, any>[]).find((f) => f.estado === "enviada" || f.estado === "sin_mail")
      if (ya) return resumen(ya)
    }

    const { data: op, error } = await supabase.from("ordenes_pago")
      .select("id, numero_op, fecha, estado, proveedor_id, monto_total, total_retenciones, neto_a_pagar, proveedores(*), ordenes_pago_detalle(medio, monto, numero_transferencia, cheque_numero)")
      .eq("id", opId).maybeSingle()
    if (error) return sinRegistro(`No se envió la orden de pago al proveedor: ${error.message}`)
    if (!op) return sinRegistro("La orden de pago no existe.")
    if (op.estado !== "pagada") return sinRegistro("La orden de pago se le manda al proveedor recién cuando está pagada.")
    const prov = (Array.isArray(op.proveedores) ? op.proveedores[0] : op.proveedores) as Record<string, any> | null

    const anotar = async (f: Record<string, any>): Promise<ResumenEnvio> => {
      const fila = { orden_pago_id: opId, orden_pago_numero: op.numero_op, proveedor_id: op.proveedor_id, origen: o.origen, creado_por: o.usuarioId, modo_prueba: false, ...f }
      let { data, error: e } = await supabase.from("ordenes_pago_envios").insert(fila).select("*").single()
      // Sin la migración 20261119f (columna mail_origen): se registra igual, sin ese dato
      if (e && faltaLaColumna(e) && "mail_origen" in fila) {
        const { mail_origen: _sin, ...sinOrigen } = fila as Record<string, any>
        ;({ data, error: e } = await supabase.from("ordenes_pago_envios").insert(sinOrigen).select("*").single())
      }
      if (e) console.error("[ordenes-pago] no se pudo registrar el envío:", e.message)
      return resumen({ ...fila, creado_at: new Date().toISOString(), ...(data ?? {}) })
    }

    const { para, origen: mailOrigen } = mailsParaOrdenPago(prov)
    if (para.length === 0) return anotar({ estado: "sin_mail" })
    const seria = para.join(", ")

    // Cuenta y modo prueba: el ajuste único de envío de compras. Falla segura: sin ajuste legible no sale nada.
    const lectura = await leerAjustesEnvio(supabase)
    if (!lectura.ok) return anotar({ estado: "fallo", habria_ido_a: seria, error: lectura.motivo })
    const ajustes = lectura.ajustes
    const cuenta = await estadoCuentaGmail(ajustes.cuenta_envio).catch(() => ({ estado: "no_conectada" as const, cuenta: null }))
    if (cuenta.estado !== "conectada" || !cuenta.cuenta) {
      return anotar({ estado: "fallo", habria_ido_a: seria, modo_prueba: ajustes.modo_prueba, cuenta_envio: ajustes.cuenta_envio, error: comoConectarCuenta(ajustes.cuenta_envio, cuenta.estado) })
    }

    const [pdf, certificado, empresaRes] = await Promise.all([
      pdfOrdenPago(supabase, opId),
      Number(op.total_retenciones ?? 0) > 0 ? pdfCertificadoRetencion(supabase, opId) : Promise.resolve(null),
      supabase.from("configuracion_empresa").select("razon_social, telefono").limit(1).maybeSingle(),
    ])
    if (!pdf) return anotar({ estado: "fallo", habria_ido_a: seria, modo_prueba: ajustes.modo_prueba, error: "No se pudo armar el PDF de la orden de pago." })
    const empresa = (empresaRes.data as Record<string, any> | null)?.razon_social || "Administración"
    const adjuntos: AdjuntoMail[] = [pdf, certificado].filter(Boolean).map((a) => ({ nombre: a!.nombre, tipo: "application/pdf", base64: a!.buffer.toString("base64") }))

    const datos = {
      numero_op: op.numero_op, fecha: op.fecha, proveedor: prov?.nombre ?? "proveedor", empresa,
      monto_total: Number(op.monto_total ?? 0), total_retenciones: Number(op.total_retenciones ?? 0), neto_a_pagar: Number(op.neto_a_pagar ?? 0),
      numero_certificado: certificado ? certificado.nombre.replace(/^RET_|\.pdf$/g, "") : null,
      medios: ((op.ordenes_pago_detalle ?? []) as Record<string, any>[]).map((m) => ({
        medio: m.medio, monto: Number(m.monto ?? 0),
        referencia: m.medio === "transferencia" ? (m.numero_transferencia ? `operación ${m.numero_transferencia}` : null) : m.cheque_numero ? `N° ${m.cheque_numero}` : null,
      })),
      telefono: (empresaRes.data as Record<string, any> | null)?.telefono ?? null,
    }
    // A quién sale de verdad: en modo prueba, SOLO a la dirección de prueba
    const despacho = mailADespachar(ajustes, { para, cc: [], asunto: asuntoOrdenPago(datos), texto: cuerpoOrdenPago(datos) })
    const base = { habria_ido_a: seria, modo_prueba: despacho.prueba, cuenta_envio: cuenta.cuenta, adjuntos: adjuntos.map((a) => a.nombre), mail_origen: mailOrigen }

    let enviado: { id: string; threadId: string | null }
    try {
      const mime = armarMime({ de: cuenta.cuenta, nombreDe: empresa, para: despacho.para, cc: despacho.cc, asunto: despacho.asunto, texto: despacho.texto, adjuntos })
      enviado = await enviarMailGmail(cuenta.cuenta, rawParaGmail(mime))
    } catch (e: any) {
      console.error("[ordenes-pago] envío al proveedor:", e?.message)
      return anotar({ ...base, estado: "fallo", error: String(e?.message || "No se pudo enviar el mail.").slice(0, 600) })
    }
    return anotar({ ...base, estado: "enviada", enviado_a: despacho.para.join(", "), mensaje_id: enviado.id })
  } catch (e: any) {
    console.error("[ordenes-pago] envío al proveedor:", e)
    return sinRegistro(`No se pudo enviar la orden de pago al proveedor: ${e?.message || "error inesperado"}`)
  }
}
