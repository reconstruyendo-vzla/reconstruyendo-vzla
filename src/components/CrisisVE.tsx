'use client'

import { useState, useEffect, useRef, useCallback, type CSSProperties, type ReactNode } from "react";
import { supabase } from '@/lib/supabase'
import { initOneSignal, notifyZonaCritica } from '@/lib/onesignal'

// Reserved for cloud sync — import required by app architecture
void supabase

declare global {
  interface Window {
    L: LeafletStatic
  }
}

type LeafletStatic = {
  map: (el: HTMLElement, opts: Record<string, unknown>) => LeafletMap
  tileLayer: (url: string, opts: Record<string, unknown>) => { addTo: (map: LeafletMap) => unknown }
  divIcon: (opts: Record<string, unknown>) => unknown
  marker: (latlng: [number, number], opts?: Record<string, unknown>) => LeafletMarker
  control: (opts: { position: string }) => LeafletControl
  DomUtil: { create: (tag: string) => HTMLElement }
  DomEvent: { stopPropagation: (e: Event) => void }
}

type LeafletMap = {
  setView: (latlng: [number, number], zoom: number) => void
  on: (event: string, handler: (e: { latlng: { lat: number; lng: number } }) => void) => void
  remove: () => void
}

type LeafletMarker = { addTo: (map: LeafletMap) => LeafletMarker; remove: () => void }
type LeafletControl = { onAdd: (map: LeafletMap) => HTMLElement; addTo: (map: LeafletMap) => unknown }

type ToastType = "ok" | "warn" | "green" | string
type SectionProps = { online: boolean; onToast: (msg: string, type?: ToastType) => void }
type StoreName = "personas" | "mascotas" | "zonas" | "voluntarios" | "donaciones" | "refugios"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BaseRecord = { id: string; ts?: string; _off?: boolean; [key: string]: any }
type QueuePatch = Record<string, unknown>
type QueueItem = { table: string; action: string; data?: BaseRecord; id?: string; patch?: QueuePatch }
type Asistente = { nombre: string; contacto?: string; especialidad?: string; ts: string }
type ToastState = { msg: string; type: ToastType } | null

// ============================================================
// LEAFLET (OpenStreetMap) - cargado dinámicamente
// ============================================================
let leafletLoaded = false;
let L: LeafletStatic | null = null;

async function loadLeaflet(): Promise<LeafletStatic | null> {
  if (leafletLoaded) return L;
  await new Promise((res) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    script.onload = res;
    document.head.appendChild(script);
  });
  L = window.L;
  leafletLoaded = true;
  return L;
}

// ============================================================
// OFFLINE STORAGE — IndexedDB
// ============================================================
const IDB = {
  db: null as IDBDatabase | null,
  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((res, rej) => {
      const req = indexedDB.open("crisisve_v3", 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        ["personas","mascotas","zonas","voluntarios","donaciones","refugios"].forEach(s => {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
        });
      };
      req.onsuccess = (e) => { this.db = (e.target as IDBOpenDBRequest).result; res(this.db); };
      req.onerror = () => rej(req.error);
    });
  },
  async getAll(store: StoreName): Promise<BaseRecord[]> {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res(((req.result as BaseRecord[])||[]).sort((a,b)=>String(b.ts||"").localeCompare(String(a.ts||""))));
      req.onerror = () => rej(req.error);
    });
  },
  async put(store: StoreName, item: BaseRecord): Promise<BaseRecord> {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(item);
      tx.oncomplete = () => res(item);
      tx.onerror = () => rej(tx.error);
    });
  },
  async patch(store: StoreName, id: string, patch: Record<string, unknown>): Promise<BaseRecord> {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      const s = tx.objectStore(store);
      const req = s.get(id);
      req.onsuccess = () => { const u = { ...(req.result as BaseRecord), ...patch }; s.put(u); res(u); };
      req.onerror = () => rej(req.error);
    });
  }
};

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
const now = () => new Date().toISOString();
const fmtDate = (ts?: string) => ts ? new Date(ts).toLocaleDateString("es-VE",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "";
const toB64 = (file: File) => new Promise<string>((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result as string); r.onerror=rej; r.readAsDataURL(file); });

const QUEUE_KEY = "crisisve_queue_v3";
const addQ = (item: QueueItem) => { try { const q=JSON.parse(localStorage.getItem(QUEUE_KEY)||"[]") as QueueItem[]; q.push(item); localStorage.setItem(QUEUE_KEY,JSON.stringify(q)); } catch{} };
const getQ = (): QueueItem[] => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)||"[]"); } catch { return []; } };
const clearQ = () => localStorage.removeItem(QUEUE_KEY);

// ============================================================
// TOKENS — Azul cielo humanitario
// ============================================================
const C = {
  primary: "#2563EB", primaryDk: "#1D4ED8", primaryLt: "#EFF6FF", primaryMd: "#BFDBFE",
  sky: "#0EA5E9", skyLt: "#F0F9FF",
  teal: "#0D9488", tealLt: "#F0FDFA",
  green: "#059669", greenLt: "#ECFDF5",
  amber: "#D97706", amberLt: "#FEF3C7",
  purple: "#7C3AED", purpleLt: "#F5F3FF",
  bg: "#F0F4F8", card: "#FFFFFF",
  txt: "#0F172A", muted: "#64748B", border: "#E2E8F0",
};

const TABS = [
  { id:"personas",   icon:"👤", label:"Personas" },
  { id:"zonas",      icon:"📍", label:"Crisis" },
  { id:"refugios",   icon:"🏠", label:"Refugios" },
  { id:"mascotas",   icon:"🐾", label:"Mascotas" },
  { id:"voluntarios",icon:"🙋", label:"Voluntarios" },
  { id:"donaciones", icon:"💙", label:"Donar" },
];

const PERSONA_CATS = [
  { id:"nino_sano",      label:"Niño sano",        color:C.green,   bg:C.greenLt },
  { id:"nino_hospital",  label:"Niño en hospital",  color:C.sky,     bg:C.skyLt },
  { id:"adulto_sano",    label:"Adulto sano",       color:C.teal,    bg:C.tealLt },
  { id:"adulto_hospital",label:"Adulto en hospital",color:C.primary, bg:C.primaryLt },
];

const INSUMOS  = ["Agua","Alimentos","Medicamentos","Ropa","Frazadas","Pañales","Equipo médico","Combustible","Linternas","Herramientas","Otro"];
const AYUDA    = ["Rescate","Atención médica","Transporte","Alojamiento","Comunicaciones","Logística","Apoyo psicológico","Legal","Otro"];
const PERSONAL = ["Médico/a","Enfermero/a","Paramédico","Rescatista","Psicólogo/a","Conductor/a","Bombero/a","Trabajador social","Voluntario general"];
const ESPECIALIDADES = ["Médico/a","Enfermero/a","Paramédico","Rescatista","Psicólogo/a","Ingeniero/a","Trabajador social","Abogado/a","Conductor/a","Piloto","Comunicaciones","Bombero/a","Voluntario general"];
const MASCOTA_CATS = [
  { id:"sana",   label:"Sana / encontrada", color:C.green, bg:C.greenLt },
  { id:"herida", label:"Necesita atención", color:C.amber, bg:C.amberLt },
];
const URGENCIAS = [
  { id:"critica", label:"Crítica", statLabel:"Zona crítica", color:C.amber,   bg:C.amberLt },
  { id:"alta",    label:"Alta",    statLabel:"Zona alta",    color:C.sky,     bg:C.skyLt },
  { id:"media",   label:"Media",   statLabel:"Zona media",   color:C.teal,    bg:C.tealLt },
];

const REMOTE_ESPECIALIDADES = ["Psicólogo/a", "Abogado/a", "Médico/a"];

async function reportarSeguro(table: string, data: BaseRecord, online: boolean, onToast: SectionProps['onToast']): Promise<boolean> {
  if (!online) return true
  const response = await fetch('/api/reportar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, data }),
  })
  const result = await response.json()
  if (!response.ok) {
    onToast(result.error || 'Error al guardar', 'warn')
    return false
  }
  return true
}

