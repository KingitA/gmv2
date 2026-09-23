// Reglas PURAS del flujo de foto de cheques (OCR + Central de Deudores del BCRA).
// Frontera del alias @gm/cheques: lo usan el ERP web (rutas y páginas), la app
// vendedor y los tests del core móvil. Solo módulos sin dependencias de runtime.
//
// Principio: NADA extraído por el OCR se muestra sin validar acá. Lo que no
// valida queda vacío y el operario lo carga a mano (nunca un dato inventado).

export * from "./validar"
export * from "./fila"
export * from "./bcra"
