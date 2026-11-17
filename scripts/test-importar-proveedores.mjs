#!/usr/bin/env node
// Prueba del importador del Excel "proveedores-para-completar" (lib/proveedores/importar-datos.ts).
//
//   node --experimental-strip-types scripts/test-importar-proveedores.mjs
//   node --experimental-strip-types scripts/test-importar-proveedores.mjs "C:\ruta\al\excel.xlsx"
//
// (node 22.6 o más nuevo; desde la 22.18 la bandera ya no hace falta.) No toca la base ni la red:
// prueba las funciones puras. Si existe el Excel de ejemplo (docs/entrada/proveedores-para-completar.xlsx
// en este árbol o en el checkout principal), además lo lee y muestra el resumen.

import { register, createRequire } from "node:module"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")

// El .ts importa con el alias "@/…" y sin extensión: este gancho se lo resuelve a node.
const GANCHO = `
import { existsSync, statSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
const RAIZ = ${JSON.stringify(pathToFileURL(RAIZ + "/").href)}
const esArchivo = (u) => { try { return statSync(fileURLToPath(u)).isFile() } catch { return false } }
export async function resolve(specifier, context, next) {
  let base = null
  if (specifier.startsWith("@/")) base = new URL(specifier.slice(2), RAIZ).href
  else if (/^\\.\\.?\\//.test(specifier) && context.parentURL && context.parentURL.startsWith("file:")) base = new URL(specifier, context.parentURL).href
  if (base) {
    for (const cand of [base, base + ".ts", base + "/index.ts"]) {
      if (esArchivo(cand)) return { url: cand, shortCircuit: true }
    }
  }
  return next(specifier, context)
}
`
register("data:text/javascript," + encodeURIComponent(GANCHO), import.meta.url)

const {
  leerFilasExcel, validarFila, calcularCambios, analizarImportacion, claveDeEncabezado,
  COLUMNAS_PROVEEDOR, updateDeCambios, nombresParecidos, textoValor,
  COLUMNAS_PLANTILLA, filaPlantilla, ayudaPlantilla,
} = await import(pathToFileURL(join(RAIZ, "lib/proveedores/importar-datos.ts")).href)

let ok = 0, mal = 0
function prueba(nombre, fn) {
  try { fn(); ok++; console.log(`  ✓ ${nombre}`) } catch (e) { mal++; console.log(`  ✗ ${nombre}\n      ${e.message}`) }
}
/** Compara por contenido (el orden de las claves de un objeto no importa). */
const ordenado = (v) => Array.isArray(v) ? v.map(ordenado) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenado(v[k])])) : v
function igual(a, b, que = "") {
  const x = JSON.stringify(ordenado(a)), y = JSON.stringify(ordenado(b))
  if (x !== y) throw new Error(`${que} esperaba ${y} y dio ${x}`)
}
const cierto = (v, que) => { if (!v) throw new Error(que) }
const columnasConError = (v) => v.errores.map((e) => e.columna)

const ENCABEZADOS = [
  "Código (no tocar)", "Proveedor (no tocar)", "CUIT (xx-xxxxxxxx-x)", "Tipo (mercaderia / transporte / servicios)",
  "Mail para enviar la orden de compra", "Mail de administración / cobranzas", "Teléfono del vendedor", "Banco del proveedor",
  "CBU", "Alias", "Titular de la cuenta", "BLANCO: medio de pago", "BLANCO: días de plazo", "BLANCO: desde (factura / recepcion)",
  "BLANCO: plazo máx. del cheque (días)", "BLANCO: cómo se entrega", "NEGRO: medio de pago", "NEGRO: días de plazo",
  "NEGRO: desde (factura / recepcion)", "NEGRO: plazo máx. del cheque (días)", "NEGRO: cómo se entrega",
  "Acepta cheques de terceros (si / no)", "Acepta e-cheq (si / no)", "Retención Ganancias (mercaderia 2% / transporte 0,25% / exento)",
  "Exento: vence certificado (dd/mm/aaaa)", "Transporte habitual", "Días que tarda en entregar", "Observaciones",
]
const CLAVES = [
  "codigo", "nombre", "cuit", "tipo", "mail_oc", "mail_admin", "telefono_vendedor", "banco", "cbu", "alias", "titular",
  "blanco_medio", "blanco_dias", "blanco_desde", "blanco_plazo_cheque", "blanco_entrega",
  "negro_medio", "negro_dias", "negro_desde", "negro_plazo_cheque", "negro_entrega",
  "acepta_cheques_terceros", "acepta_echeq", "ganancias", "exento_hasta", "transporte_habitual", "dias_entrega", "observaciones",
]

