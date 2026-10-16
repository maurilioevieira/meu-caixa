// =====================================================================
//  utils.js — Funções auxiliares usadas em todo o app
// =====================================================================

// Formata número como moeda brasileira: 1234.5 → "R$ 1.234,50"
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatMoney(value) {
  return brl.format(Number(value) || 0);
}

// Converte texto digitado em número: "1.234,56" → 1234.56
// Arredonda em centavos para nunca enviar 0.30000000000000004 ao banco.
export function parseMoney(text) {
  const clean = String(text).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

// "2026-10-16" → "16/10/2026" (sem passar por Date, evita erro de fuso)
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// Data de hoje no formato ISO, no fuso local do aparelho
export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Escapa texto antes de inserir em HTML (evita que uma descrição como
// "<img onerror=...>" vire código executável na página)
export function escapeHTML(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Mensagens de erro do Supabase traduzidas para o usuário
export function friendlyError(error) {
  const msg = (error && (error.message || error.toString())) || 'Erro desconhecido';
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (/row-level security/i.test(msg)) return 'Sem permissão para esta operação.';
  if (/JWT expired/i.test(msg)) return 'Sua sessão expirou. Entre novamente.';
  return msg;
}
