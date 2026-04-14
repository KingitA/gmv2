"use client"

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Search, Save, ChevronLeft, ChevronRight, Trash2, Download, GripVertical,
  Plus, Upload, ShoppingCart, TrendingUp, Package, ChevronDown, Check,
  FileDown, FileUp, SlidersHorizontal, X,
} from "lucide-react"
import { ImportArticulosDialog } from "@/components/articulos/ImportArticulosDialog"
import * as XLSX from "xlsx"
import { calcularPrecioBase, calcularPrecioFinal, articuloToDatosArticulo, resumirDescuentos, determinarGrupoPrecio, type DatosLista, type MetodoFacturacion, type DescuentoTipado } from "@/lib/pricing/calculator"
import { calcularPreciosConFormulas, SUBLISTA_CODIGOS, SUBLISTA_META, type SublistaCodigo } from "@/lib/pricing/formula-evaluator"

// ─── Types ───────────────────────────────────────────────────────────────────
type Mode = "compras" | "ventas" | "gestion"
interface LP { id:string; nombre:string; codigo:string; recargo_limpieza_bazar:number; recargo_perfumeria_negro:number; recargo_perfumeria_blanco:number }
interface ReglaPrecioFila { grupo_precio:string; iva_compras:string; iva_ventas:string; formulas:Record<string,string> }

// ─── Column definitions ───────────────────────────────────────────────────────
const BASE_COLS = [
  { id:"desc",   label:"Descripción",  dw:230, mw:120 },
  { id:"sku",    label:"SKU",          dw:90,  mw:60  },
  { id:"ean13",  label:"EAN 13",       dw:110, mw:70  },
  { id:"ubulto", label:"×Bulto",       dw:55,  mw:40  },
  { id:"prov",   label:"Proveedor",    dw:110, mw:60  },
  { id:"marca",  label:"Marca",        dw:90,  mw:60  },
  { id:"cat",    label:"Categoría",    dw:100, mw:60  },
  { id:"subcat", label:"Subcategoría", dw:100, mw:60  },
  { id:"oferta", label:"Oferta",       dw:60,  mw:45  },
]
const COMPRAS_COLS = [
  { id:"plista",  label:"P. Lista",    dw:90,  mw:60 },
  { id:"desctos", label:"Desc.",       dw:80,  mw:55 },
  { id:"marg",    label:"Margen %",    dw:70,  mw:45 },
  { id:"br",      label:"B/R %",       dw:60,  mw:40 },
  { id:"ucosto",  label:"Últ. Costo",  dw:90,  mw:60 },
  { id:"ivac",    label:"IVA C.",      dw:50,  mw:40 },
  { id:"ivav",    label:"IVA V.",      dw:50,  mw:40 },
]
const VENTAS_COLS = [
  { id:"pbase",   label:"P. Base",    dw:115, mw:75 },
  { id:"pbcont",  label:"Contado",    dw:115, mw:75 },
  { id:"ivac_v",  label:"IVA C.",     dw:50, mw:40 },
  { id:"ivav_v",  label:"IVA V.",     dw:50, mw:40 },
]
const SL_ACCENT: Record<string,{dot:string;th:string;border:string;cell:string;name:string;price:string}> = {
  bahia:    { dot:"bg-sky-500",    th:"bg-sky-50 text-sky-800",       border:"border-sky-200",    cell:"bg-sky-50/20",    name:"text-sky-600",    price:"text-sky-700"    },
  neco:     { dot:"bg-violet-500", th:"bg-violet-50 text-violet-800", border:"border-violet-200", cell:"bg-violet-50/20", name:"text-violet-600", price:"text-violet-700" },
  viajante: { dot:"bg-teal-500",   th:"bg-teal-50 text-teal-800",     border:"border-teal-200",   cell:"bg-teal-50/20",   name:"text-teal-600",   price:"text-teal-700"   },
}
const MAP_LEGACY: Record<string,{listaCodigo:string;fac:MetodoFacturacion}> = {
  bahia_presupuesto: {listaCodigo:"bahia",    fac:"Presupuesto"},
  bahia_final:       {listaCodigo:"bahia",    fac:"Final"      },
  bahia_sin_iva:     {listaCodigo:"bahia",    fac:"Presupuesto"},
  bahia_con_iva:     {listaCodigo:"bahia",    fac:"Factura"    },
  neco_presupuesto:  {listaCodigo:"neco",     fac:"Presupuesto"},
  neco_final:        {listaCodigo:"neco",     fac:"Final"      },
  neco_sin_iva:      {listaCodigo:"neco",     fac:"Presupuesto"},
  neco_con_iva:      {listaCodigo:"neco",     fac:"Factura"    },
  viajante:          {listaCodigo:"viajante", fac:"Final"      },
}
const TC: Record<string,{bg:string;text:string}> = {
  comercial:   { bg:"bg-blue-100",   text:"text-blue-700"   },
  financiero:  { bg:"bg-emerald-100",text:"text-emerald-700"},
  promocional: { bg:"bg-purple-100", text:"text-purple-700" },
}
const ALL_EXPORT_FIELDS = ["SKU","EAN13","Descripción","Unid/Bulto","Proveedor","Marca","Categoría","Subcategoría","P. Lista","Margen %","B/R %","IVA Compras","IVA Ventas","P. Base","P. Contado"]
const PS = 50

