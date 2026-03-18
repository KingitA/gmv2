"use client"

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Search, Save, ChevronLeft, ChevronRight, Trash2, Download, GripVertical, Plus, Upload, History, ArrowLeft } from "lucide-react"
import { ImportPriceListDialog } from "@/components/articulos/ImportPriceListDialog"
import * as XLSX from "xlsx"
import { calcularPrecioBase, calcularPrecioFinal, articuloToDatosArticulo, resumirDescuentos, type DatosLista, type MetodoFacturacion, type DescuentoTipado } from "@/lib/pricing/calculator"

interface LP { id:string; nombre:string; codigo:string; recargo_limpieza_bazar:number; recargo_perfumeria_negro:number; recargo_perfumeria_blanco:number }
interface ColLista { id:string; lista:LP; fac:MetodoFacturacion; label:string }

const PS = 50
const TC: Record<string,{bg:string;text:string}> = { comercial:{bg:"bg-blue-100",text:"text-blue-700"}, financiero:{bg:"bg-green-100",text:"text-green-700"}, promocional:{bg:"bg-purple-100",text:"text-purple-700"} }

type FColId = "art"|"prov"|"ivac"|"ivav"|"plista"|"desc"|"marg"|"br"|"pbase"
const FCOLS:{id:FColId;label:string;dw:number;mw:number}[] = [
  {id:"art",label:"Artículo",dw:220,mw:100},{id:"prov",label:"Proveedor",dw:100,mw:50},{id:"ivac",label:"IVA C.",dw:45,mw:35},{id:"ivav",label:"IVA V.",dw:45,mw:35},
  {id:"plista",label:"P. Lista",dw:100,mw:60},{id:"desc",label:"Desc.",dw:80,mw:40},{id:"marg",label:"Margen",dw:65,mw:40},
  {id:"br",label:"B/R",dw:55,mw:35},{id:"pbase",label:"P. Base",dw:95,mw:60},
]

