import type { SupabaseClient } from "@supabase/supabase-js"
import { NUMERO_RESPALDO_DEVOLUCION } from "../cobranzas/respaldo-devolucion"
import { agruparPorCliente, ES_DEBITO, PREFIJO_AJUSTE_APERTURA, type ClienteApertura, type RenglonApertura, type TipoApertura } from "./parsear-chr"

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
 * Reglas del dueño del 26/10 (prueba integral de salida):
 *  - #5: los clientes con error NO frenan el archivo: se cargan los que están
 *    bien y los otros quedan listados aparte para corregir.
 *  - #6/#7: el texto libre ("10%", "CHEQUE RECH", "SEGURO AUDI"…) entra como
 *    AJUSTE del libro mayor (como "Ajustar saldo"), con el texto como concepto,
 *    la fecha original y el signo del pendiente. Las cuentas del personal son
 *    cuentas de cliente marcadas: lo suyo va a su cuenta personal igual.
 *  - #8: el saldo del reporte es la columna 31 (parsear-chr).
 *  - #18: los PRES viejos entran como PV 2; un PRES ya cargado con su número
 *    original (PV 1) también cuenta como cargado.
 *  - #9: un cliente cuyo CUIT y nombre no coinciden con gmv2 cambió de dueño:
 *    es error (no se le carga la deuda de otro).
 *
 * Controles que BLOQUEAN AL CLIENTE (no al archivo): cliente inexistente, otro
 * dueño, fecha o importe inválido, signo imposible, suma distinta del saldo.
 * Idempotente: un comprobante/a cuenta/ajuste ya cargado se saltea.
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
export { PREFIJO_AJUSTE_APERTURA }
/** Clave de idempotencia de un ajuste: el mismo número de renglón trae varios textos */
const claveAjuste = (r: RenglonApertura) => `[ap:${r.numero_original}|${r.descripcion}|${r2(r.pendiente)}]`
const soloDigitos = (s: unknown) => String(s || "").replace(/\D/g, "")
// R7 (27/10): el cruce por nombre era "la primera palabra del reporte aparece en
// el nombre de gmv2" (includes): "LA" o "DON" coincidían con cualquiera. Ahora se
// comparan palabras enteras y significativas (sin S.A., SRL, DE, LA…).
const PALABRAS_VACIAS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "SA", "SRL", "SAS", "SH", "SOC", "CIA", "HNOS"])
export function palabrasNombre(s: string): string[] {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !PALABRAS_VACIAS.has(w))
}
/** ¿El nombre del reporte es el mismo cliente que alguno de los nombres de gmv2? */
export function nombresCoinciden(reporte: string, ...gmv2: Array<string | null | undefined>): boolean {
  const r = palabrasNombre(reporte)
  if (!r.length) return true
  const nombres = gmv2.filter(Boolean) as string[]
  if (!nombres.length) return true
  return nombres.some((n) => {
    const g = new Set(palabrasNombre(n))
    const comunes = r.filter((w) => g.has(w)).length
    return comunes >= 2 || (comunes >= 1 && Math.min(r.length, g.size) === 1)
  })
}

export interface ClientePrevia extends ClienteApertura {
  cliente_id: string | null
  nombre_gmv2: string | null
  es_empleado: boolean
  saldo_actual_gmv2: number
  ya_cargados: number
  /** Renglones de texto libre que entran como ajuste */
  ajustes: number
  errores: string[]
  avisos: string[]
}

