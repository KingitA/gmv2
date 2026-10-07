'use client'

// Ficha de proveedor (crear + editar) con el sistema visual Megasur.
// SOLO PRESENTACIÓN: va dentro del <DialogContent> de app/proveedores/page.tsx y usa
// el mismo formData/setFormData, las mismas conversiones de cada campo y el mismo
// guardado (onSubmit = handleSubmit de la página). La retención de Ganancias y el
// acuerdo de pago siguen en la Ficha Fiscal (su propio modal y su propio guardado).

import type { FormEvent } from 'react'
import { Building2, Landmark, Receipt, ShieldCheck, ShoppingCart } from 'lucide-react'
import { DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Campo, Campos, ConUnidad, FichaCabecera, FichaCuerpo, FichaMeta, FichaPie, FichaSeccion } from '@/components/ficha/ficha'
import { PROVINCIAS_ARGENTINA, TIPOS_IVA_DJ, CONDICIONES_PAGO } from '@/lib/constants'

type FormProveedor = Record<string, any>

interface Props {
  formData: FormProveedor
  setFormData: (f: any) => void
  editando: boolean
  onSubmit: (e: FormEvent) => void
  onCancelar: () => void
  /** Abre la Ficha Fiscal de siempre (solo al editar un proveedor existente). */
  onFichaFiscal?: () => void
}

const iniciales = (n: string) => n.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'