export default function ArticulosUnificadoPage() {
  const sb = createClient()
  const [arts,setArts]=useState<any[]>([])
  const [dm,setDm]=useState<Record<string,DescuentoTipado[]>>({})
  const [tc,setTc]=useState(0)
  const [pg,setPg]=useState(0)
  const [provs,setProvs]=useState<any[]>([])
  const [listas,setListas]=useState<LP[]>([])
  const [st,setSt]=useState("")
  const [sd,setSd]=useState("")
  const [pf,setPf]=useState("todos")
  const [ld,setLd]=useState(true)
  const [ed,setEd]=useState<Map<string,Record<string,number>>>(new Map())
  const [sav,setSav]=useState(false)
  const [cls,setCls]=useState<ColLista[]>([])
  const [dli,setDli]=useState<number|null>(null)
  const [cw,setCw]=useState<Record<string,number>>(Object.fromEntries(FCOLS.map(c=>[c.id,c.dw])))
  const [lcw,setLcw]=useState<Record<string,number>>({}) // lista column widths
  const [ch,setCh]=useState<Record<string,boolean>>({})
  const [rc,setRc]=useState<string|null>(null)
  const rsx=useRef(0);const rsw=useRef(0)
  const [dma,setDma]=useState<any>(null)
  const [dmi,setDmi]=useState<DescuentoTipado[]>([])
  const [dms,setDms]=useState(false)
  const [fa,setFa]=useState<any>(null)
  const [ff,setFf]=useState<Record<string,any>>({})
  const [fs,setFs]=useState(false)
  // Importaciones modal
  const [showImports,setShowImports]=useState(false)
  const [importHist,setImportHist]=useState<any[]>([])
  const [importHistLoading,setImportHistLoading]=useState(false)
  const [importTab,setImportTab]=useState<"pendientes"|"historial"|"importar">("pendientes")
  const [pendingCount,setPendingCount]=useState(0)

  useEffect(()=>{const t=setTimeout(()=>{setSd(st);setPg(0)},400);return()=>clearTimeout(t)},[st])
  useEffect(()=>{(async()=>{
    const [{data:p},{data:l}]=await Promise.all([sb.from("proveedores").select("id,nombre").eq("activo",true).order("nombre"),sb.from("listas_precio").select("*").eq("activo",true).order("nombre")])
    if(p)setProvs(p);if(l){setListas(l);const b=l.find((x:any)=>x.codigo==="bahia");if(b&&cls.length===0)setCls([{id:`${b.codigo}_Presupuesto`,lista:b,fac:"Presupuesto",label:`${b.nombre}·Presup.`}])}
  })()},[])
  useEffect(()=>{load()},[pf,sd,pg])

  const load=async()=>{
    setLd(true)
    let q=sb.from("articulos").select("*,proveedor:proveedores(nombre,tipo_descuento)",{count:"exact"}).eq("activo",true)
    if(pf!=="todos")q=q.eq("proveedor_id",pf)
    if(sd.trim())q=q.or(`descripcion.ilike.%${sd.trim()}%,sku.ilike.%${sd.trim()}%,ean13.ilike.%${sd.trim()}%`)
    const{data,count}=await q.order("descripcion").range(pg*PS,(pg+1)*PS-1)
    const a=data||[];setArts(a);setTc(count||0)
    if(a.length>0){const ids=a.map((x:any)=>x.id);const{data:d}=await sb.from("articulos_descuentos").select("*").in("articulo_id",ids).order("orden");const m:Record<string,DescuentoTipado[]>={};for(const x of(d||[])){if(!m[x.articulo_id])m[x.articulo_id]=[];m[x.articulo_id].push({tipo:x.tipo,porcentaje:x.porcentaje,orden:x.orden})};setDm(m)}
    setLd(false)
  }
  const tp=Math.ceil(tc/PS)
  const edt=(id:string,c:string,v:number)=>{setEd(p=>{const n=new Map(p);n.set(id,{...(n.get(id)||{}),[c]:v});return n});setArts(p=>p.map(a=>a.id===id?{...a,[c]:v}:a))}
  const gsv=async()=>{if(ed.size===0)return;setSav(true);let ok=0;for(const[id,c]of ed.entries()){const{error}=await sb.from("articulos").update(c).eq("id",id);if(!error)ok++};setSav(false);setEd(new Map());alert(`${ok} artículo(s) actualizados`)}

  // Resize - works for both fixed and lista columns
  const sr=(id:string,e:React.MouseEvent)=>{e.preventDefault();setRc(id);rsx.current=e.clientX;rsw.current=cw[id]||lcw[id]||100}
  useEffect(()=>{if(!rc)return;const mm=(e:MouseEvent)=>{const d=e.clientX-rsx.current;const col=FCOLS.find(c=>c.id===rc);const minW=col?.mw||60;const startW=rsw.current;const newW=Math.max(minW,startW+d);if(col)setCw(p=>({...p,[rc]:newW}));else setLcw(p=>({...p,[rc]:newW}))};const mu=()=>setRc(null);document.addEventListener("mousemove",mm);document.addEventListener("mouseup",mu);return()=>{document.removeEventListener("mousemove",mm);document.removeEventListener("mouseup",mu)}},[rc])

  // Hide col on double-click header
  const toggleHide=(id:string)=>setCh(p=>({...p,[id]:!p[id]}))

  // Lista columns
  const tgl=(l:LP,f:MetodoFacturacion)=>{const id=`${l.codigo}_${f}`;setCls(p=>p.find(c=>c.id===id)?p.filter(c=>c.id!==id):[...p,{id,lista:l,fac:f,label:`${l.nombre}·${f==="Presupuesto"?"P":f==="Factura"?"F":"Fi"}`}])}
  const ila=(c:string,f:MetodoFacturacion)=>cls.some(x=>x.id===`${c}_${f}`)
  const dds=(i:number)=>setDli(i)
  const ddo=(e:React.DragEvent,i:number)=>{e.preventDefault();if(dli===null||dli===i)return;setCls(p=>{const n=[...p];const[m]=n.splice(dli,1);n.splice(i,0,m);return n});setDli(i)}
  const dde=()=>setDli(null)

  // Descuentos
  const odm=(a:any)=>{setDma(a);setDmi([...(dm[a.id]||[])])}
  const sdm=async()=>{if(!dma)return;setDms(true);await sb.from("articulos_descuentos").delete().eq("articulo_id",dma.id);const v=dmi.filter(d=>d.porcentaje>0);if(v.length>0)await sb.from("articulos_descuentos").insert(v.map((d,i)=>({articulo_id:dma.id,tipo:d.tipo,porcentaje:d.porcentaje,orden:i+1})));setDm(p=>({...p,[dma.id]:v.map((d,i)=>({...d,orden:i+1}))}));setDms(false);setDma(null)}

  // Ficha
  const ofa=(a:any)=>{setFa(a);setFf({descripcion:a.descripcion||"",sku:a.sku||"",precio_compra:a.precio_compra||0,porcentaje_ganancia:a.porcentaje_ganancia||0,bonif_recargo:a.bonif_recargo||0,iva_compras:a.iva_compras||"factura",iva_ventas:a.iva_ventas||"factura",categoria:a.categoria||"",rubro:a.rubro||"",proveedor_id:a.proveedor_id||null})}
  const sfa=async()=>{if(!fa)return;setFs(true);const{error}=await sb.from("articulos").update(ff).eq("id",fa.id);if(!error){const prov=provs.find((p:any)=>p.id===ff.proveedor_id);setArts(p=>p.map(a=>a.id===fa.id?{...a,...ff,proveedor:prov?{nombre:prov.nombre}:null}:a));setFa(null)}else alert(`Error: ${error.message}`);setFs(false)}

  const dpl=()=>{const t=[{sku:"123456",descripcion:"Ejemplo",proveedor_codigo:"PROV01",rubro:"limpieza",categoria:"Limpieza",precio_compra:100,porcentaje_ganancia:20,bonif_recargo:0,iva_compras:"factura",iva_ventas:"factura",descuento_comercial:"10+5",descuento_financiero:"3",descuento_promocional:""}];const ws=XLSX.utils.json_to_sheet(t);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Articulos");const wo=XLSX.write(wb,{bookType:"xlsx",type:"array"});const b=new Blob([wo],{type:"application/octet-stream"});const u=URL.createObjectURL(b);const l=document.createElement("a");l.href=u;l.download="plantilla_articulos.xlsx";l.click();URL.revokeObjectURL(u)}

  // Import handler with typed discounts support
  const [importing,setImporting]=useState(false)
  const [importResult,setImportResult]=useState<{show:boolean;inserted:number;updated:number;descs:number}|null>(null)
  const [showNewArt,setShowNewArt]=useState(false)
  const [newArtForm,setNewArtForm]=useState({sku:"",descripcion:"",categoria:"",rubro:"",iva_compras:"factura",iva_ventas:"factura",precio_compra:0,porcentaje_ganancia:0})

  const handleImport=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];if(!file)return;setImporting(true)
    try{
      const data=await file.arrayBuffer();const wb=XLSX.read(data);const ws=wb.Sheets[wb.SheetNames[0]]
      const rows=XLSX.utils.sheet_to_json(ws) as any[];const headers=rows.length>0?Object.keys(rows[0]):[]
      const hasDescs=headers.some(h=>h.startsWith("descuento_"))

      // Map proveedores
      const provCodes=[...new Set(rows.map(r=>r.proveedor_codigo).filter(Boolean))]
      let provMap:Record<string,string>={}
      if(provCodes.length>0){const{data:pd}=await sb.from("proveedores").select("id,codigo_proveedor").in("codigo_proveedor",provCodes);if(pd)provMap=Object.fromEntries(pd.map((p:any)=>[p.codigo_proveedor,p.id]))}

      // Parse rows
      const parsed=rows.filter(r=>r.sku&&String(r.sku).trim()).map(r=>{
        const art:any={sku:String(r.sku).trim()}
        if(r.descripcion)art.descripcion=r.descripcion
        if(r.proveedor_codigo&&provMap[r.proveedor_codigo])art.proveedor_id=provMap[r.proveedor_codigo]
        if(r.rubro)art.rubro=r.rubro
        if(r.categoria)art.categoria=r.categoria
        if(r.precio_compra!==undefined)art.precio_compra=Number(r.precio_compra)||0
        if(r.porcentaje_ganancia!==undefined)art.porcentaje_ganancia=Number(r.porcentaje_ganancia)||0
        if(r.bonif_recargo!==undefined)art.bonif_recargo=Number(r.bonif_recargo)||0
        if(r.iva_compras)art.iva_compras=r.iva_compras
        if(r.iva_ventas)art.iva_ventas=r.iva_ventas
        if(r.unidades_por_bulto)art.unidades_por_bulto=Number(r.unidades_por_bulto)
        // Extract typed discounts for later
        const descs:DescuentoTipado[]=[]
        for(const tipo of["comercial","financiero","promocional"]){
          const val=r[`descuento_${tipo}`]
          if(val){String(val).split("+").forEach((v,i)=>{const n=parseFloat(v);if(n>0)descs.push({tipo:tipo as any,porcentaje:n,orden:descs.length+1})})}
        }
        return{art,descs}
      })

      // Dedup by SKU
      const skuMap=new Map<string,typeof parsed[0]>();parsed.forEach(p=>skuMap.set(p.art.sku,p))
      const uniq=Array.from(skuMap.values())

      // Fetch existing
      const skus=uniq.map(u=>u.art.sku);let existing:any[]=[]
      for(let i=0;i<skus.length;i+=500){const chunk=skus.slice(i,i+500);const{data:d}=await sb.from("articulos").select("*").in("sku",chunk);if(d)existing=[...existing,...d]}
      const exMap=new Map(existing.map(a=>[a.sku,a]))

      const toInsert:any[]=[];const toUpdate:any[]=[];const descInserts:{sku:string;descs:DescuentoTipado[]}[]=[]
      uniq.forEach(({art,descs})=>{
        const ex=exMap.get(art.sku)
        if(ex)toUpdate.push({...ex,...art})
        else if(art.descripcion)toInsert.push(art)
        if(descs.length>0)descInserts.push({sku:art.sku,descs})
      })

      let ins=0,upd=0
      if(toInsert.length>0){const keys=new Set<string>();toInsert.forEach(i=>Object.keys(i).forEach(k=>keys.add(k)));const norm=toInsert.map(i=>{const n:any={};keys.forEach(k=>{n[k]=i[k]!==undefined?i[k]:null});return n});const{error}=await sb.from("articulos").insert(norm);if(error)throw new Error(error.message);ins=norm.length}
      if(toUpdate.length>0){for(let i=0;i<toUpdate.length;i+=500){const batch=toUpdate.slice(i,i+500);const{error}=await sb.from("articulos").upsert(batch,{onConflict:"sku"});if(error)throw new Error(error.message);upd+=batch.length}}

      // Handle typed discounts
      let descCount=0
      if(descInserts.length>0){
        // Get article IDs for the SKUs
        const descSkus=descInserts.map(d=>d.sku)
        const{data:artIds}=await sb.from("articulos").select("id,sku").in("sku",descSkus)
        const skuToId=new Map((artIds||[]).map((a:any)=>[a.sku,a.id]))
        for(const{sku,descs}of descInserts){
          const artId=skuToId.get(sku);if(!artId)continue
          await sb.from("articulos_descuentos").delete().eq("articulo_id",artId)
          const inserts=descs.map((d,i)=>({articulo_id:artId,tipo:d.tipo,porcentaje:d.porcentaje,orden:i+1}))
          await sb.from("articulos_descuentos").insert(inserts)
          descCount+=inserts.length
        }
      }

      setImportResult({show:true,inserted:ins,updated:upd,descs:descCount})
      load()
    }catch(err:any){alert(`Error: ${err.message}`)}
    finally{setImporting(false);e.target.value=""}
  }

  const createNewArticle=async()=>{
    if(!newArtForm.sku.trim()||!newArtForm.descripcion.trim()){alert("SKU y Descripción son obligatorios");return}
    const{error}=await sb.from("articulos").insert({...newArtForm,activo:true})
    if(error){alert(`Error: ${error.message}`);return}
    setShowNewArt(false);setNewArtForm({sku:"",descripcion:"",categoria:"",rubro:"",iva_compras:"factura",iva_ventas:"factura",precio_compra:0,porcentaje_ganancia:0})
    load()
  }

  const loadImportHist=async()=>{
    setImportHistLoading(true)
    const{data,error}=await sb.from("importaciones_articulos").select("*").order("created_at",{ascending:false}).limit(50)
    if(!error&&data){setImportHist(data);const pc=data.filter((i:any)=>i.estado==="pendiente").length;setPendingCount(pc)}
    setImportHistLoading(false)
  }
  const openImports=()=>{loadImportHist();setShowImports(true);setImportTab(pendingCount>0?"pendientes":"historial")}

  // Load pending count on mount
  useEffect(()=>{(async()=>{const{count}=await sb.from("importaciones_articulos").select("*",{count:"exact",head:true}).eq("estado","pendiente");setPendingCount(count||0)})()},[])


  const fmt=(n:number)=>n>0?`$${n.toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2})}`:"—"
  const icC=(v:string)=>v==="factura"?"+":v==="mixto"?"½":"0"
  const icV=(v:string)=>v==="factura"?"+":"0"
  const ccC=(v:string)=>v==="factura"?"bg-blue-100 text-blue-700":v==="mixto"?"bg-amber-100 text-amber-700":"bg-neutral-200 text-neutral-600"
  const ccV=(v:string)=>v==="factura"?"bg-blue-100 text-blue-700":"bg-neutral-200 text-neutral-600"
  const facs:MetodoFacturacion[]=["Presupuesto","Factura","Final"]
  const vc=FCOLS.filter(c=>!ch[c.id])

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div><h1 className="text-xl font-bold">Artículos</h1><p className="text-xs text-muted-foreground">{tc} artículos · Pág {pg+1}/{tp||1}</p></div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={()=>setShowNewArt(true)}><Plus className="h-3 w-3 mr-1"/>Nuevo</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={openImports}>
            <History className="h-3 w-3 mr-1"/>Importaciones
            {pendingCount>0&&<span className="ml-1 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{pendingCount}</span>}
          </Button>
          {ed.size>0&&<Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={gsv} disabled={sav}><Save className="h-3 w-3 mr-1"/>Guardar ({ed.size})</Button>}
        </div>
      </div>

      <div className="bg-white border rounded-lg p-2.5 mb-3 flex gap-2 items-end flex-wrap text-xs">
        <div className="w-[160px]">
          <div className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase">Proveedor</div>
          <Select value={pf} onValueChange={v=>{setPf(v);setPg(0)}}><SelectTrigger className="h-7 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem>{provs.map(p=><SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <div className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase">Buscar</div>
          <div className="relative"><Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground"/><Input value={st} onChange={e=>setSt(e.target.value)} placeholder="Descripción, SKU, EAN..." className="pl-7 h-7 text-xs"/></div>
        </div>
        <div className="border-l pl-2 flex gap-1.5 flex-wrap items-center">
          <span className="text-[9px] font-bold text-muted-foreground uppercase">Listas:</span>
          {listas.map(l=><div key={l.id} className="flex gap-px">{facs.map(f=><button key={`${l.codigo}_${f}`} onClick={()=>tgl(l,f)} className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${ila(l.codigo,f)?"bg-blue-600 text-white border-blue-600":"bg-white text-neutral-400 border-neutral-200 hover:border-neutral-400"}`}>{l.nombre.slice(0,3)}·{f==="Presupuesto"?"P":f==="Factura"?"F":"Fi"}</button>)}</div>)}
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden" style={{userSelect:rc?"none":undefined}}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead><tr className="bg-neutral-50 border-b" style={{height:32}}>
              {vc.map(c=><th key={c.id} className={`relative text-center px-1 py-1.5 font-semibold uppercase text-[10px] border-r border-neutral-100 ${c.id==="art"?"text-left px-3 sticky left-0 bg-neutral-50 z-10":""} ${c.id==="pbase"?"border-r-2 border-neutral-200":""}`} style={{width:cw[c.id],minWidth:c.mw,maxWidth:cw[c.id]}} onDoubleClick={()=>toggleHide(c.id)}>{c.label}<div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400 z-20" onMouseDown={e=>sr(c.id,e)}/></th>)}
              {cls.map((c,i)=><th key={c.id} className={`relative text-right px-2 py-1.5 font-semibold text-[10px] bg-blue-50 border-l border-blue-100 cursor-grab ${dli===i?"opacity-30":""}`} style={{width:lcw[c.id]||100,minWidth:60}} draggable onDragStart={()=>dds(i)} onDragOver={e=>ddo(e,i)} onDragEnd={dde}><div className="flex items-center justify-end gap-0.5"><GripVertical className="h-2.5 w-2.5 text-blue-300"/><span className="truncate">{c.label}</span><button onClick={()=>tgl(c.lista,c.fac)} className="text-blue-300 hover:text-red-500 ml-0.5 flex-shrink-0">×</button></div><div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400 z-20" onMouseDown={e=>sr(c.id,e)}/></th>)}
            </tr></thead>
            <tbody>
              {ld?<tr><td colSpan={99} className="text-center py-10 text-muted-foreground">Cargando...</td></tr>
              :arts.length===0?<tr><td colSpan={99} className="text-center py-10 text-muted-foreground">Sin artículos</td></tr>
              :arts.map(a=>{
                const ds=dm[a.id]||[];const dt=articuloToDatosArticulo(a,ds);const bs=calcularPrecioBase(dt);const rs=resumirDescuentos(ds);const ie=ed.has(a.id)
                return(<tr key={a.id} className={`border-b border-neutral-50 hover:bg-neutral-50/50 ${ie?"bg-yellow-50/30":""}`} style={{height:36}}>
                  {!ch.art&&<td className="px-3 py-0 sticky left-0 bg-white z-10 overflow-hidden" style={{width:cw.art,maxWidth:cw.art}}><button onClick={()=>ofa(a)} className="text-left hover:text-blue-600 block w-full overflow-hidden"><div className="font-medium text-[11px] leading-tight truncate">{a.descripcion}</div><span className="text-[10px] text-muted-foreground font-mono truncate block">{a.sku}</span></button></td>}
                  {!ch.prov&&<td className="px-1 py-0 text-center border-r border-neutral-50 overflow-hidden" style={{width:cw.prov,maxWidth:cw.prov}}><span className="text-[10px] text-muted-foreground truncate block">{a.proveedor?.nombre||"—"}</span></td>}
                  {!ch.ivac&&<td className="px-1 py-0 text-center border-r border-neutral-50" style={{width:cw.ivac,maxWidth:cw.ivac}}><span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${ccC(a.iva_compras||"factura")}`}>{icC(a.iva_compras||"factura")}</span></td>}
                  {!ch.ivav&&<td className="px-1 py-0 text-center border-r border-neutral-50" style={{width:cw.ivav,maxWidth:cw.ivav}}><span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${ccV(a.iva_ventas||"factura")}`}>{icV(a.iva_ventas||"factura")}</span></td>}
                  {!ch.plista&&<td className="px-1 py-0 border-r border-neutral-50" style={{width:cw.plista,maxWidth:cw.plista}}><input type="number" step="0.01" className="w-full text-right text-[11px] font-mono bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 rounded" value={a.precio_compra||""} onChange={e=>edt(a.id,"precio_compra",parseFloat(e.target.value)||0)}/></td>}
                  {!ch.desc&&<td className="px-1 py-0 text-center border-r border-neutral-50" style={{width:cw.desc,maxWidth:cw.desc}}><button onClick={()=>odm(a)} className="inline-flex gap-px px-1 py-0.5 rounded hover:bg-neutral-100">{ds.length===0?<span className="text-[10px] text-neutral-300">+</span>:<>{rs.totalComercial>0&&<span className="inline-flex items-center justify-center min-w-[16px] h-[16px] rounded text-[8px] font-bold bg-blue-100 text-blue-700">{rs.totalComercial}</span>}{rs.totalFinanciero>0&&<span className="inline-flex items-center justify-center min-w-[16px] h-[16px] rounded text-[8px] font-bold bg-green-100 text-green-700">{rs.totalFinanciero}</span>}{rs.totalPromocional>0&&<span className="inline-flex items-center justify-center min-w-[16px] h-[16px] rounded text-[8px] font-bold bg-purple-100 text-purple-700">{rs.totalPromocional}</span>}</>}</button></td>}
                  {!ch.marg&&<td className="px-1 py-0 border-r border-neutral-50" style={{width:cw.marg,maxWidth:cw.marg}}><input type="number" step="0.1" className="w-full text-center text-[11px] font-semibold text-green-700 bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 rounded" value={a.porcentaje_ganancia||""} placeholder="—" onChange={e=>edt(a.id,"porcentaje_ganancia",parseFloat(e.target.value)||0)}/></td>}
                  {!ch.br&&<td className="px-1 py-0 border-r border-neutral-50" style={{width:cw.br,maxWidth:cw.br}}><input type="number" step="0.1" className={`w-full text-center text-[11px] font-semibold bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 rounded ${(a.bonif_recargo||0)<0?"text-red-600":(a.bonif_recargo||0)>0?"text-amber-600":"text-neutral-300"}`} value={a.bonif_recargo||""} placeholder="—" onChange={e=>edt(a.id,"bonif_recargo",parseFloat(e.target.value)||0)}/></td>}
                  {!ch.pbase&&<td className="px-2 py-0 text-right font-bold font-mono text-[11px] border-r-2 border-neutral-200" style={{width:cw.pbase,maxWidth:cw.pbase}}>{fmt(bs.precioBase)}</td>}
                  {cls.map(c=>{const ld2:DatosLista={recargo_limpieza_bazar:c.lista.recargo_limpieza_bazar,recargo_perfumeria_negro:c.lista.recargo_perfumeria_negro,recargo_perfumeria_blanco:c.lista.recargo_perfumeria_blanco};const r=calcularPrecioFinal(dt,ld2,c.fac,0);const pf2=r.ivaIncluido?r.precioUnitarioFinal:r.precioUnitarioFinal+r.montoIvaDiscriminado;return(<td key={c.id} className="px-2 py-0 text-right bg-blue-50/20 border-l border-blue-50 overflow-hidden" style={{width:lcw[c.id]||100,maxWidth:lcw[c.id]||100}}><div className="font-bold font-mono text-[11px] truncate">{fmt(pf2)}</div></td>)})}
                </tr>)})}
            </tbody>
          </table>
        </div>
        {tp>1&&<div className="flex items-center justify-between px-3 py-2 border-t bg-neutral-50 text-xs"><span className="text-muted-foreground">{pg*PS+1}–{Math.min((pg+1)*PS,tc)} de {tc}</span><div className="flex gap-1"><Button variant="outline" size="sm" className="h-6 w-6 p-0" disabled={pg===0} onClick={()=>setPg(p=>p-1)}><ChevronLeft className="h-3 w-3"/></Button>{Array.from({length:Math.min(tp,7)},(_,i)=>{let pn=tp<=7?i:pg<3?i:pg>tp-4?tp-7+i:pg-3+i;return<Button key={pn} variant={pn===pg?"default":"outline"} size="sm" className="h-6 w-6 p-0 text-[10px]" onClick={()=>setPg(pn)}>{pn+1}</Button>})}<Button variant="outline" size="sm" className="h-6 w-6 p-0" disabled={pg>=tp-1} onClick={()=>setPg(p=>p+1)}><ChevronRight className="h-3 w-3"/></Button></div></div>}
      </div>

      {/* Descuentos Modal */}
      <Dialog open={!!dma} onOpenChange={o=>{if(!o)setDma(null)}}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="text-sm">Descuentos — {dma?.descripcion}</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">{dmi.length===0&&<p className="text-xs text-muted-foreground py-3 text-center">Sin descuentos</p>}{dmi.map((d,i)=><div key={i} className="flex items-center gap-2"><span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${TC[d.tipo]?.bg} ${TC[d.tipo]?.text}`}>{d.tipo.slice(0,3)}</span><Input type="number" step="0.1" className="w-[80px] h-7 text-xs text-center" value={d.porcentaje||""} onChange={e=>setDmi(p=>p.map((x,j)=>j===i?{...x,porcentaje:parseFloat(e.target.value)||0}:x))}/><span className="text-[10px]">%</span><Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={()=>setDmi(p=>p.filter((_,j)=>j!==i))}><Trash2 className="h-3 w-3"/></Button></div>)}</div>
        <div className="flex gap-1.5 pt-2">{(["comercial","financiero","promocional"] as const).map(t=><Button key={t} size="sm" variant="outline" className="text-[10px] h-6" onClick={()=>setDmi(p=>[...p,{tipo:t,porcentaje:0,orden:p.length+1}])}>+{t.slice(0,3).toUpperCase()}</Button>)}</div>
        <div className="flex justify-end gap-2 mt-2"><Button variant="outline" size="sm" onClick={()=>setDma(null)}>Cancelar</Button><Button size="sm" onClick={sdm} disabled={dms}>{dms?"...":"Guardar"}</Button></div>
      </DialogContent></Dialog>

      {/* Ficha Modal */}
      <Dialog open={!!fa} onOpenChange={o=>{if(!o)setFa(null)}}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle className="text-sm">Ficha — {fa?.sku}</DialogTitle></DialogHeader>
        {fa&&<div className="space-y-3">
          <div><Label className="text-xs">Descripción</Label><Input className="h-8 text-xs" value={ff.descripcion} onChange={e=>setFf(p=>({...p,descripcion:e.target.value}))}/></div>
          <div className="grid grid-cols-3 gap-3"><div><Label className="text-xs">SKU</Label><Input className="h-8 text-xs" value={ff.sku} onChange={e=>setFf(p=>({...p,sku:e.target.value}))}/></div><div><Label className="text-xs">Categoría</Label><Input className="h-8 text-xs" value={ff.categoria} onChange={e=>setFf(p=>({...p,categoria:e.target.value}))}/></div><div><Label className="text-xs">Rubro</Label><Input className="h-8 text-xs" value={ff.rubro} onChange={e=>setFf(p=>({...p,rubro:e.target.value}))}/></div></div>
          <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">IVA Compras</Label><Select value={ff.iva_compras} onValueChange={v=>setFf(p=>({...p,iva_compras:v}))}><SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="factura">Blanco</SelectItem><SelectItem value="adquisicion_stock">Negro</SelectItem><SelectItem value="mixto">Mixto</SelectItem></SelectContent></Select></div><div><Label className="text-xs">IVA Ventas</Label><Select value={ff.iva_ventas} onValueChange={v=>setFf(p=>({...p,iva_ventas:v}))}><SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="factura">Blanco</SelectItem><SelectItem value="presupuesto">Negro</SelectItem></SelectContent></Select></div></div>
          <div className="grid grid-cols-3 gap-3"><div><Label className="text-xs">P. Compra</Label><Input type="number" step="0.01" className="h-8 text-xs" value={ff.precio_compra} onChange={e=>setFf(p=>({...p,precio_compra:parseFloat(e.target.value)||0}))}/></div><div><Label className="text-xs">Margen %</Label><Input type="number" step="0.1" className="h-8 text-xs" value={ff.porcentaje_ganancia} onChange={e=>setFf(p=>({...p,porcentaje_ganancia:parseFloat(e.target.value)||0}))}/></div><div><Label className="text-xs">B/R %</Label><Input type="number" step="0.1" className="h-8 text-xs" value={ff.bonif_recargo} onChange={e=>setFf(p=>({...p,bonif_recargo:parseFloat(e.target.value)||0}))}/></div></div>
          <div><Label className="text-xs">Proveedor</Label><Select value={ff.proveedor_id||"none"} onValueChange={v=>setFf(p=>({...p,proveedor_id:v==="none"?null:v}))}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sin proveedor"/></SelectTrigger><SelectContent>{[{id:"none",nombre:"Sin proveedor"},...provs].map(p=>(<SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>))}</SelectContent></Select></div>
          <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={()=>setFa(null)}>Cancelar</Button><Button size="sm" onClick={sfa} disabled={fs}>{fs?"...":"Guardar"}</Button></div>
        </div>}
      </DialogContent></Dialog>

      {/* New Article Modal */}
      <Dialog open={showNewArt} onOpenChange={setShowNewArt}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle className="text-sm">Nuevo Artículo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">SKU *</Label><Input className="h-8 text-xs" value={newArtForm.sku} onChange={e=>setNewArtForm(p=>({...p,sku:e.target.value}))}/></div><div><Label className="text-xs">Descripción *</Label><Input className="h-8 text-xs" value={newArtForm.descripcion} onChange={e=>setNewArtForm(p=>({...p,descripcion:e.target.value}))}/></div></div>
          <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">Categoría</Label><Input className="h-8 text-xs" value={newArtForm.categoria} onChange={e=>setNewArtForm(p=>({...p,categoria:e.target.value}))}/></div><div><Label className="text-xs">Rubro</Label><Input className="h-8 text-xs" value={newArtForm.rubro} onChange={e=>setNewArtForm(p=>({...p,rubro:e.target.value}))}/></div></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">IVA Compras</Label><Select value={newArtForm.iva_compras} onValueChange={v=>setNewArtForm(p=>({...p,iva_compras:v}))}><SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="factura">Blanco</SelectItem><SelectItem value="adquisicion_stock">Negro</SelectItem><SelectItem value="mixto">Mixto</SelectItem></SelectContent></Select></div>
            <div><Label className="text-xs">IVA Ventas</Label><Select value={newArtForm.iva_ventas} onValueChange={v=>setNewArtForm(p=>({...p,iva_ventas:v}))}><SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="factura">Blanco</SelectItem><SelectItem value="presupuesto">Negro</SelectItem></SelectContent></Select></div>
          </div>
          <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">Precio Compra</Label><Input type="number" step="0.01" className="h-8 text-xs" value={newArtForm.precio_compra||""} onChange={e=>setNewArtForm(p=>({...p,precio_compra:parseFloat(e.target.value)||0}))}/></div><div><Label className="text-xs">Margen %</Label><Input type="number" step="0.1" className="h-8 text-xs" value={newArtForm.porcentaje_ganancia||""} onChange={e=>setNewArtForm(p=>({...p,porcentaje_ganancia:parseFloat(e.target.value)||0}))}/></div></div>
          <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={()=>setShowNewArt(false)}>Cancelar</Button><Button size="sm" onClick={createNewArticle}>Crear</Button></div>
        </div>
      </DialogContent></Dialog>

      {/* Import Result */}
      <Dialog open={!!importResult?.show} onOpenChange={()=>setImportResult(null)}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle className="text-sm">Importación Completa</DialogTitle></DialogHeader>
        {importResult&&<div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Nuevos:</span><span className="font-bold">{importResult.inserted}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Actualizados:</span><span className="font-bold">{importResult.updated}</span></div>
          {importResult.descs>0&&<div className="flex justify-between"><span className="text-muted-foreground">Descuentos procesados:</span><span className="font-bold">{importResult.descs}</span></div>}
          <Button size="sm" className="w-full mt-3" onClick={()=>setImportResult(null)}>Cerrar</Button>
        </div>}
      </DialogContent></Dialog>

      {/* ═══ IMPORTACIONES MODAL ═══ */}
      <Dialog open={showImports} onOpenChange={setShowImports}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-sm"><History className="h-4 w-4"/>Importaciones de Artículos</DialogTitle></DialogHeader>

          {/* Tabs */}
          <div className="flex gap-1 border-b mb-4">
            <button onClick={()=>setImportTab("pendientes")} className={`px-4 py-2 text-xs font-medium border-b-2 ${importTab==="pendientes"?"border-amber-500 text-amber-700":"border-transparent text-muted-foreground"}`}>
              ⏳ Pendientes {pendingCount>0&&<span className="ml-1 bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5 text-[10px] font-bold">{pendingCount}</span>}
            </button>
            <button onClick={()=>setImportTab("historial")} className={`px-4 py-2 text-xs font-medium border-b-2 ${importTab==="historial"?"border-blue-500 text-blue-700":"border-transparent text-muted-foreground"}`}>
              📋 Historial
            </button>
            <button onClick={()=>setImportTab("importar")} className={`px-4 py-2 text-xs font-medium border-b-2 ${importTab==="importar"?"border-green-500 text-green-700":"border-transparent text-muted-foreground"}`}>
              📥 Importar
            </button>
          </div>

          {/* Tab: Importar */}
          {importTab==="importar"&&(
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Subí un Excel con artículos para crear nuevos o actualizar existentes. El SKU es obligatorio como identificador.</p>
              <div className="flex gap-3">
                <Button variant="outline" size="sm" onClick={dpl}><Download className="h-3.5 w-3.5 mr-1"/>Descargar Plantilla</Button>
                <Button size="sm" className="relative" disabled={importing}>
                  <Upload className="h-3.5 w-3.5 mr-1"/>{importing?"Importando...":"Seleccionar Excel"}
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="absolute inset-0 opacity-0 cursor-pointer" disabled={importing}/>
                </Button>
              </div>
              <div className="bg-neutral-50 border rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-neutral-700">Columnas soportadas:</p>
                <p>sku (obligatorio), descripcion, proveedor_codigo, rubro, categoria, precio_compra, porcentaje_ganancia, bonif_recargo, iva_compras, iva_ventas, unidades_por_bulto</p>
                <p className="font-semibold text-neutral-700 mt-2">Descuentos tipados:</p>
                <p>descuento_comercial, descuento_financiero, descuento_promocional — Formato: "10+5" para múltiples descuentos</p>
              </div>
            </div>
          )}

          {/* Tab: Pendientes / Historial */}
          {(importTab==="pendientes"||importTab==="historial")&&(
            <div>
              {importHistLoading?<p className="text-center py-8 text-xs text-muted-foreground">Cargando...</p>
              :(()=>{
                const items=importTab==="pendientes"?importHist.filter((i:any)=>i.estado==="pendiente"):importHist
                return items.length===0?<p className="text-center py-8 text-xs text-muted-foreground">{importTab==="pendientes"?"No hay importaciones pendientes":"No hay historial"}</p>
                :<div className="space-y-2">{items.map((imp:any)=>(
                  <div key={imp.id} className="border rounded-lg p-3 hover:bg-neutral-50 transition-colors">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-xs font-semibold">{imp.archivo_nombre||imp.tipo||"Importación"}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(imp.created_at).toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}
                          {imp.source==="gmail"&&" · 📧 Gmail"}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${imp.estado==="pendiente"?"bg-amber-100 text-amber-700":imp.estado==="aplicada"?"bg-green-100 text-green-700":"bg-neutral-100 text-neutral-600"}`}>
                        {imp.estado==="pendiente"?"⏳ Pendiente":imp.estado==="aplicada"?"✅ Aplicada":imp.estado||"—"}
                      </span>
                    </div>
                    <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                      <span>{imp.registros_actualizados||0} actualizados</span>
                      <span>{imp.registros_nuevos||0} nuevos</span>
                      {imp.skus_omitidos?.length>0&&<span className="text-amber-600">{imp.skus_omitidos.length} omitidos</span>}
                    </div>
                  </div>
                ))}</div>
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
