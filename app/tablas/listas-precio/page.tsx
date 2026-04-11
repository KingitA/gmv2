"use client"

/**
 * Listas de Precio — Tabla de Fórmulas Configurables
 *
 * Matriz de 12 filas (2 grupos × 6 combinaciones IVA) × 9 sublistas.
 * Cada celda contiene una fórmula editable que define cómo calcular
 * el precio de esa sublista para ese segmento de artículo.
 *
 * Variables disponibles en fórmulas:
 *   Base        = precio_base del artículo
 *   BaseContado = precio_base_contado del artículo
 *   + cualquier sublista ya calculada (cascada): ej. bahia_presupuesto
 *
 * Guardado: auto-save en onBlur de cada celda (actualiza el JSONB completo de la fila)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  SUBLISTA_CODIGOS,
  SUBLISTA_META,
  calcularPreciosConFormulas,
  evaluarFormula,
  type SublistaCodigo,
} from "@/lib/pricing/formula-evaluator"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, RotateCcw } from "lucide-react"

// ─── Tipos ────────────────────────────────────────────

interface ReglaPrecio {
  id: string
  grupo_precio: "LIMPIEZA_BAZAR" | "PERFUMERIA"
  iva_compras: "factura" | "adquisicion_stock" | "mixto"
  iva_ventas: "factura" | "presupuesto"
  formulas: Record<string, string>
}

// ─── Fórmulas default (réplica del comportamiento anterior) ──
// Sirven para el botón "Resetear a defaults".
// Derivadas de obtenerCoeficienteIva() + recargas de bahia(0) / neco(12%) / viajante(20%)

const DEFAULTS: Record<string, Record<string, string>> = {
  // ── LIMPIEZA_BAZAR ──
  "LIMPIEZA_BAZAR|factura|factura": {
    bahia_presupuesto: "Base*1.21",
    bahia_final:       "Base",
    bahia_sin_iva:     "Base",
    bahia_con_iva:     "Base*1.21",
    neco_presupuesto:  "Base*1.21*1.12",
    neco_final:        "Base*1.12",
    neco_sin_iva:      "Base*1.12",
    neco_con_iva:      "Base*1.21*1.12",
    viajante:          "Base*1.20",
  },
  "LIMPIEZA_BAZAR|factura|presupuesto": {
    bahia_presupuesto: "Base*1.21",
    bahia_final:       "Base*1.21",
    bahia_sin_iva:     "Base",
    bahia_con_iva:     "Base*1.21",
    neco_presupuesto:  "Base*1.21*1.12",
    neco_final:        "Base*1.21*1.12",
    neco_sin_iva:      "Base*1.12",
    neco_con_iva:      "Base*1.21*1.12",
    viajante:          "Base*1.21*1.20",
  },
  "LIMPIEZA_BAZAR|adquisicion_stock|factura": {
    bahia_presupuesto: "Base",
    bahia_final:       "Base*0.90",
    bahia_sin_iva:     "Base*0.90",
    bahia_con_iva:     "Base",
    neco_presupuesto:  "Base*1.12",
    neco_final:        "Base*0.90*1.12",
    neco_sin_iva:      "Base*0.90*1.12",
    neco_con_iva:      "Base*1.12",
    viajante:          "Base*1.20",
  },
  "LIMPIEZA_BAZAR|adquisicion_stock|presupuesto": {
    bahia_presupuesto: "Base",
    bahia_final:       "Base",
    bahia_sin_iva:     "Base",
    bahia_con_iva:     "Base",
    neco_presupuesto:  "Base*1.12",
    neco_final:        "Base*1.12",
    neco_sin_iva:      "Base*1.12",
    neco_con_iva:      "Base*1.12",
    viajante:          "Base*1.20",
  },
  "LIMPIEZA_BAZAR|mixto|factura": {
    bahia_presupuesto: "Base*1.10",
    bahia_final:       "Base*0.95",
    bahia_sin_iva:     "Base*0.95",
    bahia_con_iva:     "Base*1.10",
    neco_presupuesto:  "Base*1.10*1.12",
    neco_final:        "Base*0.95*1.12",
    neco_sin_iva:      "Base*0.95*1.12",
    neco_con_iva:      "Base*1.10*1.12",
    viajante:          "Base*1.20",
  },
  "LIMPIEZA_BAZAR|mixto|presupuesto": {
    bahia_presupuesto: "Base*1.10",
    bahia_final:       "Base*1.10",
    bahia_sin_iva:     "Base",
    bahia_con_iva:     "Base*1.10",
    neco_presupuesto:  "Base*1.10*1.12",
    neco_final:        "Base*1.10*1.12",
    neco_sin_iva:      "Base*1.12",
    neco_con_iva:      "Base*1.10*1.12",
    viajante:          "Base*1.10*1.20",
  },
  // ── PERFUMERIA (misma lógica, sin recargo diferenciado en defaults) ──
  "PERFUMERIA|factura|factura": {
    bahia_presupuesto: "Base*1.21",
    bahia_final:       "Base",
    bahia_sin_iva:     "Base",
    bahia_con_iva:     "Base*1.21",
    neco_presupuesto:  "Base*1.21*1.09",
    neco_final:        "Base*1.09",
    neco_sin_iva:      "Base*1.09",
    neco_con_iva:      "Base*1.21*1.09",
    viajante:          "Base*1.09",
  },
  "PERFUMERIA|factura|presupuesto": {
    bahia_presupuesto: "Base*1.21",
    bahia_final:       "Base*1.21",
    bahia_sin_iva:     "Base",
    bahia_con_iva:     "Base*1.21",
    neco_presupuesto:  "Base*1.21*1.09",
    neco_final:        "Base*1.21*1.09",
    neco_sin_iva:      "Base*1.09",
    neco_con_iva:      "Base*1.21*1.09",
    viajante:          "Base*1.21*1.09",
  },
  "PERFUMERIA|adquisicion_stock|factura": {
    bahia_presupuesto: "Base",
    bahia_final:       "Base*0.90",
    bahia_sin_iva:     "Base*0.90",
    bahia_con_iva:     "Base",
    neco_presupuesto:  "Base*1.09",
    neco_final:        "Base*0.90*1.09",
    neco_sin_iva:      "Base*0.90*1.09",
    neco_con_iva:      "Base*1.09",
    viajante:          "Base*1.09",
  },
  "PERFUMERIA|adquisicion_stock|presupuesto": {
    bahia_presupuesto: "Base",
    bahia_final:       "Base",
    bahia_sin_iva:     "Base",
    bahia_con_iva:     "Base",
    neco_presupuesto:  "Base*1.09",
    neco_final:        "Base*1.09",
    neco_sin_iva:      "Base*1.09",
    neco_con_iva:      "Base*1.09",
    viajante:          "Base*1.09",
  },
  "PERFUMERIA|mixto|factura": {
    bahia_presupuesto: "Base*1.10",
    bahia_final:       "Base*0.95",
    bahia_sin_iva:     "Base*0.95",
    bahia_con_iva:     "Base*1.10",
    neco_presupuesto:  "Base*1.10*1.09",
    neco_final:        "Base*0.95*1.09",
    neco_sin_iva:      "Base*0.95*1.09",
    neco_con_iva:      "Base*1.10*1.09",
    viajante:          "Base*1.09",
  },
  "PERFUMERIA|mixto|presupuesto": {
    bahia_presupuesto: "Base*1.10",
    bahia_final:       "Base*1.10",
    bahia_sin_iva:     "Base",
    bahia_con_iva:     "Base*1.10",
    neco_presupuesto:  "Base*1.10*1.09",
    neco_final:        "Base*1.10*1.09",
    neco_sin_iva:      "Base*1.09",
    neco_con_iva:      "Base*1.10*1.09",
    viajante:          "Base*1.10*1.09",
  },
}

// ─── Helpers de display ───────────────────────────────

const GRUPO_LABEL: Record<string, string> = {
  LIMPIEZA_BAZAR: "Limpieza/Bazar",
  PERFUMERIA:     "Perfumería",
}
const GRUPO_CLS: Record<string, string> = {
  LIMPIEZA_BAZAR: "bg-sky-100 text-sky-800",
  PERFUMERIA:     "bg-pink-100 text-pink-800",
}

const IVA_C_MAP: Record<string, { label: string; cls: string }> = {
  factura:           { label: "+",  cls: "bg-blue-100 text-blue-700"    },
  adquisicion_stock: { label: "0",  cls: "bg-neutral-100 text-neutral-500" },
  mixto:             { label: "½",  cls: "bg-amber-100 text-amber-700"  },
}
const IVA_V_MAP: Record<string, { label: string; cls: string }> = {
  factura:     { label: "+", cls: "bg-blue-100 text-blue-700"       },
  presupuesto: { label: "0", cls: "bg-neutral-100 text-neutral-500" },
}

const GRUPO_SUBLISTA: Record<string, { th: string; border: string; cell: string }> = {
  bahia:    { th: "bg-sky-50 text-sky-800",       border: "border-sky-200",    cell: "bg-sky-50/30"    },
  neco:     { th: "bg-violet-50 text-violet-800", border: "border-violet-200", cell: "bg-violet-50/30" },
  viajante: { th: "bg-teal-50 text-teal-800",     border: "border-teal-200",   cell: "bg-teal-50/30"   },
}

// Ordenamiento de filas para display consistente
const ORDER_GRUPO = ["LIMPIEZA_BAZAR", "PERFUMERIA"]
const ORDER_IVA_C = ["factura", "adquisicion_stock", "mixto"]
const ORDER_IVA_V = ["factura", "presupuesto"]

function sortReglas(reglas: ReglaPrecio[]): ReglaPrecio[] {
  return [...reglas].sort((a, b) => {
    const ga = ORDER_GRUPO.indexOf(a.grupo_precio)
    const gb = ORDER_GRUPO.indexOf(b.grupo_precio)
    if (ga !== gb) return ga - gb
    const ca = ORDER_IVA_C.indexOf(a.iva_compras)
    const cb = ORDER_IVA_C.indexOf(b.iva_compras)
    if (ca !== cb) return ca - cb
    return ORDER_IVA_V.indexOf(a.iva_ventas) - ORDER_IVA_V.indexOf(b.iva_ventas)
  })
}

// ─── Variables disponibles para autocompletado ───────

const FORMULA_VARS: { code: string; label: string; group: string; cls: string }[] = [
  { code: "Base",        label: "Base",        group: "base",     cls: "bg-indigo-100 text-indigo-700" },
  { code: "BaseContado", label: "BaseContado",  group: "base",     cls: "bg-amber-100 text-amber-700"  },
  ...SUBLISTA_CODIGOS.map(c => ({
    code:  c,
    label: SUBLISTA_META[c].label,
    group: SUBLISTA_META[c].grupo,
    cls:   SUBLISTA_META[c].grupo === "bahia"
      ? "bg-sky-100 text-sky-700"
      : SUBLISTA_META[c].grupo === "neco"
        ? "bg-violet-100 text-violet-700"
        : "bg-teal-100 text-teal-700",
  })),
]

function getCurrentToken(val: string, cursor: number) {
  const before = val.slice(0, cursor)
  const after  = val.slice(cursor)
  const startM = before.match(/[a-zA-Z_][a-zA-Z_0-9]*$/)
  const endM   = after.match(/^[a-zA-Z_0-9]*/)
  const start  = startM ? cursor - startM[0].length : cursor
  const end    = cursor + (endM ? endM[0].length : 0)
  return { token: val.slice(start, end), start, end }
}

