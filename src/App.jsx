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
const CATEGORIAS = ["Fixação","Lubrificação","Tubulação","Elétrico","Refrigeração","Gás","Outro"];
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

// Perfis de usuário — Gerente renomeado para Fiscal
const PAPEIS = {
  admin:     { label:"Admin",     bg:"#fef3c7", color:"#92400e", border:"#fcd34d" },
  fiscal:    { label:"Fiscal",    bg:"#dbeafe", color:"#1e40af", border:"#93c5fd" },
  consultor: { label:"Consultor", bg:"#f1f5f9", color:"#475569", border:"#cbd5e1" },
};

// ── Cálculos ──────────────────────────────────────────────────────────────
function arredCima(n, dec = 2) { return Math.ceil(n * 10 ** dec) / 10 ** dec; }
function sanear(fornecedores) {
  const todos = fornecedores.map(f => parseFloat(f.valor)).filter(v => !isNaN(v) && v > 0);
  if (!todos.length) return { mediaGeral:0, mediaSaneada:0, menorSaneado:0, forn:fornecedores.map(f=>({...f,autoExcluido:false,variacao:null})) };
  const mediaGeral = arredCima(todos.reduce((a,b)=>a+b,0)/todos.length);
  const forn = fornecedores.map(f => {
    const v = parseFloat(f.valor);
    if (isNaN(v)||v<=0) return {...f,autoExcluido:false,variacao:null};
    const variacao = (v/mediaGeral)-1;
    return {...f,autoExcluido:variacao>0.30||variacao<-0.30,variacao};
  });
  const aceitos = forn.filter(f=>!f.autoExcluido&&parseFloat(f.valor)>0).map(f=>parseFloat(f.valor));
  const mediaSaneada = aceitos.length ? arredCima(aceitos.reduce((a,b)=>a+b,0)/aceitos.length) : 0;
  const menorSaneado = aceitos.length ? Math.min(...aceitos) : 0;
  return { mediaGeral, mediaSaneada, menorSaneado, forn };
}
function calcBDI(mediaSaneada, bdi, desconto) {
  const b=parseFloat(bdi)||0, d=parseFloat(desconto)||0;
  return { comBDI: mediaSaneada*(1+b/100), final: mediaSaneada*(1+b/100)*(1-d/100) };
}
function enriquecer(c) {
  const {mediaGeral,mediaSaneada,menorSaneado,forn} = sanear(c.fornecedores||[]);
  const {comBDI,final} = calcBDI(mediaSaneada,c.bdi,c.desconto);
  return {...c,fornecedores:forn,mediaGeral,mediaSaneada,menorSaneado,precoFinalBDI:comBDI,precoFinalDesconto:final,status:calcStatusCot(c.dataElaboracao)};
}
function calcStatusCot(dt) {
  if (!dt) return "vencida";
  const v = new Date(dt+"T12:00:00"); v.setFullYear(v.getFullYear()+1);
  const d = Math.ceil((v-new Date())/864e5);
  return d<0?"vencida":d<=30?"avencer":"vigente";
}
const fmtVenc = dt => { if(!dt)return"—"; const v=new Date(dt+"T12:00:00"); v.setFullYear(v.getFullYear()+1); return v.toLocaleDateString("pt-BR"); };
const diasRest = dt => { if(!dt)return null; const v=new Date(dt+"T12:00:00"); v.setFullYear(v.getFullYear()+1); return Math.ceil((v-new Date())/864e5); };
const brl = n => Number(n||0).toLocaleString("pt-BR",{minimumFractionDigits:2});
const pct = n => (n>=0?"+":"") + ((n||0)*100).toFixed(2)+"%";
const fmtData = dt => dt ? new Date(dt+"T12:00:00").toLocaleDateString("pt-BR") : "—";

// ── Dados de exemplo ──────────────────────────────────────────────────────
const DADOS_COTACOES = [
  {id:1,material:"Porca Sextavada 8mm Inox 304",codigo:"MAT-001",categoria:"Fixação",unidade:"UNID.",contratoId:"contrato-exemplo",dataBase:"Nov/2024",dataElaboracao:"2024-11-15",bdi:17.32,desconto:2.0,quantidade:100,observacoes:"Inox passivado 304",imagem:null,fornecedores:[{nome:"Parafuso Fácil",url:"",valor:0.85},{nome:"Jofepar",url:"",valor:0.82},{nome:"Lojas Mixpar",url:"",valor:0.91}]},
  {id:2,material:"Válvula Termostática Danfoss R22 – 12TR",codigo:"MAT-010",categoria:"Refrigeração",unidade:"UNID.",contratoId:"contrato-exemplo",dataBase:"Nov/2024",dataElaboracao:"2024-11-15",bdi:17.32,desconto:2.0,quantidade:1,observacoes:"Modelo 067N2009",imagem:null,fornecedores:[{nome:"Chiller Peças",url:"",valor:1031.11},{nome:"Jet Frio",url:"",valor:1008.99},{nome:"Cibrel",url:"",valor:1375.53}]},
  {id:3,material:"Graxa Azul FAG 500g",codigo:"MAT-005",categoria:"Lubrificação",unidade:"UNID.",contratoId:"contrato-exemplo",dataBase:"Nov/2024",dataElaboracao:"2024-02-10",bdi:17.32,desconto:2.0,quantidade:1,observacoes:"Para rolamentos",imagem:null,fornecedores:[{nome:"C3 Multimarcas",url:"",valor:81.18},{nome:"Loja Proelis",url:"",valor:85.49},{nome:"Disk Peças",url:"",valor:90.45}]},
];

const emptyFormCotacao = {material:"",codigo:"",categoria:"Refrigeração",unidade:"UNID.",contratoId:"",dataBase:"",dataElaboracao:"",bdi:17.32,desconto:2.0,quantidade:1,observacoes:"",imagem:null,fornecedores:[{nome:"",url:"",valor:""}]};

const emptyFormContrato = {
  numero:"",processoSEI:"",objeto:"",statusContrato:"ativo",
  contratanteNome:"",contratanteCNPJ:"",contratanteRepresentante:"",contratanteCargo:"",
  contratadaRazaoSocial:"",contratadaCNPJ:"",contratadaEndereco:"",contratadaTelefone:"",contratadaEmail:"",contratadaRepresentante:"",
  dataInicio:"",dataTermino:"",prazoMeses:"",prorrogavel:"sim",limiteProrrogacao:"",
  valorMensal:"",valorTotal:"",regimeExecucao:"",indiceReajuste:"IPCA",
  fiscal:"",observacoes:""
};

