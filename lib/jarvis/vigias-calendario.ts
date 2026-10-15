/**
 * Vigías del calendario de viajes (pedido de Juan, 15/10/2026):
 *
 * - dia_laboral: feriado de los próximos 60 días que nadie decidió → "¿Trabajamos?"
 *   (nunca se asume que un feriado no se trabaja). Si un feriado ya no figura
 *   en la fuente oficial pero está marcado "no trabajamos" → aviso.
 * - armar_mes: desde el día 20 (regla) → "Hay que armar el calendario de
 *   noviembre: faltan N zonas". Se repite hasta que quede completo; cuando
 *   queda completo se anota en la bitácora quién lo armó.
 * - viajes_afuera: zona a la que le toca este mes y no tiene viaje; días hábiles
 *   sin viaje de las zonas diarias (BAHIA); viaje en un día que no se trabaja;
 *   chofer de vacaciones en un viaje.
 *
 * Todo con la frecuencia de cada zona (lib/viajes/plan-mes.ts) y el calendario
 * laboral (lib/viajes/calendario-laboral.ts). Ninguno ejecuta nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { fecha as fmtFecha, hoyISO, sumarDiasISO } from "@/lib/formato"
import { estadoPlanMes, mesSiguiente } from "@/lib/viajes/plan-mes"
import { ausenciasEntre, diaSemana, diasEspeciales, esHabil } from "@/lib/viajes/calendario-laboral"
import { anotar } from "./registro"
import { nombresDeUsuarios } from "./agenda"
import type { Candidato, Vigia } from "./vigias"

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
const nombreMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1]
const corta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const lista = (xs: string[], max = 4) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} y ${xs.length - max} más`)

/** Feriados próximos sin decidir. */
export const diaLaboral: Vigia = async (db, hoy) => {
  const dias = await diasEspeciales(db, hoy, sumarDiasISO(hoy, 60))
  const out: Candidato[] = []
  for (const d of dias) {
    if (d.trabajamos === null && d.en_fuente && d.tipo !== "empresa" && ![0, 6].includes(diaSemana(d.fecha))) {
      const faltan = Math.round((Date.parse(d.fecha) - Date.parse(hoy)) / 86_400_000)
      out.push({
        clave: `dia_laboral:${d.fecha}`, vigia: "dia_laboral", tono: faltan <= 7 ? "alerta" : "atencion",
        titulo: `¿Trabajamos el ${DIAS[diaSemana(d.fecha)]} ${fmtFecha(d.fecha)}? Es ${d.tipo === "puente" ? "puente turístico" : "feriado"}: ${d.nombre}`,
        detalle: `Hasta que se decida, en el calendario de viajes figura como "feriado sin decidir". Se puede cambiar después desde "Armar mes".`,
        acciones: [{ texto: "Ver el calendario", pregunta: "", href: `/viajes/planificar?mes=${d.fecha.slice(0, 7)}` }],
        severidad: 1000 - faltan, entidad: { tipo: "dia", id: d.fecha },
        datos: { fecha: d.fecha, nombre: d.nombre, tipo: d.tipo },
        propuesta: { tipo: "dia_laboral", parametros: { fecha: d.fecha, nombre: d.nombre }, impacto: 0 },
      })
    }
    if (!d.en_fuente && d.origen === "api" && d.trabajamos === false) {
      out.push({
        clave: `feriado_caido:${d.fecha}`, vigia: "dia_laboral", tono: "atencion",
        titulo: `El ${fmtFecha(d.fecha)} ya no figura como feriado oficial, pero está marcado "no trabajamos"`,
        detalle: `Era: ${d.nombre}. Si se trabaja, cambialo en "Armar mes".`,
        acciones: [{ texto: "Ver el calendario", pregunta: "", href: `/viajes/planificar?mes=${d.fecha.slice(0, 7)}` }],
        severidad: 500, datos: { fecha: d.fecha },
      })
    }
  }
  return out
}

