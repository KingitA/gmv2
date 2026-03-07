const fs = require('fs');
const x = require('xlsx');

const rawT = fs.readFileSync('gemmap.json', 'utf8');
const validJsonString = rawT.split('=========================================')[0];
const r = JSON.parse(validJsonString);
const w = x.readFile('test226.xlsx');

let geminiFound = new Set();
let allPossibleFound = new Set();
let diffLogs = [];

r.sheets.forEach(s => {
    const sh = w.Sheets[s.sheetName];
    if (!sh) return;
    const rs = x.utils.sheet_to_json(sh, { header: 1 });

    // Convert gemini mapped panels for fast lookup
    const geminiColsByPanel = s.panels.map(p => ({
        descIdx: p.descriptionIdx,
        qtyCols: new Set(p.quantityColumns)
    }));

    rs.forEach((row, ri) => {
        // Human fuzzy extract: If ANY column has a number > 0 and < 500, and there's text nearby, it might be an item.
        // But to make it comparing apples to apples, let's just see if Gemini's description column has a qty in ANY OTHER nearby column not marked by Gemini.

        s.panels.forEach((p, pi) => {
            const desc = row[p.descriptionIdx];
            if (!desc || String(desc).trim() === "") return;
            const descStr = String(desc).trim();
            const lowerDesc = descStr.toLowerCase();
            if (lowerDesc === "item" || lowerDesc === "descripción" || descStr === "0" || descStr === "0.1") return;

            let geminiQty = 0;
            p.quantityColumns.forEach(c => {
                let v = String(row[c] || '').trim();
                if ((v.match(/\./g) || []).length > 1) return;
                v = v.replace(',', '.');
                let n = parseFloat(v);
                if (!isNaN(n) && n > 0 && !(n > 500 && v.includes('.'))) {
                    geminiQty += n;
                }
            });

            if (geminiQty > 0) {
                geminiFound.add(`${s.sheetName}-${ri}-${descStr}`);
            }

            // Look at other columns in a window
            let otherQty = 0;
            let foundCol = -1;
            for (let c = p.descriptionIdx + 1; c < p.descriptionIdx + 15; c++) {
                if (c >= row.length) break;
                // Avoid checking Gemini cols
                if (p.quantityColumns.includes(c)) continue;

                let v = String(row[c] || '').trim();
                if ((v.match(/\./g) || []).length > 1) return;
                v = v.replace(',', '.');
                let n = parseFloat(v);
                if (!isNaN(n) && n > 0 && n < 500) {
                    otherQty += n;
                    foundCol = c;
                    break;
                }
            }

            if (geminiQty === 0 && otherQty > 0) {
                diffLogs.push(`MISSED BY GEMINI: [${s.sheetName} Row ${ri + 1}] ${descStr} -> Qty ${otherQty} was in column ${foundCol}. Gemini only checked [${p.quantityColumns.join(',')}]`);
            }
        });
    });
});

fs.writeFileSync('diff-debug.log', diffLogs.join('\n'));
console.log('Done mapping diff. Items missed by Gemini:', diffLogs.length);
