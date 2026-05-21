import { useState, useMemo, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from "firebase/firestore";

// ── Firebase ────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBoQqt2a_bgTbgC-bvV7yXpbSEO5ziQBRI",
  authDomain: "cotafacil-285af.firebaseapp.com",
  projectId: "cotafacil-285af",
  storageBucket: "cotafacil-285af.firebasestorage.app",
  messagingSenderId: "897151956033",
  appId: "1:897151956033:web:5ef1b36de6fbcf304602c0"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const CATEGORIAS = ["Fixação","Lubrificação","Tubulação","Elétrico","Refrigeração","Gás","Outro"];
const SV = {
  vigente: { label:"Vigente",  color:"#16a34a", bg:"#dcfce7", border:"#86efac" },
  avencer: { label:"A vencer", color:"#b45309", bg:"#fef3c7", border:"#fcd34d" },
  vencida: { label:"Vencida",  color:"#dc2626", bg:"#fee2e2", border:"#fca5a5" },
};

// ── Saneamento ─────────────────────────────────────────────────────────────
// Replica exatamente as fórmulas da planilha:
// mediaGeral  = ARREDONDAR.PARA.CIMA(MÉDIA(todos), 2)
// excluído    = SE((F/mediaGeral)-1 > 30% OU < -30%)
// mediaSaneada = ARREDONDAR.PARA.CIMA(MÉDIA(aceitos), 2)
// Valor c/BDI  = mediaSaneada × (1 + BDI%)
// Valor final  = comBDI × (1 − desconto%)
function arredCima(n, dec = 2) {
  return Math.ceil(n * 10 ** dec) / 10 ** dec;
}

function sanear(fornecedores) {
  const todos = fornecedores.map(f => parseFloat(f.valor)).filter(v => !isNaN(v) && v > 0);
  if (!todos.length) {
    return { mediaGeral: 0, mediaSaneada: 0, menorSaneado: 0, forn: fornecedores.map(f => ({ ...f, autoExcluido: false, variacao: null })) };
  }
  const mediaGeral = arredCima(todos.reduce((a, b) => a + b, 0) / todos.length);
  const forn = fornecedores.map(f => {
    const v = parseFloat(f.valor);
    if (isNaN(v) || v <= 0) return { ...f, autoExcluido: false, variacao: null };
    const variacao = (v / mediaGeral) - 1;
    return { ...f, autoExcluido: variacao > 0.30 || variacao < -0.30, variacao };
  });
  const aceitos = forn.filter(f => !f.autoExcluido && parseFloat(f.valor) > 0).map(f => parseFloat(f.valor));
  const mediaSaneada = aceitos.length ? arredCima(aceitos.reduce((a, b) => a + b, 0) / aceitos.length) : 0;
  const menorSaneado = aceitos.length ? Math.min(...aceitos) : 0;
  return { mediaGeral, mediaSaneada, menorSaneado, forn };
}

function calcBDI(mediaSaneada, bdi, desconto) {
  const b = parseFloat(bdi) || 0, d = parseFloat(desconto) || 0;
  const comBDI = mediaSaneada * (1 + b / 100);
  const final  = comBDI * (1 - d / 100);
  return { comBDI, final };
}

function enriquecer(c) {
  const { mediaGeral, mediaSaneada, menorSaneado, forn } = sanear(c.fornecedores);
  const { comBDI, final } = calcBDI(mediaSaneada, c.bdi, c.desconto);
  return { ...c, fornecedores: forn, mediaGeral, mediaSaneada, menorSaneado, precoFinalBDI: comBDI, precoFinalDesconto: final, status: calcStatus(c.dataElaboracao) };
}

function calcStatus(dt) {
  if (!dt) return "vencida";
  const v = new Date(dt + "T12:00:00"); v.setFullYear(v.getFullYear() + 1);
  const dias = Math.ceil((v - new Date()) / 864e5);
  return dias < 0 ? "vencida" : dias <= 30 ? "avencer" : "vigente";
}
const fmtVenc = dt => { if (!dt) return "—"; const v = new Date(dt + "T12:00:00"); v.setFullYear(v.getFullYear() + 1); return v.toLocaleDateString("pt-BR"); };
const diasRest = dt => { if (!dt) return null; const v = new Date(dt + "T12:00:00"); v.setFullYear(v.getFullYear() + 1); return Math.ceil((v - new Date()) / 864e5); };
const brl = n => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const pct = n => (n >= 0 ? "+" : "") + ((n || 0) * 100).toFixed(2) + "%";

const DADOS = [
  { id:1, material:"Porca Sextavada 8mm Inox 304", codigo:"MAT-001", categoria:"Fixação", unidade:"UNID.", contrato:"Contrato 012/2022", dataBase:"Nov/2024", dataElaboracao:"2024-11-15", bdi:17.32, desconto:2.0, quantidade:100, observacoes:"Inox passivado 304", imagem:null,
    fornecedores:[{nome:"Parafuso Fácil",url:"",valor:0.85},{nome:"Jofepar",url:"",valor:0.82},{nome:"Lojas Mixpar",url:"",valor:0.91}]},
  { id:2, material:"Válvula Termostática Danfoss R22 – 12TR", codigo:"MAT-010", categoria:"Refrigeração", unidade:"UNID.", contrato:"Contrato 012/2022", dataBase:"Nov/2024", dataElaboracao:"2024-11-15", bdi:17.32, desconto:2.0, quantidade:1, observacoes:"Modelo 067N2009", imagem:null,
    fornecedores:[{nome:"Chiller Peças",url:"",valor:1031.11},{nome:"Jet Frio",url:"",valor:1008.99},{nome:"Cibrel",url:"",valor:1375.53}]},
  { id:3, material:"Graxa Azul FAG 500g", codigo:"MAT-005", categoria:"Lubrificação", unidade:"UNID.", contrato:"Contrato 012/2022", dataBase:"Nov/2024", dataElaboracao:"2024-02-10", bdi:17.32, desconto:2.0, quantidade:1, observacoes:"Para rolamentos", imagem:null,
    fornecedores:[{nome:"C3 Multimarcas",url:"",valor:81.18},{nome:"Loja Proelis",url:"",valor:85.49},{nome:"Disk Peças",url:"",valor:90.45}]},
  { id:4, material:"Tubo de Cobre Classe A 42mm 1.1/2", codigo:"MAT-006", categoria:"Tubulação", unidade:"M", contrato:"Contrato 012/2022", dataBase:"Nov/2024", dataElaboracao:"2024-11-15", bdi:17.32, desconto:2.0, quantidade:1, observacoes:"Referência SINAPI 39751", imagem:null,
    fornecedores:[{nome:"SINAPI 39751",url:"",valor:179.06}]},
  { id:5, material:"Placa Universal Split Hi-Wall Suryha", codigo:"MAT-008", categoria:"Elétrico", unidade:"UNID.", contrato:"Contrato 012/2022", dataBase:"Nov/2024", dataElaboracao:"2024-11-15", bdi:17.32, desconto:2.0, quantidade:3, observacoes:"80150 Suryha", imagem:null,
    fornecedores:[{nome:"Sardanha Refrigeração",url:"",valor:164.53},{nome:"Refritron",url:"",valor:152.63},{nome:"Webinstalar",url:"",valor:157.39}]},
];

const emptyForm = { material:"", codigo:"", categoria:"Refrigeração", unidade:"UNID.", contrato:"", dataBase:"", dataElaboracao:"", bdi:17.32, desconto:2.0, quantidade:1, observacoes:"", imagem:null, fornecedores:[{nome:"",url:"",valor:""}] };

function StatusBadge({ status, size }) {
  const s = SV[status] || SV.vencida;
  return <span style={{ background:s.bg, color:s.color, border:`1px solid ${s.border}`, borderRadius:20, padding:size==="lg"?"4px 14px":"2px 10px", fontSize:size==="lg"?13:11, fontWeight:600, display:"inline-block", whiteSpace:"nowrap" }}>{s.label}</span>;
}
function CatBadge({ cat }) {
  return <span style={{ background:"#f1f5f9", color:"#475569", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:500 }}>{cat}</span>;
}

function SaneamentoPanel({ fornecedores }) {
  const { mediaGeral, mediaSaneada, forn } = sanear(fornecedores);
  if (!forn.some(f => parseFloat(f.valor) > 0)) return null;
  const aceitos = forn.filter(f => !f.autoExcluido && parseFloat(f.valor) > 0).length;
  const total   = forn.filter(f => parseFloat(f.valor) > 0).length;
  return (
    <div style={{ background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:10, padding:"12px 14px", marginTop:10 }}>
      <div style={{ fontSize:11, fontWeight:600, color:"#64748b", letterSpacing:.5, marginBottom:10 }}>PRÉVIA DO SANEAMENTO</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:12 }}>
        {[{l:"Média geral",v:"R$ "+brl(mediaGeral),c:"#475569"},{l:"Média saneada",v:"R$ "+brl(mediaSaneada),c:"#0369a1"},{l:"Valores aceitos",v:`${aceitos} / ${total}`,c:"#16a34a"}].map(item =>
          <div key={item.l} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 10px" }}>
            <div style={{ fontSize:10, color:"#94a3b8", fontWeight:500, marginBottom:2 }}>{item.l}</div>
            <div style={{ fontSize:14, fontWeight:700, color:item.c }}>{item.v}</div>
          </div>
        )}
      </div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
        <thead><tr style={{ background:"#f1f5f9" }}>
          {["Fonte","Valor","Variação s/ média geral","Status"].map(h => <th key={h} style={{ padding:"6px 10px", textAlign:"left", fontSize:11, fontWeight:600, color:"#64748b", borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {forn.filter(f => parseFloat(f.valor) > 0).map((f, i) => (
            <tr key={i} style={{ background:f.autoExcluido?"#fef2f2":"#f0fdf4", borderBottom:"1px solid #f1f5f9" }}>
              <td style={{ padding:"7px 10px", fontWeight:500 }}>{f.nome || "—"}</td>
              <td style={{ padding:"7px 10px", fontFamily:"monospace" }}>R$ {brl(f.valor)}</td>
              <td style={{ padding:"7px 10px", color:f.autoExcluido?"#dc2626":Math.abs(f.variacao||0)>0.15?"#b45309":"#16a34a", fontWeight:600 }}>{f.variacao != null ? pct(f.variacao) : "—"}</td>
              <td style={{ padding:"7px 10px" }}>
                {f.autoExcluido
                  ? <span style={{ background:"#fee2e2", color:"#dc2626", borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:600 }}>EXCLUÍDO</span>
                  : <span style={{ background:"#dcfce7", color:"#16a34a", borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:600 }}>ACEITO</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormModal({ editId, initialForm, onSave, onClose }) {
  const [form, setForm] = useState(initialForm);
  const calc = useMemo(() => {
    const { mediaSaneada } = sanear(form.fornecedores);
    const { comBDI, final } = calcBDI(mediaSaneada, form.bdi, form.desconto);
    return { mediaSaneada, comBDI, final };
  }, [form.fornecedores, form.bdi, form.desconto]);

  function updForn(i, k, v) { setForm(f => ({ ...f, fornecedores: f.fornecedores.map((fo, idx) => idx === i ? { ...fo, [k]: v } : fo) })); }
  function handleImg(ev) { const file = ev.target.files[0]; if (!file) return; const r = new FileReader(); r.onload = x => setForm(f => ({ ...f, imagem: x.target.result })); r.readAsDataURL(file); }
  const lbl = (txt, hint) => <label style={{ fontSize:12, fontWeight:500, color:"#64748b", display:"block", marginBottom:3 }}>{txt}{hint && <span style={{ fontSize:10, color:"#94a3b8", marginLeft:5 }}>{hint}</span>}</label>;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div onClick={ev => ev.stopPropagation()} style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:700, maxHeight:"94vh", overflowY:"auto", padding:26 }}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:20 }}>{editId ? "Editar cotação" : "Nova cotação"}</div>

        <div style={{ fontSize:11, fontWeight:600, color:"#94a3b8", letterSpacing:.6, marginBottom:10 }}>IDENTIFICAÇÃO</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
          <div style={{ gridColumn:"1/-1" }}>{lbl("Material / Descrição *")}<input value={form.material} onChange={ev => setForm(p => ({ ...p, material: ev.target.value }))} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13 }} /></div>
          <div>{lbl("Código")}<input value={form.codigo||""} onChange={ev => setForm(p=>({...p,codigo:ev.target.value}))} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13 }} /></div>
          <div>{lbl("Categoria")}<select value={form.categoria} onChange={ev => setForm(p=>({...p,categoria:ev.target.value}))} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13 }}>{CATEGORIAS.map(c=><option key={c}>{c}</option>)}</select></div>
          <div>{lbl("Unidade")}<input value={form.unidade||""} onChange={ev=>setForm(p=>({...p,unidade:ev.target.value}))} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13 }} /></div>
          <div>{lbl("Contrato")}<input value={form.contrato||""} onChange={ev=>setForm(p=>({...p,contrato:ev.target.value}))} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13 }} /></div>
          <div>{lbl("Data base")}<input value={form.dataBase||""} onChange={ev=>setForm(p=>({...p,dataBase:ev.target.value}))} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13 }} /></div>
          <div>{lbl("Data de elaboração *")}<input type="date" value={form.dataElaboracao||""} onChange={ev=>setForm(p=>({...p,dataElaboracao:ev.target.value}))} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13 }} /></div>
          <div>{lbl("Quantidade")}<input type="number" value={form.quantidade||""} onChange={ev=>setForm(p=>({...p,quantidade:ev.target.value}))} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13 }} /></div>
        </div>

        <div style={{ fontSize:11, fontWeight:600, color:"#94a3b8", letterSpacing:.6, marginBottom:10 }}>FONTES DE PESQUISA DE PREÇOS</div>
        <div style={{ background:"#f8fafc", borderRadius:10, padding:"14px", marginBottom:4 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 110px 28px", gap:6, marginBottom:6 }}>
            {["Fornecedor / Fonte","URL (opcional)","Valor (R$)",""].map(h => <div key={h} style={{ fontSize:10, color:"#94a3b8", fontWeight:600, padding:"0 2px" }}>{h}</div>)}
          </div>
          {form.fornecedores.map((f, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 110px 28px", gap:6, marginBottom:6, alignItems:"center" }}>
              <input placeholder="Ex: Jofepar, SINAPI 39751" value={f.nome} onChange={ev=>updForn(i,"nome",ev.target.value)} style={{ border:"1px solid #e2e8f0", borderRadius:7, padding:"7px 10px", fontSize:12 }} />
              <input placeholder="https://..." value={f.url||""} onChange={ev=>updForn(i,"url",ev.target.value)} style={{ border:"1px solid #e2e8f0", borderRadius:7, padding:"7px 10px", fontSize:12 }} />
              <input type="number" step="0.01" min="0" placeholder="0,00" value={f.valor} onChange={ev=>updForn(i,"valor",ev.target.value)} style={{ border:"1px solid #e2e8f0", borderRadius:7, padding:"7px 10px", fontSize:12 }} />
              <button onClick={() => setForm(f => ({ ...f, fornecedores: f.fornecedores.filter((_,idx)=>idx!==i) }))} style={{ background:"none", border:"none", color:"#dc2626", fontSize:20, lineHeight:1 }}>×</button>
            </div>
          ))}
          <button onClick={() => setForm(f=>({...f,fornecedores:[...f.fornecedores,{nome:"",url:"",valor:""}]}))} style={{ marginTop:4, fontSize:12, border:"1px dashed #cbd5e1", borderRadius:7, padding:"6px 14px", background:"#fff", color:"#64748b", width:"100%" }}>+ Adicionar fonte</button>
        </div>
        <SaneamentoPanel fornecedores={form.fornecedores} />

        <div style={{ fontSize:11, fontWeight:600, color:"#94a3b8", letterSpacing:.6, margin:"20px 0 10px" }}>PARÂMETROS DE CÁLCULO</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
          <div>{lbl("BDI (%)")}<input type="number" step="0.01" value={form.bdi||""} onChange={ev=>setForm(p=>({...p,bdi:ev.target.value}))} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13 }} /></div>
          <div>{lbl("Desconto licitação (%)")}<input type="number" step="0.01" value={form.desconto||""} onChange={ev=>setForm(p=>({...p,desconto:ev.target.value}))} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13 }} /></div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:20 }}>
          <div style={{ background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:10, padding:"12px 14px" }}>
            <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, marginBottom:4 }}>MÉDIA SANEADA — base</div>
            <div style={{ fontSize:17, fontWeight:800, color:"#0f172a" }}>R$ {brl(calc.mediaSaneada)}</div>
            <div style={{ fontSize:10, color:"#94a3b8", marginTop:3 }}>base para os cálculos</div>
          </div>
          <div style={{ background:"#dbeafe", border:"1px solid #93c5fd", borderRadius:10, padding:"12px 14px" }}>
            <div style={{ fontSize:10, color:"#1e40af", fontWeight:600, marginBottom:4 }}>VALOR C/ BDI ({form.bdi||0}%)</div>
            <div style={{ fontSize:17, fontWeight:800, color:"#1d4ed8" }}>R$ {brl(calc.comBDI)}</div>
            <div style={{ fontSize:10, color:"#3b82f6", marginTop:3 }}>média × (1 + BDI%)</div>
          </div>
          <div style={{ background:"#dcfce7", border:"1px solid #86efac", borderRadius:10, padding:"12px 14px" }}>
            <div style={{ fontSize:10, color:"#166534", fontWeight:600, marginBottom:4 }}>VALOR FINAL ({form.desconto||0}% desc.)</div>
            <div style={{ fontSize:17, fontWeight:800, color:"#16a34a" }}>R$ {brl(calc.final)}</div>
            <div style={{ fontSize:10, color:"#22c55e", marginTop:3 }}>c/BDI × (1 − desc.%)</div>
          </div>
        </div>

        <div style={{ fontSize:11, fontWeight:600, color:"#94a3b8", letterSpacing:.6, marginBottom:10 }}>EXTRAS</div>
        <div style={{ display:"grid", gap:12, marginBottom:20 }}>
          <div>{lbl("Observações")}<textarea value={form.observacoes||""} onChange={ev=>setForm(p=>({...p,observacoes:ev.target.value}))} rows={2} style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13, resize:"vertical" }} /></div>
          <div>{lbl("Imagem do material")}<input type="file" accept="image/*" onChange={handleImg} style={{ fontSize:13 }} />{form.imagem && <img src={form.imagem} style={{ marginTop:8, height:72, borderRadius:8, objectFit:"cover" }} />}</div>
        </div>

        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", paddingTop:16, borderTop:"1px solid #f1f5f9" }}>
          <button onClick={onClose} style={{ border:"1px solid #e2e8f0", background:"#fff", borderRadius:8, padding:"9px 18px", fontSize:13 }}>Cancelar</button>
          <button onClick={() => onSave({ ...form, mediaSaneada:calc.mediaSaneada, precoFinalBDI:calc.comBDI, precoFinalDesconto:calc.final })} style={{ background:"#0f172a", color:"#fff", border:"none", borderRadius:8, padding:"9px 22px", fontSize:13, fontWeight:600 }}>{editId ? "Salvar alterações" : "Cadastrar cotação"}</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [cotacoes, setCotacoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("lista");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [busca, setBusca] = useState("");
  const [modalForm, setModalForm] = useState(false);
  const [formInicial, setFormInicial] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [toast, setToast] = useState(null);

  // ── Carregar do Firestore ────────────────────────────────────────────────
  useEffect(() => {
    async function carregar() {
      try {
        const snap = await getDocs(collection(db, "cotacoes"));
        if (snap.empty) {
          // Primeira execução: sobe os dados de demonstração
          const lote = DADOS.map(enriquecer);
          await Promise.all(lote.map(c => setDoc(doc(db, "cotacoes", String(c.id)), c)));
          setCotacoes(lote);
        } else {
          const dados = snap.docs.map(d => enriquecer(d.data()));
          dados.sort((a, b) => a.id - b.id);
          setCotacoes(dados);
        }
      } catch (e) {
        showToast("Erro ao conectar com o banco de dados.", "erro");
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    carregar();
  }, []);

  const showToast = (msg, tipo="ok") => { setToast({msg,tipo}); setTimeout(()=>setToast(null),3200); };
  const filtradas = useMemo(() => cotacoes.filter(c => {
    if (filtroStatus !== "todos" && c.status !== filtroStatus) return false;
    if (filtroCategoria !== "todas" && c.categoria !== filtroCategoria) return false;
    if (busca && !c.material.toLowerCase().includes(busca.toLowerCase()) && !c.codigo?.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  }), [cotacoes, filtroStatus, filtroCategoria, busca]);
  const stats = useMemo(() => ({ total:cotacoes.length, vigente:cotacoes.filter(c=>c.status==="vigente").length, avencer:cotacoes.filter(c=>c.status==="avencer").length, vencida:cotacoes.filter(c=>c.status==="vencida").length }), [cotacoes]);

  function abrirNova() { setFormInicial(emptyForm); setEditId(null); setModalForm(true); }
  function abrirEditar(c) { setFormInicial({...c, fornecedores:c.fornecedores.map(f=>({...f}))}); setEditId(c.id); setModalForm(true); setDetalhe(null); }
  async function salvar(form) {
    if (!form.material || !form.dataElaboracao) { showToast("Preencha material e data.", "erro"); return; }
    const nova = enriquecer(form);
    try {
      if (editId) {
        const atualizada = {...nova, id: editId};
        await setDoc(doc(db, "cotacoes", String(editId)), atualizada);
        setCotacoes(p => p.map(c => c.id === editId ? atualizada : c));
        showToast("Cotação atualizada.");
      } else {
        const nid = Math.max(0, ...cotacoes.map(c => c.id)) + 1;
        const nova2 = {...nova, id: nid};
        await setDoc(doc(db, "cotacoes", String(nid)), nova2);
        setCotacoes(p => [...p, nova2]);
        showToast("Cotação cadastrada.");
      }
    } catch (e) {
      showToast("Erro ao salvar cotação.", "erro");
      console.error(e);
      return;
    }
    setModalForm(false);
  }
  async function excluirCot(id) {
    try {
      await deleteDoc(doc(db, "cotacoes", String(id)));
      setCotacoes(p => p.filter(c => c.id !== id));
      setDetalhe(null);
      showToast("Cotação removida.");
    } catch (e) {
      showToast("Erro ao excluir cotação.", "erro");
      console.error(e);
    }
  }

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#f8fafc", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14, fontFamily:"'DM Sans','Segoe UI',sans-serif", color:"#64748b" }}>
      <div style={{ width:38, height:38, background:"#0f172a", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, color:"#38bdf8" }}>❄</div>
      <div style={{ fontSize:14, fontWeight:500 }}>Carregando cotações...</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#f8fafc", fontFamily:"'DM Sans','Segoe UI',sans-serif", color:"#0f172a" }}>
      {/* Topbar */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"0 24px", display:"flex", alignItems:"center", height:58, gap:14, position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:34, height:34, background:"#0f172a", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"#38bdf8" }}>❄</div>
          <div>
            <div style={{ fontSize:14, fontWeight:700, letterSpacing:-.3 }}>CotaFrio</div>
            <div style={{ fontSize:10, color:"#94a3b8", letterSpacing:.5 }}>REFRIGERAÇÃO · CONTRATO 012/2022</div>
          </div>
        </div>
        <div style={{ flex:1 }} />
        <input placeholder="Buscar material, código..." value={busca} onChange={ev=>setBusca(ev.target.value)} style={{ border:"1px solid #e2e8f0", borderRadius:8, padding:"7px 14px", fontSize:13, width:230, background:"#f8fafc", outline:"none" }} />
        <button onClick={abrirNova} style={{ background:"#0f172a", color:"#fff", border:"none", borderRadius:8, padding:"8px 16px", fontSize:13, fontWeight:600, display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
          <span style={{ fontSize:16, lineHeight:1 }}>+</span> Nova cotação
        </button>
      </div>

      <div style={{ maxWidth:1200, margin:"0 auto", padding:"22px 20px" }}>
        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
          {[{l:"Total",v:stats.total,c:"#0f172a",bg:"#f8fafc",br:"#e2e8f0",f:"todos"},{l:"Vigentes",v:stats.vigente,c:"#16a34a",bg:"#f0fdf4",br:"#86efac",f:"vigente"},{l:"A vencer",v:stats.avencer,c:"#b45309",bg:"#fffbeb",br:"#fcd34d",f:"avencer"},{l:"Vencidas",v:stats.vencida,c:"#dc2626",bg:"#fef2f2",br:"#fca5a5",f:"vencida"}].map(s =>
            <div key={s.l} onClick={()=>setFiltroStatus(s.f)} style={{ background:s.bg, border:`1px solid ${s.br}`, borderRadius:12, padding:"14px 18px", cursor:"pointer" }}>
              <div style={{ fontSize:11, color:s.c, fontWeight:600, letterSpacing:.5, marginBottom:2 }}>{s.l.toUpperCase()}</div>
              <div style={{ fontSize:30, fontWeight:800, color:s.c, lineHeight:1 }}>{s.v}</div>
            </div>
          )}
        </div>

        {/* Filtros */}
        <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
          {[["todos","Todos"],["vigente","Vigentes"],["avencer","A vencer"],["vencida","Vencidas"]].map(([s,l]) =>
            <button key={s} onClick={()=>setFiltroStatus(s)} style={{ border:`1px solid ${filtroStatus===s?"#0f172a":"#e2e8f0"}`, background:filtroStatus===s?"#0f172a":"#fff", color:filtroStatus===s?"#fff":"#64748b", borderRadius:8, padding:"6px 14px", fontSize:12, fontWeight:500, cursor:"pointer" }}>{l}</button>
          )}
          <select value={filtroCategoria} onChange={ev=>setFiltroCategoria(ev.target.value)} style={{ border:"1px solid #e2e8f0", borderRadius:8, padding:"6px 12px", fontSize:12, background:"#fff", color:"#475569", cursor:"pointer" }}>
            <option value="todas">Todas categorias</option>
            {CATEGORIAS.map(c=><option key={c}>{c}</option>)}
          </select>
          <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
            {[["lista","⊟ Lista"],["cards","⊞ Cards"]].map(([v,l]) =>
              <button key={v} onClick={()=>setView(v)} style={{ border:`1px solid ${view===v?"#0f172a":"#e2e8f0"}`, background:view===v?"#0f172a":"#fff", color:view===v?"#fff":"#64748b", borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer" }}>{l}</button>
            )}
          </div>
        </div>

        <div style={{ fontSize:12, color:"#94a3b8", marginBottom:10 }}>{filtradas.length} {filtradas.length===1?"cotação encontrada":"cotações encontradas"}</div>

        {/* Lista */}
        {view === "lista" && (
          <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead><tr style={{ background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
                {["Código","Material","Categoria","Média saneada","Valor final","Vencimento","Status",""].map(h =>
                  <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:600, color:"#64748b", letterSpacing:.4, whiteSpace:"nowrap" }}>{h}</th>
                )}
              </tr></thead>
              <tbody>
                {filtradas.map((c,i) => (
                  <tr key={c.id} onClick={()=>setDetalhe(c)} style={{ borderBottom:"1px solid #f1f5f9", cursor:"pointer", background:i%2===0?"#fff":"#fafafa" }}
                    onMouseEnter={ev=>ev.currentTarget.style.background="#f0f9ff"}
                    onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?"#fff":"#fafafa"}>
                    <td style={{ padding:"11px 14px", color:"#64748b", fontFamily:"monospace", fontSize:11 }}>{c.codigo}</td>
                    <td style={{ padding:"11px 14px", fontWeight:500 }}>{c.material}</td>
                    <td style={{ padding:"11px 14px" }}><CatBadge cat={c.categoria} /></td>
                    <td style={{ padding:"11px 14px", fontWeight:600 }}>R$ {brl(c.mediaSaneada)}</td>
                    <td style={{ padding:"11px 14px", color:"#0369a1", fontWeight:700 }}>R$ {brl(c.precoFinalDesconto)}</td>
                    <td style={{ padding:"11px 14px", color:"#64748b", fontSize:12 }}>{fmtVenc(c.dataElaboracao)}</td>
                    <td style={{ padding:"11px 14px" }}><StatusBadge status={c.status} /></td>
                    <td style={{ padding:"11px 14px" }}><button onClick={ev=>{ev.stopPropagation();abrirEditar(c);}} style={{ background:"none", border:"1px solid #e2e8f0", borderRadius:6, padding:"4px 10px", fontSize:11, color:"#475569", cursor:"pointer" }}>Editar</button></td>
                  </tr>
                ))}
                {filtradas.length===0 && <tr><td colSpan={8} style={{ padding:40, textAlign:"center", color:"#94a3b8" }}>Nenhuma cotação encontrada.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* Cards */}
        {view === "cards" && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(255px,1fr))", gap:14 }}>
            {filtradas.map(c => {
              const dias = diasRest(c.dataElaboracao);
              return (
                <div key={c.id} onClick={()=>setDetalhe(c)} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, overflow:"hidden", cursor:"pointer" }}
                  onMouseEnter={ev=>ev.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,.08)"}
                  onMouseLeave={ev=>ev.currentTarget.style.boxShadow="none"}>
                  <div style={{ height:100, background:c.imagem?`url(${c.imagem}) center/cover`:"#f1f5f9", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>{c.imagem?null:"📦"}</div>
                  <div style={{ padding:"12px 14px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                      <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"monospace" }}>{c.codigo}</div>
                      <StatusBadge status={c.status} />
                    </div>
                    <div style={{ fontWeight:600, fontSize:13, marginBottom:6, lineHeight:1.3 }}>{c.material}</div>
                    <CatBadge cat={c.categoria} />
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:10, borderTop:"1px solid #f1f5f9", paddingTop:10 }}>
                      <div><div style={{ fontSize:10, color:"#94a3b8", fontWeight:500 }}>MÉDIA SANEADA</div><div style={{ fontSize:14, fontWeight:700 }}>R$ {brl(c.mediaSaneada)}</div></div>
                      <div style={{ textAlign:"right" }}><div style={{ fontSize:10, color:"#94a3b8", fontWeight:500 }}>VALOR FINAL</div><div style={{ fontSize:14, fontWeight:700, color:"#0369a1" }}>R$ {brl(c.precoFinalDesconto)}</div></div>
                    </div>
                    {dias !== null && <div style={{ marginTop:6, fontSize:11, color:dias<0?"#dc2626":dias<=30?"#b45309":"#16a34a" }}>{dias<0?`Vencida há ${Math.abs(dias)} dias`:dias===0?"Vence hoje":`Vence em ${dias} dias`}</div>}
                  </div>
                </div>
              );
            })}
            {filtradas.length===0 && <div style={{ gridColumn:"1/-1", padding:40, textAlign:"center", color:"#94a3b8" }}>Nenhuma cotação encontrada.</div>}
          </div>
        )}
      </div>

      {/* Modal detalhe */}
      {detalhe && (() => {
        const c = cotacoes.find(x=>x.id===detalhe.id)||detalhe;
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={()=>setDetalhe(null)}>
            <div onClick={ev=>ev.stopPropagation()} style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:620, maxHeight:"91vh", overflowY:"auto", padding:26 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"monospace", marginBottom:4 }}>{c.codigo} · {c.categoria}</div>
                  <div style={{ fontSize:17, fontWeight:700, lineHeight:1.2 }}>{c.material}</div>
                  <div style={{ fontSize:12, color:"#64748b", marginTop:4 }}>{c.contrato} · Base: {c.dataBase}</div>
                </div>
                <StatusBadge status={c.status} size="lg" />
              </div>
              {c.imagem && <img src={c.imagem} style={{ width:"100%", height:150, objectFit:"cover", borderRadius:10, marginBottom:14 }} />}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                {[{l:"Média geral",v:"R$ "+brl(c.mediaGeral)},{l:"Média saneada",v:"R$ "+brl(c.mediaSaneada)},{l:`Valor c/ BDI (${c.bdi}%)`,v:"R$ "+brl(c.precoFinalBDI)},{l:`Valor final (desc. ${c.desconto}%)`,v:"R$ "+brl(c.precoFinalDesconto),dest:true},{l:"Data elaboração",v:c.dataElaboracao?new Date(c.dataElaboracao+"T12:00:00").toLocaleDateString("pt-BR"):"—"},{l:"Vencimento",v:fmtVenc(c.dataElaboracao)},{l:"Quantidade",v:c.quantidade+" "+c.unidade},{l:"Total referência",v:"R$ "+brl(c.precoFinalDesconto*c.quantidade)}].map(it =>
                  <div key={it.l} style={{ background:it.dest?"#eff6ff":"#f8fafc", borderRadius:10, padding:"10px 14px", border:it.dest?"1px solid #bfdbfe":"none" }}>
                    <div style={{ fontSize:11, color:"#94a3b8", fontWeight:500, marginBottom:2 }}>{it.l}</div>
                    <div style={{ fontSize:15, fontWeight:700, color:it.dest?"#1d4ed8":"#0f172a" }}>{it.v}</div>
                  </div>
                )}
              </div>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:600, color:"#64748b", marginBottom:8, letterSpacing:.4 }}>PESQUISA DE PREÇOS — SANEAMENTO</div>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                  <thead><tr style={{ background:"#f8fafc" }}>{["Fonte","Valor","Variação","Status"].map(h=><th key={h} style={{ padding:"7px 10px", textAlign:"left", fontSize:11, fontWeight:600, color:"#64748b", borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
                  <tbody>{c.fornecedores.filter(f=>parseFloat(f.valor)>0).map((f,i)=>
                    <tr key={i} style={{ background:f.autoExcluido?"#fef2f2":"#f0fdf4", borderBottom:"1px solid #f1f5f9" }}>
                      <td style={{ padding:"7px 10px", fontWeight:500 }}>{f.nome||"—"}</td>
                      <td style={{ padding:"7px 10px", fontFamily:"monospace" }}>R$ {brl(f.valor)}</td>
                      <td style={{ padding:"7px 10px", color:f.autoExcluido?"#dc2626":"#16a34a", fontWeight:600 }}>{f.variacao!=null?pct(f.variacao):"—"}</td>
                      <td style={{ padding:"7px 10px" }}>{f.autoExcluido?<span style={{ background:"#fee2e2",color:"#dc2626",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600 }}>EXCLUÍDO</span>:<span style={{ background:"#dcfce7",color:"#16a34a",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600 }}>ACEITO</span>}</td>
                    </tr>
                  )}</tbody>
                </table>
              </div>
              {c.observacoes && <div style={{ background:"#f8fafc", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#475569", marginBottom:14 }}><span style={{ fontWeight:600 }}>Obs.: </span>{c.observacoes}</div>}
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button onClick={()=>excluirCot(c.id)} style={{ border:"1px solid #fca5a5", background:"#fff", color:"#dc2626", borderRadius:8, padding:"8px 14px", fontSize:13, cursor:"pointer" }}>Excluir</button>
                <button onClick={()=>abrirEditar(c)} style={{ border:"1px solid #e2e8f0", background:"#fff", color:"#0f172a", borderRadius:8, padding:"8px 14px", fontSize:13, cursor:"pointer" }}>Editar</button>
                <button onClick={()=>setDetalhe(null)} style={{ background:"#0f172a", color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:600, cursor:"pointer" }}>Fechar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {modalForm && <FormModal editId={editId} initialForm={formInicial} onSave={salvar} onClose={()=>setModalForm(false)} />}
      {toast && <div style={{ position:"fixed", bottom:20, right:20, zIndex:300, background:toast.tipo==="erro"?"#fef2f2":"#f0fdf4", border:`1px solid ${toast.tipo==="erro"?"#fca5a5":"#86efac"}`, color:toast.tipo==="erro"?"#dc2626":"#16a34a", borderRadius:10, padding:"12px 18px", fontSize:13, fontWeight:500, boxShadow:"0 4px 16px rgba(0,0,0,.1)" }}>{toast.msg}</div>}
    </div>
  );
}
