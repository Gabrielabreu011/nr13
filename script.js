/* ══════════════════════════════════════════
   NR-13 · Controle de Inspeções — Scripts
   ══════════════════════════════════════════ */

const STORAGE_KEY = "nr13_v2";
const DIAS_ALERTA = 30;

let equipamentos  = [];
let editandoId    = null;
let modalCallback = null;

// ── INIT ──
document.addEventListener("DOMContentLoaded", () => {
  carregarDados();
  renderizarTabela();
  aplicarTema();
  carregarConfiguracoes();

  document.getElementById("busca").addEventListener("input", renderizarTabela);
  document.getElementById("filtroStatus").addEventListener("change", renderizarTabela);
  document.getElementById("filtroTipo").addEventListener("change", renderizarTabela);
  document.getElementById("themeBtn").addEventListener("click", toggleTema);
  document.getElementById("modalOverlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) fecharModal();
  });
});

// ── TEMA ──
function toggleTema() {
  const html   = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", isDark ? "light" : "dark");
  document.getElementById("themeBtn").textContent = isDark ? "🌙" : "☀️";
  localStorage.setItem("nr13_tema", isDark ? "light" : "dark");
}
function aplicarTema() {
  const t = localStorage.getItem("nr13_tema") || "light";
  document.documentElement.setAttribute("data-theme", t);
  document.getElementById("themeBtn").textContent = t === "dark" ? "☀️" : "🌙";
}

// ── PERSISTÊNCIA ──
function salvarDados() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(equipamentos));
}
function carregarDados() {
  const d = localStorage.getItem(STORAGE_KEY);
  if (!d) {
    const old = localStorage.getItem("nr13_equipamentos");
    equipamentos = old ? JSON.parse(old) : [];
    equipamentos.forEach(e => { if (!e.statusCustom) e.statusCustom = "ativo"; });
  } else {
    equipamentos = JSON.parse(d);
  }
}

// ── CONFIGURAÇÕES DE E-MAIL ──
function carregarConfiguracoes() {
  const key   = localStorage.getItem("nr13_resend_key")   || "";
  const from  = localStorage.getItem("nr13_from_email")   || "";
  const dests = localStorage.getItem("nr13_destinatarios") || "";
  if (key)   document.getElementById("resendApiKey").value        = key;
  if (from)  document.getElementById("fromEmail").value           = from;
  if (dests) document.getElementById("emailDestinatarios").value  = dests;
}

function salvarConfiguracoes() {
  const key   = document.getElementById("resendApiKey").value.trim();
  const from  = document.getElementById("fromEmail").value.trim();
  const dests = document.getElementById("emailDestinatarios").value.trim();

  if (!key)  { mostrarToast("Cole sua API Key do Resend.", "red"); return; }
  if (!from) { mostrarToast("Informe o e-mail remetente.", "red"); return; }

  localStorage.setItem("nr13_resend_key",   key);
  localStorage.setItem("nr13_from_email",   from);
  localStorage.setItem("nr13_destinatarios", dests);
  mostrarToast("Configurações salvas!", "green");
}

function obterListaEmails() {
  return document.getElementById("emailDestinatarios").value
    .split(/[\n,;]+/)
    .map(e => e.trim())
    .filter(e => e.includes("@"));
}

// ── DISPARAR ALERTAS ──
async function dispararAlertas() {
  const apiKey = localStorage.getItem("nr13_resend_key");
  const from   = localStorage.getItem("nr13_from_email");
  const dests  = obterListaEmails();

  if (!apiKey) { mostrarToast("Salve sua API Key do Resend primeiro.", "red"); return; }
  if (!from)   { mostrarToast("Salve o e-mail remetente primeiro.", "red"); return; }
  if (!dests.length) { mostrarToast("Adicione ao menos um destinatário.", "red"); return; }

  const paraEnvio = equipamentos
    .filter(i => i.statusCustom !== "descomissionado")
    .map(item => {
      const proxima = calcularProxima(item.ultimaInspecao, item.validadeMeses);
      const dias    = calcularDias(proxima);
      const status  = obterStatusCalc(dias, item.statusCustom);
      return { ...item, statusCalculado: status.classe, diasRestantes: dias, proximaInspecao: fmtData(proxima) };
    })
    .filter(i => i.statusCalculado === "vencida" || i.statusCalculado === "proxima");

  if (!paraEnvio.length) {
    mostrarToast("Nenhum equipamento vencido ou próximo do vencimento.", "yellow");
    return;
  }

  const btn = document.getElementById("btnDispararAlertas");
  btn.textContent = "Enviando…";
  btn.disabled    = true;

  const vencidas = paraEnvio.filter(e => e.statusCalculado === "vencida");
  const proximas = paraEnvio.filter(e => e.statusCalculado === "proxima");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from:    from,
        to:      dests,
        subject: gerarAssunto(vencidas, proximas),
        html:    gerarHTML(vencidas, proximas),
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.name || "Erro na API");

    mostrarToast(`✅ E-mail enviado para ${dests.length} destinatário(s)!`, "green");
  } catch (err) {
    console.error(err);
    mostrarToast(`❌ Erro: ${err.message}`, "red");
  } finally {
    btn.textContent = "🚨 Disparar alertas";
    btn.disabled    = false;
  }
}