// ─── Celda de fórmula individual ─────────────────────

interface CeldaProps {
  reglId: string
  codigo: SublistaCodigo
  initialValue: string
  onSave: (reglId: string, codigo: SublistaCodigo, valor: string) => Promise<void>
  saving: boolean
  disabled?: boolean
}

function CeldaFormula({ reglId, codigo, initialValue, onSave, saving, disabled }: CeldaProps) {
  const [valor, setValor] = useState(initialValue)
  const [focused, setFocused] = useState(false)
  const [sugs, setSugs] = useState<typeof FORMULA_VARS>([])
  const [sugIdx, setSugIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevRef  = useRef(initialValue)

  // Sincronizar si cambia desde afuera (ej: reset a defaults)
  useEffect(() => {
    setValor(initialValue)
    prevRef.current = initialValue
  }, [initialValue])

  // Preview calculado con Base=1000
  const preview = useMemo(() => {
    if (!valor) return null
    const vars: Record<string, number> = { Base: 1000, BaseContado: 900 }
    return evaluarFormula(valor, vars)
  }, [valor])

  // Actualizar sugerencias según el token bajo el cursor
  const refreshSugs = (val: string) => {
    const el = inputRef.current
    if (!el) return setSugs([])
    const cursor = el.selectionStart ?? val.length
    const { token } = getCurrentToken(val, cursor)
    if (!token) { setSugs([]); return }
    const lc = token.toLowerCase()
    const filtered = FORMULA_VARS.filter(v => v.code.toLowerCase().includes(lc))
    setSugs(filtered)
    setSugIdx(0)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValor(e.target.value)
    refreshSugs(e.target.value)
  }

  // Al hacer click dentro del input también refrescamos
  const handleSelect = () => {
    refreshSugs(valor)
  }

  // Aplicar una sugerencia reemplazando el token actual
  const applySug = (varCode: string) => {
    const el = inputRef.current
    if (!el) return
    const cursor = el.selectionStart ?? valor.length
    const { start, end } = getCurrentToken(valor, cursor)
    const newVal = valor.slice(0, start) + varCode + valor.slice(end)
    setValor(newVal)
    setSugs([])
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + varCode.length, start + varCode.length)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (sugs.length === 0) return
    if (e.key === "ArrowDown") { e.preventDefault(); setSugIdx(i => Math.min(i + 1, sugs.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSugIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault()
      applySug(sugs[sugIdx].code)
    } else if (e.key === "Escape") {
      setSugs([])
    }
  }

  const handleBlur = async () => {
    // Esperar un tick para que onMouseDown de sugerencia se ejecute primero
    await new Promise(r => setTimeout(r, 120))
    setFocused(false)
    setSugs([])
    if (valor === prevRef.current) return
    prevRef.current = valor
    await onSave(reglId, codigo, valor)
  }

  const meta = SUBLISTA_META[codigo]
  const gs = GRUPO_SUBLISTA[meta.grupo]

  return (
    <td
      className={`px-1 py-1 border-r ${gs.border} ${gs.cell} align-top`}
      style={{ minWidth: 118 }}
    >
      <div className="relative">
        <input
          ref={inputRef}
          value={valor}
          onChange={handleChange}
          onSelect={handleSelect}
          onFocus={() => { setFocused(true); refreshSugs(valor) }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Ej: Base*1.21"
          spellCheck={false}
          autoComplete="off"
          className={[
            "w-full text-[11px] font-mono px-1.5 py-1 rounded border bg-white transition-colors",
            valor ? "border-emerald-300 text-slate-800" : "border-slate-200 text-slate-400",
            focused ? "border-indigo-400 outline-none shadow-[0_0_0_1px_rgba(99,102,241,0.4)]" : "",
            "focus:outline-none disabled:opacity-40",
          ].join(" ")}
        />
        {saving && (
          <Loader2 className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-indigo-400 animate-spin" />
        )}

        {/* Dropdown de sugerencias */}
        {sugs.length > 0 && (
          <div className="absolute left-0 top-full mt-0.5 z-50 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
            style={{ minWidth: 160 }}>
            {sugs.map((v, i) => (
              <button
                key={v.code}
                type="button"
                onMouseDown={e => { e.preventDefault(); applySug(v.code) }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${i === sugIdx ? "bg-indigo-50" : "hover:bg-slate-50"}`}
              >
                <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold ${v.cls}`}>
                  {v.group === "base" ? "BASE" : v.group.toUpperCase().slice(0,3)}
                </span>
                <div className="min-w-0">
                  <div className="text-[10px] font-mono font-semibold text-slate-700 truncate">{v.code}</div>
                  <div className="text-[9px] text-slate-400 truncate">{v.label}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Preview con Base=1000 */}
      {preview !== null && (
        <div className="text-[9px] text-slate-400 font-mono text-right mt-0.5 leading-none px-0.5">
          ={preview.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      )}

      {/* Badge estado */}
      <div className={`flex items-center gap-0.5 text-[8px] font-semibold mt-0.5 px-0.5 leading-none ${valor ? "text-emerald-600" : "text-slate-300"}`}>
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${valor ? "bg-emerald-500" : "bg-slate-200"}`} />
        {valor ? "ok" : "vacío"}
      </div>
    </td>
  )
}

// ─── Componente principal ─────────────────────────────

export default function ListasPrecioPage() {
  const sb = createClient()
  const [reglas, setReglas] = useState<ReglaPrecio[]>([])
  const [loading, setLoading] = useState(true)
  // savingCell: "reglId|codigo"
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set())
  // Reset dialog
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<ReglaPrecio | null>(null)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb
      .from("listas_precio_reglas")
      .select("*")
      .order("grupo_precio")
    setReglas(sortReglas((data as ReglaPrecio[]) || []))
    setLoading(false)
  }, [sb])

  useEffect(() => { load() }, [load])

  // Auto-save de una celda
  const handleSave = async (reglId: string, codigo: SublistaCodigo, valor: string) => {
    const regla = reglas.find(r => r.id === reglId)
    if (!regla) return

    const cellKey = `${reglId}|${codigo}`
    setSavingCells(prev => new Set(prev).add(cellKey))

    const nuevasFormulas = { ...regla.formulas }
    if (valor.trim() === "") {
      delete nuevasFormulas[codigo]
    } else {
      nuevasFormulas[codigo] = valor.trim()
    }

    const { error } = await sb
      .from("listas_precio_reglas")
      .update({ formulas: nuevasFormulas })
      .eq("id", reglId)

    if (!error) {
      setReglas(prev =>
        prev.map(r => r.id === reglId ? { ...r, formulas: nuevasFormulas } : r),
      )
    }

    setSavingCells(prev => {
      const next = new Set(prev)
      next.delete(cellKey)
      return next
    })
  }

  // Reset una fila a los defaults del sistema anterior
  const handleResetRow = async () => {
    if (!resetTarget) return
    setResetting(true)

    const key = `${resetTarget.grupo_precio}|${resetTarget.iva_compras}|${resetTarget.iva_ventas}`
    const defaults = DEFAULTS[key] || {}

    const { error } = await sb
      .from("listas_precio_reglas")
      .update({ formulas: defaults })
      .eq("id", resetTarget.id)

    if (!error) {
      setReglas(prev =>
        prev.map(r => r.id === resetTarget.id ? { ...r, formulas: defaults } : r),
      )
    }

    setResetting(false)
    setResetDialogOpen(false)
    setResetTarget(null)
  }

  const openReset = (regla: ReglaPrecio) => {
    setResetTarget(regla)
    setResetDialogOpen(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Listas de Precio — Fórmulas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Definí qué cálculo aplicar para cada combinación de tipo de artículo × IVA × lista.
          Variables disponibles: <code className="text-xs font-mono bg-slate-100 px-1 rounded">Base</code>, <code className="text-xs font-mono bg-slate-100 px-1 rounded">BaseContado</code>, y cualquier sublista ya calculada.
          El preview muestra el resultado con <strong>Base = $1.000</strong>.
        </p>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              {/* Fila 1: grupos de sublistas */}
              <tr className="border-b">
                <th className="px-3 py-2 bg-slate-50 text-left font-semibold text-slate-600 border-r" colSpan={3}>
                  Segmento
                </th>
                <th className="px-2 py-2 text-center font-bold border-r bg-sky-50 text-sky-800" colSpan={4}>
                  Bahía
                </th>
                <th className="px-2 py-2 text-center font-bold border-r bg-violet-50 text-violet-800" colSpan={4}>
                  Neco
                </th>
                <th className="px-2 py-2 text-center font-bold bg-teal-50 text-teal-800" colSpan={1}>
                  Viajante
                </th>
                <th className="px-2 py-2 bg-slate-50 w-10" />
              </tr>
              {/* Fila 2: columnas individuales */}
              <tr className="border-b bg-slate-50">
                <th className="px-3 py-1.5 text-left font-medium text-slate-500 border-r whitespace-nowrap">Grupo</th>
                <th className="px-2 py-1.5 text-center font-medium text-slate-500 border-r whitespace-nowrap">IVA C.</th>
                <th className="px-2 py-1.5 text-center font-medium text-slate-500 border-r whitespace-nowrap">IVA V.</th>
                {SUBLISTA_CODIGOS.map(codigo => {
                  const meta = SUBLISTA_META[codigo]
                  const gs = GRUPO_SUBLISTA[meta.grupo]
                  const isLast = codigo === "neco_con_iva" || codigo === "viajante"
                  return (
                    <th
                      key={codigo}
                      className={`px-1.5 py-1.5 text-center font-medium ${gs.th} ${isLast ? "border-r" : ""}`}
                      style={{ minWidth: 118 }}
                    >
                      {meta.label}
                    </th>
                  )
                })}
                <th className="px-2 py-1.5 bg-slate-50" />
              </tr>
            </thead>

            <tbody>
              {reglas.map((regla, ri) => {
                const ivaC = IVA_C_MAP[regla.iva_compras]
                const ivaV = IVA_V_MAP[regla.iva_ventas]
                const grupoCls = GRUPO_CLS[regla.grupo_precio] || "bg-slate-100 text-slate-700"
                const isLastInGroup = ri === reglas.length - 1 ||
                  reglas[ri + 1].grupo_precio !== regla.grupo_precio

                return (
                  <tr
                    key={regla.id}
                    className={`border-b ${isLastInGroup ? "border-b-2 border-slate-200" : ""}`}
                  >
                    {/* Grupo */}
                    <td className="px-3 py-2 border-r whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${grupoCls}`}>
                        {GRUPO_LABEL[regla.grupo_precio] || regla.grupo_precio}
                      </span>
                    </td>

                    {/* IVA Compras */}
                    <td className="px-2 py-2 text-center border-r">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold ${ivaC?.cls}`}>
                        {ivaC?.label}
                      </span>
                    </td>

                    {/* IVA Ventas */}
                    <td className="px-2 py-2 text-center border-r">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold ${ivaV?.cls}`}>
                        {ivaV?.label}
                      </span>
                    </td>

                    {/* Celdas de fórmula */}
                    {SUBLISTA_CODIGOS.map(codigo => (
                      <CeldaFormula
                        key={codigo}
                        reglId={regla.id}
                        codigo={codigo}
                        initialValue={regla.formulas[codigo] || ""}
                        onSave={handleSave}
                        saving={savingCells.has(`${regla.id}|${codigo}`)}
                      />
                    ))}

                    {/* Botón reset */}
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => openReset(regla)}
                        title="Resetear a defaults del sistema anterior"
                        className="p-1 rounded text-slate-300 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Leyenda */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">+</span>
          <span>Factura (blanco)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">½</span>
          <span>Mixto (IVA 10.5%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-neutral-100 text-neutral-500">0</span>
          <span>Adquisición / Presupuesto (negro)</span>
        </div>
        <div className="ml-4 flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Celda con fórmula guardada</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-slate-200" />
          <span>Celda vacía (fallback al sistema anterior)</span>
        </div>
      </div>

      {/* Dialog de confirmación de reset */}
      <Dialog open={resetDialogOpen} onOpenChange={v => { if (!v) { setResetDialogOpen(false); setResetTarget(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetear fórmulas a defaults</DialogTitle>
          </DialogHeader>
          {resetTarget && (
            <div className="text-sm text-slate-600 space-y-2">
              <p>
                Se van a sobreescribir todas las fórmulas de la fila{" "}
                <strong>{GRUPO_LABEL[resetTarget.grupo_precio]}</strong>{" "}
                / IVA C. <strong>{IVA_C_MAP[resetTarget.iva_compras]?.label}</strong>{" "}
                / IVA V. <strong>{IVA_V_MAP[resetTarget.iva_ventas]?.label}</strong>{" "}
                con los valores del sistema anterior.
              </p>
              <p className="text-amber-700 text-xs bg-amber-50 px-3 py-2 rounded">
                Esta acción no puede deshacerse. Podés volver a editar cada celda manualmente.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setResetDialogOpen(false); setResetTarget(null) }}>
              Cancelar
            </Button>
            <Button onClick={handleResetRow} disabled={resetting} className="bg-amber-600 hover:bg-amber-700 text-white">
              {resetting ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Reseteando...</> : "Sí, resetear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
