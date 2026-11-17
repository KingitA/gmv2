"use client"

import { useCallback, useRef, useState, type ReactNode } from "react"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export interface OpcionesConfirmar {
    titulo: string
    /** Texto o contenido; los saltos de línea de un texto se respetan */
    detalle?: ReactNode
    confirmar?: string
    cancelar?: string
    /** Acción que no se puede deshacer (botón rojo) */
    peligro?: boolean
}

/**
 * Reemplazo de `confirm()` del navegador (que traba la pestaña y no se puede leer bien)
 * por el diálogo del sistema.
 *
 *   const { confirmar, dialogo } = useConfirmar()
 *   if (!(await confirmar({ titulo: "¿Eliminar…?", detalle: "…", peligro: true }))) return
 *   …y `{dialogo}` en el JSX.
 */
export function useConfirmar() {
    const [op, setOp] = useState<OpcionesConfirmar | null>(null)
    const resolver = useRef<((ok: boolean) => void) | null>(null)

    const confirmar = useCallback((opciones: OpcionesConfirmar) => {
        // Si había uno abierto, se da por cancelado
        resolver.current?.(false)
        setOp(opciones)
        return new Promise<boolean>((resolve) => { resolver.current = resolve })
    }, [])

    const cerrar = (ok: boolean) => {
        resolver.current?.(ok)
        resolver.current = null
        setOp(null)
    }

    const dialogo = (
        <AlertDialog open={!!op} onOpenChange={(abierto) => { if (!abierto) cerrar(false) }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{op?.titulo}</AlertDialogTitle>
                    {op?.detalle != null && (
                        <AlertDialogDescription asChild>
                            <div className="text-sm text-muted-foreground whitespace-pre-line">{op.detalle}</div>
                        </AlertDialogDescription>
                    )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => cerrar(false)}>{op?.cancelar || "Cancelar"}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => cerrar(true)}
                        className={op?.peligro ? "bg-red-600 hover:bg-red-700 text-white" : undefined}
                    >
                        {op?.confirmar || "Confirmar"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )

    return { confirmar, dialogo }
}