/** Proveedor como viene de la base (todo lo importable vacío salvo lo que se pise). */
function proveedor(extra = {}) {
  const p = {}
  for (const c of COLUMNAS_PROVEEDOR) p[c] = null
  return { ...p, id: "id-1", codigo_proveedor: "134", nombre: "ACORAZADO", activo: true, regimen_ganancias: "bienes", condicion_ganancias: "inscripto", ...extra }
}

console.log("\nEncabezados")
prueba("columnas nuevas: tipo de descuento y percepciones", () => {
  igual(claveDeEncabezado("Descuentos: cómo se aplican (cascada / sobre_lista)"), "tipo_descuento")
  igual(claveDeEncabezado("Tipo de descuento"), "tipo_descuento")
  igual(claveDeEncabezado("Tipo (mercaderia / transporte / servicios)"), "tipo")
  igual(claveDeEncabezado("Percepción IVA %"), "percepcion_iva")
  igual(claveDeEncabezado("Percepción IIBB %"), "percepcion_iibb")
  igual(validarFila({ codigo: "1", tipo_descuento: "Sobre precio lista" }).valores.tipo_descuento, "sobre_lista")
  igual(validarFila({ codigo: "1", tipo_descuento: "en cascada" }).valores.tipo_descuento, "cascada")
  igual(validarFila({ codigo: "1", tipo_descuento: "otro" }).errores.length, 1)
  igual(validarFila({ codigo: "1", percepcion_iva: "3", percepcion_iibb: "1,5 %" }).valores, { percepcion_iva: 3, percepcion_iibb: 1.5 })
  igual(validarFila({ codigo: "1", percepcion_iva: "300" }).errores.length, 1)
})
prueba("plantilla: lo que se descarga se vuelve a subir tal cual y no cambia nada", () => {
  const p = proveedor({
    cuit: "30-67949425-9", tipo_proveedor: "transporte", mail_ordenes_compra: "pedidos@x.com, ventas@x.com", mail_oficina: "adm@x.com",
    telefono_vendedor: "291 4000000", tipo_descuento: "sobre_lista", mixto_pct_factura: 70, percepcion_iva: 3, percepcion_iibb: 1.5,
    pago_blanco_medio: "echeq", pago_blanco_dias: 30, pago_blanco_cuotas: "30/60/90", pago_blanco_desde: "recepcion", pago_blanco_plazo_cheque: 60, pago_blanco_entrega: "retira_oficina",
    pago_negro_medio: "efectivo", pago_negro_dias: 0, pago_negro_desde: "factura",
    banco_nombre: "Credicoop", cbu: "0170099220000067797370", cbu_alias: "mi.alias-01", banco_titular: "X SA",
    acepta_cheques_terceros: true, acepta_echeq: false, regimen_ganancias: "transporte", condicion_ganancias: "exento", ganancias_exento_hasta: "2027-03-31",
    transporte_habitual: "Expreso Sur", dias_entrega: 7, observaciones_compra: "Entrega los martes",
  })
  const fila = filaPlantilla(p)
  // pasa por una "hoja" igual que el Excel: encabezados de la plantilla + la fila
  const lectura = leerFilasExcel([COLUMNAS_PLANTILLA.map((c) => c.encabezado), COLUMNAS_PLANTILLA.map((c) => fila[c.clave])])
  igual(lectura.error, null)
  igual(lectura.columnasDesconocidas, [], "desconocidas:")
  igual(lectura.columnasFaltantes, [], "faltantes:")
  const { filas, resumen } = analizarImportacion(lectura.filas, [p])
  igual(filas[0].errores, [], "errores:")
  igual(filas[0].cambios, [], "cambios:")
  igual(resumen.sin_cambios, 1)
  // proveedor vacío: plantilla vacía, tampoco cambia nada
  const vacio = proveedor()
  const filaVacia = filaPlantilla(vacio)
  const r2 = analizarImportacion(leerFilasExcel([COLUMNAS_PLANTILLA.map((c) => c.encabezado), COLUMNAS_PLANTILLA.map((c) => filaVacia[c.clave])]).filas, [vacio])
  igual(r2.filas[0].errores, []); igual(r2.filas[0].cambios, [])
  // todos los encabezados de la plantilla se reconocen y la ayuda tiene una línea por columna
  igual(COLUMNAS_PLANTILLA.map((c) => claveDeEncabezado(c.encabezado)), COLUMNAS_PLANTILLA.map((c) => c.clave))
  igual(ayudaPlantilla().filter((l) => l.length === 2).length, COLUMNAS_PLANTILLA.length + 1)
})
prueba("columna opcional Mixto: % con factura (Juan 17/11)", () => {
  igual(claveDeEncabezado("Mixto: % con factura"), "mixto_pct")
  igual(validarFila({ codigo: "134", mixto_pct: "70" }).valores.mixto_pct_factura, 70)
  igual(validarFila({ codigo: "134", mixto_pct: "70 %" }).valores.mixto_pct_factura, 70)
  igual(validarFila({ codigo: "134", mixto_pct: "150" }).errores.length, 1)
  igual(validarFila({ codigo: "134" }).valores.mixto_pct_factura, undefined)
})
prueba("los 28 encabezados del Excel se reconocen", () => {
  igual(ENCABEZADOS.map(claveDeEncabezado), CLAVES)
})
prueba("tolera que cambie o falte el texto entre paréntesis, acentos y mayúsculas", () => {
  igual(claveDeEncabezado("CODIGO"), "codigo")
  igual(claveDeEncabezado("Código (NO TOCAR nunca)"), "codigo")
  igual(claveDeEncabezado("blanco: dias de plazo (0 = contado)"), "blanco_dias")
  igual(claveDeEncabezado("NEGRO: plazo max del cheque"), "negro_plazo_cheque")
  igual(claveDeEncabezado("Acepta E-Cheq"), "acepta_echeq")
  igual(claveDeEncabezado("Retencion ganancias"), "ganancias")
  igual(claveDeEncabezado("Cualquier cosa"), null)
})
prueba("las columnas se reconocen por encabezado, no por posición", () => {
  const l = leerFilasExcel([["Observaciones", "CBU", "Código (no tocar)"], ["hola", "", "0134"], ["", "", ""]])
  igual(l.error, null)
  igual(l.filas, [{ fila: 2, codigo: "0134", observaciones: "hola" }])
  cierto(l.columnasFaltantes.includes("CUIT"), "tenía que avisar que falta CUIT")
})
prueba("sin la columna Código, error claro", () => {
  const l = leerFilasExcel([["Proveedor", "CBU"], ["X", "1"]])
  cierto(/Código/.test(l.error || ""), `error: ${l.error}`)
  igual(l.filas.length, 0)
})

