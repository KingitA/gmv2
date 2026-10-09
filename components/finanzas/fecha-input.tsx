"use client"

import { DateInputAR } from "@/components/ui/date-input-ar"

/**
 * Input de fecha en formato argentino dd/mm/aaaa (valor ISO YYYY-MM-DD).
 * Envoltorio fino de DateInputAR (campo único del sistema, ver docs/FORMATOS.md):
 * se mantiene para no tocar la API de sus llamadores.
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
    return (
        <div className={containerClassName || "w-full"}>
            <DateInputAR
                value={value}
                onChange={onChange}
                required={required}
                placeholder={placeholder}
                className={className}
            />
        </div>
    )
}