/** Desde el día 20: armar el calendario del mes siguiente. */
export const armarMes: Vigia = async (db, hoy, r) => {
  if (Number(hoy.slice(8, 10)) < (r.regla_dia_aviso_calendario ?? 20)) return []
  const mes = mesSiguiente(hoy.slice(0, 7))
  const estado = await estadoPlanMes(db, mes)
  const planificables = estado.zonas.filter((z) => z.toca_este_mes)
  const faltan = estado.faltantes
  if (!faltan.length) {
    await registrarCompleto(db, mes)
    return []
  }
  const diarias = faltan.filter((f) => f.dias_faltantes)
  const comunes = faltan.filter((f) => !f.dias_faltantes)
  const partes = [
    comunes.length ? `Sin viaje: ${lista(comunes.map((f) => f.nombre))}.` : "",
    ...diarias.map((f) => `${f.nombre}: faltan ${f.dias_faltantes!.length} días hábiles.`),
    estado.sin_decidir.length ? `Hay ${estado.sin_decidir.length} feriado(s) sin decidir (${estado.sin_decidir.map(corta).join(", ")}).` : "",
    estado.ausencias.length ? `Vacaciones/licencias en ${nombreMes(mes)}: ${lista([...new Set(estado.ausencias.map((a) => a.nombre))])}.` : "",
  ].filter(Boolean)
  return [{
    clave: `armar_mes:${mes}`, vigia: "armar_mes", tono: Number(hoy.slice(8, 10)) >= 27 ? "alerta" : "atencion",
    titulo: `Hay que armar el calendario de viajes de ${nombreMes(mes)}: faltan ${faltan.length} de ${planificables.length} zonas`,
    detalle: partes.join(" "),
    acciones: [{ texto: "Armar ahora", pregunta: "", href: `/viajes/planificar?mes=${mes}` }],
    severidad: faltan.length, datos: { mes, faltan: faltan.map((f) => f.nombre), total: planificables.length },
    propuesta: { tipo: "abrir_planificador", parametros: { mes }, impacto: 0 },
  }]
}

/** Cuando el mes queda completo, se anota UNA vez quién lo armó (los que programaron sus viajes). */
async function registrarCompleto(db: SupabaseClient, mes: string) {
  const { data: ya } = await db.from("ai_registro").select("id").eq("accion", "calendario_completo").eq("entidad_id", mes).limit(1)
  if (ya?.length) return
  const desde = `${mes}-01`
  const { data: vs } = await db.from("viajes").select("creado_por, created_at").eq("tipo", "reparto").neq("estado", "cancelado")
    .gte("fecha", desde).lte("fecha", sumarDiasISO(sumarDiasISO(desde, 31), -1))
  const viajes = (vs ?? []) as { creado_por: string | null; created_at: string }[]
  if (!viajes.length) return
  const nombres = await nombresDeUsuarios(db, viajes.map((v) => v.creado_por))
  const quienes = [...new Set(viajes.map((v) => (v.creado_por ? nombres.get(v.creado_por) ?? "alguien" : "sin usuario")))]
  await anotar(db, {
    usuarioId: null, accion: "calendario_completo", entidadTipo: "calendario", entidadId: mes,
    detalle: { titulo: `Calendario de viajes de ${nombreMes(mes)} completo`, nota: `Lo armaron: ${quienes.join(", ")} (${viajes.length} viajes)`, armado_por: quienes },
  })
}