console.log("\nValidación de una fila")
prueba("fila vacía (solo código y nombre) no cambia nada", () => {
  const v = validarFila({ fila: 2, codigo: "134", nombre: "ACORAZADO" })
  igual(v.errores, []); igual(v.valores, {})
  const lleno = proveedor({ cuit: "30-67949425-9", cbu: "0170099220000067797370", mail_oficina: "a@b.com", pago_blanco_dias: 30, pago_blanco_cuotas: "30/60", acepta_echeq: true, observaciones_compra: "algo" })
  igual(calcularCambios(v.valores, lleno), [])
})
prueba("código con ceros adelante se normaliza", () => {
  igual(validarFila({ fila: 2, codigo: "0134" }).codigo, "134")
  igual(columnasConError(validarFila({ fila: 2, cbu: "0170099220000067797370" })), ["Código"])
})
prueba("CBU: 22 dígitos, limpia espacios y guiones", () => {
  igual(validarFila({ fila: 2, codigo: "1", cbu: "0170099-2 2000006779737 0" }).valores.cbu, "0170099220000067797370")
})
prueba("CBU inválido (corto, o en notación científica de Excel)", () => {
  for (const cbu of ["12345", "2.85059E+21", "01700992200000677973701", "0170099220000067797A70"]) {
    const v = validarFila({ fila: 2, codigo: "1", cbu })
    igual(columnasConError(v), ["CBU"], cbu)
    cierto(/22 dígitos: poné la celda como texto/.test(v.errores[0].mensaje), v.errores[0].mensaje)
    igual(v.valores.cbu, undefined)
  }
})
prueba("CUIT válido se guarda con guiones; inválido es error", () => {
  igual(validarFila({ fila: 2, codigo: "1", cuit: "30679494259" }).valores.cuit, "30-67949425-9")
  igual(columnasConError(validarFila({ fila: 2, codigo: "1", cuit: "30-67949425-8" })), ["CUIT"])
  igual(columnasConError(validarFila({ fila: 2, codigo: "1", cuit: "30-6794942" })), ["CUIT"])
  const sinCuit = validarFila({ fila: 2, codigo: "1", cuit: "00-00000000-0" })
  igual(sinCuit.errores, []); igual(sinCuit.valores, {})
})
prueba('cuotas "30/60/90": cuotas + días = primera cuota', () => {
  const v = validarFila({ fila: 2, codigo: "1", blanco_dias: "30 / 60/90", negro_dias: "45" })
  igual(v.errores, [])
  igual(v.valores, { pago_blanco_dias: 30, pago_blanco_cuotas: "30/60/90", pago_negro_dias: 45, pago_negro_cuotas: null })
  igual(validarFila({ fila: 2, codigo: "1", blanco_dias: "0" }).valores, { pago_blanco_dias: 0, pago_blanco_cuotas: null })
  igual(validarFila({ fila: 2, codigo: "1", blanco_dias: "contado" }).valores.pago_blanco_dias, 0)
  igual(columnasConError(validarFila({ fila: 2, codigo: "1", blanco_dias: "400" })), ["BLANCO: días de plazo"])
  igual(columnasConError(validarFila({ fila: 2, codigo: "1", blanco_dias: "90/60" })), ["BLANCO: días de plazo"])
  igual(columnasConError(validarFila({ fila: 2, codigo: "1", negro_dias: "treinta" })), ["NEGRO: días de plazo"])
})
prueba("un plazo en días borra las cuotas viejas; sin cuotas viejas no figura como cambio", () => {
  const v = validarFila({ fila: 2, codigo: "134", blanco_dias: "30" })
  igual(calcularCambios(v.valores, proveedor({ pago_blanco_dias: 30 })), [])
  igual(calcularCambios(v.valores, proveedor({ pago_blanco_dias: 30, pago_blanco_cuotas: "30/60" })).map((c) => [c.campo, c.antes, c.despues]), [["pago_blanco_cuotas", "30/60", null]])
})
prueba("exento con fecha", () => {
  const v = validarFila({ fila: 2, codigo: "134", ganancias: "Exento", exento_hasta: "31/12/2026" })
  igual(v.errores, [])
  igual(v.valores, { condicion_ganancias: "exento", ganancias_exento_hasta: "2026-12-31" })
  const cambios = calcularCambios(v.valores, proveedor({ regimen_ganancias: "transporte" }))
  igual(cambios.map((c) => [c.campo, c.antes, c.despues]), [["condicion_ganancias", "inscripto", "exento"], ["ganancias_exento_hasta", null, "2026-12-31"]])
  igual(textoValor("ganancias_exento_hasta", "2026-12-31"), "31/12/2026")
  igual(columnasConError(validarFila({ fila: 2, codigo: "1", ganancias: "exento", exento_hasta: "31/13/2026" })), ["Exento: vence certificado"])
})
prueba("Ganancias: mercaderia / transporte; un exento que deja de serlo pasa a inscripto", () => {
  igual(validarFila({ fila: 2, codigo: "1", ganancias: "mercaderia 2%" }).valores, { regimen_ganancias: "bienes", condicion_ganancias: "inscripto" })
  igual(validarFila({ fila: 2, codigo: "1", ganancias: "2%" }).valores.regimen_ganancias, "bienes")
  igual(validarFila({ fila: 2, codigo: "1", ganancias: "Transporte 0,25%" }).valores, { regimen_ganancias: "transporte", condicion_ganancias: "inscripto" })
  const v = validarFila({ fila: 2, codigo: "134", ganancias: "transporte" })
  igual(calcularCambios(v.valores, proveedor({ condicion_ganancias: "exento" })).map((c) => [c.campo, c.despues]), [["regimen_ganancias", "transporte"], ["condicion_ganancias", "inscripto"]])
  // un "no inscripto" no se toca desde el Excel
  igual(calcularCambios(v.valores, proveedor({ condicion_ganancias: "no_inscripto" })).map((c) => c.campo), ["regimen_ganancias"])
})
prueba("fecha de certificado sin ser exento: aviso y no se guarda", () => {
  const v = validarFila({ fila: 2, codigo: "134", ganancias: "mercaderia", exento_hasta: "31/12/2026" })
  igual(v.errores, []); igual(v.avisos.length, 1); igual(v.valores.ganancias_exento_hasta, undefined)
  const { filas } = analizarImportacion([{ fila: 2, codigo: "134", exento_hasta: "31/12/2026" }], [proveedor()])
  igual(filas[0].estado, "sin_cambios"); igual(filas[0].avisos.length, 1)
  const exento = analizarImportacion([{ fila: 2, codigo: "134", exento_hasta: "31/12/2026" }], [proveedor({ condicion_ganancias: "exento" })])
  igual(exento.filas[0].cambios.map((c) => c.campo), ["ganancias_exento_hasta"])
})
prueba("valores fuera de lista", () => {
  const v = validarFila({
    fila: 2, codigo: "1", tipo: "ferretería", blanco_medio: "bitcoin", blanco_desde: "pedido", blanco_entrega: "paloma",
    blanco_plazo_cheque: "999", negro_medio: "pagaré", acepta_cheques_terceros: "a veces", acepta_echeq: "quizás",
    ganancias: "no sé", dias_entrega: "3,5", alias: "corto", mail_oc: "ventas@x.com; sin-arroba", mail_admin: "a@b.com, c@d.com",
  })
  igual(columnasConError(v).sort(), [
    "Acepta cheques de terceros", "Acepta e-cheq", "Alias", "BLANCO: cómo se entrega", "BLANCO: desde", "BLANCO: medio de pago",
    "BLANCO: plazo máx. del cheque", "Días que tarda en entregar", "Mail de administración / cobranzas",
    "Mail para enviar la orden de compra", "NEGRO: medio de pago", "Retención Ganancias", "Tipo",
  ].sort())
  igual(v.valores, {})
})
prueba("valores aceptados con otra escritura", () => {
  const v = validarFila({
    fila: 2, codigo: "1", tipo: "Mercadería", blanco_medio: "Cheque", negro_medio: "E-cheq", blanco_desde: "Recepción",
    blanco_entrega: "retira oficina", negro_entrega: "Depósito bancario", blanco_plazo_cheque: "60 días",
    acepta_cheques_terceros: "Sí", acepta_echeq: "N", mail_oc: "Ventas@X.com ; compras@x.com", mail_admin: " ADMIN@X.COM ",
    alias: "mi.alias-01", dias_entrega: "7", telefono_vendedor: "2914028245  MATIAS", observaciones: "Entrega los martes",
  })
  igual(v.errores, [])
  igual(v.valores, {
    tipo_proveedor: "mercaderia_general", mail_ordenes_compra: "ventas@x.com, compras@x.com", mail_oficina: "admin@x.com",
    telefono_vendedor: "2914028245 MATIAS", observaciones_compra: "Entrega los martes", cbu_alias: "mi.alias-01",
    pago_blanco_medio: "cheques", pago_blanco_desde: "recepcion", pago_blanco_plazo_cheque: 60, pago_blanco_entrega: "retira_oficina",
    pago_negro_medio: "echeq", pago_negro_entrega: "deposito_bancario",
    acepta_cheques_terceros: true, acepta_echeq: false, dias_entrega: 7,
  })
  igual(validarFila({ fila: 2, codigo: "1", blanco_medio: "cheques y efectivo" }).valores.pago_blanco_medio, "cheques_y_efectivo")
  igual(validarFila({ fila: 2, codigo: "1", tipo: "servicio" }).valores.tipo_proveedor, "servicios")
})

