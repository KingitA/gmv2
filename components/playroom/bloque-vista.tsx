"use client"

// Dibuja un Bloque (número, tabla o gráfico) con el estilo del sistema. Lo usan el
// tablero y el chat de Megasur, así lo que responde el chat se ve igual que una tarjeta.

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { cn } from "@/lib/utils"
import { formatear, pesosCorto, type Bloque, type Formato } from "@/lib/playroom/bloques"

// Colores de series (orden fijo, validados para daltonismo): azul Megasur y cian.
// La serie "de comparación" (mes anterior) va en gris: es referencia, no protagonista.
const SERIE = ["#4549B5", "#22A9C9"]
const GRIS_COMPARACION = "#9295AE"
const TINTA = { fuerte: "#1E2030", media: "#545871", suave: "#6E7290", grilla: "#E3E5EF" }

const corto = (v: unknown, f?: Formato) =>
  f === "pesos" ? pesosCorto(Number(v) || 0) : formatear(v, f ?? "numero", true)

export function BloqueVista({ bloque, compacto = false }: { bloque: Bloque; compacto?: boolean }) {
  if (bloque.tipo === "numero") return <NumeroVista bloque={bloque} />
  if (bloque.tipo === "tabla") return <TablaVista bloque={bloque} />
  return <GraficoVista bloque={bloque} compacto={compacto} />
}

function NumeroVista({ bloque }: { bloque: Extract<Bloque, { tipo: "numero" }> }) {
  const valor = bloque.valor == null ? "—" : bloque.formato === "pesos" ? pesosCorto(bloque.valor) : formatear(bloque.valor, bloque.formato)
  const tono = bloque.comparacion?.tono
  return (
    <div>
      <div className="text-[26px] font-extrabold leading-tight tracking-tight text-azul-900 tabular-nums">{valor}</div>
      {bloque.comparacion && (
        <div className={cn("mt-0.5 text-[13px] font-semibold",
          tono === "bien" ? "text-exito-600" : tono === "mal" ? "text-error-600" : "text-neutro-500")}>
          {bloque.comparacion.texto}
        </div>
      )}
      {bloque.nota && <div className="mt-1 text-xs text-neutro-400">{bloque.nota}</div>}
    </div>
  )
}

