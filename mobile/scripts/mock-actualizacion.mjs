// Actualización con un botón en los mocks del ERP (mock-vendedor / mock-chofer / mock-deposito).
// Ver MOBILE.md → "Actualización desde la app".
//
//   POST /__mock/actualizacion?code=99&nombre=9.9.9[&obligatoria=1][&corrupto=1][&off=1]
//        publica (en memoria) una versión con ese versionCode; off=1 la saca.
//        corrupto=1: el APK que se baja no coincide con el sha256 (prueba el error).
//   GET  /api/mobile/actualizacion?app=X   (= la ruta real; compara el header X-App-Version-Code)
//   GET  /__mock/apk                       "APK" de 2 MB que se manda de a poco (se ve la barra)

import { createHash } from "node:crypto"

const APK = Buffer.alloc(2 * 1024 * 1024)
for (let i = 0; i < APK.length; i++) APK[i] = (i * 31 + 7) & 0xff
const SHA = createHash("sha256").update(APK).digest("hex")

let publicada = null // { code, nombre, obligatoria, corrupto }

/** true si atendió el request. */
export async function atenderActualizacion(url, req, res, json, cors) {
  if (url.pathname === "/__mock/actualizacion") {
    publicada = url.searchParams.get("off") === "1" ? null : {
      code: Number(url.searchParams.get("code") || 999),
      nombre: url.searchParams.get("nombre") || "9.9.9",
      obligatoria: url.searchParams.get("obligatoria") === "1",
      corrupto: url.searchParams.get("corrupto") === "1",
    }
    json(200, { ok: true, publicada })
    return true
  }
  if (url.pathname === "/__mock/apk") {
    const datos = publicada?.corrupto ? Buffer.concat([APK.subarray(0, APK.length - 1), Buffer.from([0])]) : APK
    res.writeHead(200, { ...cors, "Content-Type": "application/vnd.android.package-archive", "Content-Length": String(datos.length) })
    // De a 128 KB cada 80 ms (~1,3 s): se ve la barra de progreso
    for (let k = 0; k < datos.length; k += 128 * 1024) {
      res.write(datos.subarray(k, k + 128 * 1024))
      await new Promise((r) => setTimeout(r, 80))
    }
    res.end()
    return true
  }
  if (url.pathname === "/api/mobile/actualizacion") {
    const code = Number(req.headers["x-app-version-code"]) || null
    if (!publicada || (code != null && publicada.code <= code)) {
      json(200, { hay: false, version_name: null, version_code: null, notas: null, obligatoria: false, tamano_bytes: null, sha256: null, url: null })
      return true
    }
    const host = req.headers.host || "localhost"
    json(200, {
      hay: true,
      version_name: publicada.nombre,
      version_code: publicada.code,
      notas: "Versión de prueba del mock.",
      obligatoria: publicada.obligatoria,
      tamano_bytes: APK.length,
      sha256: SHA,
      url: `http://${host}/__mock/apk?v=${publicada.code}`,
    })
    return true
  }
  return false
}
