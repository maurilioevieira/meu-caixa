// =====================================================================
//  utils.js — Funções auxiliares usadas em todo o app
// =====================================================================

// ---------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Datas — sempre como texto ISO ("2026-10-16"), sem passar por Date
// quando possível, para nunca sofrer com fuso horário.
// ---------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');

// "2026-10-16" → "16/10/2026"
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

// "2026-11-01" ou "2026-11" → "novembro de 2026"
const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function formatMonth(iso) {
  if (!iso) return '';
  const [y, m] = iso.slice(0, 7).split('-');
  return `${monthNames[Number(m) - 1]} de ${y}`;
}

// "2026-11" → "Novembro de 2026"
export function formatMonthTitle(ym) {
  const s = formatMonth(ym);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Data de hoje no formato ISO, no fuso local do aparelho
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Mês atual: "2026-10"
export function currentYM() {
  return todayISO().slice(0, 7);
}

// Soma meses a um "AAAA-MM": addMonths("2026-12", 1) → "2027-01"
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

// Primeiro e último dia de um "AAAA-MM"
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
}

// ---------------------------------------------------------------------
// Cartão de crédito — mesma regra da função card_invoice_month do banco.
// Usada só para MOSTRAR a previsão no formulário; quem grava é o banco.
//   Fecha 9, vence 16: compra 05/10 → fatura out (16/10); 14/10 → nov (16/11)
//   Fecha 25, vence 5: compra 20/10 → fecha 25/10 → vence 05/11
// Retorna { ym: "2026-11", dueDate: "2026-11-16" }
// ---------------------------------------------------------------------
export function cardInvoiceFor(closingDay, dueDay, isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  let ym = `${y}-${pad(m)}`;
  if (d >= closingDay) ym = addMonths(ym, 1);   // compra no dia do fechamento já vai para a próxima
  if (dueDay <= closingDay) ym = addMonths(ym, 1);
  return { ym, dueDate: `${ym}-${pad(dueDay)}` };
}

// ---------------------------------------------------------------------
// Texto e segurança
// ---------------------------------------------------------------------

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

// Iniciais para o "avatar": "Caixa Econômica" → "CE"; "Santander - Maurílio" → "SM"
// Ignora palavras que não têm letra nem número (como o "-").
export function initials(name) {
  const parts = String(name || '')
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Mensagens de erro do Supabase traduzidas para o usuário
export function friendlyError(error) {
  const msg = (error && (error.message || error.toString())) || 'Erro desconhecido';
  const code = error && error.code;
  if (code === '23503') return 'Este registro está em uso por lançamentos e não pode ser excluído. Arquive em vez de excluir.';
  if (code === '23505') return 'Já existe um registro igual.';
  if (code === '23514') return 'Algum valor está fora do permitido. Confira os campos.';
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (/row-level security/i.test(msg)) return 'Sem permissão para esta operação.';
  if (/JWT expired/i.test(msg)) return 'Sua sessão expirou. Entre novamente.';
  return msg;
}
