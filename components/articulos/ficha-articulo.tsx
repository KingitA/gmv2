'use client'

// Ficha de artículo (crear + editar) con el sistema visual Megasur.
// SOLO PRESENTACIÓN: reemplaza al modal "Ficha unificada" de app/articulos/page.tsx
// con exactamente los mismos campos, el mismo estado (ff/setFf), las mismas
// conversiones de cada input y el mismo guardado (onGuardar = sfa de la página).
// No calcula precios: precio base y base contado vienen de la importación de
// artículos y la lógica de precios vive en lib/pricing (no se toca desde acá).
// Los descuentos tipados se siguen editando en su modal de siempre
// (onGestionarDescuentos); acá solo se muestran.

import { useState, type ChangeEvent, type ReactNode } from 'react'
import { Boxes, IdCard, Layers, Truck, Upload, CircleDollarSign, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Campo, Campos, ConUnidad, FichaCabecera, FichaCuerpo, FichaEstado, FichaMeta, FichaPie, FichaSeccion } from '@/components/ficha/ficha'
import type { DescuentoTipado } from '@/lib/pricing/calculator'
import { cn } from '@/lib/utils'

type Ff = Record<string, any>

const TIPOS_DESC: Record<string, { label: string; cls: string }> = {
  comercial: { label: 'Comercial', cls: 'bg-azul-50 text-azul-600' },
  financiero: { label: 'Financiero', cls: 'bg-cian-50 text-cian-700' },
  promocional: { label: 'Promocional', cls: 'bg-ambar-50 text-ambar-800' },
}

interface Props {
  fa: any | null
  ff: Ff
  setFf: (fn: (p: Ff) => Ff) => void
  /** Descuentos tipados guardados del artículo (solo lectura acá). */
  descuentos: DescuentoTipado[]
  /** Abre el modal de descuentos de siempre (cierra la ficha, como antes). */
  onGestionarDescuentos: () => void
  provs: { id: string; nombre: string }[]
  marcas: { id: string; descripcion: string }[]
  rubros: { id: string; nombre: string }[]
  categorias: { id: string; nombre: string; rubro_id: string }[]
  subcategorias: { id: string; nombre: string; categoria_id: string }[]
  tiposBulto: string[]
  tiposFraccion: string[]
  imgSubiendo: boolean
  onSubirImagen: (e: ChangeEvent<HTMLInputElement>) => void
  guardando: boolean
  onGuardar: () => void
  onCerrar: () => void
}

/** Opciones de un catálogo + el valor actual si ya no está activo (se muestra "(actual)" para no perderlo). */
const conActual = (lista: string[], actual?: string) => (actual && !lista.includes(actual) ? [...lista, actual] : lista)