function TablaVista({ bloque }: { bloque: Extract<Bloque, { tipo: "tabla" }> }) {
  const derecha = (f?: Formato) => f === "pesos" || f === "numero" || f === "porcentaje"
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-neutro-200 text-xs text-neutro-500">
              {bloque.columnas.map(c => (
                <th key={c.clave} className={cn("py-1.5 pr-3 font-semibold last:pr-0", derecha(c.formato) ? "text-right" : "text-left")}>{c.titulo}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bloque.filas.map((f, i) => (
              <tr key={i} className="border-b border-neutro-100 last:border-0">
                {bloque.columnas.map(c => (
                  <td key={c.clave} className={cn("max-w-[260px] truncate py-1.5 pr-3 last:pr-0",
                    derecha(c.formato) ? "text-right font-semibold tabular-nums text-azul-900" : "text-neutro-700")}
                    title={String(f[c.clave] ?? "")}>
                    {formatear(f[c.clave], c.formato ?? "texto")}
                  </td>
                ))}
              </tr>
            ))}
            {bloque.total && (
              <tr className="border-t-2 border-neutro-200 font-bold text-azul-900">
                {bloque.columnas.map((c, i) => (
                  <td key={c.clave} className={cn("py-1.5 pr-3 normal-case last:pr-0", derecha(c.formato) ? "text-right tabular-nums" : "")}>
                    {i === 0 ? "Total" : bloque.total?.[c.clave] != null ? formatear(bloque.total[c.clave], c.formato) : ""}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {bloque.filas.length === 0 && <p className="py-4 text-center text-sm text-neutro-400">Sin datos para mostrar</p>}
      {bloque.nota && <p className="mt-1.5 text-xs text-neutro-400">{bloque.nota}</p>}
    </div>
  )
}

function Consejo({ active, payload, label, formato, ejeFormato }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-neutro-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-semibold text-neutro-600">{ejeFormato ? ejeFormato(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-neutro-600">{p.name}</span>
          <span className="ml-auto pl-3 font-bold tabular-nums text-azul-900">{formatear(p.value, formato ?? "numero")}</span>
        </div>
      ))}
    </div>
  )
}

function GraficoVista({ bloque, compacto }: { bloque: Extract<Bloque, { tipo: "grafico" }>; compacto: boolean }) {
  const alto = compacto ? 180 : 230
  const fx = bloque.x.formato
  const ejeX = (v: unknown) => (fx === "fecha" ? formatear(v, "fecha").slice(0, 5) : String(v))

  if (bloque.forma === "lineas") {
    // La última serie se toma como "comparación" si hay dos (ej: mes anterior)
    const comparacion = bloque.series.length === 2 ? bloque.series[1].clave : null
    return (
      <div>
        <div style={{ height: alto }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={bloque.datos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={TINTA.grilla} vertical={false} />
              <XAxis dataKey={bloque.x.clave} tickFormatter={ejeX} tick={{ fill: TINTA.suave, fontSize: 11 }} tickLine={false} axisLine={{ stroke: TINTA.grilla }} minTickGap={16} />
              <YAxis tickFormatter={v => corto(v, bloque.formato)} tick={{ fill: TINTA.suave, fontSize: 11 }} tickLine={false} axisLine={false} width={68} />
              <Tooltip content={<Consejo formato={bloque.formato} ejeFormato={(l: unknown) => (bloque.x.titulo ? `${bloque.x.titulo} ${ejeX(l)}` : ejeX(l))} />} />
              {bloque.series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: TINTA.media }} />}
              {bloque.series.map((s, i) => {
                const esComparacion = s.clave === comparacion
                const color = esComparacion ? GRIS_COMPARACION : SERIE[i % SERIE.length]
                return (
                  <Area key={s.clave} type="monotone" dataKey={s.clave} name={s.titulo} stroke={color} strokeWidth={2}
                    fill={color} fillOpacity={esComparacion ? 0 : 0.1} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} />
                )
              })}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {bloque.nota && <p className="mt-1 text-xs text-neutro-400">{bloque.nota}</p>}
      </div>
    )
  }

  // Barras (y torta, que se muestra como barras: se leen mejor)
  const horizontales = bloque.datos.length > 0 && bloque.datos.every(d => typeof d[bloque.x.clave] === "string")
  const altoBarras = horizontales ? Math.max(120, bloque.datos.length * 30 + 16) : alto
  return (
    <div>
      <div style={{ height: altoBarras }}>
        <ResponsiveContainer width="100%" height="100%">
          {horizontales ? (
            <BarChart data={bloque.datos} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey={bloque.x.clave} width={compacto ? 96 : 120} tick={{ fill: TINTA.media, fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "#F0F1F7" }} content={<Consejo formato={bloque.formato} />} />
              {bloque.series.slice(0, 1).map((s, i) => (
                <Bar key={s.clave} dataKey={s.clave} name={s.titulo} fill={SERIE[i]} radius={[0, 4, 4, 0]} maxBarSize={18}>
                  <LabelList dataKey={s.clave} position="right" formatter={(v: unknown) => corto(v, bloque.formato)} style={{ fill: TINTA.fuerte, fontSize: 12, fontWeight: 700 }} />
                </Bar>
              ))}
            </BarChart>
          ) : (
            <BarChart data={bloque.datos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={TINTA.grilla} vertical={false} />
              <XAxis dataKey={bloque.x.clave} tickFormatter={ejeX} tick={{ fill: TINTA.suave, fontSize: 11 }} tickLine={false} axisLine={{ stroke: TINTA.grilla }} />
              <YAxis tickFormatter={v => corto(v, bloque.formato)} tick={{ fill: TINTA.suave, fontSize: 11 }} tickLine={false} axisLine={false} width={68} />
              <Tooltip cursor={{ fill: "#F0F1F7" }} content={<Consejo formato={bloque.formato} />} />
              {bloque.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: TINTA.media }} />}
              {bloque.series.map((s, i) => (
                <Bar key={s.clave} dataKey={s.clave} name={s.titulo} fill={SERIE[i % SERIE.length]} radius={[4, 4, 0, 0]} maxBarSize={24} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {bloque.nota && <p className="mt-1 text-xs text-neutro-400">{bloque.nota}</p>}
    </div>
  )
}

/** El cerebro actual devuelve `data` (filas sueltas): se convierte en una tabla */
export function tablaDesdeFilas(filas: Record<string, any>[], titulo = "Datos"): Bloque | null {
  if (!Array.isArray(filas) || filas.length === 0) return null
  const claves = Object.keys(filas[0]).slice(0, 6)
  const esPesos = (k: string) => /total|saldo|neto|monto|capital|venta|devengado|cobrable|pagado|pendiente|costo/i.test(k)
  return {
    tipo: "tabla", titulo,
    columnas: claves.map(k => ({
      clave: k,
      titulo: k.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()),
      formato: typeof filas[0][k] === "number" ? (esPesos(k) ? "pesos" : "numero") : "texto",
    })),
    filas: filas.slice(0, 50),
  }
}
