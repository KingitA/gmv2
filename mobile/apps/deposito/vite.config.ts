import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { configApp } from "../../vite.app"

export default configApp(dirname(fileURLToPath(import.meta.url)), 5175)