export interface Previa {
  clientes: ClientePrevia[]
  total: number
  renglones: number
  /** Clientes con error: NO se cargan (el resto sí) */
  bloqueantes: number
  /** Clientes que se van a cargar */
  importables: number
  total_importable: number
  total_con_error: number
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
      .select("id, codigo_cliente, nombre, nombre_razon_social, cuit, es_empleado")
      .in("codigo_cliente", variantes.slice(i, i + 200))
    if (error) throw error
    clientes.push(...(data || []))
  }
  const porCodigo = new Map<string, any>()
  for (const c of clientes) porCodigo.set(String(c.codigo_cliente).replace(/^0+(?=\d)/, ""), c)

  // R7: cuentas del personal, para no cargar la deuda de un empleado a un cliente (o al revés)
  const { data: empleados } = await supabase.from("clientes").select("id, codigo_cliente, nombre, nombre_razon_social").eq("es_empleado", true)

  const ids = clientes.map((c) => c.id)
  const saldoDe = new Map<string, number>()
  const yaComp = new Set<string>()
  const yaACuenta = new Set<string>()
  const yaAjuste = new Set<string>()
  for (let i = 0; i < ids.length; i += 150) {
    const parte = ids.slice(i, i + 150)
    const [{ data: saldos }, { data: comps }, { data: pagos }, { data: ajustes }] = await Promise.all([
      supabase.from("v_saldo_clientes").select("cliente_id, saldo_actual").in("cliente_id", parte),
      supabase.from("comprobantes_venta").select("cliente_id, tipo_comprobante, numero_comprobante").in("cliente_id", parte),
      supabase.from("pagos_clientes").select("cliente_id, observaciones").in("cliente_id", parte).ilike("observaciones", "APERTURA GM%"),
      supabase.from("cuenta_corriente_clientes").select("cliente_id, observaciones").in("cliente_id", parte).ilike("observaciones", `${PREFIJO_AJUSTE_APERTURA}%`),
    ])
    for (const s of saldos || []) saldoDe.set(s.cliente_id, Number(s.saldo_actual) || 0)
    for (const c of comps || []) yaComp.add(`${c.cliente_id}|${c.tipo_comprobante}|${c.numero_comprobante}`)
    for (const p of pagos || []) yaACuenta.add(`${p.cliente_id}|${String(p.observaciones || "").toLowerCase()}`)
    for (const a of ajustes || []) yaAjuste.add(`${a.cliente_id}|${a.observaciones}`)
  }
  const ajusteCargado = (clienteId: string, r: RenglonApertura) =>
    [...yaAjuste].some((k) => k.startsWith(`${clienteId}|`) && k.includes(claveAjuste(r)))
  const compCargado = (clienteId: string, r: RenglonApertura) =>
    yaComp.has(`${clienteId}|${r.tipo}|${r.numero}`) || yaComp.has(`${clienteId}|${r.tipo}|${r.numero_original}`)

  let bloqueantes = 0
  const out: ClientePrevia[] = grupos.map((g) => {
    const cl = porCodigo.get(g.codigo_cliente)
    const errores: string[] = []
    const avisos: string[] = []
    if (!cl) errores.push(`El cliente ${g.codigo_cliente} (${g.nombre}) no existe en gmv2: hay que darlo de alta`)
    for (const r of g.renglones) {
      if (!r.tipo) errores.push(`${r.numero}: tipo desconocido "${r.descripcion}"`)
      if (!r.fecha) errores.push(`${r.numero}: fecha inválida`)
      if (!Number.isFinite(r.pendiente) || !Number.isFinite(r.importe)) errores.push(`${r.numero}: importe inválido`)
      if (r.tipo && r.tipo !== "AJUSTE" && ES_DEBITO.has(r.tipo) && r.pendiente < 0) errores.push(`${r.numero}: ${r.descripcion} con pendiente negativo`)
      if (r.tipo && r.tipo !== "AJUSTE" && !ES_DEBITO.has(r.tipo) && r.pendiente > 0) errores.push(`${r.numero}: ${r.descripcion} con pendiente positivo`)
      // R9 (#18): los PRES viejos entran con PV 0002. Solo está previsto el PV 0001
      // del sistema viejo (otro PV chocaría con sus mismos números) y ninguno puede
      // caer en el número del respaldo de devoluciones (#28).
      if (r.tipo === "PRES" && r.numero_original.split("-")[0] !== "0001")
        errores.push(`${r.numero_original}: PRES de un punto de venta del sistema viejo que no es el 0001. Entraría como ${r.numero} y podría chocar con otro: avisá antes de cargarlo.`)
      if (r.tipo === "PRES" && r.numero === NUMERO_RESPALDO_DEVOLUCION)
        errores.push(`${r.numero_original}: entraría como ${r.numero}, el mismo número del comprobante de respaldo de devoluciones. Avisá antes de cargarlo.`)
    }
    if (!g.cuadra) errores.push(`La suma de lo pendiente (${g.suma}) no da el saldo del reporte (${g.saldo_reporte})`)

    let ya = 0
    if (cl) {
      const nombreCoincide = nombresCoinciden(g.nombre, cl.nombre, cl.nombre_razon_social)
      // R7: el código lleva a una cuenta del personal, o el nombre es el de un
      // empleado y el código lleva a otro cliente: no se carga sin revisar.
      const empleadoPorNombre = (empleados || []).find((e: any) => e.id !== cl.id && nombresCoinciden(g.nombre, e.nombre, e.nombre_razon_social) && palabrasNombre(g.nombre).length > 0)
      if (!nombreCoincide && cl.es_empleado) {
        errores.push(`El ${g.codigo_cliente} en gmv2 es la cuenta del personal de "${cl.nombre || cl.nombre_razon_social}", pero en el reporte es "${g.nombre}". Revisá el código antes de cargarlo (no se carga deuda de otro a una cuenta del personal).`)
      } else if (!nombreCoincide && empleadoPorNombre) {
        errores.push(`"${g.nombre}" parece la cuenta del personal de "${empleadoPorNombre.nombre || empleadoPorNombre.nombre_razon_social}" (código ${empleadoPorNombre.codigo_cliente} en gmv2), pero el código ${g.codigo_cliente} es "${cl.nombre || cl.nombre_razon_social}". Revisá el código antes de cargarlo.`)
      }
      const cuitR = soloDigitos(g.renglones[0]?.cuit)
      const cuitG = soloDigitos(cl.cuit)
      if (cuitR && cuitG && cuitR !== cuitG) {
        if (!nombreCoincide) {
          errores.push(`Cambió de dueño: en el reporte es "${g.nombre}" (CUIT ${g.renglones[0].cuit}), en gmv2 el ${g.codigo_cliente} es "${cl.nombre || cl.nombre_razon_social}" (CUIT ${cl.cuit}). Corregí la ficha antes de cargarlo.`)
        } else {
          avisos.push(`El CUIT no coincide: reporte ${g.renglones[0].cuit}, gmv2 ${cl.cuit}`)
        }
      } else if (!nombreCoincide) {
        avisos.push(`El nombre no coincide: en el reporte "${g.nombre}", en gmv2 "${cl.nombre || cl.nombre_razon_social}"`)
      }
      for (const r of g.renglones) {
        if (r.tipo === "A_CUENTA") {
          if ([...yaACuenta].some((k) => k.startsWith(`${cl.id}|`) && k.includes(marcaACuenta(r.numero).toLowerCase()))) ya++
        } else if (r.tipo === "AJUSTE") {
          if (ajusteCargado(cl.id, r)) ya++
        } else if (r.tipo && compCargado(cl.id, r)) ya++
      }
      const saldoActual = saldoDe.get(cl.id) || 0
      if (Math.abs(saldoActual) > 0.009 && ya < g.renglones.length) {
        avisos.push(`Ya tiene saldo en gmv2 (${saldoActual}): la apertura se SUMA a eso. Después de la puesta a cero tendría que estar en 0.`)
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
      ajustes: g.renglones.filter((r) => r.tipo === "AJUSTE").length,
      errores,
      avisos,
    }
  })

  const conError = out.filter((c) => c.errores.length)
  const importables = out.length - conError.length
  return {
    clientes: out,
    total: r2(out.reduce((s, c) => s + c.suma, 0)),
    renglones: renglones.length,
    bloqueantes,
    importables,
    total_importable: r2(out.filter((c) => !c.errores.length).reduce((s, c) => s + c.suma, 0)),
    total_con_error: r2(conError.reduce((s, c) => s + c.suma, 0)),
    puede_confirmar: importables > 0,
  }
}