// ── GERAÇÃO DO E-MAIL HTML ──
function gerarAssunto(vencidas, proximas) {
  const p = [];
  if (vencidas.length) p.push(`${vencidas.length} vencida(s)`);
  if (proximas.length) p.push(`${proximas.length} vencendo em breve`);
  return `⚠ NR-13 · Alerta de Inspeção — ${p.join(" | ")}`;
}

function linhaTabela(e) {
  const cor = e.statusCalculado === "vencida" ? "#c8253d" : "#d9820a";
  const texto = e.diasRestantes < 0
    ? `${Math.abs(e.diasRestantes)}d vencido`
    : `${e.diasRestantes}d restantes`;
  return `<tr style="border-bottom:1px solid #e2e6ea">
    <td style="padding:10px 14px;font-weight:600">${e.nome}</td>
    <td style="padding:10px 14px;font-family:monospace">${e.tag}</td>
    <td style="padding:10px 14px">${e.setor}</td>
    <td style="padding:10px 14px">${e.tipo}</td>
    <td style="padding:10px 14px">${e.proximaInspecao}</td>
    <td style="padding:10px 14px;font-weight:700;color:${cor}">${texto}</td>
    <td style="padding:10px 14px">${e.responsavel}</td>
  </tr>`;
}

function blocoTabela(titulo, cor, icone, itens) {
  if (!itens.length) return "";
  return `<div style="margin-bottom:32px">
    <h2 style="font-size:15px;font-weight:700;color:${cor};padding:12px 16px;
      background:${cor}18;border-left:4px solid ${cor};border-radius:4px;margin:0 0 12px">
      ${icone} ${titulo} (${itens.length})
    </h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;color:#1a1d23">
      <thead><tr style="background:#f0f2f5">
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#8e97a6;text-transform:uppercase">Equipamento</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#8e97a6;text-transform:uppercase">TAG</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#8e97a6;text-transform:uppercase">Setor</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#8e97a6;text-transform:uppercase">Tipo</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#8e97a6;text-transform:uppercase">Próx. Inspeção</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#8e97a6;text-transform:uppercase">Prazo</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#8e97a6;text-transform:uppercase">Responsável</th>
      </tr></thead>
      <tbody>${itens.map(linhaTabela).join("")}</tbody>
    </table>
  </div>`;
}

function gerarHTML(vencidas, proximas) {
  const hoje = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"long", year:"numeric" });
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:720px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#0d9e5c;padding:28px 32px;display:flex;align-items:center;gap:14px">
    <span style="background:rgba(255,255,255,.2);color:#fff;font-family:monospace;font-size:13px;font-weight:700;padding:6px 12px;border-radius:6px">NR-13</span>
    <div>
      <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0">Alerta de Inspeção</h1>
      <p style="color:rgba(255,255,255,.8);font-size:13px;margin:4px 0 0">Gerado automaticamente em ${hoje}</p>
    </div>
  </div>
  <div style="padding:20px 32px;background:#f7f8fa;border-bottom:1px solid #e2e6ea;display:flex;gap:20px;flex-wrap:wrap">
    ${vencidas.length ? `<div style="background:#fde8eb;border-left:4px solid #c8253d;padding:12px 16px;border-radius:4px;flex:1;min-width:140px">
      <div style="font-size:28px;font-weight:700;color:#c8253d;font-family:monospace">${vencidas.length}</div>
      <div style="font-size:12px;color:#842029;text-transform:uppercase;font-weight:600">Vencidas</div>
    </div>` : ""}
    ${proximas.length ? `<div style="background:#fef3e0;border-left:4px solid #d9820a;padding:12px 16px;border-radius:4px;flex:1;min-width:140px">
      <div style="font-size:28px;font-weight:700;color:#d9820a;font-family:monospace">${proximas.length}</div>
      <div style="font-size:12px;color:#664d03;text-transform:uppercase;font-weight:600">Vencem em 30 dias</div>
    </div>` : ""}
  </div>
  <div style="padding:28px 32px">
    ${blocoTabela("Inspeções Vencidas — Ação Imediata", "#c8253d", "⛔", vencidas)}
    ${blocoTabela("Vencendo em Breve — Atenção", "#d9820a", "⚠️", proximas)}
  </div>
  <div style="padding:20px 32px;background:#f7f8fa;border-top:1px solid #e2e6ea;text-align:center">
    <p style="font-size:12px;color:#8e97a6;margin:0">Este e-mail foi gerado automaticamente pelo sistema NR-13. Não responda.</p>
  </div>
