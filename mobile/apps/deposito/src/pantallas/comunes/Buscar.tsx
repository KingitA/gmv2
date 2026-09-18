import { useEffect, useMemo, type ReactNode } from "react"
import { esQrOUrl, lecturaError, useLector, useParamEstado } from "@gm/core"
import { ListaVirtual } from "@gm/core/ui"
import type { Articulo } from "../../datasets"
import { buscar, lineaInfo, sufijoMarca } from "../../datos/busqueda"
import { useArticulos } from "../../datos/hooks"
import { C, useCampoSinRafaga } from "../../ui"

/**
 * Pantalla "Buscar artículo" (en la web: scannerOpen). El flujo MANUAL es de primera:
 * hay mercadería sin etiqueta, así que tipear y tocar nunca depende del lector.
 * La búsqueda corre sobre la réplica local (sin red) y el texto vive en ?q= (no
 * agrega historial: atrás sale de la pantalla).
 */
export function PanelBuscar({ placeholder, vacio, decorar, onElegir, onCodigo, mostrar, filtrar, sinTexto, priorizar }: {
  placeholder: string
  vacio: { icono: string; texto: ReactNode }
  /** Estado del artículo en el pedido/OC (color y leyenda) */
  decorar?: (a: Articulo) => { bg: string; borde: string; leyenda?: ReactNode } | null
  onElegir: (a: Articulo) => void
  /** Lectura del lector estando en esta pantalla */
  onCodigo: (codigo: string) => void
  mostrar: (m: string, t?: "ok" | "err") => void
  /** Restringe los resultados (filtros de proveedor / categoría) */
  filtrar?: (a: Articulo) => boolean
  /** Artículos que van primero en los resultados (los del pedido / la OC en curso) */
  priorizar?: (a: Articulo) => boolean
  /** Qué listar cuando todavía no hay texto (ej. los artículos del filtro activo) */
  sinTexto?: Articulo[]
}) {
  // El texto se tipea contra estado local (respuesta inmediata) y se refleja en ?q=
  // con un respiro: si el operario entra a un artículo y vuelve, la búsqueda sigue ahí.
  const [qUrl, setQUrl] = useParamEstado("q")
  const { valor: q, cambiar: setQ, restaurar } = useCampoSinRafaga(qUrl)
  useEffect(() => {
    if (q === qUrl) return
    const t = setTimeout(() => setQUrl(q), 250)
    return () => clearTimeout(t)
  }, [q, qUrl, setQUrl])
  const { indice, articulos, cargando } = useArticulos()
  const resultados = useMemo(() => {
    if (q.trim().length < 2) return sinTexto ?? []
    if (!filtrar && !priorizar) return buscar(indice, q)
    let r = buscar(indice, q, 5000)
    if (filtrar) r = r.filter(filtrar)
    // sort estable: lo del pedido/OC arriba, el resto conserva su relevancia
    if (priorizar) r = [...r].sort((x, y) => Number(priorizar(y)) - Number(priorizar(x)))
    return r.slice(0, 50)
  }, [indice, q, filtrar, sinTexto, priorizar])

  useLector({
    // El buscador tiene foco: igual se intercepta la ráfaga del lector (si no, el
    // código quedaría tipeado en el buscador y habría que tocar la pantalla)
    ignorarConInputEnfocado: false,
    onCodigo: (codigo) => {
      restaurar() // la ráfaga quedó tipeada en el buscador: volver a lo que había
      if (esQrOUrl(codigo)) { lecturaError(); mostrar("QR ignorado — escaneá el código de barras", "err"); return }
      onCodigo(codigo)
    },
  })

  return (
    <>
      <div style={{ padding: "14px 16px" }}>
        <input
          type="text" inputMode="search" placeholder={placeholder} value={q} autoFocus
          onChange={(e) => setQ(e.target.value)}
          style={{ width: "100%", background: C.white, color: C.text, fontSize: 17, borderRadius: 16, padding: "15px 18px", border: `1.5px solid ${C.border}`, outline: "none", boxSizing: "border-box", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
        />
      </div>
      {q.trim().length < 2 && !sinTexto ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, flexDirection: "column", gap: 14, color: C.light, padding: 16 }}>
          <div style={{ fontSize: 56, lineHeight: 1 }}>{vacio.icono}</div>
          <div style={{ textAlign: "center", fontSize: 15, lineHeight: 1.5 }}>{vacio.texto}</div>
          {!cargando && articulos.length === 0 && (
            <div style={{ textAlign: "center", fontSize: 13, color: C.yellow, fontWeight: 600 }}>El catálogo todavía no se descargó: conectate al WiFi una vez.</div>
          )}
        </div>
      ) : (
        <ListaVirtual
          items={resultados}
          alto={104}
          clave={(a) => a.id}
          vacio={q.trim().length < 2 ? "No hay artículos con ese filtro" : `Sin resultados para "${q}"`}
          render={(art) => {
            const d = decorar?.(art)
            return (
              <div style={{ padding: "0 16px 10px", height: "100%", boxSizing: "border-box" }}>
                <button
                  onClick={() => onElegir(art)}
                  style={{ textAlign: "left", width: "100%", height: "100%", background: d?.bg ?? C.white, border: `1.5px solid ${d?.borde ?? C.border}`, borderRadius: 16, padding: "12px 16px", overflow: "hidden" }}
                >
                  <div style={{ color: C.text, fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{art.descripcion}{sufijoMarca(art)}</div>
                  <div style={{ fontSize: 13, color: C.sub, fontFamily: "monospace", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lineaInfo(art)}</div>
                  {d?.leyenda && <div style={{ fontSize: 13, marginTop: 4, fontWeight: 600 }}>{d.leyenda}</div>}
                </button>
              </div>
            )
          }}
        />
      )}
    </>
  )
}
