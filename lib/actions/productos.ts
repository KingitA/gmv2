"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"

import { searchProductsByVector } from "@/lib/actions/embeddings"

// Fallback Mock Data generator
function getMockProductos(term: string) {
  return [
    { id: 'mock-1', nombre: 'Escoba Dura Reforzada', sku: 'ESC-001', descripcion: 'Escoba de cerda dura ideal exteriores', stock_actual: 150, stock_reservado: 0, precio_base: 4500, unidad_medida: 'unidad', activo: true },
    { id: 'mock-2', nombre: 'Escoba Suave Interior', sku: 'ESC-002', descripcion: 'Escoba suave para pisos delicados', stock_actual: 85, stock_reservado: 5, precio_base: 4200, unidad_medida: 'unidad', activo: true },
    { id: 'mock-3', nombre: 'Pala Plástica', sku: 'PAL-001', descripcion: 'Pala de residuos plástica con goma', stock_actual: 200, stock_reservado: 0, precio_base: 1500, unidad_medida: 'unidad', activo: true },
    { id: 'mock-4', nombre: 'Trapo de Piso Gris', sku: 'TRP-001', descripcion: 'Trapo de piso algodón nido de abeja', stock_actual: 500, stock_reservado: 20, precio_base: 850, unidad_medida: 'unidad', activo: true },
  ].filter(p => !term || p.nombre.toLowerCase().includes(term.toLowerCase()) || p.sku.toLowerCase().includes(term.toLowerCase()))
}

export async function searchProductos(searchTerm: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.warn("⚠️ MODO MOCK ACTIVADO: Faltan credenciales de Supabase.")
    return getMockProductos(searchTerm)
  }

  try {
    let vectorIds: string[] = []

    // 2. Try Vector Search First
    if (searchTerm && searchTerm.length >= 2) {
      try {
        const vectorResults = await searchProductsByVector(searchTerm, 0.35) // Increased threshold for precision
        if (vectorResults && vectorResults.length > 0) {
          vectorIds = vectorResults.map((item: any) => item.id)
        }
      } catch (vectorError) {
        console.error("Vector search failed, falling back to ILIKE:", vectorError)
      }
    }

    const supabase = createAdminClient()
    let query = supabase
      .from("articulos")
      .select(`
        *,
        proveedores:proveedor_id (
          nombre,
          codigo_proveedor
        )
      `)
      .eq("activo", true)
      .limit(50)

    if (vectorIds.length > 0) {
      // Hydrate via IDs from vector search
      query = query.in("id", vectorIds)
    } else {
      // Fallback ILIKE search
      if (searchTerm && searchTerm.length >= 2) {
        query = query.or(`descripcion.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%`)
      }
    }

    const { data: dbProducts, error } = await query

    if (error) {
      console.error("Error fetching products:", error)
      return getMockProductos(searchTerm)
    }

    if (dbProducts) {
      let mapped = dbProducts.map((p: any) => ({
        ...p,
        nombre: p.descripcion || "Sin Nombre",
        precio_base: p.precio_compra || 0,
        stock_actual: p.stock_actual || 0,
        proveedores: p.proveedores || { nombre: "Sin Proveedor" }
      }))

      // PRESERVE RANKING if vector search was used
      if (vectorIds.length > 0) {
        mapped.sort((a, b) => {
          return vectorIds.indexOf(a.id) - vectorIds.indexOf(b.id)
        })
      }

      return mapped
    }

    return []

  } catch (err) {
    console.error("Exception in searchProductos. Switching to MOCK data.", err)
    return getMockProductos(searchTerm)
  }
}

export async function getProductoById(productoId: string) {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("productos")
    .select(`
      *,
      proveedores:proveedor_id (
        nombre,
        codigo_proveedor,
        margen_base,
        comision_viajante
      )
    `)
    .eq("id", productoId)
    .single()

  if (error) throw error
  return data
}

export async function checkStockDisponible(productoId: string, cantidad: number) {
  const supabase = createAdminClient()

  const { data: producto } = await supabase
    .from("productos")
    .select("stock_actual, stock_reservado")
    .eq("id", productoId)
    .single()

  if (!producto) throw new Error("Producto no encontrado")

  const stockDisponible = producto.stock_actual - producto.stock_reservado
  return {
    disponible: stockDisponible >= cantidad,
    stockDisponible,
    stockActual: producto.stock_actual,
    stockReservado: producto.stock_reservado,
  }
}

export async function getProductos() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("productos")
    .select(`
      *,
      proveedores:proveedor_id (
        nombre,
        codigo_proveedor
      )
    `)
    .eq("activo", true)
    .order("nombre")

  if (error) throw error

  // Transform to match expected format
  return data.map((p: any) => ({
    id: p.id,
    codigo: p.sku,
    nombre: p.nombre,
    descripcion: p.descripcion,
    precio_base: p.precio_base,
    stock_disponible: p.stock_actual,
    stock_reservado: p.stock_reservado,
    unidad_medida: p.unidad_medida || "unidad",
    activo: p.activo,
  }))
}
