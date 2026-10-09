"use client"

import { FichaArticulo } from "@/components/articulos/ficha-articulo"
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
  FileDown, FileUp, SlidersHorizontal, X, Pencil, ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react"
import { ImportArticulosDialog, articulosFieldLabel, articulosValueFormat } from "@/components/articulos/ImportArticulosDialog"
import { HistorialImportacionesDialog } from "@/components/import/HistorialImportacionesDialog"
import { History } from "lucide-react"
import { toast } from "sonner"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { FiltroColumnaMenu, ChipsFiltros, textoChip } from "@/components/search/filtro-columna"
import { filtroActivo, type Filtros, type FiltroColumna, type OpcionFiltro } from "@/lib/search/facetas"
import * as XLSX from "xlsx"
import { InputMonto } from "@/components/ui/input-monto"
import { entero, moneda, porcentaje, redondear } from "@/lib/formato"
import { calcularPrecioBase, calcularPrecioFinal, articuloToDatosArticulo, resumirDescuentos, determinarGrupoPrecio, type DatosLista, type MetodoFacturacion, type DescuentoTipado } from "@/lib/pricing/calculator"
import { calcularPreciosConFormulas, SUBLISTA_CODIGOS, SUBLISTA_META, type SublistaCodigo } from "@/lib/pricing/formula-evaluator"
import { cargarTiposArticulo, opcionesCon, TIPOS_BULTO_DEFAULT, TIPOS_FRACCION_DEFAULT } from "@/lib/catalogos/tipos-articulo"

// ─── Types ───────────────────────────────────────────────────────────────────
type Mode = "compras" | "ventas" | "gestion"
interface LP { id:string; nombre:string; codigo:string; recargo_limpieza_bazar:number; recargo_perfumeria_negro:number; recargo_perfumeria_blanco:number }
interface ReglaPrecioFila { grupo_precio:string; iva_compras:string; iva_ventas:string; formulas:Record<string,string> }

// ─── Column definitions ───────────────────────────────────────────────────────
const BASE_COLS = [
  { id:"desc",   label:"Descripción",  dw:290, mw:140 },
  { id:"sku",    label:"SKU",          dw:95,  mw:65  },
  { id:"ean13",  label:"EAN 13",       dw:135, mw:80  },
  { id:"ubulto", label:"×Bulto",       dw:75,  mw:55  },
  { id:"prov",   label:"Proveedor",    dw:150, mw:70  },
  { id:"marca",  label:"Marca",        dw:120, mw:70  },
  { id:"cat",    label:"Categoría",    dw:140, mw:70  },
  { id:"subcat", label:"Subcategoría", dw:150, mw:70  },
  { id:"oferta",    label:"Oferta",       dw:85,  mw:60  },
  { id:"segprecio", label:"Seg. precio",  dw:110, mw:75  },
]
const COMPRAS_COLS = [
  { id:"plista",  label:"P. lista",    dw:120, mw:80 },
  { id:"desctos", label:"Desc.",       dw:100, mw:65 },
  { id:"marg",    label:"Margen %",    dw:95,  mw:60 },
  { id:"br",      label:"B/R %",       dw:80,  mw:55 },
  { id:"ucosto",  label:"Últ. costo",  dw:120, mw:80 },
  { id:"ivac",    label:"IVA C.",      dw:75,  mw:55 },
  { id:"ivav",    label:"IVA V.",      dw:75,  mw:55 },
]
const VENTAS_COLS = [
  { id:"pbase",   label:"P. base",    dw:140, mw:90 },
  { id:"pbcont",  label:"Contado",    dw:135, mw:90 },
  { id:"ivac_v",  label:"IVA C.",     dw:75, mw:55 },
  { id:"ivav_v",  label:"IVA V.",     dw:75, mw:55 },
]
// Ancho de cada columna de lista de precios (Bahía, Neco, Viajante) si no se ajustó a mano
const ANCHO_SUBLISTA = 150
// Lo que cada usuario acomoda (columnas, anchos, listas, modo) queda guardado en su computadora
const VISTA_KEY = "articulos:vista:v1"
// "$1.234,56" para mostrar (docs/FORMATOS.md); el valor guardado no cambia
const fmtPrecio=(n:number|null|undefined)=>n==null||!isFinite(n)?"—":moneda(n)

// Celda de precio: muestra el número con formato y al tocarla abre la casilla de edición de siempre
function PrecioEditable({ texto, tono = "", children }: { texto: React.ReactNode; tono?: string; children: React.ReactNode }) {
  const [editando, setEditando] = useState(false)
  if (editando) return <div onBlur={() => setEditando(false)}>{children}</div>
  return (
    <button type="button" onClick={() => setEditando(true)} onFocus={() => setEditando(true)}
      className={`block w-full truncate rounded px-1 py-0.5 text-right font-mono text-[13px] font-semibold tabular-nums hover:bg-white/80 hover:ring-1 hover:ring-neutro-200 ${tono}`}>
      {texto}
    </button>
  )
}
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

// Map column ID → DB field name (direct articulos fields)
const COL_DB: Record<string, string> = {
  desc:   "descripcion",
  sku:    "sku",
  ean13:  "ean13",
  ubulto: "unidades_por_bulto",
  cat:    "categoria",
  subcat: "subcategoria",
  oferta: "descuento_propio",
  plista: "precio_compra",
  marg:   "porcentaje_ganancia",
  br:     "bonif_recargo",
  ivac:   "iva_compras",
  ivav:   "iva_ventas",
  pbase:  "precio_base",
  pbcont: "precio_base_contado",
  ucosto: "ultimo_costo",
  ivac_v:    "iva_compras",
  ivav_v:    "iva_ventas",
  segprecio: "segmento_precio",
}
// Orden y filtros los resuelve /api/articulos/listado (mismos ids de columna)
const isSortable = (col: string) => !!COL_DB[col] || col === "prov" || col === "marca" || col === "ucosto"
// Filtros por encabezado (tipo Excel): columnas con "tildar valores" y con "desde / hasta".
// Las de IVA existen en modo compras y ventas: comparten el mismo filtro.
const FILTRO_VALORES = new Set(["ubulto","prov","marca","cat","subcat","oferta","segprecio","ivac","ivav"])
const FILTRO_NUMERO  = new Set(["plista","marg","br","ucosto","pbase","pbcont"])
const filtroKey = (col: string) => col === "ivac_v" ? "ivac" : col === "ivav_v" ? "ivav" : col
const COL_TITULO: Record<string,string> = Object.fromEntries([...BASE_COLS,...COMPRAS_COLS,...VENTAS_COLS].map(c=>[c.id,c.label]))
const SELECT_FILA = "*,proveedor:proveedores(nombre,tipo_descuento),marca:marca_id(codigo,descripcion)"

