import type { SupabaseClient } from "@supabase/supabase-js"
import { agruparPorCliente, ES_DEBITO, type ClienteApertura, type RenglonApertura, type TipoApertura } from "./parsear-chr"

/**
 * APERTURA de cuentas corrientes desde el sistema viejo (regla del dueño
 * 16/10/2026: comprobante por comprobante, con su fecha, para que la deuda por
 * antigüedad salga bien desde el primer día).
 *
 * Mismas convenciones que la apertura de Freije (01/10/2026):
 *  - Cada comprobante pendiente → comprobantes_venta SIN CAE, observaciones
 *    "APERTURA GM …" (lib/comprobantes/nc-fiscal-componentes.ts los reconoce:
 *    total_neto = importe final, IVA sin discriminar; el control fiscal los
 *    excluye). Libro mayor: debe/haber por lo PENDIENTE, con la fecha original.
 *  - "A Cuenta" → pagos_clientes confirmado (sin caja ni recibo: la plata entró
 *    en el sistema viejo), libro mayor haber. Queda "a cuenta" decidido.
 *  - No generan comisión en gmv2 (no tienen renglones de kardex).
 *
 * Controles que BLOQUEAN: cliente inexistente, tipo desconocido, fecha o
 * importe inválido, suma de lo pendiente distinta del saldo del reporte.
 * Idempotente: un comprobante/a cuenta ya cargado se saltea.
 */

const MOV: Record<string, string> = {
  PRES: "presupuesto", FA: "factura", FB: "factura", FC: "factura",
  NDA: "nota_debito", NDB: "nota_debito", NDC: "nota_debito",
  NCA: "nota_credito", NCB: "nota_credito", NCC: "nota_credito", REV: "nota_credito",
}
const r2 = (n: number) => Math.round(n * 100) / 100
/** Mediodía en Argentina: la fecha no se corre de día al guardarla como timestamptz */
const fechaLibro = (iso: string) => `${iso}T12:00:00-03:00`
const marcaACuenta = (numero: string) => `a cuenta ${numero}`

export interface ClientePrevia extends ClienteApertura {
  cliente_id: string | null
  nombre_gmv2: string | null
  es_empleado: boolean
  saldo_actual_gmv2: number
  ya_cargados: number
  errores: string[]
  avisos: string[]
}

export interface Previa {
  clientes: ClientePrevia[]
  total: number
  renglones: number
  bloqueantes: number
  puede_confirmar: boolean
}

