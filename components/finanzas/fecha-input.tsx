"use client"

import { useState, useEffect } from "react"

/**
 * Input de fecha en formato argentino dd/mm/aaaa (con barras automáticas).
 * Reemplaza a <input type="date">, que se muestra según el locale del
 * navegador (mm/dd en inglés). El valor expuesto es siempre ISO YYYY-MM-DD.
 */
export function FechaInput({
    value,
    onChange,
    required = false,
    className = "",
    placeholder = "dd/mm/aaaa",
}: {
    value: string // ISO YYYY-MM-DD o ""
    onChange: (iso: string) => void
    required?: boolean
    className?: string
    placeholder?: string
}) {
    const isoToAR = (iso: string) => {
        const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        return m ? `${m[3]}/${m[2]}/${m[1]}` : ""
    }
    const [texto, setTexto] = useState(isoToAR(value))

    // Sincronizar cuando el valor cambia desde afuera (prefill, reset)
    useEffect(() => {
        const ar = isoToAR(value)
        setTexto((prev) => (parseAR(prev) === value && value ? prev : ar))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    function parseAR(txt: string): string {
        const m = txt.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
        if (!m) return ""
        let [, d, mo, y] = m
        let year = Number(y)
        if (year < 100) year += 2000
        const day = Number(d), month = Number(mo)
        if (month < 1 || month > 12 || day < 1) return ""
        if (day > new Date(year, month, 0).getDate()) return ""
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    }

    function handleChange(raw: string) {
        let v = raw.replace(/[^\d]/g, "").slice(0, 8)
        if (v.length > 4) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`
        else if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`
        setTexto(v)
        onChange(parseAR(v))
    }

    const invalido = texto.trim() !== "" && !parseAR(texto)

    return (
        <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            value={texto}
            required={required}
            placeholder={placeholder}
            onChange={(e) => handleChange(e.target.value)}
            className={`flex h-9 w-full rounded-md border bg-transparent px-3 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${invalido ? "border-red-500" : "border-input"} ${className}`}
        />
    )
}