// ─── Component ───────────────────────────────────────────────────────────────
export default function ArticulosPage() {
  const sb = createClient()

  // Core data
  const [arts,setArts]   = useState<any[]>([])
  const [dm,setDm]       = useState<Record<string,DescuentoTipado[]>>({})
  const [tc,setTc]       = useState(0)
  const [pg,setPg]       = useState(0)
  // Lista completa de ids (ya filtrada y ordenada por el servidor) para la combinación
  // actual de texto + proveedor + filtros + orden. Cambiar de página no vuelve a pedirla.
  const listado = useRef<{key:string; ids:string[]}|null>(null)
  // Hubo cambios guardados desde esta pantalla: la próxima lista se pide sin caché
  const sucio = useRef(false)
  const [filtros,setFiltros] = useState<Filtros>({})
  const [facetas,setFacetas] = useState<Record<string,OpcionFiltro[]>>({})
  const [provs,setProvs] = useState<any[]>([])
  const [marcas,setMarcas] = useState<any[]>([])
  const [listas,setListas] = useState<LP[]>([])
  const [rubrosData,setRubrosData]       = useState<any[]>([])
  const [categoriasData,setCategoriasData] = useState<any[]>([])
  const [subcategoriasData,setSubcategoriasData] = useState<any[]>([])
  const [rubroQ,setRubroQ]   = useState(""); const [rubroOpen,setRubroOpen]   = useState(false)
  const [catQ,setCatQ]       = useState(""); const [catOpen,setCatOpen]       = useState(false)
  const [subcatQ,setSubcatQ] = useState(""); const [subcatOpen,setSubcatOpen] = useState(false)
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

  // Image upload state
  const [imgUploading,setImgUploading] = useState(false)

  // Selección masiva
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [bulkFields, setBulkFields] = useState<Set<string>>(new Set())
  const [bulkVals, setBulkVals] = useState<Record<string,any>>({})
  const [bulkSaving, setBulkSaving] = useState(false)

  // Sort
  const [sortCol, setSortCol] = useState<string|null>(null)
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc")

  // Import/Export
  const [showImpExp,setShowImpExp] = useState(false)
  const [ieTab,setIeTab]           = useState<"export"|"import">("export")
  const [expCols,setExpCols]       = useState<Set<string>>(new Set())
  const [exporting,setExporting]   = useState(false)
  const [showImporter,setShowImporter] = useState(false)
  const [showHistorial,setShowHistorial] = useState(false)
  const [tiposBulto,setTiposBulto] = useState<string[]>(TIPOS_BULTO_DEFAULT)
  const [tiposFraccion,setTiposFraccion] = useState<string[]>(TIPOS_FRACCION_DEFAULT)

  // ── Vista guardada (columnas ocultas, anchos, listas y modo) ─────────────────
  const [vistaLista,setVistaLista]=useState(false)
  useEffect(()=>{
    try{
      const v=JSON.parse(localStorage.getItem(VISTA_KEY)||"null")
      if(v){
        if(Array.isArray(v.hid)) setHid(new Set(v.hid))
        if(v.cw&&typeof v.cw==="object") setCw(p=>({...p,...v.cw}))
        if(v.lcw&&typeof v.lcw==="object") setLcw(v.lcw)
        if(Array.isArray(v.sub)) setActiveSublistas(v.sub.filter((c:string)=>(SUBLISTA_CODIGOS as readonly string[]).includes(c)))
        if(v.mode==="compras"||v.mode==="ventas") setMode(v.mode)
      }
    }catch{}
    setVistaLista(true)
  },[])
  useEffect(()=>{
    if(!vistaLista||rc) return // mientras se arrastra un ancho no se guarda en cada movimiento
    try{ localStorage.setItem(VISTA_KEY,JSON.stringify({hid:[...hid],cw,lcw,sub:activeSublistas,mode})) }catch{}
  },[vistaLista,rc,hid,cw,lcw,activeSublistas,mode])

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(()=>{
    (async()=>{
      const [{data:p},{data:m},{data:l},{data:r},{data:rub},{data:cat},{data:sub},tipos] = await Promise.all([
        sb.from("proveedores").select("id,nombre").eq("activo",true).order("nombre"),
        sb.from("marcas").select("id,codigo,descripcion").eq("activo",true).order("descripcion"),
        sb.from("listas_precio").select("*").eq("activo",true).order("nombre"),
        sb.from("listas_precio_reglas").select("grupo_precio,iva_compras,iva_ventas,formulas"),
        sb.from("rubros").select("id,nombre,slug").order("orden"),
        sb.from("categorias").select("id,rubro_id,nombre").order("orden"),
        sb.from("subcategorias").select("id,categoria_id,nombre").order("orden"),
        cargarTiposArticulo(sb),
      ])
      setTiposBulto(tipos.tiposBulto); setTiposFraccion(tipos.tiposFraccion)
      if(p) setProvs(p)
      if(m) setMarcas(m)
      if(l) setListas(l)
      if(r) setReglasFormulas(r as ReglaPrecioFila[])
      if(rub) setRubrosData(rub)
      if(cat) setCategoriasData(cat)
      if(sub) setSubcategoriasData(sub)
    })()
  },[])
  useEffect(()=>{ const t=setTimeout(()=>{setSd(st);setPg(0)},400); return()=>clearTimeout(t) },[st])
  useEffect(()=>{ load() },[pf,sd,pg,sortCol,sortDir,filtros])

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
  // Ids de TODOS los artículos que cumplen texto + proveedor + filtros, en el orden
  // pedido. Lo resuelve /api/articulos/listado (que también devuelve las opciones de
  // cada filtro con su cantidad). Se guarda en `listado` y se reutiliza al paginar.
  const pedirListado=async(forzar=false):Promise<string[]>=>{
    const cuerpo={q:sd.trim(),proveedor:pf!=="todos"?pf:null,filtros,orden:sortCol?{col:sortCol,dir:sortDir}:null}
    const key=JSON.stringify(cuerpo)
    if(!forzar&&!sucio.current&&listado.current?.key===key) return listado.current.ids
    const fresco=forzar||sucio.current; sucio.current=false
    const res=await fetch("/api/articulos/listado",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...cuerpo,fresco})})
    if(!res.ok) throw new Error((await res.json().catch(()=>({}))).error||`Error ${res.status}`)
    const data=await res.json()
    listado.current={key,ids:data.ids||[]}
    setFacetas(data.facetas||{})
    return listado.current.ids
  }
  // Trae las filas completas de unos ids, respetando su orden
  const hidratar=async(ids:string[],select=SELECT_FILA):Promise<any[]>=>{
    if(ids.length===0) return []
    const{data}=await sb.from("articulos").select(select).in("id",ids)
    const pos=new Map(ids.map((id,i)=>[id,i]))
    return (data||[]).sort((x:any,y:any)=>pos.get(x.id)!-pos.get(y.id)!)
  }

  const pedido=useRef(0)
  const load=async(forzar=false)=>{
    const mio=++pedido.current
    setLd(true)
    let a:any[]=[], total=0
    try {
      const ids=await pedirListado(forzar)
      total=ids.length
      a=await hidratar(ids.slice(pg*PS,(pg+1)*PS))
    } catch(e:any) { console.error("[articulos] listado:",e?.message); a=[]; total=0 }
    // Si mientras tanto se pidió otra cosa (otra tecla, otro filtro), esta respuesta ya no sirve
    if(mio!==pedido.current) return

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
    setSav(false); setEd(new Map()); sucio.current=true; toast.success(`${ok} artículo(s) actualizados`)
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

  // Listas de "Tipo de bulto" y "Tipo de fracción": vienen de las tablas tipos_bulto / tipos_fraccion
  // (ABM en /tablas/tipos-bulto y /tablas/tipos-fraccion), cargadas en el init como `tiposBulto` / `tiposFraccion`.
  // Si un artículo trae un valor que no está activo en la lista, se muestra como opción "(actual)" para no perderlo.
  const UNIDADES_MEDIDA = tiposBulto
  const TIPOS_FRACCION  = tiposFraccion

  // Ficha (unificado crear + editar)
  const BLANK_FF = {descripcion:"",sku:"",ean13:[] as string[],unidades_por_bulto:1,unidad_de_medida:"",marca_id:null as string|null,categoria:"",subcategoria:"",rubro:"",rubro_id:null as string|null,precio_compra:0,porcentaje_ganancia:0,bonif_recargo:0,iva_compras:"factura",iva_ventas:"factura",proveedor_id:null as string|null,orden_deposito:0,precio_base:null as number|null,precio_base_contado:null as number|null,precio_lista_especial:null as number|null,oferta_lista_especial:null as number|null,descuento_propio:0,imagen_url:"",tipo_fraccion:"",cantidad_fraccion:null as number|null,segmento_precio:null as string|null}
  const normIvaC=(v:any)=>v==="adquisicion_stock"?"adquisicion_stock":v==="mixto"?"mixto":v==="0"?"adquisicion_stock":"factura"
  const normIvaV=(v:any)=>v==="presupuesto"?"presupuesto":v==="0"?"presupuesto":"factura"
  const ofa=(a:any)=>{ setFa(a); setRubroQ(""); setCatQ(""); setSubcatQ(""); setFf({descripcion:a.descripcion||"",sku:a.sku||"",ean13:Array.isArray(a.ean13)?a.ean13:(a.ean13?[a.ean13]:[]),unidades_por_bulto:a.unidades_por_bulto||1,unidad_de_medida:a.unidad_de_medida||"",marca_id:a.marca_id||null,categoria:a.categoria||"",subcategoria:a.subcategoria||"",rubro:a.rubro||"",rubro_id:a.rubro_id||null,precio_compra:a.precio_compra||0,porcentaje_ganancia:a.porcentaje_ganancia||0,bonif_recargo:a.bonif_recargo||0,iva_compras:normIvaC(a.iva_compras),iva_ventas:normIvaV(a.iva_ventas),proveedor_id:a.proveedor_id||null,orden_deposito:a.orden_deposito||0,precio_base:a.precio_base??null,precio_base_contado:a.precio_base_contado??null,precio_lista_especial:a.precio_lista_especial??null,oferta_lista_especial:a.oferta_lista_especial??null,descuento_propio:a.descuento_propio??0,imagen_url:a.imagen_url||"",tipo_fraccion:a.tipo_fraccion||"",cantidad_fraccion:a.cantidad_fraccion??null,segmento_precio:a.segmento_precio??null}) }
  const openNew=()=>{ setFa({id:"__new__"}); setFf({...BLANK_FF}) }
  // Campos con FK a catálogos (tipos_bulto / tipos_fraccion): "" no existe en la
  // tabla referida → la base rechaza el guardado. Vacío = null.
  const FK_TEXTO=["unidad_de_medida","tipo_fraccion"] as const
  const sinVaciosFK=<T extends Record<string,any>>(o:T):T=>{ const r:Record<string,any>={...o}; for(const k of FK_TEXTO) if(k in r && (r[k]===""||r[k]===undefined)) r[k]=null; return r as T }
  const sfa=async()=>{
    if(!fa) return; setFs(true)
    const isNew=fa.id==="__new__"
    if(isNew){
      if(!ff.sku.trim()||!ff.descripcion.trim()){ toast.error("SKU y Descripción son obligatorios"); setFs(false); return }
      const{data:newArt,error}=await sb.from("articulos").insert({...sinVaciosFK(ff),activo:true}).select("id").single()
      if(error){ toast.error(`Error: ${error.message}`); setFs(false); return }
      if(newArt?.id) fetch("/api/embed",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entity:"articulos",id:newArt.id})}).catch(()=>{})
      setFa(null); load(true)
    } else {
      const{error}=await sb.from("articulos").update(sinVaciosFK(ff)).eq("id",fa.id)
      if(!error){
        const prov=provs.find((p:any)=>p.id===ff.proveedor_id)
        const marc=marcas.find((m:any)=>m.id===ff.marca_id)
        setArts(p=>p.map(a=>a.id===fa.id?{...a,...ff,proveedor:prov?{nombre:prov.nombre}:null,marca:marc?{codigo:marc.codigo,descripcion:marc.descripcion}:null}:a))
        fetch("/api/embed",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entity:"articulos",id:fa.id})}).catch(()=>{})
        sucio.current=true
        setFa(null)
      } else toast.error(`Error: ${error.message}`)
    }
    setFs(false)
  }
  const handleImgUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0]; if(!file) return
    setImgUploading(true)
    try{
      const fd=new FormData()
      fd.append("file",file)
      if(fa?.id && fa.id!=="__new__") fd.append("articuloId",fa.id)
      const res=await fetch("/api/articulos/imagen",{method:"POST",body:fd})
      const data=await res.json()
      if(res.ok && data.url){ setFf(p=>({...p,imagen_url:data.url})) }
      else toast.error(`Error subiendo imagen: ${data.error||res.statusText}`)
    }catch(err:any){ toast.error(`Error subiendo imagen: ${err.message}`) }
    finally{ setImgUploading(false); e.target.value="" }
  }

  // Sublista columns
  const tglSublista=(c:SublistaCodigo)=>setActiveSublistas(p=>p.includes(c)?p.filter(x=>x!==c):[...p,c])
  const getFormulasParaArticulo=(art:any):Record<string,string>|null=>{
    const grupo=determinarGrupoPrecio(art.categoria||art.rubro||"",art.rubro_slug||art.rubros?.slug,art.segmento_precio)
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
      // Exporta exactamente lo que se ve: texto + proveedor + filtros por columna, en el
      // mismo orden. Las filas se traen en tandas (el .in() de muchos ids no entra en una URL).
      const ids=await pedirListado()
      const tandas:string[][]=[]
      for(let i=0;i<ids.length;i+=300) tandas.push(ids.slice(i,i+300))
      const partes=await Promise.all(tandas.map(t=>hidratar(t,"*,proveedor:proveedores(nombre),marca:marca_id(descripcion)")))
      const data:any[]=partes.flat()
      const fieldMap:Record<string,(a:any)=>any>={
        "SKU":a=>a.sku,"EAN13":a=>a.ean13?.join(', ')||"","Descripción":a=>a.descripcion,"Unid/Bulto":a=>a.unidades_por_bulto||"",
        "Proveedor":a=>a.proveedor?.nombre||"","Marca":a=>a.marca?.descripcion||"","Categoría":a=>a.categoria||"","Subcategoría":a=>a.subcategoria||"",
        "P. Lista":a=>a.precio_compra||0,"Margen %":a=>a.porcentaje_ganancia||0,"B/R %":a=>a.bonif_recargo||0,
        "IVA Compras":a=>a.iva_compras||"","IVA Ventas":a=>a.iva_ventas||"","P. Base":a=>a.precio_base||"","P. Contado":a=>a.precio_base_contado||"",
      }
      const cols=expCols.size>0?[...expCols]:ALL_EXPORT_FIELDS
      if(data.length===0){ toast.error("No hay artículos para exportar con el filtro actual."); setExporting(false); return }
      const rows=data.map((a:any)=>Object.fromEntries(cols.map(c=>[c,fieldMap[c]?.(a)??""]) ))
      const ws=XLSX.utils.json_to_sheet(rows); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Artículos")
      const wo=XLSX.write(wb,{bookType:"xlsx",type:"array"}); const bl=new Blob([wo],{type:"application/octet-stream"})
      const u=URL.createObjectURL(bl); const lk=document.createElement("a"); lk.href=u; lk.download="articulos.xlsx"; lk.click(); URL.revokeObjectURL(u)
    } catch(e:any){ toast.error(`Error: ${e.message}`) }
    setExporting(false)
  }

  // Helpers
  const fmt=(n:number)=>n>0?moneda(n):"—"
  const icC=(v:string)=>v==="factura"?"+":v==="mixto"?"½":"0"
  // Selección masiva — helpers
  const pageIds = arts.map(a=>a.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every(id=>sel.has(id))
  const somePageSelected = pageIds.some(id=>sel.has(id))
  const toggleSel = (id:string) => setSel(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  const toggleSelAll = () => {
    if(allPageSelected) setSel(p=>{ const n=new Set(p); pageIds.forEach(id=>n.delete(id)); return n })
    else setSel(p=>{ const n=new Set(p); pageIds.forEach(id=>n.add(id)); return n })
  }
  const clearSel = () => setSel(new Set())

  const handleSort = (colId: string) => {
    if(!isSortable(colId)) return
    if(sortCol===colId) setSortDir(d=>d==="asc"?"desc":"asc")
    else { setSortCol(colId); setSortDir("asc") }
    setPg(0)
  }
  // Filtros por encabezado
  const setFiltro=(col:string,f:FiltroColumna|null)=>{
    const k=filtroKey(col)
    setFiltros(p=>{ const n={...p}; if(f) n[k]=f; else delete n[k]; return n })
    setPg(0)
  }
  const ordenarCol=(col:string,dir:"asc"|"desc")=>{ setSortCol(col); setSortDir(dir); setPg(0) }
  // Función (no componente) para que el menú no se desmonte en cada render
  const menuFiltro=(col:string)=>{
    const tipo=FILTRO_VALORES.has(filtroKey(col))?"valores":FILTRO_NUMERO.has(col)?"numero":null
    if(!tipo) return null
    return(
      <FiltroColumnaMenu
        titulo={COL_TITULO[col]||col}
        tipo={tipo}
        opciones={facetas[filtroKey(col)]}
        cargando={ld}
        filtro={filtros[filtroKey(col)]}
        onFiltro={f=>setFiltro(col,f)}
        orden={sortCol===col?sortDir:null}
        onOrden={isSortable(col)?(d=>ordenarCol(col,d)):undefined}
      />
    )
  }
  const chips=Object.entries(filtros).filter(([,f])=>filtroActivo(f)).map(([k,f])=>({id:k,texto:textoChip(COL_TITULO[k]||k,f,facetas[k])}))
  const SortIcon = ({col}:{col:string}) => {
    if(!isSortable(col)) return null
    if(sortCol!==col) return <ArrowUpDown className="h-2.5 w-2.5 opacity-0 group-hover:opacity-40 transition-opacity flex-shrink-0"/>
    return sortDir==="asc"
      ? <ArrowUp className="h-2.5 w-2.5 text-indigo-600 flex-shrink-0"/>
      : <ArrowDown className="h-2.5 w-2.5 text-indigo-600 flex-shrink-0"/>
  }

  const bulkSave = async () => {
    if(sel.size===0||bulkFields.size===0) return
    setBulkSaving(true)
    const updates:Record<string,any>={}
    for(const f of bulkFields) updates[f]=bulkVals[f]??null
    for(const k of FK_TEXTO) if(updates[k]==="") updates[k]=null
    // Rubro / Categoría / Subcategoría van juntos (cascada) y se guardan igual que la ficha:
    // rubro (texto) + rubro_id + categoria/subcategoria (texto); el trigger sincroniza los FK.
    if(bulkFields.has("taxonomia")){
      delete updates.taxonomia
      const r=rubrosData.find((x:any)=>x.id===bulkVals.tax_rubro_id)
      if(!r){ toast.error("Elegí un rubro para aplicar la clasificación"); setBulkSaving(false); return }
      updates.rubro=r.nombre; updates.rubro_id=r.id
      updates.categoria=bulkVals.tax_categoria||""; updates.subcategoria=bulkVals.tax_subcategoria||""
    }
    let ok=0
    const updatedIds=new Set<string>()
    for(const id of sel){
      const{error}=await sb.from("articulos").update(updates).eq("id",id)
      if(!error){ ok++; updatedIds.add(id) }
    }
    // Actualizar arts y caché de búsqueda con los nuevos valores
    const applyUpdates=(list:any[])=>list.map(a=>updatedIds.has(a.id)?{...a,...updates}:a)
    setArts(p=>applyUpdates(p))
    sucio.current=true // lo editado puede haber cambiado de filtro: la próxima carga pide la lista de nuevo
    setBulkSaving(false); setShowBulkEdit(false); setBulkFields(new Set()); setBulkVals({}); clearSel()
    toast.success(`${ok} artículo(s) actualizados`)
  }

  const bulkDelete = async () => {
    if(sel.size===0) return
    if(!confirm(`¿Dar de baja ${sel.size} artículo(s) seleccionados? Quedarán inactivos y no aparecerán en búsquedas ni pedidos.`)) return
    let ok=0
    for(const id of sel){ const{error}=await sb.from("articulos").update({activo:false}).eq("id",id); if(!error) ok++ }
    clearSel(); await load(true); toast.success(`${ok} artículo(s) dado(s) de baja`)
  }

  const toggleBulkField = (f:string, defaultVal:any=null) => {
    setBulkFields(p=>{ const n=new Set(p); if(n.has(f)){n.delete(f)}else{n.add(f);setBulkVals(v=>({...v,[f]:v[f]??defaultVal}))} return n })
  }

  const icV=(v:string)=>v==="factura"?"+":"0"
  const ccC=(v:string)=>v==="factura"?"bg-blue-100 text-blue-700":v==="mixto"?"bg-amber-100 text-amber-700":"bg-neutral-100 text-neutral-500"
  const ccV=(v:string)=>v==="factura"?"bg-blue-100 text-blue-700":"bg-neutral-100 text-neutral-500"
  const visBase=BASE_COLS.filter(c=>isVis(c.id))
  const visCompras=COMPRAS_COLS.filter(c=>isVis(c.id))
  const visVentas=VENTAS_COLS.filter(c=>isVis(c.id))
  const isVisIvaC=isVis("ivac")&&isVis("ivac_v")
  const isVisIvaV=isVis("ivav")&&isVis("ivav_v")
  const listRowH=mode==="ventas"&&activeSublistas.length>0?54:42
  const ANCHO_CHECK=36
  const anchoTabla=ANCHO_CHECK
    +visBase.reduce((t,c)=>t+(cw[c.id]??c.dw),0)
    +(mode==="compras"?visCompras.reduce((t,c)=>t+(cw[c.id]??c.dw),0):0)
    +(mode==="ventas"?visVentas.reduce((t,c)=>t+(cw[c.id]??c.dw),0)+activeSublistas.reduce((t,c)=>t+(lcw[c]||ANCHO_SUBLISTA),0):0)
    +(mode==="gestion"?120:0)

  return (
    <div className="flex h-full flex-col bg-neutro-50" style={{userSelect:rc?"none":undefined}}>

      {/* ═══ HEADER ═══════════════════════════════════════════════════════════ */}
      <div className="bg-white border-b px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azul-900">Artículos</h1>
          <p className="text-sm text-neutro-500">{entero(tc)} artículos · página {pg+1} de {tp||1}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode tabs */}
          <div className="inline-flex rounded-lg bg-neutro-100 p-0.5 text-sm font-semibold" role="tablist" aria-label="Qué precios ver">
            <button onClick={()=>setMode("compras")} role="tab" aria-selected={mode==="compras"} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${mode==="compras"?"bg-white text-ambar-700 shadow-sm":"text-neutro-500 hover:text-neutro-800"}`}>
              <ShoppingCart className="h-4 w-4"/>Compras
            </button>
            <button onClick={()=>setMode("ventas")} role="tab" aria-selected={mode==="ventas"} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${mode==="ventas"?"bg-white text-azul-700 shadow-sm":"text-neutro-500 hover:text-neutro-800"}`}>
              <TrendingUp className="h-4 w-4"/>Ventas
            </button>
            <button disabled title="Próximamente: stock y depósito" className="flex cursor-not-allowed items-center gap-1.5 rounded-md px-3 py-1.5 text-neutro-300">
              <Package className="h-4 w-4"/>Gestión
            </button>
          </div>

          <div className="hidden h-7 w-px bg-neutro-200 sm:block"/>

          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={openNew}>
            <Plus className="h-4 w-4"/>Nuevo
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={()=>{setShowImpExp(true);setIeTab("export")}}>
            <FileDown className="h-4 w-4"/>Exportar
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={()=>{setShowImpExp(true);setIeTab("import")}}>
            <FileUp className="h-4 w-4"/>Importar
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={()=>setShowHistorial(true)}>
            <History className="h-4 w-4"/>Historial
          </Button>
          {ed.size>0&&(
            <Button size="sm" className="h-9 gap-1.5 bg-exito-600 hover:bg-exito-700" onClick={gsv} disabled={sav}>
              <Save className="h-4 w-4"/>{sav?"Guardando...":`Guardar cambios (${ed.size})`}
            </Button>
          )}
        </div>
      </div>

      {/* ═══ FILTER BAR ════════════════════════════════════════════════════════ */}
      <div className="bg-white border-b px-4 py-2.5 sm:px-6 flex gap-3 items-center flex-wrap flex-shrink-0">
        {/* Proveedor */}
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-neutro-600">Proveedor</span>
          <EntitySearchSelect
            entity="proveedores"
            className="w-[220px]"
            placeholder="Todos..."
            value={pf !== "todos" ? ((provs.find((p: any) => p.id === pf) as any) ?? null) : null}
            onSelect={(p: any) => { setPf(p ? p.id : "todos"); setPg(0) }}
          />
        </div>
        {/* Search */}
        <div className="relative min-w-[220px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutro-400"/>
          <Input value={st} onChange={e=>setSt(e.target.value)} placeholder="Descripción, SKU, EAN..." className="pl-9"/>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Listas panel (Ventas only) */}
          {mode==="ventas"&&(
            <div className="relative" ref={listaRef}>
              <button onClick={()=>setShowListaPanel(p=>!p)} className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] font-semibold transition-all ${showListaPanel?"bg-indigo-600 text-white border-indigo-600":"bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700"}`}>
                <TrendingUp className="h-3 w-3"/>Listas
                {activeSublistas.length>0&&<span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none ${showListaPanel?"bg-white/20 text-white":"bg-indigo-100 text-indigo-700"}`}>{activeSublistas.length}</span>}
                <ChevronDown className={`h-3 w-3 transition-transform ${showListaPanel?"rotate-180":""}`}/>
              </button>
              {showListaPanel&&(
                <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl w-56 py-3 overflow-hidden">
                  <div className="px-3 pb-2 mb-1 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutro-500">Columnas de precios</span>
                    {activeSublistas.length>0&&<button onClick={()=>setActiveSublistas([])} className="text-[10px] text-red-500 font-semibold hover:text-red-700">Limpiar</button>}
                  </div>
                  {(["bahia","neco","viajante"] as const).map(grupo=>{
                    const ac=SL_ACCENT[grupo]
                    const codigos=SUBLISTA_CODIGOS.filter(c=>SUBLISTA_META[c].grupo===grupo)
                    return(
                      <div key={grupo} className="mb-2 last:mb-0">
                        <div className="flex items-center gap-1.5 px-3 py-1.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ac.dot}`}/>
                          <span className={`text-xs font-bold ${ac.name}`}>{grupo==="bahia"?"Bahía":grupo==="neco"?"Neco":"Viajante"}</span>
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
            <button onClick={()=>setShowColPanel(p=>!p)} className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] font-semibold transition-all ${showColPanel?"bg-slate-800 text-white border-slate-800":"bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
              <SlidersHorizontal className="h-3 w-3"/>Columnas
              {hid.size>0&&<span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none ${showColPanel?"bg-white/20 text-white":"bg-orange-100 text-orange-700"}`}>{hid.size}</span>}
              <ChevronDown className={`h-3 w-3 transition-transform ${showColPanel?"rotate-180":""}`}/>
            </button>
            {showColPanel&&(
              <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl w-52 py-2">
                <div className="px-3 pb-1.5 mb-1 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutro-500">Columnas base</span>
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
                <div className="px-3 pt-2 pb-1 mt-0.5 border-t border-slate-100">
                  <span className="text-xs font-semibold text-neutro-500">IVA / Seg. Precio</span>
                </div>
                {[
                  {vis:isVisIvaC, label:"IVA Compras", fn:()=>setHid(p=>{const n=new Set(p);isVisIvaC?(n.add("ivac"),n.add("ivac_v")):(n.delete("ivac"),n.delete("ivac_v"));return n})},
                  {vis:isVisIvaV, label:"IVA Ventas",  fn:()=>setHid(p=>{const n=new Set(p);isVisIvaV?(n.add("ivav"),n.add("ivav_v")):(n.delete("ivav"),n.delete("ivav_v"));return n})},
                  {vis:isVis("segprecio"), label:"Seg. Precio", fn:()=>tglCol("segprecio")},
                ].map(({vis,label,fn})=>(
                  <button key={label} onClick={fn} className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50 transition-colors">
                    <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${vis?"bg-slate-800 border-slate-800":"border-slate-300"}`}>
                      {vis&&<Check className="h-2.5 w-2.5 text-white"/>}
                    </div>
                    <span className="text-xs font-medium">{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ FILTROS ACTIVOS ═══════════════════════════════════════════════════ */}
      {chips.length>0&&(
        <div className="bg-white border-b px-4 py-1.5 sm:px-6 flex-shrink-0">
          <ChipsFiltros chips={chips} onQuitar={k=>setFiltro(k,null)} onLimpiar={()=>{setFiltros({});setPg(0)}}/>
        </div>
      )}

      {/* ═══ BULK ACTION BAR ═══════════════════════════════════════════════════ */}
      {sel.size>0&&(
        <div className="bg-azul-700 text-white px-4 py-2 sm:px-6 flex items-center gap-3 flex-shrink-0">
          <span className="text-sm font-semibold">{sel.size} artículo{sel.size>1?"s":""} seleccionado{sel.size>1?"s":""}</span>
          <div className="flex-1"/>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-white hover:bg-white/20 gap-1.5" onClick={()=>setShowBulkEdit(true)}>
            <Pencil className="h-3.5 w-3.5"/>Editar seleccionados
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-white hover:bg-red-500/70 gap-1.5" onClick={bulkDelete}>
            <Trash2 className="h-3.5 w-3.5"/>Eliminar seleccionados
          </Button>
          <button onClick={clearSel} className="ml-1 p-1 rounded-full hover:bg-white/20 transition-colors">
            <X className="h-4 w-4"/>
          </button>
        </div>
      )}

      {/* ═══ TABLE ════════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-auto">
          <table className="text-[13px] border-collapse" style={{tableLayout:"fixed",width:anchoTabla,minWidth:"100%"}}>
            {/* ── THEAD ── */}
            <thead className="sticky top-0 z-20">
              <tr style={{height:38}}>
                {/* Checkbox col */}
                <th className="sticky left-0 z-30 px-2 bg-neutro-100 border-r border-neutro-200" style={{width:ANCHO_CHECK}}>
                  <input type="checkbox" className="w-3.5 h-3.5 rounded cursor-pointer accent-indigo-600"
                    checked={allPageSelected} ref={el=>{if(el)el.indeterminate=somePageSelected&&!allPageSelected}}
                    onChange={toggleSelAll}/>
                </th>
                {/* Base col headers */}
                {visBase.map((c,i)=>(
                  <th key={c.id}
                    className={`relative px-2 py-1.5 font-semibold text-xs border-r border-slate-200 select-none whitespace-nowrap ${i===0?"sticky left-9 z-30 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]":""} ${sortCol===c.id?"bg-indigo-50 text-indigo-700":"bg-slate-100 text-slate-500"}`}
                    style={{width:cw[c.id],minWidth:c.mw,maxWidth:cw[c.id]}}
                    onDoubleClick={()=>tglCol(c.id)} title="Doble click para ocultar"
                  >
                    <div className="flex items-center gap-1">
                      <div className={`flex min-w-0 items-center gap-1 group ${isSortable(c.id)?"cursor-pointer":""}`} onClick={()=>handleSort(c.id)}>
                        {c.label}<SortIcon col={c.id}/>
                      </div>
                      {menuFiltro(c.id)}
                    </div>
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-10" onMouseDown={e=>sr(c.id,e)}/>
                  </th>
                ))}
                {/* Compras col headers */}
                {mode==="compras"&&visCompras.map(c=>(
                  <th key={c.id}
                    className={`relative px-2 py-1.5 text-right font-semibold text-xs text-amber-700 bg-amber-50 border-r border-amber-100 select-none whitespace-nowrap ${sortCol===c.id?"!bg-amber-100":""}`}
                    style={{width:cw[c.id],minWidth:c.mw,maxWidth:cw[c.id]}}
                    onDoubleClick={()=>tglCol(c.id)}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <div className={`flex items-center justify-end gap-1 group ${isSortable(c.id)?"cursor-pointer":""}`} onClick={()=>handleSort(c.id)}>
                        {c.label}<SortIcon col={c.id}/>
                      </div>
                      {menuFiltro(c.id)}
                    </div>
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-amber-400 z-10" onMouseDown={e=>sr(c.id,e)}/>
                  </th>
                ))}
                {/* Ventas fixed col headers */}
                {mode==="ventas"&&visVentas.map(c=>(
                  <th key={c.id}
                    className={`relative px-2 py-1.5 text-right font-semibold text-xs text-indigo-700 bg-indigo-50 border-r border-indigo-100 select-none whitespace-nowrap ${c.id==="pbcont"?"border-r-2 border-indigo-200":""} ${sortCol===c.id?"!bg-indigo-100":""}`}
                    style={{width:cw[c.id],minWidth:c.mw,maxWidth:cw[c.id]}}
                    onDoubleClick={()=>tglCol(c.id)}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <div className={`flex items-center justify-end gap-1 group ${isSortable(c.id)?"cursor-pointer":""}`} onClick={()=>handleSort(c.id)}>
                        {c.label}<SortIcon col={c.id}/>
                      </div>
                      {menuFiltro(c.id)}
                    </div>
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
                      style={{width:lcw[codigo]||ANCHO_SUBLISTA,minWidth:90}}
                      draggable onDragStart={()=>dds(i)} onDragOver={e=>ddo(e,i)} onDragEnd={()=>setDli(null)}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          <GripVertical className="h-3 w-3 opacity-40"/>
                          <div>
                            <div className={`text-[11px] font-bold ${ac.name}`}>{grupoLabel}</div>
                            <div className="text-xs font-semibold">{meta.label}</div>
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
                  <th className="px-3 py-1.5 text-center font-semibold text-xs text-emerald-700 bg-emerald-50 border-r border-emerald-100" style={{width:120}}>
                    Stock
                  </th>
                )}
              </tr>
            </thead>

            {/* ── TBODY ── */}
            <tbody>
              {ld?(
                <tr><td colSpan={99} className="py-16">
                  <div className="sticky left-0 mx-auto w-full max-w-md"><CargaProgreso compacto mensajes={MENSAJES.articulos} className="px-6"/></div>
                </td></tr>
              ):arts.length===0?(
                <tr><td colSpan={99} className="py-16 text-center text-neutro-400 text-sm normal-case">No hay artículos con esa búsqueda o filtros</td></tr>
              ):arts.map((a,idx)=>{
                const ds=dm[a.id]||[]; const dt=articuloToDatosArticulo(a,ds); const bs=calcularPrecioBase(dt); const rs=resumirDescuentos(ds)
                const ie=ed.has(a.id)
                const stripe=idx%2===0?"bg-white":"bg-neutro-50/70"
                const rowCls=`border-b border-neutro-100 hover:bg-azul-50/30 transition-colors ${ie?"!bg-ambar-50":stripe}`
                const stickyBg=ie?"#fffbeb":idx%2===0?"#ffffff":"#f8fafc"
                return(
                  <tr key={a.id} className={rowCls} style={{height:listRowH}}>
                    {/* ── Checkbox ── */}
                    <td className="sticky left-0 z-10 px-2 border-r border-neutro-100" style={{width:ANCHO_CHECK,background:stickyBg}}>
                      <input type="checkbox" className="w-3.5 h-3.5 rounded cursor-pointer accent-indigo-600"
                        checked={sel.has(a.id)} onChange={()=>toggleSel(a.id)}/>
                    </td>
                    {/* ── Base cells ── */}
                    {isVis("desc")&&(
                      <td className="px-2.5 py-0 sticky left-9 z-10 border-r border-neutro-100 overflow-hidden shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]" style={{width:cw.desc,maxWidth:cw.desc,background:stickyBg}}>
                        <button onClick={()=>ofa(a)} className="text-left block w-full overflow-hidden group">
                          <div className="font-semibold text-[13px] leading-tight truncate text-azul-900 group-hover:text-azul-600 transition-colors" title={a.descripcion}>{a.descripcion}</div>
                          {!isVis("sku")&&<div className="text-xs text-neutro-400 font-mono truncate leading-tight">{a.sku}</div>}
                        </button>
                      </td>
                    )}
                    {isVis("sku")&&<td className="px-2 py-0 border-r border-slate-100 font-mono text-[13px] text-neutro-600 overflow-hidden truncate" style={{width:cw.sku,maxWidth:cw.sku}}>{a.sku}</td>}
                    {isVis("ean13")&&<td className="px-2 py-0 border-r border-slate-100 font-mono text-xs text-neutro-500 text-center overflow-hidden truncate" style={{width:cw.ean13,maxWidth:cw.ean13}}>{a.ean13?.join(', ')||"—"}</td>}
                    {isVis("ubulto")&&<td className="px-2 py-0 border-r border-slate-100 text-center text-[13px] font-bold text-neutro-700" style={{width:cw.ubulto,maxWidth:cw.ubulto}}>{a.unidades_por_bulto||"—"}</td>}
                    {isVis("prov")&&<td className="px-2 py-0 border-r border-slate-100 overflow-hidden" style={{width:cw.prov,maxWidth:cw.prov}}><span className="text-[13px] text-neutro-600 truncate block" title={a.proveedor?.nombre||undefined}>{a.proveedor?.nombre||"—"}</span></td>}
                    {isVis("marca")&&<td className="px-2 py-0 border-r border-slate-100 overflow-hidden" style={{width:cw.marca,maxWidth:cw.marca}}><span className="text-[13px] text-neutro-600 truncate block" title={a.marca?.descripcion||undefined}>{a.marca?.descripcion||"—"}</span></td>}
                    {isVis("cat")&&<td className="px-2 py-0 border-r border-slate-100 overflow-hidden" style={{width:cw.cat,maxWidth:cw.cat}}><span className="text-[13px] text-neutro-600 truncate block" title={a.categoria||undefined}>{a.categoria||"—"}</span></td>}
                    {isVis("subcat")&&<td className="px-2 py-0 border-r border-slate-100 overflow-hidden" style={{width:cw.subcat,maxWidth:cw.subcat}}><span className="text-[13px] text-neutro-600 truncate block" title={a.subcategoria||undefined}>{a.subcategoria||"—"}</span></td>}
                    {isVis("oferta")&&<td className="px-2 py-0 border-r border-slate-100 text-center overflow-hidden" style={{width:cw.oferta,maxWidth:cw.oferta}}>{a.descuento_propio>0?<span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-alerta-50 text-alerta-600">{porcentaje(a.descuento_propio)}</span>:<span className="text-xs text-neutro-300">—</span>}</td>}
                    {isVis("segprecio")&&<td className="px-2 py-0 border-r border-slate-100 text-center overflow-hidden" style={{width:cw.segprecio,maxWidth:cw.segprecio}}>
                      {a.segmento_precio==="limpieza_bazar"
                        ?<span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-ambar-100 text-ambar-700">L/B</span>
                        :a.segmento_precio==="perfumeria"
                        ?<span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-pink-100 text-pink-700">Perf</span>
                        :<span className="inline-flex items-center rounded border border-dashed border-neutro-300 px-1.5 py-0.5 text-xs font-medium normal-case text-neutro-500" title="Se define solo, según la categoría">Auto</span>}
                    </td>}

                    {/* ── Compras cells ── */}
                    {mode==="compras"&&<>
                      {isVis("plista")&&<td className="px-1 py-0 border-r border-amber-100 bg-amber-50/30 overflow-hidden" style={{width:cw.plista,maxWidth:cw.plista}}>
                        <PrecioEditable texto={a.precio_compra?fmtPrecio(a.precio_compra):"—"} tono="text-amber-900">
                          <InputMonto autoFocus className="h-auto min-w-0 px-0 rounded-none border-0 shadow-none focus-visible:ring-0 md:text-[13px] w-full text-right text-[13px] font-mono text-amber-900 bg-white border-b border-amber-500 focus:outline-none py-0.5" value={a.precio_compra||null} onChange={v=>edt(a.id,"precio_compra",v??0)}/>
                        </PrecioEditable>
                      </td>}
                      {isVis("desctos")&&<td className="px-1 py-0 text-center border-r border-amber-100 bg-amber-50/30" style={{width:cw.desctos,maxWidth:cw.desctos}}>
                        <button onClick={()=>odm(a)} className="inline-flex flex-wrap gap-px px-1 py-0.5 rounded hover:bg-amber-100 transition-colors min-w-full justify-center">
                          {ds.length===0?<span className="text-xs text-neutro-300">+</span>:<>
                            {rs.totalComercial>0&&<span className="inline-flex items-center px-1 h-[18px] rounded text-[10px] font-bold bg-blue-100 text-blue-700">{porcentaje(rs.totalComercial)}</span>}
                            {rs.totalFinanciero>0&&<span className="inline-flex items-center px-1 h-[18px] rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">{porcentaje(rs.totalFinanciero)}</span>}
                            {rs.totalPromocional>0&&<span className="inline-flex items-center px-1 h-[18px] rounded text-[10px] font-bold bg-purple-100 text-purple-700">{porcentaje(rs.totalPromocional)}</span>}
                          </>}
                        </button>
                      </td>}
                      {isVis("marg")&&<td className="px-1 py-0 border-r border-amber-100 bg-amber-50/30" style={{width:cw.marg,maxWidth:cw.marg}}>
                        <InputMonto className="h-auto min-w-0 px-0 rounded-none border-0 shadow-none focus-visible:ring-0 md:text-[13px] w-full text-center text-[13px] font-bold text-emerald-700 bg-transparent border-b border-transparent hover:border-emerald-300 focus:border-emerald-500 focus:outline-none py-0.5" value={a.porcentaje_ganancia||null} placeholder="—" onChange={v=>edt(a.id,"porcentaje_ganancia",v??0)}/>
                      </td>}
                      {isVis("br")&&<td className="px-1 py-0 border-r border-amber-100 bg-amber-50/30" style={{width:cw.br,maxWidth:cw.br}}>
                        <InputMonto className={`h-auto min-w-0 px-0 rounded-none border-0 shadow-none focus-visible:ring-0 md:text-[11px] w-full text-center text-[11px] font-bold bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 ${(a.bonif_recargo||0)<0?"text-red-600":(a.bonif_recargo||0)>0?"text-amber-600":"text-slate-300"}`} value={a.bonif_recargo||null} placeholder="—" onChange={v=>edt(a.id,"bonif_recargo",v??0)}/>
                      </td>}
                      {isVis("ucosto")&&<td className="px-2 py-0 text-right border-r border-amber-100 bg-amber-50/30" style={{width:cw.ucosto,maxWidth:cw.ucosto}}>
                        <span className="text-[13px] font-bold font-mono text-amber-800">{fmt(bs.costoNeto)}</span>
                      </td>}
                      {isVis("ivac")&&<td className="px-1 py-0 text-center border-r border-amber-100 bg-amber-50/30" style={{width:cw.ivac,maxWidth:cw.ivac}}>
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ${ccC(a.iva_compras||"factura")}`}>{icC(a.iva_compras||"factura")}</span>
                      </td>}
                      {isVis("ivav")&&<td className="px-1 py-0 text-center border-r border-amber-100 bg-amber-50/30" style={{width:cw.ivav,maxWidth:cw.ivav}}>
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ${ccV(a.iva_ventas||"factura")}`}>{icV(a.iva_ventas||"factura")}</span>
                      </td>}
                    </>}

                    {/* ── Ventas fixed cells ── */}
                    {mode==="ventas"&&<>
                      {isVis("pbase")&&<td className="px-1 py-0 border-r border-indigo-100 bg-indigo-50/20 overflow-hidden" style={{width:cw.pbase,maxWidth:cw.pbase}}>
                        <div className="flex min-w-0 items-center gap-0.5">
                          <div className="min-w-0 flex-1">
                            <PrecioEditable texto={a.precio_base!=null?fmtPrecio(a.precio_base):(bs.precioBase>0?fmtPrecio(bs.precioBase):"—")} tono={a.precio_base!=null?"text-indigo-700":"text-neutro-400"}>
                              <InputMonto autoFocus className={`h-auto min-w-0 px-0 rounded-none border-0 shadow-none focus-visible:ring-0 md:text-[13px] w-full min-w-0 text-right text-[13px] font-mono font-bold bg-white border-b border-indigo-500 focus:outline-none py-0.5 ${a.precio_base!=null?"text-indigo-700":"text-slate-400"}`} value={a.precio_base!=null?a.precio_base:null} placeholder={fmt(bs.precioBase)} onChange={v=>{edt(a.id,"precio_base",v);edt(a.id,"precio_base_contado",v==null?null:redondear(v*0.9))}}/>
                            </PrecioEditable>
                          </div>
                          {a.precio_base!=null&&<button className="text-xs text-neutro-300 hover:text-red-500 flex-shrink-0 leading-none" title="Volver al precio calculado" onClick={()=>{edt(a.id,"precio_base",null);edt(a.id,"precio_base_contado",null)}}>×</button>}
                        </div>
                        {a.precio_base==null&&<div className="text-[10px] text-neutro-400 text-right leading-none normal-case">calculado</div>}
                      </td>}
                      {isVis("pbcont")&&<td className="px-1 py-0 border-r-2 border-indigo-200 bg-indigo-50/20 overflow-hidden" style={{width:cw.pbcont,maxWidth:cw.pbcont}}>
                        <PrecioEditable texto={a.precio_base_contado!=null?fmtPrecio(a.precio_base_contado):(a.precio_base!=null?fmtPrecio(redondear(a.precio_base*0.9)):"—")} tono={a.precio_base_contado!=null?"text-amber-600":"text-neutro-400"}>
                          <InputMonto autoFocus className="h-auto min-w-0 px-0 rounded-none border-0 shadow-none focus-visible:ring-0 md:text-[13px] w-full text-right text-[13px] font-mono font-bold text-amber-600 bg-white border-b border-amber-500 focus:outline-none py-0.5" value={a.precio_base_contado!=null?a.precio_base_contado:null} placeholder={a.precio_base!=null?fmt(redondear(a.precio_base*0.9)):"—"} onChange={v=>edt(a.id,"precio_base_contado",v??0)}/>
                        </PrecioEditable>
                      </td>}
                      {isVis("ivac_v")&&<td className="px-1 py-0 text-center border-r border-indigo-100 bg-indigo-50/20" style={{width:cw.ivac_v,maxWidth:cw.ivac_v}}>
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ${ccC(a.iva_compras||"factura")}`}>{icC(a.iva_compras||"factura")}</span>
                      </td>}
                      {isVis("ivav_v")&&<td className="px-1 py-0 text-center border-r border-indigo-100 bg-indigo-50/20" style={{width:cw.ivav_v,maxWidth:cw.ivav_v}}>
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ${ccV(a.iva_ventas||"factura")}`}>{icV(a.iva_ventas||"factura")}</span>
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
                              const r=calcularPrecioFinal({...dt,precio_base_stored:base},ld2,leg.fac,{})
                              precio=r.ivaIncluido?r.precioUnitarioFinal:r.precioUnitarioFinal+r.montoIvaDiscriminado
                              isLegacy=true
                            }
                          }
                        }
                        const precioContado=precio!=null?Math.round(precio*0.9*100)/100:null
                        return(
                          <td key={codigo} className={`px-2.5 py-0 border-l-2 ${ac.border} ${ac.cell}`} style={{width:lcw[codigo]||ANCHO_SUBLISTA,maxWidth:lcw[codigo]||ANCHO_SUBLISTA}}>
                            <div className="flex flex-col items-end gap-0.5 py-0.5">
                              <div className="flex items-baseline gap-1">
                                <span className="text-[10px] font-medium text-neutro-400 leading-none">cte</span>
                                <span className={`text-xs font-semibold font-mono leading-none ${ac.price}`}>{precio!=null?fmt(precio):"—"}</span>
                              </div>
                              <div className="flex items-baseline gap-1">
                                <span className={`text-[10px] font-bold leading-none ${ac.name}`}>ctdo</span>
                                <span className={`text-[13px] font-bold font-mono leading-none ${ac.price}`}>{precioContado!=null?fmt(precioContado):"—"}</span>
                              </div>
                              {isLegacy&&<span className="text-[10px] text-neutro-300 leading-none">legacy</span>}
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
        <div className="flex items-center justify-between px-4 py-2 sm:px-6 border-t bg-white flex-shrink-0">
          <span className="text-[13px] text-neutro-500">{pg*PS+1}–{Math.min((pg+1)*PS,tc)} de {entero(tc)} artículos</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={pg===0} onClick={()=>setPg(p=>p-1)}><ChevronLeft className="h-3 w-3"/></Button>
            {Array.from({length:Math.min(tp,7)},(_,i)=>{ let pn=tp<=7?i:pg<3?i:pg>tp-4?tp-7+i:pg-3+i; return <Button key={pn} variant={pn===pg?"default":"outline"} size="sm" className={`h-8 w-8 p-0 text-xs ${pn===pg?"bg-azul-600 hover:bg-azul-700 border-azul-600 text-white":""}`} onClick={()=>setPg(pn)}>{pn+1}</Button> })}
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={pg>=tp-1} onClick={()=>setPg(p=>p+1)}><ChevronRight className="h-3 w-3"/></Button>
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
                <InputMonto porciento className="w-[80px] h-7 text-xs text-center" value={d.porcentaje||null} onChange={v=>setDmi(p=>p.map((x,j)=>j===i?{...x,porcentaje:v??0}:x))}/>
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

      {/* Ficha unificada (crear + editar): solo presentación, mismo estado y guardado (sfa) */}
      <FichaArticulo
        fa={fa}
        ff={ff}
        setFf={setFf}
        descuentos={fa && fa.id !== "__new__" ? (dm[fa.id] || []) : []}
        onGestionarDescuentos={() => { const a = fa; setFa(null); setTimeout(() => odm(a), 50) }}
        provs={provs}
        marcas={marcas}
        rubros={rubrosData}
        categorias={categoriasData}
        subcategorias={subcategoriasData}
        tiposBulto={UNIDADES_MEDIDA}
        tiposFraccion={TIPOS_FRACCION}
        imgSubiendo={imgUploading}
        onSubirImagen={handleImgUpload}
        guardando={fs}
        onGuardar={sfa}
        onCerrar={() => setFa(null)}
      />

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
                <p>sku, ean13, descripcion, unidades_por_bulto, proveedor_codigo, marca_codigo, categoria, subcategoria, precio_compra, porcentaje_ganancia, bonif_recargo, iva_compras, iva_ventas, precio_base, precio_base_contado, precio_lista_especial, oferta_lista_especial</p>
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

      {/* ═══ BULK EDIT DIALOG ════════════════════════════════════════════════ */}
      <Dialog open={showBulkEdit} onOpenChange={o=>{if(!o){setShowBulkEdit(false);setBulkFields(new Set());setBulkVals({})}}}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Pencil className="h-4 w-4 text-indigo-600"/>
              Editar {sel.size} artículo{sel.size>1?"s":""} seleccionado{sel.size>1?"s":""}
            </DialogTitle>
            <p className="text-xs text-slate-400 mt-1">Marcá los campos que querés cambiar. Solo se modifican los campos tildados.</p>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* PRECIOS */}
            <div>
              <p className="text-xs font-semibold text-neutro-500 mb-2">Precios</p>
              <div className="space-y-2">
                {[
                  {f:"precio_base",       label:"P. Base",         type:"number", def:0},
                  {f:"precio_base_contado",label:"P. Base Contado",type:"number", def:0},
                  {f:"precio_lista_especial",label:"P. Lista Especial",type:"number",def:0},
                  {f:"oferta_lista_especial",label:"Oferta Especial %",type:"number",def:0},
                  {f:"precio_compra",     label:"P. Compra (lista)",type:"number",def:0},
                  {f:"porcentaje_ganancia",label:"Margen %",       type:"number", def:0},
                  {f:"bonif_recargo",     label:"Bonif/Recargo %", type:"number", def:0},
                  {f:"descuento_propio",  label:"Oferta %",        type:"number", def:0},
                ].map(({f,label,type,def})=>(
                  <div key={f} className="flex items-center gap-3">
                    <button onClick={()=>toggleBulkField(f,def)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${bulkFields.has(f)?"bg-indigo-600 border-indigo-600":"border-slate-300 hover:border-indigo-400"}`}>
                      {bulkFields.has(f)&&<Check className="h-3 w-3 text-white"/>}
                    </button>
                    <Label className={`text-xs w-36 flex-shrink-0 ${bulkFields.has(f)?"text-slate-800 font-semibold":"text-slate-400"}`}>{label}</Label>
                    <InputMonto disabled={!bulkFields.has(f)}
                      value={bulkFields.has(f)?(bulkVals[f]??def):null}
                      placeholder={bulkFields.has(f)?"Valor nuevo":"—"}
                      className={`h-7 text-xs flex-1 ${!bulkFields.has(f)?"opacity-30":""}`}
                      onChange={n=>setBulkVals(v=>({...v,[f]:n??0}))}/>
                  </div>
                ))}
              </div>
            </div>

            {/* IVA */}
            <div>
              <p className="text-xs font-semibold text-neutro-500 mb-2">IVA</p>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <button onClick={()=>toggleBulkField("iva_compras","factura")}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${bulkFields.has("iva_compras")?"bg-indigo-600 border-indigo-600":"border-slate-300 hover:border-indigo-400"}`}>
                    {bulkFields.has("iva_compras")&&<Check className="h-3 w-3 text-white"/>}
                  </button>
                  <Label className={`text-xs w-36 flex-shrink-0 ${bulkFields.has("iva_compras")?"text-slate-800 font-semibold":"text-slate-400"}`}>IVA Compras</Label>
                  <Select disabled={!bulkFields.has("iva_compras")} value={bulkVals["iva_compras"]??"factura"} onValueChange={v=>setBulkVals(bv=>({...bv,iva_compras:v}))}>
                    <SelectTrigger className={`h-7 text-xs flex-1 ${!bulkFields.has("iva_compras")?"opacity-30":""}`}><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="factura">Blanco (+IVA 21%)</SelectItem>
                      <SelectItem value="adquisicion_stock">Negro (sin IVA)</SelectItem>
                      <SelectItem value="mixto">Mixto (10.5%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={()=>toggleBulkField("iva_ventas","factura")}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${bulkFields.has("iva_ventas")?"bg-indigo-600 border-indigo-600":"border-slate-300 hover:border-indigo-400"}`}>
                    {bulkFields.has("iva_ventas")&&<Check className="h-3 w-3 text-white"/>}
                  </button>
                  <Label className={`text-xs w-36 flex-shrink-0 ${bulkFields.has("iva_ventas")?"text-slate-800 font-semibold":"text-slate-400"}`}>IVA Ventas</Label>
                  <Select disabled={!bulkFields.has("iva_ventas")} value={bulkVals["iva_ventas"]??"factura"} onValueChange={v=>setBulkVals(bv=>({...bv,iva_ventas:v}))}>
                    <SelectTrigger className={`h-7 text-xs flex-1 ${!bulkFields.has("iva_ventas")?"opacity-30":""}`}><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="factura">Blanco (factura)</SelectItem>
                      <SelectItem value="presupuesto">Negro (presupuesto)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={()=>toggleBulkField("segmento_precio",null)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${bulkFields.has("segmento_precio")?"bg-indigo-600 border-indigo-600":"border-slate-300 hover:border-indigo-400"}`}>
                    {bulkFields.has("segmento_precio")&&<Check className="h-3 w-3 text-white"/>}
                  </button>
                  <Label className={`text-xs w-36 flex-shrink-0 ${bulkFields.has("segmento_precio")?"text-slate-800 font-semibold":"text-slate-400"}`}>Seg. Precio</Label>
                  <Select disabled={!bulkFields.has("segmento_precio")} value={bulkVals["segmento_precio"]??"auto"} onValueChange={v=>setBulkVals(bv=>({...bv,segmento_precio:v==="auto"?null:v}))}>
                    <SelectTrigger className={`h-7 text-xs flex-1 ${!bulkFields.has("segmento_precio")?"opacity-30":""}`}><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (por rubro)</SelectItem>
                      <SelectItem value="limpieza_bazar">Limpieza / Bazar</SelectItem>
                      <SelectItem value="perfumeria">Perfumería</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* CLASIFICACIÓN */}
            <div>
              <p className="text-xs font-semibold text-neutro-500 mb-2">Clasificación</p>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <button onClick={()=>toggleBulkField("proveedor_id",null)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${bulkFields.has("proveedor_id")?"bg-indigo-600 border-indigo-600":"border-slate-300 hover:border-indigo-400"}`}>
                    {bulkFields.has("proveedor_id")&&<Check className="h-3 w-3 text-white"/>}
                  </button>
                  <Label className={`text-xs w-36 flex-shrink-0 ${bulkFields.has("proveedor_id")?"text-slate-800 font-semibold":"text-slate-400"}`}>Proveedor</Label>
                  <Select disabled={!bulkFields.has("proveedor_id")} value={bulkVals["proveedor_id"]??""} onValueChange={v=>setBulkVals(bv=>({...bv,proveedor_id:v||null}))}>
                    <SelectTrigger className={`h-7 text-xs flex-1 ${!bulkFields.has("proveedor_id")?"opacity-30":""}`}><SelectValue placeholder="Seleccionar"/></SelectTrigger>
                    <SelectContent>{provs.map(p=><SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={()=>toggleBulkField("marca_id",null)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${bulkFields.has("marca_id")?"bg-indigo-600 border-indigo-600":"border-slate-300 hover:border-indigo-400"}`}>
                    {bulkFields.has("marca_id")&&<Check className="h-3 w-3 text-white"/>}
                  </button>
                  <Label className={`text-xs w-36 flex-shrink-0 ${bulkFields.has("marca_id")?"text-slate-800 font-semibold":"text-slate-400"}`}>Marca</Label>
                  <Select disabled={!bulkFields.has("marca_id")} value={bulkVals["marca_id"]??""} onValueChange={v=>setBulkVals(bv=>({...bv,marca_id:v||null}))}>
                    <SelectTrigger className={`h-7 text-xs flex-1 ${!bulkFields.has("marca_id")?"opacity-30":""}`}><SelectValue placeholder="Seleccionar"/></SelectTrigger>
                    <SelectContent>{marcas.map(m=><SelectItem key={m.id} value={m.id}>{m.descripcion}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {/* Rubro → Categoría → Subcategoría (cascada, un solo tilde) */}
                {(()=>{
                  const on=bulkFields.has("taxonomia")
                  const rubroSel=rubrosData.find((r:any)=>r.id===bulkVals.tax_rubro_id)
                  const cats=rubroSel?categoriasData.filter((c:any)=>c.rubro_id===rubroSel.id):[]
                  const catSel=cats.find((c:any)=>c.nombre===bulkVals.tax_categoria)
                  const subs=catSel?subcategoriasData.filter((s:any)=>s.categoria_id===catSel.id):[]
                  const dis=`h-7 text-xs flex-1 ${!on?"opacity-30":""}`
                  return (
                    <div className="flex items-start gap-3">
                      <button onClick={()=>toggleBulkField("taxonomia",null)}
                        className={`w-5 h-5 mt-1 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${on?"bg-indigo-600 border-indigo-600":"border-slate-300 hover:border-indigo-400"}`}>
                        {on&&<Check className="h-3 w-3 text-white"/>}
                      </button>
                      <Label className={`text-xs w-36 flex-shrink-0 mt-1.5 ${on?"text-slate-800 font-semibold":"text-slate-400"}`}>Rubro / Cat. / Subcat.</Label>
                      <div className="flex-1 space-y-1.5">
                        <Select disabled={!on} value={bulkVals.tax_rubro_id??""} onValueChange={v=>setBulkVals(bv=>({...bv,tax_rubro_id:v,tax_categoria:"",tax_subcategoria:""}))}>
                          <SelectTrigger className={dis}><SelectValue placeholder="Rubro"/></SelectTrigger>
                          <SelectContent>{rubrosData.map((r:any)=><SelectItem key={r.id} value={r.id}>{r.nombre}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select disabled={!on||!rubroSel} value={bulkVals.tax_categoria||"none"} onValueChange={v=>setBulkVals(bv=>({...bv,tax_categoria:v==="none"?"":v,tax_subcategoria:""}))}>
                          <SelectTrigger className={dis}><SelectValue placeholder={rubroSel?"Categoría":"Elegí un rubro"}/></SelectTrigger>
                          <SelectContent><SelectItem value="none">Sin categoría</SelectItem>{cats.map((c:any)=><SelectItem key={c.id} value={c.nombre}>{c.nombre}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select disabled={!on||!catSel} value={bulkVals.tax_subcategoria||"none"} onValueChange={v=>setBulkVals(bv=>({...bv,tax_subcategoria:v==="none"?"":v}))}>
                          <SelectTrigger className={dis}><SelectValue placeholder={catSel?"Subcategoría":"Elegí una categoría"}/></SelectTrigger>
                          <SelectContent><SelectItem value="none">Sin subcategoría</SelectItem>{subs.map((s:any)=><SelectItem key={s.id} value={s.nombre}>{s.nombre}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  )
                })()}
                {/* Tipo de bulto / Tipo de fracción — catálogos de /tablas */}
                {[
                  {f:"unidad_de_medida",label:"Tipo de bulto",  opts:UNIDADES_MEDIDA},
                  {f:"tipo_fraccion",   label:"Tipo de fracción",opts:TIPOS_FRACCION},
                ].map(({f,label,opts})=>(
                  <div key={f} className="flex items-center gap-3">
                    <button onClick={()=>toggleBulkField(f,"")}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${bulkFields.has(f)?"bg-indigo-600 border-indigo-600":"border-slate-300 hover:border-indigo-400"}`}>
                      {bulkFields.has(f)&&<Check className="h-3 w-3 text-white"/>}
                    </button>
                    <Label className={`text-xs w-36 flex-shrink-0 ${bulkFields.has(f)?"text-slate-800 font-semibold":"text-slate-400"}`}>{label}</Label>
                    <Select disabled={!bulkFields.has(f)} value={bulkVals[f]||"none"} onValueChange={v=>setBulkVals(bv=>({...bv,[f]:v==="none"?"":v}))}>
                      <SelectTrigger className={`h-7 text-xs flex-1 ${!bulkFields.has(f)?"opacity-30":""}`}><SelectValue placeholder="Seleccionar"/></SelectTrigger>
                      <SelectContent><SelectItem value="none">—</SelectItem>{opts.map(o=><SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <button onClick={()=>toggleBulkField("unidades_por_bulto",1)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${bulkFields.has("unidades_por_bulto")?"bg-indigo-600 border-indigo-600":"border-slate-300 hover:border-indigo-400"}`}>
                    {bulkFields.has("unidades_por_bulto")&&<Check className="h-3 w-3 text-white"/>}
                  </button>
                  <Label className={`text-xs w-36 flex-shrink-0 ${bulkFields.has("unidades_por_bulto")?"text-slate-800 font-semibold":"text-slate-400"}`}>Unid/Bulto</Label>
                  <InputMonto decimales={0} soloPositivos disabled={!bulkFields.has("unidades_por_bulto")}
                    value={bulkFields.has("unidades_por_bulto")?(bulkVals["unidades_por_bulto"]??1):null}
                    placeholder={bulkFields.has("unidades_por_bulto")?"Valor nuevo":"—"}
                    className={`h-7 text-xs flex-1 ${!bulkFields.has("unidades_por_bulto")?"opacity-30":""}`}
                    onChange={n=>setBulkVals(v=>({...v,unidades_por_bulto:Math.trunc(n??0)||1}))}/>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-100">
            <span className="text-xs text-slate-400">
              {bulkFields.size===0?"Tildá al menos un campo para continuar":`${bulkFields.size} campo${bulkFields.size>1?"s":""} a modificar`}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={()=>{setShowBulkEdit(false);setBulkFields(new Set());setBulkVals({})}}>Cancelar</Button>
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={bulkSave} disabled={bulkSaving||bulkFields.size===0}>
                {bulkSaving?"Guardando...":bulkFields.size===0?"Seleccioná campos":`Aplicar a ${sel.size} artículo${sel.size>1?"s":""}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ImportArticulosDialog open={showImporter} onOpenChange={setShowImporter} onImportComplete={()=>load(true)}/>
      <HistorialImportacionesDialog
        open={showHistorial}
        onOpenChange={setShowHistorial}
        modulo="articulos"
        claveLabel="SKU"
        nombreLabel="Descripción"
        statuses={["actualizado", "sin_cambios", "nuevo", "error"]}
        fieldLabel={articulosFieldLabel}
        valueFormat={articulosValueFormat}
      />
    </div>
  )
}