export async function previsualizarApertura(supabase: SupabaseClient, renglones: RenglonApertura[]): Promise<Previa> {
  const grupos = agruparPorCliente(renglones)
  const codigos = grupos.map((g) => g.codigo_cliente)

  // Clientes por código (en gmv2 sin ceros a la izquierda; se prueba también con ceros)
  const variantes = [...new Set(codigos.flatMap((c) => [c, c.padStart(5, "0")]))]
  const clientes: any[] = []
  for (let i = 0; i < variantes.length; i += 200) {
    const { data, error } = await supabase
      .from("clientes")
      .select("id, codigo_cliente, nombre, nombre_razon_social, es_empleado")
      .in("codigo_cliente", variantes.slice(i, i + 200))
    if (error) throw error
    clientes.push(...(data || []))
  }
  const porCodigo = new Map<string, any>()
  for (const c of clientes) porCodigo.set(String(c.codigo_cliente).replace(/^0+(?=\d)/, ""), c)

  const ids = clientes.map((c) => c.id)
  const saldoDe = new Map<string, number>()
  const yaComp = new Set<string>()
  const yaACuenta = new Set<string>()
  for (let i = 0; i < ids.length; i += 150) {
    const parte = ids.slice(i, i + 150)
    const [{ data: saldos }, { data: comps }, { data: pagos }] = await Promise.all([
      supabase.from("v_saldo_clientes").select("cliente_id, saldo_actual").in("cliente_id", parte),
      supabase.from("comprobantes_venta").select("cliente_id, tipo_comprobante, numero_comprobante").in("cliente_id", parte),
      supabase.from("pagos_clientes").select("cliente_id, observaciones").in("cliente_id", parte).ilike("observaciones", "APERTURA GM%"),
    ])
    for (const s of saldos || []) saldoDe.set(s.cliente_id, Number(s.saldo_actual) || 0)
    for (const c of comps || []) yaComp.add(`${c.cliente_id}|${c.tipo_comprobante}|${c.numero_comprobante}`)
    for (const p of pagos || []) yaACuenta.add(`${p.cliente_id}|${String(p.observaciones || "").toLowerCase()}`)
  }

  let bloqueantes = 0
  const out: ClientePrevia[] = grupos.map((g) => {
    const cl = porCodigo.get(g.codigo_cliente)
    const errores: string[] = []
    const avisos: string[] = []
    if (!cl) errores.push(`El cliente ${g.codigo_cliente} (${g.nombre}) no existe en gmv2`)
    for (const r of g.renglones) {
      if (!r.tipo) errores.push(`${r.numero}: tipo desconocido "${r.descripcion}"`)
      if (!r.fecha) errores.push(`${r.numero}: fecha inválida`)
      if (!Number.isFinite(r.pendiente) || !Number.isFinite(r.importe)) errores.push(`${r.numero}: importe inválido`)
      if (r.tipo && ES_DEBITO.has(r.tipo) && r.pendiente < 0) errores.push(`${r.numero}: ${r.descripcion} con pendiente negativo`)
      if (r.tipo && !ES_DEBITO.has(r.tipo) && r.pendiente > 0) errores.push(`${r.numero}: ${r.descripcion} con pendiente positivo`)
    }
    if (!g.cuadra) errores.push(`La suma de lo pendiente (${g.suma}) no da el saldo del reporte (${g.saldo_reporte})`)

    let ya = 0
    if (cl) {
      for (const r of g.renglones) {
        if (r.tipo === "A_CUENTA") {
          if ([...yaACuenta].some((k) => k.startsWith(`${cl.id}|`) && k.includes(marcaACuenta(r.numero).toLowerCase()))) ya++
        } else if (r.tipo && yaComp.has(`${cl.id}|${r.tipo}|${r.numero}`)) ya++
      }
      const saldoActual = saldoDe.get(cl.id) || 0
      if (Math.abs(saldoActual) > 0.009 && ya < g.renglones.length) {
        avisos.push(`Ya tiene saldo en gmv2 (${saldoActual}): la apertura se SUMA a eso. Después de la puesta a cero tendría que estar en 0.`)
      }
      const nombreG = String(cl.nombre || cl.nombre_razon_social || "").toUpperCase()
      if (nombreG && !nombreG.includes(g.nombre.toUpperCase().split(" ")[0])) {
        avisos.push(`El nombre no coincide: en el reporte "${g.nombre}", en gmv2 "${cl.nombre || cl.nombre_razon_social}"`)
      }
    }
    if (errores.length) bloqueantes++
    return {
      ...g,
      cliente_id: cl?.id ?? null,
      nombre_gmv2: cl ? cl.nombre || cl.nombre_razon_social : null,
      es_empleado: !!cl?.es_empleado,
      saldo_actual_gmv2: cl ? saldoDe.get(cl.id) || 0 : 0,
      ya_cargados: ya,
      errores,
      avisos,
    }
  })

  return {
    clientes: out,
    total: r2(out.reduce((s, c) => s + c.suma, 0)),
    renglones: renglones.length,
    bloqueantes,
    puede_confirmar: bloqueantes === 0,
  }
}

export interface ResultadoConfirmacion {
  clientes: number
  comprobantes: number
  a_cuenta: number
  salteados: number
  errores: string[]
  /** Por cliente: saldo del libro después de cargar vs. saldo del reporte */
  control: Array<{ codigo_cliente: string; nombre: string; saldo_libro: number; saldo_reporte: number; cuadra: boolean }>
}

