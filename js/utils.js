// =====================================================================
//  utils.js — Funções auxiliares usadas em todo o app
// =====================================================================

// Formata número como moeda brasileira: 1234.5 → "R$ 1.234,50"
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatMoney(value) {
  return brl.format(Number(value) || 0);
}

// Número → texto para preencher um campo de valor: 1234.5 → "1.234,50"
const plain = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function moneyToInput(value) {
  return value === null || value === undefined || value === '' ? '' : plain.format(Number(value));
}

// Converte o texto digitado em número, aceitando os jeitos comuns de digitar:
//   "1.234,56"  "1234,56"  "1234.56"  "1.500"  "R$ 50"  "-200,00"
// Regras:
//   • Com vírgula: a vírgula é o decimal e os pontos são milhar.
//   • Sem vírgula: um ponto seguido de 3 dígitos é milhar ("1.500" = 1500);
//     um ponto seguido de 1 ou 2 dígitos é decimal (teclado do celular).
// Arredonda em centavos para nunca enviar 0.30000000000000004 ao banco.
// Retorna NaN quando o texto não é um valor válido.
export function parseMoney(text) {
  let s = String(text ?? '').trim().replace(/R\$|\s/g, '');
  if (!s) return NaN;

  const negative = s.startsWith('-');
  s = s.replace(/^-/, '');

  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) {
    s = s.replace(/\./g, '');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const n = Math.round(Number(s) * 100) / 100;
  return negative ? -n : n;
}

// "2026-10-16" → "16/10/2026" (sem passar por Date, evita erro de fuso)
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// "2026-10-16" → "16/10"
export function formatDayMonth(iso) {
  if (!iso) return '';
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

// "2026-11-01" → "novembro de 2026"
const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function formatMonth(iso) {
  if (!iso) return '';
  const [y, m] = iso.slice(0, 7).split('-');
  return `${monthNames[Number(m) - 1]} de ${y}`;
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

// Cor segura para usar em style="" (só aceita #RRGGBB)
export function safeColor(color, fallback = '#56635C') {
  return /^#[0-9A-Fa-f]{6}$/.test(color || '') ? color : fallback;
}

// Iniciais para o "avatar" de uma conta: "Caixa Econômica" → "CE"
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Mensagens de erro do Supabase traduzidas para o usuário
export function friendlyError(error) {
  const msg = (error && (error.message || error.toString())) || 'Erro desconhecido';
  const code = error && error.code;
  if (code === '23503') return 'Este registro está em uso por lançamentos e não pode ser excluído. Arquive em vez de excluir.';
  if (code === '23505') return 'Já existe um registro com esse nome.';
  if (code === '23514') return 'Algum valor está fora do permitido. Confira os campos.';
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (/row-level security/i.test(msg)) return 'Sem permissão para esta operação.';
  if (/JWT expired/i.test(msg)) return 'Sua sessão expirou. Entre novamente.';
  return msg;
}
