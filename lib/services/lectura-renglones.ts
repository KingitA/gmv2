/**
 * Renglones de una lectura automática (OCR): que no se pierda ninguno en silencio.
 *
 * Prueba en producción del 18/11 (OC-000012, FA 0003-00045711): la lectura traía DOS renglones
 * (rollo aluminio y rollo film) y se guardó UNO. El texto que devuelve la IA es un JSON; si los
 * renglones vienen repartidos en más de una lista "items" (clave repetida, o una lista adentro de
 * otra parte del JSON), al interpretarlo queda solo la última y el resto desaparece sin aviso.
 *
 * Acá se recorre el TEXTO de la lectura y se juntan todas las listas de renglones que traiga. Y
 * como segunda red: si el texto menciona más renglones de los que quedaron, se avisa.
 *
 * Archivo PURO. Tests: mobile/packages/core/test/entrada-ocr-match.test.ts
 */

/** Trozo balanceado que empieza en `desde` (un "[" o un "{"), respetando las comillas. null si no cierra. */
function trozoBalanceado(texto: string, desde: number): string | null {
  const abre = texto[desde]
  const cierra = abre === "[" ? "]" : abre === "{" ? "}" : null
  if (!cierra) return null
  let nivel = 0
  let enTexto = false
  for (let i = desde; i < texto.length; i++) {
    const ch = texto[i]
    if (enTexto) {
      if (ch === "\\") i++
      else if (ch === '"') enTexto = false
      continue
    }
    if (ch === '"') enTexto = true
    else if (ch === abre) nivel++
    else if (ch === cierra) {
      nivel--
      if (nivel === 0) return texto.slice(desde, i + 1)
    }
  }
  return null
}

/** Todas las listas `"items": [ … ]` que aparecen en el texto, en orden (sin repetir las anidadas). */
export function listasDeRenglones(texto: string): any[][] {
  const listas: any[][] = []
  const re = /"items"\s*:\s*\[/g
  let m: RegExpExecArray | null
  let hasta = -1
  while ((m = re.exec(texto))) {
    const inicio = m.index + m[0].length - 1
    if (inicio < hasta) continue // lista adentro de otra que ya se tomó
    const trozo = trozoBalanceado(texto, inicio)
    if (!trozo) continue
    try {
      const lista = JSON.parse(trozo)
      if (Array.isArray(lista)) {
        listas.push(lista.filter((x) => x && typeof x === "object" && !Array.isArray(x)))
        hasta = inicio + trozo.length
      }
    } catch {
      // esa lista no se pudo interpretar: se sigue con las demás
    }
  }
  return listas
}

const claveRenglon = (it: any) => JSON.stringify([it?.codigo ?? null, it?.descripcion ?? null, it?.cantidad ?? null, it?.precio_unitario ?? null, it?.total_linea ?? null])

export interface RenglonesLeidos {
  items: any[]
  /** Cosas que la oficina tiene que saber de esta lectura (vacío = nada raro) */
  avisos: string[]
}

/**
 * Los renglones de una lectura: los del JSON interpretado MÁS los de cualquier otra lista que
 * traiga el texto. Nunca devuelve menos renglones que `itemsInterpretados`.
 */
export function renglonesDeLectura(texto: string, itemsInterpretados: any[] | null | undefined): RenglonesLeidos {
  const base: any[] = Array.isArray(itemsInterpretados) ? itemsInterpretados.filter((x) => x && typeof x === "object") : []
  const avisos: string[] = []
  const listas = listasDeRenglones(texto || "")
  const items = [...base]
  if (listas.length > 1 || (listas.length === 1 && listas[0]!.length > base.length)) {
    // Se agregan los que el JSON interpretado no trae (se compara renglón por renglón, respetando repetidos)
    const cuenta = new Map<string, number>()
    for (const it of base) cuenta.set(claveRenglon(it), (cuenta.get(claveRenglon(it)) || 0) + 1)
    let agregados = 0
    for (const lista of listas) {
      for (const it of lista) {
        const k = claveRenglon(it)
        const quedan = cuenta.get(k) || 0
        if (quedan > 0) { cuenta.set(k, quedan - 1); continue }
        items.push(it)
        agregados++
      }
    }
    if (agregados > 0) {
      avisos.push(`La lectura automática traía los renglones repartidos en más de una lista: se juntaron los ${items.length} (${agregados} se habrían perdido). Controlá que estén todos.`)
    }
  }
  // Segunda red: renglones que el texto menciona y no quedaron en ninguna lista
  const mencionados = (String(texto || "").match(/"descripcion"\s*:/g) || []).length
  if (mencionados > items.length) {
    avisos.push(`La lectura automática menciona ${mencionados} renglones y se cargaron ${items.length}: comparalo con el papel y agregá a mano el que falte (botón +).`)
  }
  return { items, avisos }
}
