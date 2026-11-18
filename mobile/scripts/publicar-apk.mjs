#!/usr/bin/env node
// Publica una APK ya compilada para que las apps se actualicen solas (botón ACTUALIZAR).
// Ver MOBILE.md → "Actualización desde la app".
//
//   npm run publicar:apk -- --app vendedor [--obligatoria] [--notas "…"] [--version 0.4.13]
//
// - Toma dist-apks/<app>-v<version>.apk (por defecto la versión de apps/<app>/version.json).
// - La sube al bucket PRIVADO "apks" con la service key de .env.local (nunca va en el APK).
// - Inserta la fila en mobile_versiones (versionCode, sha256, tamaño, notas, obligatoria).
// Compilar (npm run build:apks) NO publica: publicar es una decisión aparte.
// Revertir = recompilar la versión anterior (sube el versionCode) y publicarla.

import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const MOBILE = resolve(AQUI, "..")
const RAIZ = resolve(MOBILE, "..")
const APPS = ["vendedor", "chofer", "deposito"]

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (nombre) => process.argv.includes(`--${nombre}`)
const fallar = (m) => {
  console.error(`✗ ${m}`)
  process.exit(1)
}

const app = arg("app")
if (!APPS.includes(app)) fallar(`--app tiene que ser ${APPS.join(" | ")}`)
const obligatoria = flag("obligatoria")
const notas = (arg("notas") || "").trim() || null

// Versión: la del version.json de la app (= la última compilada) salvo --version
const ver = JSON.parse(readFileSync(resolve(MOBILE, "apps", app, "version.json"), "utf8"))
const versionName = arg("version") || ver.versionName
if (arg("version") && arg("version") !== ver.versionName) {
  fallar(`--version ${arg("version")} no es la de apps/${app}/version.json (${ver.versionName}): el versionCode no se puede saber. Publicá la última compilada.`)
}
const versionCode = Number(ver.versionCode)
const apk = resolve(RAIZ, "dist-apks", `${app}-v${versionName}.apk`)
if (!existsSync(apk)) fallar(`No existe ${apk}. Compilala primero: npm run build:apks -- --apps ${app}`)

const bytes = readFileSync(apk)
const sha256 = createHash("sha256").update(bytes).digest("hex")
const tamano = statSync(apk).size

// Service key SOLO de .env.local (nunca commiteada, nunca en el APK)
const envPath = resolve(RAIZ, ".env.local")
if (!existsSync(envPath)) fallar("Falta .env.local en la raíz del repo")
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
)
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) fallar("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local")
const { createClient } = createRequire(resolve(RAIZ, "package.json"))("@supabase/supabase-js")
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Nunca una versión igual o más vieja que la última publicada (la app no la ofrecería)
const { data: ultima, error: eUlt } = await sb
  .from("mobile_versiones")
  .select("version_name, version_code")
  .eq("app", app)
  .order("version_code", { ascending: false })
  .limit(1)
  .maybeSingle()
if (eUlt) fallar(`No se pudo leer mobile_versiones (¿falta aplicar la migración 20261117b_mobile_versiones.sql?): ${eUlt.message}`)
if (ultima && ultima.version_code >= versionCode) {
  fallar(`Ya está publicada la v${ultima.version_name} (versionCode ${ultima.version_code}). Para publicar esta hay que compilarla con un versionCode mayor.`)
}

const archivo = `${app}/${app}-v${versionName}-${versionCode}.apk`
console.log(`› Subiendo ${app} v${versionName} (versionCode ${versionCode}, ${(tamano / 1_048_576).toFixed(1)} MB) a apks/${archivo}…`)
const { error: eSub } = await sb.storage.from("apks").upload(archivo, bytes, { contentType: "application/vnd.android.package-archive", upsert: true })
if (eSub) fallar(`No se pudo subir el APK: ${eSub.message}`)

const { error: eIns } = await sb.from("mobile_versiones").insert({
  app,
  version_name: versionName,
  version_code: versionCode,
  archivo,
  tamano_bytes: tamano,
  sha256,
  notas,
  obligatoria,
  publicada_por: process.env.USERNAME || process.env.USER || null,
})
if (eIns) fallar(`Se subió el APK pero no se registró la versión: ${eIns.message}`)

console.log(`✓ Publicada ${app} v${versionName} (versionCode ${versionCode})${obligatoria ? " — OBLIGATORIA" : ""}`)
console.log(`  sha256 ${sha256}`)
console.log("  Los equipos la ofrecen en el inicio al abrir la app, al volver a ella o en ≤ 30 min.")