</div></body></html>`;
}

// ── TOAST ──
function mostrarToast(msg, tipo = "green") {
  document.getElementById("nr13-toast")?.remove();
  const c = { green:"var(--green-bg);border-color:var(--green);color:var(--green)", red:"var(--red-bg);border-color:var(--red);color:var(--red)", yellow:"var(--yellow-bg);border-color:var(--yellow);color:var(--yellow)" }[tipo];
  const t = document.createElement("div");
  t.id = "nr13-toast";
  t.style.cssText = `position:fixed;bottom:28px;right:28px;z-index:9999;background:${c.split(";")[0].split(":")[1]};border:1px solid;border-color:${c.split(";")[1].split(":")[1]};color:${c.split(";")[2].split(":")[1]};padding:14px 20px;border-radius:10px;font-size:13px;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,.15);max-width:380px;line-height:1.5;animation:toastIn .3s ease`;
  if (!document.getElementById("nr13-toast-style")) {
    const s = document.createElement("style");
    s.id = "nr13-toast-style";
    s.textContent = `@keyframes toastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes toastOut{from{opacity:1}to{opacity:0;transform:translateY(12px)}}`;
    document.head.appendChild(s);
  }

  // parse simples para aplicar as vars corretamente
  const cores = {
    green: { bg: "var(--green-bg)", border: "var(--green)", color: "var(--green)" },
    red:   { bg: "var(--red-bg)",   border: "var(--red)",   color: "var(--red)"   },
    yellow:{ bg: "var(--yellow-bg)",border: "var(--yellow)",color: "var(--yellow)"},
  };
  const cv = cores[tipo] || cores.green;
  t.style.cssText = `position:fixed;bottom:28px;right:28px;z-index:9999;
    background:${cv.bg};border:1px solid ${cv.border};color:${cv.color};
    padding:14px 20px;border-radius:10px;font-size:13px;font-weight:500;
    box-shadow:0 8px 32px rgba(0,0,0,.15);max-width:380px;line-height:1.5;
    animation:toastIn .3s ease`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.animation = "toastOut .3s ease forwards"; setTimeout(() => t.remove(), 300); }, 4500);
}

// ── CÁLCULOS ──
function calcularProxima(data, meses) {
  const d = new Date(data + "T00:00:00");
  d.setMonth(d.getMonth() + meses);
  return d;
}
function calcularDias(data) {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const fut  = new Date(data); fut.setHours(0,0,0,0);
  return Math.ceil((fut - hoje) / 86400000);
}
function obterStatusCalc(dias, custom) {
  if (custom === "descomissionado") return { classe:"descomissionado", texto:"DESCOM." };
  if (dias < 0)            return { classe:"vencida",  texto:"VENCIDA" };
  if (dias <= DIAS_ALERTA) return { classe:"proxima",  texto:"VENCE EM BREVE" };
  return                          { classe:"valida",   texto:"DENTRO DA VALIDADE" };
}
function fmtData(d) { return new Date(d).toLocaleDateString("pt-BR"); }

// ── RENDERIZAÇÃO ──
function renderizarTabela() {
  const tabela       = document.getElementById("tabelaEquipamentos");
  tabela.innerHTML   = "";
  const busca        = document.getElementById("busca").value.toLowerCase();
  const filtroStatus = document.getElementById("filtroStatus").value;
  const filtroTipo   = document.getElementById("filtroTipo").value;
  let validas=0, proximas=0, vencidas=0, descom=0, visivel=0;

  equipamentos.forEach((item, i) => {
    const proxima = calcularProxima(item.ultimaInspecao, item.validadeMeses);
    const dias    = calcularDias(proxima);
    const status  = obterStatusCalc(dias, item.statusCustom);
    if      (status.classe==="valida")          validas++;
    else if (status.classe==="proxima")         proximas++;
    else if (status.classe==="vencida")         vencidas++;
    else if (status.classe==="descomissionado") descom++;

    const match =
      (item.nome.toLowerCase().includes(busca) || item.tag.toLowerCase().includes(busca) || item.setor.toLowerCase().includes(busca)) &&
      (filtroStatus==="todos" || filtroStatus===status.classe) &&
      (filtroTipo==="todos"   || filtroTipo===item.tipo);
    if (!match) return;
    visivel++;

    const daysClass = status.classe==="descomissionado" ? "days-gray" : dias<0 ? "days-bad" : dias<=30 ? "days-warn" : "days-ok";
    const daysText  = status.classe==="descomissionado" ? "—" : dias<0 ? `${Math.abs(dias)}d vencido` : `${dias}d`;
    const proximaFmt = status.classe==="descomissionado" ? "—" : fmtData(proxima);
    const btnDescom  = status.classe!=="descomissionado"
      ? `<button class="btn" style="font-size:11px;padding:6px 10px;background:var(--gray-bg);color:var(--gray)" onclick="descomissionar(${item.id})">⊘ Descom.</button>`
      : `<button class="btn btn-green" style="font-size:11px;padding:6px 10px" onclick="reativar(${item.id})">↩ Reativar</button>`;

    const tr = document.createElement("tr");
    tr.className = "row-in";
    tr.style.animationDelay = `${i*0.03}s`;
    tr.innerHTML = `
      <td><strong style="font-weight:600">${item.nome}</strong></td>
      <td><span style="font-family:'IBM Plex Mono',monospace;font-size:12px;background:var(--surface2);padding:3px 8px;border-radius:5px;border:1px solid var(--border)">${item.tag}</span></td>
      <td>${item.setor}</td><td>${item.tipo}</td>
      <td>${fmtData(item.ultimaInspecao+"T00:00:00")}</td>
      <td>${proximaFmt}</td>
      <td class="days-cell ${daysClass}">${daysText}</td>
      <td>${item.responsavel}</td>
      <td><span class="status ${status.classe}">${status.texto}</span></td>
      <td><div class="acoes">
        <button class="btn btn-ghost" style="font-size:11px;padding:6px 10px" onclick="editarEquipamento(${item.id})">✏ Editar</button>
        ${btnDescom}
        <button class="btn btn-red" style="font-size:11px;padding:6px 10px" onclick="excluirEquipamento(${item.id})">🗑</button>
      </div></td>`;
    tabela.appendChild(tr);
  });

  if (visivel===0) {
    const tr = document.createElement("tr"); tr.className="empty-row";
    tr.innerHTML=`<td colspan="10"><span class="empty-icon">📋</span>Nenhum equipamento encontrado.</td>`;
    tabela.appendChild(tr);
  }

  animateCount("totalValidas",validas); animateCount("totalProximas",proximas);
  animateCount("totalVencidas",vencidas); animateCount("totalDescom",descom);
  document.getElementById("countLabel").textContent = `${visivel} registro(s)`;
  atualizarAlertas(vencidas, proximas);
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  const current = parseInt(el.textContent)||0;
  if (current===target) return;
  const step=target>current?1:-1, range=Math.abs(target-current);
  let v=current;
  const t=setInterval(()=>{ v+=step; el.textContent=v; if(v===target)clearInterval(t); }, Math.max(20,Math.min(100,range*10))/(range+1));
}

function atualizarAlertas(vencidas, proximas) {
  const av=document.getElementById("alertaVencidas"), ap=document.getElementById("alertaProximas");
  if(vencidas>0){ document.getElementById("alertaVencidasTxt").textContent=`${vencidas} equipamento(s) com inspeção vencida — ação imediata necessária.`; av.classList.add("ativo"); } else av.classList.remove("ativo");
  if(proximas>0){ document.getElementById("alertaProximasTxt").textContent=`${proximas} equipamento(s) vencem em até 30 dias.`; ap.classList.add("ativo"); } else ap.classList.remove("ativo");
}

// ── AÇÕES ──
function editarEquipamento(id) {
  const item=equipamentos.find(e=>e.id===id); if(!item)return;
  document.getElementById("equipamento").value=item.nome;
  document.getElementById("tag").value=item.tag;
  document.getElementById("setor").value=item.setor;
  document.getElementById("tipo").value=item.tipo;
  document.getElementById("ultimaInspecao").value=item.ultimaInspecao;
  document.getElementById("validadeMeses").value=item.validadeMeses;
  document.getElementById("responsavel").value=item.responsavel;
  document.getElementById("statusInicial").value=item.statusCustom||"ativo";
  editandoId=id;
  document.getElementById("btnSubmit").textContent="✔ Salvar alterações";
  document.getElementById("btnCancelar").style.display="inline-flex";
  document.getElementById("formMode").textContent="· editando";
  document.getElementById("formPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function excluirEquipamento(id) {
  const item=equipamentos.find(e=>e.id===id);
  abrirModal("Excluir equipamento",`Deseja realmente excluir <strong>${item?.nome}</strong>? Esta ação não pode ser desfeita.`,()=>{ equipamentos=equipamentos.filter(e=>e.id!==id); salvarDados(); renderizarTabela(); });
}
function descomissionar(id) {
  const item=equipamentos.find(e=>e.id===id);
  abrirModal("Descomissionar equipamento",`Confirma o descomissionamento de <strong>${item?.nome}</strong>?`,()=>{ equipamentos=equipamentos.map(e=>e.id===id?{...e,statusCustom:"descomissionado"}:e); salvarDados(); renderizarTabela(); });
}
function reativar(id) { equipamentos=equipamentos.map(e=>e.id===id?{...e,statusCustom:"ativo"}:e); salvarDados(); renderizarTabela(); }
function apagarTudo() { abrirModal("Apagar todos os registros","Esta ação irá remover <strong>todos</strong> os equipamentos permanentemente. Tem certeza?",()=>{ equipamentos=[]; salvarDados(); renderizarTabela(); }); }
function limparFiltros() { document.getElementById("busca").value=""; document.getElementById("filtroStatus").value="todos"; document.getElementById("filtroTipo").value="todos"; renderizarTabela(); }

function submitForm() {
  const campos=["equipamento","tag","setor","tipo","ultimaInspecao","validadeMeses","responsavel"];
  for(const id of campos){ if(!document.getElementById(id).value.trim()){ document.getElementById(id).focus(); shake(document.getElementById(id)); return; } }
  const item={ id:editandoId||Date.now(), nome:document.getElementById("equipamento").value.trim(), tag:document.getElementById("tag").value.trim(), setor:document.getElementById("setor").value.trim(), tipo:document.getElementById("tipo").value, ultimaInspecao:document.getElementById("ultimaInspecao").value, validadeMeses:Number(document.getElementById("validadeMeses").value), responsavel:document.getElementById("responsavel").value.trim(), statusCustom:document.getElementById("statusInicial").value };
  if(editandoId) equipamentos=equipamentos.map(e=>e.id===editandoId?item:e); else equipamentos.push(item);
  salvarDados(); resetForm(); renderizarTabela();
}
function resetForm() { ["equipamento","tag","setor","tipo","ultimaInspecao","validadeMeses","responsavel"].forEach(id=>document.getElementById(id).value=""); document.getElementById("statusInicial").value="ativo"; editandoId=null; document.getElementById("btnSubmit").textContent="＋ Adicionar"; document.getElementById("btnCancelar").style.display="none"; document.getElementById("formMode").textContent=""; }
function cancelarEdicao() { resetForm(); renderizarTabela(); }
function shake(el) { el.style.transition="transform .1s"; el.style.transform="translateX(-6px)"; setTimeout(()=>{el.style.transform="translateX(6px)"},100); setTimeout(()=>{el.style.transform="translateX(0)";el.style.transition=""},200); }

// ── MODAL ──
function abrirModal(titulo,msg,cb) { document.getElementById("modalTitle").textContent=titulo; document.getElementById("modalMsg").innerHTML=msg; document.getElementById("modalOverlay").classList.add("open"); modalCallback=cb; document.getElementById("modalConfirmBtn").onclick=()=>{cb();fecharModal();}; }
function fecharModal() { document.getElementById("modalOverlay").classList.remove("open"); modalCallback=null; }

// ── CSV ──
function exportarCSV() {
  if(!equipamentos.length){alert("Nenhum dado.");return;}
  let csv="Equipamento;TAG;Setor;Tipo;Ultima Inspecao;Validade (meses);Responsavel;Status\n";
  equipamentos.forEach(item=>{ const p=calcularProxima(item.ultimaInspecao,item.validadeMeses); const d=calcularDias(p); const s=obterStatusCalc(d,item.statusCustom); csv+=`${item.nome};${item.tag};${item.setor};${item.tipo};${item.ultimaInspecao};${item.validadeMeses};${item.responsavel};${s.texto}\n`; });
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="nr13_export.csv"; a.click();
}