export function FichaProveedor({ formData, setFormData, editando, onSubmit, onCancelar, onFichaFiscal }: Props) {
  const set = (campo: string, valor: any) => setFormData({ ...formData, [campo]: valor })
  const faltaProvincia = !formData.provincia

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
      <DialogTitle className="sr-only">{editando ? 'Editar proveedor' : 'Nuevo proveedor'}</DialogTitle>
      <FichaCabecera
        foto={<div className="grid size-16 place-items-center rounded-xl bg-azul-600 text-xl font-bold text-white sm:size-[72px]">{iniciales(formData.nombre || '')}</div>}
        titulo={formData.nombre?.trim() || (editando ? 'Proveedor sin nombre' : 'Nuevo proveedor')}
        meta={
          <>
            {formData.codigo_proveedor && <FichaMeta label="Código">{formData.codigo_proveedor}</FichaMeta>}
            {formData.cuit && <FichaMeta label="CUIT">{formData.cuit}</FichaMeta>}
            {!editando && <span>Completá al menos el nombre y el CUIT</span>}
          </>
        }
      />

      <FichaCuerpo secciones={[
        { id: 'datos', titulo: 'Datos y contacto' },
        { id: 'compra', titulo: 'Condiciones de compra' },
        { id: 'fiscal', titulo: 'Fiscal', nota: faltaProvincia ? 'falta provincia' : undefined, aviso: faltaProvincia },
        { id: 'banco', titulo: 'Banco' },
      ]}>
        <FichaSeccion id="datos" titulo="Datos y contacto" icono={Building2} ayuda="A quién le compramos y cómo lo ubicamos.">
          <Campos>
            <Campo label="Nombre" nota="obligatorio" ancho={2}>
              <Input id="nombre" value={formData.nombre} onChange={e => set('nombre', e.target.value)} required />
            </Campo>
            <Campo label="Sigla">
              <Input id="sigla" value={formData.sigla} onChange={e => set('sigla', e.target.value)} />
            </Campo>
            <Campo label="Código de proveedor">
              <Input id="codigo_proveedor" className="tabular-nums" value={formData.codigo_proveedor} onChange={e => set('codigo_proveedor', e.target.value)} />
            </Campo>
            <Campo label="CUIT" nota="obligatorio">
              <Input id="cuit" className="tabular-nums" value={formData.cuit} onChange={e => set('cuit', e.target.value)} placeholder="20-12345678-9" required />
            </Campo>
            <Campo label="Tipo de proveedor">
              <Select value={formData.tipo_proveedor} onValueChange={v => set('tipo_proveedor', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mercaderia_general">Mercadería general</SelectItem>
                  <SelectItem value="servicios">Servicios</SelectItem>
                  <SelectItem value="transporte">Transporte</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Dirección" ancho={2}>
              <Input id="direccion" value={formData.direccion} onChange={e => set('direccion', e.target.value)} />
            </Campo>
            <Campo label="Localidad">
              <Input id="localidad" value={formData.localidad} onChange={e => set('localidad', e.target.value)} />
            </Campo>
            <Campo label="Código postal">
              <Input id="codigo_postal" className="tabular-nums" value={formData.codigo_postal} onChange={e => set('codigo_postal', e.target.value)} />
            </Campo>
            <Campo label="Teléfono de oficina">
              <Input id="telefono_oficina" value={formData.telefono_oficina} onChange={e => set('telefono_oficina', e.target.value)} />
            </Campo>
            <Campo label="Email de oficina">
              <Input id="mail_oficina" type="email" value={formData.mail_oficina} onChange={e => set('mail_oficina', e.target.value)} />
            </Campo>
            <Campo label="Teléfono del vendedor">
              <Input id="telefono_vendedor" value={formData.telefono_vendedor} onChange={e => set('telefono_vendedor', e.target.value)} />
            </Campo>
            <Campo label="Email del vendedor">
              <Input id="mail_vendedor" type="email" value={formData.mail_vendedor} onChange={e => set('mail_vendedor', e.target.value)} />
            </Campo>
          </Campos>
        </FichaSeccion>

        <FichaSeccion id="compra" titulo="Condiciones de compra" icono={ShoppingCart} ayuda="Cómo nos factura y cuándo le pagamos.">
          <Campos>
            <Campo label="Sus descuentos se aplican" ancho={2}>
              <Select value={formData.tipo_descuento} onValueChange={v => set('tipo_descuento', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cascada">En cascada (uno sobre otro)</SelectItem>
                  <SelectItem value="sobre_lista">Sobre precio lista (todos sobre el precio base)</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Unidad de facturación" nota="si el artículo no tiene una propia" ancho={2}>
              <Select value={formData.default_unidad_factura} onValueChange={v => set('default_unidad_factura', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNIDAD">Unidad (cantidad exacta)</SelectItem>
                  <SelectItem value="BULTO">Bulto (multiplica por un/bulto)</SelectItem>
                  <SelectItem value="CAJA">Caja (multiplica por un/bulto)</SelectItem>
                  <SelectItem value="PACK">Pack (multiplica por un/bulto)</SelectItem>
                  <SelectItem value="DOCENA">Docena (multiplica por 12)</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Condición de pago">
              <Select value={formData.condicion_pago_tipo} onValueChange={v => set('condicion_pago_tipo', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONDICIONES_PAGO.map(c => <SelectItem key={c.valor} value={c.valor}>{c.nombre} ({c.codigo})</SelectItem>)}
                </SelectContent>
              </Select>
            </Campo>
            {formData.condicion_pago_tipo !== 'anticipado' && (
              <>
                <Campo label="Plazo">
                  <ConUnidad unidad="días">
                    <Input id="plazo_dias" type="number" className="tabular-nums" value={formData.plazo_dias}
                      onChange={e => set('plazo_dias', Number.parseInt(e.target.value))} placeholder="30" required />
                  </ConUnidad>
                </Campo>
                <Campo label="Plazo desde">
                  <Select value={formData.plazo_desde} onValueChange={v => set('plazo_desde', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fecha_factura">La fecha de factura</SelectItem>
                      <SelectItem value="fecha_recepcion">La fecha de recepción</SelectItem>
                    </SelectContent>
                  </Select>
                </Campo>
              </>
            )}
          </Campos>
        </FichaSeccion>

        <FichaSeccion id="fiscal" titulo="Fiscal" icono={Receipt} aviso={faltaProvincia}
          ayuda="Provincia y tipo de IVA para la declaración jurada, y percepciones (solo en comprobantes con IVA).">
          <Campos>
            <Campo label="Provincia" nota="obligatorio" error={faltaProvincia}>
              <Select value={formData.provincia} onValueChange={value => {
                const prov = PROVINCIAS_ARGENTINA.find(p => p.nombre === value)
                setFormData({ ...formData, provincia: value, codigo_provincia_dj: prov?.codigo || 1 })
              }}>
                <SelectTrigger><SelectValue placeholder="Elegir provincia" /></SelectTrigger>
                <SelectContent>
                  {PROVINCIAS_ARGENTINA.map(p => <SelectItem key={p.codigo} value={p.nombre}>{p.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Código de provincia (DJ)">
              <Input value={formData.codigo_provincia_dj} disabled className="bg-neutro-100 tabular-nums" />
            </Campo>
            <Campo label="Tipo de IVA" nota="DJ Gestión" ancho={2}>
              <Select value={String(formData.tipo_iva)} onValueChange={v => set('tipo_iva', Number.parseInt(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_IVA_DJ.map(t => <SelectItem key={t.codigo} value={String(t.codigo)}>{t.codigo} - {t.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Percepción IVA">
              <ConUnidad unidad="%">
                <Input id="percepcion_iva" type="number" step="0.01" className="tabular-nums" value={formData.percepcion_iva}
                  onChange={e => set('percepcion_iva', Number.parseFloat(e.target.value) || 0)} placeholder="0.00" />
              </ConUnidad>
            </Campo>
            <Campo label="Percepción IIBB">
              <ConUnidad unidad="%">
                <Input id="percepcion_iibb" type="number" step="0.01" className="tabular-nums" value={formData.percepcion_iibb}
                  onChange={e => set('percepcion_iibb', Number.parseFloat(e.target.value) || 0)} placeholder="0.00" />
              </ConUnidad>
            </Campo>
          </Campos>
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border bg-neutro-50/60 px-4 py-3">
            <ShieldCheck className="size-5 shrink-0 text-azul-500" />
            <p className="min-w-0 flex-1 text-[13px] text-neutro-500">
              La retención de Ganancias (RG 830) y el acuerdo de pago blanco/negro se cargan en la <b className="font-semibold text-neutro-600">ficha fiscal</b>.
              {!editando && ' Disponible una vez creado el proveedor.'}
            </p>
            {editando && onFichaFiscal && <Button type="button" variant="outline" onClick={onFichaFiscal}>Abrir ficha fiscal</Button>}
          </div>
        </FichaSeccion>

        <FichaSeccion id="banco" titulo="Banco" icono={Landmark} ayuda="Para las transferencias de las órdenes de pago.">
          <Campos>
            <Campo label="Banco">
              <Input id="banco_nombre" value={formData.banco_nombre} onChange={e => set('banco_nombre', e.target.value)} />
            </Campo>
            <Campo label="Tipo de cuenta">
              <Input id="banco_tipo_cuenta" value={formData.banco_tipo_cuenta} onChange={e => set('banco_tipo_cuenta', e.target.value)} placeholder="Ej: CC, CA" />
            </Campo>
            <Campo label="Número de cuenta">
              <Input id="banco_numero_cuenta" className="tabular-nums" value={formData.banco_numero_cuenta} onChange={e => set('banco_numero_cuenta', e.target.value)} />
            </Campo>
            <Campo label="CBU o alias">
              <Input id="banco_cuenta" value={formData.banco_cuenta} onChange={e => set('banco_cuenta', e.target.value)} />
            </Campo>
          </Campos>
        </FichaSeccion>
      </FichaCuerpo>

      <FichaPie mensaje={faltaProvincia ? <span className="font-semibold text-alerta-600">Falta la provincia para la declaración jurada.</span> : null}>
        <Button type="button" variant="outline" onClick={onCancelar}>Cancelar</Button>
        <Button type="submit">{editando ? 'Guardar cambios' : 'Crear proveedor'}</Button>
      </FichaPie>
    </form>
  )
}