// ============================================================
// MICRO UI
// ============================================================
const inp: CSSProperties = { width:"100%", padding:"10px 12px", borderRadius:8, border:`1.5px solid ${C.border}`, fontSize:14, boxSizing:"border-box", outline:"none", background:"white", color:C.txt, fontFamily:"inherit" };
function Input({value,onChange,placeholder,type="text"}:{value:string;onChange:(v:string)=>void;placeholder?:string;type?:string}){ return <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={inp} />; }
function Textarea({value,onChange,placeholder,rows=3}:{value:string;onChange:(v:string)=>void;placeholder?:string;rows?:number}){ return <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{...inp,resize:"vertical"}} />; }
function Field({label,children}:{label:string;children:ReactNode}){ return <div style={{marginBottom:13}}><label style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:5}}>{label}</label>{children}</div>; }
function Pill({label,color=C.muted,bg="#F1F5F9"}:{label:ReactNode;color?:string;bg?:string}){ return <span style={{fontSize:11,fontWeight:700,padding:"3px 9px",borderRadius:20,background:bg,color,display:"inline-block",lineHeight:1.6}}>{label}</span>; }
function Chip({label,active,onClick,color=C.primary}:{label:ReactNode;active:boolean;onClick:()=>void;color?:string}){ return <button onClick={onClick} style={{padding:"5px 12px",borderRadius:20,border:`1.5px solid ${active?color:C.border}`,background:active?color:"white",color:active?"white":C.muted,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",transition:"all .15s"}}>{label}</button>; }
function Btn({onClick,children,color=C.primary,disabled,full,small,outline,style}:{onClick?:()=>void;children:ReactNode;color?:string;disabled?:boolean;full?:boolean;small?:boolean;outline?:boolean;style?:CSSProperties}){
  return <button onClick={onClick} disabled={disabled} style={{width:full?"100%":undefined,padding:small?"7px 14px":"12px 20px",borderRadius:9,border:outline?`2px solid ${color}`:"none",background:disabled?"#CBD5E1":outline?"transparent":color,color:outline?color:"white",fontWeight:700,fontSize:small?12:15,cursor:disabled?"not-allowed":"pointer",whiteSpace:"nowrap",fontFamily:"inherit",...style}}>{children}</button>;
}
function StatBox({n,label,color}:{n:number|string;label:string;color:string}){ return <div style={{background:"white",borderRadius:12,padding:"12px 14px",borderLeft:`3px solid ${color}`,flex:1}}><div style={{fontSize:24,fontWeight:900,color}}>{n}</div><div style={{fontSize:10,fontWeight:700,color:C.muted,lineHeight:1.3}}>{label}</div></div>; }
function Back({onClick}:{onClick:()=>void}){ return <button onClick={onClick} style={{background:"none",border:"none",color:C.primary,fontWeight:700,fontSize:14,cursor:"pointer",marginBottom:16,padding:0}}>← Volver</button>; }
function Card({children,style={}}:{children:ReactNode;style?:CSSProperties}){ return <div style={{background:"white",borderRadius:16,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.08)",...style}}>{children}</div>; }
function Empty({icon,msg}:{icon:ReactNode;msg:string}){ return <div style={{textAlign:"center",padding:"44px 20px",color:C.muted}}><div style={{fontSize:44,marginBottom:10}}>{icon}</div><div style={{fontWeight:600,fontSize:15}}>{msg}</div></div>; }

function Toast({msg,type="ok",onClose}:{msg:string;type?:ToastType;onClose:()=>void}){
  useEffect(()=>{ const t=setTimeout(onClose,4000); return ()=>clearTimeout(t); },[onClose]);
  const bg = type==="ok"?C.primary:type==="warn"?C.amber:C.green;
  return <div style={{position:"fixed",bottom:88,left:"50%",transform:"translateX(-50%)",background:bg,color:"white",padding:"11px 20px",borderRadius:10,fontWeight:600,fontSize:13,zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.25)",maxWidth:"88vw",textAlign:"center",pointerEvents:"none"}}>{msg}</div>;
}

function PhotoUpload({preview,onFile,label="Subir foto"}:{preview:string|null;onFile:(b64:string)=>void;label?:string}){
  const ref=useRef<HTMLInputElement>(null);
  return (
    <div style={{textAlign:"center",marginBottom:14}}>
      <div onClick={()=>ref.current?.click()} style={{width:88,height:88,borderRadius:12,margin:"0 auto 6px",background:preview?"transparent":C.primaryLt,border:`2px dashed ${C.primaryMd}`,cursor:"pointer",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>
        {preview ? <img src={preview} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" /> : ""}
      </div>
      <input ref={ref} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={async e=>{ const file=e.target.files?.[0]; if(file) onFile(await toB64(file)); }} />
      <span style={{fontSize:11,color:C.muted,cursor:"pointer"}} onClick={()=>ref.current?.click()}>{preview?"Cambiar foto":label}</span>
    </div>
  );
}

function OfflineBanner({pending}:{pending:number}){
  if(!pending) return null;
  return <div style={{background:C.amberLt,borderBottom:`1px solid ${C.amber}`,padding:"8px 16px",fontSize:12,fontWeight:600,color:C.amber,textAlign:"center"}}>Sin conexión — {pending} reporte{pending>1?"s":""} guardado{pending>1?"s":""} localmente. Se sincronizarán cuando vuelva el internet.</div>;
}

// ============================================================
// MAPA COMPONENT (Leaflet + OpenStreetMap, funciona offline con tiles cacheados)
// ============================================================
function MapPicker({ lat, lng, onPin, readOnly = false, height = 280 }: { lat?: number | null; lng?: number | null; onPin?: (la: number, ln: number) => void; readOnly?: boolean; height?: number }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadLeaflet().then((Lf) => {
      if (!mounted || !mapRef.current || instanceRef.current || !Lf) return;
      setLoading(false);
      const startLat = lat || 10.4806;
      const startLng = lng || -66.9036;
      const map = Lf.map(mapRef.current, { zoomControl: true, attributionControl: false });
      instanceRef.current = map;

      // OSM tiles — se cachean via service worker en producción
      Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "OpenStreetMap"
      }).addTo(map);

      map.setView([startLat, startLng], lat ? 15 : 10);

      // Icono personalizado azul
      const icon = Lf.divIcon({
        html: `<div style="background:${C.primary};width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35)"></div>`,
        iconSize: [28,28], iconAnchor: [14,28], className:""
      });

      if (lat && lng) {
        markerRef.current = Lf.marker([lat, lng], { icon }).addTo(map);
      }

      if (!readOnly) {
        // Botón GPS
        const gpsBtn = Lf.control({ position: "topleft" });
        gpsBtn.onAdd = () => {
          const btn = Lf.DomUtil.create("button");
          btn.innerHTML = "";
          btn.title = "Mi ubicación";
          btn.style.cssText = `background:white;border:2px solid ${C.border};border-radius:8px;padding:6px 8px;font-size:16px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15)`;
          btn.onclick = (e) => {
            Lf.DomEvent.stopPropagation(e);
            navigator.geolocation?.getCurrentPosition(pos => {
              const { latitude, longitude } = pos.coords;
              map.setView([latitude, longitude], 16);
              placeMarker(latitude, longitude);
            }, () => {});
          };
          return btn;
        };
        gpsBtn.addTo(map);

        const placeMarker = (la: number, ln: number) => {
          if (markerRef.current) markerRef.current.remove();
          markerRef.current = Lf.marker([la, ln], { icon }).addTo(map);
          onPin && onPin(la, ln);
        };

        map.on("click", (e) => placeMarker(e.latlng.lat, e.latlng.lng));
      }
    }).catch(() => { setLoading(false); setError(true); });

    return () => {
      mounted = false;
      if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; }
    };
  }, []);

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: `1.5px solid ${C.border}`, position: "relative" }}>
      {loading && <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", background: C.primaryLt, fontSize: 14, color: C.muted }}>Cargando mapa…</div>}
      {error && <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", background: C.primaryLt, fontSize: 13, color: C.muted, flexDirection:"column", gap:8 }}><span style={{fontSize:32}}></span>Mapa no disponible sin internet.<br/>La ubicación GPS se guardó igual.</div>}
      <div ref={mapRef} style={{ height: loading || error ? 0 : height, width: "100%" }} />
      {!readOnly && !loading && !error && (
        <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
          <span style={{ background: "rgba(255,255,255,0.92)", fontSize: 11, fontWeight: 600, color: C.muted, padding: "4px 10px", borderRadius: 20 }}>Toca el mapa para marcar la ubicación exacta · para usar tu GPS</span>
        </div>
      )}
    </div>
  );
}

// Mini mapa de solo lectura para tarjetas de detalle
function MapView({ lat, lng, label }: { lat: number; lng: number; label?: string }) {
  if (!lat || !lng) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Ubicación en mapa</div>
      <MapPicker lat={lat} lng={lng} readOnly height={220} />
      <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{lat.toFixed(5)}, {lng.toFixed(5)}{label ? ` — ${label}` : ""}</div>
    </div>
  );
}

// ============================================================
// PERSONAS
// ============================================================
function PersonasSection({ online, onToast }: SectionProps) {
  const [items, setItems] = useState<BaseRecord[]>([]);
  const [view, setView] = useState("list"); // list | form | detail
  const [sel, setSel] = useState<BaseRecord | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [catF, setCatF] = useState("todos");
  const [estF, setEstF] = useState("todos");
  const [f, setF] = useState({ nombre:"",edad:"",cat:"nino_sano",hospital:"",sala:"",ubicacion:"",pais:"Venezuela",descripcion:"",contactoNombre:"",contacto:"",lat:null as number | null,lng:null as number | null });

  const reload = useCallback(async () => setItems(await IDB.getAll("personas")), []);
  useEffect(() => { reload(); }, [reload]);

  const save = async () => {
    if (!f.nombre || !f.contacto) { onToast("Nombre y contacto son obligatorios","warn"); return; }
    const item = { ...f, foto, estado:"buscando", id:uid(), ts:now(), _off:!online };
    if (!(await reportarSeguro("personas", item, online, onToast))) return
    await IDB.put("personas", item);
    if (!online) addQ({ table:"personas", action:"insert", data:item });
    await reload(); setView("list"); setFoto(null);
    setF({ nombre:"",edad:"",cat:"nino_sano",hospital:"",sala:"",ubicacion:"",pais:"Venezuela",descripcion:"",contactoNombre:"",contacto:"",lat:null as number | null,lng:null as number | null });
    onToast(online ? "Reporte publicado" : "Guardado sin internet — se publicará automáticamente", online?"ok":"warn");
  };

  const markFound = async (id: string) => {
    await IDB.patch("personas", id, { estado:"encontrado" });
    if (!online) addQ({ table:"personas", action:"update", id, patch:{ estado:"encontrado" } });
    await reload();
    if (sel?.id===id) setSel(s=>s ? ({...s,estado:"encontrado"} as BaseRecord) : s);
    onToast("Marcado como encontrado/a","ok");
  };

  const list = items.filter((p: BaseRecord) => {
    const mq = !q || [p.nombre,p.ubicacion,p.hospital].filter(Boolean).some(s=>s.toLowerCase().includes(q.toLowerCase()));
    return mq && (catF==="todos"||p.cat===catF) && (estF==="todos"||p.estado===estF);
  });

  // DETAIL
  if (view==="detail" && sel) {
    const cat = PERSONA_CATS.find(c=>c.id===sel.cat)||PERSONA_CATS[0];
    return (
      <div>
        <Back onClick={()=>{ setSel(null); setView("list"); }} />
        <Card>
          {sel.foto ? <img src={sel.foto} alt={sel.nombre} style={{width:"100%",maxHeight:240,objectFit:"cover",borderRadius:12,marginBottom:14}} /> : <div style={{background:cat.bg,height:80,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:cat.color,marginBottom:14,padding:12,textAlign:"center"}}>{cat.label}</div>}
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            <Pill label={sel.estado==="encontrado"?"Encontrado/a":"Buscando familia"} color={sel.estado==="encontrado"?C.green:C.amber} bg={sel.estado==="encontrado"?C.greenLt:C.amberLt} />
            <Pill label={cat.label} color={cat.color} bg={cat.bg} />
          </div>
          <h2 style={{margin:"0 0 6px",fontSize:20,fontWeight:800}}>{sel.nombre}</h2>
          {sel.edad && <p style={{margin:"0 0 3px",fontSize:13,color:C.muted}}>{sel.edad}</p>}
          {sel.hospital && <p style={{margin:"0 0 3px",fontSize:13,color:C.sky,fontWeight:600}}>{sel.hospital}{sel.sala?` — ${sel.sala}`:""}</p>}
          {sel.ubicacion && <p style={{margin:"0 0 3px",fontSize:13,color:C.muted}}>{sel.ubicacion}, {sel.pais}</p>}
          {sel.descripcion && <div style={{background:C.bg,borderRadius:10,padding:12,margin:"12px 0",fontSize:13,lineHeight:1.6}}>{sel.descripcion}</div>}
          {sel.lat && sel.lng && <MapView lat={sel.lat} lng={sel.lng} label={sel.ubicacion} />}
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14,marginTop:6}}>
            {sel.contactoNombre && <p style={{margin:"0 0 2px",fontWeight:700,fontSize:14}}>{sel.contactoNombre}</p>}
            <p style={{margin:"0 0 14px",fontSize:15,fontWeight:800,color:C.primary}}>{sel.contacto}</p>
          </div>
          {sel.estado!=="encontrado"
            ? <Btn onClick={()=>markFound(sel.id)} color={C.green} full> Marcar como ENCONTRADO/A</Btn>
            : <div style={{textAlign:"center",padding:14,background:C.greenLt,borderRadius:10,fontWeight:700,color:C.green}}>¡Ya fue encontrado/a!</div>
          }
        </Card>
      </div>
    );
  }

  // FORM
  if (view==="form") {
    const isHosp = f.cat?.endsWith("hospital");
    return (
      <div>
        <Back onClick={()=>setView("list")} />
        <Card>
          <h3 style={{margin:"0 0 4px",fontWeight:800}}>Reportar Persona</h3>
          <p style={{margin:"0 0 14px",fontSize:12,color:C.muted}}>{online?"Los datos se publican al instante":"Sin internet — se guardará y publicará automáticamente cuando vuelva la conexión"}</p>
          <PhotoUpload preview={foto} onFile={setFoto} label="Foto de la persona" />
          <Field label="Categoría">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {PERSONA_CATS.map(c=>(
                <button key={c.id} onClick={()=>setF(x=>({...x,cat:c.id}))} style={{padding:"8px",borderRadius:8,border:`2px solid ${f.cat===c.id?c.color:C.border}`,background:f.cat===c.id?c.bg:"white",color:f.cat===c.id?c.color:C.muted,fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",gap:4,alignItems:"center",justifyContent:"center"}}>{c.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Nombre completo *"><Input value={f.nombre} onChange={v=>setF(x=>({...x,nombre:v}))} placeholder="Ej: María González" /></Field>
          <Field label="Edad aproximada"><Input value={f.edad} onChange={v=>setF(x=>({...x,edad:v}))} placeholder="Ej: 7 años / ~35 años" /></Field>
          {isHosp && <>
            <Field label="Hospital *"><Input value={f.hospital} onChange={v=>setF(x=>({...x,hospital:v}))} placeholder="Ej: Hospital Pérez Carreño" /></Field>
            <Field label="Sala / Piso"><Input value={f.sala} onChange={v=>setF(x=>({...x,sala:v}))} placeholder="Ej: Emergencias, Piso 2" /></Field>
          </>}
          <Field label="Última ubicación (texto)"><Input value={f.ubicacion} onChange={v=>setF(x=>({...x,ubicacion:v}))} placeholder="Ej: Petare, Caracas" /></Field>
          <Field label="País"><Input value={f.pais} onChange={v=>setF(x=>({...x,pais:v}))} placeholder="Venezuela" /></Field>
          <Field label="Pinear ubicación exacta en el mapa">
            <MapPicker lat={f.lat} lng={f.lng} onPin={(la,ln)=>setF(x=>({...x,lat:la,lng:ln}))} />
            {f.lat != null && f.lng != null && <p style={{fontSize:11,color:C.green,marginTop:4,fontWeight:600}}> Ubicación marcada: {f.lat.toFixed(4)}, {f.lng.toFixed(4)}</p>}
          </Field>
          <Field label="Descripción (ropa, señas, situación)"><Textarea value={f.descripcion} onChange={v=>setF(x=>({...x,descripcion:v}))} placeholder="Camisa azul, cabello corto…" /></Field>
          <Field label="Tu nombre (quien reporta)"><Input value={f.contactoNombre} onChange={v=>setF(x=>({...x,contactoNombre:v}))} placeholder="Ej: Carlos Martínez" /></Field>
          <Field label="Contacto (WhatsApp / @usuario) *"><Input value={f.contacto} onChange={v=>setF(x=>({...x,contacto:v}))} placeholder="+58 414-000-0000 / @usuario" /></Field>
          <Btn onClick={save} full>{online?"Publicar Reporte":"Guardar sin internet"}</Btn>
        </Card>
      </div>
    );
  }

  // LIST
  const buscando=items.filter((p: BaseRecord)=>p.estado!=="encontrado").length;
  const enc=items.filter((p: BaseRecord)=>p.estado==="encontrado").length;
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        <StatBox n={buscando} label="Buscando familia" color={C.amber} />
        <StatBox n={enc} label="Personas reunidas" color={C.green} />
        <StatBox n={items.filter((p: BaseRecord)=>p.cat?.startsWith("nino")).length} label="Niños" color={C.sky} />
        <StatBox n={items.filter((p: BaseRecord)=>p.cat?.endsWith("hospital")).length} label="En hospitales" color={C.primary} />
      </div>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Nombre, lugar, hospital…" style={{flex:1,padding:"10px 12px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,outline:"none"}} />
        <Btn onClick={()=>setView("form")} small>+ Reportar</Btn>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
        <Chip label="Todos" active={catF==="todos"} onClick={()=>setCatF("todos")} />
        {PERSONA_CATS.map(c=><Chip key={c.id} label={c.label} active={catF===c.id} onClick={()=>setCatF(c.id)} color={c.color} />)}
      </div>
      <div style={{display:"flex",gap:5,marginBottom:14}}>
        <Chip label="Todos" active={estF==="todos"} onClick={()=>setEstF("todos")} />
        <Chip label="Buscando" active={estF==="buscando"} onClick={()=>setEstF("buscando")} color={C.amber} />
        <Chip label="Encontrados" active={estF==="encontrado"} onClick={()=>setEstF("encontrado")} color={C.green} />
      </div>
      {list.length===0 ? <Empty icon={null} msg={items.length===0?"Sin reportes aún":"Sin resultados"} /> : list.map((p: BaseRecord)=>{
        const cat=PERSONA_CATS.find(c=>c.id===p.cat)||PERSONA_CATS[0];
        return (
          <div key={p.id} onClick={()=>{ setSel(p); setView("detail"); }} style={{background:"white",borderRadius:12,marginBottom:10,overflow:"hidden",display:"flex",cursor:"pointer",borderLeft:`4px solid ${p.estado==="encontrado"?C.green:cat.color}`,opacity:p.estado==="encontrado"?.72:1,boxShadow:"0 1px 3px rgba(0,0,0,0.07)"}}>
            <div style={{width:76,minHeight:76,background:cat.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>
              {p.foto?<img src={p.foto} alt="" style={{width:76,height:76,objectFit:"cover"}} />:<span style={{fontSize:11,fontWeight:700,color:cat.color,textAlign:"center",padding:4}}>{cat.label}</span>}
            </div>
            <div style={{padding:"10px 12px",flex:1,minWidth:0}}>
              <div style={{display:"flex",gap:4,marginBottom:4,flexWrap:"wrap"}}>
                <Pill label={p.estado==="encontrado"?"Encontrado":"Buscando"} color={p.estado==="encontrado"?C.green:C.amber} bg={p.estado==="encontrado"?C.greenLt:C.amberLt} />
                <Pill label={cat.label} color={cat.color} bg={cat.bg} />
                {p._off&&<Pill label="" color={C.muted} bg="#F1F5F9" />}
              </div>
              <div style={{fontWeight:800,fontSize:15,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.nombre}</div>
              {p.hospital&&<div style={{fontSize:12,color:C.sky,fontWeight:600}}>{p.hospital}</div>}
              {p.ubicacion&&<div style={{fontSize:12,color:C.muted}}>{p.ubicacion}</div>}
              {p.lat&&<div style={{fontSize:11,color:C.teal}}>GPS guardado</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// ZONAS DE CRISIS
// ============================================================

// Asistentes guardados localmente por zona: { [zonaId]: { nombre, contacto, ts } }
const ASIST_KEY = "crisisve_asistentes_v1";
const getAsistentes = (): Record<string, Asistente[]> => { try { return JSON.parse(localStorage.getItem(ASIST_KEY)||"{}"); } catch { return {}; } };
const saveAsistentes = (data: Record<string, Asistente[]>) => { try { localStorage.setItem(ASIST_KEY, JSON.stringify(data)); } catch {} };
// Si YO ya me anoté en esta zona
const YO_KEY = "crisisve_yo_asisto_v1";
const getYoAsisto = (): Record<string, Asistente> => { try { return JSON.parse(localStorage.getItem(YO_KEY)||"{}"); } catch { return {}; } };
const saveYoAsisto = (data: Record<string, Asistente>) => { try { localStorage.setItem(YO_KEY, JSON.stringify(data)); } catch {} };

function AsistentesBar({ zonaId, asistentes, yoAsisto, onAsistir, onRetirar }: { zonaId: string; asistentes: Record<string, Asistente[]>; yoAsisto: Record<string, Asistente>; onAsistir: () => void; onRetirar: () => void }) {
  const lista = asistentes[zonaId] || [];
  const total = lista.length;
  const yo = yoAsisto[zonaId];

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
      {/* Contador visual */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ background: total > 0 ? C.primaryLt : "#F1F5F9", borderRadius: 12, padding: "10px 16px", flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: total > 0 ? C.primary : C.muted, lineHeight: 1 }}>{total}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: total > 0 ? C.primary : C.muted }}>
              {total === 0 ? "Nadie asistiendo aún" : total === 1 ? "persona asistiendo" : "personas asistiendo"}
            </div>
            {total > 0 && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                {lista.slice(-3).map(a => a.nombre).join(",")}{lista.length > 3 ? ` y ${lista.length - 3} más` : ""}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Barra de progreso visual — avatares */}
      {total > 0 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
          {lista.slice(0, 12).map((a, i) => (
            <div key={i} title={a.nombre} style={{ width: 32, height: 32, borderRadius: "50%", background: `hsl(${(i * 47) % 360}, 60%, 70%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "white", border: "2px solid white", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}>
              {a.nombre?.charAt(0).toUpperCase()}
            </div>
          ))}
          {total > 12 && (
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.primaryMd, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: C.primary, border: "2px solid white" }}>
              +{total - 12}
            </div>
          )}
        </div>
      )}

      {/* Botón principal */}
      {!yo ? (
        <Btn onClick={onAsistir} full color={C.primary}>Voy a asistir esta zona</Btn>
      ) : (
        <div>
          <div style={{ background: C.greenLt, border: `1px solid ${C.green}`, borderRadius: 10, padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}></span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Estás asistiendo esta zona</div>
              <div style={{ fontSize: 11, color: C.muted }}>Registrado como: {yo.nombre}</div>
            </div>
          </div>
          <button onClick={onRetirar} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
            Ya no puedo ir — retirar mi nombre
          </button>
        </div>
      )}
    </div>
  );
}

function ModalAsistir({ zonaId, zonaName, onConfirm, onClose }: { zonaId: string; zonaName: string; onConfirm: (data: Asistente) => void; onClose: () => void }) {
  const [nombre, setNombre] = useState("");
  const [contacto, setContacto] = useState("");
  const [especialidad, setEspecialidad] = useState("");

  const confirm = () => {
    if (!nombre.trim()) return;
    onConfirm({ nombre: nombre.trim(), contacto: contacto.trim(), especialidad: especialidad.trim(), ts: now() });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: "white", borderRadius: "20px 20px 0 0", padding: 24, width: "100%", maxWidth: 680, boxShadow: "0 -4px 30px rgba(0,0,0,0.2)" }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Confirmar asistencia</div>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: C.muted }}>Tu nombre aparecerá en el contador de <strong>{zonaName}</strong></p>
        <Field label="Tu nombre *">
          <Input value={nombre} onChange={setNombre} placeholder="Ej: Carlos Martínez" />
        </Field>
        <Field label="Contacto (WhatsApp / @usuario)">
          <Input value={contacto} onChange={setContacto} placeholder="+58 414-000-0000" />
        </Field>
        <Field label="Especialidad / rol (opcional)">
          <Input value={especialidad} onChange={setEspecialidad} placeholder="Ej: Médico, Conductor, Voluntario..." />
        </Field>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Btn onClick={onClose} color={C.muted} outline full small>Cancelar</Btn>
          <Btn onClick={confirm} full color={C.primary} disabled={!nombre.trim()}> Confirmar — Voy a asistir</Btn>
        </div>
      </div>
    </div>
  );
}

function ZonasSection({ online, onToast }: SectionProps) {
  const [items, setItems] = useState<BaseRecord[]>([]);
  const [view, setView] = useState("list");
  const [sel, setSel] = useState<BaseRecord | null>(null);
  const [urgF, setUrgF] = useState("todos");
  const [asistentes, setAsistentes] = useState<Record<string, Asistente[]>>(getAsistentes());
  const [yoAsisto, setYoAsisto] = useState<Record<string, Asistente>>(getYoAsisto());
  const [showModal, setShowModal] = useState(false);
  const [f, setF] = useState({ nombre:"",estado:"",pais:"Venezuela",descripcion:"",lat:null as number | null,lng:null as number | null,insumos:[] as string[],ayuda:[] as string[],personal:[] as string[],contactoNombre:"",contacto:"",urgencia:"critica" });

  const reload = useCallback(async () => setItems(await IDB.getAll("zonas")), []);
  useEffect(() => { reload(); }, [reload]);

  const tog = (field: "insumos" | "ayuda" | "personal", val: string) => setF(x => ({ ...x, [field]: x[field].includes(val) ? x[field].filter((v: string) => v !== val) : [...x[field], val] }));

  const save = async () => {
    if (!f.nombre || !f.contacto) { onToast("Nombre de zona y contacto obligatorios", "warn"); return; }
    const item = { ...f, estado_zona: "activa", id: uid(), ts: now(), _off: !online };
    if (!(await reportarSeguro("zonas", item, online, onToast))) return
    await IDB.put("zonas", item);
    if (!online) addQ({ table: "zonas", action: "insert", data: item });
    await reload();
    if (f.urgencia === 'critica') {
      await notifyZonaCritica(f.nombre, f.estado)
    }
    setView("list");
    setF({ nombre:"",estado:"",pais:"Venezuela",descripcion:"",lat:null as number | null,lng:null as number | null,insumos:[] as string[],ayuda:[] as string[],personal:[] as string[],contactoNombre:"",contacto:"",urgencia:"critica" });
    onToast(online ? "Zona de crisis publicada" : "Guardada sin internet", online ? "ok" : "warn");
  };

  const handleAsistir = (data: Asistente) => {
    const zonaId = sel!.id;
    const nuevos = { ...asistentes, [zonaId]: [...(asistentes[zonaId] || []), data] };
    const nuevoYo = { ...yoAsisto, [zonaId]: data };
    saveAsistentes(nuevos); saveYoAsisto(nuevoYo);
    setAsistentes(nuevos); setYoAsisto(nuevoYo);
    setShowModal(false);
    // Actualizar sel para reflejar el nuevo conteo en el detalle
    setSel(s => s ? ({ ...s } as BaseRecord) : s);
    onToast(` ¡Gracias ${data.nombre}! Quedas registrado/a en esta zona`, "ok");
    if (!online) addQ({ table: "zona_asistentes", action: "insert", data: { zonaId, ...data, id: uid() } });
  };

  const handleRetirar = () => {
    const zonaId = sel!.id;
    const yo = yoAsisto[zonaId];
    if (!yo) return;
    const nuevos = { ...asistentes, [zonaId]: (asistentes[zonaId] || []).filter(a => a.ts !== yo.ts) };
    const nuevoYo = { ...yoAsisto };
    delete nuevoYo[zonaId];
    saveAsistentes(nuevos); saveYoAsisto(nuevoYo);
    setAsistentes(nuevos); setYoAsisto(nuevoYo);
    onToast("Se retiró tu nombre de esta zona", "warn");
  };

  const urg = (u: string) => URGENCIAS.find(x => x.id === u) || URGENCIAS[1];

  // DETAIL
  if (view === "detail" && sel) {
    const u = urg(sel.urgencia);
    const totalAsist = (asistentes[sel.id] || []).length;
    return (
      <div>
        <Back onClick={() => { setSel(null); setView("list"); }} />
        <Card>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Pill label={u.label} color={u.color} bg={u.bg} />
            <Pill label={sel.estado_zona === "activa" ? "Activa" : "Atendida"} color={sel.estado_zona === "activa" ? C.primary : C.green} bg={sel.estado_zona === "activa" ? C.primaryLt : C.greenLt} />
            {totalAsist > 0 && <Pill label={`${totalAsist} asistiendo`} color={C.green} bg={C.greenLt} />}
          </div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800 }}>{sel.nombre}</h2>
          <p style={{ margin: "0 0 12px", color: C.muted, fontSize: 13 }}>{[sel.estado, sel.pais].filter(Boolean).join(",")}</p>
          {sel.descripcion && <div style={{ background: C.bg, borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, lineHeight: 1.6 }}>{sel.descripcion}</div>}
          {sel.lat && sel.lng && <MapView lat={sel.lat} lng={sel.lng} label={sel.nombre} />}
          {sel.insumos?.length > 0 && <div style={{ marginBottom: 12 }}><div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase" }}>Insumos necesarios</div><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{sel.insumos.map((i: string) => <Pill key={i} label={i} color={C.amber} bg={C.amberLt} />)}</div></div>}
          {sel.ayuda?.length > 0 && <div style={{ marginBottom: 12 }}><div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase" }}>Tipo de ayuda</div><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{sel.ayuda.map((i: string) => <Pill key={i} label={i} color={C.primary} bg={C.primaryLt} />)}</div></div>}
          {sel.personal?.length > 0 && <div style={{ marginBottom: 12 }}><div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase" }}>Personal solicitado</div><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{sel.personal.map((i: string) => <Pill key={i} label={i} color={C.teal} bg={C.tealLt} />)}</div></div>}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Coordinación</div>
            {sel.contactoNombre && <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: 14 }}>{sel.contactoNombre}</p>}
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.primary }}>{sel.contacto}</p>
          </div>

          {/* ASISTENTES */}
          <AsistentesBar
            zonaId={sel.id}
            asistentes={asistentes}
            yoAsisto={yoAsisto}
            onAsistir={() => setShowModal(true)}
            onRetirar={handleRetirar}
          />
        </Card>

        {showModal && (
          <ModalAsistir
            zonaId={sel.id}
            zonaName={sel.nombre}
            onConfirm={handleAsistir}
            onClose={() => setShowModal(false)}
          />
        )}
      </div>
    );
  }

  // FORM
  if (view === "form") return (
    <div>
      <Back onClick={() => setView("list")} />
      <Card>
        <h3 style={{ margin: "0 0 4px", fontWeight: 800 }}>Reportar Zona de Crisis</h3>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: C.muted }}>Pinea la ubicación exacta para que los voluntarios lleguen sin errores</p>
        <Field label="Nivel de urgencia">
          <div style={{ display: "flex", gap: 6 }}>
            {URGENCIAS.map(u => <button key={u.id} onClick={() => setF(x => ({ ...x, urgencia: u.id }))} style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: `2px solid ${f.urgencia === u.id ? u.color : C.border}`, background: f.urgencia === u.id ? u.bg : "white", color: f.urgencia === u.id ? u.color : C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{u.label}</button>)}
          </div>
        </Field>
        <Field label="Nombre / descripción del lugar *"><Input value={f.nombre} onChange={v => setF(x => ({ ...x, nombre: v }))} placeholder="Ej: Sector Las Flores, La Guaira" /></Field>
        <Field label="Ciudad / Estado"><Input value={f.estado} onChange={v => setF(x => ({ ...x, estado: v }))} placeholder="Ej: La Guaira, Vargas" /></Field>
        <Field label="País"><Input value={f.pais} onChange={v => setF(x => ({ ...x, pais: v }))} placeholder="Venezuela" /></Field>
        <Field label="Pinear ubicación exacta (toca el mapa o usa GPS)">
          <MapPicker lat={f.lat} lng={f.lng} onPin={(la, ln) => setF(x => ({ ...x, lat: la, lng: ln }))} />
          {f.lat != null && f.lng != null && <p style={{ fontSize: 11, color: C.green, marginTop: 4, fontWeight: 600 }}> Pin colocado: {f.lat.toFixed(4)}, {f.lng.toFixed(4)}</p>}
        </Field>
        <Field label="Situación actual"><Textarea value={f.descripcion} onChange={v => setF(x => ({ ...x, descripcion: v }))} placeholder="Casas destruidas, personas sin agua, heridos…" /></Field>
        <Field label="Insumos que se necesitan"><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{INSUMOS.map((i: string) => <Chip key={i} label={i} active={f.insumos.includes(i)} onClick={() => tog("insumos", i)} />)}</div></Field>
        <Field label="Tipo de ayuda requerida"><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{AYUDA.map((i: string) => <Chip key={i} label={i} active={f.ayuda.includes(i)} onClick={() => tog("ayuda", i)} />)}</div></Field>
        <Field label="Personal que se solicita"><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{PERSONAL.map((i: string) => <Chip key={i} label={i} active={f.personal.includes(i)} onClick={() => tog("personal", i)} />)}</div></Field>
        <Field label="Coordinador de zona"><Input value={f.contactoNombre} onChange={v => setF(x => ({ ...x, contactoNombre: v }))} placeholder="Nombre de quien coordina" /></Field>
        <Field label="Contacto *"><Input value={f.contacto} onChange={v => setF(x => ({ ...x, contacto: v }))} placeholder="+58 414-000-0000 / @usuario" /></Field>
        <Btn onClick={save} full>{online ? "Publicar Zona de Crisis" : "Guardar sin internet"}</Btn>
      </Card>
    </div>
  );

  // LIST
  const filtered = urgF === "todos" ? items : items.filter((z: BaseRecord) => z.urgencia === urgF);
  const sinAsistencia = items.filter((z: BaseRecord) => !(asistentes[z.id]?.length > 0)).length;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        {URGENCIAS.map(u => <StatBox key={u.id} n={items.filter((z: BaseRecord) => z.urgencia === u.id).length} label={u.statLabel} color={u.color} />)}
      </div>

      {/* Alerta zonas sin nadie */}
      {sinAsistencia > 0 && items.length > 0 && (
        <div style={{ background: C.amberLt, border: `1px solid ${C.amber}`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 18 }}></span>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.amber }}>
            {sinAsistencia} zona{sinAsistencia > 1 ? "s" : ""} sin personas asistiendo — ¡se necesita ayuda!
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 5, flex: 1, flexWrap: "wrap" }}>
          <Chip label="Todas" active={urgF === "todos"} onClick={() => setUrgF("todos")} />
          {URGENCIAS.map(u => <Chip key={u.id} label={u.label} active={urgF === u.id} onClick={() => setUrgF(u.id)} color={u.color} />)}
        </div>
        <Btn onClick={() => setView("form")} small>+ Zona</Btn>
      </div>

      {filtered.length === 0
        ? <Empty icon={null} msg={items.length === 0 ? "Sin zonas reportadas" : "Sin resultados"} />
        : filtered.map((z: BaseRecord) => {
          const u = urg(z.urgencia);
          const totalA = (asistentes[z.id] || []).length;
          const yoVoy = !!yoAsisto[z.id];
          return (
            <div key={z.id} onClick={() => { setSel(z); setView("detail"); }} style={{ background: "white", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", borderLeft: `4px solid ${u.color}`, boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ display: "flex", gap: 5, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
                <Pill label={u.label} color={u.color} bg={u.bg} />
                <Pill label={z.estado_zona === "activa" ? "Activa" : "Atendida"} color={z.estado_zona === "activa" ? C.primary : C.green} bg={z.estado_zona === "activa" ? C.primaryLt : C.greenLt} />
                {z.lat && <Pill label="GPS" color={C.teal} bg={C.tealLt} />}
                {z._off && <Pill label="" color={C.muted} bg="#F1F5F9" />}
              </div>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>{z.nombre}</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{[z.estado, z.pais].filter(Boolean).join(",")}</div>
              {z.insumos?.length > 0 && <div style={{ fontSize: 12, color: C.amber, marginBottom: 2 }}>{z.insumos.slice(0, 3).join("·")}{z.insumos.length > 3 ? ` +${z.insumos.length - 3}` : ""}</div>}
              {z.personal?.length > 0 && <div style={{ fontSize: 12, color: C.primary, marginBottom: 8 }}>{z.personal.slice(0, 2).join("·")}{z.personal.length > 2 ? ` +${z.personal.length - 2}` : ""}</div>}

              {/* Contador asistentes en la tarjeta */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {totalA === 0
                    ? <span style={{ fontSize: 12, color: C.muted }}>Nadie asistiendo aún</span>
                    : <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>{totalA} persona{totalA > 1 ? "s" : ""} asistiendo</span>
                  }
                </div>
                {yoVoy
                  ? <span style={{ fontSize: 11, fontWeight: 700, color: C.green, background: C.greenLt, padding: "3px 8px", borderRadius: 20 }}> Tú vas</span>
                  : <span style={{ fontSize: 11, fontWeight: 700, color: C.primary, background: C.primaryLt, padding: "3px 8px", borderRadius: 20 }}>Toca para asistir</span>
                }
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

// ============================================================
// MASCOTAS
// ============================================================
function MascotasSection({ online, onToast }: SectionProps) {
  const [items, setItems] = useState<BaseRecord[]>([]);
  const [view, setView] = useState("list");
  const [foto, setFoto] = useState<string | null>(null);
  const [catF, setCatF] = useState("todos");
  const [f, setF] = useState({ especie:"Perro",nombre:"",color:"",cat:"sana",heridas:"",ubicacion:"",contacto:"",contactoNombre:"",lat:null as number | null,lng:null as number | null });

  const reload = useCallback(async()=>setItems(await IDB.getAll("mascotas")),[]);
  useEffect(()=>{ reload(); },[reload]);

  const save = async () => {
    if (!f.ubicacion||!f.contacto) { onToast("Ubicación y contacto obligatorios","warn"); return; }
    const item = { ...f, foto, id:uid(), ts:now(), _off:!online };
    if (!(await reportarSeguro("mascotas", item, online, onToast))) return
    await IDB.put("mascotas", item);
    if (!online) addQ({ table:"mascotas", action:"insert", data:item });
    await reload(); setView("list"); setFoto(null);
    setF({ especie:"Perro",nombre:"",color:"",cat:"sana",heridas:"",ubicacion:"",contacto:"",contactoNombre:"",lat:null as number | null,lng:null as number | null });
    onToast(online?"Mascota reportada":"Guardada sin internet",online?"ok":"warn");
  };

  const filtered = catF==="todos"?items:items.filter((m: BaseRecord)=>m.cat===catF);

  if (view==="form") return (
    <div>
      <Back onClick={()=>setView("list")} />
      <Card>
        <h3 style={{margin:"0 0 14px",fontWeight:800}}>Reportar Mascota</h3>
        <PhotoUpload preview={foto} onFile={setFoto} label="Foto de la mascota" />
        <Field label="Estado">
          <div style={{display:"flex",gap:8}}>
            {MASCOTA_CATS.map(c=><button key={c.id} onClick={()=>setF(x=>({...x,cat:c.id}))} style={{flex:1,padding:"9px",borderRadius:8,border:`2px solid ${f.cat===c.id?c.color:C.border}`,background:f.cat===c.id?c.bg:"white",color:f.cat===c.id?c.color:C.muted,fontWeight:700,fontSize:12,cursor:"pointer"}}>{c.label}</button>)}
          </div>
        </Field>
        <Field label="Especie"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{["Perro","Gato","Ave","Otro"].map(e=><Chip key={e} label={e} active={f.especie===e} onClick={()=>setF(x=>({...x,especie:e}))} />)}</div></Field>
        <Field label="Nombre (si se conoce)"><Input value={f.nombre} onChange={v=>setF(x=>({...x,nombre:v}))} placeholder="o 'desconocido'" /></Field>
        <Field label="Color / características"><Input value={f.color} onChange={v=>setF(x=>({...x,color:v}))} placeholder="Ej: negro con manchas blancas" /></Field>
        {f.cat==="herida"&&<Field label="Descripción de heridas"><Textarea value={f.heridas} onChange={v=>setF(x=>({...x,heridas:v}))} rows={2} placeholder="Detalla las heridas visibles…" /></Field>}
        <Field label="Dónde está ahora (texto)"><Input value={f.ubicacion} onChange={v=>setF(x=>({...x,ubicacion:v}))} placeholder="Ej: Av. Libertador, Caracas" /></Field>
        <Field label="Pinear en el mapa">
          <MapPicker lat={f.lat} lng={f.lng} onPin={(la,ln)=>setF(x=>({...x,lat:la,lng:ln}))} />
          {f.lat != null && f.lng != null && <p style={{fontSize:11,color:C.green,marginTop:4,fontWeight:600}}> Pin: {f.lat.toFixed(4)}, {f.lng.toFixed(4)}</p>}
        </Field>
        <Field label="Tu nombre"><Input value={f.contactoNombre} onChange={v=>setF(x=>({...x,contactoNombre:v}))} placeholder="Quien reporta" /></Field>
        <Field label="Contacto *"><Input value={f.contacto} onChange={v=>setF(x=>({...x,contacto:v}))} placeholder="+58 414-000-0000" /></Field>
        <Btn onClick={save} full>{online?"Publicar":"Guardar sin internet"}</Btn>
      </Card>
    </div>
  );

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        <StatBox n={items.filter((m: BaseRecord)=>m.cat==="herida").length} label="Necesitan atención" color={C.amber} />
        <StatBox n={items.filter((m: BaseRecord)=>m.cat==="sana").length} label="Encontradas sanas" color={C.green} />
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
        <div style={{display:"flex",gap:5,flex:1,flexWrap:"wrap"}}>
          <Chip label="Todas" active={catF==="todos"} onClick={()=>setCatF("todos")} />
          {MASCOTA_CATS.map(c=><Chip key={c.id} label={c.label} active={catF===c.id} onClick={()=>setCatF(c.id)} color={c.color} />)}
        </div>
        <Btn onClick={()=>setView("form")} small>+ Reportar</Btn>
      </div>
      {filtered.length===0 ? <Empty icon={null} msg={items.length===0?"Sin reportes aún":"Sin resultados"} /> : filtered.map((m: BaseRecord)=>{
        const cat=MASCOTA_CATS.find(c=>c.id===m.cat)||MASCOTA_CATS[0];
        return (
          <div key={m.id} style={{background:"white",borderRadius:12,marginBottom:10,overflow:"hidden",display:"flex",borderLeft:`4px solid ${cat.color}`,boxShadow:"0 1px 3px rgba(0,0,0,0.07)"}}>
            <div style={{width:76,minHeight:76,background:cat.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>
              {m.foto?<img src={m.foto} alt="" style={{width:76,height:76,objectFit:"cover"}} />:<span style={{fontSize:11,fontWeight:700,color:cat.color,textAlign:"center",padding:4}}>{cat.label}</span>}
            </div>
            <div style={{padding:"10px 12px",flex:1}}>
              <Pill label={cat.label} color={cat.color} bg={cat.bg} />
              <div style={{fontWeight:800,fontSize:15,marginTop:4}}>{m.especie}{m.nombre?` — ${m.nombre}`:""}</div>
              {m.color&&<div style={{fontSize:12,color:C.muted}}>{m.color}</div>}
              <div style={{fontSize:12,color:C.muted}}>{m.ubicacion}</div>
              {m.heridas&&<div style={{fontSize:12,color:C.amber,marginTop:2}}>{m.heridas}</div>}
              {m.lat&&<div style={{fontSize:11,color:C.teal}}>GPS guardado</div>}
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>{m.contacto}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// VOLUNTARIOS
// ============================================================
function VoluntariosSection({ online, onToast }: SectionProps) {
  const [items, setItems] = useState<BaseRecord[]>([]);
  const [view, setView] = useState("list");
  const [sel, setSel] = useState<BaseRecord | null>(null);
  const [q, setQ] = useState("");
  const [f, setF] = useState({ nombre:"",especialidades:[] as string[],pais:"Venezuela",ciudad:"",remoto:false,idiomas:"Español",bio:"",contacto:"",lat:null as number | null,lng:null as number | null });

  const reload = useCallback(async()=>setItems(await IDB.getAll("voluntarios")),[]);
  useEffect(()=>{ reload(); },[reload]);
  const togE = (v: string) => setF(x => {
    const especialidades = x.especialidades.includes(v) ? x.especialidades.filter((e: string)=>e!==v) : [...x.especialidades,v];
    const remoto = especialidades.some(e => REMOTE_ESPECIALIDADES.includes(e)) ? x.remoto : false;
    return { ...x, especialidades, remoto };
  });
  const puedeRemoto = f.especialidades.some(e => REMOTE_ESPECIALIDADES.includes(e));

  const save = async () => {
    if (!f.nombre||!f.contacto||!f.especialidades.length) { onToast("Nombre, especialidad y contacto obligatorios","warn"); return; }
    const item = { ...f, pais:"Venezuela", remoto: puedeRemoto ? f.remoto : false, idiomas:f.idiomas.split(",").map(s=>s.trim()), estado:"disponible", id:uid(), ts:now(), _off:!online };
    if (!(await reportarSeguro("voluntarios", item, online, onToast))) return
    await IDB.put("voluntarios", item);
    if (!online) addQ({ table:"voluntarios", action:"insert", data:item });
    await reload(); setView("list");
    setF({ nombre:"",especialidades:[] as string[],pais:"Venezuela",ciudad:"",remoto:false,idiomas:"Español",bio:"",contacto:"",lat:null as number | null,lng:null as number | null });
    onToast(online?"Registrado como voluntario":"Guardado sin internet",online?"ok":"warn");
  };

  const filtered = items.filter((v: BaseRecord)=>{
    const mq=!q||[v.nombre,...(v.especialidades||[]),v.ciudad].filter(Boolean).some(s=>s.toLowerCase().includes(q.toLowerCase()));
    return mq;
  });

  if (view==="form") return (
    <div>
      <Back onClick={()=>setView("list")} />
      <Card>
        <h3 style={{margin:"0 0 4px",fontWeight:800}}>Registrarme como Voluntario</h3>
        <p style={{margin:"0 0 14px",fontSize:12,color:C.muted}}>Visible para coordinadores de todo el mundo que necesitan ayuda especializada</p>
        <Field label="Nombre completo *"><Input value={f.nombre} onChange={v=>setF(x=>({...x,nombre:v}))} placeholder="Tu nombre" /></Field>
        <Field label="Ciudad"><Input value={f.ciudad} onChange={v=>setF(x=>({...x,ciudad:v}))} placeholder="Ej: Caracas, Maracaibo, Valencia…" /></Field>
        <Field label="Especialidades *"><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{ESPECIALIDADES.map(e=><Chip key={e} label={e} active={f.especialidades.includes(e)} onClick={()=>togE(e)} color={C.teal} />)}</div></Field>
        {puedeRemoto && (
          <Field label="¿Puedes ayudar remotamente?">
            <div style={{display:"flex",gap:6}}>
              <Chip label="Sí, puedo ayudar remoto" active={f.remoto} onClick={()=>setF(x=>({...x,remoto:true}))} color={C.green} />
              <Chip label="Solo presencial" active={!f.remoto} onClick={()=>setF(x=>({...x,remoto:false}))} color={C.muted} />
            </div>
          </Field>
        )}
        <Field label="Idiomas"><Input value={f.idiomas} onChange={v=>setF(x=>({...x,idiomas:v}))} placeholder="Español, Inglés…" /></Field>
        <Field label="Tu ubicación aproximada (opcional)">
          <MapPicker lat={f.lat} lng={f.lng} onPin={(la,ln)=>setF(x=>({...x,lat:la,lng:ln}))} height={220} />
        </Field>
        <Field label="Sobre ti (opcional)"><Textarea value={f.bio} onChange={v=>setF(x=>({...x,bio:v}))} placeholder="Experiencia, equipamiento disponible…" rows={2} /></Field>
        <Field label="Contacto *"><Input value={f.contacto} onChange={v=>setF(x=>({...x,contacto:v}))} placeholder="+58 414-000-0000 / @usuario / email" /></Field>
        <Btn onClick={save} full color={C.teal}>{online?"Registrarme":"Guardar sin internet"}</Btn>
      </Card>
    </div>
  );

  if (view==="detail"&&sel) return (
    <div>
      <Back onClick={()=>{ setSel(null); setView("list"); }} />
      <Card>
        <div style={{width:52,height:52,borderRadius:"50%",background:C.tealLt,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:12}}></div>
        <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap"}}>
          <Pill label="Disponible" color={C.green} bg={C.greenLt} />
          {sel.remoto&&<Pill label="Remoto" color={C.teal} bg={C.tealLt} />}
          {sel.pais!=="Venezuela"&&<Pill label={`${sel.pais}`} color={C.primary} bg={C.primaryLt} />}
        </div>
        <h2 style={{margin:"0 0 4px",fontSize:20,fontWeight:800}}>{sel.nombre}</h2>
        <p style={{margin:"0 0 4px",color:C.muted,fontSize:13}}>{[sel.ciudad,sel.pais].filter(Boolean).join(",")}</p>
        {sel.idiomas?.length>0&&<p style={{margin:"0 0 12px",color:C.muted,fontSize:12}}>{(Array.isArray(sel.idiomas)?sel.idiomas:[sel.idiomas]).join(",")}</p>}
        {sel.especialidades?.length>0&&<div style={{marginBottom:12}}><div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6,textTransform:"uppercase"}}>Especialidades</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{sel.especialidades.map((e: string)=><Pill key={e} label={e} color={C.teal} bg={C.tealLt} />)}</div></div>}
        {sel.bio&&<div style={{background:C.bg,borderRadius:10,padding:12,marginBottom:14,fontSize:13,lineHeight:1.6}}>{sel.bio}</div>}
        {sel.lat&&sel.lng&&<MapView lat={sel.lat} lng={sel.lng} label={sel.ciudad} />}
        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14}}>
          <p style={{margin:0,fontSize:15,fontWeight:800,color:C.teal}}>{sel.contacto}</p>
        </div>
      </Card>
    </div>
  );

  return (
    <div>
      <div style={{marginBottom:14}}>
        <StatBox n={items.filter((v: BaseRecord)=>v.estado==="disponible").length} label="Disponibles" color={C.green} />
      </div>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Nombre, especialidad, ciudad…" style={{flex:1,padding:"10px 12px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,outline:"none"}} />
        <Btn onClick={()=>setView("form")} small color={C.teal}>+ Unirme</Btn>
      </div>
      {filtered.length===0 ? <Empty icon={null} msg={items.length===0?"Sé el primero en registrarte":"Sin resultados"} /> : filtered.map((v: BaseRecord)=>(
        <div key={v.id} onClick={()=>{ setSel(v); setView("detail"); }} style={{background:"white",borderRadius:12,padding:"12px 14px",marginBottom:10,cursor:"pointer",borderLeft:`4px solid ${v.pais!=="Venezuela"?C.primary:C.teal}`,boxShadow:"0 1px 3px rgba(0,0,0,0.07)",display:"flex",gap:12,alignItems:"flex-start"}}>
          <div style={{width:40,height:40,borderRadius:"50%",background:v.pais!=="Venezuela"?C.primaryLt:C.tealLt,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}></div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",gap:4,marginBottom:4,flexWrap:"wrap"}}>
              <Pill label="Disponible" color={C.green} bg={C.greenLt} />
              {v.remoto&&<Pill label="Remoto" color={C.teal} bg={C.tealLt} />}
              {v.pais!=="Venezuela"&&<Pill label={`${v.pais}`} color={C.primary} bg={C.primaryLt} />}
            </div>
            <div style={{fontWeight:800,fontSize:15}}>{v.nombre}</div>
            <div style={{fontSize:12,color:C.muted}}>{[v.ciudad,v.pais].filter(Boolean).join(",")}</div>
            {v.especialidades?.length>0&&<div style={{fontSize:12,color:C.teal,marginTop:2}}>{v.especialidades.slice(0,3).join("·")}{v.especialidades.length>3?` +${v.especialidades.length-3}`:""}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// DONACIONES
// ============================================================
const CUENTAS = [
  { tipo:"Zelle", instruccion:"Enviar a:", dato:"crisisve@gmail.com", nombre:"Reconstruyendo Venezuela Ayuda Humanitaria" },
];

// Destinos detallados con categorías
const DESTINOS = [
  { cat:"Alimentación",      items:["Cajas de alimentos","Agua potable","Fórmula infantil / leche","Comida para bebés","Cocinas y utensilios","Otro (alimentación)"] },
  { cat:"Salud y Medicina",  items:["Medicamentos básicos","Medicamentos crónicos (insulina, etc.)","Suero y soluciones IV","Material de curas y vendajes","Equipos médicos (tensiómetros, etc.)","Oxígeno medicinal","Otro (salud)"] },
  { cat:"Hospitales y Paramédicos", items:["Insumos quirúrgicos","Equipos de UCI","Camillas y sillas de ruedas","Desfibriladores / monitors","Insumos de enfermería","Ambulancias / transporte médico","Otro (hospitales)"] },
  { cat:"Rescate y Emergencias", items:["Equipos de rescate","Cuerdas / arneses / cascos","Motosierras y herramientas","Botes de rescate","Drones de búsqueda","Primeros auxilios avanzados","Otro (rescate)"] },
  { cat:"Ferretería e Infraestructura", items:["Materiales de construcción","Herramientas básicas","Generadores eléctricos","Combustible y gas","Linternas y baterías","Carpas y lonas","Otro (ferretería)"] },
  { cat:"Ropa y Abrigo",     items:["Ropa para adultos","Ropa para niños","Calzado","Frazadas y colchonetas","Pañales y ropa de bebé","Kits de higiene personal","Otro (ropa)"] },
  { cat:"Gastos Fúnebres",   items:["Ataúdes y urnas","Traslado de restos","Servicios funerarios","Apoyo a familias en duelo","Otro (gastos fúnebres)"] },
  { cat:"Apoyo Psicológico", items:["Atención psicológica","Grupos de apoyo","Material terapéutico","Apoyo a niños en crisis","Otro (apoyo psicológico)"] },
  { cat:"Comunicaciones",    items:["Teléfonos satelitales","Radios de emergencia","Internet de emergencia","Otro (comunicaciones)"] },
  { cat:"Animales",          items:["Alimento para mascotas","Atención veterinaria","Refugio para animales","Otro (animales)"] },
];

const ALL_DESTINOS = DESTINOS.flatMap(d => d.items);

// Colores por categoría
const CAT_COLORS: Record<string, { color: string; bg: string }> = {
  "Alimentación": { color: C.green,  bg: C.greenLt },
  "Salud y Medicina": { color: C.sky, bg: C.skyLt },
  "Hospitales y Paramédicos": { color: C.primary, bg: C.primaryLt },
  "Rescate y Emergencias": { color: C.amber, bg: C.amberLt },
  "Ferretería e Infraestructura": { color: C.teal, bg: C.tealLt },
  "Ropa y Abrigo": { color: C.purple, bg: C.purpleLt },
  "Gastos Fúnebres": { color: C.muted, bg: "#F1F5F9" },
  "Apoyo Psicológico": { color: "#7C3AED", bg: "#F5F3FF" },
  "Comunicaciones": { color: C.sky, bg: C.skyLt },
  "Animales": { color: C.teal, bg: C.tealLt },
};

function catForDestino(destino: string) {
  const cat = DESTINOS.find(d => d.items.includes(destino));
  return cat ? CAT_COLORS[cat.cat] || { color: C.primary, bg: C.primaryLt } : { color: C.primary, bg: C.primaryLt };
}

// Totales por destino para el desglose
function calcTotalesPorDestino(dons: BaseRecord[]) {
  const mapa: Record<string, { usd: number; bs: number }> = {};
  dons.filter((d: BaseRecord) => d.verificado && d.destinos?.length).forEach(d => {
    const montoPorDestino = parseFloat(d.monto || 0) / (d.destinos.length || 1);
    d.destinos.forEach((dest: string) => {
      if (!mapa[dest]) mapa[dest] = { usd: 0, bs: 0 };
      if (d.moneda === "USD") mapa[dest].usd += montoPorDestino;
      else mapa[dest].bs += montoPorDestino;
    });
  });
  return mapa;
}

// IDB store para campañas de ORGs
const ORG_KEY = "crisisve_campanas_v1";
const getCampanas = (): BaseRecord[] => { try { return JSON.parse(localStorage.getItem(ORG_KEY) || "[]"); } catch { return []; } };
const saveCampanas = (d: BaseRecord[]) => { try { localStorage.setItem(ORG_KEY, JSON.stringify(d)); } catch {} };

function DonacionesSection({ online, onToast }: SectionProps) {
  const [dons, setDons] = useState<BaseRecord[]>([]);
  const [campanas, setCampanas] = useState<BaseRecord[]>(getCampanas());
  const [view, setView] = useState("main"); // main | donar | campana | detalle_campana | detalle_don
  const [sel, setSel] = useState<BaseRecord | null>(null);
  const [tab2, setTab2] = useState("donaciones"); // donaciones | campanas | desglose
  const [comp, setComp] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);

  // Form donación
  const [fd, setFd] = useState({ monto:"", moneda:"USD", metodo:"Zelle", nombre:"", mensaje:"", destinos:[] as string[] });
  // Form campaña ORG
  const [fc, setFc] = useState({ nombre:"", tipo:"org", descripcion:"", meta:"", moneda:"USD", destinos:[] as string[], contacto:"", zelle:"", pagoMovil:"", banco:"", cuenta:"", pais:"Venezuela" });

  const reload = useCallback(async () => setDons(await IDB.getAll("donaciones")), []);
  useEffect(() => { reload(); }, [reload]);

  const togD = (v: string) => setFd(x => ({ ...x, destinos: x.destinos.includes(v) ? x.destinos.filter((d: string) => d !== v) : [...x.destinos, v] }));
  const togC = (v: string) => setFc(x => ({ ...x, destinos: x.destinos.includes(v) ? x.destinos.filter((d: string) => d !== v) : [...x.destinos, v] }));

  const totalUSD = dons.filter((d: BaseRecord) => d.moneda === "USD" && d.verificado).reduce((s, d) => s + parseFloat(d.monto || 0), 0);
  const totalBS  = dons.filter((d: BaseRecord) => d.moneda === "Bs"  && d.verificado).reduce((s, d) => s + parseFloat(d.monto || 0), 0);
  const pendientes = dons.filter((d: BaseRecord) => !d.verificado).length;
  const totalesPorDestino = calcTotalesPorDestino(dons);

  const saveDon = async () => {
    if (!fd.monto || !fd.nombre) { onToast("Monto y nombre son obligatorios", "warn"); return; }
    if (!fd.destinos.length) { onToast("Selecciona al menos un destino para tu donación", "warn"); return; }
    const item = { ...fd, comprobante: comp, verificado: false, id: uid(), ts: now(), _off: !online };
    if (!(await reportarSeguro("donaciones", item, online, onToast))) return
    await IDB.put("donaciones", item);
    if (!online) addQ({ table: "donaciones", action: "insert", data: item });
    await reload(); setView("main"); setComp(null);
    setFd({ monto:"", moneda:"USD", metodo:"Zelle", nombre:"", mensaje:"", destinos:[] as string[] });
    onToast("¡Gracias! Tu donación fue registrada y se verificará pronto.", "ok");
  };

  const saveCampana = () => {
    if (!fc.nombre || !fc.contacto || !fc.destinos.length) { onToast("Nombre, contacto y al menos un destino son obligatorios", "warn"); return; }
    const item = { ...fc, logo, id: uid(), ts: now(), totalRecaudado: 0, donantes: 0, _off: !online };
    const nueva = [item, ...campanas];
    saveCampanas(nueva); setCampanas(nueva); setView("main");
    setFc({ nombre:"", tipo:"org", descripcion:"", meta:"", moneda:"USD", destinos:[] as string[], contacto:"", zelle:"", pagoMovil:"", banco:"", cuenta:"", pais:"Venezuela" });
    setLogo(null);
    onToast("Campaña registrada — ¡gracias por organizarte!", "ok");
  };

  // ── FORM DONACIÓN ──────────────────────────────────────────
  if (view === "donar") return (
    <div>
      <Back onClick={() => setView("main")} />
      <Card>
        <h3 style={{ margin:"0 0 4px", fontWeight:800 }}>Registrar mi donación</h3>
        <p style={{ margin:"0 0 14px", fontSize:12, color:C.muted }}>El comprobante garantiza transparencia. Tu donación aparece verificada una vez confirmada.</p>

        <div style={{ background:C.primaryLt, borderRadius:10, padding:14, marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:800, marginBottom:6 }}>¿Cómo donar?</div>
          <p style={{ margin:0, fontSize:13, color:C.txt, lineHeight:1.6 }}>Las donaciones recibidas por esta plataforma están destinadas exclusivamente a reconstruir viviendas para las familias que lo perdieron todo.</p>
        </div>

        <Field label="Método de pago">
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {CUENTAS.map(c => <Chip key={c.tipo} label={c.tipo} active={fd.metodo===c.tipo} onClick={() => setFd(x=>({...x,metodo:c.tipo}))} />)}
          </div>
        </Field>
        {(() => { const cu = CUENTAS.find(c => c.tipo===fd.metodo); return cu ? (
          <div style={{ background:C.primaryLt, borderRadius:10, padding:14, marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:C.primary, textTransform:"uppercase", marginBottom:6 }}>Datos para transferir</div>
            <div style={{ fontWeight:800, fontSize:14, marginBottom:2 }}>{cu.nombre}</div>
            <div style={{ fontSize:12, color:C.muted }}>{cu.instruccion}</div>
            <div style={{ fontSize:13, fontWeight:700, color:C.primaryDk, marginTop:2 }}>{cu.dato}</div>
          </div>
        ) : null; })()}

        <Field label="Moneda">
          <div style={{ display:"flex", gap:6 }}>
            {["USD","Bs"].map((m: string) => <Chip key={m} label={m} active={fd.moneda===m} onClick={() => setFd(x=>({...x,moneda:m}))} />)}
          </div>
        </Field>
        <Field label="Monto *"><Input value={fd.monto} onChange={v=>setFd(x=>({...x,monto:v}))} placeholder={fd.moneda==="USD"?"Ej: 25.00":"Ej: 50000"} type="number" /></Field>
        <Field label="Tu nombre o alias *"><Input value={fd.nombre} onChange={v=>setFd(x=>({...x,nombre:v}))} placeholder="Nombre, organización o anónimo" /></Field>
        <Field label="Mensaje (opcional)"><Textarea value={fd.mensaje} onChange={v=>setFd(x=>({...x,mensaje:v}))} placeholder="Ej: Con amor para las familias de La Guaira" rows={2} /></Field>

        <Field label="¿Para qué va tu donación? * (selecciona todos los que aplican)">
          <p style={{ fontSize:11, color:C.muted, margin:"0 0 10px" }}>Esto garantiza transparencia total — todos verán el desglose exacto</p>
          {DESTINOS.map(cat => (
            <div key={cat.cat} style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:800, color:C.muted, textTransform:"uppercase", marginBottom:6 }}>{cat.cat}</div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {cat.items.map((i: string) => {
                  const cc = CAT_COLORS[cat.cat] || { color:C.primary, bg:C.primaryLt };
                  return <Chip key={i} label={i} active={fd.destinos.includes(i)} onClick={() => togD(i)} color={cc.color} />;
                })}
              </div>
            </div>
          ))}
        </Field>

        {fd.destinos.length > 0 && (
          <div style={{ background:C.greenLt, borderRadius:10, padding:12, marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:C.green, marginBottom:6 }}> Tu donación irá a:</div>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {fd.destinos.map((d: string) => { const cc=catForDestino(d); return <Pill key={d} label={d} color={cc.color} bg={cc.bg} />; })}
            </div>
          </div>
        )}

        <Field label="Comprobante de pago (foto)">
          <PhotoUpload preview={comp} onFile={setComp} label="Subir comprobante" />
        </Field>
        <Btn onClick={saveDon} full color={C.primary}>Registrar Donación</Btn>
      </Card>
    </div>
  );

  // ── FORM CAMPAÑA ORG ───────────────────────────────────────
  if (view === "campana") return (
    <div>
      <Back onClick={() => setView("main")} />
      <Card>
        <h3 style={{ margin:"0 0 4px", fontWeight:800 }}>Registrar Campaña de Recolección</h3>
        <p style={{ margin:"0 0 14px", fontSize:12, color:C.muted }}>Para ORGs, fundaciones y personas que están organizando recolecciones. Toda la información es pública y verificable.</p>

        <PhotoUpload preview={logo} onFile={setLogo} label="Logo o foto de la org" />

        <Field label="Tipo">
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {[["org","Organización / Fundación"],["empresa","Empresa / Negocio"]].map(([v,l]) => (
              <Chip key={v} label={l} active={fc.tipo===v} onClick={() => setFc(x=>({...x,tipo:v}))} />
            ))}
          </div>
        </Field>

        <Field label="Nombre de la org / persona / colectivo *"><Input value={fc.nombre} onChange={v=>setFc(x=>({...x,nombre:v}))} placeholder="Ej: Fundación Manos Unidas / María García" /></Field>
        <Field label="País de origen"><Input value={fc.pais} onChange={v=>setFc(x=>({...x,pais:v}))} placeholder="Venezuela, Colombia, España…" /></Field>
        <Field label="Descripción de la campaña"><Textarea value={fc.descripcion} onChange={v=>setFc(x=>({...x,descripcion:v}))} placeholder="Qué están haciendo, cómo van a usar los fondos, dónde están trabajando…" rows={3} /></Field>

        <Field label="¿Para qué van los fondos recolectados? * (selecciona todos)">
          {DESTINOS.map(cat => (
            <div key={cat.cat} style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:800, color:C.muted, textTransform:"uppercase", marginBottom:6 }}>{cat.cat}</div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {cat.items.map((i: string) => {
                  const cc = CAT_COLORS[cat.cat] || { color:C.primary, bg:C.primaryLt };
                  return <Chip key={i} label={i} active={fc.destinos.includes(i)} onClick={() => togC(i)} color={cc.color} />;
                })}
              </div>
            </div>
          ))}
        </Field>

        {fc.destinos.length > 0 && (
          <div style={{ background:C.greenLt, borderRadius:10, padding:12, marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:C.green, marginBottom:6 }}> Esta campaña cubre:</div>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {fc.destinos.map((d: string) => { const cc=catForDestino(d); return <Pill key={d} label={d} color={cc.color} bg={cc.bg} />; })}
            </div>
          </div>
        )}

        <div style={{ background:C.bg, borderRadius:10, padding:14, marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:800, marginBottom:10 }}>¿Cómo pueden donarles a ustedes?</div>
          <Field label="Zelle (email o teléfono)"><Input value={fc.zelle} onChange={v=>setFc(x=>({...x,zelle:v}))} placeholder="Ej: fundacion@gmail.com" /></Field>
          <Field label="Pago Móvil (banco · CI · teléfono)"><Input value={fc.pagoMovil} onChange={v=>setFc(x=>({...x,pagoMovil:v}))} placeholder="Banesco · V-12345678 · 0414-000-0000" /></Field>
          <Field label="Banco y número de cuenta"><Input value={fc.cuenta} onChange={v=>setFc(x=>({...x,cuenta:v}))} placeholder="Banesco · 0134-0000-00-0000000000" /></Field>
        </div>

        <Field label="Meta de recaudación (opcional)">
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ flex:1 }}><Input value={fc.meta} onChange={v=>setFc(x=>({...x,meta:v}))} placeholder="Ej: 5000" type="number" /></div>
            <div style={{ display:"flex", gap:5 }}>
              {["USD","Bs"].map((m: string) => <Chip key={m} label={m} active={fc.moneda===m} onClick={() => setFc(x=>({...x,moneda:m}))} />)}
            </div>
          </div>
        </Field>
        <Field label="Contacto principal *"><Input value={fc.contacto} onChange={v=>setFc(x=>({...x,contacto:v}))} placeholder="+58 414-000-0000 / @usuario / email" /></Field>
        <Btn onClick={saveCampana} full color={C.teal}> Publicar Campaña</Btn>
      </Card>
    </div>
  );

  // ── DETALLE CAMPAÑA ────────────────────────────────────────
  if (view === "detalle_campana" && sel) {
    const tipoLabel: Record<string, string> = { org:"Organización", persona:"Persona", empresa:"Empresa", comunidad:"Colectivo" };
    return (
      <div>
        <Back onClick={() => { setSel(null); setView("main"); }} />
        <Card>
          {sel.logo && <img src={sel.logo} alt="" style={{ width:72, height:72, borderRadius:12, objectFit:"cover", marginBottom:12 }} />}
          <Pill label={tipoLabel[sel.tipo]||sel.tipo} color={C.teal} bg={C.tealLt} />
          <h2 style={{ margin:"8px 0 4px", fontSize:20, fontWeight:800 }}>{sel.nombre}</h2>
          <p style={{ margin:"0 0 4px", fontSize:12, color:C.muted }}>{sel.pais} · {fmtDate(sel.ts)}</p>
          {sel.descripcion && <div style={{ background:C.bg, borderRadius:10, padding:12, margin:"12px 0", fontSize:13, lineHeight:1.6 }}>{sel.descripcion}</div>}

          {sel.destinos?.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", marginBottom:8 }}>Esta campaña cubre</div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {sel.destinos.map((d: string) => { const cc=catForDestino(d); return <Pill key={d} label={d} color={cc.color} bg={cc.bg} />; })}
              </div>
            </div>
          )}

          {sel.meta && (
            <div style={{ background:C.primaryLt, borderRadius:10, padding:14, marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.primary, marginBottom:4 }}>META DE RECAUDACIÓN</div>
              <div style={{ fontSize:22, fontWeight:900, color:C.primary }}>{sel.moneda==="USD"?"$":""}{parseFloat(sel.meta).toLocaleString()} {sel.moneda}</div>
            </div>
          )}

          <div style={{ background:C.bg, borderRadius:10, padding:14, marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:800, marginBottom:10 }}>Donar a esta campaña</div>
            {sel.zelle     && <div style={{ marginBottom:8 }}><div style={{ fontSize:11, color:C.muted, fontWeight:600 }}>ZELLE</div><div style={{ fontSize:14, fontWeight:700 }}>{sel.zelle}</div></div>}
            {sel.pagoMovil && <div style={{ marginBottom:8 }}><div style={{ fontSize:11, color:C.muted, fontWeight:600 }}>PAGO MÓVIL</div><div style={{ fontSize:14, fontWeight:700 }}>{sel.pagoMovil}</div></div>}
            {sel.cuenta    && <div style={{ marginBottom:8 }}><div style={{ fontSize:11, color:C.muted, fontWeight:600 }}>TRANSFERENCIA</div><div style={{ fontSize:14, fontWeight:700 }}>{sel.cuenta}</div></div>}
          </div>

          <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", marginBottom:6 }}>Contacto</div>
            <p style={{ margin:0, fontSize:15, fontWeight:800, color:C.teal }}>{sel.contacto}</p>
          </div>
        </Card>
      </div>
    );
  }

  // ── MAIN VIEW ──────────────────────────────────────────────
  const topDestinos = Object.entries(totalesPorDestino)
    .sort((a,b) => ((b[1] as {usd:number;bs:number}).usd + (b[1] as {usd:number;bs:number}).bs/40000) - ((a[1] as {usd:number;bs:number}).usd + (a[1] as {usd:number;bs:number}).bs/40000))
    .slice(0, 8);

  return (
    <div>
      <a
        href="https://gofund.me/c3937cbbc"
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', background: '#02A95C', color: 'white', textAlign: 'center', padding: '14px', borderRadius: 12, fontWeight: 800, fontSize: 16, textDecoration: 'none', marginBottom: 16 }}
      >
        Donar en GoFundMe
      </a>
      {/* HERO */}
      <div style={{background:'linear-gradient(135deg, #1D4ED8 0%, #0EA5E9 100%)', borderRadius:16, padding:24, marginBottom:14, color:'white', position:'relative', overflow:'hidden'}}>
        <div style={{position:'absolute', top:12, right:12, display:'flex', alignItems:'center', gap:6, background:'rgba(255,255,255,0.15)', borderRadius:20, padding:'4px 10px'}}>
          <div style={{width:8, height:8, borderRadius:'50%', background:'#4ADE80'}} />
          <span style={{fontSize:11, fontWeight:700}}>EN VIVO</span>
        </div>
        <div style={{fontSize:11, fontWeight:700, opacity:.85, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px'}}>Total recaudado para las víctimas</div>
        <div style={{fontSize:40, fontWeight:900, letterSpacing:'-1px', lineHeight:1}}>
          ${totalUSD.toLocaleString('es-VE',{minimumFractionDigits:2, maximumFractionDigits:2})} <span style={{fontSize:20}}>USD</span>
        </div>
        {totalBS > 0 && <div style={{fontSize:16, fontWeight:700, opacity:.85, marginTop:4}}>{totalBS.toLocaleString('es-VE')} Bs</div>}
        <div style={{margin:'12px 0 6px', background:'rgba(255,255,255,0.2)', borderRadius:20, height:6}}>
          <div style={{background:'#4ADE80', width:`${Math.min((totalUSD/10000)*100, 100)}%`, height:'100%', borderRadius:20, transition:'width 1s'}} />
        </div>
        <div style={{fontSize:11, opacity:.8}}>{dons.filter((d: BaseRecord)=>d.verificado).length} donantes · Meta: $10,000 USD</div>
        <div style={{fontSize:11, opacity:.7, marginTop:4}}>Cada dólar va destinado a reconstruir hogares para familias damnificadas</div>
        <div style={{display:'flex', gap:8, marginTop:14}}>
          <button onClick={()=>setView('donar')} style={{flex:1, background:'white', color:'#1D4ED8', border:'none', borderRadius:9, padding:'10px', fontWeight:800, fontSize:13, cursor:'pointer'}}>Ya doné — registrar</button>
          <button onClick={()=>setView('campana')} style={{flex:1, background:'rgba(255,255,255,0.2)', color:'white', border:'2px solid rgba(255,255,255,0.5)', borderRadius:9, padding:'10px', fontWeight:800, fontSize:13, cursor:'pointer'}}>Crear campaña</button>
        </div>
      </div>

      {/* SUBTABS */}
      <div style={{ display:"flex", background:"white", borderRadius:12, padding:4, marginBottom:14, gap:4 }}>
        {[["donaciones","Donaciones"],["campanas","Campañas"],["desglose","Desglose"]].map(([id,label]) => (
          <button key={id} onClick={() => setTab2(id)} style={{ flex:1, padding:"8px 4px", borderRadius:9, border:"none", background:tab2===id?C.primary:"transparent", color:tab2===id?"white":C.muted, fontWeight:700, fontSize:12, cursor:"pointer", transition:"all .15s" }}>{label}</button>
        ))}
      </div>

      {/* TAB: DONACIONES */}
      {tab2 === "donaciones" && (
        <div>
          {dons.length === 0
            ? <Empty icon={null} msg="Sé el primero en registrar una donación" />
            : dons.map((d: BaseRecord) => (
                <div key={d.id} style={{ background:"white", borderRadius:12, padding:"12px 14px", marginBottom:8, borderLeft:`4px solid ${d.verificado?C.green:C.amber}`, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:14 }}>{d.nombre}</div>
                      <div style={{ fontSize:11, color:C.muted }}>{d.metodo} · {fmtDate(d.ts)}</div>
                      {d.mensaje && <div style={{ fontSize:12, color:C.muted, marginTop:2, fontStyle:"italic" }}>"{d.mensaje}"</div>}
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0, marginLeft:12 }}>
                      <div style={{ fontWeight:900, fontSize:16, color:C.primary }}>{d.moneda==="USD"?"$":""}{parseFloat(d.monto||0).toLocaleString()} {d.moneda}</div>
                      <Pill label={d.verificado?"Verificada":"Pendiente"} color={d.verificado?C.green:C.amber} bg={d.verificado?C.greenLt:C.amberLt} />
                    </div>
                  </div>
                  {d.destinos?.length > 0 && (
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:6 }}>
                      {d.destinos.map((dest: string) => { const cc=catForDestino(dest); return <Pill key={dest} label={dest} color={cc.color} bg={cc.bg} />; })}
                    </div>
                  )}
                </div>
              ))
          }
        </div>
      )}

      {/* TAB: CAMPAÑAS */}
      {tab2 === "campanas" && (
        <div>
          {campanas.length === 0
            ? (
              <div style={{ textAlign:"center", padding:"40px 20px" }}>
                <div style={{ fontSize:44, marginBottom:10 }}></div>
                <div style={{ fontWeight:700, fontSize:15, marginBottom:6 }}>Sin campañas registradas</div>
                <p style={{ fontSize:13, color:C.muted, marginBottom:16 }}>¿Eres una org o persona que está recolectando ayuda?<br/>Regístrala aquí para que todos puedan apoyarte.</p>
                <Btn onClick={() => setView("campana")} color={C.teal}>Registrar mi campaña</Btn>
              </div>
            )
            : campanas.map((c: BaseRecord) => {
                const tipoLabel: Record<string, string> = { org:"Org", persona:"Persona", empresa:"Empresa", comunidad:"Colectivo" };
                return (
                  <div key={c.id} onClick={() => { setSel(c); setView("detalle_campana"); }} style={{ background:"white", borderRadius:12, padding:"14px 16px", marginBottom:10, cursor:"pointer", borderLeft:`4px solid ${C.teal}`, boxShadow:"0 1px 3px rgba(0,0,0,0.07)", display:"flex", gap:12 }}>
                    {c.logo
                      ? <img src={c.logo} alt="" style={{ width:52, height:52, borderRadius:10, objectFit:"cover", flexShrink:0 }} />
                      : <div style={{ width:52, height:52, borderRadius:10, background:C.tealLt, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}></div>
                    }
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", gap:5, marginBottom:5, flexWrap:"wrap" }}>
                        <Pill label={tipoLabel[c.tipo]||c.tipo} color={C.teal} bg={C.tealLt} />
                        <Pill label={`${c.pais}`} color={C.primary} bg={C.primaryLt} />
                      </div>
                      <div style={{ fontWeight:800, fontSize:15, marginBottom:2 }}>{c.nombre}</div>
                      {c.descripcion && <div style={{ fontSize:12, color:C.muted, marginBottom:6, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.descripcion}</div>}
                      {c.destinos?.length > 0 && (
                        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                          {c.destinos.slice(0,3).map((d: string) => { const cc=catForDestino(d); return <Pill key={d} label={d} color={cc.color} bg={cc.bg} />; })}
                          {c.destinos.length > 3 && <Pill label={`+${c.destinos.length-3}`} color={C.muted} bg="#F1F5F9" />}
                        </div>
                      )}
                      {c.meta && <div style={{ fontSize:12, color:C.primary, fontWeight:700, marginTop:4 }}>Meta: {c.moneda==="USD"?"$":""}{parseFloat(c.meta).toLocaleString()} {c.moneda}</div>}
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* TAB: DESGLOSE */}
      {tab2 === "desglose" && (
        <div>
          <Card style={{ marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:800, marginBottom:12 }}>¿A dónde va el dinero?</div>
            {topDestinos.length === 0
              ? <div style={{ fontSize:13, color:C.muted, textAlign:"center", padding:"20px 0" }}>Sin datos aún — las donaciones verificadas aparecerán aquí</div>
              : topDestinos.map(([dest, totales]) => {
                  const cc = catForDestino(dest);
                  const total = totales.usd;
                  const maxUSD = Math.max(...topDestinos.map(([,t])=>t.usd), 1);
                  const pct = Math.round((total/maxUSD)*100);
                  return (
                    <div key={dest} style={{ marginBottom:12 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontSize:12, fontWeight:600, color:C.txt }}>{dest}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:cc.color }}>${total.toFixed(0)} USD</span>
                      </div>
                      <div style={{ background:"#F1F5F9", borderRadius:20, height:8, overflow:"hidden" }}>
                        <div style={{ background:cc.color, width:`${pct}%`, height:"100%", borderRadius:20, transition:"width 0.5s" }} />
                      </div>
                    </div>
                  );
                })
            }
          </Card>

          {/* Todas las categorías con sus items */}
          {DESTINOS.map(cat => {
            const cc = CAT_COLORS[cat.cat] || { color:C.primary, bg:C.primaryLt };
            const itemsConDatos = cat.items.filter(i => totalesPorDestino[i]);
            return (
              <div key={cat.cat} style={{ background:"white", borderRadius:12, padding:"14px 16px", marginBottom:10, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
                <div style={{ fontWeight:800, fontSize:14, color:cc.color, marginBottom:8 }}>{cat.cat}</div>
                {itemsConDatos.length === 0
                  ? <div style={{ fontSize:12, color:C.muted }}>Sin donaciones registradas para esta categoría</div>
                  : itemsConDatos.map((i: string) => (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:`1px solid ${C.border}` }}>
                        <span style={{ fontSize:12 }}>{i}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:cc.color }}>${(totalesPorDestino[i]?.usd||0).toFixed(0)} USD</span>
                      </div>
                    ))
                }
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ============================================================
// REFUGIOS
// ============================================================
const REFUGIO_IDB_KEY = "refugios";

// Tipos de persona dentro de un refugio
const TIPOS_PERSONA = [
  { id:"nino",    label:"Niño/a",         color:"#0EA5E9", bg:"#F0F9FF" },
  { id:"adulto",  label:"Adulto/a",       color:"#0D9488", bg:"#F0FDFA" },
  { id:"mayor",   label:"Adulto mayor",   color:"#7C3AED", bg:"#F5F3FF" },
  { id:"embarazada", label:"Embarazada",  color:"#D97706", bg:"#FEF3C7" },
  { id:"discapacidad",label:"Discapacidad/Movilidad reducida",color:"#2563EB",bg:"#EFF6FF"},
  { id:"medico",  label:"Con condición médica", color:"#059669", bg:"#ECFDF5" },
];

// Necesidades que puede tener un refugio
const NECESIDADES_REFUGIO = [
  "Agua potable","Alimentos","Medicamentos","Ropa","Frazadas","Pañales",
  "Atención médica urgente","Psicólogo/a","Sanitarios","Electricidad",
  "Comunicaciones","Transporte","Colchonetas / camas","Personal de apoyo","Otro",
];

function RefugiosSection({ online, onToast }: SectionProps) {
  const [refugios, setRefugios]   = useState<BaseRecord[]>([]);
  const [view, setView]           = useState("list"); // list | form_refugio | detalle | form_persona
  const [sel, setSel] = useState<BaseRecord | null>(null);
  const [q, setQ]                 = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [fotoPer, setFotoPer] = useState<string | null>(null);

  // Form nuevo refugio
  const [fr, setFr] = useState({
    nombre:"", direccion:"", municipio:"", estado:"", pais:"Venezuela",
    capacidad:"", descripcion:"", lat:null as number | null, lng:null as number | null,
    necesidades:[] as string[], contactoNombre:"", contacto:"",
  });

  // Form nueva persona dentro de refugio
  const [fp, setFp] = useState({
    nombre:"", tipo:"adulto", edad:"", descripcion:"", estado:"buscando_familia",
    contactoPropio:"",
  });

  const reload = useCallback(async () => setRefugios(await IDB.getAll("refugios")), []);
  useEffect(() => { reload(); }, [reload]);

  const togN = (v: string) => setFr(x => ({ ...x, necesidades: x.necesidades.includes(v) ? x.necesidades.filter((n: string)=>n!==v) : [...x.necesidades, v] }));

  // Guardar refugio
  const saveRefugio = async () => {
    if (!fr.nombre || !fr.contacto) { onToast("Nombre del refugio y contacto son obligatorios","warn"); return; }
    const item = {
      ...fr, foto, personas:[], id:uid(), ts:now(), _off:!online,
      estado:"activo",
    };
    if (!(await reportarSeguro("refugios", item, online, onToast))) return
    await IDB.put("refugios", item);
    if (!online) addQ({ table:"refugios", action:"insert", data:item });
    await reload(); setView("list"); setFoto(null);
    setFr({ nombre:"",direccion:"",municipio:"",estado:"",pais:"Venezuela",capacidad:"",descripcion:"",lat:null as number | null,lng:null as number | null,necesidades:[] as string[],contactoNombre:"",contacto:"" });
    onToast(online ? "Refugio registrado" : "Guardado sin internet","ok");
  };

  // Guardar persona en refugio
  const savePersona = async () => {
    if (!fp.nombre && !fp.tipo) { onToast("Ingresa al menos el tipo de persona","warn"); return; }
    const refugio = refugios.find(r => r.id === sel!.id);
    if (!refugio) return;
    const persona = { ...fp, foto:fotoPer, id:uid(), ts:now() };
    const updated = { ...refugio, personas:[...(refugio.personas||[]), persona] };
    if (!(await reportarSeguro("refugios", updated, online, onToast))) return
    await IDB.put("refugios", updated);
    if (!online) addQ({ table:"refugios", action:"update", id:refugio.id, patch:{ personas: updated.personas } });
    await reload();
    setSel(updated);
    setView("detalle"); setFotoPer(null);
    setFp({ nombre:"",tipo:"adulto",edad:"",descripcion:"",estado:"buscando_familia",contactoPropio:"" });
    onToast("Persona registrada en el refugio","ok");
  };

  // Marcar persona como reunida con familia
  const marcarReunida = async (refugioId: string, personaId: string) => {
    const refugio = refugios.find(r => r.id === refugioId);
    if (!refugio) return;
    const updated = { ...refugio, personas: refugio.personas.map((p: BaseRecord) => p.id===personaId ? {...p, estado:"reunida"} : p) };
    await IDB.put("refugios", updated);
    await reload();
    setSel(updated);
    onToast("¡Familia reunida! Gracias por actualizar","ok");
  };

  // Totales para stats
  const totalPersonas  = refugios.reduce((s,r) => s + (r.personas?.length||0), 0);
  const totalReunidas  = refugios.reduce((s,r) => s + (r.personas?.filter((p: BaseRecord)=>p.estado==="reunida").length||0), 0);
  const totalNinos     = refugios.reduce((s,r) => s + (r.personas?.filter((p: BaseRecord)=>p.tipo==="nino").length||0), 0);
  const totalMayores   = refugios.reduce((s,r) => s + (r.personas?.filter((p: BaseRecord)=>p.tipo==="mayor").length||0), 0);

  const filtered = refugios.filter(r =>
    !q || [r.nombre,r.municipio,r.estado,r.direccion].filter(Boolean).some(s=>s.toLowerCase().includes(q.toLowerCase()))
  );

  // ── FORM PERSONA ────────────────────────────────────────────
  if (view === "form_persona" && sel) return (
    <div>
      <Back onClick={()=>setView("detalle")} />
      <Card>
        <h3 style={{margin:"0 0 4px",fontWeight:800}}>Registrar persona</h3>
        <p style={{margin:"0 0 14px",fontSize:12,color:C.muted}}>Refugio: <strong>{sel.nombre}</strong></p>
        <PhotoUpload preview={fotoPer} onFile={setFotoPer} label="Foto (muy importante para familias)" />
        <Field label="Tipo de persona *">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {TIPOS_PERSONA.map(t=>(
              <button key={t.id} onClick={()=>setFp(x=>({...x,tipo:t.id}))}
                style={{padding:"8px",borderRadius:8,border:`2px solid ${fp.tipo===t.id?t.color:C.border}`,background:fp.tipo===t.id?t.bg:"white",color:fp.tipo===t.id?t.color:C.muted,fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",gap:4,alignItems:"center",justifyContent:"center"}}>
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Nombre completo (si se conoce)">
          <Input value={fp.nombre} onChange={v=>setFp(x=>({...x,nombre:v}))} placeholder="Dejar vacío si se desconoce" />
        </Field>
        <Field label="Edad aproximada">
          <Input value={fp.edad} onChange={v=>setFp(x=>({...x,edad:v}))} placeholder="Ej: 7 años / ~60 años" />
        </Field>
        <Field label="Descripción física (ropa, señas particulares)">
          <Textarea value={fp.descripcion} onChange={v=>setFp(x=>({...x,descripcion:v}))} placeholder="Camisa azul, cabello corto, cicatriz en brazo derecho…" rows={2} />
        </Field>
        <Field label="Estado">
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[["buscando_familia","Buscando familia",C.amber,C.amberLt],["reunida","Ya fue reunida",C.green,C.greenLt],["sin_contacto","Sin datos de contacto",C.muted,"#F1F5F9"]].map(([v,l,color,bg])=>(
              <Chip key={v} label={l} active={fp.estado===v} onClick={()=>setFp(x=>({...x,estado:v}))} color={color} />
            ))}
          </div>
        </Field>
        <Field label="Teléfono propio o de familiar (si tiene)">
          <Input value={fp.contactoPropio} onChange={v=>setFp(x=>({...x,contactoPropio:v}))} placeholder="+58 414-000-0000" />
        </Field>
        <Btn onClick={savePersona} full>{online?"Registrar Persona":"Guardar sin internet"}</Btn>
      </Card>
    </div>
  );

  // ── FORM REFUGIO ────────────────────────────────────────────
  if (view === "form_refugio") return (
    <div>
      <Back onClick={()=>setView("list")} />
      <Card>
        <h3 style={{margin:"0 0 4px",fontWeight:800}}>Registrar Refugio</h3>
        <p style={{margin:"0 0 14px",fontSize:12,color:C.muted}}>Cada refugio tendrá su propia lista de personas para que las familias puedan buscar a los suyos</p>
        <PhotoUpload preview={foto} onFile={setFoto} label="Foto del refugio (opcional)" />
        <Field label="Nombre del refugio *">
          <Input value={fr.nombre} onChange={v=>setFr(x=>({...x,nombre:v}))} placeholder="Ej: Polideportivo La Guaira / Escuela Básica Simón Bolívar" />
        </Field>
        <Field label="Dirección exacta">
          <Input value={fr.direccion} onChange={v=>setFr(x=>({...x,direccion:v}))} placeholder="Ej: Av. La Playa, sector Los Caracoles" />
        </Field>
        <Field label="Municipio / Sector">
          <Input value={fr.municipio} onChange={v=>setFr(x=>({...x,municipio:v}))} placeholder="Ej: Maiquetía, Caraballeda, Naiguatá" />
        </Field>
        <Field label="Estado / Región">
          <Input value={fr.estado} onChange={v=>setFr(x=>({...x,estado:v}))} placeholder="Ej: La Guaira, Vargas, Miranda" />
        </Field>
        <Field label="País">
          <Input value={fr.pais} onChange={v=>setFr(x=>({...x,pais:v}))} placeholder="Venezuela" />
        </Field>
        <Field label="Capacidad aproximada (personas)">
          <Input value={fr.capacidad} onChange={v=>setFr(x=>({...x,capacidad:v}))} placeholder="Ej: 100 / 250 / sin límite por ahora" />
        </Field>
        <Field label="Descripción del lugar">
          <Textarea value={fr.descripcion} onChange={v=>setFr(x=>({...x,descripcion:v}))} placeholder="Condiciones del lugar, servicios disponibles (agua, electricidad, baños)…" rows={2} />
        </Field>
        <Field label="Ubicación exacta en el mapa">
          <MapPicker lat={fr.lat} lng={fr.lng} onPin={(la,ln)=>setFr(x=>({...x,lat:la,lng:ln}))} />
          {fr.lat != null && fr.lng != null && <p style={{fontSize:11,color:C.green,marginTop:4,fontWeight:600}}> Pin colocado: {fr.lat.toFixed(4)}, {fr.lng.toFixed(4)}</p>}
        </Field>
        <Field label="¿Qué necesita este refugio?">
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {NECESIDADES_REFUGIO.map((n: string)=><Chip key={n} label={n} active={fr.necesidades.includes(n)} onClick={()=>togN(n)} />)}
          </div>
        </Field>
        <Field label="Coordinador del refugio">
          <Input value={fr.contactoNombre} onChange={v=>setFr(x=>({...x,contactoNombre:v}))} placeholder="Nombre de quien coordina" />
        </Field>
        <Field label="Contacto *">
          <Input value={fr.contacto} onChange={v=>setFr(x=>({...x,contacto:v}))} placeholder="+58 414-000-0000 / @usuario" />
        </Field>
        <Btn onClick={saveRefugio} full>{online?"Publicar Refugio":"Guardar sin internet"}</Btn>
      </Card>
    </div>
  );

  // ── DETALLE REFUGIO ─────────────────────────────────────────
  if (view === "detalle" && sel) {
    const personas = sel.personas || [];
    const porTipo  = TIPOS_PERSONA.map(t => ({ ...t, lista: personas.filter((p: BaseRecord)=>p.tipo===t.id) })).filter(t=>t.lista.length>0);
    const buscando = personas.filter((p: BaseRecord)=>p.estado==="buscando_familia").length;
    const reunidas = personas.filter((p: BaseRecord)=>p.estado==="reunida").length;

    return (
      <div>
        <Back onClick={()=>{ setSel(null); setView("list"); }} />

        {/* Header refugio */}
        <Card style={{marginBottom:12}}>
          {sel.foto && <img src={sel.foto} alt="" style={{width:"100%",maxHeight:180,objectFit:"cover",borderRadius:10,marginBottom:12}} />}
          <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
            <Pill label={sel.estado==="activo"?"Activo":"Cerrado"} color={sel.estado==="activo"?C.primary:C.muted} bg={sel.estado==="activo"?C.primaryLt:"#F1F5F9"} />
            {sel._off&&<Pill label="Pendiente sync" color={C.muted} bg="#F1F5F9" />}
          </div>
          <h2 style={{margin:"0 0 4px",fontSize:19,fontWeight:800}}>{sel.nombre}</h2>
          {sel.direccion&&<p style={{margin:"0 0 2px",fontSize:13,color:C.muted}}>{sel.direccion}</p>}
          <p style={{margin:"0 0 2px",fontSize:13,color:C.muted}}>{[sel.municipio,sel.estado,sel.pais].filter(Boolean).join(",")}</p>
          {sel.capacidad&&<p style={{margin:"0 0 8px",fontSize:13,color:C.muted}}>Capacidad: {sel.capacidad} personas</p>}
          {sel.descripcion&&<div style={{background:C.bg,borderRadius:10,padding:10,marginBottom:10,fontSize:13,lineHeight:1.6}}>{sel.descripcion}</div>}
          {sel.necesidades?.length>0&&(
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:6}}>Necesidades del refugio</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{sel.necesidades.map((n: string)=><Pill key={n} label={n} color={C.amber} bg={C.amberLt} />)}</div>
            </div>
          )}
          {sel.lat&&sel.lng&&<MapView lat={sel.lat} lng={sel.lng} label={sel.nombre} />}
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12,marginTop:8}}>
            {sel.contactoNombre&&<p style={{margin:"0 0 2px",fontWeight:700,fontSize:13}}>{sel.contactoNombre}</p>}
            <p style={{margin:0,fontSize:14,fontWeight:800,color:C.primary}}>{sel.contacto}</p>
          </div>
        </Card>

        {/* Stats personas */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
          <StatBox n={personas.length} label="Total personas" color={C.primary} />
          <StatBox n={buscando} label="Buscando familia" color={C.amber} />
          <StatBox n={reunidas} label="Reunidas" color={C.green} />
        </div>

        {/* Botón agregar persona */}
        <Btn onClick={()=>setView("form_persona")} full color={C.teal} style={{marginBottom:14}}>
          + Registrar persona en este refugio
        </Btn>
        <div style={{marginBottom:14}} />

        {/* Lista por tipo */}
        {personas.length === 0 ? (
          <div style={{textAlign:"center",padding:"28px 20px",background:"white",borderRadius:12}}>
            <div style={{fontSize:36,marginBottom:8}}></div>
            <div style={{fontWeight:600,fontSize:14,marginBottom:4}}>Sin personas registradas aún</div>
            <div style={{fontSize:12,color:C.muted}}>Toca el botón de arriba para empezar el registro</div>
          </div>
        ) : (
          <>
            {porTipo.map(tipo=>(
              <div key={tipo.id} style={{marginBottom:16}}>
                {/* Encabezado de tipo */}
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,padding:"8px 12px",background:tipo.bg,borderRadius:10}}>
                  <span style={{fontSize:13,fontWeight:800,color:tipo.color}}>{tipo.label}</span>
                  <span style={{fontWeight:800,fontSize:14,color:tipo.color}}>{tipo.label}</span>
                  <span style={{marginLeft:"auto",fontWeight:900,fontSize:18,color:tipo.color}}>{tipo.lista.length}</span>
                </div>

                {/* Personas de este tipo */}
                {tipo.lista.map((p: BaseRecord, i: number)=>(
                  <div key={p.id||i} style={{background:"white",borderRadius:10,marginBottom:8,overflow:"hidden",display:"flex",borderLeft:`4px solid ${p.estado==="reunida"?C.green:tipo.color}`,boxShadow:"0 1px 3px rgba(0,0,0,0.07)",opacity:p.estado==="reunida"?.7:1}}>
                    {/* Foto */}
                    <div style={{width:68,minHeight:68,background:tipo.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>
                      {p.foto ? <img src={p.foto} alt="" style={{width:68,height:68,objectFit:"cover"}} /> : <span style={{fontSize:10,fontWeight:700,color:tipo.color,textAlign:"center",padding:4}}>{tipo.label}</span>}
                    </div>
                    {/* Info */}
                    <div style={{padding:"9px 12px",flex:1,minWidth:0}}>
                      <div style={{display:"flex",gap:5,marginBottom:4,alignItems:"center"}}>
                        <Pill
                          label={p.estado==="reunida"?"Reunida con familia":p.estado==="sin_contacto"?"Sin datos":"Buscando familia"}
                          color={p.estado==="reunida"?C.green:p.estado==="sin_contacto"?C.muted:C.amber}
                          bg={p.estado==="reunida"?C.greenLt:p.estado==="sin_contacto"?"#F1F5F9":C.amberLt}
                        />
                      </div>
                      <div style={{fontWeight:700,fontSize:14}}>{p.nombre||"Nombre desconocido"}</div>
                      {p.edad&&<div style={{fontSize:12,color:C.muted}}>{p.edad}</div>}
                      {p.descripcion&&<div style={{fontSize:12,color:C.muted,marginTop:2}}>{p.descripcion}</div>}
                      {p.contactoPropio&&<div style={{fontSize:12,color:C.primary,fontWeight:600,marginTop:2}}>{p.contactoPropio}</div>}
                      {p.estado!=="reunida"&&(
                        <button onClick={()=>marcarReunida(sel.id,p.id)} style={{marginTop:6,background:C.greenLt,border:`1px solid ${C.green}`,color:C.green,borderRadius:6,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                          Marcar como reunida con familia
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  // ── LIST ────────────────────────────────────────────────────
  return (
    <div>
      {/* Stats globales */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        <StatBox n={refugios.length}   label="Refugios activos"   color={C.primary} />
        <StatBox n={totalPersonas}      label="Personas registradas" color={C.teal} />
        <StatBox n={totalNinos}         label="Niños/as"           color={C.sky} />
        <StatBox n={totalMayores}       label="Adultos mayores"    color={C.purple||"#7C3AED"} />
      </div>

      {totalPersonas > 0 && (
        <div style={{background:C.greenLt,border:`1px solid ${C.green}`,borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,fontWeight:600,color:C.green}}>
          {totalReunidas} persona{totalReunidas!==1?"s":""} ya {totalReunidas!==1?"fueron reunidas":"fue reunida"} con su familia
        </div>
      )}

      {/* Buscar + botón */}
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar por nombre, municipio, estado…"
          style={{flex:1,padding:"10px 12px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,outline:"none"}} />
        <Btn onClick={()=>setView("form_refugio")} small>+ Refugio</Btn>
      </div>

      {filtered.length === 0
        ? <Empty icon={null} msg={refugios.length===0?"Sin refugios registrados aún":"Sin resultados"} />
        : filtered.map(r => {
            const personas   = r.personas || [];
            const buscando   = personas.filter((p: BaseRecord)=>p.estado==="buscando_familia").length;
            const reunidas   = personas.filter((p: BaseRecord)=>p.estado==="reunida").length;
            const ninos      = personas.filter((p: BaseRecord)=>p.tipo==="nino").length;
            const mayores    = personas.filter((p: BaseRecord)=>p.tipo==="mayor").length;
            const pct        = personas.length > 0 ? Math.round((reunidas/personas.length)*100) : 0;

            return (
              <div key={r.id} onClick={()=>{ setSel(r); setView("detalle"); }}
                style={{background:"white",borderRadius:14,marginBottom:12,overflow:"hidden",cursor:"pointer",boxShadow:"0 1px 4px rgba(0,0,0,0.09)",borderLeft:`4px solid ${C.primary}`}}>

                {/* Foto si tiene */}
                {r.foto && <img src={r.foto} alt="" style={{width:"100%",height:100,objectFit:"cover"}} />}

                <div style={{padding:"12px 14px"}}>
                  <div style={{display:"flex",gap:5,marginBottom:6,flexWrap:"wrap"}}>
                    <Pill label="Activo" color={C.primary} bg={C.primaryLt} />
                    {r.lat&&<Pill label="GPS" color={C.teal} bg={C.tealLt} />}
                    {r._off&&<Pill label="" color={C.muted} bg="#F1F5F9" />}
                  </div>
                  <div style={{fontWeight:800,fontSize:16,marginBottom:2}}>{r.nombre}</div>
                  <div style={{fontSize:12,color:C.muted,marginBottom:8}}>{[r.municipio,r.estado,r.pais].filter(Boolean).join(",")}</div>

                  {/* Contador principal */}
                  <div style={{display:"flex",gap:8,marginBottom:8}}>
                    <div style={{background:C.primaryLt,borderRadius:8,padding:"8px 12px",flex:1,textAlign:"center"}}>
                      <div style={{fontSize:22,fontWeight:900,color:C.primary,lineHeight:1}}>{personas.length}</div>
                      <div style={{fontSize:10,fontWeight:700,color:C.muted,marginTop:2}}>Personas</div>
                    </div>
                    {ninos>0&&<div style={{background:C.skyLt,borderRadius:8,padding:"8px 12px",flex:1,textAlign:"center"}}>
                      <div style={{fontSize:22,fontWeight:900,color:C.sky,lineHeight:1}}>{ninos}</div>
                      <div style={{fontSize:10,fontWeight:700,color:C.muted,marginTop:2}}>Niños/as</div>
                    </div>}
                    {mayores>0&&<div style={{background:"#F5F3FF",borderRadius:8,padding:"8px 12px",flex:1,textAlign:"center"}}>
                      <div style={{fontSize:22,fontWeight:900,color:"#7C3AED",lineHeight:1}}>{mayores}</div>
                      <div style={{fontSize:10,fontWeight:700,color:C.muted,marginTop:2}}>Mayores</div>
                    </div>}
                    {buscando>0&&<div style={{background:C.amberLt,borderRadius:8,padding:"8px 12px",flex:1,textAlign:"center"}}>
                      <div style={{fontSize:22,fontWeight:900,color:C.amber,lineHeight:1}}>{buscando}</div>
                      <div style={{fontSize:10,fontWeight:700,color:C.muted,marginTop:2}}>Buscando</div>
                    </div>}
                  </div>

                  {/* Barra de progreso reunificación */}
                  {personas.length>0&&(
                    <div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginBottom:3}}>
                        <span>Reunidas con familia</span>
                        <span style={{fontWeight:700,color:C.green}}>{reunidas}/{personas.length} ({pct}%)</span>
                      </div>
                      <div style={{background:"#F1F5F9",borderRadius:20,height:6}}>
                        <div style={{background:C.green,width:`${pct}%`,height:"100%",borderRadius:20,transition:"width 0.5s"}} />
                      </div>
                    </div>
                  )}

                  {/* Necesidades si las tiene */}
                  {r.necesidades?.length>0&&(
                    <div style={{marginTop:8,display:"flex",gap:4,flexWrap:"wrap"}}>
                      {r.necesidades.slice(0,3).map((n: string)=><Pill key={n} label={n} color={C.amber} bg={C.amberLt} />)}
                      {r.necesidades.length>3&&<Pill label={`+${r.necesidades.length-3} más`} color={C.muted} bg="#F1F5F9" />}
                    </div>
                  )}
                </div>
              </div>
            );
          })
      }
    </div>
  );
}

// ============================================================
// ROOT APP
// ============================================================
export default function CrisisVE() {
  const [tab, setTab] = useState("personas");
  const [online, setOnline] = useState(typeof navigator!=="undefined"?navigator.onLine:true);
  const [pending, setPending] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => { initOneSignal() }, []);

  useEffect(()=>{
    setPending(getQ().length);
    const up=()=>{ setOnline(true); const q=getQ(); if(q.length){ setToast({msg:`Conexión restaurada — sincronizando ${q.length} reporte(s)…`,type:"ok"}); setTimeout(()=>{ clearQ(); setPending(0); },2500); } };
    const down=()=>setOnline(false);
    window.addEventListener("online",up);
    window.addEventListener("offline",down);
    return ()=>{ window.removeEventListener("online",up); window.removeEventListener("offline",down); };
  },[]);

  const onToast = (msg: string, type: ToastType = "ok") => setToast({msg,type});

  return (
    <div style={{fontFamily:"'Segoe UI',system-ui,-apple-system,sans-serif",background:C.bg,minHeight:"100vh",color:C.txt,maxWidth:680,margin:"0 auto",position:"relative"}}>

      {/* HEADER */}
      <div style={{background:"white",borderBottom:"1px solid #E2E8F0",color:"#0F172A",padding:"13px 16px 11px",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <img src="/Reconstruyendo.svg" alt="Reconstruyendo Venezuela" height={40} width={155} style={{objectFit:'contain'}} />
            </div>
            <div style={{fontSize:10,color:"#0F172A",opacity:.75,marginTop:1}}>Coordinación de Emergencias · Venezuela</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,fontWeight:700}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:online?C.green:C.amber,flexShrink:0}} />
            <span style={{color:"#0F172A"}}>{online?"En línea":"Sin conexión"}{pending>0?` · ${pending} pendientes`:""}</span>
          </div>
        </div>
      </div>

      <OfflineBanner pending={pending} />

      {/* TABS */}
      <div style={{display:"flex",background:"white",borderBottom:`1px solid ${C.border}`,position:"sticky",top:52,zIndex:90}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"9px 2px 7px",border:"none",background:"none",cursor:"pointer",borderBottom:`3px solid ${tab===t.id?C.primary:"transparent"}`,color:tab===t.id?C.primary:C.muted,fontSize:9,fontWeight:700,display:"flex",flexDirection:"column",alignItems:"center",gap:2,transition:"all .15s"}}>
            <span style={{fontSize:16}}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      <div style={{padding:"14px 14px 100px"}}>
        {tab==="personas"    && <PersonasSection    online={online} onToast={onToast} />}
        {tab==="zonas"       && <ZonasSection       online={online} onToast={onToast} />}
        {tab==="refugios"    && <RefugiosSection    online={online} onToast={onToast} />}
        {tab==="mascotas"    && <MascotasSection    online={online} onToast={onToast} />}
        {tab==="voluntarios" && <VoluntariosSection online={online} onToast={onToast} />}
        {tab==="donaciones"  && <DonacionesSection  online={online} onToast={onToast} />}
      </div>

      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:680,background:"white",borderTop:`1px solid ${C.border}`,padding:"8px 16px",zIndex:80}}>
        <div style={{textAlign:'center', fontSize:10, color:C.muted}}>
          Información humanitaria · Funciona sin internet · #ReconstruyendoVenezuelaJuntos
          <br/>
          reconstruyendovzla26@gmail.com
        </div>
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)} />}
    </div>
  );
}