export function FichaArticulo(p: Props) {
  const { fa, ff, setFf } = p
  const esNuevo = fa?.id === '__new__'
  const set = (campo: string, valor: any) => setFf(prev => ({ ...prev, [campo]: valor }))
  const [eanTexto, setEanTexto] = useState('')

  const prov = p.provs.find(x => x.id === ff.proveedor_id)
  const marca = p.marcas.find(x => x.id === ff.marca_id)

  // Clasificación en cascada (categoría y subcategoría se guardan por nombre, como siempre)
  const catsDelRubro = p.categorias.filter(c => c.rubro_id === ff.rubro_id)
  const catSel = catsDelRubro.find(c => c.nombre === ff.categoria)
  const subcatsDeCat = catSel ? p.subcategorias.filter(s => s.categoria_id === catSel.id) : []

  const agregarEan = (v: string) => {
    const t = v.trim()
    if (t && !(ff.ean13 || []).includes(t)) set('ean13', [...(ff.ean13 || []), t])
    setEanTexto('')
  }

  const faltaObligatorio = esNuevo && (!ff.sku?.trim() || !ff.descripcion?.trim())

  return (
    <Dialog open={!!fa} onOpenChange={o => { if (!o) p.onCerrar() }}>
      <DialogContent className="flex h-[min(92dvh,900px)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{esNuevo ? 'Nuevo artículo' : `Ficha del artículo ${ff.sku}`}</DialogTitle>
        {fa && (
          <>
            <FichaCabecera
              foto={
                <label className={cn('group relative grid size-16 cursor-pointer place-items-center overflow-hidden rounded-xl bg-azul-50 text-azul-300 sm:size-[72px]', p.imgSubiendo && 'pointer-events-none opacity-50')}>
                  {ff.imagen_url ? <img src={ff.imagen_url} alt="" className="size-full object-cover" /> : <Upload className="size-6" />}
                  <span className="absolute inset-x-0 bottom-0 bg-azul-900/70 py-0.5 text-center text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {p.imgSubiendo ? 'Subiendo…' : 'Cambiar foto'}
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={p.onSubirImagen} disabled={p.imgSubiendo} />
                </label>
              }
              titulo={esNuevo ? (ff.descripcion?.trim() || 'Nuevo artículo') : (ff.descripcion || 'Sin descripción')}
              meta={esNuevo ? <span>Completá al menos el SKU y la descripción</span> : (
                <>
                  <FichaMeta label="SKU">{ff.sku}</FichaMeta>
                  {marca && <span>{marca.descripcion}</span>}
                  {prov && <span>{prov.nombre}</span>}
                  <FichaEstado activo={fa.activo !== false} />
                </>
              )}
            />

            <FichaCuerpo secciones={[
              { id: 'ident', titulo: 'Identificación' },
              { id: 'prov', titulo: 'Proveedor y compra', nota: !esNuevo && p.descuentos.length ? `${p.descuentos.length} desc.` : undefined },
              { id: 'clas', titulo: 'Clasificación' },
              { id: 'precio', titulo: 'Precios de venta' },
              { id: 'deposito', titulo: 'Depósito y empaque' },
            ]}>
              <FichaSeccion id="ident" titulo="Identificación" icono={IdCard}
                ayuda="Cómo se reconoce el artículo en pedidos, facturas y en el escáner del depósito.">
                <Campos>
                  <Campo label="Descripción" ancho={2} error={esNuevo && !ff.descripcion?.trim()}>
                    <Input value={ff.descripcion ?? ''} onChange={e => set('descripcion', e.target.value)} />
                  </Campo>
                  <Campo label="SKU" error={esNuevo && !ff.sku?.trim()}>
                    <Input className="tabular-nums" value={ff.sku ?? ''} onChange={e => set('sku', e.target.value)} />
                  </Campo>
                  <Campo label="Foto">
                    <div className="flex h-10 items-center gap-3">
                      <label className={cn('inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-input bg-white px-3 text-sm font-semibold hover:bg-neutro-50', p.imgSubiendo && 'pointer-events-none opacity-50')}>
                        <Upload className="size-4" />{p.imgSubiendo ? 'Subiendo…' : ff.imagen_url ? 'Cambiar' : 'Subir'}
                        <input type="file" accept="image/*" className="hidden" onChange={p.onSubirImagen} disabled={p.imgSubiendo} />
                      </label>
                      {ff.imagen_url && <button type="button" className="text-[13px] font-medium text-error-500 hover:underline" onClick={() => set('imagen_url', '')}>Quitar</button>}
                    </div>
                  </Campo>
                  <Campo label="Códigos de barra (EAN 13)" nota="puede tener varios" ancho={4}>
                    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-white px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                      {(ff.ean13 || []).map((e: string, i: number) => (
                        <span key={`${e}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-azul-50 px-2 py-0.5 text-[13px] tabular-nums text-azul-900">
                          {e}
                          <button type="button" aria-label={`Quitar ${e}`} className="text-azul-300 hover:text-error-500"
                            onClick={() => set('ean13', (ff.ean13 || []).filter((_: string, j: number) => j !== i))}><X className="size-3.5" /></button>
                        </span>
                      ))}
                      <input
                        type="text"
                        inputMode="numeric"
                        value={eanTexto}
                        placeholder={(ff.ean13 || []).length ? '' : 'Escaneá o escribí y apretá Enter'}
                        className="min-w-[160px] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-neutro-400"
                        onChange={e => setEanTexto(e.target.value)}
                        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && eanTexto.trim()) { e.preventDefault(); agregarEan(eanTexto) } }}
                        onBlur={() => agregarEan(eanTexto)}
                      />
                    </div>
                  </Campo>
                </Campos>
              </FichaSeccion>

              <FichaSeccion id="prov" titulo="Proveedor y compra" icono={Truck}
                ayuda="A quién se lo compramos y a qué precio de lista.">
                <Campos>
                  <Campo label="Proveedor" ancho={2}>
                    <Select value={ff.proveedor_id || 'none'} onValueChange={v => set('proveedor_id', v === 'none' ? null : v)}>
                      <SelectTrigger><SelectValue placeholder="Sin proveedor" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin proveedor</SelectItem>
                        {p.provs.map(x => <SelectItem key={x.id} value={x.id}>{x.nombre}</SelectItem>)}
                        {ff.proveedor_id && !prov && <SelectItem value={ff.proveedor_id}>{`${fa?.proveedor?.nombre || 'Proveedor'} (inactivo)`}</SelectItem>}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="Marca">
                    <Select value={ff.marca_id || 'none'} onValueChange={v => set('marca_id', v === 'none' ? null : v)}>
                      <SelectTrigger><SelectValue placeholder="Sin marca" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin marca</SelectItem>
                        {p.marcas.map(m => <SelectItem key={m.id} value={m.id}>{m.descripcion}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="IVA de compra">
                    <Select value={ff.iva_compras} onValueChange={v => set('iva_compras', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="factura">Blanco (+IVA)</SelectItem>
                        <SelectItem value="adquisicion_stock">Negro (sin IVA)</SelectItem>
                        <SelectItem value="mixto">Mixto</SelectItem>
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="Precio de compra (lista)">
                    <ConUnidad unidad="$">
                      <Input type="number" step="0.01" className="tabular-nums" value={ff.precio_compra || ''} onChange={e => set('precio_compra', parseFloat(e.target.value) || 0)} />
                    </ConUnidad>
                  </Campo>
                </Campos>

                {!esNuevo && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-neutro-600">Descuentos tipados</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {p.descuentos.length === 0
                          ? <span className="text-[13px] text-neutro-400">Sin descuentos cargados</span>
                          : p.descuentos.map((d, i) => {
                            const t = TIPOS_DESC[d.tipo] ?? TIPOS_DESC.comercial
                            return <span key={i} className={cn('rounded-md px-2 py-0.5 text-[13px] font-semibold tabular-nums', t.cls)}>{t.label} {d.porcentaje}%</span>
                          })}
                      </div>
                    </div>
                    <Button type="button" variant="outline" onClick={p.onGestionarDescuentos}>Gestionar descuentos</Button>
                  </div>
                )}
              </FichaSeccion>

              <FichaSeccion id="clas" titulo="Clasificación" icono={Layers}
                ayuda="Dónde aparece en el catálogo y en los reportes. El segmento de precio se usa cuando el artículo pertenece a un rubro distinto al de su proveedor.">
                <Campos>
                  <Campo label="Rubro">
                    <Select value={ff.rubro_id || (ff.rubro ? '__actual__' : 'none')} onValueChange={v => {
                      if (v === '__actual__') return
                      const r = p.rubros.find(x => x.id === v)
                      setFf(prev => ({ ...prev, rubro: r?.nombre ?? '', rubro_id: r?.id ?? null, categoria: '', subcategoria: '' }))
                    }}>
                      <SelectTrigger><SelectValue placeholder="Sin rubro" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin rubro</SelectItem>
                        {p.rubros.map(r => <SelectItem key={r.id} value={r.id}>{r.nombre}</SelectItem>)}
                        {/* Rubro guardado que no está en la lista (inactivo o cargado solo como texto): no se pierde */}
                        {ff.rubro_id && !p.rubros.some(r => r.id === ff.rubro_id) && <SelectItem value={ff.rubro_id}>{`${ff.rubro || 'Rubro'} (actual)`}</SelectItem>}
                        {!ff.rubro_id && ff.rubro && <SelectItem value="__actual__">{`${ff.rubro} (actual)`}</SelectItem>}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="Categoría">
                    <Select disabled={!ff.rubro_id} value={ff.categoria || 'none'} onValueChange={v => setFf(prev => ({ ...prev, categoria: v === 'none' ? '' : v, subcategoria: '' }))}>
                      <SelectTrigger><SelectValue placeholder={ff.rubro_id ? 'Sin categoría' : 'Elegí un rubro'} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin categoría</SelectItem>
                        {conActual(catsDelRubro.map(c => c.nombre), ff.categoria).map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="Subcategoría">
                    <Select disabled={!catSel} value={ff.subcategoria || 'none'} onValueChange={v => set('subcategoria', v === 'none' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder={catSel ? 'Sin subcategoría' : 'Elegí una categoría'} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin subcategoría</SelectItem>
                        {conActual(subcatsDeCat.map(s => s.nombre), ff.subcategoria).map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="Segmento de precio">
                    <Select value={ff.segmento_precio ?? 'auto'} onValueChange={v => set('segmento_precio', v === 'auto' ? null : v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automático (por rubro/categoría)</SelectItem>
                        <SelectItem value="limpieza_bazar">Limpieza / bazar</SelectItem>
                        <SelectItem value="perfumeria">Perfumería</SelectItem>
                      </SelectContent>
                    </Select>
                  </Campo>
                </Campos>
              </FichaSeccion>

              <FichaSeccion id="precio" titulo="Precios de venta" icono={CircleDollarSign}
                ayuda="Margen, oferta y precios con los que se vende. El precio base y el contado vienen de la importación de artículos.">
                <Grupo titulo="Margen y oferta">
                  <Campos>
                    <Campo label="Margen">
                      <ConUnidad unidad="%"><Input type="number" step="0.1" className="tabular-nums" value={ff.porcentaje_ganancia || ''} onChange={e => set('porcentaje_ganancia', parseFloat(e.target.value) || 0)} /></ConUnidad>
                    </Campo>
                    <Campo label="Bonificación / recargo" nota="B/R">
                      <ConUnidad unidad="%"><Input type="number" step="0.1" className="tabular-nums" value={ff.bonif_recargo || ''} onChange={e => set('bonif_recargo', parseFloat(e.target.value) || 0)} /></ConUnidad>
                    </Campo>
                    <Campo label="Oferta">
                      <ConUnidad unidad="%"><Input type="number" step="0.01" className="tabular-nums" placeholder="0" value={ff.descuento_propio || ''} onChange={e => set('descuento_propio', parseFloat(e.target.value) || 0)} /></ConUnidad>
                    </Campo>
                    <Campo label="IVA de venta">
                      <Select value={ff.iva_ventas} onValueChange={v => set('iva_ventas', v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="factura">Blanco (factura)</SelectItem>
                          <SelectItem value="presupuesto">Negro (presupuesto)</SelectItem>
                        </SelectContent>
                      </Select>
                    </Campo>
                  </Campos>
                </Grupo>

                <Grupo titulo="Precio base">
                  <Campos>
                    <Campo label="Precio base">
                      <ConUnidad unidad="$"><Input type="number" step="0.01" className="tabular-nums" placeholder="Calculado" value={ff.precio_base ?? ''} onChange={e => set('precio_base', e.target.value === '' ? null : parseFloat(e.target.value) || 0)} /></ConUnidad>
                    </Campo>
                    <Campo label="Precio base contado">
                      <ConUnidad unidad="$"><Input type="number" step="0.01" className="tabular-nums" placeholder="Calculado" value={ff.precio_base_contado ?? ''} onChange={e => set('precio_base_contado', e.target.value === '' ? null : parseFloat(e.target.value) || 0)} /></ConUnidad>
                    </Campo>
                  </Campos>
                </Grupo>

                <Grupo titulo="Lista especial" nota="opcional">
                  <Campos>
                    <Campo label="Precio lista especial" nota="neto">
                      <ConUnidad unidad="$"><Input type="number" step="0.01" className="tabular-nums" placeholder="Sin precio especial" value={ff.precio_lista_especial ?? ''} onChange={e => set('precio_lista_especial', e.target.value === '' ? null : parseFloat(e.target.value) || 0)} /></ConUnidad>
                    </Campo>
                    <Campo label="Oferta especial">
                      <ConUnidad unidad="%"><Input type="number" step="0.01" className="tabular-nums" placeholder="0" value={ff.oferta_lista_especial ?? ''} onChange={e => set('oferta_lista_especial', e.target.value === '' ? null : parseFloat(e.target.value) || 0)} /></ConUnidad>
                    </Campo>
                  </Campos>
                </Grupo>
              </FichaSeccion>

              <FichaSeccion id="deposito" titulo="Depósito y empaque" icono={Boxes}
                ayuda="Cómo viene embalado y dónde se guarda. El orden de depósito es el recorrido del preparador.">
                <Campos>
                  <Campo label="Unidades por bulto">
                    <Input type="number" className="tabular-nums" value={ff.unidades_por_bulto || ''} onChange={e => set('unidades_por_bulto', parseInt(e.target.value) || 1)} />
                  </Campo>
                  <Campo label="Tipo de bulto">
                    <Select value={ff.unidad_de_medida || 'none'} onValueChange={v => set('unidad_de_medida', v === 'none' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {conActual(p.tiposBulto, ff.unidad_de_medida).map(u => <SelectItem key={u} value={u}>{u}{!p.tiposBulto.includes(u) ? ' (actual)' : ''}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="Tipo de fracción" nota="se edita en Ajustes">
                    <Select value={ff.tipo_fraccion || 'none'} onValueChange={v => set('tipo_fraccion', v === 'none' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {conActual(p.tiposFraccion, ff.tipo_fraccion).map(t => <SelectItem key={t} value={t}>{t}{!p.tiposFraccion.includes(t) ? ' (actual)' : ''}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="Unidades por fracción">
                    <Input type="number" className="tabular-nums" placeholder="Ej: 12, 24, 6" value={ff.cantidad_fraccion ?? ''} onChange={e => set('cantidad_fraccion', e.target.value ? parseInt(e.target.value) : null)} />
                  </Campo>
                  <Campo label="Orden en el depósito">
                    <Input type="number" className="tabular-nums" value={ff.orden_deposito || ''} onChange={e => set('orden_deposito', parseInt(e.target.value) || 0)} />
                  </Campo>
                </Campos>
              </FichaSeccion>
            </FichaCuerpo>

            <FichaPie mensaje={faltaObligatorio ? <span className="font-semibold text-alerta-600">Faltan el SKU o la descripción.</span> : null}>
              <Button variant="outline" onClick={p.onCerrar}>Cancelar</Button>
              <Button onClick={p.onGuardar} disabled={p.guardando || p.imgSubiendo}>
                {p.guardando ? 'Guardando…' : esNuevo ? 'Crear artículo' : 'Guardar cambios'}
              </Button>
            </FichaPie>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Sub-bloque dentro de una sección (ej. "Precio base" dentro de Precios de venta). */
function Grupo({ titulo, nota, children }: { titulo: string; nota?: string; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border bg-neutro-50/60 p-4 first:mt-0">
      <div className="mb-3 text-[13px] font-bold text-azul-900">
        {titulo}{nota && <span className="ml-1.5 font-medium text-neutro-400">{nota}</span>}
      </div>
      {children}
    </div>
  )
}
