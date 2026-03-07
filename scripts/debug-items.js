const fs = require('fs');
const x = require('xlsx');

const rawT = fs.readFileSync('gemmap.json', 'utf8');
const validJsonString = rawT.split('=========================================')[0];
const r = JSON.parse(validJsonString);
const w = x.readFile('test226.xlsx');
let logs = [];
let totalExtracted = 0;

r.sheets.forEach(s => {
    const sh = w.Sheets[s.sheetName];
    if (!sh) return;
    const rs = x.utils.sheet_to_json(sh, { header: 1 });
    rs.forEach((row, ri) => {
        s.panels.forEach((p, pi) => {
            let q = 0;
            p.quantityColumns.forEach(c => {
                let v = String(row[c] || '').trim();
                // Avoid "pedidos .1..." format issue
                if ((v.match(/\./g) || []).length > 1) return;
                v = v.replace(',', '.');
                let n = parseFloat(v);
                if (!isNaN(n) && n > 0 && !(n > 500 && v.includes('.'))) {
                    q += n;
                }
            });

            if (q > 0) {
                const desc = row[p.descriptionIdx];
                if (desc && String(desc).trim() !== "") {
                    // It has a description and a valid quantity
                    const descStr = String(desc).trim();
                    const lowerDesc = descStr.toLowerCase();
                    if (lowerDesc !== "item" && lowerDesc !== "descripción" && descStr !== "0.1" && descStr !== "0") {
                        logs.push(`EXTRACTED: [${s.sheetName} Panel ${pi} Row ${ri + 1}] ${descStr} = ${q}`);
                        totalExtracted++;
                    } else {
                        logs.push(`REJECTED AS HEADER: [${s.sheetName} Panel ${pi} Row ${ri + 1}] ${descStr} = ${q}`);
                    }
                } else {
                    logs.push(`MISSING DESC: [${s.sheetName} Panel ${pi} Row ${ri + 1}] descIdx=${p.descriptionIdx} => quantity=${q}`);
                }
            }
        });
    });
});

logs.unshift(`TOTAL EXTRACTED: ${totalExtracted}`);
fs.writeFileSync('items-debug.log', logs.join('\n'));
console.log('Done mapping items. Extracted:', totalExtracted);
