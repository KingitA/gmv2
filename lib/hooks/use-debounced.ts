"use client"

import { useEffect, useState } from "react"

/**
 * Devuelve `valor` recién cuando dejó de cambiar durante `ms` milisegundos.
 * Para buscadores: se busca con el valor "asentado" y no con cada tecla.
 *
 *   const [texto, setTexto] = useState("")
 *   const textoBuscar = useDebounced(texto, 300)
 *   useEffect(() => { ...buscar(textoBuscar) }, [textoBuscar])
 */
export function useDebounced<T>(valor: T, ms = 300): T {
    const [asentado, setAsentado] = useState(valor)
    useEffect(() => {
        const t = setTimeout(() => setAsentado(valor), ms)
        return () => clearTimeout(t)
    }, [valor, ms])
    return asentado
}
