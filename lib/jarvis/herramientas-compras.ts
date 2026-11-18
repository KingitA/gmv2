/**
 * Herramientas de Jarvis para COMPRAS y PAGOS a proveedores (E-80, E-83).
 *
 * Todas son de SOLO LECTURA. Las cuentas se hacen en la base (funciones jarvis_* de la migración
 * 20261119c_jarvis_compras.sql) y son las mismas que usan los reportes de Playroom
 * (lib/jarvis/reportes-compras.ts).
 *
 * Roles: órdenes de pago, retenciones y el plan de pagos son SOLO ADMIN, igual que sus pantallas.
 *
 * Las utilidades comunes (buscar proveedor / artículo, armar tablas, saber si es admin) las pasa
 * lib/jarvis/herramientas.ts al crear estas herramientas: así no se duplican.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Bloque, Formato } from "@/lib/playroom/bloques"
import { sumarDiasISO } from "@/lib/formato"
import { acuerdoDeProveedorConLegado, acuerdoDelCanal, textoCanal } from "@/lib/compras/acuerdo-pago"
import { cargarPagosSemana } from "@/lib/finanzas/pagos-semana-datos"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import type { Contexto, Herramienta } from "./herramientas"
import { PERIODOS, resolverPeriodo } from "./periodos"
import {
  consulta, DESTINO_DIFERENCIA, ESTADO_OC, FaltaMigracion, filasNotas, repOcPendientes, repRetenciones, type Fila,
} from "./reportes-compras"

type Params = Record<string, unknown>
type TablaBloque = Extract<Bloque, { tipo: "tabla" }>

export interface AyudasJarvis {
  resolverProveedor: (db: SupabaseClient, texto: string) => Promise<{ id: string; nombre: string }>
  resolverArticulo: (db: SupabaseClient, texto: string) => Promise<{ id: string; sku: string; descripcion: string }>
  esAdmin: (ctx: Contexto) => Promise<boolean>
  tabla: (titulo: string, columnas: { clave: string; titulo: string; formato?: Formato }[], filas: Record<string, string | number | null>[],
          extra?: { total?: Record<string, number>; nota?: string }) => TablaBloque
  /** Error que se le muestra a la IA tal cual */
  error: (mensaje: string) => Error
}

const n0 = (v: unknown) => Number(v) || 0
const red = (v: unknown, dec = 0) => Math.round(n0(v) * 10 ** dec) / 10 ** dec
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)
const limite = (v: unknown, def = 15, max = 50) => Math.max(1, Math.min(max, Number(v) || def))
const fechaSola = (v: unknown) => (v == null ? null : String(v).slice(0, 10))
const siNo = (v: unknown) => (v === true ? "sí" : v === false ? "no" : "no está cargado")

const P_PERIODO = {
  periodo: { type: "string", enum: [...PERIODOS], description: "Período con nombre. \"El último año\" = ultimos_12_meses." },
  desde: { type: "string", description: "Fecha inicial AAAA-MM-DD (solo si pidieron fechas exactas)" },
  hasta: { type: "string", description: "Fecha final AAAA-MM-DD" },
}
const P_LIMITE = { limite: { type: "integer", description: "Cuántas filas mostrar (máx. 50)" } }
const FUENTE_COMPRAS = "Comprobantes de compra VALIDADOS (no cuenta remitos, notas esperadas ni órdenes de compra sin facturar; las notas de crédito y reversas restan)."

