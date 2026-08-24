import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/catalogos-ficha
// Catálogos para la ficha / alta de cliente: condiciones de pago, condiciones
// de entrega (código + nombre), localidades (con provincia), listas de precio
// y los viajantes DEL USUARIO (un usuario vendedor puede tener varios
// viajantes, ej. "FREIJE DANIEL" y "FREIJE DANIEL LISTA NECO": solo entre esos
// puede reasignar/asignar clientes).
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const [{ data: pagoCat }, { data: entregaCat }, { data: localidades }, { data: listas }, { data: zonas }, { data: vendedores }] =
      await Promise.all([
        supabase.from("condiciones_pago").select("id, nombre").eq("activo", true).order("nombre"),
        supabase.from("condiciones_entrega").select("id, codigo, nombre").eq("activo", true).order("nombre"),
        supabase.from("localidades").select("id, nombre, provincia").order("provincia").order("nombre"),
        supabase.from("listas_precio").select("id, nombre").eq("activo", true).order("nombre"),
        supabase.from("zonas").select("id, nombre").order("nombre"),
        supabase
          .from("vendedores")
          .select("id, nombre, lista_precio_id, lista:lista_precio_id(nombre)")
          .in("id", session.vendedorIds)
          .eq("activo", true)
          .order("nombre"),
      ])

    return NextResponse.json({
      condiciones_pago: pagoCat || [],
      condiciones_entrega: entregaCat || [],
      zonas: zonas || [],
      localidades: localidades || [],
      listas_precio: listas || [],
      // lista_precio_id / lista_nombre: si el viajante impone lista, la UI
      // oculta el selector de lista y muestra "Lista: X (por viajante)"
      vendedores: (vendedores || []).map((v: any) => ({
        id: v.id,
        nombre: v.nombre,
        lista_precio_id: v.lista_precio_id || null,
        lista_nombre: v.lista?.nombre || null,
      })),
      segmentos: [
        { key: "limpieza_bazar", label: "Limpieza y bazar" },
        { key: "perf0", label: "Perfumería 0" },
        { key: "perf_plus", label: "Perfumería plus" },
      ],
      condiciones_iva: ["Responsable Inscripto", "Monotributista", "Exento", "Consumidor Final"],
      metodos_facturacion: ["Factura", "Final", "Presupuesto"],
      puede_cambiar_lista: session.puedeCambiarLista,
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/catalogos-ficha:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
