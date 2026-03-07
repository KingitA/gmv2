import { processOrder } from "../lib/actions/ai-order-import"
import * as fs from "fs"
import * as path from "path"

async function run() {
    try {
        const filePath = path.join(process.cwd(), process.argv[2])
        const buffer = fs.readFileSync(filePath)
        console.log("Analyzing file:", filePath)

        const result = await processOrder(buffer, path.basename(filePath), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

        console.log("==== FINAL RESULT ====")
        console.log(JSON.stringify(result, null, 2))
    } catch (e) {
        console.error("Error during analysis:", e)
    }
}

run()
