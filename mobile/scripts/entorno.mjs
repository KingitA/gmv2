// Detección del toolchain Android en Windows (o Linux/WSL). Ver MOBILE.md → "Entorno de build".
import { existsSync, readdirSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"

const WIN = platform() === "win32"

export function javaHome() {
  const candidatos = [
    process.env.JAVA_HOME,
    WIN && "C:\\Program Files\\Android\\Android Studio\\jbr",
    !WIN && "/opt/android-studio/jbr",
    !WIN && join(homedir(), "android-studio/jbr"),
  ].filter(Boolean)
  const ok = candidatos.find((p) => existsSync(join(p, "bin", WIN ? "java.exe" : "java")))
  if (!ok) throw new Error("No encuentro un JDK 21. Instalá Android Studio o seteá JAVA_HOME (ver MOBILE.md).")
  return ok
}

export function androidHome() {
  const candidatos = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    WIN && process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"),
    !WIN && join(homedir(), "Android", "Sdk"),
  ].filter(Boolean)
  const ok = candidatos.find((p) => existsSync(join(p, "platforms")))
  if (!ok) throw new Error("No encuentro el Android SDK. Seteá ANDROID_HOME (ver MOBILE.md).")
  return ok
}

export function herramienta(sdk, nombre) {
  const bt = join(sdk, "build-tools")
  const versiones = readdirSync(bt).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const v of versiones) {
    const p = join(bt, v, WIN ? `${nombre}.bat` : nombre)
    if (existsSync(p)) return p
  }
  throw new Error(`No encuentro ${nombre} en ${bt}`)
}

export function adb(sdk) {
  return join(sdk, "platform-tools", WIN ? "adb.exe" : "adb")
}

export function directorioKeystores() {
  return process.env.GM_KEYSTORES_DIR || join(homedir(), ".gm-keystores")
}


export const ES_WINDOWS = WIN
