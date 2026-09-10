import { CatalogoArticuloABM } from "@/components/tablas/CatalogoArticuloABM"

export default function TiposBultoPage() {
  return (
    <CatalogoArticuloABM
      tabla="tipos_bulto"
      columnaArticulo="unidad_de_medida"
      titulo="Tipos de Bulto"
      subtitulo="Opciones del campo Tipo de bulto de la ficha de artículo (UN, BULTO, CAJA, PACK…)"
      singular="tipo de bulto"
      placeholderNombre="Ej: CAJA"
    />
  )
}
