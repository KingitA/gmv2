#!/usr/bin/env node
// Un comando → los APKs release firmados de las apps pedidas.
//
//   cd mobile
//   npm run build:apks -- --notas "Picking con lector"            (las 3, versión patch+1)
//   npm run build:apks -- --apps chofer --bump minor --notas "..."
//   npm run build:apks -- --apps chofer --bump none               (recompilar misma versión)
//   npm run build:apks -- --apps chofer --debug                   (APK debug, sin firma release)
//
// Por app: typecheck → vite build → cap sync → gradle assembleRelease → apksigner verify
// → <repo>/dist-apks/<app>-v<versionName>.apk + entrada en apps/<app>/CHANGELOG.md.
// versionCode SIEMPRE sube en 1 (Android exige que crezca para actualizar encima).
// Si algo falla, version.json vuelve a como estaba.

import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { androidHome, directorioKeystores, ES_WINDOWS, herramienta, javaHome } from "./entorno.mjs"

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const REPO = resolve(MOBILE, "..")
const SALIDA = join(REPO, "dist-apks")
const TODAS = ["vendedor", "chofer", "deposito"]

// ─── Argumentos ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const arg = (n, def) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : def
}
const apps = (arg("apps", TODAS.join(",")) || "").split(",").map((s) => s.trim()).filter(Boolean)
const bump = arg("bump", "patch")
const notas = arg("notas", "")
const debug = args.includes("--debug")
/** Diagnóstico de un equipo ya instalado: abre el socket de DevTools del WebView. */
const devtools = args.includes("--devtools")
for (const a of apps) if (!TODAS.includes(a)) throw new Error(`App desconocida: ${a}`)
if (!["patch", "minor", "major", "none"].includes(bump)) throw new Error(`--bump inválido: ${bump}`)

// ─── Entorno ────────────────────────────────────────────────────────────────
const JAVA_HOME = javaHome()
const ANDROID_HOME = androidHome()
const env = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME }
delete env.GM_DEV_HTTP // un release jamás lleva allowMixedContent
delete env.GM_DEBUG_WEBVIEW // ni DevTools abierto, salvo que se pida con --devtools
if (devtools) env.GM_DEBUG_WEBVIEW = "1"
env.PATH = `${join(JAVA_HOME, "bin")}${ES_WINDOWS ? ";" : ":"}${env.PATH}`

function run(cmd, argv, cwd) {
  console.log(`  $ ${cmd} ${argv.join(" ")}`)
  // En Windows hace falta shell (npx/.bat); con shell hay que citar rutas con espacios
  const q = (s) => (ES_WINDOWS && /\s/.test(s) ? `"${s}"` : s)
  execFileSync(q(cmd), argv.map(q), { cwd, env, stdio: "inherit", shell: ES_WINDOWS })
}

function subirVersion(v, tipo) {
  const [ma, mi, pa] = v.split(".").map((n) => parseInt(n, 10) || 0)
  if (tipo === "major") return `${ma + 1}.0.0`
  if (tipo === "minor") return `${ma}.${mi + 1}.0`
  if (tipo === "patch") return `${ma}.${mi}.${pa + 1}`
  return v
}

mkdirSync(SALIDA, { recursive: true })
const resultados = []

for (const app of apps) {
  console.log(`\n══ ${app} ══`)
  const dir = join(MOBILE, "apps", app)
  const android = join(dir, "android")
  const fVersion = join(dir, "version.json")
  const original = readFileSync(fVersion, "utf8")
  const ver = JSON.parse(original)
  const nueva = { versionCode: ver.versionCode + 1, versionName: subirVersion(ver.versionName, bump) }
  if (!debug) {
    const props = process.env.GM_KEYSTORE_PROPS || join(directorioKeystores(), `${app}.properties`)
    if (!existsSync(props)) throw new Error(`Falta ${props}. Corré primero: npm run keystores`)
  }

  writeFileSync(fVersion, JSON.stringify(nueva, null, 2) + "\n")
  try {
    writeFileSync(join(android, "local.properties"), `sdk.dir=${ANDROID_HOME.replace(/\\/g, "/")}\n`)
    run("npx", ["tsc", "--noEmit", "-p", "."], dir)
    run("npx", ["vite", "build"], dir)
    run("npx", ["cap", "sync", "android"], dir)
    const gradlew = join(android, ES_WINDOWS ? "gradlew.bat" : "gradlew")
    run(gradlew, [debug ? "assembleDebug" : "assembleRelease", "--no-daemon", "-q"], android)

    const apk = debug
      ? join(android, "app/build/outputs/apk/debug/app-debug.apk")
      : join(android, "app/build/outputs/apk/release/app-release.apk")
    if (!existsSync(apk)) throw new Error(`Gradle no generó ${apk}`)
    if (!debug) run(herramienta(ANDROID_HOME, "apksigner"), ["verify", "--print-certs", apk], android)

    const destino = join(SALIDA, `${app}-v${nueva.versionName}${debug ? "-debug" : ""}.apk`)
    copyFileSync(apk, destino)
    if (!debug) {
      const fLog = join(dir, "CHANGELOG.md")
      const log = readFileSync(fLog, "utf8")
      const fecha = new Date().toISOString().slice(0, 10)
      const entrada = `## v${nueva.versionName} (versionCode ${nueva.versionCode}) — ${fecha}\n\n${notas ? `- ${notas}\n` : "- (sin notas)\n"}\n`
      const corte = log.search(/^## /m)
      writeFileSync(fLog, corte >= 0 ? log.slice(0, corte) + entrada + log.slice(corte) : log.trimEnd() + "\n\n" + entrada)
    } else {
      writeFileSync(fVersion, original) // debug no consume versión
    }
    resultados.push({ app, version: nueva.versionName, code: nueva.versionCode, apk: destino })
  } catch (e) {
    writeFileSync(fVersion, original)
    console.error(`\n✗ ${app}: ${e.message}\n  version.json restaurado a ${ver.versionName} (${ver.versionCode}).`)
    process.exitCode = 1
  }
}

console.log("\n══ Resultado ══")
for (const r of resultados) console.log(`✓ ${r.app} v${r.version} (versionCode ${r.code}) → ${r.apk}`)
if (resultados.length && !debug) console.log("\nNo olvides commitear version.json y CHANGELOG.md de cada app.")
