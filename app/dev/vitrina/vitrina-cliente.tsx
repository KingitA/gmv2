"use client"

// Datos de ejemplo (no tocan la base). Ver page.tsx.
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FichaArticulo } from "@/components/articulos/ficha-articulo"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { FichaProveedor } from "@/components/proveedores/ficha-proveedor"
import { ClientesDemo } from "./clientes-demo"
import { Dialog, DialogContent } from "@/components/ui/dialog"

const FF_EJEMPLO = {
  descripcion: "FIBRA ABRASIVA VERDE x2u", sku: "33701", ean13: ["7794440003372"], unidades_por_bulto: 24, unidad_de_medida: "PACK",
  marca_id: "m1", categoria: "ESPONJAS Y ESTROPAJOS", subcategoria: "ESPONJAS DE ACERO Y METAL", rubro: "Limpieza", rubro_id: "r1",
  precio_compra: 496.79, porcentaje_ganancia: 25, bonif_recargo: 0.05, iva_compras: "factura", iva_ventas: "factura", proveedor_id: "p1",
  orden_deposito: 76400, precio_base: 859.646127, precio_base_contado: 773.681514, precio_lista_especial: null, oferta_lista_especial: null,
  descuento_propio: 15, imagen_url: "", tipo_fraccion: "PACK", cantidad_fraccion: 12, segmento_precio: "limpieza_bazar",
}

const PROV_EJEMPLO = {
  nombre: "ACORAZADO", sigla: "MR", codigo_proveedor: "134", email: "", telefono: "", direccion: "", codigo_postal: "", localidad: "",
  provincia: "", codigo_provincia_dj: 1, telefono_oficina: "", telefono_vendedor: "", mail_vendedor: "", mail_oficina: "", cuit: "20-12345678-9",
  tipo_iva: 2, condicion_pago_tipo: "cuenta_corriente", plazo_dias: 30, plazo_desde: "fecha_factura", tipo_proveedor: "mercaderia_general",
  banco_nombre: "", banco_cuenta: "", banco_numero_cuenta: "", banco_tipo_cuenta: "", tipo_pago: [], retencion_iibb: 0, retencion_ganancias: 0,
  percepcion_iva: 0, percepcion_iibb: 0, tipo_descuento: "cascada", default_unidad_factura: "UNIDAD",
}

export function VitrinaCliente() {
  const [fa, setFa] = useState<any>(null)
  const [ff, setFf] = useState<Record<string, any>>(FF_EJEMPLO)
  const [provAbierto, setProvAbierto] = useState(false)
  const [prov, setProv] = useState<Record<string, any>>(PROV_EJEMPLO)
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-azul-900">Vitrina del rediseño</h1>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { setFf(FF_EJEMPLO); setFa({ id: "a1", activo: true }) }}>Abrir ficha de artículo</Button>
        <Button variant="outline" onClick={() => { setFf({ ean13: [], iva_compras: "factura", iva_ventas: "factura" }); setFa({ id: "__new__" }) }}>Nuevo artículo</Button>
        <Button variant="outline" onClick={() => setProvAbierto(true)}>Ficha de proveedor</Button>
      </div>
      <Dialog open={provAbierto} onOpenChange={setProvAbierto}>
        <DialogContent className="flex h-[min(92dvh,900px)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <FichaProveedor formData={prov} setFormData={setProv} editando
            onSubmit={(e) => { e.preventDefault(); alert("Guardaría con el mismo handleSubmit de siempre") }}
            onCancelar={() => setProvAbierto(false)} onFichaFiscal={() => alert("Abre la ficha fiscal de siempre")} />
        </DialogContent>
      </Dialog>
      <div className="rounded-xl border bg-white">
        <CargaProgreso mensajes={MENSAJES.importarPedido} titulo="Importando pedido" />
      </div>
      <ClientesDemo />
      <FichaArticulo
        fa={fa} ff={ff} setFf={setFf as any}
        descuentos={[{ tipo: "comercial", porcentaje: 10, orden: 1 }, { tipo: "financiero", porcentaje: 3, orden: 2 }]}
        onGestionarDescuentos={() => alert("Abre el modal de descuentos de siempre")}
        provs={[{ id: "p1", nombre: "NEWELL BRANDS S.A." }, { id: "p2", nombre: "ACORAZADO" }]}
        marcas={[{ id: "m1", descripcion: "VIRULANA" }]}
        rubros={[{ id: "r1", nombre: "Limpieza" }, { id: "r2", nombre: "Bazar" }, { id: "r3", nombre: "Perfumería" }]}
        categorias={[{ id: "c1", nombre: "ESPONJAS Y ESTROPAJOS", rubro_id: "r1" }, { id: "c2", nombre: "VARIOS COCINA", rubro_id: "r1" }]}
        subcategorias={[{ id: "s1", nombre: "ESPONJAS DE ACERO Y METAL", categoria_id: "c1" }]}
        tiposBulto={["PACK", "CAJA", "BULTO", "UN"]} tiposFraccion={["PACK", "BLISTER", "DOCENA"]}
        imgSubiendo={false} onSubirImagen={() => {}} guardando={false}
        onGuardar={() => alert("Guardaría con el mismo sfa de siempre")} onCerrar={() => setFa(null)}
      />
    </div>
  )
}