console.log("\nTodo el Excel contra la base")
prueba("solo figura lo que cambia, y el UPDATE lleva solo esas columnas", () => {
  const p = proveedor({ cuit: "30-67949425-9", tipo_proveedor: "mercaderia_general", pago_blanco_dias: 30, pago_blanco_desde: "factura", acepta_echeq: false })
  const { filas, resumen } = analizarImportacion([{ fila: 2, codigo: "134", nombre: "Acorazado SA", cuit: "30679494259", tipo: "mercaderia", blanco_dias: "30", blanco_desde: "factura", acepta_echeq: "si", cbu: "0170099220000067797370" }], [p])
  igual(resumen, { total: 1, con_cambios: 1, sin_cambios: 0, con_errores: 0, no_existen: 0 })
  igual(filas[0].avisos, [])
  igual(updateDeCambios(filas[0].cambios), { cbu: "0170099220000067797370", acepta_echeq: true })
  igual(filas[0].proveedor_id, "id-1")
})
prueba("código repetido en el Excel: error en las dos filas", () => {
  const { filas, resumen } = analizarImportacion([
    { fila: 2, codigo: "134", banco: "Nación" }, { fila: 3, codigo: "246", banco: "Galicia" }, { fila: 4, codigo: "0134", banco: "Provincia" },
  ], [proveedor(), proveedor({ id: "id-2", codigo_proveedor: "246", nombre: "AEROSOLES" })])
  igual(filas.map((f) => f.estado), ["error", "cambios", "error"])
  cierto(filas[0].errores[0].mensaje.includes("filas 2 y 4") && filas[2].errores[0].mensaje.includes("filas 2 y 4"), filas[0].errores[0].mensaje)
  igual(resumen.con_errores, 2); igual(resumen.con_cambios, 1)
})
prueba("código que no existe: error, no crea", () => {
  const { filas, resumen } = analizarImportacion([{ fila: 2, codigo: "999", nombre: "NUEVO", banco: "Nación" }], [proveedor()])
  igual(filas[0].estado, "no_existe"); igual(filas[0].proveedor_id, null)
  igual(resumen, { total: 1, con_cambios: 0, sin_cambios: 0, con_errores: 1, no_existen: 1 })
})
prueba("una fila con error no se importa aunque tenga cambios buenos", () => {
  const { filas } = analizarImportacion([{ fila: 2, codigo: "134", banco: "Nación", cbu: "123" }], [proveedor()])
  igual(filas[0].estado, "error")
  igual(filas[0].cambios.map((c) => c.campo), ["banco_nombre"])
})
prueba("un dato inválido que el sistema ya tenía igual es aviso, no error", () => {
  const p = proveedor({ cuit: "20111111", mail_oficina: "viejo@malo" })
  const { filas } = analizarImportacion([{ fila: 2, codigo: "134", cuit: "20111111", mail_admin: "VIEJO@MALO", banco: "Nación" }], [p])
  igual(filas[0].estado, "cambios"); igual(filas[0].errores, []); igual(filas[0].avisos.length, 2)
  igual(filas[0].cambios.map((c) => c.campo), ["banco_nombre"])
  igual(analizarImportacion([{ fila: 2, codigo: "134", cuit: "20111112" }], [p]).filas[0].estado, "error")
})
prueba("nombre distinto al del sistema: aviso, no error, y no se modifica", () => {
  const { filas } = analizarImportacion([{ fila: 2, codigo: "134", nombre: "PINTURERIA LOPEZ", banco: "Nación" }], [proveedor()])
  igual(filas[0].estado, "cambios"); igual(filas[0].avisos.length, 1)
  cierto(!filas[0].cambios.some((c) => c.campo === "nombre"), "no tiene que tocar el nombre")
  cierto(nombresParecidos("AEROSOLES Y SERVICIOS SA", "Aerosoles y Servicios S.A."), "parecidos")
  cierto(nombresParecidos("ARNANUK S.A", "ARNANUK"), "parecidos 2")
  cierto(!nombresParecidos("ALGABO", "BARACK"), "distintos")
})

