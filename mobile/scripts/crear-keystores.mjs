#!/usr/bin/env node
// Crea (una sola vez) los keystores de firma release de las 3 apps FUERA del repo:
//   ~/.gm-keystores/<app>.jks  +  ~/.gm-keystores/<app>.properties
// Nunca pisa uno existente: perder/cambiar un keystore obliga a desinstalar la app
// en cada handheld (Android rechaza actualizar con otra firma).
// Hacé BACKUP de ~/.gm-keystores (ver MOBILE.md → "Keystores").

import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { directorioKeystores, ES_WINDOWS, javaHome } from "./entorno.mjs"

const APPS = { vendedor: "gmvendedor", chofer: "gmchofer", deposito: "gmdeposito" }
const dir = directorioKeystores()
mkdirSync(dir, { recursive: true })
const keytool = join(javaHome(), "bin", ES_WINDOWS ? "keytool.exe" : "keytool")

for (const [app, alias] of Object.entries(APPS)) {
  const jks = join(dir, `${app}.jks`)
  const props = join(dir, `${app}.properties`)
  if (existsSync(jks)) {
    console.log(`✓ ${app}: ya existe ${jks} (no se toca)`)
    continue
  }
  const pass = randomBytes(24).toString("base64url")
  execFileSync(keytool, [
    "-genkeypair", "-v",
    "-keystore", jks,
    "-storetype", "PKCS12",
    "-alias", alias,
    "-keyalg", "RSA", "-keysize", "4096",
    "-validity", "10000",
    "-storepass", pass, "-keypass", pass,
    "-dname", `CN=GM ${app}, O=KingA Distribuciones, C=AR`,
  ], { stdio: "ignore" })
  writeFileSync(
    props,
    [`storeFile=${jks.replace(/\\/g, "/")}`, `storePassword=${pass}`, `keyAlias=${alias}`, `keyPassword=${pass}`, ""].join("\n"),
    { mode: 0o600 },
  )
  console.log(`✓ ${app}: creado ${jks} (alias ${alias})`)
}
console.log(`\nIMPORTANTE: copiá ${dir} a un lugar seguro. Sin esos archivos no se pueden publicar actualizaciones.`)