// ── Badges ────────────────────────────────────────────────────────────────
function StatusBadge({status,size}) {
  const s=SV[status]||SV.vencida;
  return <span style={{background:s.bg,color:s.color,border:`1px solid ${s.border}`,borderRadius:20,padding:size==="lg"?"4px 14px":"2px 10px",fontSize:size==="lg"?13:11,fontWeight:600,display:"inline-block",whiteSpace:"nowrap"}}>{s.label}</span>;
}
function CatBadge({cat}) {
  return <span style={{background:"#f1f5f9",color:"#475569",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:500}}>{cat}</span>;
}
function RoleBadge({papel}) {
  const s=PAPEIS[papel]||PAPEIS.consultor;
  return <span style={{background:s.bg,color:s.color,border:`1px solid ${s.border}`,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>{s.label}</span>;
}
function StatusContratoBadge({status}) {
  const s=STATUS_CONTRATO[status]||STATUS_CONTRATO.ativo;
  return <span style={{background:s.bg,color:s.color,border:`1px solid ${s.border}`,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>{s.label}</span>;
}

// ── Saneamento visual ─────────────────────────────────────────────────────
function SaneamentoPanel({fornecedores}) {
  const {mediaGeral,mediaSaneada,forn}=sanear(fornecedores);
  if (!forn.some(f=>parseFloat(f.valor)>0)) return null;
  const aceitos=forn.filter(f=>!f.autoExcluido&&parseFloat(f.valor)>0).length;
  const total=forn.filter(f=>parseFloat(f.valor)>0).length;
  return (
    <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 14px",marginTop:10}}>
      <div style={{fontSize:11,fontWeight:600,color:"#64748b",letterSpacing:.5,marginBottom:10}}>PRÉVIA DO SANEAMENTO</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
        {[{l:"Média geral",v:"R$ "+brl(mediaGeral),c:"#475569"},{l:"Média saneada",v:"R$ "+brl(mediaSaneada),c:"#0369a1"},{l:"Aceitos",v:`${aceitos} / ${total}`,c:"#16a34a"}].map(item=>
          <div key={item.l} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 10px"}}>
            <div style={{fontSize:10,color:"#94a3b8",fontWeight:500,marginBottom:2}}>{item.l}</div>
            <div style={{fontSize:14,fontWeight:700,color:item.c}}>{item.v}</div>
          </div>
        )}
      </div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{background:"#f1f5f9"}}>{["Fonte","Valor","Variação","Status"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:"left",fontSize:11,fontWeight:600,color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>{h}</th>)}</tr></thead>
        <tbody>{forn.filter(f=>parseFloat(f.valor)>0).map((f,i)=>(
          <tr key={i} style={{background:f.autoExcluido?"#fef2f2":"#f0fdf4",borderBottom:"1px solid #f1f5f9"}}>
            <td style={{padding:"7px 10px",fontWeight:500}}>{f.nome||"—"}</td>
            <td style={{padding:"7px 10px",fontFamily:"monospace"}}>R$ {brl(f.valor)}</td>
            <td style={{padding:"7px 10px",color:f.autoExcluido?"#dc2626":Math.abs(f.variacao||0)>0.15?"#b45309":"#16a34a",fontWeight:600}}>{f.variacao!=null?pct(f.variacao):"—"}</td>
            <td style={{padding:"7px 10px"}}>{f.autoExcluido?<span style={{background:"#fee2e2",color:"#dc2626",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>EXCLUÍDO</span>:<span style={{background:"#dcfce7",color:"#16a34a",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>ACEITO</span>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ── Modal de cotação ──────────────────────────────────────────────────────
// Contrato agora é obrigatório — sem contrato não salva
function FormModalCotacao({editId,initialForm,contratos,onSave,onClose}) {
  const [form,setForm]=useState(initialForm);
  const [erroContrato,setErroContrato]=useState(false);
  const calc=useMemo(()=>{const{mediaSaneada}=sanear(form.fornecedores);const{comBDI,final}=calcBDI(mediaSaneada,form.bdi,form.desconto);return{mediaSaneada,comBDI,final};},[form.fornecedores,form.bdi,form.desconto]);
  function updForn(i,k,v){setForm(f=>({...f,fornecedores:f.fornecedores.map((fo,idx)=>idx===i?{...fo,[k]:v}:fo)}));}
  function handleImg(ev){const file=ev.target.files[0];if(!file)return;const r=new FileReader();r.onload=x=>setForm(f=>({...f,imagem:x.target.result}));r.readAsDataURL(file);}
  const lbl=(txt,hint,req)=><label style={{fontSize:12,fontWeight:500,color:"#64748b",display:"block",marginBottom:3}}>{txt}{req&&<span style={{color:"#dc2626",marginLeft:2}}>*</span>}{hint&&<span style={{fontSize:10,color:"#94a3b8",marginLeft:5}}>{hint}</span>}</label>;

  function handleSave() {
    if (!form.contratoId) { setErroContrato(true); return; }
    setErroContrato(false);
    onSave({...form, mediaSaneada:calc.mediaSaneada, precoFinalBDI:calc.comBDI, precoFinalDesconto:calc.final});
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={ev=>ev.stopPropagation()} style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:700,maxHeight:"94vh",overflowY:"auto",padding:26}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:20}}>{editId?"Editar cotação":"Nova cotação"}</div>

        <div style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:.6,marginBottom:10}}>IDENTIFICAÇÃO</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
          <div style={{gridColumn:"1/-1"}}>{lbl("Material / Descrição","",true)}<input value={form.material} onChange={ev=>setForm(p=>({...p,material:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}/></div>
          <div>{lbl("Código")}<input value={form.codigo||""} onChange={ev=>setForm(p=>({...p,codigo:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}/></div>
          <div>{lbl("Categoria")}<select value={form.categoria} onChange={ev=>setForm(p=>({...p,categoria:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}>{CATEGORIAS.map(c=><option key={c}>{c}</option>)}</select></div>
          <div>{lbl("Unidade")}<input value={form.unidade||""} onChange={ev=>setForm(p=>({...p,unidade:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}/></div>

          {/* Contrato — campo obrigatório com destaque visual */}
          <div style={{gridColumn:"1/-1"}}>
            {lbl("Contrato vinculado","",true)}
            <select
              value={form.contratoId||""}
              onChange={ev=>{setForm(p=>({...p,contratoId:ev.target.value}));setErroContrato(false);}}
              style={{width:"100%",border:`1px solid ${erroContrato?"#dc2626":"#e2e8f0"}`,borderRadius:8,padding:"8px 12px",fontSize:13,background:erroContrato?"#fef2f2":"#fff"}}>
              <option value="">— Selecione o contrato —</option>
              {contratos.map(c=><option key={c.id} value={c.id}>{c.numero} — {c.contratanteNome||c.contratadaRazaoSocial||""}</option>)}
            </select>
            {erroContrato&&<div style={{fontSize:11,color:"#dc2626",marginTop:4}}>⚠ Toda cotação deve estar vinculada a um contrato.</div>}
            {contratos.length===0&&<div style={{fontSize:11,color:"#b45309",marginTop:4}}>Nenhum contrato cadastrado. Cadastre um contrato antes de criar cotações.</div>}
          </div>

          <div>{lbl("Data base")}<input value={form.dataBase||""} onChange={ev=>setForm(p=>({...p,dataBase:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}/></div>
          <div>{lbl("Data de elaboração","",true)}<input type="date" value={form.dataElaboracao||""} onChange={ev=>setForm(p=>({...p,dataElaboracao:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}/></div>
          <div>{lbl("Quantidade")}<input type="number" value={form.quantidade||""} onChange={ev=>setForm(p=>({...p,quantidade:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}/></div>
        </div>

        <div style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:.6,marginBottom:10}}>FONTES DE PESQUISA DE PREÇOS</div>
        <div style={{background:"#f8fafc",borderRadius:10,padding:"14px",marginBottom:4}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 110px 28px",gap:6,marginBottom:6}}>{["Fornecedor / Fonte","URL (opcional)","Valor (R$)",""].map(h=><div key={h} style={{fontSize:10,color:"#94a3b8",fontWeight:600,padding:"0 2px"}}>{h}</div>)}</div>
          {form.fornecedores.map((f,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 110px 28px",gap:6,marginBottom:6,alignItems:"center"}}>
              <input placeholder="Ex: Jofepar, SINAPI 39751" value={f.nome} onChange={ev=>updForn(i,"nome",ev.target.value)} style={{border:"1px solid #e2e8f0",borderRadius:7,padding:"7px 10px",fontSize:12}}/>
              <input placeholder="https://..." value={f.url||""} onChange={ev=>updForn(i,"url",ev.target.value)} style={{border:"1px solid #e2e8f0",borderRadius:7,padding:"7px 10px",fontSize:12}}/>
              <input type="number" step="0.01" min="0" placeholder="0,00" value={f.valor} onChange={ev=>updForn(i,"valor",ev.target.value)} style={{border:"1px solid #e2e8f0",borderRadius:7,padding:"7px 10px",fontSize:12}}/>
              <button onClick={()=>setForm(f=>({...f,fornecedores:f.fornecedores.filter((_,idx)=>idx!==i)}))} style={{background:"none",border:"none",color:"#dc2626",fontSize:20,lineHeight:1,cursor:"pointer"}}>×</button>
            </div>
          ))}
          <button onClick={()=>setForm(f=>({...f,fornecedores:[...f.fornecedores,{nome:"",url:"",valor:""}]}))} style={{marginTop:4,fontSize:12,border:"1px dashed #cbd5e1",borderRadius:7,padding:"6px 14px",background:"#fff",color:"#64748b",width:"100%",cursor:"pointer"}}>+ Adicionar fonte</button>
        </div>
        <SaneamentoPanel fornecedores={form.fornecedores}/>

        <div style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:.6,margin:"20px 0 10px"}}>PARÂMETROS DE CÁLCULO</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div>{lbl("BDI (%)")}<input type="number" step="0.01" value={form.bdi||""} onChange={ev=>setForm(p=>({...p,bdi:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}/></div>
          <div>{lbl("Desconto licitação (%)")}<input type="number" step="0.01" value={form.desconto||""} onChange={ev=>setForm(p=>({...p,desconto:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}/></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
          <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 14px"}}><div style={{fontSize:10,color:"#94a3b8",fontWeight:600,marginBottom:4}}>MÉDIA SANEADA</div><div style={{fontSize:17,fontWeight:800,color:"#0f172a"}}>R$ {brl(calc.mediaSaneada)}</div></div>
          <div style={{background:"#dbeafe",border:"1px solid #93c5fd",borderRadius:10,padding:"12px 14px"}}><div style={{fontSize:10,color:"#1e40af",fontWeight:600,marginBottom:4}}>VALOR C/ BDI ({form.bdi||0}%)</div><div style={{fontSize:17,fontWeight:800,color:"#1d4ed8"}}>R$ {brl(calc.comBDI)}</div></div>
          <div style={{background:"#dcfce7",border:"1px solid #86efac",borderRadius:10,padding:"12px 14px"}}><div style={{fontSize:10,color:"#166534",fontWeight:600,marginBottom:4}}>VALOR FINAL ({form.desconto||0}% desc.)</div><div style={{fontSize:17,fontWeight:800,color:"#16a34a"}}>R$ {brl(calc.final)}</div></div>
        </div>

        <div style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:.6,marginBottom:10}}>EXTRAS</div>
        <div style={{display:"grid",gap:12,marginBottom:20}}>
          <div>{lbl("Observações")}<textarea value={form.observacoes||""} onChange={ev=>setForm(p=>({...p,observacoes:ev.target.value}))} rows={2} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13,resize:"vertical"}}/></div>
          <div>{lbl("Imagem do material")}<input type="file" accept="image/*" onChange={handleImg} style={{fontSize:13}}/>{form.imagem&&<img src={form.imagem} style={{marginTop:8,height:72,borderRadius:8,objectFit:"cover"}}/>}</div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",paddingTop:16,borderTop:"1px solid #f1f5f9"}}>
          <button onClick={onClose} style={{border:"1px solid #e2e8f0",background:"#fff",borderRadius:8,padding:"9px 18px",fontSize:13,cursor:"pointer"}}>Cancelar</button>
          <button onClick={handleSave} style={{background:"#0f172a",color:"#fff",border:"none",borderRadius:8,padding:"9px 22px",fontSize:13,fontWeight:600,cursor:"pointer"}}>{editId?"Salvar alterações":"Cadastrar cotação"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Modal de Contrato ─────────────────────────────────────────────────────
function FormModalContrato({editId,initialForm,onSave,onClose}) {
  const [form,setForm]=useState(initialForm);
  const lbl=txt=><label style={{fontSize:12,fontWeight:500,color:"#64748b",display:"block",marginBottom:3}}>{txt}</label>;
  const inp=(label,key,type="text")=>(
    <div key={key}>
      {lbl(label)}
      <input type={type} value={form[key]||""} onChange={ev=>setForm(p=>({...p,[key]:ev.target.value}))}
        style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13,boxSizing:"border-box"}}/>
    </div>
  );
  const sec=txt=><div style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:.6,margin:"20px 0 10px",gridColumn:"1/-1"}}>{txt}</div>;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={ev=>ev.stopPropagation()} style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:760,maxHeight:"95vh",overflowY:"auto",padding:28}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>{editId?"Editar contrato":"Novo contrato"}</div>
        <div style={{fontSize:12,color:"#94a3b8",marginBottom:20}}>Campos com * são obrigatórios.</div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          {sec("IDENTIFICAÇÃO")}
          {inp("Número do contrato *","numero")}
          {inp("Nº do Processo SEI","processoSEI")}
          <div style={{gridColumn:"1/-1"}}>{lbl("Objeto (descrição do serviço) *")}<textarea value={form.objeto||""} onChange={ev=>setForm(p=>({...p,objeto:ev.target.value}))} rows={2} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13,resize:"vertical"}}/></div>
          <div>{lbl("Status do contrato")}<select value={form.statusContrato||"ativo"} onChange={ev=>setForm(p=>({...p,statusContrato:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}>
            <option value="ativo">Ativo</option><option value="encerrado">Encerrado</option><option value="suspenso">Suspenso</option>
          </select></div>

          {sec("CONTRATANTE (ÓRGÃO)")}
          {inp("Nome do órgão *","contratanteNome")}
          {inp("CNPJ","contratanteCNPJ")}
          {inp("Representante legal","contratanteRepresentante")}
          {inp("Cargo do representante","contratanteCargo")}

          {sec("CONTRATADA (EMPRESA EXECUTORA)")}
          {inp("Razão social *","contratadaRazaoSocial")}
          {inp("CNPJ","contratadaCNPJ")}
          <div style={{gridColumn:"1/-1"}}>{lbl("Endereço")}<input value={form.contratadaEndereco||""} onChange={ev=>setForm(p=>({...p,contratadaEndereco:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13,boxSizing:"border-box"}}/></div>
          {inp("Telefone","contratadaTelefone")}
          {inp("E-mail","contratadaEmail","email")}
          {inp("Representante legal","contratadaRepresentante")}

          {sec("VIGÊNCIA")}
          {inp("Data de início *","dataInicio","date")}
          {inp("Data de término *","dataTermino","date")}
          {inp("Prazo (meses)","prazoMeses","number")}
          <div>{lbl("Prorrogável")}<select value={form.prorrogavel||"sim"} onChange={ev=>setForm(p=>({...p,prorrogavel:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}>
            <option value="sim">Sim</option><option value="nao">Não</option>
          </select></div>
          {form.prorrogavel==="sim"&&inp("Limite de prorrogação (meses)","limiteProrrogacao","number")}

          {sec("VALORES")}
          {inp("Valor mensal estimado (R$)","valorMensal","number")}
          {inp("Valor total (R$)","valorTotal","number")}
          <div>{lbl("Regime de execução")}<select value={form.regimeExecucao||""} onChange={ev=>setForm(p=>({...p,regimeExecucao:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}>
            <option value="">— Selecione —</option>
            <option value="Empreitada por preço global">Empreitada por preço global</option>
            <option value="Empreitada por preço unitário">Empreitada por preço unitário</option>
            <option value="Misto (global + unitário)">Misto (global + unitário)</option>
            <option value="Tarefa">Tarefa</option>
          </select></div>
          <div>{lbl("Índice de reajuste")}<select value={form.indiceReajuste||"IPCA"} onChange={ev=>setForm(p=>({...p,indiceReajuste:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13}}>
            <option value="IPCA">IPCA</option><option value="IGPM">IGP-M</option><option value="INCC">INCC</option><option value="Outro">Outro</option>
          </select></div>

          {sec("GESTÃO")}
          {inp("Fiscal do contrato","fiscal")}
          <div style={{gridColumn:"1/-1"}}>{lbl("Observações")}<textarea value={form.observacoes||""} onChange={ev=>setForm(p=>({...p,observacoes:ev.target.value}))} rows={2} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:13,resize:"vertical"}}/></div>
        </div>

        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:24,paddingTop:16,borderTop:"1px solid #f1f5f9"}}>
          <button onClick={onClose} style={{border:"1px solid #e2e8f0",background:"#fff",borderRadius:8,padding:"9px 18px",fontSize:13,cursor:"pointer"}}>Cancelar</button>
          <button onClick={()=>onSave(form)} style={{background:"#0f172a",color:"#fff",border:"none",borderRadius:8,padding:"9px 22px",fontSize:13,fontWeight:600,cursor:"pointer"}}>{editId?"Salvar alterações":"Cadastrar contrato"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Painel de Contratos ───────────────────────────────────────────────────
function PainelContratos({showToast}) {
  const [contratos,setContratos]=useState([]);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(false);
  const [editando,setEditando]=useState(null);
  const [detalhe,setDetalhe]=useState(null);

  useEffect(()=>{carregar();},[]);
  async function carregar(){
    setLoading(true);
    try { const snap=await getDocs(collection(db,"contratos")); setContratos(snap.docs.map(d=>({id:d.id,...d.data()}))); }
    catch(e){ showToast("Erro ao carregar contratos.","erro"); }
    finally{ setLoading(false); }
  }
  function abrirNovo(){ setEditando(null); setModal(true); }
  function abrirEditar(c){ setEditando(c); setModal(true); setDetalhe(null); }

  async function salvar(form){
    if(!form.numero||!form.objeto){ showToast("Preencha número e objeto.","erro"); return; }
    try {
      if(editando){
        const atualizado={...editando,...form};
        await setDoc(doc(db,"contratos",editando.id),atualizado);
        setContratos(p=>p.map(c=>c.id===editando.id?atualizado:c));
        showToast("Contrato atualizado.");
      } else {
        const id="contrato-"+Date.now();
        const novo={...form,id,criadoEm:new Date().toISOString()};
        await setDoc(doc(db,"contratos",id),novo);
        setContratos(p=>[...p,novo]);
        showToast("Contrato cadastrado.");
      }
      setModal(false);
    } catch(e){ showToast("Erro ao salvar contrato.","erro"); }
  }

  async function excluir(id){
    if(!window.confirm("Excluir este contrato? As cotações vinculadas não serão excluídas.")) return;
    try{ await deleteDoc(doc(db,"contratos",id)); setContratos(p=>p.filter(c=>c.id!==id)); setDetalhe(null); showToast("Contrato removido."); }
    catch(e){ showToast("Erro ao excluir.","erro"); }
  }

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"28px 20px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <div>
          <div style={{fontSize:18,fontWeight:700}}>Contratos</div>
          <div style={{fontSize:13,color:"#94a3b8",marginTop:2}}>{contratos.length} {contratos.length===1?"contrato":"contratos"} cadastrados</div>
        </div>
        <button onClick={abrirNovo} style={{background:"#0f172a",color:"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:16}}>+</span> Novo contrato
        </button>
      </div>

      {loading?<div style={{padding:40,textAlign:"center",color:"#94a3b8"}}>Carregando...</div>:(
        <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
              {["Número","Contratada","Objeto","Vigência","Valor total","Status",""].map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:600,color:"#64748b",letterSpacing:.4,whiteSpace:"nowrap"}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {contratos.map((c,i)=>(
                <tr key={c.id} onClick={()=>setDetalhe(c)} style={{borderBottom:"1px solid #f1f5f9",cursor:"pointer",background:i%2===0?"#fff":"#fafafa"}}
                  onMouseEnter={ev=>ev.currentTarget.style.background="#f0f9ff"}
                  onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?"#fff":"#fafafa"}>
                  <td style={{padding:"11px 14px",fontWeight:700,fontFamily:"monospace",fontSize:12}}>{c.numero||"—"}</td>
                  <td style={{padding:"11px 14px",fontWeight:500}}>{c.contratadaRazaoSocial||"—"}</td>
                  <td style={{padding:"11px 14px",color:"#475569",maxWidth:220}}><div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.objeto||"—"}</div></td>
                  <td style={{padding:"11px 14px",fontSize:12,color:"#64748b",whiteSpace:"nowrap"}}>{fmtData(c.dataInicio)} → {fmtData(c.dataTermino)}</td>
                  <td style={{padding:"11px 14px",fontWeight:600}}>R$ {brl(c.valorTotal)}</td>
                  <td style={{padding:"11px 14px"}}><StatusContratoBadge status={c.statusContrato}/></td>
                  <td style={{padding:"11px 14px"}}><button onClick={ev=>{ev.stopPropagation();abrirEditar(c);}} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:6,padding:"4px 10px",fontSize:11,color:"#475569",cursor:"pointer"}}>Editar</button></td>
                </tr>
              ))}
              {contratos.length===0&&<tr><td colSpan={7} style={{padding:40,textAlign:"center",color:"#94a3b8"}}>Nenhum contrato cadastrado ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {detalhe&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setDetalhe(null)}>
          <div onClick={ev=>ev.stopPropagation()} style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:640,maxHeight:"92vh",overflowY:"auto",padding:28}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
              <div>
                <div style={{fontSize:11,color:"#94a3b8",fontFamily:"monospace",marginBottom:4}}>{detalhe.numero} · SEI: {detalhe.processoSEI||"—"}</div>
                <div style={{fontSize:17,fontWeight:700,lineHeight:1.3,maxWidth:460}}>{detalhe.objeto||"—"}</div>
              </div>
              <StatusContratoBadge status={detalhe.statusContrato}/>
            </div>
            {[
              {titulo:"CONTRATANTE",campos:[{l:"Nome",v:detalhe.contratanteNome},{l:"CNPJ",v:detalhe.contratanteCNPJ},{l:"Representante",v:detalhe.contratanteRepresentante},{l:"Cargo",v:detalhe.contratanteCargo}]},
              {titulo:"CONTRATADA",campos:[{l:"Razão social",v:detalhe.contratadaRazaoSocial},{l:"CNPJ",v:detalhe.contratadaCNPJ},{l:"Endereço",v:detalhe.contratadaEndereco},{l:"Telefone",v:detalhe.contratadaTelefone},{l:"E-mail",v:detalhe.contratadaEmail},{l:"Representante",v:detalhe.contratadaRepresentante}]},
              {titulo:"VIGÊNCIA",campos:[{l:"Início",v:fmtData(detalhe.dataInicio)},{l:"Término",v:fmtData(detalhe.dataTermino)},{l:"Prazo",v:detalhe.prazoMeses?(detalhe.prazoMeses+" meses"):"—"},{l:"Prorrogável",v:detalhe.prorrogavel==="sim"?"Sim":"Não"},{l:"Limite prorrog.",v:detalhe.limiteProrrogacao||"—"}]},
              {titulo:"VALORES",campos:[{l:"Valor mensal",v:"R$ "+brl(detalhe.valorMensal)},{l:"Valor total",v:"R$ "+brl(detalhe.valorTotal)},{l:"Regime",v:detalhe.regimeExecucao||"—"},{l:"Índice reajuste",v:detalhe.indiceReajuste||"—"}]},
              {titulo:"GESTÃO",campos:[{l:"Fiscal",v:detalhe.fiscal||"—"},{l:"Observações",v:detalhe.observacoes||"—"}]},
            ].map(sec=>(
              <div key={sec.titulo} style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:.5,marginBottom:8}}>{sec.titulo}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {sec.campos.map(f=>(
                    <div key={f.l} style={{background:"#f8fafc",borderRadius:8,padding:"9px 12px"}}>
                      <div style={{fontSize:10,color:"#94a3b8",fontWeight:500,marginBottom:2}}>{f.l}</div>
                      <div style={{fontSize:13,fontWeight:500,color:"#0f172a"}}>{f.v||"—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
              <button onClick={()=>excluir(detalhe.id)} style={{border:"1px solid #fca5a5",background:"#fff",color:"#dc2626",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer"}}>Excluir</button>
              <button onClick={()=>abrirEditar(detalhe)} style={{border:"1px solid #e2e8f0",background:"#fff",color:"#0f172a",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer"}}>Editar</button>
              <button onClick={()=>setDetalhe(null)} style={{background:"#0f172a",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Fechar</button>
            </div>
          </div>
        </div>
      )}
      {modal&&<FormModalContrato editId={editando?.id} initialForm={editando||emptyFormContrato} onSave={salvar} onClose={()=>setModal(false)}/>}
    </div>
  );
}

// ── Painel de Usuários ────────────────────────────────────────────────────
function PainelUsuarios({showToast}) {
  const [usuarios,setUsuarios]=useState([]);
  const [contratos,setContratos]=useState([]);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(false);
  const [editando,setEditando]=useState(null);
  const [form,setForm]=useState({nome:"",email:"",senha:"",papel:"consultor",contratosAcesso:[]});
  const [salvando,setSalvando]=useState(false);
  const [confirmExcluir,setConfirmExcluir]=useState(null);

  useEffect(()=>{carregarTudo();},[]);
  async function carregarTudo(){
    setLoading(true);
    try {
      const [snapU,snapC]=await Promise.all([getDocs(collection(db,"usuarios")),getDocs(collection(db,"contratos"))]);
      setUsuarios(snapU.docs.map(d=>d.data()));
      setContratos(snapC.docs.map(d=>({id:d.id,...d.data()})));
    } catch(e){ showToast("Erro ao carregar dados.","erro"); }
    finally{ setLoading(false); }
  }

  function abrirNovo(){ setForm({nome:"",email:"",senha:"",papel:"consultor",contratosAcesso:[]}); setEditando(null); setModal(true); }
  function abrirEditar(u){ setForm({nome:u.nome||"",email:u.email||"",senha:"",papel:u.papel||"consultor",contratosAcesso:u.contratosAcesso||[]}); setEditando(u); setModal(true); }
  function toggleContrato(id){ setForm(f=>{const a=f.contratosAcesso||[];return{...f,contratosAcesso:a.includes(id)?a.filter(x=>x!==id):[...a,id]};}); }

  async function salvarUsuario(){
    if(!form.nome||!form.email){showToast("Preencha nome e email.","erro");return;}
    if(!editando&&!form.senha){showToast("Defina uma senha.","erro");return;}
    if(!editando&&form.senha.length<6){showToast("Senha mínima de 6 caracteres.","erro");return;}
    setSalvando(true);
    try {
      if(editando){
        const atualizado={...editando,nome:form.nome,papel:form.papel,contratosAcesso:form.contratosAcesso||[]};
        await setDoc(doc(db,"usuarios",editando.uid),atualizado);
        setUsuarios(p=>p.map(u=>u.uid===editando.uid?atualizado:u));
        showToast("Usuário atualizado.");
      } else {
        const uid=await criarUsuarioFirebase(form.email,form.senha);
        const perfil={uid,nome:form.nome,email:form.email,papel:form.papel,contratosAcesso:form.contratosAcesso||[],criadoEm:new Date().toISOString()};
        await setDoc(doc(db,"usuarios",uid),perfil);
        setUsuarios(p=>[...p,perfil]);
        showToast("Usuário criado.");
      }
      setModal(false);
    } catch(e){
      const msg=e.message.includes("EMAIL_EXISTS")?"Este email já está cadastrado.":e.message.includes("WEAK_PASSWORD")?"Senha fraca.":"Erro ao salvar usuário.";
      showToast(msg,"erro");
    } finally{setSalvando(false);}
  }

  async function excluirUsuario(u){
    try{
      await deleteDoc(doc(db,"usuarios",u.uid));
      setUsuarios(p=>p.filter(x=>x.uid!==u.uid));
      setConfirmExcluir(null);
      setModal(false);
      showToast("Usuário removido do sistema.");
    } catch(e){ showToast("Erro ao excluir usuário.","erro"); }
  }

  return (
    <div style={{maxWidth:960,margin:"0 auto",padding:"28px 20px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <div>
          <div style={{fontSize:18,fontWeight:700}}>Usuários</div>
          <div style={{fontSize:13,color:"#94a3b8",marginTop:2}}>{usuarios.length} {usuarios.length===1?"usuário":"usuários"} cadastrados</div>
        </div>
        <button onClick={abrirNovo} style={{background:"#0f172a",color:"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:16}}>+</span> Novo usuário
        </button>
      </div>

      {loading?<div style={{padding:40,textAlign:"center",color:"#94a3b8"}}>Carregando...</div>:(
        <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
              {["Nome","E-mail","Perfil","Contratos","Cadastrado em",""].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:11,fontWeight:600,color:"#64748b",letterSpacing:.4}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {usuarios.map((u,i)=>{
                const p=PAPEIS[u.papel]||PAPEIS.consultor;
                const qtd=(u.contratosAcesso||[]).length;
                return(
                  <tr key={u.uid} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}>
                    <td style={{padding:"12px 16px",fontWeight:600}}>{u.nome||"—"}</td>
                    <td style={{padding:"12px 16px",color:"#475569"}}>{u.email||"—"}</td>
                    <td style={{padding:"12px 16px"}}><span style={{background:p.bg,color:p.color,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>{p.label}</span></td>
                    <td style={{padding:"12px 16px",fontSize:12,color:"#64748b"}}>
                      {u.papel==="admin"?<span style={{color:"#16a34a",fontWeight:600}}>Todos</span>:qtd===0?<span style={{color:"#94a3b8"}}>Nenhum</span>:<span style={{color:"#0369a1",fontWeight:600}}>{qtd} contrato{qtd>1?"s":""}</span>}
                    </td>
                    <td style={{padding:"12px 16px",color:"#94a3b8",fontSize:12}}>{u.criadoEm?new Date(u.criadoEm).toLocaleDateString("pt-BR"):"—"}</td>
                    <td style={{padding:"12px 16px"}}><button onClick={()=>abrirEditar(u)} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:6,padding:"4px 12px",fontSize:11,color:"#475569",cursor:"pointer"}}>Editar</button></td>
                  </tr>
                );
              })}
              {usuarios.length===0&&<tr><td colSpan={6} style={{padding:40,textAlign:"center",color:"#94a3b8"}}>Nenhum usuário cadastrado.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setModal(false)}>
          <div onClick={ev=>ev.stopPropagation()} style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",padding:28}}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:20}}>{editando?"Editar usuário":"Novo usuário"}</div>
            <div style={{display:"grid",gap:14}}>
              <div><label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:4}}>Nome completo *</label>
                <input value={form.nome} onChange={ev=>setForm(p=>({...p,nome:ev.target.value}))} placeholder="Ex: João Silva" style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"9px 12px",fontSize:13,boxSizing:"border-box"}}/></div>
              {!editando&&<><div><label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:4}}>E-mail *</label>
                <input value={form.email} onChange={ev=>setForm(p=>({...p,email:ev.target.value}))} placeholder="usuario@email.com" style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"9px 12px",fontSize:13,boxSizing:"border-box"}}/></div>
              <div><label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:4}}>Senha inicial *</label>
                <input type="password" value={form.senha} onChange={ev=>setForm(p=>({...p,senha:ev.target.value}))} placeholder="Mínimo 6 caracteres" style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"9px 12px",fontSize:13,boxSizing:"border-box"}}/></div></>}
              <div><label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:4}}>Perfil de acesso *</label>
                <select value={form.papel} onChange={ev=>setForm(p=>({...p,papel:ev.target.value}))} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:8,padding:"9px 12px",fontSize:13,background:"#fff"}}>
                  <option value="admin">Admin — acesso total</option>
                  <option value="fiscal">Fiscal — visualiza e edita</option>
                  <option value="consultor">Consultor — somente visualiza</option>
                </select></div>

              {form.papel!=="admin"&&contratos.length>0&&(
                <div>
                  <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:8}}>Contratos com acesso</label>
                  <div style={{border:"1px solid #e2e8f0",borderRadius:8,overflow:"hidden"}}>
                    {contratos.map((c,i)=>{
                      const marcado=(form.contratosAcesso||[]).includes(c.id);
                      return(
                        <div key={c.id} onClick={()=>toggleContrato(c.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",cursor:"pointer",background:marcado?"#f0f9ff":"#fff",borderBottom:i<contratos.length-1?"1px solid #f1f5f9":"none"}}>
                          <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${marcado?"#0369a1":"#cbd5e1"}`,background:marcado?"#0369a1":"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            {marcado&&<span style={{color:"#fff",fontSize:12,lineHeight:1}}>✓</span>}
                          </div>
                          <div><div style={{fontSize:13,fontWeight:500}}>{c.numero}</div><div style={{fontSize:11,color:"#94a3b8"}}>{c.contratadaRazaoSocial||c.objeto?.substring(0,50)}</div></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {form.papel==="admin"&&<div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#166534"}}>Admins têm acesso total a todos os contratos automaticamente.</div>}
              {editando&&<div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#92400e"}}>Para alterar e-mail ou senha, acesse o Firebase Authentication no console.</div>}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"space-between",marginTop:22}}>
              {editando&&<button onClick={()=>setConfirmExcluir(editando)} style={{border:"1px solid #fca5a5",background:"#fff",color:"#dc2626",borderRadius:8,padding:"9px 16px",fontSize:13,cursor:"pointer"}}>Excluir usuário</button>}
              <div style={{display:"flex",gap:8,marginLeft:"auto"}}>
                <button onClick={()=>setModal(false)} style={{border:"1px solid #e2e8f0",background:"#fff",borderRadius:8,padding:"9px 18px",fontSize:13,cursor:"pointer"}}>Cancelar</button>
                <button onClick={salvarUsuario} disabled={salvando} style={{background:"#0f172a",color:"#fff",border:"none",borderRadius:8,padding:"9px 22px",fontSize:13,fontWeight:600,cursor:salvando?"not-allowed":"pointer",opacity:salvando?.7:1}}>{salvando?"Salvando...":editando?"Salvar alterações":"Criar usuário"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmExcluir&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setConfirmExcluir(null)}>
          <div onClick={ev=>ev.stopPropagation()} style={{background:"#fff",borderRadius:14,width:"100%",maxWidth:380,padding:28}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:8,color:"#dc2626"}}>Excluir usuário?</div>
            <div style={{fontSize:13,color:"#475569",marginBottom:20}}>Tem certeza que deseja remover <strong>{confirmExcluir.nome}</strong>? O acesso ao app será revogado imediatamente.</div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setConfirmExcluir(null)} style={{border:"1px solid #e2e8f0",background:"#fff",borderRadius:8,padding:"9px 18px",fontSize:13,cursor:"pointer"}}>Cancelar</button>
              <button onClick={()=>excluirUsuario(confirmExcluir)} style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Sim, excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tela de Login ─────────────────────────────────────────────────────────
function TelaLogin() {
  const [login,setLogin]=useState("");
  const [senha,setSenha]=useState("");
  const [erro,setErro]=useState("");
  const [loading,setLoading]=useState(false);
  async function handleLogin(){
    if(!login||!senha){setErro("Preencha o e-mail e a senha.");return;}
    setLoading(true);setErro("");
    try { await signInWithEmailAndPassword(auth,login.trim().toLowerCase(),senha); }
    catch(e){ setErro("E-mail ou senha incorretos."); }
    finally{ setLoading(false); }
  }
  return (
    <div style={{minHeight:"100vh",background:"#f8fafc",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <div style={{background:"#fff",borderRadius:18,border:"1px solid #e2e8f0",padding:"36px 40px",width:"100%",maxWidth:380,boxShadow:"0 8px 32px rgba(0,0,0,.07)"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:28}}>
          <div style={{width:48,height:48,background:"#0f172a",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,color:"#38bdf8",marginBottom:12}}>❄</div>
          <div style={{fontSize:20,fontWeight:800,color:"#0f172a",letterSpacing:-.4}}>CotaFrio</div>
          <div style={{fontSize:12,color:"#94a3b8",marginTop:2}}>Sistema de Cotações</div>
        </div>
        <div style={{marginBottom:14}}>
          <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:4}}>E-mail</label>
          <input value={login} onChange={ev=>setLogin(ev.target.value)} placeholder="seu@email.com" onKeyDown={ev=>ev.key==="Enter"&&handleLogin()} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:9,padding:"10px 14px",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:4}}>Senha</label>
          <input type="password" value={senha} onChange={ev=>setSenha(ev.target.value)} placeholder="••••••••" onKeyDown={ev=>ev.key==="Enter"&&handleLogin()} style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:9,padding:"10px 14px",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
        </div>
        {erro&&<div style={{background:"#fef2f2",border:"1px solid #fca5a5",color:"#dc2626",borderRadius:8,padding:"9px 14px",fontSize:13,marginBottom:14}}>{erro}</div>}
        <button onClick={handleLogin} disabled={loading} style={{width:"100%",background:"#0f172a",color:"#fff",border:"none",borderRadius:9,padding:"11px",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?.7:1}}>{loading?"Entrando...":"Entrar"}</button>
      </div>
    </div>
  );
}

// ── App principal ─────────────────────────────────────────────────────────
export default function App() {
  const [usuario,setUsuario]=useState(null);
  const [authUser,setAuthUser]=useState(null);
  const [authLoading,setAuthLoading]=useState(true);
  const [cotacoes,setCotacoes]=useState([]);
  const [contratos,setContratos]=useState([]);
  const [aba,setAba]=useState("cotacoes");
  const [loading,setLoading]=useState(true);
  const [view,setView]=useState("lista");
  const [filtroStatus,setFiltroStatus]=useState("todos");
  const [filtroCategoria,setFiltroCategoria]=useState("todas");
  const [filtroContrato,setFiltroContrato]=useState("todos");
  const [busca,setBusca]=useState("");
  const [modalForm,setModalForm]=useState(false);
  const [formInicial,setFormInicial]=useState(emptyFormCotacao);
  const [editId,setEditId]=useState(null);
  const [detalhe,setDetalhe]=useState(null);
  const [toast,setToast]=useState(null);

  const showToast=(msg,tipo="ok")=>{setToast({msg,tipo});setTimeout(()=>setToast(null),3200);};

  // Fiscal tem as mesmas permissões de edição que o antigo Gerente
  const podeEditar=usuario?.papel==="admin"||usuario?.papel==="fiscal";

  const contratosAcessiveis=useMemo(()=>{
    if(!usuario) return [];
    if(usuario.papel==="admin") return contratos;
    const ids=usuario.contratosAcesso||[];
    return contratos.filter(c=>ids.includes(c.id));
  },[usuario,contratos]);

  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async(fireUser)=>{
      if(fireUser){
        setAuthUser(fireUser);
        const snap=await getDoc(doc(db,"usuarios",fireUser.uid));
        if(snap.exists()){ setUsuario(snap.data()); }
        else{
          const perfil={uid:fireUser.uid,email:fireUser.email,nome:fireUser.email,papel:"admin",contratosAcesso:[],criadoEm:new Date().toISOString()};
          await setDoc(doc(db,"usuarios",fireUser.uid),perfil);
          setUsuario(perfil);
        }
      } else { setAuthUser(null);setUsuario(null); }
      setAuthLoading(false);
    });
    return unsub;
  },[]);

  useEffect(()=>{
    if(!authUser) return;
    async function carregar(){
      try{
        const [snapC,snapCot]=await Promise.all([getDocs(collection(db,"contratos")),getDocs(collection(db,"cotacoes"))]);
        setContratos(snapC.docs.map(d=>({id:d.id,...d.data()})));
        if(snapCot.empty){
          const lote=DADOS_COTACOES.map(enriquecer);
          await Promise.all(lote.map(c=>setDoc(doc(db,"cotacoes",String(c.id)),c)));
          setCotacoes(lote);
        } else {
          const dados=snapCot.docs.map(d=>enriquecer(d.data()));
          dados.sort((a,b)=>a.id-b.id);
          setCotacoes(dados);
        }
      } catch(e){ showToast("Erro ao conectar com o banco de dados.","erro"); }
      finally{ setLoading(false); }
    }
    carregar();
  },[authUser]);

  const filtradas=useMemo(()=>cotacoes.filter(c=>{
    if(usuario?.papel!=="admin"){
      const ids=usuario?.contratosAcesso||[];
      if(c.contratoId&&!ids.includes(c.contratoId)) return false;
    }
    if(filtroStatus!=="todos"&&c.status!==filtroStatus) return false;
    if(filtroCategoria!=="todas"&&c.categoria!==filtroCategoria) return false;
    if(filtroContrato!=="todos"&&c.contratoId!==filtroContrato) return false;
    if(busca&&!c.material.toLowerCase().includes(busca.toLowerCase())&&!c.codigo?.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  }),[cotacoes,filtroStatus,filtroCategoria,filtroContrato,busca,usuario]);

  const stats=useMemo(()=>{
    const base=cotacoes.filter(c=>{
      if(usuario?.papel!=="admin"){const ids=usuario?.contratosAcesso||[];if(c.contratoId&&!ids.includes(c.contratoId))return false;}
      return true;
    });
    return{total:base.length,vigente:base.filter(c=>c.status==="vigente").length,avencer:base.filter(c=>c.status==="avencer").length,vencida:base.filter(c=>c.status==="vencida").length};
  },[cotacoes,usuario]);

  function abrirNova(){setFormInicial(emptyFormCotacao);setEditId(null);setModalForm(true);}
  function abrirEditar(c){setFormInicial({...c,fornecedores:c.fornecedores.map(f=>({...f}))});setEditId(c.id);setModalForm(true);setDetalhe(null);}

  async function salvar(form){
    if(!form.material||!form.dataElaboracao){showToast("Preencha material e data.","erro");return;}
    if(!form.contratoId){showToast("Vincule a cotação a um contrato.","erro");return;}
    const nova=enriquecer(form);
    try{
      if(editId){const a={...nova,id:editId};await setDoc(doc(db,"cotacoes",String(editId)),a);setCotacoes(p=>p.map(c=>c.id===editId?a:c));showToast("Cotação atualizada.");}
      else{const nid=Math.max(0,...cotacoes.map(c=>c.id))+1;const n2={...nova,id:nid};await setDoc(doc(db,"cotacoes",String(nid)),n2);setCotacoes(p=>[...p,n2]);showToast("Cotação cadastrada.");}
    } catch(e){showToast("Erro ao salvar cotação.","erro");return;}
    setModalForm(false);
  }

  async function excluirCot(id){
    try{await deleteDoc(doc(db,"cotacoes",String(id)));setCotacoes(p=>p.filter(c=>c.id!==id));setDetalhe(null);showToast("Cotação removida.");}
    catch(e){showToast("Erro ao excluir.","erro");}
  }
  async function fazerLogout(){await signOut(auth);}

  if(authLoading) return <div style={{minHeight:"100vh",background:"#f8fafc",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,fontFamily:"'DM Sans','Segoe UI',sans-serif",color:"#64748b"}}><div style={{width:38,height:38,background:"#0f172a",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,color:"#38bdf8"}}>❄</div><div style={{fontSize:14,fontWeight:500}}>Verificando sessão...</div></div>;
  if(!authUser) return <TelaLogin/>;
  if(loading) return <div style={{minHeight:"100vh",background:"#f8fafc",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,fontFamily:"'DM Sans','Segoe UI',sans-serif",color:"#64748b"}}><div style={{width:38,height:38,background:"#0f172a",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,color:"#38bdf8"}}>❄</div><div style={{fontSize:14,fontWeight:500}}>Carregando...</div></div>;

  const abas=[["cotacoes","Cotações"],...(usuario?.papel==="admin"?[["contratos","Contratos"],["usuarios","Usuários"]]:usuario?.papel==="fiscal"?[["contratos","Contratos"]]:[] )];

  return (
    <div style={{minHeight:"100vh",background:"#f8fafc",fontFamily:"'DM Sans','Segoe UI',sans-serif",color:"#0f172a"}}>
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"0 24px",display:"flex",alignItems:"center",height:58,gap:14,position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,background:"#0f172a",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#38bdf8"}}>❄</div>
          <div><div style={{fontSize:14,fontWeight:700,letterSpacing:-.3}}>CotaFrio</div><div style={{fontSize:10,color:"#94a3b8",letterSpacing:.5}}>REFRIGERAÇÃO</div></div>
        </div>
        <div style={{display:"flex",gap:2,marginLeft:8}}>
          {abas.map(([v,l])=>(
            <button key={v} onClick={()=>setAba(v)} style={{background:aba===v?"#f1f5f9":"none",border:"none",borderRadius:8,padding:"6px 14px",fontSize:13,fontWeight:aba===v?600:400,color:aba===v?"#0f172a":"#64748b",cursor:"pointer"}}>{l}</button>
          ))}
        </div>
        <div style={{flex:1}}/>
        {aba==="cotacoes"&&<input placeholder="Buscar material, código..." value={busca} onChange={ev=>setBusca(ev.target.value)} style={{border:"1px solid #e2e8f0",borderRadius:8,padding:"7px 14px",fontSize:13,width:230,background:"#f8fafc",outline:"none"}}/>}
        {aba==="cotacoes"&&podeEditar&&(
          <button onClick={abrirNova} style={{background:"#0f172a",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
            <span style={{fontSize:16,lineHeight:1}}>+</span> Nova cotação
          </button>
        )}
        <div style={{display:"flex",alignItems:"center",gap:8,borderLeft:"1px solid #e2e8f0",paddingLeft:14}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:12,fontWeight:600,color:"#0f172a"}}>{usuario?.nome||usuario?.email}</div>
            <div style={{marginTop:2}}><RoleBadge papel={usuario?.papel}/></div>
          </div>
          <button onClick={fazerLogout} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 10px",fontSize:12,color:"#64748b",cursor:"pointer"}}>Sair</button>
        </div>
      </div>

      {aba==="usuarios"&&usuario?.papel==="admin"&&<PainelUsuarios showToast={showToast}/>}
      {aba==="contratos"&&(usuario?.papel==="admin"||usuario?.papel==="fiscal")&&<PainelContratos showToast={showToast}/>}

      {aba==="cotacoes"&&(
        <div style={{maxWidth:1200,margin:"0 auto",padding:"22px 20px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
            {[{l:"Total",v:stats.total,c:"#0f172a",bg:"#f8fafc",br:"#e2e8f0",f:"todos"},{l:"Vigentes",v:stats.vigente,c:"#16a34a",bg:"#f0fdf4",br:"#86efac",f:"vigente"},{l:"A vencer",v:stats.avencer,c:"#b45309",bg:"#fffbeb",br:"#fcd34d",f:"avencer"},{l:"Vencidas",v:stats.vencida,c:"#dc2626",bg:"#fef2f2",br:"#fca5a5",f:"vencida"}].map(s=>
              <div key={s.l} onClick={()=>setFiltroStatus(s.f)} style={{background:s.bg,border:`1px solid ${s.br}`,borderRadius:12,padding:"14px 18px",cursor:"pointer"}}>
                <div style={{fontSize:11,color:s.c,fontWeight:600,letterSpacing:.5,marginBottom:2}}>{s.l.toUpperCase()}</div>
                <div style={{fontSize:30,fontWeight:800,color:s.c,lineHeight:1}}>{s.v}</div>
              </div>
            )}
          </div>

          <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
            {[["todos","Todos"],["vigente","Vigentes"],["avencer","A vencer"],["vencida","Vencidas"]].map(([s,l])=>
              <button key={s} onClick={()=>setFiltroStatus(s)} style={{border:`1px solid ${filtroStatus===s?"#0f172a":"#e2e8f0"}`,background:filtroStatus===s?"#0f172a":"#fff",color:filtroStatus===s?"#fff":"#64748b",borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:500,cursor:"pointer"}}>{l}</button>
            )}
            <select value={filtroCategoria} onChange={ev=>setFiltroCategoria(ev.target.value)} style={{border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 12px",fontSize:12,background:"#fff",color:"#475569",cursor:"pointer"}}>
              <option value="todas">Todas categorias</option>{CATEGORIAS.map(c=><option key={c}>{c}</option>)}
            </select>
            {contratosAcessiveis.length>0&&(
              <select value={filtroContrato} onChange={ev=>setFiltroContrato(ev.target.value)} style={{border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 12px",fontSize:12,background:"#fff",color:"#475569",cursor:"pointer"}}>
                <option value="todos">Todos os contratos</option>
                {contratosAcessiveis.map(c=><option key={c.id} value={c.id}>{c.numero}</option>)}
              </select>
            )}
            <div style={{marginLeft:"auto",display:"flex",gap:6}}>
              {[["lista","⊟ Lista"],["cards","⊞ Cards"]].map(([v,l])=>
                <button key={v} onClick={()=>setView(v)} style={{border:`1px solid ${view===v?"#0f172a":"#e2e8f0"}`,background:view===v?"#0f172a":"#fff",color:view===v?"#fff":"#64748b",borderRadius:8,padding:"6px 12px",fontSize:12,cursor:"pointer"}}>{l}</button>
              )}
            </div>
          </div>

          <div style={{fontSize:12,color:"#94a3b8",marginBottom:10}}>{filtradas.length} {filtradas.length===1?"cotação encontrada":"cotações encontradas"}</div>

          {view==="lista"&&(
            <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead><tr style={{background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
                  {["Código","Material","Categoria","Contrato","Média saneada","Valor final","Vencimento","Status",...(podeEditar?[""]:[])] .map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:600,color:"#64748b",letterSpacing:.4,whiteSpace:"nowrap"}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {filtradas.map((c,i)=>{
                    const ctr=contratos.find(x=>x.id===c.contratoId);
                    return(
                      <tr key={c.id} onClick={()=>setDetalhe(c)} style={{borderBottom:"1px solid #f1f5f9",cursor:"pointer",background:i%2===0?"#fff":"#fafafa"}}
                        onMouseEnter={ev=>ev.currentTarget.style.background="#f0f9ff"}
                        onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?"#fff":"#fafafa"}>
                        <td style={{padding:"11px 14px",color:"#64748b",fontFamily:"monospace",fontSize:11}}>{c.codigo}</td>
                        <td style={{padding:"11px 14px",fontWeight:500}}>{c.material}</td>
                        <td style={{padding:"11px 14px"}}><CatBadge cat={c.categoria}/></td>
                        <td style={{padding:"11px 14px",fontSize:11,color:"#0369a1",fontWeight:500}}>{ctr?.numero||<span style={{color:"#94a3b8"}}>—</span>}</td>
                        <td style={{padding:"11px 14px",fontWeight:600}}>R$ {brl(c.mediaSaneada)}</td>
                        <td style={{padding:"11px 14px",color:"#0369a1",fontWeight:700}}>R$ {brl(c.precoFinalDesconto)}</td>
                        <td style={{padding:"11px 14px",color:"#64748b",fontSize:12}}>{fmtVenc(c.dataElaboracao)}</td>
                        <td style={{padding:"11px 14px"}}><StatusBadge status={c.status}/></td>
                        {podeEditar&&<td style={{padding:"11px 14px"}}><button onClick={ev=>{ev.stopPropagation();abrirEditar(c);}} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:6,padding:"4px 10px",fontSize:11,color:"#475569",cursor:"pointer"}}>Editar</button></td>}
                      </tr>
                    );
                  })}
                  {filtradas.length===0&&<tr><td colSpan={9} style={{padding:40,textAlign:"center",color:"#94a3b8"}}>Nenhuma cotação encontrada.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {view==="cards"&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(255px,1fr))",gap:14}}>
              {filtradas.map(c=>{
                const dias=diasRest(c.dataElaboracao);
                const ctr=contratos.find(x=>x.id===c.contratoId);
                return(
                  <div key={c.id} onClick={()=>setDetalhe(c)} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,overflow:"hidden",cursor:"pointer"}}
                    onMouseEnter={ev=>ev.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,.08)"}
                    onMouseLeave={ev=>ev.currentTarget.style.boxShadow="none"}>
                    <div style={{height:100,background:c.imagem?`url(${c.imagem}) center/cover`:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>{c.imagem?null:"📦"}</div>
                    <div style={{padding:"12px 14px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                        <div style={{fontSize:11,color:"#94a3b8",fontFamily:"monospace"}}>{c.codigo}</div>
                        <StatusBadge status={c.status}/>
                      </div>
                      <div style={{fontWeight:600,fontSize:13,marginBottom:4,lineHeight:1.3}}>{c.material}</div>
                      {ctr&&<div style={{fontSize:11,color:"#0369a1",marginBottom:6,fontWeight:500}}>{ctr.numero}</div>}
                      <CatBadge cat={c.categoria}/>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:10,borderTop:"1px solid #f1f5f9",paddingTop:10}}>
                        <div><div style={{fontSize:10,color:"#94a3b8",fontWeight:500}}>MÉDIA SANEADA</div><div style={{fontSize:14,fontWeight:700}}>R$ {brl(c.mediaSaneada)}</div></div>
                        <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#94a3b8",fontWeight:500}}>VALOR FINAL</div><div style={{fontSize:14,fontWeight:700,color:"#0369a1"}}>R$ {brl(c.precoFinalDesconto)}</div></div>
                      </div>
                      {dias!==null&&<div style={{marginTop:6,fontSize:11,color:dias<0?"#dc2626":dias<=30?"#b45309":"#16a34a"}}>{dias<0?`Vencida há ${Math.abs(dias)} dias`:dias===0?"Vence hoje":`Vence em ${dias} dias`}</div>}
                    </div>
                  </div>
                );
              })}
              {filtradas.length===0&&<div style={{gridColumn:"1/-1",padding:40,textAlign:"center",color:"#94a3b8"}}>Nenhuma cotação encontrada.</div>}
            </div>
          )}
        </div>
      )}

      {detalhe&&(()=>{
        const c=cotacoes.find(x=>x.id===detalhe.id)||detalhe;
        const ctr=contratos.find(x=>x.id===c.contratoId);
        return(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setDetalhe(null)}>
            <div onClick={ev=>ev.stopPropagation()} style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:620,maxHeight:"91vh",overflowY:"auto",padding:26}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <div>
                  <div style={{fontSize:11,color:"#94a3b8",fontFamily:"monospace",marginBottom:4}}>{c.codigo} · {c.categoria}</div>
                  <div style={{fontSize:17,fontWeight:700,lineHeight:1.2}}>{c.material}</div>
                  {ctr&&<div style={{fontSize:12,color:"#0369a1",marginTop:4,fontWeight:500}}>{ctr.numero} — {ctr.contratanteNome||ctr.contratadaRazaoSocial}</div>}
                  <div style={{fontSize:12,color:"#64748b",marginTop:2}}>Base: {c.dataBase}</div>
                </div>
                <StatusBadge status={c.status} size="lg"/>
              </div>
              {c.imagem&&<img src={c.imagem} style={{width:"100%",height:150,objectFit:"cover",borderRadius:10,marginBottom:14}}/>}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                {[{l:"Média geral",v:"R$ "+brl(c.mediaGeral)},{l:"Média saneada",v:"R$ "+brl(c.mediaSaneada)},{l:`Valor c/ BDI (${c.bdi}%)`,v:"R$ "+brl(c.precoFinalBDI)},{l:`Valor final (desc. ${c.desconto}%)`,v:"R$ "+brl(c.precoFinalDesconto),dest:true},{l:"Data elaboração",v:c.dataElaboracao?new Date(c.dataElaboracao+"T12:00:00").toLocaleDateString("pt-BR"):"—"},{l:"Vencimento",v:fmtVenc(c.dataElaboracao)},{l:"Quantidade",v:c.quantidade+" "+c.unidade},{l:"Total referência",v:"R$ "+brl(c.precoFinalDesconto*c.quantidade)}].map(it=>
                  <div key={it.l} style={{background:it.dest?"#eff6ff":"#f8fafc",borderRadius:10,padding:"10px 14px",border:it.dest?"1px solid #bfdbfe":"none"}}>
                    <div style={{fontSize:11,color:"#94a3b8",fontWeight:500,marginBottom:2}}>{it.l}</div>
                    <div style={{fontSize:15,fontWeight:700,color:it.dest?"#1d4ed8":"#0f172a"}}>{it.v}</div>
                  </div>
                )}
              </div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:600,color:"#64748b",marginBottom:8,letterSpacing:.4}}>PESQUISA DE PREÇOS — SANEAMENTO</div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{background:"#f8fafc"}}>{["Fonte","Valor","Variação","Status"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:11,fontWeight:600,color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>{h}</th>)}</tr></thead>
                  <tbody>{c.fornecedores.filter(f=>parseFloat(f.valor)>0).map((f,i)=>
                    <tr key={i} style={{background:f.autoExcluido?"#fef2f2":"#f0fdf4",borderBottom:"1px solid #f1f5f9"}}>
                      <td style={{padding:"7px 10px",fontWeight:500}}>{f.nome||"—"}</td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace"}}>R$ {brl(f.valor)}</td>
                      <td style={{padding:"7px 10px",color:f.autoExcluido?"#dc2626":"#16a34a",fontWeight:600}}>{f.variacao!=null?pct(f.variacao):"—"}</td>
                      <td style={{padding:"7px 10px"}}>{f.autoExcluido?<span style={{background:"#fee2e2",color:"#dc2626",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>EXCLUÍDO</span>:<span style={{background:"#dcfce7",color:"#16a34a",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>ACEITO</span>}</td>
                    </tr>
                  )}</tbody>
                </table>
              </div>
              {c.observacoes&&<div style={{background:"#f8fafc",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#475569",marginBottom:14}}><span style={{fontWeight:600}}>Obs.: </span>{c.observacoes}</div>}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                {usuario?.papel==="admin"&&<button onClick={()=>excluirCot(c.id)} style={{border:"1px solid #fca5a5",background:"#fff",color:"#dc2626",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer"}}>Excluir</button>}
                {podeEditar&&<button onClick={()=>abrirEditar(c)} style={{border:"1px solid #e2e8f0",background:"#fff",color:"#0f172a",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer"}}>Editar</button>}
                <button onClick={()=>setDetalhe(null)} style={{background:"#0f172a",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Fechar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {modalForm&&<FormModalCotacao editId={editId} initialForm={formInicial} contratos={contratosAcessiveis} onSave={salvar} onClose={()=>setModalForm(false)}/>}
      {toast&&<div style={{position:"fixed",bottom:20,right:20,zIndex:300,background:toast.tipo==="erro"?"#fef2f2":"#f0fdf4",border:`1px solid ${toast.tipo==="erro"?"#fca5a5":"#86efac"}`,color:toast.tipo==="erro"?"#dc2626":"#16a34a",borderRadius:10,padding:"12px 18px",fontSize:13,fontWeight:500,boxShadow:"0 4px 16px rgba(0,0,0,.1)"}}>{toast.msg}</div>}
    </div>
  );
}