/** Graba la apertura de un LOTE de clientes (la pantalla manda de a tandas). */
export async function confirmarApertura(
  supabase: SupabaseClient,
  renglones: RenglonApertura[],
  usuarioId: string,
): Promise<ResultadoConfirmacion> {
  const previa = await previsualizarApertura(supabase, renglones)
  if (!previa.puede_confirmar) {
    throw new Error(`Hay ${previa.bloqueantes} clientes con errores: corregilos antes de confirmar`)
  }
  const res: ResultadoConfirmacion = { clientes: 0, comprobantes: 0, a_cuenta: 0, salteados: 0, errores: [], control: [] }
  const ahora = new Date().toISOString()

  for (const c of previa.clientes) {
    const clienteId = c.cliente_id!
    try {
      const { data: compsYa } = await supabase.from("comprobantes_venta").select("tipo_comprobante, numero_comprobante").eq("cliente_id", clienteId)
      const yaComp = new Set((compsYa || []).map((x: any) => `${x.tipo_comprobante}|${x.numero_comprobante}`))
      const { data: pagosYa } = await supabase.from("pagos_clientes").select("observaciones").eq("cliente_id", clienteId).ilike("observaciones", "APERTURA GM%")
      const obsPagos = (pagosYa || []).map((p: any) => String(p.observaciones || "").toLowerCase())

      const nuevosComp: any[] = []
      const nuevosPagos: any[] = []
      for (const r of c.renglones) {
        const tipo = r.tipo as TipoApertura
        if (tipo === "A_CUENTA") {
          if (obsPagos.some((o) => o.includes(marcaACuenta(r.numero).toLowerCase()))) { res.salteados++; continue }
          nuevosPagos.push({ r })
        } else {
          if (yaComp.has(`${tipo}|${r.numero}`)) { res.salteados++; continue }
          nuevosComp.push({ r, tipo })
        }
      }

      // Comprobantes
      if (nuevosComp.length) {
        const filas = nuevosComp.map(({ r, tipo }) => ({
          cliente_id: clienteId,
          tipo_comprobante: tipo,
          numero_comprobante: r.numero,
          punto_venta: r.numero.includes("-") ? r.numero.split("-")[0] : null,
          fecha: r.fecha,
          fecha_vencimiento: r.vencimiento || r.fecha,
          total_neto: r.importe,
          total_iva: 0,
          percepcion_iva: 0,
          percepcion_iibb: 0,
          total_factura: r.importe,
          saldo_pendiente: r.pendiente,
          estado_pago: Math.abs(r.pendiente) + 0.009 < Math.abs(r.importe) ? "parcial" : "pendiente",
          observaciones: `APERTURA GM — ${r.descripcion} ${r.numero} migrado del sistema anterior (importe ${r.importe}, pendiente ${r.pendiente}; viajante ${r.viajante})`,
          creado_por: usuarioId,
        }))
        const { data: creados, error } = await supabase.from("comprobantes_venta").insert(filas).select("id, tipo_comprobante, numero_comprobante")
        if (error) throw new Error(`comprobantes: ${error.message}`)
        const idDe = new Map((creados || []).map((x: any) => [`${x.tipo_comprobante}|${x.numero_comprobante}`, x.id]))
        const libro = nuevosComp.map(({ r, tipo }) => ({
          cliente_id: clienteId,
          fecha: fechaLibro(r.fecha),
          tipo_movimiento: MOV[tipo],
          debe: r.pendiente > 0 ? r2(r.pendiente) : 0,
          haber: r.pendiente < 0 ? r2(-r.pendiente) : 0,
          saldo: 0,
          referencia_tipo: "comprobante_venta",
          referencia_id: idDe.get(`${tipo}|${r.numero}`),
          numero_comprobante: r.numero,
          observaciones: `APERTURA GM ${tipo} ${r.numero}`,
          usuario_id: usuarioId,
        }))
        const { error: e2 } = await supabase.from("cuenta_corriente_clientes").insert(libro)
        if (e2) throw new Error(`libro (comprobantes): ${e2.message}`)
        res.comprobantes += nuevosComp.length
      }

      // Entregas a cuenta
      if (nuevosPagos.length) {
        const filas = nuevosPagos.map(({ r }) => ({
          cliente_id: clienteId,
          monto: r2(Math.abs(r.pendiente)),
          fecha_pago: r.fecha,
          estado: "confirmado",
          cobrador_tipo: "oficina",
          observaciones: `APERTURA GM — entrega ${marcaACuenta(r.numero)} migrada del sistema anterior (viajante ${r.viajante})`,
          creado_por: usuarioId,
          a_cuenta_decidido_por: usuarioId,
          a_cuenta_decidido_at: ahora,
        }))
        const { data: creados, error } = await supabase.from("pagos_clientes").insert(filas).select("id, observaciones")
        if (error) throw new Error(`a cuenta: ${error.message}`)
        const libro = (creados || []).map((p: any, i: number) => ({
          cliente_id: clienteId,
          fecha: fechaLibro(nuevosPagos[i].r.fecha),
          tipo_movimiento: "pago",
          debe: 0,
          haber: r2(Math.abs(nuevosPagos[i].r.pendiente)),
          saldo: 0,
          referencia_tipo: "pago_cliente",
          referencia_id: p.id,
          numero_comprobante: nuevosPagos[i].r.numero,
          observaciones: p.observaciones,
          usuario_id: usuarioId,
        }))
        const { error: e2 } = await supabase.from("cuenta_corriente_clientes").insert(libro)
        if (e2) throw new Error(`libro (a cuenta): ${e2.message}`)
        res.a_cuenta += nuevosPagos.length
      }

      // Control: el libro tiene que dar el saldo del reporte (+ lo que ya tenía)
      const { data: s } = await supabase.from("v_saldo_clientes").select("saldo_actual").eq("cliente_id", clienteId).maybeSingle()
      const saldoLibro = r2(Number(s?.saldo_actual || 0))
      const esperado = r2(c.saldo_reporte + (c.ya_cargados === 0 ? c.saldo_actual_gmv2 : 0))
      res.control.push({
        codigo_cliente: c.codigo_cliente,
        nombre: c.nombre,
        saldo_libro: saldoLibro,
        saldo_reporte: c.saldo_reporte,
        cuadra: Math.abs(saldoLibro - esperado) < 0.01,
      })
      res.clientes++
    } catch (e: any) {
      res.errores.push(`${c.codigo_cliente} ${c.nombre}: ${e?.message}`)
    }
  }
  return res
}