// ─── Excel real de ejemplo (solo si existe) ─────────────────────────────────
const candidatos = [
  process.argv[2] ? resolve(process.argv[2]) : null,
  join(RAIZ, "docs/entrada/proveedores-para-completar.xlsx"),
  join(RAIZ, "../../../docs/entrada/proveedores-para-completar.xlsx"), // desde un worktree en .claude/worktrees/
].filter(Boolean)
const excel = candidatos.find((p) => existsSync(p))
console.log("\nExcel de ejemplo")
if (!excel) {
  console.log("  (no está docs/entrada/proveedores-para-completar.xlsx: se saltea; se puede pasar la ruta como argumento)")
} else {
  prueba(`se lee ${excel}`, () => {
    const XLSX = createRequire(import.meta.url)("xlsx")
    const libro = XLSX.readFile(excel, { cellNF: true })
    const hoja = libro.Sheets[libro.SheetNames.find((n) => n.trim().toLowerCase() === "proveedores") ?? libro.SheetNames[0]]
    const lectura = leerFilasExcel(XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" }))
    igual(lectura.error, null)
    igual(lectura.columnasDesconocidas, [], "columnas desconocidas:")
    // plantilla anterior: se acepta; lo que no trae se informa y no se modifica
    igual(lectura.columnasFaltantes, ["Mixto: % con factura", "Descuentos: cómo se aplican", "Percepción IVA %", "Percepción IIBB %"], "columnas faltantes:")
    // Sin base: se compara contra proveedores "vacíos" con los mismos códigos, para ver qué traería cada fila
    const vacios = [...new Set(lectura.filas.map((f) => validarFila(f).codigo).filter(Boolean))]
      .map((codigo, i) => proveedor({ id: `id-${i}`, codigo_proveedor: codigo, nombre: lectura.filas.find((f) => validarFila(f).codigo === codigo)?.nombre ?? "" }))
    const { filas, resumen } = analizarImportacion(lectura.filas, vacios)
    console.log(`      filas con datos: ${lectura.filas.length}`)
    console.log(`      resumen (contra proveedores vacíos): ${JSON.stringify(resumen)}`)
    const porCampo = {}
    for (const f of filas) for (const c of f.cambios) porCampo[c.etiqueta] = (porCampo[c.etiqueta] || 0) + 1
    console.log(`      datos que trae, por campo: ${JSON.stringify(porCampo)}`)
    const conError = filas.filter((f) => f.errores.length > 0)
    for (const f of conError.slice(0, 20)) console.log(`      fila ${f.fila} (cód. ${f.codigo}): ${f.errores.map((e) => `${e.columna}: ${e.mensaje}`).join(" · ")}`)
    if (conError.length > 20) console.log(`      … y ${conError.length - 20} filas más con error`)
    igual(resumen.no_existen, 0)
  })
}

console.log(`\n${mal === 0 ? "✓" : "✗"} test-importar-proveedores: ${ok} bien, ${mal} mal\n`)
process.exit(mal === 0 ? 0 : 1)
