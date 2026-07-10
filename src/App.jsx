import { useState, useMemo, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, getDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

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
const auth = getAuth(firebaseApp);
const FB_API_KEY = firebaseConfig.apiKey;

async function criarUsuarioFirebase(email, senha) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha, returnSecureToken: true })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Erro ao criar usuário");
  return data.localId;
}

// ── Constantes ────────────────────────────────────────────────────────────
const STATUS_CONTRATO = {
  ativo:     { label:"Ativo",     color:"#16a34a", bg:"#dcfce7", border:"#86efac" },
  encerrado: { label:"Encerrado", color:"#dc2626", bg:"#fee2e2", border:"#fca5a5" },
  suspenso:  { label:"Suspenso",  color:"#b45309", bg:"#fef3c7", border:"#fcd34d" },
};
const SV = {
  vigente: { label:"Vigente",  color:"#16a34a", bg:"#dcfce7", border:"#86efac" },
  avencer: { label:"A vencer", color:"#b45309", bg:"#fef3c7", border:"#fcd34d" },
  vencida: { label:"Vencida",  color:"#dc2626", bg:"#fee2e2", border:"#fca5a5" },
};
const PAPEIS = {
  admin:     { label:"Admin",     bg:"#fef3c7", color:"#92400e", border:"#fcd34d" },
  fiscal:    { label:"Fiscal",    bg:"#dbeafe", color:"#1e40af", border:"#93c5fd" },
  consultor: { label:"Consultor", bg:"#f1f5f9", color:"#475569", border:"#cbd5e1" },
};
const OPCOES_UNIDADE = ["UNID", "KG", "M", "L", "M²", "M³", "CX", "PC", "KIT"];

// ── Cálculos ──────────────────────────────────────────────────────────────
function arred(n, dec = 2) {
  const num = parseFloat(n) || 0; 
  const f = Math.pow(10, dec);
  return Math.round((num + Number.EPSILON) * f) / f;
}

function calcFornecedores(fornecedores) {
  const validos = (fornecedores || []).map(f => parseFloat(f.valor)).filter(v => !isNaN(v) && v > 0);
  if (!validos.length) return {
    mediaAritmetica: 0, menorValor: 0,
    forn: (fornecedores || []).map(f => ({ ...f, autoExcluido: false, variacao: null }))
  };
  const mediaAritmetica = arred(validos.reduce((a, b) => a + b, 0) / validos.length);
  const menorValor = Math.min(...validos);
  const forn = (fornecedores || []).map(f => {
    const v = parseFloat(f.valor);
    if (isNaN(v) || v <= 0) return { ...f, autoExcluido: false, variacao: null };
    return { ...f, autoExcluido: false, variacao: (v / mediaAritmetica) - 1 };
  });
  return { mediaAritmetica, menorValor, forn };
}

function calcBDI(base, bdi, desconto) {
  const b = parseFloat(bdi) || 0, d = parseFloat(desconto) || 0;
  const comBDI = arred(base * (1 + b / 100));
  const final  = arred(comBDI * (1 - d / 100));
  return { comBDI, final };
}

function enriquecer(c) {
  if (c.precoDireto) {
    const v = arred(parseFloat(c.valorFinalDireto) || 0);
    return { ...c, fornecedores: [], mediaAritmetica: v, menorValor: v, precoFinalBDI: v, precoFinalDesconto: v, status: calcStatusCot(c.dataElaboracao) };
  }
  const { mediaAritmetica, menorValor, forn } = calcFornecedores(c.fornecedores || []);
  const { comBDI, final } = calcBDI(menorValor, c.bdi, c.desconto);
  return { ...c, fornecedores: forn, mediaAritmetica, menorValor, precoFinalBDI: comBDI, precoFinalDesconto: final, status: calcStatusCot(c.dataElaboracao) };
}

function calcStatusCot(dt) {
  if (!dt) return "vencida";
  const v = new Date(dt + "T12:00:00"); v.setFullYear(v.getFullYear() + 1);
  const d = Math.ceil((v - new Date()) / 864e5);
  return d < 0 ? "vencida" : d <= 30 ? "avencer" : "vigente";
}
const fmtVenc = dt => { if (!dt) return "—"; const v = new Date(dt + "T12:00:00"); v.setFullYear(v.getFullYear() + 1); return v.toLocaleDateString("pt-BR"); };
const diasRest = dt => { if (!dt) return null; const v = new Date(dt + "T12:00:00"); v.setFullYear(v.getFullYear() + 1); return Math.ceil((v - new Date()) / 864e5); };
const brl = n => Number(arred(n || 0)).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => (n >= 0 ? "+" : "") + ((n || 0) * 100).toFixed(2) + "%";
const fmtData = dt => dt ? new Date(dt + "T12:00:00").toLocaleDateString("pt-BR") : "—";

const emptyFormCotacao = { 
  material: "", codigo: "", unidade: "UNID", contratoId: "", dataElaboracao: "", 
  quantidade: 1, observacoes: "", imagem: null, 
  precoDireto: false, valorFinalDireto: "", docDiretoNome: "", docDiretoData: null,
  fornecedores: [{ fonte: "Cotação de Mercado", nome: "", cpfCnpj: "", contato: "", url: "", valor: "", documentoNome: "", documentoData: null, documentoRef: null }] 
};

const emptyFormContrato = {
  numero: "", processoSEI: "", objeto: "", statusContrato: "ativo",
  contratanteNome: "", contratanteCNPJ: "", contratanteRepresentante: "", contratanteCargo: "",
  contratadaRazaoSocial: "", contratadaCNPJ: "", contratadaEndereco: "", contratadaTelefone: "", contratadaEmail: "", contratadaRepresentante: "",
  dataInicio: "", dataTermino: "", prazoMeses: "", prorrogavel: "sim", limiteProrrogacao: "",
  valorMensal: "", valorTotal: "", regimeExecucao: "", indiceReajuste: "IPCA",
  bdi: "", desconto: "", fiscal: "", observacoes: ""
};

// ── Badges ────────────────────────────────────────────────────────────────
function StatusBadge({ status, size }) {
  const s = SV[status] || SV.vencida;
  return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 20, padding: size === "lg" ? "4px 14px" : "2px 10px", fontSize: size === "lg" ? 13 : 11, fontWeight: 600, display: "inline-block", whiteSpace: "nowrap" }}>{s.label}</span>;
}
function RoleBadge({ papel }) {
  const s = PAPEIS[papel] || PAPEIS.consultor;
  return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>{s.label}</span>;
}
function StatusContratoBadge({ status }) {
  const s = STATUS_CONTRATO[status] || STATUS_CONTRATO.ativo;
  return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{s.label}</span>;
}

