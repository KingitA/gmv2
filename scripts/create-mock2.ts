import * as xlsx from 'xlsx';
import * as fs from 'fs';

const wb = xlsx.utils.book_new();

// HOJA 1 - MULTIPANEL (como en la captura 1)
const ws1Data = [
    ["HOJA 1", "", "", "", "", "NECO", "", "", "", "PEDIDO", "PEDIDO", "", "", "", "", "", "NECO", "", "", "PEDIDO", "PEDIDO"],
    ["3-feb", "ITEM", "COD", "Bulto", "Cta Cte", "FINAL", ".1...", ".2...", "", "ITEM", "COD", "Bulto", "Cta Cte", "FINAL", ".1...", ".2..."],
    ["", "MICROFIBRAS", "", "", "", "", "", "", "", "MICROFIBRAS"],
    ["LAFFITTE", "SECAV MANGO METAL", "030333", 24, "7116,78", "6405,10", "", "", "LAFFITTE", "MOPA RECTANG 41x12CM (20%)", "338613", 60, "7814,19", "7032,77", 6, ""],
    ["", "CEPILLERIA", "", "", "", "", "", "", "", "CEPILLERIA"],
    ["", "LINEA FIORENTINA", "", "", "", "", "", "", "", "LINEA FIORENTINA"],
    ["ESCOBILLON MARTINA (15%)", "", "000212", 12, "6834,71", "6151,24", "", "", "LIMPIAVIDRIOS DADO", "", "010112", 12, "8694,03", "7824,63", 3, ""],
    ["ESCOBILLON MARTINA C/GOMA(15%)", "", "000312", 12, "7792,00", "7012,80", "", "", "LIMPIAVIDRIOS VIP (C/cabo Extens)", "", "010212", 12, "13977,76", "12579,99", 3, ""],
];
const ws1 = xlsx.utils.aoa_to_sheet(ws1Data);
xlsx.utils.book_append_sheet(wb, ws1, "HOJA 1");

// SUIZA - PANEL UNICO CON RELLENO (como en la captura 2)
const ws2Data = [
    ["", "", "", "", "", "", ""],
    ["Código", "Descripción", "CANT", "Cta Cte", "FINAL", "PEDIDO", "PEDIDO"],
    ["", "Cera Suiza Pasta para madera", "", "", "", ".1...", ".2..."],
    ["070851", "R. CLARO X 450 CC (10%)", 6, "6638,38", "5974,54", 6, ""],
    ["", "Cera Suiza Líquida para madera", "", "", "", "", ""],
    ["071018", "ROBLE CLARO X 850 CC", 12, "6327,19", "5694,47", 6, ""],
];
const ws2 = xlsx.utils.aoa_to_sheet(ws2Data);
xlsx.utils.book_append_sheet(wb, ws2, "SUIZA");

// Guarda el archivo
xlsx.writeFile(wb, "test3.xlsx");
console.log("Mock generado en test3.xlsx");
