"use client"

import { useState, useEffect, useRef } from "react"
import { CalendarDays } from "lucide-react"

/**
 * Input de fecha en formato argentino dd/mm/aaaa. El valor expuesto es
 * siempre ISO YYYY-MM-DD.
 *
 * Acepta:
 *  - dígitos corridos: 070726 / 07072026 (barras automáticas)
 *  - escribir con separadores: 7/7/26, 07/07/2026, 07-07-2026, 07.07.2026
 *  - clic en el ícono de calendario (abre el selector nativo; lo que se ve
 *    en el campo sigue siendo dd/mm/aaaa, no depende del locale del navegador)
 */
export function FechaInput({
    value,
    onChange,
    required = false,
    className = "",
    containerClassName = "",
    placeholder = "dd/mm/aaaa",
}: {
    value: string // ISO YYYY-MM-DD o ""
    onChange: (iso: string) => void
    required?: boolean
    className?: string
    containerClassName?: string
    placeholder?: string
}) {
    const isoToAR = (iso: string) => {
        const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        return m ? `${m[3]}/${m[2]}/${m[1]}` : ""
    }
    const [texto, setTexto] = useState(isoToAR(value))
    const dateRef = useRef<HTMLInputElement>(null)

    // Sincronizar cuando el valor cambia desde afuera (prefill, reset)
    useEffect(() => {
        const ar = isoToAR(value)
        setTexto((prev) => (parseAR(prev) === value && value ? prev : ar))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    function parseAR(txt: string): string {
        const m = txt.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
        if (!m) return ""
        const [, d, mo, y] = m
        let year = Number(y)
        if (year < 100) year += 2000
        const day = Number(d), month = Number(mo)
        if (month < 1 || month > 12 || day < 1) return ""
        if (day > new Date(year, month, 0).getDate()) return ""
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    }

    function handleChange(raw: string) {
        // Permitir dígitos y separadores / . - (normalizados a /)
        let v = raw.replace(/[^\d/.\-]/g, "").replace(/[.\-]/g, "/").replace(/\/{2,}/g, "/").slice(0, 10)
        // Barras automáticas solo cuando se escriben dígitos corridos
        if (!v.includes("/")) {
            if (v.length > 4) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4, 8)}`
            else if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`
        }
        setTexto(v)
        onChange(parseAR(v))
    }

    function abrirCalendario() {
        const el = dateRef.current
        if (!el) return
        try {
            // @ts-ignore showPicker no está en todos los tipos
            if (el.showPicker) el.showPicker()
            else el.click()
        } catch {
            el.click()
        }
    }

    const invalido = texto.trim() !== "" && !parseAR(texto)

    return (
        <div className={`relative ${containerClassName || "w-full"}`}>
            <input
                type="text"
                inputMode="numeric"
                maxLength={10}
                value={texto}
                required={required}
                placeholder={placeholder}
                onChange={(e) => handleChange(e.target.value)}
                className={`flex h-9 w-full rounded-md border bg-transparent px-3 py-1 pr-8 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${invalido ? "border-red-500" : "border-input"} ${className}`}
            />
            <button
                type="button"
                tabIndex={-1}
                onClick={abrirCalendario}
                title="Elegir en el calendario"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
                <CalendarDays className="h-4 w-4" />
            </button>
            {/* Selector nativo oculto: solo aporta el popup del calendario */}
            <input
                ref={dateRef}
                type="date"
                tabIndex={-1}
                aria-hidden="true"
                value={value || ""}
                onChange={(e) => {
                    const iso = e.target.value
                    if (iso) {
                        setTexto(isoToAR(iso))
                        onChange(iso)
                    }
                }}
                className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
            />
        </div>
    )
}