// ─── Component ───────────────────────────────────────────────────────────────
export default function ArticulosPage() {
  const sb = createClient()

  // Core data
  const [arts,setArts]   = useState<any[]>([])
  const [dm,setDm]       = useState<Record<string,DescuentoTipado[]>>({})
  const [tc,setTc]       = useState(0)
  const [pg,setPg]       = useState(0)
  const [provs,setProvs] = useState<any[]>([])
  const [marcas,setMarcas] = useState<any[]>([])
  const [listas,setListas] = useState<LP[]>([])
  const [ld,setLd]       = useState(true)
  const [st,setSt]       = useState("")
  const [sd,setSd]       = useState("")
  const [pf,setPf]       = useState("todos")
  const [mode,setMode]   = useState<Mode>("ventas")
  const [ed,setEd]       = useState<Map<string,Record<string,number|null>>>(new Map())
  const [sav,setSav]     = useState(false)

  // Column visibility (Set of hidden column IDs)
  const [hid,setHid]     = useState<Set<string>>(new Set())
  const [showColPanel,setShowColPanel] = useState(false)
  const colRef = useRef<HTMLDivElement>(null)

  // Column resize
  const allFixedCols = [...BASE_COLS,...COMPRAS_COLS,...VENTAS_COLS]
  const [cw,setCw]   = useState<Record<string,number>>(Object.fromEntries(allFixedCols.map(c=>[c.id,c.dw])))
  const [lcw,setLcw] = useState<Record<string,number>>({})
  const [rc,setRc]   = useState<string|null>(null)
  const rsx=useRef(0); const rsw=useRef(0)

  // Lista columns (Ventas mode)
  const [reglasFormulas,setReglasFormulas] = useState<ReglaPrecioFila[]>([])
  const [activeSublistas,setActiveSublistas] = useState<SublistaCodigo[]>(["bahia_presupuesto"])
  const [dli,setDli] = useState<number|null>(null)
  const [showListaPanel,setShowListaPanel] = useState(false)
  const listaRef = useRef<HTMLDivElement>(null)

  // Descuentos modal
  const [dma,setDma] = useState<any>(null)
  const [dmi,setDmi] = useState<DescuentoTipado[]>([])
  const [dms,setDms] = useState(false)

  // Ficha modal
  const [fa,setFa]   = useState<any>(null)
  const [ff,setFf]   = useState<Record<string,any>>({})
  const [fs,setFs]   = useState(false)

  // New article modal
  const [showNew,setShowNew] = useState(false)
  const [nf,setNf]   = useState({sku:"",descripcion:"",categoria:"",rubro:"",iva_compras:"factura",iva_ventas:"factura",precio_compra:0,porcentaje_ganancia:0})

  // Import/Export
  const [showImpExp,setShowImpExp] = useState(false)
  const [ieTab,setIeTab]           = useState<"export"|"import">("export")
  const [expCols,setExpCols]       = useState<Set<string>>(new Set())
  const [exporting,setExporting]   = useState(false)
  const [showImporter,setShowImporter] = useState(false)

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(()=>{
    (async()=>{
      const [{data:p},{data:m},{data:l},{data:r}] = await Promise.all([
        sb.from("proveedores").select("id,nombre").eq("activo",true).order("nombre"),
        sb.from("marcas").select("id,codigo,descripcion").eq("activo",true).order("descripcion"),
        sb.from("listas_precio").select("*").eq("activo",true).order("nombre"),
        sb.from("listas_precio_reglas").select("grupo_precio,iva_compras,iva_ventas,formulas"),
      ])
      if(p) setProvs(p)
      if(m) setMarcas(m)
      if(l) setListas(l)
      if(r) setReglasFormulas(r as ReglaPrecioFila[])
    })()
  },[])
  useEffect(()=>{ const t=setTimeout(()=>{setSd(st);setPg(0)},400); return()=>clearTimeout(t) },[st])
  useEffect(()=>{ load() },[pf,sd,pg])

  // Close panels on outside click
  useEffect(()=>{
    if(!showColPanel) return
    const h=(e:MouseEvent)=>{ if(!colRef.current?.contains(e.target as Node)) setShowColPanel(false) }
    document.addEventListener("mousedown",h); return()=>document.removeEventListener("mousedown",h)
  },[showColPanel])
  useEffect(()=>{
    if(!showListaPanel) return
    const h=(e:MouseEvent)=>{ if(!listaRef.current?.contains(e.target as Node)) setShowListaPanel(false) }
    document.addEventListener("mousedown",h); return()=>document.removeEventListener("mousedown",h)
  },[showListaPanel])

  // Column resize
  useEffect(()=>{
    if(!rc) return
    const mm=(e:MouseEvent)=>{
      const d=e.clientX-rsx.current
      const fixed=allFixedCols.find(c=>c.id===rc)
      if(fixed) setCw(p=>({...p,[rc]:Math.max(fixed.mw,rsw.current+d)}))
      else setLcw(p=>({...p,[rc]:Math.max(100,rsw.current+d)}))
    }
    const mu=()=>setRc(null)
    document.addEventListener("mousemove",mm); document.addEventListener("mouseup",mu)
    return()=>{ document.removeEventListener("mousemove",mm); document.removeEventListener("mouseup",mu) }
  },[rc])
  const sr=(id:string,e:React.MouseEvent)=>{ e.preventDefault(); setRc(id); rsx.current=e.clientX; rsw.current=cw[id]??lcw[id]??100 }

  // ── Data ──────────────────────────────────────────────────────────────────
  const load=async()=>{
    setLd(true)
    let a:any[]=[], total=0

    if(sd.trim()){
      // Vector + text search via API (no pagination when searching)
      try {
        const res=await fetch(`/api/articulos/buscar?q=${encodeURIComponent(sd.trim())}`)
        let results=res.ok?await res.json():[]
        if(pf!=="todos") results=results.filter((x:any)=>x.proveedor_id===pf)
        a=results; total=results.length
      } catch { a=[]; total=0 }
    } else {
      let q=sb.from("articulos").select("*,proveedor:proveedores(nombre,tipo_descuento),marca:marca_id(codigo,descripcion)",{count:"exact"}).eq("activo",true)
      if(pf!=="todos") q=q.eq("proveedor_id",pf)
      const{data,count}=await q.order("descripcion").range(pg*PS,(pg+1)*PS-1)
      a=data||[]; total=count||0
    }

    setArts(a); setTc(total)
    if(a.length>0){
      const ids=a.map((x:any)=>x.id)
      const{data:d}=await sb.from("articulos_descuentos").select("*").in("articulo_id",ids).order("orden")
      const m:Record<string,DescuentoTipado[]>={}
      for(const x of(d||[])){ if(!m[x.articulo_id])m[x.articulo_id]=[]; m[x.articulo_id].push({tipo:x.tipo,porcentaje:x.porcentaje,orden:x.orden}) }
      setDm(m)
    }
    setLd(false)
  }
  const tp=Math.ceil(tc/PS)
  const edt=(id:string,c:string,v:number|null)=>{
    setEd(p=>{const n=new Map(p);n.set(id,{...(n.get(id)||{}),[c]:v});return n})
    setArts(p=>p.map(a=>a.id===id?{...a,[c]:v}:a))
  }
  const gsv=async()=>{
    if(ed.size===0) return; setSav(true); let ok=0
    for(const[id,c] of ed.entries()){const{error}=await sb.from("articulos").update(c).eq("id",id);if(!error)ok++}
    setSav(false); setEd(new Map()); alert(`${ok} artículo(s) actualizados`)
  }

  // Descuentos
  const odm=(a:any)=>{ setDma(a); setDmi([...(dm[a.id]||[])]) }
  const sdm=async()=>{
    if(!dma) return; setDms(true)
    await sb.from("articulos_descuentos").delete().eq("articulo_id",dma.id)
    const v=dmi.filter(d=>d.porcentaje>0)
    if(v.length>0) await sb.from("articulos_descuentos").insert(v.map((d,i)=>({articulo_id:dma.id,tipo:d.tipo,porcentaje:d.porcentaje,orden:i+1})))
    setDm(p=>({...p,[dma.id]:v.map((d,i)=>({...d,orden:i+1}))})); setDms(false); setDma(null)
  }

  // Ficha
  const ofa=(a:any)=>{ setFa(a); setFf({descripcion:a.descripcion||"",sku:a.sku||"",ean13:a.ean13||"",unidades_por_bulto:a.unidades_por_bulto||1,marca_id:a.marca_id||null,categoria:a.categoria||"",subcategoria:a.subcategoria||"",rubro:a.rubro||"",precio_compra:a.precio_compra||0,porcentaje_ganancia:a.porcentaje_ganancia||0,bonif_recargo:a.bonif_recargo||0,iva_compras:a.iva_compras||"factura",iva_ventas:a.iva_ventas||"factura",proveedor_id:a.proveedor_id||null}) }
  const sfa=async()=>{
    if(!fa) return; setFs(true)
    const{error}=await sb.from("articulos").update(ff).eq("id",fa.id)
    if(!error){
      const prov=provs.find((p:any)=>p.id===ff.proveedor_id)
      const marc=marcas.find((m:any)=>m.id===ff.marca_id)
      setArts(p=>p.map(a=>a.id===fa.id?{...a,...ff,proveedor:prov?{nombre:prov.nombre}:null,marca:marc?{codigo:marc.codigo,descripcion:marc.descripcion}:null}:a))
      fetch("/api/embed",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entity:"articulos",id:fa.id})}).catch(()=>{})
      setFa(null)
    } else alert(`Error: ${error.message}`)
    setFs(false)
  }

  // Sublista columns
  const tglSublista=(c:SublistaCodigo)=>setActiveSublistas(p=>p.includes(c)?p.filter(x=>x!==c):[...p,c])
  const getFormulasParaArticulo=(art:any):Record<string,string>|null=>{
    const grupo=determinarGrupoPrecio(art.categoria||art.rubro||"")
    const regla=reglasFormulas.find(r=>r.grupo_precio===grupo&&r.iva_compras===(art.iva_compras||"factura")&&r.iva_ventas===(art.iva_ventas||"factura"))
    if(!regla) return null
    const has=Object.values(regla.formulas).some((f:any)=>f&&String(f).trim()!=="")
    return has?regla.formulas:null
  }
  const dds=(i:number)=>setDli(i)
  const ddo=(e:React.DragEvent,i:number)=>{ e.preventDefault(); if(dli===null||dli===i)return; setActiveSublistas(p=>{const n=[...p];const[m]=n.splice(dli,1);n.splice(i,0,m);return n}); setDli(i) }

  // Column visibility
  const isVis=(id:string)=>!hid.has(id)
  const tglCol=(id:string)=>setHid(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })

  // Export
  const handleExport=async()=>{
    setExporting(true)
    try{
      const{data}=await sb.from("articulos").select("*,proveedor:proveedores(nombre)").eq("activo",true).order("descripcion")
      const fieldMap:Record<string,(a:any)=>any>={
        "SKU":a=>a.sku,"EAN13":a=>a.ean13||"","Descripción":a=>a.descripcion,"Unid/Bulto":a=>a.unidades_por_bulto||"",
        "Proveedor":a=>a.proveedor?.nombre||"","Marca":a=>a.marca?.descripcion||"","Categoría":a=>a.categoria||"","Subcategoría":a=>a.subcategoria||"",
        "P. Lista":a=>a.precio_compra||0,"Margen %":a=>a.porcentaje_ganancia||0,"B/R %":a=>a.bonif_recargo||0,
        "IVA Compras":a=>a.iva_compras||"","IVA Ventas":a=>a.iva_ventas||"","P. Base":a=>a.precio_base||"","P. Contado":a=>a.precio_base_contado||"",
      }
      const cols=expCols.size>0?[...expCols]:ALL_EXPORT_FIELDS
      const rows=(data||[]).map((a:any)=>Object.fromEntries(cols.map(c=>[c,fieldMap[c]?.(a)??""]) ))
      const ws=XLSX.utils.json_to_sheet(rows); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Artículos")
      const wo=XLSX.write(wb,{bookType:"xlsx",type:"array"}); const bl=new Blob([wo],{type:"application/octet-stream"})
      const u=URL.createObjectURL(bl); const lk=document.createElement("a"); lk.href=u; lk.download="articulos.xlsx"; lk.click(); URL.revokeObjectURL(u)
    } catch(e:any){ alert(`Error: ${e.message}`) }
    setExporting(false)
  }

  // Helpers
  const fmt=(n:number)=>n>0?`$${n.toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2})}`:"—"
  const icC=(v:string)=>v==="factura"?"+":v==="mixto"?"½":"0"
  const icV=(v:string)=>v==="factura"?"+":"0"
  const ccC=(v:string)=>v==="factura"?"bg-blue-100 text-blue-700":v==="mixto"?"bg-amber-100 text-amber-700":"bg-neutral-100 text-neutral-500"
  const ccV=(v:string)=>v==="factura"?"bg-blue-100 text-blue-700":"bg-neutral-100 text-neutral-500"
  const visBase=BASE_COLS.filter(c=>isVis(c.id))
  const visCompras=COMPRAS_COLS.filter(c=>isVis(c.id))
  const visVentas=VENTAS_COLS.filter(c=>isVis(c.id))
  const listRowH=mode==="ventas"&&activeSublistas.length>0?46:34

  return (
    <div className="flex flex-col h-screen bg-slate-50" style={{userSelect:rc?"none":undefined}}>

      {/* ═══ HEADER ═══════════════════════════════════════════════════════════ */}
      <div className="bg-white border-b px-5 py-3 flex items-center justify-between gap-3 flex-shrink-0 shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-slate-800 leading-tight">Artículos</h1>
          <p className="text-[11px] text-slate-400">{tc.toLocaleString()} artículos · Pág {pg+1}/{tp||1}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode tabs */}
          <div className="flex rounded-xl overflow-hidden border border-slate-200 shadow-sm text-[11px] font-semibold">
            <button onClick={()=>setMode("compras")} className={`px-3.5 py-2 flex items-center gap-1.5 transition-all ${mode==="compras"?"bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-inner":"bg-white text-slate-500 hover:bg-amber-50 hover:text-amber-700"}`}>
              <ShoppingCart className="h-3.5 w-3.5"/>Compras
            </button>
            <button onClick={()=>setMode("ventas")} className={`px-3.5 py-2 border-x border-slate-200 flex items-center gap-1.5 transition-all ${mode==="ventas"?"bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-inner":"bg-white text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"}`}>
              <TrendingUp className="h-3.5 w-3.5"/>Ventas
            </button>
            <button onClick={()=>setMode("gestion")} className={`px-3.5 py-2 flex items-center gap-1.5 transition-all ${mode==="gestion"?"bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-inner":"bg-white text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"}`}>
              <Package className="h-3.5 w-3.5"/>Gestión
              <span className="text-[8px] px-1 py-0.5 rounded bg-slate-100 text-slate-400 font-bold leading-none">soon</span>
            </button>
          </div>

          <div className="w-px h-7 bg-slate-200"/>

          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={()=>setShowNew(true)}>
            <Plus className="h-3.5 w-3.5"/>Nuevo
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={()=>{setShowImpExp(true);setIeTab("export")}}>
            <FileDown className="h-3.5 w-3.5"/>Exportar
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700" onClick={()=>{setShowImpExp(true);setIeTab("import")}}>
            <FileUp className="h-3.5 w-3.5"/>Importar
          </Button>
          {ed.size>0&&(
            <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={gsv} disabled={sav}>
              <Save className="h-3.5 w-3.5"/>{sav?"Guardando...":`Guardar (${ed.size})`}
            </Button>
          )}
        </div>
      </div>

      {/* ═══ FILTER BAR ════════════════════════════════════════════════════════ */}
      <div className="bg-white border-b px-5 py-2.5 flex gap-3 items-center flex-wrap flex-shrink-0">
        {/* Proveedor */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Proveedor</span>
          <Select value={pf} onValueChange={v=>{setPf(v);setPg(0)}}>
            <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value="todos">Todos</SelectItem>{provs.map(p=><SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {/* Search */}
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"/>
          <Input value={st} onChange={e=>setSt(e.target.value)} placeholder="Descripción, SKU, EAN..." className="pl-8 h-7 text-xs bg-slate-50"/>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Listas panel (Ventas only) */}
          {mode==="ventas"&&(
            <div className="relative" ref={listaRef}>
              <button onClick={()=>setShowListaPanel(p=>!p)} className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-lg border text-[11px] font-semibold transition-all ${showListaPanel?"bg-indigo-600 text-white border-indigo-600":"bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700"}`}>
                <TrendingUp className="h-3 w-3"/>Listas
                {activeSublistas.length>0&&<span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none ${showListaPanel?"bg-white/20 text-white":"bg-indigo-100 text-indigo-700"}`}>{activeSublistas.length}</span>}
                <ChevronDown className={`h-3 w-3 transition-transform ${showListaPanel?"rotate-180":""}`}/>
              </button>
              {showListaPanel&&(
                <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl w-56 py-3 overflow-hidden">
                  <div className="px-3 pb-2 mb-1 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Columnas de precios</span>
                    {activeSublistas.length>0&&<button onClick={()=>setActiveSublistas([])} className="text-[10px] text-red-500 font-semibold hover:text-red-700">Limpiar</button>}
                  </div>
                  {(["bahia","neco","viajante"] as const).map(grupo=>{
                    const ac=SL_ACCENT[grupo]
                    const codigos=SUBLISTA_CODIGOS.filter(c=>SUBLISTA_META[c].grupo===grupo)
                    return(
                      <div key={grupo} className="mb-2 last:mb-0">
                        <div className="flex items-center gap-1.5 px-3 py-1.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ac.dot}`}/>
                          <span className={`text-[11px] font-bold uppercase tracking-wide ${ac.name}`}>{grupo==="bahia"?"Bahía":grupo==="neco"?"Neco":"Viajante"}</span>
                        </div>
                        {codigos.map(c=>{
                          const on=activeSublistas.includes(c)
                          return(
                            <button key={c} onClick={()=>tglSublista(c)} className={`w-full flex items-center gap-2.5 px-4 py-1.5 transition-colors ${on?ac.th+" border-l-2 "+ac.border:"hover:bg-slate-50"}`}>
                              <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${on?ac.dot+" border-0":"border-slate-300"}`}>
                                {on&&<Check className="h-2.5 w-2.5 text-white"/>}
                              </div>
                              <span className="text-xs font-medium flex-1 text-left">{SUBLISTA_META[c].label}</span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Column visibility */}
          <div className="relative" ref={colRef}>
            <button onClick={()=>setShowColPanel(p=>!p)} className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-lg border text-[11px] font-semibold transition-all ${showColPanel?"bg-slate-800 text-white border-slate-800":"bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
              <SlidersHorizontal className="h-3 w-3"/>Columnas
              {hid.size>0&&<span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none ${showColPanel?"bg-white/20 text-white":"bg-orange-100 text-orange-700"}`}>{hid.size}</span>}
              <ChevronDown className={`h-3 w-3 transition-transform ${showColPanel?"rotate-180":""}`}/>
            </button>
            {showColPanel&&(
              <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl w-52 py-2">
                <div className="px-3 pb-1.5 mb-1 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Columnas base</span>
                  {hid.size>0&&<button onClick={()=>setHid(new Set())} className="text-[10px] text-indigo-600 font-semibold hover:text-indigo-800">Mostrar todas</button>}
                </div>
                {BASE_COLS.map(c=>(
                  <button key={c.id} onClick={()=>tglCol(c.id)} className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50 transition-colors">
                    <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${isVis(c.id)?"bg-slate-800 border-slate-800":"border-slate-300"}`}>
                      {isVis(c.id)&&<Check className="h-2.5 w-2.5 text-white"/>}
                    </div>
                    <span className="text-xs font-medium">{c.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ TABLE ════════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-auto">
          <table className="w-full text-xs border-collapse">
            {/* ── THEAD ── */}
            <thead className="sticky top-0 z-20">
              <tr style={{height:32}}>
                {/* Base col headers */}
                {visBase.map((c,i)=>(
                  <th key={c.id}
                    className={`relative px-2 py-1.5 font-semibold text-[10px] uppercase tracking-wider text-slate-500 bg-slate-100 border-r border-slate-200 select-none whitespace-nowrap ${i===0?"sticky left-0 z-30 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]":""}`}
                    style={{width:cw[c.id],minWidth:c.mw,maxWidth:cw[c.id]}}
                    onDoubleClick={()=>tglCol(c.id)} title="Doble click para ocultar"
                  >
                    {c.label}
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-10" onMouseDown={e=>sr(c.id,e)}/>
                  </th>
                ))}
                {/* Compras col headers */}
                {mode==="compras"&&visCompras.map(c=>(
                  <th key={c.id}
                    className="relative px-2 py-1.5 text-right font-semibold text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 border-r border-amber-100 select-none whitespace-nowrap"
                    style={{width:cw[c.id],minWidth:c.mw,maxWidth:cw[c.id]}}
                    onDoubleClick={()=>tglCol(c.id)}
                  >
                    {c.label}
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-amber-400 z-10" onMouseDown={e=>sr(c.id,e)}/>
                  </th>
                ))}
                {/* Ventas fixed col headers */}
                {mode==="ventas"&&visVentas.map(c=>(
                  <th key={c.id}
                    className={`relative px-2 py-1.5 text-right font-semibold text-[10px] uppercase tracking-wider text-indigo-700 bg-indigo-50 border-r border-indigo-100 select-none whitespace-nowrap ${c.id==="pbcont"?"border-r-2 border-indigo-200":""}`}
                    style={{width:cw[c.id],minWidth:c.mw,maxWidth:cw[c.id]}}
                    onDoubleClick={()=>tglCol(c.id)}
                  >
                    {c.label}
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-10" onMouseDown={e=>sr(c.id,e)}/>
                  </th>
                ))}
                {/* Sublista col headers */}
                {mode==="ventas"&&activeSublistas.map((codigo,i)=>{
                  const meta=SUBLISTA_META[codigo]
                  const ac=SL_ACCENT[meta.grupo]||{dot:"bg-slate-400",th:"bg-slate-50 text-slate-700",border:"border-slate-200",cell:"",name:"",price:"text-slate-700"}
                  const grupoLabel=meta.grupo==="bahia"?"Bahía":meta.grupo==="neco"?"Neco":"Viajante"
                  return(
                    <th key={codigo}
                      className={`relative px-2 py-1 border-l-2 ${ac.border} ${ac.th} cursor-grab select-none ${dli===i?"opacity-40":""}`}
                      style={{width:lcw[codigo]||120,minWidth:80}}
                      draggable onDragStart={()=>dds(i)} onDragOver={e=>ddo(e,i)} onDragEnd={()=>setDli(null)}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          <GripVertical className="h-3 w-3 opacity-40"/>
                          <div>
                            <div className={`text-[9px] font-bold uppercase tracking-wider ${ac.name}`}>{grupoLabel}</div>
                            <div className="text-[10px] font-semibold">{meta.label}</div>
                          </div>
                        </div>
                        <button onClick={()=>tglSublista(codigo)} className="opacity-30 hover:opacity-100 hover:text-red-500 transition-all leading-none text-base">×</button>
                      </div>
                      <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-10" onMouseDown={e=>sr(codigo,e)}/>
                    </th>
                  )
                })}
                {/* Gestión placeholder */}
                {mode==="gestion"&&(
                  <th className="px-3 py-1.5 text-center font-semibold text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 border-r border-emerald-100">
                    Stock
                  </th>
                )}
              </tr>
            </thead>

            {/* ── TBODY ── */}
            <tbody>
              {ld?(
                <tr><td colSpan={99} className="py-20 text-center">
                  <div className="inline-flex items-center gap-2 text-slate-400 text-sm">
                    <div className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin"/>Cargando artículos...
                  </div>
                </td></tr>
              ):arts.length===0?(
                <tr><td colSpan={99} className="py-20 text-center text-slate-400 text-sm">Sin artículos</td></tr>
              ):arts.map((a,idx)=>{
                const ds=dm[a.id]||[]; const dt=articuloToDatosArticulo(a,ds); const bs=calcularPrecioBase(dt); const rs=resumirDescuentos(ds)
                const ie=ed.has(a.id)
                const stripe=idx%2===0?"bg-white":"bg-slate-50/70"
                const rowCls=`border-b border-slate-100 hover:bg-indigo-50/20 transition-colors ${ie?"!bg-amber-50":stripe}`
                const stickyBg=ie?"#fffbeb":idx%2===0?"#ffffff":"#f8fafc"
                return(
                  <tr key={a.id} className={rowCls} style={{height:listRowH}}>
                    {/* ── Base cells ── */}
                    {isVis("desc")&&(
                      <td className="px-2.5 py-0 sticky left-0 z-10 border-r border-slate-100 overflow-hidden" style={{width:cw.desc,maxWidth:cw.desc,background:stickyBg}}>
                        <button onClick={()=>ofa(a)} className="text-left block w-full overflow-hidden group">
                          <div className="font-semibold text-[11px] leading-tight truncate text-slate-800 group-hover:text-indigo-600 transition-colors">{a.descripcion}</div>
                          <div className="text-[10px] text-slate-400 font-mono truncate leading-tight">{a.sku}</div>
                        </button>
                      </td>
                    )}
                    {isVis("sku")&&<td className="px-2 py-0 border-r border-slate-100 font-mono text-[11px] text-slate-500 overflow-hidden" style={{width:cw.sku,maxWidth:cw.sku}}>{a.sku}</td>}
                    {isVis("ean13")&&<td className="px-2 py-0 border-r border-slate-100 font-mono text-[10px] text-slate-400 text-center overflow-hidden" style={{width:cw.ean13,maxWidth:cw.ean13}}>{a.ean13||"—"}</td>}
                    {isVis("ubulto")&&<td className="px-2 py-0 border-r border-slate-100 text-center text-[11px] font-bold text-slate-600" style={{width:cw.ubulto,maxWidth:cw.ubulto}}>{a.unidades_por_bulto||"—"}</td>}
                    {isVis("prov")&&<td className="px-2 py-0 border-r border-slate-100 overflow-hidden" style={{width:cw.prov,maxWidth:cw.prov}}><span className="text-[10px] text-slate-500 truncate block">{a.proveedor?.nombre||"—"}</span></td>}
                    {isVis("marca")&&<td className="px-2 py-0 border-r border-slate-100 overflow-hidden" style={{width:cw.marca,maxWidth:cw.marca}}><span className="text-[10px] text-slate-500 truncate block">{a.marca?.descripcion||"—"}</span></td>}
                    {isVis("cat")&&<td className="px-2 py-0 border-r border-slate-100 overflow-hidden" style={{width:cw.cat,maxWidth:cw.cat}}><span className="text-[10px] text-slate-500 truncate block">{a.categoria||"—"}</span></td>}
                    {isVis("subcat")&&<td className="px-2 py-0 border-r border-slate-100 overflow-hidden" style={{width:cw.subcat,maxWidth:cw.subcat}}><span className="text-[10px] text-slate-500 truncate block">{a.subcategoria||"—"}</span></td>}
                    {isVis("oferta")&&<td className="px-2 py-0 border-r border-slate-100 text-center overflow-hidden" style={{width:cw.oferta,maxWidth:cw.oferta}}>{a.descuento_propio>0?<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700">{a.descuento_propio}%</span>:<span className="text-[10px] text-slate-300">—</span>}</td>}

                    {/* ── Compras cells ── */}
                    {mode==="compras"&&<>
                      {isVis("plista")&&<td className="px-1 py-0 border-r border-amber-100 bg-amber-50/30" style={{width:cw.plista,maxWidth:cw.plista}}>
                        <input type="number" step="0.01" className="w-full text-right text-[11px] font-mono text-amber-900 bg-transparent border-b border-transparent hover:border-amber-300 focus:border-amber-500 focus:outline-none py-0.5" value={a.precio_compra||""} onChange={e=>edt(a.id,"precio_compra",parseFloat(e.target.value)||0)}/>
                      </td>}
                      {isVis("desctos")&&<td className="px-1 py-0 text-center border-r border-amber-100 bg-amber-50/30" style={{width:cw.desctos,maxWidth:cw.desctos}}>
                        <button onClick={()=>odm(a)} className="inline-flex flex-wrap gap-px px-1 py-0.5 rounded hover:bg-amber-100 transition-colors min-w-full justify-center">
                          {ds.length===0?<span className="text-[10px] text-slate-300">+</span>:<>
                            {rs.totalComercial>0&&<span className="inline-flex items-center px-1 h-[16px] rounded text-[8px] font-bold bg-blue-100 text-blue-700">{rs.totalComercial}%</span>}
                            {rs.totalFinanciero>0&&<span className="inline-flex items-center px-1 h-[16px] rounded text-[8px] font-bold bg-emerald-100 text-emerald-700">{rs.totalFinanciero}%</span>}
                            {rs.totalPromocional>0&&<span className="inline-flex items-center px-1 h-[16px] rounded text-[8px] font-bold bg-purple-100 text-purple-700">{rs.totalPromocional}%</span>}
                          </>}
                        </button>
                      </td>}
                      {isVis("marg")&&<td className="px-1 py-0 border-r border-amber-100 bg-amber-50/30" style={{width:cw.marg,maxWidth:cw.marg}}>
                        <input type="number" step="0.1" className="w-full text-center text-[11px] font-bold text-emerald-700 bg-transparent border-b border-transparent hover:border-emerald-300 focus:border-emerald-500 focus:outline-none py-0.5" value={a.porcentaje_ganancia||""} placeholder="—" onChange={e=>edt(a.id,"porcentaje_ganancia",parseFloat(e.target.value)||0)}/>
                      </td>}
                      {isVis("br")&&<td className="px-1 py-0 border-r border-amber-100 bg-amber-50/30" style={{width:cw.br,maxWidth:cw.br}}>
                        <input type="number" step="0.1" className={`w-full text-center text-[11px] font-bold bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 ${(a.bonif_recargo||0)<0?"text-red-600":(a.bonif_recargo||0)>0?"text-amber-600":"text-slate-300"}`} value={a.bonif_recargo||""} placeholder="—" onChange={e=>edt(a.id,"bonif_recargo",parseFloat(e.target.value)||0)}/>
                      </td>}
                      {isVis("ucosto")&&<td className="px-2 py-0 text-right border-r border-amber-100 bg-amber-50/30" style={{width:cw.ucosto,maxWidth:cw.ucosto}}>
                        <span className="text-[11px] font-bold font-mono text-amber-800">{fmt(bs.costoNeto)}</span>
                      </td>}
                      {isVis("ivac")&&<td className="px-1 py-0 text-center border-r border-amber-100 bg-amber-50/30" style={{width:cw.ivac,maxWidth:cw.ivac}}>
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-bold ${ccC(a.iva_compras||"factura")}`}>{icC(a.iva_compras||"factura")}</span>
                      </td>}
                      {isVis("ivav")&&<td className="px-1 py-0 text-center border-r border-amber-100 bg-amber-50/30" style={{width:cw.ivav,maxWidth:cw.ivav}}>
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-bold ${ccV(a.iva_ventas||"factura")}`}>{icV(a.iva_ventas||"factura")}</span>
                      </td>}
                    </>}

                    {/* ── Ventas fixed cells ── */}
                    {mode==="ventas"&&<>
                      {isVis("pbase")&&<td className="px-1 py-0 border-r border-indigo-100 bg-indigo-50/20" style={{width:cw.pbase,maxWidth:cw.pbase}}>
                        <div className="flex items-center gap-0.5">
                          <input type="number" step="0.01" className={`flex-1 text-right text-[11px] font-mono font-bold bg-transparent border-b border-transparent hover:border-indigo-300 focus:border-indigo-500 focus:outline-none py-0.5 ${a.precio_base!=null?"text-indigo-700":"text-slate-400"}`} value={a.precio_base!=null?a.precio_base:""} placeholder={fmt(bs.precioBase)} onChange={e=>{const v=e.target.value;edt(a.id,"precio_base",v===""?null:parseFloat(v)||0);edt(a.id,"precio_base_contado",v===""?null:Math.round((parseFloat(v)||0)*0.9*100)/100)}}/>
                          {a.precio_base!=null&&<button className="text-[9px] text-slate-300 hover:text-red-500 flex-shrink-0 leading-none" onClick={()=>{edt(a.id,"precio_base",null);edt(a.id,"precio_base_contado",null)}}>×</button>}
                        </div>
                        {a.precio_base==null&&<div className="text-[8px] text-slate-300 text-right leading-none">calc.</div>}
                      </td>}
                      {isVis("pbcont")&&<td className="px-1 py-0 border-r-2 border-indigo-200 bg-indigo-50/20" style={{width:cw.pbcont,maxWidth:cw.pbcont}}>
                        <input type="number" step="0.01" className="w-full text-right text-[11px] font-mono font-bold text-amber-600 bg-transparent border-b border-transparent hover:border-amber-300 focus:border-amber-500 focus:outline-none py-0.5" value={a.precio_base_contado!=null?a.precio_base_contado:""} placeholder={a.precio_base!=null?fmt(Math.round(a.precio_base*0.9*100)/100):"—"} onChange={e=>edt(a.id,"precio_base_contado",parseFloat(e.target.value)||0)}/>
                      </td>}
                      {isVis("ivac_v")&&<td className="px-1 py-0 text-center border-r border-indigo-100 bg-indigo-50/20" style={{width:cw.ivac_v,maxWidth:cw.ivac_v}}>
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-bold ${ccC(a.iva_compras||"factura")}`}>{icC(a.iva_compras||"factura")}</span>
                      </td>}
                      {isVis("ivav_v")&&<td className="px-1 py-0 text-center border-r border-indigo-100 bg-indigo-50/20" style={{width:cw.ivav_v,maxWidth:cw.ivav_v}}>
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-bold ${ccV(a.iva_ventas||"factura")}`}>{icV(a.iva_ventas||"factura")}</span>
                      </td>}
                      {/* Sublista price cells */}
                      {activeSublistas.map(codigo=>{
                        const meta=SUBLISTA_META[codigo]
                        const ac=SL_ACCENT[meta.grupo]||{dot:"",th:"",border:"border-slate-200",cell:"bg-slate-50/20",name:"",price:"text-slate-700"}
                        const base=a.precio_base??bs.precioBase
                        const baseContado=a.precio_base_contado??(base*0.9)
                        const formulas=getFormulasParaArticulo(a)
                        let precio:number|null=null
                        let isLegacy=false
                        if(formulas&&base>0){
                          const precios=calcularPreciosConFormulas(base,baseContado,formulas)
                          precio=precios[codigo]??null
                        }
                        if(precio===null){
                          const leg=MAP_LEGACY[codigo]
                          if(leg){
                            const lista=listas.find(l=>l.codigo===leg.listaCodigo)
                            if(lista){
                              const ld2:DatosLista={recargo_limpieza_bazar:lista.recargo_limpieza_bazar,recargo_perfumeria_negro:lista.recargo_perfumeria_negro,recargo_perfumeria_blanco:lista.recargo_perfumeria_blanco}
                              const r=calcularPrecioFinal({...dt,precio_base_stored:base},ld2,leg.fac,0)
                              precio=r.ivaIncluido?r.precioUnitarioFinal:r.precioUnitarioFinal+r.montoIvaDiscriminado
                              isLegacy=true
                            }
                          }
                        }
                        const precioContado=precio!=null?Math.round(precio*0.9*100)/100:null
                        return(
                          <td key={codigo} className={`px-2.5 py-0 border-l-2 ${ac.border} ${ac.cell}`} style={{width:lcw[codigo]||120,maxWidth:lcw[codigo]||120}}>
                            <div className="flex flex-col items-end gap-0.5 py-0.5">
                              <div className="flex items-baseline gap-1">
                                <span className="text-[8px] font-medium text-slate-400 leading-none">cte</span>
                                <span className={`text-[11px] font-bold font-mono leading-none ${ac.price}`}>{precio!=null?fmt(precio):"—"}</span>
                              </div>
                              <div className="flex items-baseline gap-1">
                                <span className={`text-[8px] font-bold leading-none ${ac.name}`}>ctdo</span>
                                <span className={`text-[12px] font-bold font-mono leading-none ${ac.price}`}>{precioContado!=null?fmt(precioContado):"—"}</span>
                              </div>
                              {isLegacy&&<span className="text-[8px] text-slate-300 leading-none">legacy</span>}
                            </div>
                          </td>
                        )
                      })}
                    </>}

                    {/* ── Gestión placeholder ── */}
                    {mode==="gestion"&&(
                      <td className="px-3 py-0 text-center border-r border-emerald-100 bg-emerald-50/20">
                        <span className="text-[11px] text-emerald-300 font-medium">—</span>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ PAGINATION ════════════════════════════════════════════════════════ */}
      {tp>1&&(
        <div className="flex items-center justify-between px-5 py-2 border-t bg-white flex-shrink-0 shadow-[0_-1px_3px_rgba(0,0,0,0.04)]">
          <span className="text-[11px] text-slate-400">{pg*PS+1}–{Math.min((pg+1)*PS,tc)} de {tc.toLocaleString()} artículos</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={pg===0} onClick={()=>setPg(p=>p-1)}><ChevronLeft className="h-3 w-3"/></Button>
            {Array.from({length:Math.min(tp,7)},(_,i)=>{ let pn=tp<=7?i:pg<3?i:pg>tp-4?tp-7+i:pg-3+i; return <Button key={pn} variant={pn===pg?"default":"outline"} size="sm" className={`h-7 w-7 p-0 text-[10px] ${pn===pg?"bg-indigo-600 hover:bg-indigo-700 border-indigo-600 text-white":""}`} onClick={()=>setPg(pn)}>{pn+1}</Button> })}
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={pg>=tp-1} onClick={()=>setPg(p=>p+1)}><ChevronRight className="h-3 w-3"/></Button>
          </div>
        </div>
      )}

      {/* ═══ MODALS ═══════════════════════════════════════════════════════════ */}

      {/* Descuentos */}
      <Dialog open={!!dma} onOpenChange={o=>{if(!o)setDma(null)}}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Descuentos — {dma?.descripcion}</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {dmi.length===0&&<p className="text-xs text-muted-foreground py-3 text-center">Sin descuentos. Agregá uno abajo.</p>}
            {dmi.map((d,i)=>(
              <div key={i} className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${TC[d.tipo]?.bg} ${TC[d.tipo]?.text}`}>{d.tipo.slice(0,3)}</span>
                <Input type="number" step="0.1" className="w-[80px] h-7 text-xs text-center" value={d.porcentaje||""} onChange={e=>setDmi(p=>p.map((x,j)=>j===i?{...x,porcentaje:parseFloat(e.target.value)||0}:x))}/>
                <span className="text-[10px] text-slate-400">%</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-600" onClick={()=>setDmi(p=>p.filter((_,j)=>j!==i))}><Trash2 className="h-3 w-3"/></Button>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 pt-2">{(["comercial","financiero","promocional"] as const).map(t=><Button key={t} size="sm" variant="outline" className="text-[10px] h-6" onClick={()=>setDmi(p=>[...p,{tipo:t,porcentaje:0,orden:p.length+1}])}>+{t.slice(0,3).toUpperCase()}</Button>)}</div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" size="sm" onClick={()=>setDma(null)}>Cancelar</Button>
            <Button size="sm" onClick={sdm} disabled={dms}>{dms?"Guardando...":"Guardar"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ficha */}
      <Dialog open={!!fa} onOpenChange={o=>{if(!o)setFa(null)}}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-sm font-semibold">Ficha de artículo — <span className="font-mono">{fa?.sku}</span></DialogTitle></DialogHeader>
          {fa&&<div className="space-y-3">
            <div><Label className="text-xs">Descripción</Label><Input className="h-8 text-xs" value={ff.descripcion} onChange={e=>setFf(p=>({...p,descripcion:e.target.value}))}/></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">SKU</Label><Input className="h-8 text-xs font-mono" value={ff.sku} onChange={e=>setFf(p=>({...p,sku:e.target.value}))}/></div>
              <div><Label className="text-xs">EAN 13</Label><Input className="h-8 text-xs font-mono" value={ff.ean13} onChange={e=>setFf(p=>({...p,ean13:e.target.value}))}/></div>
              <div><Label className="text-xs">Unid/Bulto</Label><Input type="number" className="h-8 text-xs" value={ff.unidades_por_bulto} onChange={e=>setFf(p=>({...p,unidades_por_bulto:parseInt(e.target.value)||1}))}/></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Marca</Label><Select value={ff.marca_id||"none"} onValueChange={v=>setFf(p=>({...p,marca_id:v==="none"?null:v}))}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sin marca"/></SelectTrigger><SelectContent><SelectItem value="none">Sin marca</SelectItem>{marcas.map((m:any)=><SelectItem key={m.id} value={m.id}>{m.descripcion}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-xs">Categoría</Label><Input className="h-8 text-xs" value={ff.categoria} onChange={e=>setFf(p=>({...p,categoria:e.target.value}))}/></div>
              <div><Label className="text-xs">Subcategoría</Label><Input className="h-8 text-xs" value={ff.subcategoria} onChange={e=>setFf(p=>({...p,subcategoria:e.target.value}))}/></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">IVA Compras</Label><Select value={ff.iva_compras} onValueChange={v=>setFf(p=>({...p,iva_compras:v}))}><SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="factura">Blanco (+IVA)</SelectItem><SelectItem value="adquisicion_stock">Negro (sin IVA)</SelectItem><SelectItem value="mixto">Mixto</SelectItem></SelectContent></Select></div>
              <div><Label className="text-xs">IVA Ventas</Label><Select value={ff.iva_ventas} onValueChange={v=>setFf(p=>({...p,iva_ventas:v}))}><SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="factura">Blanco (factura)</SelectItem><SelectItem value="presupuesto">Negro (presupuesto)</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">P. Compra</Label><Input type="number" step="0.01" className="h-8 text-xs" value={ff.precio_compra} onChange={e=>setFf(p=>({...p,precio_compra:parseFloat(e.target.value)||0}))}/></div>
              <div><Label className="text-xs">Margen %</Label><Input type="number" step="0.1" className="h-8 text-xs" value={ff.porcentaje_ganancia} onChange={e=>setFf(p=>({...p,porcentaje_ganancia:parseFloat(e.target.value)||0}))}/></div>
              <div><Label className="text-xs">B/R %</Label><Input type="number" step="0.1" className="h-8 text-xs" value={ff.bonif_recargo} onChange={e=>setFf(p=>({...p,bonif_recargo:parseFloat(e.target.value)||0}))}/></div>
            </div>
            <div><Label className="text-xs">Proveedor</Label>
              <Select value={ff.proveedor_id||"none"} onValueChange={v=>setFf(p=>({...p,proveedor_id:v==="none"?null:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sin proveedor"/></SelectTrigger>
                <SelectContent>{[{id:"none",nombre:"Sin proveedor"},...provs,...(ff.proveedor_id&&!provs.find((p:any)=>p.id===ff.proveedor_id)?[{id:ff.proveedor_id,nombre:`${fa?.proveedor?.nombre||"Proveedor"} (inactivo)`}]:[])].map(p=><SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={()=>setFa(null)}>Cancelar</Button>
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={sfa} disabled={fs}>{fs?"Guardando...":"Guardar"}</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>

      {/* Nuevo artículo */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-sm">Nuevo Artículo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">SKU *</Label><Input className="h-8 text-xs font-mono" value={nf.sku} onChange={e=>setNf(p=>({...p,sku:e.target.value}))}/></div>
              <div><Label className="text-xs">Descripción *</Label><Input className="h-8 text-xs" value={nf.descripcion} onChange={e=>setNf(p=>({...p,descripcion:e.target.value}))}/></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Categoría</Label><Input className="h-8 text-xs" value={nf.categoria} onChange={e=>setNf(p=>({...p,categoria:e.target.value}))}/></div>
              <div><Label className="text-xs">Rubro</Label><Input className="h-8 text-xs" value={nf.rubro} onChange={e=>setNf(p=>({...p,rubro:e.target.value}))}/></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">IVA Compras</Label><Select value={nf.iva_compras} onValueChange={v=>setNf(p=>({...p,iva_compras:v}))}><SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="factura">Blanco</SelectItem><SelectItem value="adquisicion_stock">Negro</SelectItem><SelectItem value="mixto">Mixto</SelectItem></SelectContent></Select></div>
              <div><Label className="text-xs">IVA Ventas</Label><Select value={nf.iva_ventas} onValueChange={v=>setNf(p=>({...p,iva_ventas:v}))}><SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="factura">Blanco</SelectItem><SelectItem value="presupuesto">Negro</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Precio Compra</Label><Input type="number" step="0.01" className="h-8 text-xs" value={nf.precio_compra||""} onChange={e=>setNf(p=>({...p,precio_compra:parseFloat(e.target.value)||0}))}/></div>
              <div><Label className="text-xs">Margen %</Label><Input type="number" step="0.1" className="h-8 text-xs" value={nf.porcentaje_ganancia||""} onChange={e=>setNf(p=>({...p,porcentaje_ganancia:parseFloat(e.target.value)||0}))}/></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={()=>setShowNew(false)}>Cancelar</Button>
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={async()=>{ if(!nf.sku.trim()||!nf.descripcion.trim()){alert("SKU y Descripción son obligatorios");return}; const{data:newArt,error}=await sb.from("articulos").insert({...nf,activo:true}).select("id").single(); if(error){alert(`Error: ${error.message}`);return}; if(newArt?.id) fetch("/api/embed",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entity:"articulos",id:newArt.id})}).catch(()=>{}); setShowNew(false); setNf({sku:"",descripcion:"",categoria:"",rubro:"",iva_compras:"factura",iva_ventas:"factura",precio_compra:0,porcentaje_ganancia:0}); load() }}>Crear</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import / Export */}
      <Dialog open={showImpExp} onOpenChange={setShowImpExp}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              <div className="flex gap-1 p-0.5 bg-slate-100 rounded-lg w-fit">
                <button onClick={()=>setIeTab("export")} className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${ieTab==="export"?"bg-white shadow text-slate-800":"text-slate-500 hover:text-slate-700"}`}><FileDown className="h-3.5 w-3.5"/>Exportar</button>
                <button onClick={()=>setIeTab("import")} className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${ieTab==="import"?"bg-white shadow text-slate-800":"text-slate-500 hover:text-slate-700"}`}><FileUp className="h-3.5 w-3.5"/>Importar</button>
              </div>
            </DialogTitle>
          </DialogHeader>

          {ieTab==="export"&&(
            <div className="space-y-4 mt-2">
              <p className="text-xs text-slate-500">Seleccioná las columnas a exportar. Sin selección exporta todas.</p>
              <div className="grid grid-cols-3 gap-1.5">
                {ALL_EXPORT_FIELDS.map(col=>(
                  <button key={col} onClick={()=>setExpCols(p=>{const n=new Set(p);n.has(col)?n.delete(col):n.add(col);return n})} className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-medium transition-all text-left ${expCols.has(col)?"bg-indigo-50 border-indigo-300 text-indigo-700":"bg-white border-slate-100 text-slate-600 hover:border-slate-300"}`}>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${expCols.has(col)?"bg-indigo-600 border-indigo-600":"border-slate-300"}`}>
                      {expCols.has(col)&&<Check className="h-2.5 w-2.5 text-white"/>}
                    </div>
                    {col}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-xs text-slate-400">{expCols.size>0?`${expCols.size} columnas seleccionadas`:"Todas las columnas"}</span>
                <div className="flex gap-2">
                  {expCols.size>0&&<Button variant="outline" size="sm" onClick={()=>setExpCols(new Set())}>Limpiar</Button>}
                  <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={handleExport} disabled={exporting}>
                    <Download className="h-3.5 w-3.5 mr-1.5"/>{exporting?"Exportando...":"Descargar Excel"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {ieTab==="import"&&(
            <div className="space-y-3 mt-2">
              <p className="text-xs text-slate-500">Importá artículos desde Excel. El sistema detecta automáticamente las columnas y te muestra una preview de los cambios antes de confirmar.</p>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-500 space-y-1">
                <p className="font-semibold text-slate-700">Campos soportados:</p>
                <p>sku, ean13, descripcion, unidades_por_bulto, proveedor_codigo, marca_codigo, categoria, subcategoria, precio_compra, porcentaje_ganancia, bonif_recargo, iva_compras, iva_ventas, precio_base, precio_base_contado</p>
                <p className="font-semibold text-slate-700 mt-1">Descuentos tipados:</p>
                <p>descuento_comercial, descuento_financiero, descuento_promocional — Formato: "10+5"</p>
              </div>
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={()=>{ setShowImpExp(false); setShowImporter(true) }}>
                <Upload className="h-3.5 w-3.5 mr-1.5"/>Abrir importador con mapeo de columnas
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ImportArticulosDialog open={showImporter} onOpenChange={setShowImporter} onImportComplete={()=>load()}/>
    </div>
  )
}
