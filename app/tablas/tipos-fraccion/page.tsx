import { CatalogoArticuloABM } from "@/components/tablas/CatalogoArticuloABM"

export default function TiposFraccionPage() {
  return (
    <CatalogoArticuloABM
      tabla="tipos_fraccion"
      columnaArticulo="tipo_fraccion"
      titulo="Tipos de Fracción"
      subtitulo="Opciones del campo Tipo de fracción de la ficha de artículo (PACK, BLISTER, DOCENA…)"
      singular="tipo de fracción"
      placeholderNombre="Ej: BLISTER"
    />
  )
}