// ── Painel de preços ──────────────────────────────────────────────────────
function PainelPrecos({ fornecedores }) {
  const { mediaAritmetica, menorValor, forn } = calcFornecedores(fornecedores);
  if (!forn.some(f => parseFloat(f.valor) > 0)) return null;
  const total = forn.filter(f => parseFloat(f.valor) > 0).length;
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", letterSpacing: .5, marginBottom: 10 }}>PRÉVIA DOS PREÇOS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
        {[
          { l: "Média aritmética", v: "R$ " + brl(mediaAritmetica), c: "#475569" },
          { l: "Menor valor (base)", v: "R$ " + brl(menorValor), c: "#0369a1" },
          { l: "Total de fontes", v: total, c: "#16a34a" },
        ].map(item =>
          <div key={item.l} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500, marginBottom: 2 }}>{item.l}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: item.c }}>{item.v}</div>
          </div>
        )}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr style={{ background: "#f1f5f9" }}>{["Fonte", "Valor (R$)", "Variação s/ média"].map(h => <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
        <tbody>{forn.filter(f => parseFloat(f.valor) > 0).map((f, i) => (
          <tr key={i} style={{ background: parseFloat(f.valor) === menorValor ? "#f0fdf4" : "#fff", borderBottom: "1px solid #f1f5f9" }}>
            <td style={{ padding: "7px 10px", fontWeight: 500 }}>
              <span style={{color:"#0369a1", fontWeight:600}}>{f.fonte}</span> {f.nome ? `— ${f.nome}` : ""}
              {parseFloat(f.valor) === menorValor && <span style={{ marginLeft: 6, background: "#dcfce7", color: "#16a34a", borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>BASE</span>}
            </td>
            <td style={{ padding: "7px 10px", fontFamily: "monospace", fontWeight:600 }}>R$ {brl(f.valor)}</td>
            <td style={{ padding: "7px 10px", color: Math.abs(f.variacao || 0) > 0.15 ? "#b45309" : "#475569", fontWeight: 600 }}>{f.variacao != null ? pct(f.variacao) : "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ── Modal de cotação ──────────────────────────────────────────────────────
function FormModalCotacao({ editId, initialForm, contratos, cotacoes, onSave, onClose }) {
  const [form, setForm] = useState(initialForm);
  const [erroContrato, setErroContrato] = useState(false);

  const calc = useMemo(() => {
    const { mediaAritmetica, menorValor } = calcFornecedores(form.fornecedores || []);
    const { comBDI, final } = calcBDI(menorValor, form.bdi, form.desconto);
    return { mediaAritmetica, menorValor, comBDI, final };
  }, [form.fornecedores, form.bdi, form.desconto]);

  function updForn(i, k, v) { setForm(f => ({ ...f, fornecedores: f.fornecedores.map((fo, idx) => idx === i ? { ...fo, [k]: v } : fo) })); }
  function handleImg(ev) { const file = ev.target.files[0]; if (!file) return; const r = new FileReader(); r.onload = x => setForm(f => ({ ...f, imagem: x.target.result })); r.readAsDataURL(file); }
  
  function handleDocForn(i, ev) {
    const file = ev.target.files[0]; 
    if (!file) return; 
    const r = new FileReader(); 
    r.onload = x => {
      setForm(f => {
        const newForn = [...f.fornecedores];
        newForn[i] = { ...newForn[i], documentoData: x.target.result, documentoNome: file.name, documentoRef: null };
        return { ...f, fornecedores: newForn };
      });
    }; 
    r.readAsDataURL(file); 
  }

  const lbl = (txt, req) => <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>{txt}{req && <span style={{ color: "#dc2626", marginLeft: 2 }}>*</span>}</label>;

  function handleContractChange(ev) {
    const cid = ev.target.value;
    const contrato = contratos.find(c => c.id === cid);
    
    // Geração do código automático (Apenas para novas cotações)
    let novoCodigo = form.codigo;
    if (!editId && cid) {
      const numCotsNoContrato = cotacoes.filter(c => c.contratoId === cid).length;
      const seqStr = String(numCotsNoContrato + 1).padStart(3, '0');
      novoCodigo = `${contrato?.numero || "SN"}-${seqStr}`;
    } else if (!editId && !cid) {
      novoCodigo = "";
    }

    setForm(p => ({ ...p, contratoId: cid, bdi: contrato?.bdi || 0, desconto: contrato?.desconto || 0, codigo: novoCodigo }));
    setErroContrato(false);
  }

  function handleSave() {
    if (!form.contratoId) { setErroContrato(true); return; }
    if (!form.material || !form.dataElaboracao) return;
    setErroContrato(false);
    if (form.precoDireto) {
      onSave({ ...form });
    } else {
      onSave({ ...form, menorValor: calc.menorValor, mediaAritmetica: calc.mediaAritmetica, precoFinalBDI: calc.comBDI, precoFinalDesconto: calc.final });
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={ev => ev.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 760, maxHeight: "94vh", overflowY: "auto", padding: 26 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>{editId ? "Editar cotação" : "Nova cotação"}</div>

        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", letterSpacing: .5, marginBottom: 16, paddingBottom: 8, borderBottom: "2px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 4, height: 14, background: "#0ea5e9", borderRadius: 2 }}></div>IDENTIFICAÇÃO
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          <div style={{ gridColumn: "1/-1" }}>
            {lbl("Contrato vinculado", true)}
            <select value={form.contratoId || ""} onChange={handleContractChange}
              style={{ width: "100%", border: `1px solid ${erroContrato ? "#dc2626" : "#e2e8f0"}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, background: erroContrato ? "#fef2f2" : "#fff" }}>
              <option value="">— Selecione o contrato —</option>
              {contratos.map(c => <option key={c.id} value={c.id}>{c.numero} — {c.contratanteNome || c.contratadaRazaoSocial || ""}</option>)}
            </select>
            {erroContrato && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>⚠ Toda cotação deve estar vinculada a um contrato.</div>}
            {contratos.length === 0 && <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>Nenhum contrato cadastrado. Cadastre um contrato antes de criar cotações.</div>}
          </div>

          <div style={{ gridColumn: "1/-1" }}>{lbl("Material / Descrição", true)}<input value={form.material} onChange={ev => setForm(p => ({ ...p, material: ev.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} /></div>
          
          <div>{lbl("Código (Automático)")}<input value={form.codigo || ""} readOnly placeholder="Selecione um contrato..." style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, background: "#f1f5f9", color: "#64748b" }} /></div>
          
          <div>{lbl("Unidade")}
            <select value={form.unidade || "UNID"} onChange={ev => setForm(p => ({ ...p, unidade: ev.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
              {OPCOES_UNIDADE.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>{lbl("Data de elaboração", true)}<input type="date" value={form.dataElaboracao || ""} onChange={ev => setForm(p => ({ ...p, dataElaboracao: ev.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} /></div>
          <div>{lbl("Quantidade")}<input type="number" value={form.quantidade || ""} onChange={ev => setForm(p => ({ ...p, quantidade: ev.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} /></div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", letterSpacing: .5, marginTop: 24, marginBottom: 16, paddingBottom: 8, borderBottom: "2px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
             <div style={{ width: 4, height: 14, background: "#0ea5e9", borderRadius: 2 }}></div>INSERÇÃO DE PREÇOS
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "#0f172a", fontWeight: 400, background:"#f1f5f9", padding:"4px 10px", borderRadius:6, letterSpacing: 0, textTransform: "none" }}>
            <input type="checkbox" checked={form.precoDireto} onChange={ev => setForm(p => ({ ...p, precoDireto: ev.target.checked }))} />
            Inserir preço final diretamente (já c/ BDI)
          </label>
        </div>

        {form.precoDireto ? (
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "18px", marginBottom: 20, border:"1px solid #e2e8f0" }}>
            <div style={{display:"grid", gap:14}}>
                <div>
                    {lbl("Valor final (R$) — já com BDI e desconto aplicados")}
                    <input type="number" step="0.01" min="0" placeholder="0,00" value={form.valorFinalDireto}
                    onChange={ev => setForm(p => ({ ...p, valorFinalDireto: parseFloat(ev.target.value) || 0 }))}
                    style={{ border: "1px solid #e2e8f0", borderRadius: 7, padding: "9px 12px", fontSize: 14, width: 220 }} />
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Este valor será usado diretamente como preço final da cotação.</div>
                </div>
                <div style={{borderTop:"1px dashed #cbd5e1", paddingTop:14}}>
                    {lbl("Documento Comprobatório (Foto ou PDF)")}
                    <input type="file" accept=".pdf,image/*" onChange={ev => {
                        const file = ev.target.files[0];
                        if(!file) return;
                        const r = new FileReader();
                        r.onload = x => setForm(f => ({ ...f, docDiretoData: x.target.result, docDiretoNome: file.name }));
                        r.readAsDataURL(file);
                    }} style={{fontSize: 12, marginTop:4}} />
                    {form.docDiretoNome && <div style={{fontSize:12, color:"#16a34a", marginTop:6, fontWeight:600}}>✓ Arquivo anexado: {form.docDiretoNome}</div>}
                </div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px", marginBottom: 4 }}>
              {form.fornecedores.map((f, i) => (
                <div key={i} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Fonte de Preço {i + 1}</div>
                    {form.fornecedores.length > 1 && (
                      <button onClick={() => setForm(prev => ({ ...prev, fornecedores: prev.fornecedores.filter((_, idx) => idx !== i) }))} style={{ background: "none", border: "none", color: "#dc2626", fontSize: 11, fontWeight: 600, cursor: "pointer", padding:0 }}>Remover fonte</button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      {lbl("Tipo de Fonte")}
                      <select value={f.fonte} onChange={ev => updForn(i, "fonte", ev.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12, background:"#fff" }}>
                        <option value="Compras públicas">Compras públicas</option>
                        <option value="SINAPI">SINAPI</option>
                        <option value="ORSE">ORSE</option>
                        <option value="Internet">Internet</option>
                        <option value="Cotação de Mercado">Cotação de Mercado</option>
                        <option value="Outros">Outros</option>
                      </select>
                    </div>
                    <div>{lbl("Fornecedor / Nome")}<input placeholder="Ex: Jofepar" value={f.nome} onChange={ev => updForn(i, "nome", ev.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12 }} /></div>
                    <div>{lbl("CPF / CNPJ")}<input placeholder="00.000.000/0000-00" value={f.cpfCnpj} onChange={ev => updForn(i, "cpfCnpj", ev.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12 }} /></div>
                    <div>{lbl("Contato")}<input placeholder="Telefone, E-mail ou Vendedor" value={f.contato} onChange={ev => updForn(i, "contato", ev.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12 }} /></div>
                    <div>{lbl("URL (opcional)")}<input placeholder="https://..." value={f.url} onChange={ev => updForn(i, "url", ev.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12 }} /></div>
                    <div>{lbl("Valor Unitário (R$)")}<input type="number" step="0.01" min="0" placeholder="0,00" value={f.valor} onChange={ev => updForn(i, "valor", ev.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12, fontWeight:600, color:"#0369a1" }} /></div>
                    
                    <div style={{ gridColumn: "1/-1", borderTop: "1px dashed #e2e8f0", paddingTop: 14, marginTop: 4 }}>
                      {lbl("Documento Comprobatório (Foto ou PDF)")}
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexDirection:"column" }}>
                        <select
                          value={f.documentoRef !== null ? f.documentoRef : "novo"}
                          onChange={ev => {
                            const val = ev.target.value;
                            if (val === "novo") { updForn(i, "documentoRef", null); }
                            else { updForn(i, "documentoRef", parseInt(val)); updForn(i, "documentoData", null); updForn(i, "documentoNome", ""); }
                          }}
                          style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12, width: "100%", background:"#fff" }}>
                          <option value="novo">Anexar novo arquivo para esta fonte...</option>
                          {form.fornecedores.map((out, idx) => {
                            if (idx !== i && out.documentoRef === null && out.documentoData) {
                              return <option key={idx} value={idx}>Usar arquivo já anexado na Fonte {idx + 1} ({out.documentoNome})</option>;
                            }
                            return null;
                          })}
                        </select>
                        {f.documentoRef === null ? (
                          <div style={{ marginTop: 4 }}>
                            <input type="file" accept=".pdf,image/*" onChange={e => handleDocForn(i, e)} style={{ fontSize: 11 }} />
                            {f.documentoNome && <div style={{ fontSize: 12, color: "#16a34a", marginTop: 6, fontWeight: 600 }}>✓ Anexado: {f.documentoNome}</div>}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "#0369a1", marginTop: 4, fontWeight: 600 }}>✓ Vinculado ao documento da Fonte {f.documentoRef + 1}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={() => setForm(f => ({ ...f, fornecedores: [...(f.fornecedores || []), { fonte: "Cotação de Mercado", nome: "", cpfCnpj: "", contato: "", url: "", valor: "", documentoNome:"", documentoData:null, documentoRef:null }] }))} style={{ marginTop: 4, fontSize: 12, border: "1px dashed #cbd5e1", borderRadius: 8, padding: "10px 14px", background: "#fff", color: "#64748b", width: "100%", cursor: "pointer", fontWeight:600 }}>+ Adicionar outra fonte</button>
            </div>
            
            <PainelPrecos fornecedores={form.fornecedores || []} />

            <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", letterSpacing: .5, marginTop: 24, marginBottom: 16, paddingBottom: 8, borderBottom: "2px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 4, height: 14, background: "#0ea5e9", borderRadius: 2 }}></div>PARÂMETROS DE CÁLCULO (DO CONTRATO)
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div style={{ background: "#f1f5f9", padding: "8px 12px", borderRadius: 8, fontSize: 13, color: "#64748b" }}>BDI: <strong>{form.bdi || 0}%</strong></div>
              <div style={{ background: "#f1f5f9", padding: "8px 12px", borderRadius: 8, fontSize: 13, color: "#64748b" }}>Desconto: <strong>{form.desconto || 0}%</strong></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" }}><div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>MENOR VALOR (BASE)</div><div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>R$ {brl(calc.menorValor)}</div></div>
              <div style={{ background: "#dbeafe", border: "1px solid #93c5fd", borderRadius: 10, padding: "12px 14px" }}><div style={{ fontSize: 10, color: "#1e40af", fontWeight: 600, marginBottom: 4 }}>C/ BDI ({form.bdi || 0}%)</div><div style={{ fontSize: 17, fontWeight: 800, color: "#1d4ed8" }}>R$ {brl(calc.comBDI)}</div></div>
              <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 10, padding: "12px 14px" }}><div style={{ fontSize: 10, color: "#166534", fontWeight: 600, marginBottom: 4 }}>VALOR FINAL ({form.desconto || 0}% desc.)</div><div style={{ fontSize: 17, fontWeight: 800, color: "#16a34a" }}>R$ {brl(calc.final)}</div></div>
            </div>
          </>
        )}

        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", letterSpacing: .5, marginTop: 24, marginBottom: 16, paddingBottom: 8, borderBottom: "2px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 4, height: 14, background: "#0ea5e9", borderRadius: 2 }}></div>EXTRAS
        </div>

        <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
          <div>{lbl("Observações")}<textarea value={form.observacoes || ""} onChange={ev => setForm(p => ({ ...p, observacoes: ev.target.value }))} rows={2} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, resize: "vertical" }} /></div>
          <div>{lbl("Imagem do material")}<input type="file" accept="image/*" onChange={handleImg} style={{ fontSize: 13 }} />{form.imagem && <img src={form.imagem} style={{ marginTop: 8, height: 72, borderRadius: 8, objectFit: "cover" }} />}</div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 16, borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer", fontWeight:600 }}>Cancelar</button>
          <button onClick={handleSave} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{editId ? "Salvar alterações" : "Cadastrar cotação"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Modal de Contrato ─────────────────────────────────────────────────────
function FormModalContrato({ editId, initialForm, onSave, onClose }) {
  const [form, setForm] = useState(initialForm);
  const lbl = txt => <label style={{ fontSize: 12, fontWeight: 500, color: "#64748b", display: "block", marginBottom: 3 }}>{txt}</label>;
  const inp = (label, key, type = "text") => (
    <div key={key}>
      {lbl(label)}
      <input type={type} value={form[key] || ""} onChange={ev => setForm(p => ({ ...p, [key]: ev.target.value }))}
        style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, boxSizing: "border-box" }} />
    </div>
  );
  
  const sec = (txt, isFirst = false) => (
    <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", letterSpacing: .5, margin: `${isFirst ? 0 : 24}px 0 8px`, paddingBottom: 8, borderBottom: "2px solid #f1f5f9", gridColumn: "1/-1", display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 4, height: 14, background: "#0ea5e9", borderRadius: 2 }}></div>{txt}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={ev => ev.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 760, maxHeight: "95vh", overflowY: "auto", padding: 28 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{editId ? "Editar contrato" : "Novo contrato"}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Campos com * são obrigatórios.</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {sec("IDENTIFICAÇÃO", true)}
          {inp("Número do contrato *", "numero")}
          {inp("Nº do Processo SEI", "processoSEI")}
          <div style={{ gridColumn: "1/-1" }}>{lbl("Objeto (descrição do serviço) *")}<textarea value={form.objeto || ""} onChange={ev => setForm(p => ({ ...p, objeto: ev.target.value }))} rows={2} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, resize: "vertical" }} /></div>
          <div>{lbl("Status")}<select value={form.statusContrato || "ativo"} onChange={ev => setForm(p => ({ ...p, statusContrato: ev.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
            <option value="ativo">Ativo</option><option value="encerrado">Encerrado</option><option value="suspenso">Suspenso</option>
          </select></div>

          {sec("CONTRATANTE (ÓRGÃO)")}
          {inp("Nome do órgão *", "contratanteNome")}
          {inp("CNPJ", "contratanteCNPJ")}
          {inp("Representante legal", "contratanteRepresentante")}
          {inp("Cargo do representante", "contratanteCargo")}

          {sec("CONTRATADA (EMPRESA EXECUTORA)")}
          {inp("Razão social *", "contratadaRazaoSocial")}
          {inp("CNPJ", "contratadaCNPJ")}
          <div style={{ gridColumn: "1/-1" }}>{lbl("Endereço")}<input value={form.contratadaEndereco || ""} onChange={ev => setForm(p => ({ ...p, contratadaEndereco: ev.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, boxSizing: "border-box" }} /></div>
          {inp("Telefone", "contratadaTelefone")}
          {inp("E-mail", "contratadaEmail", "email")}
          {inp("Representante legal", "contratadaRepresentante")}

          {sec("VIGÊNCIA")}
          {inp("Data de início *", "dataInicio", "date")}
          {inp("Data de término *", "dataTermino", "date")}
          {inp("Prazo (meses)", "prazoMeses", "number")}
          <div>{lbl("Prorrogável")}<select value={form.prorrogavel || "sim"} onChange={ev => setForm(p => ({ ...p, prorrogavel: ev.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
            <option value="sim">Sim</option><option value="nao">Não</option>
          </select></div>
          {form.prorrogavel === "sim" && inp("Limite de prorrogação (meses)", "limiteProrrogacao", "number")}

          {sec("VALORES E PARÂMETROS DE COTAÇÃO")}
          {inp("Valor mensal estimado (R$)", "valorMensal", "number")}
          {inp("Valor total (R$)", "valorTotal", "number")}
          {inp("BDI (%)", "bdi", "number")}
          {inp("Desconto Licitação (%)", "desconto", "number")}

          {sec("GESTÃO")}
          {inp("Fiscal do contrato", "fiscal")}
          <div style={{ gridColumn: "1/-1" }}>{lbl("Observações")}<textarea value={form.observacoes || ""} onChange={ev => setForm(p => ({ ...p, observacoes: ev.target.value }))} rows={2} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, resize: "vertical" }} /></div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 24, paddingTop: 16, borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => onSave(form)} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{editId ? "Salvar alterações" : "Cadastrar contrato"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Painel de Contratos ───────────────────────────────────────────────────
function PainelContratos({ showToast }) {
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [detalhe, setDetalhe] = useState(null);

  useEffect(() => { carregar(); }, []);
  async function carregar() {
    setLoading(true);
    try { const snap = await getDocs(collection(db, "contratos")); setContratos(snap.docs.map(d => ({ id: d.id, materiais: [], ...d.data() }))); }
    catch (e) { showToast("Erro ao carregar contratos.", "erro"); }
    finally { setLoading(false); }
  }

  async function salvar(form) {
    if (!form.numero || !form.objeto) { showToast("Preencha número e objeto.", "erro"); return; }
    try {
      if (editando) {
        const atualizado = { ...editando, ...form };
        await setDoc(doc(db, "contratos", editando.id), atualizado);
        setContratos(p => p.map(c => c.id === editando.id ? atualizado : c));
        showToast("Contrato atualizado.");
      } else {
        const id = "contrato-" + Date.now();
        const novo = { ...form, id, criadoEm: new Date().toISOString(), materiais: [] };
        await setDoc(doc(db, "contratos", id), novo);
        setContratos(p => [...p, novo]);
        showToast("Contrato cadastrado.");
      }
      setModal(false); setEditando(null);
    } catch (e) { showToast("Erro ao salvar contrato.", "erro"); }
  }

  async function excluir(id) {
    if (!window.confirm("Excluir este contrato? As cotações vinculadas não serão excluídas.")) return;
    try { await deleteDoc(doc(db, "contratos", id)); setContratos(p => p.filter(c => c.id !== id)); setDetalhe(null); showToast("Contrato removido."); }
    catch (e) { showToast("Erro ao excluir.", "erro"); }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
        <div><div style={{ fontSize: 18, fontWeight: 700 }}>Contratos</div><div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>{contratos.length} {contratos.length === 1 ? "contrato" : "contratos"} cadastrados</div></div>
        <button onClick={() => { setEditando(null); setModal(true); }} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 16 }}>+</span> Novo contrato</button>
      </div>
      {loading ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Carregando...</div> : (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              {["Número", "Contratada", "Objeto", "Vigência", "BDI / Desc.", "Valor total", "Status", ""].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", letterSpacing: .4, whiteSpace: "nowrap" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {contratos.map((c, i) => (
                <tr key={c.id} onClick={() => setDetalhe(c)} style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: i % 2 === 0 ? "#fff" : "#fafafa" }}
                  onMouseEnter={ev => ev.currentTarget.style.background = "#f0f9ff"}
                  onMouseLeave={ev => ev.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#fafafa"}>
                  <td style={{ padding: "11px 14px", fontWeight: 700, fontFamily: "monospace", fontSize: 12 }}>{c.numero || "—"}</td>
                  <td style={{ padding: "11px 14px", fontWeight: 500 }}>{c.contratadaRazaoSocial || "—"}</td>
                  <td style={{ padding: "11px 14px", color: "#475569", maxWidth: 200 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.objeto || "—"}</div></td>
                  <td style={{ padding: "11px 14px", fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>{fmtData(c.dataInicio)} → {fmtData(c.dataTermino)}</td>
                  <td style={{ padding: "11px 14px", fontSize: 12, color: "#475569" }}>{c.bdi || 0}% / {c.desconto || 0}%</td>
                  <td style={{ padding: "11px 14px", fontWeight: 600 }}>R$ {brl(c.valorTotal)}</td>
                  <td style={{ padding: "11px 14px" }}><StatusContratoBadge status={c.statusContrato} /></td>
                  <td style={{ padding: "11px 14px" }}><button onClick={ev => { ev.stopPropagation(); setEditando(c); setModal(true); }} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#475569", cursor: "pointer" }}>Editar</button></td>
                </tr>
              ))}
              {contratos.length === 0 && <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Nenhum contrato cadastrado ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {detalhe && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setDetalhe(null)}>
          <div onClick={ev => ev.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto", padding: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
              <div><div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginBottom: 4 }}>{detalhe.numero} · SEI: {detalhe.processoSEI || "—"}</div><div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3, maxWidth: 460 }}>{detalhe.objeto || "—"}</div></div>
              <StatusContratoBadge status={detalhe.statusContrato} />
            </div>
            {[
              { titulo: "CONTRATANTE", campos: [{ l: "Nome", v: detalhe.contratanteNome }, { l: "CNPJ", v: detalhe.contratanteCNPJ }, { l: "Representante", v: detalhe.contratanteRepresentante }, { l: "Cargo", v: detalhe.contratanteCargo }] },
              { titulo: "CONTRATADA", campos: [{ l: "Razão social", v: detalhe.contratadaRazaoSocial }, { l: "CNPJ", v: detalhe.contratadaCNPJ }, { l: "Endereço", v: detalhe.contratadaEndereco }, { l: "Telefone", v: detalhe.contratadaTelefone }, { l: "E-mail", v: detalhe.contratadaEmail }, { l: "Representante", v: detalhe.contratadaRepresentante }] },
              { titulo: "VIGÊNCIA", campos: [{ l: "Início", v: fmtData(detalhe.dataInicio) }, { l: "Término", v: fmtData(detalhe.dataTermino) }, { l: "Prazo", v: detalhe.prazoMeses ? (detalhe.prazoMeses + " meses") : "—" }, { l: "Prorrogável", v: detalhe.prorrogavel === "sim" ? "Sim" : "Não" }, { l: "Limite prorrog.", v: detalhe.limiteProrrogacao ? detalhe.limiteProrrogacao + " meses" : "—" }] },
              { titulo: "VALORES E PARÂMETROS", campos: [{ l: "Valor mensal", v: "R$ " + brl(detalhe.valorMensal) }, { l: "Valor total", v: "R$ " + brl(detalhe.valorTotal) }, { l: "BDI (%)", v: (detalhe.bdi || 0) + "%" }, { l: "Desconto (%)", v: (detalhe.desconto || 0) + "%" }] },
              { titulo: "GESTÃO", campos: [{ l: "Fiscal", v: detalhe.fiscal || "—" }, { l: "Observações", v: detalhe.observacoes || "—" }] },
            ].map(sec => (
              <div key={sec.titulo} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", letterSpacing: .5, marginBottom: 8 }}>{sec.titulo}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {sec.campos.map(f => (
                    <div key={f.l} style={{ background: "#f8fafc", borderRadius: 8, padding: "9px 12px" }}>
                      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500, marginBottom: 2 }}>{f.l}</div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#0f172a" }}>{f.v || "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => excluir(detalhe.id)} style={{ border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>Excluir</button>
              <button onClick={() => { setEditando(detalhe); setDetalhe(null); setModal(true); }} style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>Editar</button>
              <button onClick={() => setDetalhe(null)} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Fechar</button>
            </div>
          </div>
        </div>
      )}
      {modal && <FormModalContrato editId={editando?.id} initialForm={editando || emptyFormContrato} onSave={salvar} onClose={() => { setModal(false); setEditando(null); }} />}
    </div>
  );
}

// ── Painel Itens Previstos ────────────────────────────────────────────────
function PainelItensPrevistos({ contratosAcessiveis, setContratos, showToast, usuario }) {
  const [filtroContrato, setFiltroContrato] = useState("");
  const [buscaItem, setBuscaItem] = useState("");
  const [novoMaterial, setNovoMaterial] = useState({ item: "", nome: "", unidade: "UNID", valor: "" });
  const [reajustePct, setReajustePct] = useState("");
  const [editandoItem, setEditandoItem] = useState(null);
  const [formEdicao, setFormEdicao] = useState({ item: "", nome: "", unidade: "UNID", valor: "" });

  useEffect(() => {
    if (!filtroContrato && contratosAcessiveis.length > 0) setFiltroContrato(contratosAcessiveis[0].id);
  }, [contratosAcessiveis, filtroContrato]);

  const contratoSelecionado = contratosAcessiveis.find(c => c.id === filtroContrato);
  const podeEditar = usuario?.papel === "admin" || usuario?.papel === "fiscal";

  const materiaisFiltrados = (contratoSelecionado?.materiais || []).filter(m =>
    m.nome.toLowerCase().includes(buscaItem.toLowerCase()) ||
    (m.item && String(m.item).toLowerCase().includes(buscaItem.toLowerCase()))
  );

  async function addMaterial() {
    if (!novoMaterial.nome || !novoMaterial.valor || !contratoSelecionado) return;
    const matAdd = { ...novoMaterial, id: Date.now().toString(), valor: arred(parseFloat(novoMaterial.valor)) };
    const novosMateriais = [...(contratoSelecionado.materiais || []), matAdd];
    try {
      await setDoc(doc(db, "contratos", contratoSelecionado.id), { materiais: novosMateriais }, { merge: true });
      setContratos(p => p.map(c => c.id === contratoSelecionado.id ? { ...c, materiais: novosMateriais } : c));
      setNovoMaterial({ item: "", nome: "", unidade: "UNID", valor: "" });
      showToast("Item adicionado.");
    } catch (e) { showToast("Erro ao adicionar item.", "erro"); }
  }

  async function delMaterial(idMat) {
    if (!contratoSelecionado) return;
    const novosMateriais = contratoSelecionado.materiais.filter(m => m.id !== idMat);
    try {
      await setDoc(doc(db, "contratos", contratoSelecionado.id), { materiais: novosMateriais }, { merge: true });
      setContratos(p => p.map(c => c.id === contratoSelecionado.id ? { ...c, materiais: novosMateriais } : c));
      showToast("Item removido.");
    } catch (e) { showToast("Erro ao remover item.", "erro"); }
  }

  async function salvarEdicao() {
    if (!contratoSelecionado || !formEdicao.nome || !formEdicao.valor) return;
    const novosMateriais = contratoSelecionado.materiais.map(m =>
      m.id === editandoItem
        ? { ...m, item: formEdicao.item, nome: formEdicao.nome, unidade: formEdicao.unidade, valor: arred(parseFloat(formEdicao.valor)) }
        : m
    );
    try {
      await setDoc(doc(db, "contratos", contratoSelecionado.id), { materiais: novosMateriais }, { merge: true });
      setContratos(p => p.map(c => c.id === contratoSelecionado.id ? { ...c, materiais: novosMateriais } : c));
      setEditandoItem(null);
      showToast("Item atualizado.");
    } catch (e) { showToast("Erro ao atualizar item.", "erro"); }
  }

  async function aplicarReajuste() {
    if (!contratoSelecionado) return;
    const p = parseFloat(reajustePct);
    if (isNaN(p) || !contratoSelecionado.materiais?.length) return;
    const novosMateriais = contratoSelecionado.materiais.map(m => ({
      ...m, valor: arred(m.valor * (1 + p / 100))
    }));
    try {
      await setDoc(doc(db, "contratos", contratoSelecionado.id), { materiais: novosMateriais }, { merge: true });
      setContratos(p => p.map(c => c.id === contratoSelecionado.id ? { ...c, materiais: novosMateriais } : c));
      setReajustePct("");
      showToast("Reajuste aplicado.");
    } catch (e) { showToast("Erro ao reajustar.", "erro"); }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px" }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Itens Previstos</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>Materiais fixos do contrato</div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 250, maxWidth: 400 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 8 }}>Selecione o Contrato</label>
          <select value={filtroContrato} onChange={ev => { setFiltroContrato(ev.target.value); setBuscaItem(""); }} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
            <option value="">— Selecione —</option>
            {contratosAcessiveis.map(c => <option key={c.id} value={c.id}>{c.numero} — {c.contratadaRazaoSocial}</option>)}
          </select>
        </div>
        {contratoSelecionado && (
          <div style={{ flex: 1, minWidth: 250, maxWidth: 400 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 8 }}>Pesquisar Item</label>
            <input placeholder="Buscar por nº ou descrição..." value={buscaItem} onChange={ev => setBuscaItem(ev.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none" }} />
          </div>
        )}
      </div>

      {contratoSelecionado && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Itens de {contratoSelecionado.numero}</div>
            {podeEditar && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Reajuste em lote:</span>
                <input type="number" placeholder="Ex: 5.5 (%)" value={reajustePct} onChange={e => setReajustePct(e.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", fontSize: 12, width: 110 }} />
                <button onClick={aplicarReajuste} style={{ background: "#0369a1", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Aplicar</button>
              </div>
            )}
          </div>

          {podeEditar && (
            <div style={{ background: "#f8fafc", borderRadius: 8, padding: 12, marginBottom: 16, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>ADICIONAR NOVO ITEM</div>
              <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 100px 140px 40px", gap: 8, alignItems: "center" }}>
                <input placeholder="Item (Nº)" value={novoMaterial.item} onChange={e => setNovoMaterial({ ...novoMaterial, item: e.target.value })} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
                <input placeholder="Descrição do material..." value={novoMaterial.nome} onChange={e => setNovoMaterial({ ...novoMaterial, nome: e.target.value })} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
                <select value={novoMaterial.unidade} onChange={e => setNovoMaterial({ ...novoMaterial, unidade: e.target.value })} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff" }}>
                  {OPCOES_UNIDADE.map(opt => <option key={opt}>{opt}</option>)}
                </select>
                <input type="number" step="0.01" placeholder="Valor Unit. (R$)" value={novoMaterial.valor} onChange={e => setNovoMaterial({ ...novoMaterial, valor: e.target.value })} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
                <button onClick={addMaterial} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "8px", fontSize: 18, cursor: "pointer", display: "flex", justifyContent: "center", fontWeight: "bold" }}>+</button>
              </div>
            </div>
          )}

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", width: 60 }}>Item</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b" }}>Descrição</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", width: 100 }}>Unidade</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", width: 150 }}>Valor Unit. (R$)</th>
              {podeEditar && <th style={{ padding: "10px 14px", width: 80, textAlign: "center" }}>Ações</th>}
            </tr></thead>
            <tbody>
              {materiaisFiltrados.map(m => {
                if (editandoItem === m.id) return (
                  <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9", background: "#eff6ff" }}>
                    <td style={{ padding: "8px 14px" }}><input value={formEdicao.item} onChange={e => setFormEdicao({ ...formEdicao, item: e.target.value })} style={{ width: "100%", border: "1px solid #93c5fd", borderRadius: 4, padding: 6, fontSize: 12 }} /></td>
                    <td style={{ padding: "8px 14px" }}><input value={formEdicao.nome} onChange={e => setFormEdicao({ ...formEdicao, nome: e.target.value })} style={{ width: "100%", border: "1px solid #93c5fd", borderRadius: 4, padding: 6, fontSize: 12 }} /></td>
                    <td style={{ padding: "8px 14px" }}><select value={formEdicao.unidade} onChange={e => setFormEdicao({ ...formEdicao, unidade: e.target.value })} style={{ width: "100%", border: "1px solid #93c5fd", borderRadius: 4, padding: 6, fontSize: 12, background: "#fff" }}>{OPCOES_UNIDADE.map(opt => <option key={opt}>{opt}</option>)}</select></td>
                    <td style={{ padding: "8px 14px" }}><input type="number" step="0.01" value={formEdicao.valor} onChange={e => setFormEdicao({ ...formEdicao, valor: e.target.value })} style={{ width: "100%", border: "1px solid #93c5fd", borderRadius: 4, padding: 6, fontSize: 12 }} /></td>
                    <td style={{ padding: "8px 14px", textAlign: "center", whiteSpace: "nowrap" }}>
                      <button onClick={salvarEdicao} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, padding: "5px 10px", fontSize: 11, cursor: "pointer", marginRight: 4, fontWeight: 600 }}>Salvar</button>
                      <button onClick={() => setEditandoItem(null)} style={{ background: "#94a3b8", color: "#fff", border: "none", borderRadius: 4, padding: "5px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
                    </td>
                  </tr>
                );
                return (
                  <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "11px 14px", fontWeight: 600, color: "#64748b" }}>{m.item || "—"}</td>
                    <td style={{ padding: "11px 14px", fontWeight: 500 }}>{m.nome}</td>
                    <td style={{ padding: "11px 14px", color: "#64748b" }}>{m.unidade}</td>
                    <td style={{ padding: "11px 14px", fontWeight: 600 }}>R$ {brl(m.valor)}</td>
                    {podeEditar && (
                      <td style={{ padding: "11px 14px", textAlign: "center", whiteSpace: "nowrap" }}>
                        <button onClick={() => { setEditandoItem(m.id); setFormEdicao({ item: m.item || "", nome: m.nome, unidade: m.unidade || "UNID", valor: m.valor }); }} style={{ background: "none", border: "none", color: "#0369a1", fontSize: 16, cursor: "pointer", marginRight: 10 }} title="Editar">✎</button>
                        <button onClick={() => delMaterial(m.id)} style={{ background: "none", border: "none", color: "#dc2626", fontSize: 18, cursor: "pointer", fontWeight: "bold" }} title="Excluir">×</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {materiaisFiltrados.length === 0 && (
                <tr><td colSpan={podeEditar ? 5 : 4} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
                  {buscaItem ? "Nenhum item encontrado para esta busca." : "Nenhum item cadastrado neste contrato."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Painel de Usuários ────────────────────────────────────────────────────
function PainelUsuarios({ showToast }) {
  const [usuarios, setUsuarios] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ nome: "", email: "", senha: "", papel: "consultor", contratosAcesso: [] });
  const [salvando, setSalvando] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);

  useEffect(() => { carregarTudo(); }, []);
  async function carregarTudo() {
    setLoading(true);
    try {
      const [snapU, snapC] = await Promise.all([getDocs(collection(db, "usuarios")), getDocs(collection(db, "contratos"))]);
      setUsuarios(snapU.docs.map(d => d.data()));
      setContratos(snapC.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { showToast("Erro ao carregar dados.", "erro"); }
    finally { setLoading(false); }
  }

  function toggleContrato(id) { setForm(f => { const a = f.contratosAcesso || []; return { ...f, contratosAcesso: a.includes(id) ? a.filter(x => x !== id) : [...a, id] }; }); }

  async function salvarUsuario() {
    if (!form.nome || !form.email) { showToast("Preencha nome e email.", "erro"); return; }
    if (!editando && !form.senha) { showToast("Defina uma senha.", "erro"); return; }
    if (!editando && form.senha.length < 6) { showToast("Senha mínima de 6 caracteres.", "erro"); return; }
    setSalvando(true);
    try {
      if (editando) {
        const atualizado = { ...editando, nome: form.nome, papel: form.papel, contratosAcesso: form.contratosAcesso || [] };
        await setDoc(doc(db, "usuarios", editando.uid), atualizado);
        setUsuarios(p => p.map(u => u.uid === editando.uid ? atualizado : u));
        showToast("Usuário atualizado.");
      } else {
        const uid = await criarUsuarioFirebase(form.email, form.senha);
        const perfil = { uid, nome: form.nome, email: form.email, papel: form.papel, contratosAcesso: form.contratosAcesso || [], criadoEm: new Date().toISOString() };
        await setDoc(doc(db, "usuarios", uid), perfil);
        setUsuarios(p => [...p, perfil]);
        showToast("Usuário criado.");
      }
      setModal(false);
    } catch (e) {
      const msg = e.message.includes("EMAIL_EXISTS") ? "Este email já está cadastrado." : e.message.includes("WEAK_PASSWORD") ? "Senha fraca." : "Erro ao salvar usuário.";
      showToast(msg, "erro");
    } finally { setSalvando(false); }
  }

  async function excluirUsuario(u) {
    try {
      await deleteDoc(doc(db, "usuarios", u.uid));
      setUsuarios(p => p.filter(x => x.uid !== u.uid));
      setConfirmExcluir(null); setModal(false);
      showToast("Usuário removido.");
    } catch (e) { showToast("Erro ao excluir usuário.", "erro"); }
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
        <div><div style={{ fontSize: 18, fontWeight: 700 }}>Usuários</div><div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>{usuarios.length} {usuarios.length === 1 ? "usuário" : "usuários"} cadastrados</div></div>
        <button onClick={() => { setForm({ nome: "", email: "", senha: "", papel: "consultor", contratosAcesso: [] }); setEditando(null); setModal(true); }} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 16 }}>+</span> Novo usuário</button>
      </div>

      {loading ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Carregando...</div> : (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              {["Nome", "E-mail", "Perfil", "Contratos", "Cadastrado em", ""].map(h => <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", letterSpacing: .4 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {usuarios.map((u, i) => {
                const p = PAPEIS[u.papel] || PAPEIS.consultor;
                const qtd = (u.contratosAcesso || []).length;
                return (
                  <tr key={u.uid} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 600 }}>{u.nome || "—"}</td>
                    <td style={{ padding: "12px 16px", color: "#475569" }}>{u.email || "—"}</td>
                    <td style={{ padding: "12px 16px" }}><span style={{ background: p.bg, color: p.color, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>{p.label}</span></td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "#64748b" }}>
                      {u.papel === "admin" ? <span style={{ color: "#16a34a", fontWeight: 600 }}>Todos</span> : qtd === 0 ? <span style={{ color: "#94a3b8" }}>Nenhum</span> : <span style={{ color: "#0369a1", fontWeight: 600 }}>{qtd} contrato{qtd > 1 ? "s" : ""}</span>}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 12 }}>{u.criadoEm ? new Date(u.criadoEm).toLocaleDateString("pt-BR") : "—"}</td>
                    <td style={{ padding: "12px 16px" }}><button onClick={() => { setForm({ nome: u.nome || "", email: u.email || "", senha: "", papel: u.papel || "consultor", contratosAcesso: u.contratosAcesso || [] }); setEditando(u); setModal(true); }} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#475569", cursor: "pointer" }}>Editar</button></td>
                  </tr>
                );
              })}
              {usuarios.length === 0 && <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Nenhum usuário cadastrado.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setModal(false)}>
          <div onClick={ev => ev.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", padding: 28 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>{editando ? "Editar usuário" : "Novo usuário"}</div>
            <div style={{ display: "grid", gap: 14 }}>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Nome completo *</label><input value={form.nome} onChange={ev => setForm(p => ({ ...p, nome: ev.target.value }))} placeholder="Ex: João Silva" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", fontSize: 13, boxSizing: "border-box" }} /></div>
              {!editando && <>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>E-mail *</label><input value={form.email} onChange={ev => setForm(p => ({ ...p, email: ev.target.value }))} placeholder="usuario@email.com" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", fontSize: 13, boxSizing: "border-box" }} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Senha inicial *</label><input type="password" value={form.senha} onChange={ev => setForm(p => ({ ...p, senha: ev.target.value }))} placeholder="Mínimo 6 caracteres" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", fontSize: 13, boxSizing: "border-box" }} /></div>
              </>}
              <div><label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Perfil de acesso *</label>
                <select value={form.papel} onChange={ev => setForm(p => ({ ...p, papel: ev.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", fontSize: 13, background: "#fff" }}>
                  <option value="admin">Admin — acesso total</option>
                  <option value="fiscal">Fiscal — visualiza e edita</option>
                  <option value="consultor">Consultor — somente visualiza</option>
                </select>
              </div>
              {form.papel !== "admin" && contratos.length > 0 && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 8 }}>Contratos com acesso</label>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                    {contratos.map((c, i) => {
                      const marcado = (form.contratosAcesso || []).includes(c.id);
                      return (
                        <div key={c.id} onClick={() => toggleContrato(c.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer", background: marcado ? "#f0f9ff" : "#fff", borderBottom: i < contratos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                          <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${marcado ? "#0369a1" : "#cbd5e1"}`, background: marcado ? "#0369a1" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {marcado && <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>✓</span>}
                          </div>
                          <div><div style={{ fontSize: 13, fontWeight: 500 }}>{c.numero}</div><div style={{ fontSize: 11, color: "#94a3b8" }}>{c.contratadaRazaoSocial || c.objeto?.substring(0, 50)}</div></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {form.papel === "admin" && <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#166534" }}>Admins têm acesso total a todos os contratos automaticamente.</div>}
              {editando && <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>Para alterar e-mail ou senha, acesse o Firebase Authentication no console.</div>}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 22 }}>
              {editando && <button onClick={() => setConfirmExcluir(editando)} style={{ border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" }}>Excluir usuário</button>}
              <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                <button onClick={() => setModal(false)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
                <button onClick={salvarUsuario} disabled={salvando} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 600, cursor: salvando ? "not-allowed" : "pointer", opacity: salvando ? .7 : 1 }}>{salvando ? "Salvando..." : editando ? "Salvar alterações" : "Criar usuário"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmExcluir && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setConfirmExcluir(null)}>
          <div onClick={ev => ev.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 380, padding: 28 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: "#dc2626" }}>Excluir usuário?</div>
            <div style={{ fontSize: 13, color: "#475569", marginBottom: 20 }}>Tem certeza que deseja remover <strong>{confirmExcluir.nome}</strong>? O acesso ao app será revogado imediatamente.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmExcluir(null)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => excluirUsuario(confirmExcluir)} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Sim, excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tela de Login ─────────────────────────────────────────────────────────
function TelaLogin() {
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  async function handleLogin() {
    if (!login || !senha) { setErro("Preencha o e-mail e a senha."); return; }
    setLoading(true); setErro("");
    try { await signInWithEmailAndPassword(auth, login.trim().toLowerCase(), senha); }
    catch (e) { setErro("E-mail ou senha incorretos."); }
    finally { setLoading(false); }
  }
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 18, border: "1px solid #e2e8f0", padding: "36px 40px", width: "100%", maxWidth: 380, boxShadow: "0 8px 32px rgba(0,0,0,.07)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28 }}>
          <div style={{ width: 48, height: 48, background: "#0f172a", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "#38bdf8", marginBottom: 12 }}>❄</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", letterSpacing: -.4 }}>CotaFacil SMP</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Sistema de Cotações</div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>E-mail</label>
          <input value={login} onChange={ev => setLogin(ev.target.value)} placeholder="seu@email.com" onKeyDown={ev => ev.key === "Enter" && handleLogin()} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 9, padding: "10px 14px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Senha</label>
          <input type="password" value={senha} onChange={ev => setSenha(ev.target.value)} placeholder="••••••••" onKeyDown={ev => ev.key === "Enter" && handleLogin()} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 9, padding: "10px 14px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
        </div>
        {erro && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 8, padding: "9px 14px", fontSize: 13, marginBottom: 14 }}>{erro}</div>}
        <button onClick={handleLogin} disabled={loading} style={{ width: "100%", background: "#0f172a", color: "#fff", border: "none", borderRadius: 9, padding: 11, fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? .7 : 1 }}>{loading ? "Entrando..." : "Entrar"}</button>
      </div>
    </div>
  );
}

// ── App principal ─────────────────────────────────────────────────────────
export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cotacoes, setCotacoes] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [aba, setAba] = useState("cotacoes");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("cards"); // VISUALIZAÇÃO PADRÃO ALTERADA PARA CARDS
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroContrato, setFiltroContrato] = useState("todos");
  const [busca, setBusca] = useState("");
  const [modalForm, setModalForm] = useState(false);
  const [formInicial, setFormInicial] = useState(emptyFormCotacao);
  const [editId, setEditId] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, tipo = "ok") => { setToast({ msg, tipo }); setTimeout(() => setToast(null), 3200); };
  const podeEditar = usuario?.papel === "admin" || usuario?.papel === "fiscal";

  const contratosAcessiveis = useMemo(() => {
    if (!usuario) return [];
    if (usuario.papel === "admin") return contratos;
    const ids = usuario.contratosAcesso || [];
    return contratos.filter(c => ids.includes(c.id));
  }, [usuario, contratos]);

  useEffect(() => {
    const timer = setTimeout(() => { setAuthLoading(false); }, 10000);
    const unsub = onAuthStateChanged(auth, async fireUser => {
      clearTimeout(timer);
      try {
        if (fireUser) {
          setAuthUser(fireUser);
          try {
            const snap = await getDoc(doc(db, "usuarios", fireUser.uid));
            if (snap.exists()) { setUsuario(snap.data()); }
            else {
              const perfil = { uid: fireUser.uid, email: fireUser.email, nome: fireUser.email, papel: "admin", contratosAcesso: [], criadoEm: new Date().toISOString() };
              await setDoc(doc(db, "usuarios", fireUser.uid), perfil);
              setUsuario(perfil);
            }
          } catch (e) {
            setUsuario({ uid: fireUser.uid, email: fireUser.email, nome: fireUser.email, papel: "admin", contratosAcesso: [] });
          }
        } else { setAuthUser(null); setUsuario(null); }
      } catch (e) { console.error(e); }
      finally { setAuthLoading(false); }
    });
    return () => { clearTimeout(timer); unsub(); };
  }, []);

  useEffect(() => {
    if (!authUser) return;
    async function carregar() {
      try {
        const [snapC, snapCot] = await Promise.all([getDocs(collection(db, "contratos")), getDocs(collection(db, "cotacoes"))]);
        setContratos(snapC.docs.map(d => ({ id: d.id, materiais: [], ...d.data() })));
        if (!snapCot.empty) {
          const dados = snapCot.docs.map(d => enriquecer(d.data()));
          dados.sort((a, b) => (a.id || 0) - (b.id || 0));
          setCotacoes(dados);
        }
      } catch (e) { showToast("Erro ao conectar com o banco de dados.", "erro"); }
      finally { setLoading(false); }
    }
    carregar();
  }, [authUser]);

  const filtradas = useMemo(() => cotacoes.filter(c => {
    if (usuario?.papel !== "admin") {
      const ids = usuario?.contratosAcesso || [];
      if (c.contratoId && !ids.includes(c.contratoId)) return false;
    }
    if (filtroStatus !== "todos" && c.status !== filtroStatus) return false;
    if (filtroContrato !== "todos" && c.contratoId !== filtroContrato) return false;
    if (busca && !c.material.toLowerCase().includes(busca.toLowerCase()) && !c.codigo?.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  }), [cotacoes, filtroStatus, filtroContrato, busca, usuario]);

  // Agrupamento por contrato
  const cotacoesAgrupadas = useMemo(() => {
    const grupos = {};
    filtradas.forEach(c => {
      const key = c.contratoId || "sem_contrato";
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(c);
    });
    return grupos;
  }, [filtradas]);

  const stats = useMemo(() => {
    const base = cotacoes.filter(c => {
      if (usuario?.papel !== "admin") { const ids = usuario?.contratosAcesso || []; if (c.contratoId && !ids.includes(c.contratoId)) return false; }
      return true;
    });
    return { total: base.length, vigente: base.filter(c => c.status === "vigente").length, avencer: base.filter(c => c.status === "avencer").length, vencida: base.filter(c => c.status === "vencida").length };
  }, [cotacoes, usuario]);

  function abrirNova() { setFormInicial(emptyFormCotacao); setEditId(null); setModalForm(true); }
  function abrirEditar(c) { setFormInicial({ ...c, fornecedores: (c.fornecedores || []).map(f => ({ ...f })) }); setEditId(c.id); setModalForm(true); setDetalhe(null); }

  async function salvar(form) {
    if (!form.material || !form.dataElaboracao) { showToast("Preencha material e data.", "erro"); return; }
    if (!form.contratoId) { showToast("Vincule a cotação a um contrato.", "erro"); return; }
    const nova = enriquecer(form);
    try {
      if (editId) { const a = { ...nova, id: editId }; await setDoc(doc(db, "cotacoes", String(editId)), a); setCotacoes(p => p.map(c => c.id === editId ? a : c)); showToast("Cotação atualizada."); }
      else { const nid = Math.max(0, ...cotacoes.map(c => c.id || 0)) + 1; const n2 = { ...nova, id: nid }; await setDoc(doc(db, "cotacoes", String(nid)), n2); setCotacoes(p => [...p, n2]); showToast("Cotação cadastrada."); }
    } catch (e) { showToast("Erro ao salvar cotação.", "erro"); return; }
    setModalForm(false);
  }

  async function excluirCot(id) {
    try { await deleteDoc(doc(db, "cotacoes", String(id))); setCotacoes(p => p.filter(c => c.id !== id)); setDetalhe(null); showToast("Cotação removida."); }
    catch (e) { showToast("Erro ao excluir.", "erro"); }
  }
  async function fazerLogout() { await signOut(auth); }

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#64748b" }}>
      <div style={{ width: 48, height: 48, background: "#0f172a", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "#38bdf8" }}>❄</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>Verificando sessão...</div>
    </div>
  );
  if (!authUser) return <TelaLogin />;
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#64748b" }}>
      <div style={{ width: 38, height: 38, background: "#0f172a", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#38bdf8" }}>❄</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>Carregando...</div>
    </div>
  );

  const abas = [
    ["cotacoes", "Cotações"],
    ["itens", "Itens Previstos"],
    ...(usuario?.papel === "admin" ? [["contratos", "Contratos"], ["usuarios", "Usuários"]] : usuario?.papel === "fiscal" ? [["contratos", "Contratos"]] : [])
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#0f172a" }}>
      {/* Topbar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 24px", display: "flex", alignItems: "center", height: 58, gap: 14, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, background: "#0f172a", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#38bdf8" }}>❄</div>
          <div><div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -.3 }}>CotaFacil SMP</div><div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: .5 }}>SISTEMA DE COTAÇÕES</div></div>
        </div>
        <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
          {abas.map(([v, l]) => (
            <button key={v} onClick={() => setAba(v)} style={{ background: aba === v ? "#f1f5f9" : "none", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: aba === v ? 600 : 400, color: aba === v ? "#0f172a" : "#64748b", cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {aba === "cotacoes" && <input placeholder="Buscar material, código..." value={busca} onChange={ev => setBusca(ev.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 14px", fontSize: 13, width: 230, background: "#f8fafc", outline: "none" }} />}
        {aba === "cotacoes" && podeEditar && (
          <button onClick={abrirNova} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nova cotação
          </button>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, borderLeft: "1px solid #e2e8f0", paddingLeft: 14 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{usuario?.nome || usuario?.email}</div>
            <div style={{ marginTop: 2 }}><RoleBadge papel={usuario?.papel} /></div>
          </div>
          <button onClick={fazerLogout} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: "#64748b", cursor: "pointer" }}>Sair</button>
        </div>
      </div>

      {aba === "usuarios" && usuario?.papel === "admin" && <PainelUsuarios showToast={showToast} />}
      {aba === "contratos" && (usuario?.papel === "admin" || usuario?.papel === "fiscal") && <PainelContratos showToast={showToast} />}
      {aba === "itens" && <PainelItensPrevistos contratosAcessiveis={contratosAcessiveis} setContratos={setContratos} showToast={showToast} usuario={usuario} />}

      {aba === "cotacoes" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 20px" }}>
          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
            {[{ l: "Total", v: stats.total, c: "#0f172a", bg: "#f8fafc", br: "#e2e8f0", f: "todos" }, { l: "Vigentes", v: stats.vigente, c: "#16a34a", bg: "#f0fdf4", br: "#86efac", f: "vigente" }, { l: "A vencer", v: stats.avencer, c: "#b45309", bg: "#fffbeb", br: "#fcd34d", f: "avencer" }, { l: "Vencidas", v: stats.vencida, c: "#dc2626", bg: "#fef2f2", br: "#fca5a5", f: "vencida" }].map(s =>
              <div key={s.l} onClick={() => setFiltroStatus(s.f)} style={{ background: s.bg, border: `1px solid ${s.br}`, borderRadius: 12, padding: "14px 18px", cursor: "pointer" }}>
                <div style={{ fontSize: 11, color: s.c, fontWeight: 600, letterSpacing: .5, marginBottom: 2 }}>{s.l.toUpperCase()}</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: s.c, lineHeight: 1 }}>{s.v}</div>
              </div>
            )}
          </div>

          {/* Filtros */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            {[["todos", "Todos"], ["vigente", "Vigentes"], ["avencer", "A vencer"], ["vencida", "Vencidas"]].map(([s, l]) =>
              <button key={s} onClick={() => setFiltroStatus(s)} style={{ border: `1px solid ${filtroStatus === s ? "#0f172a" : "#e2e8f0"}`, background: filtroStatus === s ? "#0f172a" : "#fff", color: filtroStatus === s ? "#fff" : "#64748b", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>{l}</button>
            )}
            {contratosAcessiveis.length > 0 && (
              <select value={filtroContrato} onChange={ev => setFiltroContrato(ev.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 12px", fontSize: 12, background: "#fff", color: "#475569", cursor: "pointer" }}>
                <option value="todos">Todos os contratos</option>
                {contratosAcessiveis.map(c => <option key={c.id} value={c.id}>{c.numero}</option>)}
              </select>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {[["lista", "⊟ Lista"], ["cards", "⊞ Cards"]].map(([v, l]) =>
                <button key={v} onClick={() => setView(v)} style={{ border: `1px solid ${view === v ? "#0f172a" : "#e2e8f0"}`, background: view === v ? "#0f172a" : "#fff", color: view === v ? "#fff" : "#64748b", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>{l}</button>
              )}
            </div>
          </div>

          {filtradas.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Nenhuma cotação encontrada.</div>}

          {/* Grupos por contrato */}
          {Object.entries(cotacoesAgrupadas).map(([cid, lista]) => {
            const ctr = contratos.find(x => x.id === cid);
            return (
              <div key={cid} style={{ marginBottom: 32 }}>
                <div style={{ borderBottom: "2px solid #e2e8f0", paddingBottom: 8, marginBottom: 16, display: "flex", alignItems: "baseline", gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 15, color: "#0f172a", fontWeight: 700 }}>
                    {ctr ? `${ctr.numero} — ${ctr.contratadaRazaoSocial || ctr.contratanteNome || ""}` : "Cotações sem contrato"}
                  </h3>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>{lista.length} item{lista.length !== 1 ? "s" : ""}</span>
                </div>

                {view === "lista" && (
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        {["Código", "Material", "Modo", "Menor valor", "Valor final", "Vencimento", "Status", ...(podeEditar ? [""] : [])].map(h =>
                          <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", letterSpacing: .4, whiteSpace: "nowrap" }}>{h}</th>
                        )}
                      </tr></thead>
                      <tbody>
                        {lista.map((c, i) => (
                          <tr key={c.id} onClick={() => setDetalhe(c)} style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: i % 2 === 0 ? "#fff" : "#fafafa" }}
                            onMouseEnter={ev => ev.currentTarget.style.background = "#f0f9ff"}
                            onMouseLeave={ev => ev.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#fafafa"}>
                            <td style={{ padding: "11px 14px", color: "#64748b", fontFamily: "monospace", fontSize: 11 }}>{c.codigo}</td>
                            <td style={{ padding: "11px 14px", fontWeight: 500 }}>{c.material}</td>
                            <td style={{ padding: "11px 14px", fontSize: 11 }}>{c.precoDireto ? <span style={{ color: "#b45309", fontWeight: 600 }}>Direto</span> : <span style={{ color: "#0369a1" }}>Calculado</span>}</td>
                            <td style={{ padding: "11px 14px", fontWeight: 600 }}>R$ {brl(c.menorValor || c.mediaAritmetica)}</td>
                            <td style={{ padding: "11px 14px", color: "#0369a1", fontWeight: 700 }}>R$ {brl(c.precoFinalDesconto)}</td>
                            <td style={{ padding: "11px 14px", color: "#64748b", fontSize: 12 }}>{fmtVenc(c.dataElaboracao)}</td>
                            <td style={{ padding: "11px 14px" }}><StatusBadge status={c.status} /></td>
                            {podeEditar && <td style={{ padding: "11px 14px" }}><button onClick={ev => { ev.stopPropagation(); abrirEditar(c); }} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#475569", cursor: "pointer" }}>Editar</button></td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {view === "cards" && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(255px,1fr))", gap: 14 }}>
                    {lista.map(c => {
                      const dias = diasRest(c.dataElaboracao);
                      return (
                        <div key={c.id} onClick={() => setDetalhe(c)} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", cursor: "pointer", position: "relative" }}
                          onMouseEnter={ev => ev.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,.08)"}
                          onMouseLeave={ev => ev.currentTarget.style.boxShadow = "none"}>
                          {c.precoDireto && <div style={{ position: "absolute", top: 10, right: 10, background: "#b45309", color: "#fff", fontSize: 9, fontWeight: "bold", padding: "2px 7px", borderRadius: 10 }}>DIRETO</div>}
                          <div style={{ height: 80, background: c.imagem ? `url(${c.imagem}) center/cover` : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>{c.imagem ? null : "📦"}</div>
                          <div style={{ padding: "12px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                              <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{c.codigo}</div>
                              <StatusBadge status={c.status} />
                            </div>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, lineHeight: 1.3 }}>{c.material}</div>
                            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>
                              <div><div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>MENOR VALOR</div><div style={{ fontSize: 14, fontWeight: 700 }}>R$ {brl(c.menorValor || c.mediaAritmetica)}</div></div>
                              <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>VALOR FINAL</div><div style={{ fontSize: 14, fontWeight: 700, color: "#0369a1" }}>R$ {brl(c.precoFinalDesconto)}</div></div>
                            </div>
                            {dias !== null && <div style={{ marginTop: 6, fontSize: 11, color: dias < 0 ? "#dc2626" : dias <= 30 ? "#b45309" : "#16a34a" }}>{dias < 0 ? `Vencida há ${Math.abs(dias)} dias` : dias === 0 ? "Vence hoje" : `Vence em ${dias} dias`}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal detalhe cotação */}
      {detalhe && (() => {
        const c = cotacoes.find(x => x.id === detalhe.id) || detalhe;
        const ctr = contratos.find(x => x.id === c.contratoId);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setDetalhe(null)}>
            <div onClick={ev => ev.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 620, maxHeight: "91vh", overflowY: "auto", padding: 26 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginBottom: 4 }}>{c.codigo}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{c.material}</div>
                  {ctr && <div style={{ fontSize: 12, color: "#0369a1", marginTop: 4, fontWeight: 500 }}>{ctr.numero} — {ctr.contratanteNome || ctr.contratadaRazaoSocial}</div>}
                </div>
                <StatusBadge status={c.status} size="lg" />
              </div>
              {c.imagem && <img src={c.imagem} style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 10, marginBottom: 14 }} />}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {(c.precoDireto ? [
                  { l: "Valor final (inserido diretamente)", v: "R$ " + brl(c.precoFinalDesconto), dest: true },
                  { l: "Data elaboração", v: c.dataElaboracao ? new Date(c.dataElaboracao + "T12:00:00").toLocaleDateString("pt-BR") : "—" },
                  { l: "Vencimento", v: fmtVenc(c.dataElaboracao) },
                  { l: "Quantidade", v: c.quantidade + " " + c.unidade },
                  { l: "Total referência", v: "R$ " + brl(arred((c.precoFinalDesconto || 0) * (parseFloat(c.quantidade) || 1))) },
                ] : [
                  { l: "Média aritmética", v: "R$ " + brl(c.mediaAritmetica) },
                  { l: "Menor valor (base)", v: "R$ " + brl(c.menorValor) },
                  { l: `C/ BDI (${c.bdi || 0}%)`, v: "R$ " + brl(c.precoFinalBDI) },
                  { l: `Valor final (desc. ${c.desconto || 0}%)`, v: "R$ " + brl(c.precoFinalDesconto), dest: true },
                  { l: "Data elaboração", v: c.dataElaboracao ? new Date(c.dataElaboracao + "T12:00:00").toLocaleDateString("pt-BR") : "—" },
                  { l: "Vencimento", v: fmtVenc(c.dataElaboracao) },
                  { l: "Quantidade", v: c.quantidade + " " + c.unidade },
                  { l: "Total referência", v: "R$ " + brl(arred((c.precoFinalDesconto || 0) * (parseFloat(c.quantidade) || 1))) },
                ]).map(it =>
                  <div key={it.l} style={{ background: it.dest ? "#eff6ff" : "#f8fafc", borderRadius: 10, padding: "10px 14px", border: it.dest ? "1px solid #bfdbfe" : "none" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, marginBottom: 2 }}>{it.l}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: it.dest ? "#1d4ed8" : "#0f172a" }}>{it.v}</div>
                  </div>
                )}
              </div>

              {!c.precoDireto && (c.fornecedores || []).filter(f => parseFloat(f.valor) > 0).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8, letterSpacing: .4 }}>PESQUISA DE PREÇOS</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f8fafc" }}>{["Fonte", "Valor (R$)", "Variação s/ média"].map(h => <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
                    <tbody>{(c.fornecedores || []).filter(f => parseFloat(f.valor) > 0).map((f, i) =>
                      <tr key={i} style={{ background: parseFloat(f.valor) === c.menorValor ? "#f0fdf4" : "#fff", borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "7px 10px", fontWeight: 500 }}>
                          <span style={{color:"#0369a1", fontWeight:600}}>{f.fonte}</span> {f.nome ? `— ${f.nome}` : ""}
                          {parseFloat(f.valor) === c.menorValor && <span style={{ marginLeft: 6, background: "#dcfce7", color: "#16a34a", borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>BASE</span>}
                        </td>
                        <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>R$ {brl(f.valor)}</td>
                        <td style={{ padding: "7px 10px", color: Math.abs(f.variacao || 0) > 0.15 ? "#b45309" : "#475569", fontWeight: 600 }}>{f.variacao != null ? pct(f.variacao) : "—"}</td>
                      </tr>
                    )}</tbody>
                  </table>
                </div>
              )}
              {c.observacoes && <div style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#475569", marginBottom: 14 }}><span style={{ fontWeight: 600 }}>Obs.: </span>{c.observacoes}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                {usuario?.papel === "admin" && <button onClick={() => excluirCot(c.id)} style={{ border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>Excluir</button>}
                {podeEditar && <button onClick={() => abrirEditar(c)} style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>Editar</button>}
                <button onClick={() => setDetalhe(null)} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Fechar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {modalForm && <FormModalCotacao editId={editId} initialForm={formInicial} contratos={contratosAcessiveis} cotacoes={cotacoes} onSave={salvar} onClose={() => setModalForm(false)} />}
      {toast && <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 300, background: toast.tipo === "erro" ? "#fef2f2" : "#f0fdf4", border: `1px solid ${toast.tipo === "erro" ? "#fca5a5" : "#86efac"}`, color: toast.tipo === "erro" ? "#dc2626" : "#16a34a", borderRadius: 10, padding: "12px 18px", fontSize: 13, fontWeight: 500, boxShadow: "0 4px 16px rgba(0,0,0,.1)" }}>{toast.msg}</div>}
    </div>
  );
}