export interface ResultadoConfirmacion {
  clientes: number
  comprobantes: number
  a_cuenta: number
  ajustes: number
  salteados: number
  /** Clientes del lote que NO se cargaron por tener error (se corrigen y se vuelve a subir) */
  no_importados: Array<{ codigo_cliente: string; nombre: string; errores: string[] }>
  errores: string[]
  /** Por cliente: saldo del libro después de cargar vs. saldo del reporte */
  control: Array<{ codigo_cliente: string; nombre: string; saldo_libro: number; saldo_reporte: number; cuadra: boolean }>
}

/** Graba la apertura de un LOTE de clientes (la pantalla manda de a tandas). Los clientes con error se saltean. */
export async function confirmarApertura(
  supabase: SupabaseClient,
  renglones: RenglonApertura[],
  usuarioId: string,
): Promise<ResultadoConfirmacion> {
  const previa = await previsualizarApertura(supabase, renglones)
  const res: ResultadoConfirmacion = { clientes: 0, comprobantes: 0, a_cuenta: 0, ajustes: 0, salteados: 0, no_importados: [], errores: [], control: [] }
  const ahora = new Date().toISOString()

  for (const c of previa.clientes) {
    if (c.errores.length || !c.cliente_id) {
      res.no_importados.push({ codigo_cliente: c.codigo_cliente, nombre: c.nombre, errores: c.errores })
      continue
    }
    const clienteId = c.cliente_id
    try {
      const { data: compsYa } = await supabase.from("comprobantes_venta").select("tipo_comprobante, numero_comprobante").eq("cliente_id", clienteId)
      const yaComp = new Set((compsYa || []).map((x: any) => `${x.tipo_comprobante}|${x.numero_comprobante}`))
      const { data: pagosYa } = await supabase.from("pagos_clientes").select("observaciones").eq("cliente_id", clienteId).ilike("observaciones", "APERTURA GM%")
      const obsPagos = (pagosYa || []).map((p: any) => String(p.observaciones || "").toLowerCase())
      const { data: ajustesYa } = await supabase.from("cuenta_corriente_clientes").select("observaciones").eq("cliente_id", clienteId).ilike("observaciones", `${PREFIJO_AJUSTE_APERTURA}%`)
      const obsAjustes = (ajustesYa || []).map((a: any) => String(a.observaciones || ""))

      const nuevosComp: any[] = []
      const nuevosPagos: any[] = []
      const nuevosAjustes: RenglonApertura[] = []
      for (const r of c.renglones) {
        const tipo = r.tipo as TipoApertura
        if (tipo === "A_CUENTA") {
          if (obsPagos.some((o) => o.includes(marcaACuenta(r.numero).toLowerCase()))) { res.salteados++; continue }
          nuevosPagos.push({ r })
        } else if (tipo === "AJUSTE") {
          if (obsAjustes.some((o) => o.includes(claveAjuste(r)))) { res.salteados++; continue }
          if (Math.abs(r.pendiente) < 0.005) { res.salteados++; continue } // nada pendiente: no mueve el saldo
          nuevosAjustes.push(r)
        } else {
          if (yaComp.has(`${tipo}|${r.numero}`) || yaComp.has(`${tipo}|${r.numero_original}`)) { res.salteados++; continue }
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
          observaciones: `APERTURA GM — ${r.descripcion} ${r.numero}${r.numero !== r.numero_original ? ` (en el sistema viejo ${r.numero_original})` : ""} migrado del sistema anterior (importe ${r.importe}, pendiente ${r.pendiente}; viajante ${r.viajante})`,
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

      // Ajustes (texto libre): como "Ajustar saldo", solo libro mayor, con su fecha
      if (nuevosAjustes.length) {
        const libro = nuevosAjustes.map((r) => ({
          cliente_id: clienteId,
          fecha: fechaLibro(r.fecha),
          tipo_movimiento: "ajuste",
          debe: r.pendiente > 0 ? r2(r.pendiente) : 0,
          haber: r.pendiente < 0 ? r2(-r.pendiente) : 0,
          saldo: 0,
          referencia_tipo: "ajuste_manual",
          referencia_id: null,
          numero_comprobante: r.numero,
          observaciones: `${PREFIJO_AJUSTE_APERTURA} — ${r.descripcion} (importe ${r.importe}, pendiente ${r.pendiente}; viajante ${r.viajante}) ${claveAjuste(r)}`,
          usuario_id: usuarioId,
        }))
        const { error: e3 } = await supabase.from("cuenta_corriente_clientes").insert(libro)
        if (e3) throw new Error(`libro (ajustes): ${e3.message}`)
        res.ajustes += nuevosAjustes.length
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
