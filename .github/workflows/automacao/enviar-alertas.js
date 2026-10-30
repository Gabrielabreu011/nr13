// NR-13 · Envio automático de alertas (Firestore -> Brevo)
// Roda no GitHub Actions. Nenhuma chave fica no código: tudo vem de variáveis de ambiente.

import admin from "firebase-admin";

process.env.TZ ||= "America/Sao_Paulo";

const DIAS_ALERTA = 30;
const { BREVO_API_KEY, FROM_EMAIL, DESTINATARIOS, FIREBASE_SERVICE_ACCOUNT } = process.env;

for (const [nome, valor] of Object.entries({ BREVO_API_KEY, FROM_EMAIL, DESTINATARIOS, FIREBASE_SERVICE_ACCOUNT })) {
  if (!valor) {
    console.error(`Variável de ambiente ausente: ${nome}`);
    process.exit(1);
  }
}

const destinatarios = DESTINATARIOS.split(/[\n,;]+/)
  .map(e => e.trim())
  .filter(e => e.includes("@"));

if (!destinatarios.length) {
  console.error("Nenhum destinatário válido em DESTINATARIOS.");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

// ── Mesmas regras do script.js do site ──
function calcularProxima(data, meses) {
  const d = new Date(data + "T00:00:00");
  d.setMonth(d.getMonth() + meses);
  return d;
}
function calcularDias(data) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const fut = new Date(data); fut.setHours(0, 0, 0, 0);
  return Math.ceil((fut - hoje) / 86400000);
}
function fmtData(d) { return new Date(d).toLocaleDateString("pt-BR"); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Monta e-mail (mesmo layout do site) ──
function gerarAssunto(vencidas, proximas) {
  const p = [];
  if (vencidas.length) p.push(`${vencidas.length} vencida(s)`);
  if (proximas.length) p.push(`${proximas.length} vencendo em breve`);
  return `⚠ NR-13 · Alerta de Inspeção — ${p.join(" | ")}`;
}

function linhaTabela(e) {
  const cor = e.status === "vencida" ? "#c8253d" : "#d9820a";
  const txt = e.dias < 0 ? `${Math.abs(e.dias)}d vencido` : `${e.dias}d restantes`;
  return `<tr style="border-bottom:1px solid #e2e6ea">
    <td style="padding:10px 14px;font-weight:600">${esc(e.nome)}</td>
    <td style="padding:10px 14px;font-family:monospace">${esc(e.tag)}</td>
    <td style="padding:10px 14px">${esc(e.setor)}</td>
    <td style="padding:10px 14px">${esc(e.tipo)}</td>
    <td style="padding:10px 14px">${e.proximaFmt}</td>
    <td style="padding:10px 14px;font-weight:700;color:${cor}">${txt}</td>
    <td style="padding:10px 14px">${esc(e.responsavel)}</td>
  </tr>`;
}

function blocoTabela(titulo, cor, icone, itens) {
  if (!itens.length) return "";
  const th = t => `<th style="padding:10px 14px;text-align:left;font-size:11px;color:#8e97a6;text-transform:uppercase">${t}</th>`;
  return `<div style="margin-bottom:32px">
    <h2 style="font-size:15px;font-weight:700;color:${cor};padding:12px 16px;background:${cor}18;border-left:4px solid ${cor};border-radius:4px;margin:0 0 12px">${icone} ${titulo} (${itens.length})</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;color:#1a1d23">
      <thead><tr style="background:#f0f2f5">
        ${["Equipamento", "TAG", "Setor", "Tipo", "Próx. Inspeção", "Prazo", "Responsável"].map(th).join("")}
      </tr></thead>
      <tbody>${itens.map(linhaTabela).join("")}</tbody>
    </table>
  </div>`;
}

function gerarHTML(vencidas, proximas) {
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const card = (n, rotulo, cor, bg, txt) =>
    n ? `<div style="background:${bg};border-left:4px solid ${cor};padding:12px 16px;border-radius:4px;flex:1;min-width:140px"><div style="font-size:28px;font-weight:700;color:${cor};font-family:monospace">${n}</div><div style="font-size:12px;color:${txt};text-transform:uppercase;font-weight:600">${rotulo}</div></div>` : "";
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:720px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden">
  <div style="background:#0d9e5c;padding:28px 32px">
    <span style="background:rgba(255,255,255,.2);color:#fff;font-family:monospace;font-size:13px;font-weight:700;padding:6px 12px;border-radius:6px">NR-13</span>
    <h1 style="color:#fff;font-size:20px;font-weight:700;margin:12px 0 0">Alerta de Inspeção</h1>
    <p style="color:rgba(255,255,255,.8);font-size:13px;margin:4px 0 0">Gerado em ${hoje}</p>
  </div>
  <div style="padding:20px 32px;background:#f7f8fa;border-bottom:1px solid #e2e6ea;display:flex;gap:20px;flex-wrap:wrap">
    ${card(vencidas.length, "Vencidas", "#c8253d", "#fde8eb", "#842029")}
    ${card(proximas.length, `Vencem em ${DIAS_ALERTA} dias`, "#d9820a", "#fef3e0", "#664d03")}
  </div>
  <div style="padding:28px 32px">
    ${blocoTabela("Inspeções Vencidas — Ação Imediata", "#c8253d", "⛔", vencidas)}
    ${blocoTabela("Vencendo em Breve — Atenção", "#d9820a", "⚠️", proximas)}
  </div>
  <div style="padding:20px 32px;background:#f7f8fa;border-top:1px solid #e2e6ea;text-align:center">
    <p style="font-size:12px;color:#8e97a6;margin:0">Enviado automaticamente pelo sistema NR-13. Não responda.</p>
  </div>
</div></body></html>`;
}

// ── Execução ──
const snap = await db.collection("equipamentos").get();

const alertas = snap.docs
  .map(doc => doc.data())
  .filter(i => i.statusCustom !== "descomissionado" && i.ultimaInspecao && i.validadeMeses)
  .map(i => {
    const proxima = calcularProxima(i.ultimaInspecao, Number(i.validadeMeses));
    const dias = calcularDias(proxima);
    const status = dias < 0 ? "vencida" : dias <= DIAS_ALERTA ? "proxima" : "valida";
    return { ...i, dias, status, proximaFmt: fmtData(proxima) };
  })
  .filter(i => i.status !== "valida");

if (!alertas.length) {
  console.log("Nenhum equipamento vencido ou próximo do vencimento. Nada enviado.");
  process.exit(0);
}

const vencidas = alertas.filter(a => a.status === "vencida").sort((a, b) => a.dias - b.dias);
const proximas = alertas.filter(a => a.status === "proxima").sort((a, b) => a.dias - b.dias);

const res = await fetch("https://api.brevo.com/v3/smtp/email", {
  method: "POST",
  headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
  body: JSON.stringify({
    sender: { name: "NR-13 Alertas", email: FROM_EMAIL },
    to: destinatarios.map(email => ({ email })),
    subject: gerarAssunto(vencidas, proximas),
    htmlContent: gerarHTML(vencidas, proximas),
  }),
});

const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Erro na API Brevo:", res.status, data.message || data);
  process.exit(1);
}

console.log(`E-mail enviado para ${destinatarios.length} destinatário(s): ${vencidas.length} vencida(s), ${proximas.length} em alerta.`);
