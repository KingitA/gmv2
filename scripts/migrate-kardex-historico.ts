/**
 * Script de migración retroactiva al kardex unificado.
 *
 * Migra:
 *   1. VENTAS → desde pedidos_detalle + pedidos + comprobantes_venta
 *   2. COMPRAS → desde recepciones_items + recepciones (estado='finalizada')
 *
 * Uso:
 *   npx tsx scripts/migrate-kardex-historico.ts            # dry-run (solo muestra conteo)
 *   npx tsx scripts/migrate-kardex-historico.ts --ejecutar # inserta en BD
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BATCH_SIZE = 200
const DRY_RUN = !process.argv.includes("--ejecutar")

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// ─── 1. Migrar VENTAS ─────────────────────────────────────────────────────────
async function migrarVentas(): Promise<{ ok: number; err: number }> {
  console.log("\n📦 Migrando VENTAS desde pedidos_detalle...")

  // Verificar qué pedidos ya fueron migrados
  const { data: yaKardex } = await supabase
    .from("kardex")
    .select("pedido_id")
    .eq("tipo_movimiento", "venta")
    .not("pedido_id", "is", null)
  const pedidosMigrados = new Set((yaKardex || []).map((r: any) => r.pedido_id))

  let offset = 0
  let totalOk = 0
  let totalErr = 0

  while (true) {
    const { data: filas, error } = await supabase
      .from("pedidos_detalle")
      .select(`
        id,
        pedido_id,
        articulo_id,
        cantidad,
        precio_base,
        precio_final,
        precio_costo,
        subtotal,
        pedido:pedidos!pedidos_detalle_pedido_id_fkey(
          id, fecha, cliente_id, vendedor_id,
          metodo_facturacion_pedido, lista_precio_pedido_id,
          comprobantes:comprobantes_venta!comprobantes_venta_pedido_id_fkey(
            id, tipo_comprobante, numero_comprobante, estado_pago,
            percepcion_iva, percepcion_iibb
          ),
          cliente:clientes!pedidos_cliente_id_fkey(
            metodo_facturacion, lista_precio_id, zona
          )
        ),
        articulo:articulos!pedidos_detalle_articulo_id_fkey(
          sku, descripcion, categoria, proveedor_id, iva_compras, iva_ventas
        )
      `)
      .range(offset, offset + BATCH_SIZE - 1)
      .order("id")

    if (error) {
      console.error(`  ❌ Error en batch offset=${offset}:`, error.message)
      break
    }
    if (!filas || filas.length === 0) break

    const kardexInserts: any[] = []

    for (const fila of filas) {
      const pedido = Array.isArray(fila.pedido) ? fila.pedido[0] : fila.pedido
      if (!pedido) continue

      // Saltar si este pedido ya está en el kardex
      if (pedidosMigrados.has(fila.pedido_id)) continue

      const art = Array.isArray(fila.articulo) ? fila.articulo[0] : fila.articulo
      const comps = pedido.comprobantes || []
      const comprobante = comps[0] || null
      const cliente = Array.isArray(pedido.cliente) ? pedido.cliente[0] : pedido.cliente

      const precioNeto: number = fila.precio_base || 0
      const precioFinal: number = fila.precio_final || 0
      const ivaIncluido = Math.abs(precioFinal - precioNeto) < 0.01
      const ivaMonto = ivaIncluido ? 0 : round2(precioFinal - precioNeto)
      const ivaPct = ivaMonto > 0 && precioNeto > 0
        ? round2((ivaMonto / precioNeto) * 100) : 0
      const cantidad: number = fila.cantidad || 0
      const metodoRaw = pedido.metodo_facturacion_pedido || cliente?.metodo_facturacion || "Final"
      const colorDinero = metodoRaw === "Factura (21% IVA)" || metodoRaw === "Factura" ? "BLANCO" : "NEGRO"

      const margenU = fila.precio_costo ? round2(precioNeto - fila.precio_costo) : null
      const margenPct = margenU != null && precioNeto > 0
        ? round2((margenU / precioNeto) * 100) : null

      kardexInserts.push({
        fecha: pedido.fecha || new Date().toISOString(),
        tipo_movimiento: "venta",
        signo: -1,

        articulo_id: fila.articulo_id,
        articulo_sku: art?.sku ?? null,
        articulo_descripcion: art?.descripcion ?? null,
        articulo_categoria: art?.categoria ?? null,
        articulo_proveedor_id: art?.proveedor_id ?? null,
        articulo_iva_compras: art?.iva_compras ?? null,
        articulo_iva_ventas: art?.iva_ventas ?? null,

        cantidad,
        cliente_id: pedido.cliente_id ?? null,
        vendedor_id: pedido.vendedor_id ?? null,
        precio_costo: fila.precio_costo ?? null,
        precio_unitario_neto: precioNeto,
        precio_unitario_final: precioFinal,
        iva_porcentaje: ivaPct,
        iva_monto_unitario: ivaMonto,
        iva_incluido: ivaIncluido,
        descuento_cliente_pct: 0,
        subtotal_neto: round2(precioNeto * cantidad),
        subtotal_iva: round2(ivaMonto * cantidad),
        subtotal_total: round2(precioFinal * cantidad),
        margen_unitario: margenU,
        margen_porcentaje: margenPct,

        comprobante_venta_id: comprobante?.id ?? null,
        tipo_comprobante: comprobante?.tipo_comprobante ?? null,
        numero_comprobante: comprobante?.numero_comprobante ?? null,
        metodo_facturacion: metodoRaw,
        color_dinero: colorDinero,
        va_en_comprobante: ivaIncluido ? "presupuesto" : "factura",

        pedido_id: fila.pedido_id,
        lista_precio_id: pedido.lista_precio_pedido_id || cliente?.lista_precio_id || null,
        provincia_destino: cliente?.zona ?? null,
      })
    }

    console.log(`  Batch offset=${offset}: ${filas.length} filas leídas, ${kardexInserts.length} a insertar`)

    if (!DRY_RUN && kardexInserts.length > 0) {
      const { error: insErr } = await supabase.from("kardex").insert(kardexInserts)
      if (insErr) {
        console.error(`  ❌ Error insertando batch:`, insErr.message)
        totalErr += kardexInserts.length
      } else {
        totalOk += kardexInserts.length
      }
    } else {
      totalOk += kardexInserts.length
    }

    offset += BATCH_SIZE
    if (filas.length < BATCH_SIZE) break
  }

  return { ok: totalOk, err: totalErr }
}

// ─── 2. Migrar COMPRAS ────────────────────────────────────────────────────────
async function migrarCompras(): Promise<{ ok: number; err: number }> {
  console.log("\n🏭 Migrando COMPRAS desde recepciones_items (recepciones finalizadas)...")

  const { data: yaKardex } = await supabase
    .from("kardex")
    .select("recepcion_id")
    .eq("tipo_movimiento", "compra")
    .not("recepcion_id", "is", null)
  const recepcionesMigradas = new Set((yaKardex || []).map((r: any) => r.recepcion_id))

  let offset = 0
  let totalOk = 0
  let totalErr = 0

  while (true) {
    const { data: filas, error } = await supabase
      .from("recepciones_items")
      .select(`
        id,
        recepcion_id,
        articulo_id,
        cantidad_fisica,
        precio_real,
        precio_oc,
        precio_documentado,
        recepcion:recepciones!recepciones_items_recepcion_id_fkey(
          id, estado, fecha_fin, proveedor_id, orden_compra_id
        ),
        articulo:articulos!recepciones_items_articulo_id_fkey(
          sku, descripcion, categoria, proveedor_id, iva_compras, iva_ventas, unidades_por_bulto
        )
      `)
      .gt("cantidad_fisica", 0)
      .range(offset, offset + BATCH_SIZE - 1)
      .order("id")

    if (error) {
      console.error(`  ❌ Error en batch offset=${offset}:`, error.message)
      break
    }
    if (!filas || filas.length === 0) break

    const kardexInserts: any[] = []

    for (const fila of filas) {
      const rec = Array.isArray(fila.recepcion) ? fila.recepcion[0] : fila.recepcion
      if (!rec || rec.estado !== "finalizada") continue
      if (recepcionesMigradas.has(fila.recepcion_id)) continue

      const art = Array.isArray(fila.articulo) ? fila.articulo[0] : fila.articulo
      const unitsPerPack = art?.unidades_por_bulto || 1
      const totalUnits = (fila.cantidad_fisica || 0) * unitsPerPack
      const precio = fila.precio_real || fila.precio_documentado || fila.precio_oc || 0

      kardexInserts.push({
        fecha: rec.fecha_fin || new Date().toISOString(),
        tipo_movimiento: "compra",
        signo: 1,

        articulo_id: fila.articulo_id,
        articulo_sku: art?.sku ?? null,
        articulo_descripcion: art?.descripcion ?? null,
        articulo_categoria: art?.categoria ?? null,
        articulo_proveedor_id: art?.proveedor_id ?? null,
        articulo_iva_compras: art?.iva_compras ?? null,
        articulo_iva_ventas: art?.iva_ventas ?? null,

        cantidad: totalUnits,
        proveedor_id: rec.proveedor_id ?? null,
        precio_unitario_neto: precio,
        precio_unitario_final: precio,
        iva_porcentaje: 0,
        iva_monto_unitario: 0,
        iva_incluido: false,
        descuento_cliente_pct: 0,
        subtotal_neto: round2(precio * totalUnits),
        subtotal_iva: 0,
        subtotal_total: round2(precio * totalUnits),

        recepcion_id: fila.recepcion_id,
        orden_compra_id: rec.orden_compra_id ?? null,
      })
    }

    console.log(`  Batch offset=${offset}: ${filas.length} filas leídas, ${kardexInserts.length} a insertar`)

    if (!DRY_RUN && kardexInserts.length > 0) {
      const { error: insErr } = await supabase.from("kardex").insert(kardexInserts)
      if (insErr) {
        console.error(`  ❌ Error insertando batch:`, insErr.message)
        totalErr += kardexInserts.length
      } else {
        totalOk += kardexInserts.length
      }
    } else {
      totalOk += kardexInserts.length
    }

    offset += BATCH_SIZE
    if (filas.length < BATCH_SIZE) break
  }

  return { ok: totalOk, err: totalErr }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60))
  console.log(`🗃️  MIGRACIÓN KARDEX HISTÓRICO`)
  console.log(`   Modo: ${DRY_RUN ? "DRY-RUN (sin cambios en BD)" : "EJECUTAR (escribe en BD)"}`)
  console.log("=".repeat(60))

  if (DRY_RUN) {
    console.log("\n⚠️  Para ejecutar realmente: npx tsx scripts/migrate-kardex-historico.ts --ejecutar\n")
  }

  const ventasResult = await migrarVentas()
  const comprasResult = await migrarCompras()

  console.log("\n" + "=".repeat(60))
  console.log("📊 RESUMEN:")
  console.log(`   Ventas  → OK: ${ventasResult.ok}, Errores: ${ventasResult.err}`)
  console.log(`   Compras → OK: ${comprasResult.ok}, Errores: ${comprasResult.err}`)
  console.log(`   TOTAL   → OK: ${ventasResult.ok + comprasResult.ok}, Errores: ${ventasResult.err + comprasResult.err}`)
  if (DRY_RUN) {
    console.log("\n   (Dry-run: ningún dato fue escrito en la BD)")
  }
  console.log("=".repeat(60))
}

main().catch(console.error)
