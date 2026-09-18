"use client"

/**
 * Precios programados — cambios de precio con fecha/hora de entrada en vigencia.
 *
 * Complementa (no reemplaza) la edición normal de precios, que sigue rigiendo
 * al instante. Un cambio cargado acá lo descargan las apps móviles por
 * adelantado y lo aplican solas a la hora exacta, aunque estén sin señal;
 * la base lo materializa en la tabla real en ese mismo minuto (pg_cron).
 * Ver MOBILE.md → "Vigencia programada".
 */

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { formatDateTimeAR } from "@/lib/utils"
import { toast } from "sonner"
import { CalendarClock, Loader2, X } from "lucide-react"

type Tabla = "articulos" | "listas_precio"

const CAMPOS: Record<Tabla, Array<{ key: string; label: string }>> = {
  articulos: [
    { key: "precio_base", label: "Precio base" },
    { key: "precio_compra", label: "Precio de compra" },
    { key: "porcentaje_ganancia", label: "% ganancia" },
    { key: "bonif_recargo", label: "Bonif./recargo %" },
    { key: "precio_lista_especial", label: "Precio lista especial (neto)" },
    { key: "oferta_lista_especial", label: "Oferta lista especial %" },
  ],
  listas_precio: [
    { key: "recargo_limpieza_bazar", label: "Recargo limpieza/bazar %" },
    { key: "recargo_perfumeria_negro", label: "Recargo perfumería negro %" },
    { key: "recargo_perfumeria_blanco", label: "Recargo perfumería blanco %" },
  ],
}

interface Programado {
  id: string
  tabla: string
  registro_id: string
  registro_nombre: string
  cambios: Record<string, unknown>
  vigencia_desde: string
  estado: "pendiente" | "aplicado" | "cancelado" | "error"
  error: string | null
  nota: string | null
}

interface Opcion { id: string; nombre: string }

/** "2026-09-20T08:00" (hora Argentina) → ISO UTC */
function localArAIso(v: string): string {
  return new Date(`${v}:00-03:00`).toISOString()
}

