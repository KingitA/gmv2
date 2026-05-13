import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import BilleteraViajante from "./BilleteraViajante"

export default async function ViajantePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: vendedor } = await supabase
    .from("vendedores")
    .select("id, nombre, comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus")
    .eq("id", id)
    .single()

  if (!vendedor) notFound()

  return <BilleteraViajante vendedor={vendedor} />
}