export function crearHerramientasCompras(a: AyudasJarvis): Herramienta[] {
  /** Corre la herramienta; si la consulta no está instalada, se lo dice a la IA con palabras claras. */
  const seguro = (fn: Herramienta["ejecutar"]): Herramienta["ejecutar"] => async (ctx, p) => {
    try { return await fn(ctx, p) } catch (e) { if (e instanceof FaltaMigracion) throw a.error(e.message); throw e }
  }
  const proveedorDe = async (ctx: Contexto, p: Params) => (str(p.proveedor) ? a.resolverProveedor(ctx.db, str(p.proveedor)!) : null)
  const articuloDe = async (ctx: Contexto, p: Params) => (str(p.articulo) ? a.resolverArticulo(ctx.db, str(p.articulo)!) : null)

  // ─── 1. Compras ──────────────────────────────────────────────────────────
  const AGRUPAR = ["total", "proveedor", "mes", "canal", "articulo"] as const
  const compras: Herramienta = {
    nombre: "compras",
    descripcion:
      "Cuánto COMPRAMOS en un período (lo que nos facturaron los proveedores), separado en CON factura (\"en blanco\") y SIN factura (\"en negro\": adquisiciones). " +
      "Se puede agrupar por proveedor, mes, canal o artículo, y filtrar por proveedor o artículo. Usala para \"¿cuánto compramos en blanco / en negro el último año?\", \"¿cuánto le compramos a X?\", \"¿cuánto compramos de tal artículo?\". " +
      "Siempre devuelve además el total con factura y sin factura del período. " + FUENTE_COMPRAS,
    esquema: {
      type: "object",
      properties: { ...P_PERIODO, agrupar: { type: "string", enum: [...AGRUPAR] }, proveedor: { type: "string" }, articulo: { type: "string", description: "Código o descripción, como lo dice la gente" }, ...P_LIMITE },
    },
    ejecutar: seguro(async (ctx, p) => {
      const r = resolverPeriodo(p as never, "ultimos_12_meses", ctx.hoy)
      const [prov, art] = await Promise.all([proveedorDe(ctx, p), articuloDe(ctx, p)])
      const agrupar = (AGRUPAR as readonly string[]).includes(String(p.agrupar)) ? String(p.agrupar) : "total"
      const args = { p_desde: r.desde, p_hasta: r.hasta, p_proveedor_id: prov?.id ?? null, p_articulo_id: art?.id ?? null }
      const [rows, porCanal] = await Promise.all([
        consulta(ctx.db, "jarvis_compras", { ...args, p_agrupar: agrupar }, ["clave_id"]),
        consulta(ctx.db, "jarvis_compras", { ...args, p_agrupar: "canal" }),
      ])
      const porRenglon = !!art || agrupar === "articulo"   // importes netos (sin IVA) y unidades
      const blanco = porCanal.find((x) => x.clave_id === "blanco"), negro = porCanal.find((x) => x.clave_id === "negro")
      const totales = porRenglon
        ? { con_factura_neto: red(blanco?.total), sin_factura: red(negro?.total), total: red(n0(blanco?.total) + n0(negro?.total)), unidades: red(n0(blanco?.unidades) + n0(negro?.unidades), 2) }
        : { con_factura_neto: red(blanco?.blanco_neto), con_factura_total: red(blanco?.blanco_total), sin_factura: red(negro?.negro_total), total: red(n0(blanco?.total) + n0(negro?.total)) }
      const filas = rows.map((x) => ({
        nombre: String(x.clave ?? "—"), comprobantes: n0(x.comprobantes),
        con_factura_neto: red(x.blanco_neto), con_factura_total: x.blanco_total == null ? null : red(x.blanco_total),
        sin_factura: red(x.negro_total), total: red(x.total), unidades: x.unidades == null ? null : red(x.unidades, 2),
      })).sort((x, y) => (agrupar === "mes" ? x.nombre.localeCompare(y.nombre) : y.total - x.total))
      const lim = limite(p.limite, agrupar === "mes" ? 24 : 15)
      const titulo = `Compras ${r.etiqueta}${prov ? ` — ${prov.nombre}` : ""}${art ? ` — ${art.sku} ${art.descripcion}` : ""}`
      const cols: { clave: string; titulo: string; formato?: Formato }[] = [
        { clave: "nombre", titulo: agrupar === "proveedor" ? "Proveedor" : agrupar === "mes" ? "Mes" : agrupar === "articulo" ? "Artículo" : agrupar === "canal" ? "Canal" : "" },
        { clave: "con_factura_neto", titulo: "Con factura (neto)", formato: "pesos" },
        ...(porRenglon ? [] : [{ clave: "con_factura_total", titulo: "Con factura (total)", formato: "pesos" as Formato }]),
        { clave: "sin_factura", titulo: "Sin factura", formato: "pesos" }, { clave: "total", titulo: "Total", formato: "pesos" },
        ...(porRenglon ? [{ clave: "unidades", titulo: "Unidades", formato: "numero" as Formato }] : []),
      ]
      const bloque = a.tabla(titulo, cols, filas.slice(0, lim), {
        nota: (porRenglon ? "Importes netos (sin IVA), por renglón de cada comprobante. " : "\"Total\" = con factura (con IVA y percepciones) + sin factura. ") + FUENTE_COMPRAS,
      })
      return {
        consultado: `Comprobantes de compra validados ${r.etiqueta}${prov ? ` de ${prov.nombre}` : ""}${art ? ` del artículo ${art.sku}` : ""}`,
        datos: { periodo: r, totales, importes: porRenglon ? "netos sin IVA, por renglón" : "por comprobante", agrupado_por: agrupar, cantidad: filas.length, filas: filas.slice(0, lim), fuente: FUENTE_COMPRAS },
        bloques: [{ ...bloque, recalcular: { herramienta: "compras", parametros: { ...p } } }],
      }
    }),
  }

  // ─── 2. Última compra ────────────────────────────────────────────────────
  const ultimaCompra: Herramienta = {
    nombre: "ultima_compra",
    descripcion:
      "La ÚLTIMA compra (y las anteriores) de un artículo o a un proveedor: fecha, comprobante, orden de compra, cantidad, precio de lista, descuentos y costo neto por unidad. " +
      "Usala para \"¿cuándo fue la última compra de …?\", \"¿a cuánto compramos el … la última vez?\", \"¿qué le compramos a X la última vez?\". Hace falta el artículo, el proveedor, o los dos. " + FUENTE_COMPRAS,
    esquema: { type: "object", properties: { articulo: { type: "string" }, proveedor: { type: "string" }, ...P_LIMITE } },
    ejecutar: seguro(async (ctx, p) => {
      const [prov, art] = await Promise.all([proveedorDe(ctx, p), articuloDe(ctx, p)])
      if (!prov && !art) throw a.error("Decime de qué artículo o de qué proveedor querés saber la última compra.")
      const lim = limite(p.limite, art ? 5 : 20, 50)
      const mapear = (x: Fila) => ({
        fecha: fechaSola(x.fecha), proveedor: String(x.proveedor ?? "—"), comprobante: `${x.tipo_comprobante} ${x.numero_comprobante}`,
        con_factura: x.canal === "negro" ? "no" : "sí", orden: x.orden ?? null,
        articulo: `${x.sku ?? ""} ${x.articulo ?? ""}`.trim(), cantidad: `${red(x.cantidad, 2)} ${x.tipo_cantidad === "bulto" ? "bultos" : "unidades"}`,
        unidades: red(x.unidades, 2), precio_lista: x.precio_lista == null ? null : red(x.precio_lista, 2), descuentos: x.descuentos ?? null,
        costo_neto_unidad: x.neto_unitario == null ? null : red(x.neto_unitario, 2), neto_renglon: red(x.neto_linea, 2),
      })
      let filas: ReturnType<typeof mapear>[]
      let comprobante: Fila | null = null
      if (art) {
        filas = (await consulta(ctx.db, "jarvis_compras_renglones", { p_articulo_id: art.id, p_proveedor_id: prov?.id ?? null, p_desde: null, p_hasta: null, p_limite: lim })).map(mapear)
      } else {
        // Solo proveedor: su último comprobante validado, con todos sus renglones
        const { data, error } = await ctx.db.from("comprobantes_compra")
          .select("id, tipo_comprobante, numero_comprobante, fecha_comprobante, total_factura_declarado, total_neto, ordenes_compra(numero_orden)")
          .eq("proveedor_id", prov!.id).in("estado", ["validado", "cerrado"]).in("tipo_comprobante", ["FA", "FB", "FC", "Adquisicion", "ADQ"])
          .order("fecha_comprobante", { ascending: false }).order("created_at", { ascending: false }).limit(1)
        if (error) throw new Error(error.message)
        comprobante = (data?.[0] as Fila) ?? null
        const todos = comprobante ? await consulta(ctx.db, "jarvis_compras_renglones", { p_articulo_id: null, p_proveedor_id: prov!.id, p_desde: comprobante.fecha_comprobante, p_hasta: comprobante.fecha_comprobante, p_limite: 500 }) : []
        filas = todos.filter((x) => x.comprobante_id === comprobante!.id).map(mapear)
      }
      if (filas.length === 0 && !comprobante) {
        return {
          consultado: `Compras validadas ${art ? `del artículo ${art.sku} ${art.descripcion}` : `a ${prov!.nombre}`}`,
          datos: { encontrado: false, aclaracion: `No hay ningún comprobante de compra validado ${art ? "con ese artículo" : "de ese proveedor"} en el sistema. Las compras anteriores al sistema nuevo no están cargadas.` },
          bloques: [],
        }
      }
      const orden = (comprobante?.ordenes_compra as any)
      const bloque = a.tabla(
        art ? `Últimas compras de ${art.sku} ${art.descripcion}` : `Última compra a ${prov!.nombre}`,
        [
          { clave: "fecha", titulo: "Fecha", formato: "fecha" }, ...(art ? [{ clave: "proveedor", titulo: "Proveedor" }] : [{ clave: "articulo", titulo: "Artículo" }]),
          { clave: "comprobante", titulo: "Comprobante" }, { clave: "cantidad", titulo: "Cantidad" },
          { clave: "precio_lista", titulo: "Precio de lista", formato: "pesos" as Formato }, { clave: "descuentos", titulo: "Dtos. %" },
          { clave: "costo_neto_unidad", titulo: "Costo neto x unidad", formato: "pesos" as Formato },
        ],
        filas.slice(0, lim),
        { nota: "El precio de lista está como vino en la factura (por bulto si se facturó por bulto); el costo neto está siempre por unidad, sin IVA." },
      )
      return {
        consultado: `Comprobantes de compra validados ${art ? `con el artículo ${art.sku} ${art.descripcion}` : `de ${prov!.nombre}`}`,
        datos: {
          encontrado: true,
          ultima: art ? filas[0] : {
            fecha: fechaSola(comprobante!.fecha_comprobante), comprobante: `${comprobante!.tipo_comprobante} ${comprobante!.numero_comprobante}`,
            total: red(comprobante!.total_factura_declarado, 2), neto: red(comprobante!.total_neto, 2),
            orden: (Array.isArray(orden) ? orden[0] : orden)?.numero_orden ?? null, renglones: filas.length,
          },
          filas: filas.slice(0, lim), fuente: FUENTE_COMPRAS,
        },
        bloques: [bloque],
      }
    }),
  }

  // ─── 3. Ficha del proveedor: cómo le pagamos ─────────────────────────────
  const MEDIO_OP: Record<string, string> = { efectivo: "efectivo", transferencia: "transferencia", cheque: "cheque de terceros", cheque_propio: "cheque propio", deposito: "depósito" }
  const fichaProveedor: Herramienta = {
    nombre: "ficha_proveedor",
    descripcion:
      "CÓMO LE PAGAMOS a un proveedor y sus datos de compra: acuerdo de pago con factura y sin factura (medio, plazo, cuotas, desde cuándo corre), datos para pagarle (CBU, alias, titular, si acepta cheques de terceros o e-cheq), " +
      "si está exento de la retención de Ganancias, cómo aplica los descuentos (en cascada / sobre lista), a dónde se le mandan las órdenes y cuánto tarda en entregar. " +
      "Para un administrador agrega con QUÉ MEDIOS se le pagó de verdad en el último año (órdenes de pago). Usala para \"¿cómo le pagamos a fulano?\", \"¿acepta cheques?\", \"¿cuál es el CBU de X?\".",
    esquema: { type: "object", properties: { proveedor: { type: "string" } }, required: ["proveedor"] },
    ejecutar: seguro(async (ctx, p) => {
      const prov = await proveedorDe(ctx, p)
      if (!prov) throw a.error("Decime de qué proveedor.")
      const { data, error } = await ctx.db.from("proveedores").select("*").eq("id", prov.id).maybeSingle()
      if (error || !data) throw new Error(error?.message ?? "No encontré el proveedor")
      const f = data as Fila
      const acuerdo = acuerdoDeProveedorConLegado(f)
      const blanco = acuerdoDelCanal(acuerdo, "blanco"), negro = acuerdoDelCanal(acuerdo, "negro")
      const exento = f.condicion_ganancias === "exento"
      const exentoVencido = exento && f.ganancias_exento_hasta && String(f.ganancias_exento_hasta) < ctx.hoy
      const admin = await a.esAdmin(ctx)
      let pagosReales: unknown = "Con qué medios se le pagó de verdad (órdenes de pago) solo lo puede ver un administrador."
      if (admin) {
        const desde = sumarDiasISO(ctx.hoy, -365)
        const ops = await fetchAllRows<Fila>(() => ctx.db.from("ordenes_pago").select("id, fecha, neto_a_pagar, ordenes_pago_detalle(medio, monto, es_echeq)")
          .eq("proveedor_id", prov.id).eq("estado", "pagada").gte("fecha", desde), "id")
        const porMedio = new Map<string, { veces: number; monto: number }>()
        for (const o of ops) for (const m of (o.ordenes_pago_detalle ?? []) as Fila[]) {
          const nombre = m.medio === "cheque_propio" && m.es_echeq ? "e-cheq" : MEDIO_OP[String(m.medio)] ?? String(m.medio)
          const x = porMedio.get(nombre) ?? { veces: 0, monto: 0 }
          x.veces++; x.monto += n0(m.monto); porMedio.set(nombre, x)
        }
        pagosReales = ops.length === 0 ? "No tiene órdenes de pago pagadas en el último año."
          : { ordenes_pagadas_ultimo_anio: ops.length, ultima: ops.map((o) => fechaSola(o.fecha)).sort().pop(),
              por_medio: [...porMedio.entries()].map(([medio, x]) => ({ medio, veces: x.veces, monto: red(x.monto) })).sort((x, y) => y.monto - x.monto) }
      }
      const ficha = {
        proveedor: prov.nombre,
        acuerdo_con_factura: textoCanal(blanco) || "sin acuerdo cargado en la ficha",
        acuerdo_sin_factura: acuerdo.negro ? textoCanal(negro) : "igual que con factura (no tiene uno propio)",
        acuerdo_incompleto: blanco.de_legado ? "El plazo sale del dato viejo de la ficha: falta cargar el acuerdo de pago nuevo." : null,
        mixto_pct_con_factura: f.mixto_pct_factura ?? null,
        datos_para_pagarle: {
          cbu: f.cbu ?? null, alias: f.cbu_alias ?? null, titular: f.banco_titular ?? null, banco: f.banco_nombre ?? null,
          acepta_cheques_de_terceros: siNo(f.acepta_cheques_terceros), acepta_echeq: siNo(f.acepta_echeq),
        },
        retencion_ganancias: exento
          ? (exentoVencido ? `EXENTO, pero el certificado venció el ${String(f.ganancias_exento_hasta).slice(8, 10)}/${String(f.ganancias_exento_hasta).slice(5, 7)}/${String(f.ganancias_exento_hasta).slice(0, 4)}: hoy se le retiene`
            : `EXENTO: no se le retiene${f.ganancias_exento_hasta ? ` (certificado hasta el ${String(f.ganancias_exento_hasta).slice(8, 10)}/${String(f.ganancias_exento_hasta).slice(5, 7)}/${String(f.ganancias_exento_hasta).slice(0, 4)})` : ""}`)
          : `se le retiene (${f.condicion_ganancias === "no_inscripto" ? "no inscripto" : "inscripto"}, régimen ${f.regimen_ganancias ?? "bienes"})`,
        descuentos: f.tipo_descuento === "sobre_lista" ? "sobre precio de lista (se suman)" : "en cascada (uno sobre el otro)",
        ordenes_de_compra_a: f.mail_ordenes_compra ?? "no tiene mail de órdenes cargado",
        dias_de_entrega: f.dias_entrega ?? null, transporte_habitual: f.transporte_habitual ?? null, observaciones_de_compra: f.observaciones_compra ?? null,
        como_se_le_pago_de_verdad: pagosReales,
      }
      const bloque = a.tabla(`Cómo le pagamos a ${prov.nombre}`, [{ clave: "dato", titulo: "Dato" }, { clave: "valor", titulo: "Valor" }], [
        { dato: "Acuerdo con factura", valor: ficha.acuerdo_con_factura }, { dato: "Acuerdo sin factura", valor: ficha.acuerdo_sin_factura },
        { dato: "CBU", valor: ficha.datos_para_pagarle.cbu ?? "no está cargado" }, { dato: "Alias", valor: ficha.datos_para_pagarle.alias ?? "no está cargado" },
        { dato: "Titular", valor: ficha.datos_para_pagarle.titular ?? "no está cargado" },
        { dato: "Acepta cheques de terceros", valor: ficha.datos_para_pagarle.acepta_cheques_de_terceros }, { dato: "Acepta e-cheq", valor: ficha.datos_para_pagarle.acepta_echeq },
        { dato: "Retención de Ganancias", valor: ficha.retencion_ganancias }, { dato: "Descuentos", valor: ficha.descuentos },
      ])
      return { consultado: `Ficha de ${prov.nombre} (acuerdo de pago y datos de compra)${admin ? " y sus órdenes de pago del último año" : ""}`, datos: { ...ficha, fuente: "Ficha del proveedor" + (admin ? " y órdenes de pago pagadas" : "") }, bloques: [bloque] }
    }),
  }

  // ─── 4. Cuenta corriente del proveedor ───────────────────────────────────
  const cuentaCorrienteProveedor: Herramienta = {
    nombre: "cuenta_corriente_proveedor",
    descripcion:
      "Cuánto LE DEBEMOS a un proveedor y por qué: saldo de su cuenta corriente, comprobantes abiertos (con lo que falta de cada uno y cuándo vence), créditos sin aplicar (notas de crédito, pagos a cuenta), " +
      "vencimientos anotados a mano sin comprobante, y APARTE lo comprometido por órdenes de compra sin facturar (que NO es deuda). Es LA cifra oficial de deuda con un proveedor: usala para \"¿cuánto le debemos a X?\", \"¿qué facturas le debemos?\". " +
      "Sin proveedor, devuelve el ranking de a quién le debemos más.",
    esquema: { type: "object", properties: { proveedor: { type: "string" }, ...P_LIMITE } },
    ejecutar: seguro(async (ctx, p) => {
      const prov = await proveedorDe(ctx, p)
      const lim = limite(p.limite, 20)
      const FUENTE = "Cuenta corriente del proveedor (saldo único) + vencimientos cargados a mano sin comprobante. Lo comprometido por órdenes de compra no es deuda."
      if (!prov) {
        const rows = await consulta(ctx.db, "jarvis_cc_proveedores", { p_proveedor_id: null }, ["proveedor_id"])
        const filas = rows.map((r) => ({
          proveedor: String(r.proveedor), deuda: red(r.deuda_total), vencido: red(n0(r.vencido_1_30) + n0(r.vencido_31_60) + n0(r.vencido_61_90) + n0(r.vencido_mas_90)),
          proximo_vencimiento: fechaSola(r.proximo_vencimiento), comprometido_oc: red(r.comprometido_oc),
        })).filter((x) => Math.abs(x.deuda) > 0.5 || x.comprometido_oc > 0.5).sort((x, y) => y.deuda - x.deuda)
        const total = red(filas.reduce((s, x) => s + x.deuda, 0)), comprometido = red(filas.reduce((s, x) => s + x.comprometido_oc, 0))
        const bloque = a.tabla("Lo que les debemos a los proveedores", [
          { clave: "proveedor", titulo: "Proveedor" }, { clave: "deuda", titulo: "Le debemos", formato: "pesos" }, { clave: "vencido", titulo: "Vencido", formato: "pesos" },
          { clave: "proximo_vencimiento", titulo: "Próx. vencimiento", formato: "fecha" }, { clave: "comprometido_oc", titulo: "Comprometido (no es deuda)", formato: "pesos" },
        ], filas.slice(0, lim), { total: { deuda: total, comprometido_oc: comprometido } })
        return {
          consultado: "Cuenta corriente de todos los proveedores",
          datos: { deuda_total: total, vencido_total: red(filas.reduce((s, x) => s + x.vencido, 0)), comprometido_por_ordenes_de_compra: comprometido, proveedores: filas.length, filas: filas.slice(0, lim), fuente: FUENTE },
          bloques: [{ ...bloque, recalcular: { herramienta: "cuenta_corriente_proveedor", parametros: { ...p } } }],
        }
      }
      const [res, abiertos, aMano] = await Promise.all([
        consulta(ctx.db, "jarvis_cc_proveedores", { p_proveedor_id: prov.id }),
        consulta(ctx.db, "jarvis_cc_abiertos", { p_proveedor_id: prov.id }, ["movimiento_id"]),
        consulta(ctx.db, "jarvis_vencimientos_a_mano", { p_proveedor_id: prov.id }, ["vencimiento_id"]),
      ])
      const r = res[0] ?? {}
      const item = (x: Fila) => ({
        fecha: fechaSola(x.fecha), comprobante: [x.tipo_comprobante, x.numero_comprobante].filter(Boolean).join(" ") || String(x.descripcion ?? x.tipo_movimiento),
        importe: red(x.monto, 2), falta_pagar: red(x.saldo, 2), vence: fechaSola(x.vence), dias_vencido: x.dias_vencido == null ? null : n0(x.dias_vencido),
      })
      const deudas = abiertos.filter((x) => x.clase === "deuda").map(item).sort((x, y) => String(x.vence).localeCompare(String(y.vence)))
      const creditos = abiertos.filter((x) => x.clase === "credito").map((x) => ({ ...item(x), disponible: red(-n0(x.saldo), 2) }))
      const comprometido = abiertos.filter((x) => x.clase === "comprometido").map((x) => ({ fecha: fechaSola(x.fecha), detalle: String(x.descripcion ?? "orden de compra"), importe: red(x.saldo, 2) }))
      const manuales = aMano.map((x) => ({ concepto: String(x.concepto), importe: red(x.monto, 2), vence: fechaSola(x.vence), dias_vencido: x.dias_vencido == null ? null : n0(x.dias_vencido) }))
      const bloque = a.tabla(`Le debemos a ${prov.nombre}`, [
        { clave: "comprobante", titulo: "Comprobante" }, { clave: "fecha", titulo: "Fecha", formato: "fecha" }, { clave: "importe", titulo: "Importe", formato: "pesos" },
        { clave: "falta_pagar", titulo: "Falta pagar", formato: "pesos" }, { clave: "vence", titulo: "Vence", formato: "fecha" }, { clave: "dias_vencido", titulo: "Días vencido", formato: "numero" },
      ], [
        ...deudas,
        ...manuales.map((m) => ({ comprobante: `${m.concepto} (anotado a mano)`, fecha: null, importe: m.importe, falta_pagar: m.importe, vence: m.vence, dias_vencido: m.dias_vencido })),
        ...creditos.map((c) => ({ comprobante: `${c.comprobante} (crédito a favor)`, fecha: c.fecha, importe: c.importe, falta_pagar: -c.disponible, vence: null, dias_vencido: null })),
      ].slice(0, lim), { total: { falta_pagar: red(r.deuda_total, 2) }, nota: "El total es lo que le debemos: comprobantes abiertos + anotado a mano − créditos a favor. Lo comprometido por órdenes de compra no está sumado." })
      return {
        consultado: `Cuenta corriente de ${prov.nombre}`,
        datos: {
          proveedor: prov.nombre, le_debemos: red(r.deuda_total, 2),
          composicion: { saldo_cuenta_corriente: red(r.saldo_cc, 2), anotado_a_mano_sin_comprobante: red(r.vencimientos_a_mano, 2), creditos_a_favor_sin_aplicar: red(-n0(r.creditos_sin_aplicar), 2) },
          por_antiguedad: { a_vencer: red(r.a_vencer), vencido_1_a_30_dias: red(r.vencido_1_30), vencido_31_a_60: red(r.vencido_31_60), vencido_61_a_90: red(r.vencido_61_90), vencido_mas_de_90: red(r.vencido_mas_90) },
          proximo_vencimiento: fechaSola(r.proximo_vencimiento),
          comprobantes_abiertos: deudas.slice(0, lim), creditos_a_favor: creditos.slice(0, lim), anotado_a_mano: manuales.slice(0, lim),
          comprometido_por_ordenes_de_compra: { importe: red(r.comprometido_oc, 2), aclaracion: "Mercadería pedida que todavía no tiene factura. NO es deuda y no está sumado en \"le_debemos\".", detalle: comprometido.slice(0, 10) },
          fuente: FUENTE,
        },
        bloques: [{ ...bloque, recalcular: { herramienta: "cuenta_corriente_proveedor", parametros: { ...p } } }],
      }
    }),
  }

  // ─── 5. Retenciones ──────────────────────────────────────────────────────
  const retencionesProveedor: Herramienta = {
    nombre: "retenciones_proveedor",
    descripcion:
      "Certificados de retención de Ganancias emitidos a proveedores en un período: número de certificado, fecha, proveedor, orden de pago, base, alícuota e importe retenido; total retenido. " +
      "Para \"¿cuánto le retuvimos a X este año?\", \"¿qué retenciones hicimos en octubre?\". SOLO ADMINISTRADOR.",
    esquema: { type: "object", properties: { ...P_PERIODO, proveedor: { type: "string" }, ...P_LIMITE } },
    ejecutar: seguro(async (ctx, p) => {
      if (!(await a.esAdmin(ctx))) throw a.error("Las retenciones a proveedores solo las puede consultar un administrador.")
      const r = resolverPeriodo(p as never, "anio_actual", ctx.hoy)
      const prov = await proveedorDe(ctx, p)
      const t = await repRetenciones(ctx.db, { desde: r.desde, hasta: r.hasta, proveedorId: prov?.id, proveedorNombre: prov?.nombre })
      const lim = limite(p.limite, 20)
      const bloque = a.tabla(`${t.titulo} ${r.etiqueta}`, t.columnas.filter((c) => c.clave !== "cuit"), t.filas.slice(0, lim), { total: t.total, nota: t.nota })
      return {
        consultado: `Certificados de retención de Ganancias ${r.etiqueta}${prov ? ` de ${prov.nombre}` : ""}`,
        datos: { periodo: r, total_retenido: t.total?.retenido ?? 0, certificados: t.filas.filter((x) => x.estado === "emitido").length, anulados: t.filas.filter((x) => x.estado === "anulado").length, filas: t.filas.slice(0, lim), fuente: "Certificados de retención emitidos por las órdenes de pago" },
        bloques: [{ ...bloque, recalcular: { herramienta: "retenciones_proveedor", parametros: { ...p } } }],
      }
    }),
  }

  // ─── 6. Notas de crédito / débito esperadas ──────────────────────────────
  const notasEsperadas: Herramienta = {
    nombre: "notas_esperadas",
    descripcion:
      "Notas de crédito (y de débito) que ESPERAMOS de un proveedor —por un faltante, una devolución, una diferencia de precio o un descuento que llega aparte— y si YA LLEGÓ la real (con su número y fecha). " +
      "Busca por proveedor y también por palabras del artículo o del motivo (\"cremas dentales\", \"devolución\"). " +
      "Usala para \"devolvimos 12 cremas dentales de Colgate, ¿está hecha la nota de crédito?\", \"¿qué notas de crédito nos deben los proveedores?\", \"¿hace cuánto esperamos la NC de X?\".",
    esquema: {
      type: "object",
      properties: {
        proveedor: { type: "string" }, buscar: { type: "string", description: "Palabras del artículo o del motivo, como las dijo la persona (sin el nombre del proveedor)" },
        solo_pendientes: { type: "boolean", description: "true = solo las que todavía no llegaron" }, ...P_LIMITE,
      },
    },
    ejecutar: seguro(async (ctx, p) => {
      const prov = await proveedorDe(ctx, p)
      let filas = await filasNotas(ctx.db, { proveedorId: prov?.id, texto: str(p.buscar) })
      let sinCoincidencia: string | null = null
      // Si con las palabras no aparece nada, se muestran todas las del proveedor: mejor eso que "no hay"
      if (filas.length === 0 && str(p.buscar) && prov) {
        filas = await filasNotas(ctx.db, { proveedorId: prov.id })
        sinCoincidencia = `Ninguna nota de ${prov.nombre} menciona "${str(p.buscar)}". Te muestro todas las de ese proveedor para que veas si alguna corresponde.`
      }
      if (p.solo_pendientes === true) filas = filas.filter((x) => x.situacion === "esperada")
      filas.sort((x, y) => (x.situacion === y.situacion ? y.dias - x.dias : x.situacion === "esperada" ? -1 : 1))
      const esperadas = filas.filter((x) => x.situacion === "esperada"), llegaron = filas.filter((x) => x.situacion === "llegó")
      const lim = limite(p.limite, 20)
      const bloque = a.tabla(`Notas de crédito / débito esperadas${prov ? ` — ${prov.nombre}` : ""}`, [
        { clave: "proveedor", titulo: "Proveedor" }, { clave: "tipo", titulo: "Qué" }, { clave: "motivo", titulo: "Por qué" }, { clave: "situacion", titulo: "Situación" },
        { clave: "anotada", titulo: "Desde", formato: "fecha" }, { clave: "dias", titulo: "Días", formato: "numero" }, { clave: "total", titulo: "Importe", formato: "pesos" },
        { clave: "numero_real", titulo: "N° que llegó" }, { clave: "articulos", titulo: "Artículos" },
      ], filas.slice(0, lim), { total: { total: red(esperadas.reduce((s, x) => s + x.total, 0), 2) }, nota: "El total suma solo las que todavía no llegaron." })
      return {
        consultado: `Notas de crédito y débito esperadas${prov ? ` de ${prov.nombre}` : ""}${str(p.buscar) ? ` que mencionan "${str(p.buscar)}"` : ""}, y las que llegaron en el último año`,
        datos: {
          aviso: sinCoincidencia,
          todavia_no_llegaron: { cantidad: esperadas.length, importe: red(esperadas.reduce((s, x) => s + x.total, 0), 2), la_mas_vieja_dias: esperadas[0]?.dias ?? null },
          ya_llegaron: { cantidad: llegaron.length },
          filas: filas.slice(0, lim),
          aclaracion: filas.length === 0
            ? "No hay ninguna nota de crédito esperada ni registrada que coincida. Si la devolución se hizo, puede que nadie haya anotado la nota esperada: no está en el sistema."
            : "\"esperada\" = el proveedor todavía no la mandó. \"llegó\" = ya se cargó la nota real (número y fecha en la fila).",
          fuente: "Notas esperadas que se anotan al resolver una diferencia en la verificación o al cargar una devolución, y las notas reales cargadas contra ellas",
        },
        bloques: [{ ...bloque, recalcular: { herramienta: "notas_esperadas", parametros: { ...p } } }],
      }
    }),
  }

  // ─── 7. Órdenes de compra pendientes ─────────────────────────────────────
  const ordenesCompraPendientes: Herramienta = {
    nombre: "ordenes_compra_pendientes",
    descripcion:
      "Órdenes de compra que todavía NO llegaron completas: de qué proveedor, desde cuándo, si se le mandó al proveedor (o solo se envió de prueba), cuándo debería llegar, cuántos días de atraso y cuántas unidades faltan. " +
      "Con un proveedor o un número de orden, lista QUÉ ARTÍCULOS faltan recibir. Para \"¿qué estamos esperando que llegue?\", \"¿llegó el pedido de X?\", \"¿qué falta de la OC-000012?\".",
    esquema: { type: "object", properties: { proveedor: { type: "string" }, orden: { type: "string", description: "Número de orden, ej. OC-000012 o 12" }, ...P_LIMITE } },
    ejecutar: seguro(async (ctx, p) => {
      const prov = await proveedorDe(ctx, p)
      const t = await repOcPendientes(ctx.db, { proveedorId: prov?.id, proveedorNombre: prov?.nombre })
      let filas = t.filas
      let ordenId: string | null = null
      const pedida = str(p.orden)
      if (pedida) {
        const num = pedida.replace(/[^0-9]/g, "")
        const numero = num ? `OC-${num.padStart(6, "0")}` : pedida
        const { data } = await ctx.db.from("ordenes_compra").select("id, numero_orden, estado").or(`numero_orden.eq.${numero},numero_orden.eq.${pedida.replace(/[,()]/g, "")}`).limit(1)
        const oc = (data?.[0] as Fila) ?? null
        if (!oc) throw a.error(`No encontré la orden de compra "${pedida}".`)
        ordenId = oc.id
        filas = filas.filter((x) => x.orden === oc.numero_orden)
        if (filas.length === 0) {
          return { consultado: `Orden de compra ${oc.numero_orden}`, datos: { orden: oc.numero_orden, pendiente: false, estado: oc.estado, aclaracion: `La orden ${oc.numero_orden} no está pendiente de recibir: figura como "${oc.estado}".` }, bloques: [] }
        }
      }
      const lim = limite(p.limite, 20)
      const faltan = (prov || ordenId)
        ? (await consulta(ctx.db, "jarvis_oc_faltantes", { p_orden_id: ordenId, p_proveedor_id: ordenId ? null : prov!.id })).map((x) => ({
            orden: String(x.orden), articulo: `${x.sku ?? ""} ${x.articulo ?? ""}`.trim(), pedidas: red(x.unidades_pedidas, 2), recibidas: red(x.unidades_recibidas, 2), faltan: red(x.unidades_pendientes, 2),
          })).sort((x, y) => x.orden.localeCompare(y.orden) || y.faltan - x.faltan)
        : null
      const bloques: Bloque[] = [{ ...a.tabla(t.titulo, t.columnas.filter((c) => !["renglones_pendientes", "unidades_pedidas", "unidades_recibidas"].includes(c.clave)), filas.slice(0, lim), { nota: t.nota }), recalcular: { herramienta: "ordenes_compra_pendientes", parametros: { ...p } } }]
      if (faltan && faltan.length > 0) {
        bloques.push(a.tabla("Artículos que faltan recibir", [
          { clave: "orden", titulo: "Orden" }, { clave: "articulo", titulo: "Artículo" }, { clave: "pedidas", titulo: "Pedidas (u.)", formato: "numero" },
          { clave: "recibidas", titulo: "Recibidas", formato: "numero" }, { clave: "faltan", titulo: "Faltan", formato: "numero" },
        ], faltan.slice(0, 50)))
      }
      return {
        consultado: `Órdenes de compra sin recibir completas${prov ? ` de ${prov.nombre}` : ""}${pedida ? ` (${pedida})` : ""} y sus recepciones`,
        datos: {
          ordenes_pendientes: filas.length, atrasadas: filas.filter((x) => n0(x.dias_atraso) > 0).length, sin_enviar_al_proveedor: filas.filter((x) => x.envio !== "" && !String(x.envio).startsWith("enviada")).length,
          filas: filas.slice(0, lim), articulos_que_faltan: faltan ? faltan.slice(0, 50) : "Pedí un proveedor o una orden para ver qué artículos faltan.",
          estados: ESTADO_OC, fuente: "Órdenes de compra abiertas y lo contado en sus recepciones finalizadas",
        },
        bloques,
      }
    }),
  }

  // ─── 8. Diferencias de factura ───────────────────────────────────────────
  const diferenciasFactura: Herramienta = {
    nombre: "diferencias_factura",
    descripcion:
      "Diferencias de PRECIO y de CANTIDAD entre lo pedido, lo recibido y lo facturado, y CÓMO SE RESOLVIÓ cada una: la asumimos nosotros, se le reclama al proveedor (nota de crédito esperada), se le carga al transporte, " +
      "sobrante que esperamos que facturen o sobrante bonificado. Dice si la nota de crédito ya llegó. Para \"¿qué diferencias tuvimos con X?\", \"¿qué pasó con la factura de la OC-000012?\", \"¿cuánto nos facturaron de más este mes?\".",
    esquema: { type: "object", properties: { ...P_PERIODO, proveedor: { type: "string" }, orden: { type: "string", description: "Número de orden de compra" }, ...P_LIMITE } },
    ejecutar: seguro(async (ctx, p) => {
      const prov = await proveedorDe(ctx, p)
      let ordenId: string | null = null
      if (str(p.orden)) {
        const num = str(p.orden)!.replace(/[^0-9]/g, "")
        const { data } = await ctx.db.from("ordenes_compra").select("id").eq("numero_orden", num ? `OC-${num.padStart(6, "0")}` : str(p.orden)!).limit(1)
        ordenId = (data?.[0] as Fila)?.id ?? null
        if (!ordenId) throw a.error(`No encontré la orden de compra "${str(p.orden)}".`)
      }
      const r = resolverPeriodo(p as never, "ultimos_90_dias", ctx.hoy)
      const rows = await consulta(ctx.db, "jarvis_diferencias_compra", { p_desde: ordenId ? null : r.desde, p_hasta: ordenId ? null : r.hasta, p_proveedor_id: prov?.id ?? null, p_orden_id: ordenId }, ["diferencia_id"])
      const filas = rows.map((x) => ({
        fecha: fechaSola(x.fecha), proveedor: String(x.proveedor ?? "—"), orden: x.orden ?? null, factura: x.factura ?? null,
        articulo: `${x.sku ?? ""} ${x.articulo ?? ""}`.trim() || "(sin artículo)", tipo: x.tipo === "precio" ? "precio" : "cantidad",
        unidades: red(x.unidades, 2), importe: red(x.importe_total, 2), como_se_resolvio: DESTINO_DIFERENCIA[String(x.destino)] ?? String(x.destino), nota: x.nota ?? null,
      })).sort((x, y) => String(y.fecha).localeCompare(String(x.fecha)))
      const porDestino = new Map<string, { cantidad: number; importe: number }>()
      for (const f of filas) { const x = porDestino.get(f.como_se_resolvio) ?? { cantidad: 0, importe: 0 }; x.cantidad++; x.importe += f.importe; porDestino.set(f.como_se_resolvio, x) }
      const lim = limite(p.limite, 20)
      const bloque = a.tabla(`Diferencias de factura ${ordenId ? "" : r.etiqueta}${prov ? ` — ${prov.nombre}` : ""}`.trim(), [
        { clave: "fecha", titulo: "Fecha", formato: "fecha" }, { clave: "proveedor", titulo: "Proveedor" }, { clave: "orden", titulo: "Orden" }, { clave: "articulo", titulo: "Artículo" },
        { clave: "tipo", titulo: "De" }, { clave: "unidades", titulo: "Unidades", formato: "numero" }, { clave: "importe", titulo: "Importe", formato: "pesos" },
        { clave: "como_se_resolvio", titulo: "Cómo se resolvió" }, { clave: "nota", titulo: "Nota de crédito / débito" },
      ], filas.slice(0, lim), { nota: "Solo las diferencias ya resueltas en la verificación. Una diferencia que nadie resolvió todavía no figura acá." })
      return {
        consultado: `Diferencias resueltas en la verificación ${ordenId ? `de la orden ${str(p.orden)}` : r.etiqueta}${prov ? ` de ${prov.nombre}` : ""}`,
        datos: {
          periodo: ordenId ? null : r, cantidad: filas.length, de_precio: filas.filter((x) => x.tipo === "precio").length, de_cantidad: filas.filter((x) => x.tipo === "cantidad").length,
          por_como_se_resolvio: [...porDestino.entries()].map(([como, x]) => ({ como, cantidad: x.cantidad, importe: red(x.importe) })),
          filas: filas.slice(0, lim), fuente: "Diferencias resueltas en la verificación de comprobantes contra la orden y la recepción",
        },
        bloques: [{ ...bloque, recalcular: { herramienta: "diferencias_factura", parametros: { ...p } } }],
      }
    }),
  }

  // ─── 9. Plan de pagos de la semana ───────────────────────────────────────
  const planDePagos: Herramienta = {
    nombre: "plan_de_pagos",
    descripcion:
      "Qué hay que PAGAR esta semana (o la que viene) y cómo: transferencias y e-cheq contra el saldo de cada banco, cheques de terceros sugeridos de la cartera, cheques propios a hacer con su fecha, efectivo a separar por día, " +
      "todo NETO de la retención de Ganancias estimada; los estimados de órdenes de compra van aparte. También la proyección de caja de los próximos 30 días. Es la misma cuenta que la pantalla Finanzas → Pagos de la semana. " +
      "Para \"¿qué hay que pagar esta semana?\", \"¿alcanza la plata del banco?\", \"¿cuánto efectivo hay que separar?\". SOLO ADMINISTRADOR.",
    esquema: { type: "object", properties: { semana: { type: "string", enum: ["esta", "proxima"], description: "Por defecto, esta semana (incluye lo atrasado)" }, desde: { type: "string", description: "Cualquier día AAAA-MM-DD de la semana a mirar" } } },
    ejecutar: seguro(async (ctx, p) => {
      if (!(await a.esAdmin(ctx))) throw a.error("El plan de pagos (órdenes de pago, bancos y cajas) solo lo puede consultar un administrador.")
      const desde = str(p.desde) ?? (p.semana === "proxima" ? sumarDiasISO(ctx.hoy, 7) : null)
      const d = await cargarPagosSemana(ctx.db, { desde, dias: 30 })
      const grupos = d.bloques.map((b) => ({
        como_se_paga: b.titulo, neto_a_pagar: red(b.neto), retencion_estimada: red(b.retencion),
        proveedores: b.proveedores.slice(0, 15).map((g) => ({
          proveedor: g.nombre, neto: red(g.neto), retencion_estimada: red(g.retencion), vencimientos: g.items.length, atrasados: g.items.filter((i) => i.atrasado).length,
          primer_vencimiento: g.items[0]?.fecha_vencimiento ?? null,
          ...(g.cheques_sugeridos ? { cheques_sugeridos: g.cheques_sugeridos.length, cheques_sugeridos_importe: red(g.cheques_sugeridos.reduce((s, c) => s + c.monto, 0)), falta_cubrir: red(g.falta_cubrir) } : {}),
          ...(g.items.some((i) => i.fecha_cheque) ? { cheques_a_hacer: g.items.filter((i) => i.fecha_cheque).map((i) => ({ importe: red(i.neto), fecha_de_pago: i.fecha_cheque })) } : {}),
        })),
      }))
      const filas = d.bloques.flatMap((b) => b.proveedores.map((g) => ({
        como: b.titulo, proveedor: g.nombre, vence: g.items[0]?.fecha_vencimiento ?? null, bruto: red(g.bruto), retencion: red(g.retencion), neto: red(g.neto),
      })))
      const bloque = a.tabla(`Pagos de la semana del ${d.semana.desde.slice(8, 10)}/${d.semana.desde.slice(5, 7)} al ${d.semana.hasta.slice(8, 10)}/${d.semana.hasta.slice(5, 7)}`, [
        { clave: "como", titulo: "Cómo se paga" }, { clave: "proveedor", titulo: "A quién" }, { clave: "vence", titulo: "Vence", formato: "fecha" },
        { clave: "bruto", titulo: "Importe", formato: "pesos" }, { clave: "retencion", titulo: "Retención est.", formato: "pesos" }, { clave: "neto", titulo: "Neto a pagar", formato: "pesos" },
      ], filas, { total: { neto: red(d.totales.neto) }, nota: "Neto de la retención de Ganancias estimada. No incluye los estimados de órdenes de compra." })
      const minimo = d.proyeccion.minimo
      return {
        consultado: `Vencimientos, saldos de bancos y cajas, cheques en cartera y retenciones estimadas de la semana del ${d.semana.desde.slice(8, 10)}/${d.semana.desde.slice(5, 7)}`,
        datos: {
          semana: d.semana, incluye_lo_atrasado: d.es_semana_actual,
          a_pagar: { neto: red(d.totales.neto), bruto: red(d.totales.bruto), retencion_estimada: red(d.totales.retencion), de_eso_atrasado: red(d.totales.atrasado) },
          bancos: { sale: red(d.bancos.sale), saldo: red(d.bancos.saldo), alcanza: d.bancos.alcanza, falta: red(d.bancos.falta), cuentas: d.bancos.cuentas.map((c) => ({ cuenta: c.nombre, saldo: red(c.saldo) })) },
          efectivo: { a_separar: red(d.efectivo.sale), saldo_en_cajas: red(d.efectivo.saldo), alcanza: d.efectivo.alcanza, falta: red(d.efectivo.falta), por_dia: d.efectivo.por_dia.map((x) => ({ dia: x.dia, importe: red(x.monto) })) },
          cheques_en_cartera: { libres: d.cartera.disponibles, importe_libre: red(d.cartera.monto_disponible), reservados_por_ordenes_pendientes: d.cartera.reservados.length },
          grupos,
          lo_que_viene_estimado_de_ordenes_de_compra: { importe: red(d.lo_que_viene.total), cantidad: d.lo_que_viene.items.length, aclaracion: "Mercadería pedida sin factura: NO está sumada en lo que hay que pagar." },
          proyeccion_de_caja_30_dias: { saldo_hoy: red(d.proyeccion.saldo_inicial), punto_mas_bajo: minimo ? { dia: minimo.dia, saldo: red(minimo.saldo) } : null, queda_en_negativo: !!minimo && minimo.saldo < 0 },
          aviso: d.aviso_retencion,
          fuente: "La misma cuenta que la pantalla Finanzas → Pagos de la semana",
        },
        bloques: [{ ...bloque, recalcular: { herramienta: "plan_de_pagos", parametros: { ...p } } }],
      }
    }),
  }

  return [compras, ultimaCompra, fichaProveedor, cuentaCorrienteProveedor, retencionesProveedor, notasEsperadas, ordenesCompraPendientes, diferenciasFactura, planDePagos]
}

/** Deuda de un proveedor (o de todos) según la cuenta corriente, para sumarla a otras herramientas. null si la consulta no está instalada. */
export async function deudaSegunCuentaCorriente(db: SupabaseClient, proveedorId: string | null) {
  try {
    const rows = await consulta(db, "jarvis_cc_proveedores", { p_proveedor_id: proveedorId }, ["proveedor_id"])
    const s = (c: string) => red(rows.reduce((t, r) => t + n0(r[c]), 0))
    return {
      le_debemos: s("deuda_total"), saldo_cuenta_corriente: s("saldo_cc"), anotado_a_mano_sin_comprobante: s("vencimientos_a_mano"),
      comprometido_por_ordenes_de_compra: s("comprometido_oc"),
      aclaracion: "Esta es LA deuda (cuenta corriente + anotado a mano sin comprobante). Lo comprometido por órdenes de compra no es deuda.",
    }
  } catch (e) {
    if (e instanceof FaltaMigracion) return null
    throw e
  }
}