/** Viajes que quedaron afuera / mal puestos, del mes en curso y los próximos días. */
export const viajesAfuera: Vigia = async (db, hoy) => {
  const out: Candidato[] = []
  const mes = hoy.slice(0, 7)
  const estado = await estadoPlanMes(db, mes, { desdeDia: hoy })

  // 1. zonas a las que les toca este mes y no tienen viaje
  const comunes = estado.faltantes.filter((f) => !f.dias_faltantes)
  if (comunes.length) {
    out.push({
      clave: `zonas_sin_viaje:${mes}`, vigia: "viajes_afuera", tono: Number(hoy.slice(8, 10)) >= 20 ? "alerta" : "atencion",
      titulo: `${comunes.length} zona${comunes.length === 1 ? "" : "s"} sin viaje en ${nombreMes(mes)}: ${lista(comunes.map((f) => f.nombre))}`,
      detalle: "Según la frecuencia de cada zona, les toca viaje este mes y todavía no lo tienen.",
      acciones: [{ texto: "Agregarlas al calendario", pregunta: "", href: `/viajes/planificar?mes=${mes}` }],
      severidad: comunes.length * 10, datos: { zonas: comunes.map((f) => f.nombre) },
    })
  }

  // 2. zonas diarias: días hábiles de los próximos 10 días sin viaje
  const hasta10 = sumarDiasISO(hoy, 14)
  const proximo = hasta10.slice(0, 7) !== mes ? await estadoPlanMes(db, hasta10.slice(0, 7)) : null
  for (const z of estado.zonas.filter((x) => x.frecuencia_dias === 1)) {
    const otra = proximo?.zonas.find((x) => x.id === z.id)
    const dias = [...(z.dias_faltantes ?? []), ...(otra?.dias_faltantes ?? [])].filter((d) => d >= hoy && d <= hasta10)
    if (!dias.length) continue
    out.push({
      clave: `diaria_sin_viaje:${z.id}`, vigia: "viajes_afuera", tono: dias[0] <= sumarDiasISO(hoy, 2) ? "alerta" : "atencion",
      titulo: `${z.nombre} no tiene viaje ${dias.length === 1 ? "el" : "los días"} ${lista(dias.map(corta), 6)}`,
      detalle: `${z.nombre} sale todos los días hábiles.`,
      acciones: [{ texto: "Ver el calendario", pregunta: "", href: `/viajes/planificar?mes=${dias[0].slice(0, 7)}` }],
      severidad: dias.length * 5, entidad: { tipo: "zona", id: z.id }, datos: { dias },
    })
  }

  // 3 y 4. viajes de los próximos 30 días en días que no se trabajan, o con chofer ausente
  const hasta30 = sumarDiasISO(hoy, 30)
  const [especiales, ausencias, { data: vs }] = await Promise.all([
    diasEspeciales(db, hoy, sumarDiasISO(hasta30, 15)),
    ausenciasEntre(db, hoy, sumarDiasISO(hasta30, 15)),
    db.from("viajes").select("id, nombre, fecha, dias, estado, viajes_choferes(usuario_id)")
      .eq("tipo", "reparto").in("estado", ["programado", "despachado"]).gte("fecha", hoy).lte("fecha", hasta30),
  ])
  const mapaEsp = new Map(especiales.map((e) => [e.fecha, e]))
  for (const v of (vs ?? []) as { id: string; nombre: string; fecha: string; dias: number; viajes_choferes: { usuario_id: string }[] }[]) {
    const dias = Array.from({ length: Math.max(1, Number(v.dias) || 1) }, (_, i) => sumarDiasISO(String(v.fecha).slice(0, 10), i))
    const inicio = esHabil(dias[0], mapaEsp)
    const feriadoNo = dias.find((d) => mapaEsp.get(d)?.trabajamos === false)
    if (inicio === false || feriadoNo) {
      const d = feriadoNo ?? dias[0]
      const motivo = mapaEsp.get(d)?.trabajamos === false ? `"no trabajamos" (${mapaEsp.get(d)!.nombre})` : DIAS[diaSemana(d)]
      out.push({
        clave: `viaje_no_laborable:${v.id}`, vigia: "viajes_afuera", tono: "alerta",
        titulo: `El viaje ${v.nombre} cae el ${fmtFecha(d)}, que es ${motivo}`,
        acciones: [{ texto: "Ver el viaje", pregunta: "", href: `/viajes/${v.id}` }],
        severidad: 200, entidad: { tipo: "viaje", id: v.id }, datos: { fecha: d },
      })
    } else if (inicio === null) {
      out.push({
        clave: `viaje_feriado_sin_decidir:${v.id}`, vigia: "viajes_afuera", tono: "atencion",
        titulo: `El viaje ${v.nombre} cae el ${fmtFecha(dias[0])}, feriado sin decidir`,
        detalle: "Decidí en \"Para decidir\" (o en el calendario) si ese día se trabaja.",
        acciones: [{ texto: "Ver el calendario", pregunta: "", href: `/viajes/planificar?mes=${dias[0].slice(0, 7)}` }],
        severidad: 150, entidad: { tipo: "viaje", id: v.id }, datos: { fecha: dias[0] },
      })
    }
    for (const c of v.viajes_choferes ?? []) {
      const a = ausencias.find((x) => x.usuario_id === c.usuario_id && x.desde <= dias[dias.length - 1] && x.hasta >= dias[0])
      if (!a) continue
      out.push({
        clave: `chofer_ausente:${v.id}:${c.usuario_id}`, vigia: "viajes_afuera", tono: "alerta",
        titulo: `${a.nombre} está asignado al viaje ${v.nombre} (${fmtFecha(dias[0])}) y está de ${a.tipo} (${corta(a.desde)} al ${corta(a.hasta)})`,
        detalle: "Cambiá el chofer del viaje o la fecha.",
        acciones: [{ texto: "Ver el viaje", pregunta: "", href: `/viajes/${v.id}` }],
        severidad: 300, entidad: { tipo: "viaje", id: v.id }, datos: { usuario: a.nombre, desde: a.desde, hasta: a.hasta },
      })
    }
  }
  return out
}
