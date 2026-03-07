import * as XLSX from "xlsx"

export interface ItemFactura {
  codigo: string
  sigla: string
  descripcion: string
  cantidad: number
  precioLista: number
  bon1: number
  bon2: number
  bon3: number
  bon4: number
  recargo: number
}

export interface DatosFactura {
  periodo: string // AAAA/MM
  codProv: string
  nomProv: string
  tipoIva: number
  cuit: string
  fechaFac: string
  fechaVto: string
  tipoMov: string // D018, C020, D036
  nroComp: string
  condicion: string // CC o E
  items: ItemFactura[]
  subtotal: number
  iva21: number
  retIB: number
  retIVA: number
  retGan: number
  excento: number
  total: number
}

export function generarExcelDJGestion(datos: DatosFactura): Blob {
  const rows: any[] = []

  // Filas de items
  datos.items.forEach((item) => {
    const prcosto =
      item.precioLista *
      (1 - item.bon1 / 100) *
      (1 - item.bon2 / 100) *
      (1 - item.bon3 / 100) *
      (1 - item.bon4 / 100) *
      (1 + item.recargo / 100)
    const subtotalItem = prcosto * item.cantidad

    rows.push({
      TITULOS: "item",
      PERFISCAL: datos.periodo,
      CODPROV: datos.codProv,
      NOMPROV: datos.nomProv,
      TIPOIVA: datos.tipoIva,
      CUIT: datos.cuit,
      FECHAFAC: datos.fechaFac,
      FECHAVTO: datos.fechaVto,
      TM: datos.tipoMov,
      NROCOMP: datos.nroComp,
      SUBDIARIO: "501",
      CENTROCOSTO: "1",
      CONDICION: datos.condicion,
      CODIGO: item.codigo,
      SIGLA: item.sigla,
      DESCRIPCION: item.descripcion,
      PRLISTA: item.precioLista,
      "%BON1": item.bon1,
      "%BON2": item.bon2,
      "%BON3": item.bon3,
      "%BON4": item.bon4,
      "%RECARGO": item.recargo,
      PRCOSTO: prcosto,
      CANTIDAD: item.cantidad,
      SUBTOTAL: subtotalItem,
      IVA21: "",
      RETIB: "",
      RETIVA: "",
      RETGAN: "",
      EXCENTO: "",
      TOTAL: "",
    })
  })

  // Fila de importes (totales)
  rows.push({
    TITULOS: "importes",
    PERFISCAL: datos.periodo,
    CODPROV: datos.codProv,
    NOMPROV: datos.nomProv,
    TIPOIVA: datos.tipoIva,
    CUIT: datos.cuit,
    FECHAFAC: datos.fechaFac,
    FECHAVTO: datos.fechaVto,
    TM: datos.tipoMov,
    NROCOMP: datos.nroComp,
    SUBDIARIO: "501",
    CENTROCOSTO: "1",
    CONDICION: datos.condicion,
    CODIGO: "",
    SIGLA: "",
    DESCRIPCION: "",
    PRLISTA: "",
    "%BON1": "",
    "%BON2": "",
    "%BON3": "",
    "%BON4": "",
    "%RECARGO": "",
    PRCOSTO: "",
    CANTIDAD: "",
    SUBTOTAL: datos.subtotal,
    IVA21: datos.iva21,
    RETIB: datos.retIB,
    RETIVA: datos.retIVA,
    RETGAN: datos.retGan,
    EXCENTO: datos.excento,
    TOTAL: datos.total,
  })

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Factura")

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" })
  return new Blob([wbout], { type: "application/octet-stream" })
}
