import * as xlsx from "xlsx"

// Creando un excel dummy basado en la captura de pantalla
const wb = xlsx.utils.book_new()
const wsData = [
    ["cliente:", "ch zapiola", "", "", ""],
    ["HOJA 1", "", "", "PEDIDO", ""],
    ["3-feb", "ITEM", "COD", ".1...", ""],
    ["TRAPOS DE PISO", "", "", "", ""],
    ["BUEN", "GRIS", "079685", 12, ""],
    ["JULIETA", "GRIS", "000016", "", ""],
    ["M.NJA", "GRIS", "812901", 24, ""]
]
const ws = xlsx.utils.aoa_to_sheet(wsData)
xlsx.utils.book_append_sheet(wb, ws, "Sheet1")
xlsx.writeFile(wb, "test.xlsx")
console.log("Mock file created.")
