// Select + mapeo de artículos para la app del vendedor — compartido entre
// /api/vendedor/articulos y /api/vendedor/buscar-foto (misma shape que
// consume ArticuloCard en el catálogo).

export const ARTICULO_SELECT =
  "id, sku, ean13, descripcion, unidades_por_bulto, tipo_fraccion, cantidad_fraccion, stock_actual, stock_reservado, descuento_propio, iva_ventas, imagen_url, rubro_id, categoria_id, subcategoria_id, rubro, categoria, subcategoria, marca:marca_id(descripcion), proveedor:proveedor_id(nombre), rubro_info:rubro_id(nombre), categoria_info:categoria_id(nombre), subcategoria_info:subcategoria_id(nombre)"

export function mapArticuloVendedor(a: any, extra: Record<string, any> = {}) {
  return {
    id: a.id,
    sku: a.sku,
    ean13: a.ean13,
    descripcion: a.descripcion,
    unidades_por_bulto: a.unidades_por_bulto,
    tipo_fraccion: a.tipo_fraccion || null,
    cantidad_fraccion: a.cantidad_fraccion || null,
    stock_disponible: Math.max(0, (a.stock_actual || 0) - (a.stock_reservado || 0)),
    descuento_propio: a.descuento_propio || 0,
    iva_ventas: a.iva_ventas,
    marca: a.marca?.descripcion || null,
    proveedor: a.proveedor?.nombre || null,
    imagen_url: a.imagen_url || null,
    rubro_id: a.rubro_id || null,
    categoria_id: a.categoria_id || null,
    subcategoria_id: a.subcategoria_id || null,
    // Fallback al texto legado: los artículos nuevos traen categoria/subcategoria
    // como texto pero sin FK hasta que corra el backfill — sin esto el catálogo
    // del vendedor los agrupa a todos como "Otros".
    rubro_nombre: a.rubro_info?.nombre || a.rubro || null,
    categoria_nombre: a.categoria_info?.nombre || a.categoria || null,
    subcategoria_nombre: a.subcategoria_info?.nombre || a.subcategoria || null,
    ...extra,
  }
}