export default function PreciosProgramadosPage() {
  const [items, setItems] = useState<Programado[]>([])
  const [filtro, setFiltro] = useState<"pendiente" | "todos">("pendiente")
  const [cargando, setCargando] = useState(true)

  const [tabla, setTabla] = useState<Tabla>("articulos")
  const [q, setQ] = useState("")
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [registro, setRegistro] = useState<Opcion | null>(null)
  const [campo, setCampo] = useState(CAMPOS.articulos[0].key)
  const [valor, setValor] = useState("")
  const [vigencia, setVigencia] = useState("")
  const [nota, setNota] = useState("")
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await fetch(`/api/precios-programados?estado=${filtro}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setItems(d)
    } catch (e: any) {
      toast.error(e.message || "No se pudo cargar")
    } finally {
      setCargando(false)
    }
  }, [filtro])

  useEffect(() => { cargar() }, [cargar])

  // Búsqueda de artículo / carga de listas
  useEffect(() => {
    let vivo = true
    const t = setTimeout(async () => {
      if (tabla === "listas_precio") {
        const { createClient } = await import("@/lib/supabase/client")
        const { data } = await createClient().from("listas_precio").select("id, nombre, codigo").order("nombre")
        if (vivo) setOpciones((data || []).map((l: any) => ({ id: l.id, nombre: l.nombre || l.codigo })))
        return
      }
      if (q.trim().length < 2) { setOpciones([]); return }
      const r = await fetch(`/api/articulos/buscar?q=${encodeURIComponent(q.trim())}&limit=8`)
      const d = await r.json().catch(() => [])
      if (vivo) setOpciones((Array.isArray(d) ? d : []).map((a: any) => ({ id: a.id, nombre: `${a.sku} — ${a.descripcion}` })))
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [q, tabla])

  const guardar = async () => {
    if (!registro || !valor || !vigencia) { toast.error("Completá registro, valor y vigencia"); return }
    const num = Number(valor.replace(",", "."))
    if (!Number.isFinite(num)) { toast.error("Valor numérico inválido"); return }
    setGuardando(true)
    try {
      const r = await fetch("/api/precios-programados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tabla,
          registro_id: registro.id,
          cambios: { [campo]: num },
          vigencia_desde: localArAIso(vigencia),
          nota: nota || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      toast.success("Cambio programado")
      setRegistro(null); setQ(""); setValor(""); setNota("")
      cargar()
    } catch (e: any) {
      toast.error(e.message || "No se pudo programar")
    } finally {
      setGuardando(false)
    }
  }

  const cancelar = async (id: string) => {
    const r = await fetch("/api/precios-programados", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, accion: "cancelar" }),
    })
    const d = await r.json()
    if (!r.ok) toast.error(d.error)
    else { toast.success("Cancelado"); cargar() }
  }

  const campos = CAMPOS[tabla]

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Precios programados</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Cargá un cambio de precio con fecha y hora de entrada en vigencia (hora Argentina). Las apps de los
        vendedores lo reciben por adelantado y lo aplican solas a esa hora, aunque estén sin señal. Para un cambio
        que rige ya, editá el precio como siempre.
      </p>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex gap-2">
          {(["articulos", "listas_precio"] as Tabla[]).map((t) => (
            <Button key={t} size="sm" variant={tabla === t ? "default" : "outline"}
              onClick={() => { setTabla(t); setRegistro(null); setQ(""); setCampo(CAMPOS[t][0].key) }}>
              {t === "articulos" ? "Artículo" : "Lista de precio"}
            </Button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label>{tabla === "articulos" ? "Artículo" : "Lista"}</Label>
            {registro ? (
              <div className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                <span className="flex-1 truncate">{registro.nombre}</span>
                <button onClick={() => setRegistro(null)} aria-label="Quitar"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <>
                {tabla === "articulos" && (
                  <Input placeholder="Buscar por SKU, EAN o descripción" value={q} onChange={(e) => setQ(e.target.value)} />
                )}
                <div className="max-h-48 overflow-auto rounded border empty:hidden">
                  {opciones.map((o) => (
                    <button key={o.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => { setRegistro(o); setOpciones([]) }}>
                      {o.nombre}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="space-y-1">
            <Label>Campo</Label>
            <select className="w-full rounded border px-3 py-2 text-sm bg-background" value={campo} onChange={(e) => setCampo(e.target.value)}>
              {campos.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Nuevo valor</Label>
            <Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>Rige desde (hora Argentina)</Label>
            <Input type="datetime-local" value={vigencia} onChange={(e) => setVigencia(e.target.value)} />
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label>Nota (opcional)</Label>
            <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: aumento proveedor X" />
          </div>
        </div>

        <Button onClick={guardar} disabled={guardando}>
          {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Programar cambio
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <Button size="sm" variant={filtro === "pendiente" ? "default" : "outline"} onClick={() => setFiltro("pendiente")}>Pendientes</Button>
          <Button size="sm" variant={filtro === "todos" ? "default" : "outline"} onClick={() => setFiltro("todos")}>Todos</Button>
        </div>
        {cargando ? (
          <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No hay cambios programados.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {items.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.registro_nombre}</div>
                  <div className="text-muted-foreground">
                    {Object.entries(p.cambios).map(([k, v]) => `${k} → ${v}`).join(" · ")}
                    {p.nota ? ` — ${p.nota}` : ""}
                  </div>
                  {p.error && <div className="text-red-600">{p.error}</div>}
                </div>
                <div className="text-right whitespace-nowrap">{formatDateTimeAR(p.vigencia_desde)}</div>
                <Badge variant={p.estado === "pendiente" ? "default" : p.estado === "error" ? "destructive" : "secondary"}>{p.estado}</Badge>
                {p.estado === "pendiente" && (
                  <Button size="sm" variant="ghost" onClick={() => cancelar(p.id)}>Cancelar</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
