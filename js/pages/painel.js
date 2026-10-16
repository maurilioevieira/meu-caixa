// =====================================================================
//  pages/painel.js — Painel (tela inicial)
// ---------------------------------------------------------------------
//  Resumo do mês atual, em uma tela:
//   • Alerta de contas vencidas / vencendo nos próximos 5 dias
//   • Saldo em contas, receitas, despesas e resultado do mês
//   • Próximos vencimentos (15 dias) com "Pagar/Receber" direto
//   • Contas e cartões (saldo, fatura em aberto, limite)
//   • Despesas por categoria e orçamentos do mês
//   • Receitas × despesas dos últimos 6 meses
//
//  Mesmo critério da página Lançamentos: o mês de cada lançamento é o
//  do VENCIMENTO (regime de caixa). Assim os números das duas páginas
//  sempre batem.
// =====================================================================

import { supabase } from '../supabase.js';
import { state } from '../state.js';
import { fetchAccounts, fetchCategories, byId } from '../data.js';
import { toast } from '../ui.js';
import {
  formatMoney, formatDayMonth, formatMonth, formatMonthTitle,
  todayISO, currentYM, addMonths, monthRange,
  escapeHTML, safeColor, initials
} from '../utils.js';

// Cores do gráfico de 6 meses — validadas para daltonismo (azul × laranja)
const COLOR_INCOME = '#2F6BB0';
const COLOR_EXPENSE = '#D9772F';

const UPCOMING_DAYS = 15;   // janela de "próximos vencimentos"
const ALERT_DAYS = 5;       // janela do alerta do topo
const MAX_CATEGORIES = 6;   // demais categorias somam em "Outras"

// Soma dias a uma data ISO
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// Diferença em dias entre duas datas ISO (b − a)
function daysBetween(a, b) {
  const t = (iso) => Date.UTC(...iso.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  return Math.round((t(b) - t(a)) / 86400000);
}

// ---------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------
async function loadData() {
  const today = todayISO();
  const ym = currentYM();
  const firstYM = addMonths(ym, -5);
  const { to } = monthRange(ym);

  const [accounts, categories, balRes, invRes, histRes, pendRes] = await Promise.all([
    fetchAccounts(),
    fetchCategories(),
    supabase.from('v_account_balances').select('account_id, balance'),
    supabase.from('v_card_invoices').select('account_id, invoice_month, due_date, pending_total')
      .eq('paid', false).order('invoice_month'),
    // Últimos 6 meses (receitas e despesas) — alimenta resumo, categorias e gráfico
    supabase.from('v_transactions').select('type, amount, due_date, category_id, status, account_id')
      .in('type', ['income', 'expense'])
      .gte('due_date', `${firstYM}-01`).lte('due_date', to),
    // Tudo que está em aberto até daqui a 15 dias (inclui vencidos de meses anteriores)
    supabase.from('v_transactions').select('id, type, description, amount, due_date, status, account_id, category_id')
      .is('paid_at', null).in('type', ['income', 'expense'])
      .lte('due_date', addDays(today, UPCOMING_DAYS))
      .order('due_date')
  ]);
  for (const r of [balRes, invRes, histRes, pendRes]) if (r.error) throw r.error;

  return {
    today, ym, firstYM,
    accounts, categories,
    accMap: byId(accounts),
    catMap: byId(categories),
    balance: new Map(balRes.data.map((b) => [b.account_id, Number(b.balance)])),
    invoices: invRes.data,
    hist: histRes.data,
    pending: pendRes.data
  };
}

// ---------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------
export async function render(view) {
  view.innerHTML = '<p class="muted">Carregando painel…</p>';
  const d = await loadData();

  view.innerHTML = `
    <header class="page-head">
      <div>
        <div class="eyebrow">Olá, ${escapeHTML(state.household.me.name)}</div>
        <h1>${formatMonthTitle(d.ym)}</h1>
      </div>
      <div class="page-actions">
        <a class="btn btn-primary btn-as-link" href="#/lancamentos?novo=1">+ Novo lançamento</a>
      </div>
    </header>

    ${alertHTML(d)}
    ${tilesHTML(d)}

    <div class="grid-2">
      ${upcomingHTML(d)}
      ${accountsHTML(d)}
      ${categoriesHTML(d)}
      ${budgetsHTML(d)}
    </div>

    ${historyHTML(d)}
  `;

  view.onclick = async (e) => {
    const btn = e.target.closest('[data-action=pay]');
    if (!btn) return;
    btn.disabled = true;
    const { error } = await supabase.from('transactions')
      .update({ paid_at: todayISO() }).eq('id', btn.dataset.id);
    if (error) { btn.disabled = false; return toast(error.message, 'error'); }
    toast(btn.dataset.kind === 'income' ? 'Marcado como recebido.' : 'Marcado como pago.');
    await render(view);
  };
}

// ---------------------------------------------------------------------
// Itens em aberto (lançamentos de conta comum + faturas de cartão)
// ---------------------------------------------------------------------
function openItems(d) {
  const items = [];
  for (const t of d.pending) {
    const acc = d.accMap.get(t.account_id);
    if (acc?.kind === 'credit_card') continue;   // compras do cartão entram pela fatura
    items.push({
      kind: t.type, id: t.id, due: t.due_date, amount: Number(t.amount),
      title: t.description,
      sub: `${d.catMap.get(t.category_id)?.name ?? ''} · ${acc?.name ?? ''}`
    });
  }
  for (const inv of d.invoices) {
    if (inv.due_date > addDays(d.today, UPCOMING_DAYS)) continue;
    const card = d.accMap.get(inv.account_id);
    if (!card || card.archived) continue;
    items.push({
      kind: 'invoice', due: inv.due_date, amount: Number(inv.pending_total),
      title: `Fatura ${card.name}`,
      sub: `Cartão · fatura de ${formatMonth(inv.invoice_month)}`
    });
  }
  return items.sort((a, b) => a.due.localeCompare(b.due));
}

// ---------------------------------------------------------------------
// Alerta do topo
// ---------------------------------------------------------------------
function alertHTML(d) {
  const items = openItems(d).filter((i) => i.kind !== 'income');
  const overdue = items.filter((i) => i.due < d.today);
  const soon = items.filter((i) => i.due >= d.today && daysBetween(d.today, i.due) <= ALERT_DAYS);
  if (!overdue.length && !soon.length) return '';

  const parts = [];
  if (overdue.length) parts.push(`${overdue.length} conta(s) vencida(s), somando ${formatMoney(overdue.reduce((s, i) => s + i.amount, 0))}`);
  if (soon.length) parts.push(`${soon.length} vencendo nos próximos ${ALERT_DAYS} dias, somando ${formatMoney(soon.reduce((s, i) => s + i.amount, 0))}`);

  return `
    <div class="alert ${overdue.length ? 'alert-error' : 'alert-warn'} alert-icon" role="status">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>
      <span>${parts.join('; ')}.</span>
    </div>`;
}

// ---------------------------------------------------------------------
// Resumo do mês
// ---------------------------------------------------------------------
function tilesHTML(d) {
  const month = d.hist.filter((t) => t.due_date.startsWith(d.ym));
  const sum = (list) => list.reduce((s, t) => s + Number(t.amount), 0);
  const income = sum(month.filter((t) => t.type === 'income'));
  const expense = sum(month.filter((t) => t.type === 'expense'));
  const openIncome = sum(month.filter((t) => t.type === 'income' && t.status !== 'paid'));
  const openExpense = sum(month.filter((t) => t.type === 'expense' && t.status !== 'paid'));
  const result = income - expense;

  const banks = d.accounts.filter((a) => a.kind !== 'credit_card' && !a.archived);
  const totalBanks = banks.reduce((s, a) => s + (d.balance.get(a.id) ?? 0), 0);

  return `
    <section class="tiles tiles-4" aria-label="Resumo do mês">
      <div class="tile tile-dark">
        <div class="tile-label">Saldo em contas</div>
        <div class="tile-value">${formatMoney(totalBanks)}</div>
        <div class="tile-note">${banks.length} conta(s) · hoje</div>
      </div>
      <div class="tile">
        <div class="tile-label">Receitas do mês</div>
        <div class="tile-value text-income">${formatMoney(income)}</div>
        <div class="tile-note">${openIncome > 0 ? `${formatMoney(openIncome)} a receber` : 'tudo recebido'}</div>
      </div>
      <div class="tile">
        <div class="tile-label">Despesas do mês</div>
        <div class="tile-value text-expense">${formatMoney(expense)}</div>
        <div class="tile-note">${openExpense > 0 ? `${formatMoney(openExpense)} a pagar` : 'tudo pago'}</div>
      </div>
      <div class="tile">
        <div class="tile-label">Resultado previsto</div>
        <div class="tile-value">${result >= 0 ? '+ ' : '− '}${formatMoney(Math.abs(result))}</div>
        <div class="tile-note">receitas − despesas do mês</div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------
// Próximos vencimentos
// ---------------------------------------------------------------------
function upcomingHTML(d) {
  const items = openItems(d).slice(0, 8);
  const row = (i) => {
    const overdue = i.due < d.today;
    const dueLabel = overdue ? 'vencido' : i.due === d.today ? 'hoje' : '';
    const action = i.kind === 'invoice'
      ? `<a class="btn-sm" href="#/contas">Pagar</a>`
      : `<button type="button" class="btn-sm" data-action="pay" data-id="${i.id}" data-kind="${i.kind}">${i.kind === 'income' ? 'Receber' : 'Pagar'}</button>`;
    return `
      <li class="up-row">
        <div class="up-date ${overdue ? 'up-overdue' : i.kind === 'income' ? 'up-income' : ''}">
          ${formatDayMonth(i.due)}${dueLabel ? `<small>${dueLabel}</small>` : ''}
        </div>
        <div class="up-main">
          <div class="up-title">${escapeHTML(i.title)}</div>
          <div class="up-sub">${escapeHTML(i.sub)}</div>
        </div>
        <div class="up-amount ${i.kind === 'income' ? 'text-income' : ''}">${i.kind === 'income' ? '+ ' : ''}${formatMoney(i.amount)}</div>
        ${action}
      </li>`;
  };

  return `
    <section class="card" aria-labelledby="h-up">
      <div class="card-head">
        <h2 id="h-up">Próximos vencimentos</h2>
        <a class="card-link" href="#/lancamentos">Ver lançamentos</a>
      </div>
      ${items.length
        ? `<ul class="up-list">${items.map(row).join('')}</ul>`
        : `<p class="empty">Nada vencendo nos próximos ${UPCOMING_DAYS} dias.</p>`}
    </section>`;
}

// ---------------------------------------------------------------------
// Contas e cartões
// ---------------------------------------------------------------------
function accountsHTML(d) {
  const active = d.accounts.filter((a) => !a.archived);
  const invoiceOf = new Map();
  for (const inv of d.invoices) if (!invoiceOf.has(inv.account_id)) invoiceOf.set(inv.account_id, inv);

  const bankRow = (a) => `
    <li class="mini-acc">
      <span class="mini-avatar" style="background:${safeColor(a.color)}" aria-hidden="true">${escapeHTML(initials(a.name))}</span>
      <span class="mini-name">${escapeHTML(a.name)}</span>
      <strong class="${(d.balance.get(a.id) ?? 0) < 0 ? 'text-expense' : ''}">${formatMoney(d.balance.get(a.id) ?? 0)}</strong>
    </li>`;

  const cardRow = (a) => {
    const debt = Math.max(0, -(d.balance.get(a.id) ?? 0));
    const limit = a.credit_limit != null ? Number(a.credit_limit) : null;
    const pct = limit ? Math.min(100, Math.round((debt / limit) * 100)) : 0;
    const inv = invoiceOf.get(a.id);
    return `
      <li class="mini-card">
        <div class="mini-card-top">
          <span class="mini-avatar" style="background:${safeColor(a.color)}" aria-hidden="true">${escapeHTML(initials(a.name))}</span>
          <span class="mini-name">${escapeHTML(a.name)}</span>
          <strong>${inv ? formatMoney(inv.pending_total) : '—'}</strong>
        </div>
        <div class="mini-sub">${inv ? `fatura de ${formatMonth(inv.invoice_month)} · vence ${formatDayMonth(inv.due_date)}` : 'sem fatura em aberto'}</div>
        ${limit !== null ? `
          <div class="bar" role="img" aria-label="Limite usado: ${pct}%"><div class="bar-fill ${pct >= 80 ? 'bar-warn' : ''}" style="width:${pct}%"></div></div>
          <div class="mini-sub">Disponível ${formatMoney(limit - debt)} de ${formatMoney(limit)}${pct >= 80 ? ' · acima de 80% do limite' : ''}</div>` : ''}
      </li>`;
  };

  const banks = active.filter((a) => a.kind !== 'credit_card');
  const cards = active.filter((a) => a.kind === 'credit_card');

  return `
    <section class="card" aria-labelledby="h-acc">
      <div class="card-head">
        <h2 id="h-acc">Contas e cartões</h2>
        <a class="card-link" href="#/contas">Gerenciar</a>
      </div>
      ${banks.length ? `<ul class="mini-list">${banks.map(bankRow).join('')}</ul>` : '<p class="empty">Nenhuma conta.</p>'}
      ${cards.length ? `<ul class="mini-list mini-list-cards">${cards.map(cardRow).join('')}</ul>` : ''}
    </section>`;
}

// ---------------------------------------------------------------------
// Despesas por categoria (mês atual) — uma série, uma cor
// ---------------------------------------------------------------------
function categoriesHTML(d) {
  const month = d.hist.filter((t) => t.type === 'expense' && t.due_date.startsWith(d.ym));
  const total = month.reduce((s, t) => s + Number(t.amount), 0);

  const byCat = new Map();
  for (const t of month) byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) + Number(t.amount));
  let list = [...byCat.entries()]
    .map(([id, value]) => ({ cat: d.catMap.get(id), value }))
    .sort((a, b) => b.value - a.value);

  if (list.length > MAX_CATEGORIES) {
    const rest = list.slice(MAX_CATEGORIES - 1);
    list = list.slice(0, MAX_CATEGORIES - 1);
    list.push({ cat: { name: `Outras (${rest.length})`, color: '#8A948E' }, value: rest.reduce((s, x) => s + x.value, 0) });
  }
  const max = Math.max(...list.map((x) => x.value), 1);

  return `
    <section class="card" aria-labelledby="h-cat">
      <h2 id="h-cat">Despesas por categoria</h2>
      ${list.length ? `
        <ul class="hbars">
          ${list.map((x) => `
            <li class="hbar">
              <div class="hbar-label">
                <span><span class="dot" style="background:${safeColor(x.cat?.color)}"></span>${escapeHTML(x.cat?.name ?? 'Sem categoria')}</span>
                <span><strong>${formatMoney(x.value)}</strong> <span class="muted">· ${Math.round((x.value / total) * 100)}%</span></span>
              </div>
              <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, Math.round((x.value / max) * 100))}%"></div></div>
            </li>`).join('')}
        </ul>`
        : '<p class="empty">Nenhuma despesa neste mês ainda.</p>'}
    </section>`;
}

// ---------------------------------------------------------------------
// Orçamentos (categorias com limite mensal definido)
// ---------------------------------------------------------------------
function budgetsHTML(d) {
  const withBudget = d.categories.filter((c) => c.kind === 'expense' && !c.archived && c.monthly_budget);
  if (!withBudget.length) {
    return `
      <section class="card" aria-labelledby="h-bud">
        <h2 id="h-bud">Orçamentos do mês</h2>
        <p class="empty">Nenhum limite mensal definido. Os limites por categoria (inclusive o de
          bebida) serão configurados na página Categorias, no próximo passo.</p>
      </section>`;
  }
  const spent = new Map();
  for (const t of d.hist) {
    if (t.type === 'expense' && t.due_date.startsWith(d.ym)) {
      spent.set(t.category_id, (spent.get(t.category_id) ?? 0) + Number(t.amount));
    }
  }
  return `
    <section class="card" aria-labelledby="h-bud">
      <h2 id="h-bud">Orçamentos do mês</h2>
      <ul class="hbars">
        ${withBudget.map((c) => {
          const s = spent.get(c.id) ?? 0;
          const limit = Number(c.monthly_budget);
          const pct = Math.round((s / limit) * 100);
          const over = pct >= 100, warn = pct >= 80;
          return `
            <li class="hbar">
              <div class="hbar-label">
                <span><span class="dot" style="background:${safeColor(c.color)}"></span>${escapeHTML(c.name)}</span>
                <span>${formatMoney(s)} <span class="muted">de ${formatMoney(limit)} · ${pct}%</span></span>
              </div>
              <div class="hbar-track"><div class="hbar-fill ${warn ? 'bar-warn' : 'hbar-ok'}" style="width:${Math.min(100, pct)}%"></div></div>
              ${over ? '<div class="hbar-note">Limite ultrapassado</div>' : warn ? '<div class="hbar-note">Acima de 80% do limite</div>' : ''}
            </li>`;
        }).join('')}
      </ul>
    </section>`;
}

// ---------------------------------------------------------------------
// Receitas × despesas — últimos 6 meses (barras agrupadas)
// ---------------------------------------------------------------------
function historyHTML(d) {
  const months = Array.from({ length: 6 }, (_, i) => addMonths(d.firstYM, i));
  const data = months.map((ym) => {
    const rows = d.hist.filter((t) => t.due_date.startsWith(ym));
    const inc = rows.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const exp = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    return { ym, inc, exp };
  });
  const max = Math.max(...data.map((x) => Math.max(x.inc, x.exp)), 1);
  const h = (v) => (v > 0 ? Math.max(3, Math.round((v / max) * 150)) : 0);
  const short = (ym) => formatMonth(ym).slice(0, 3);
  const hasData = data.some((x) => x.inc || x.exp);

  return `
    <section class="card" aria-labelledby="h-hist">
      <div class="card-head">
        <h2 id="h-hist">Receitas × despesas · últimos 6 meses</h2>
        <div class="legend" aria-hidden="true">
          <span><i style="background:${COLOR_INCOME}"></i>Receitas</span>
          <span><i style="background:${COLOR_EXPENSE}"></i>Despesas</span>
        </div>
      </div>
      ${hasData ? `
        <div class="chart-scroll">
          <div class="cols" role="list">
            ${data.map((x) => `
              <div class="col ${x.ym === d.ym ? 'col-current' : ''}" role="listitem" tabindex="0"
                   aria-label="${formatMonth(x.ym)}: receitas ${formatMoney(x.inc)}, despesas ${formatMoney(x.exp)}">
                <div class="col-bars">
                  <div class="col-bar" style="height:${h(x.inc)}px;background:${COLOR_INCOME}"></div>
                  <div class="col-bar" style="height:${h(x.exp)}px;background:${COLOR_EXPENSE}"></div>
                </div>
                <div class="col-label">${short(x.ym)}</div>
                <div class="col-tip" aria-hidden="true">
                  <strong>${formatMonthTitle(x.ym)}</strong>
                  <span><i style="background:${COLOR_INCOME}"></i>Receitas ${formatMoney(x.inc)}</span>
                  <span><i style="background:${COLOR_EXPENSE}"></i>Despesas ${formatMoney(x.exp)}</span>
                  <span>Resultado ${x.inc - x.exp >= 0 ? '+ ' : '− '}${formatMoney(Math.abs(x.inc - x.exp))}</span>
                </div>
              </div>`).join('')}
          </div>
        </div>
        <details class="table-view">
          <summary>Ver em tabela</summary>
          <table>
            <thead><tr><th scope="col">Mês</th><th scope="col">Receitas</th><th scope="col">Despesas</th><th scope="col">Resultado</th></tr></thead>
            <tbody>
              ${data.map((x) => `<tr><th scope="row">${formatMonthTitle(x.ym)}</th><td>${formatMoney(x.inc)}</td><td>${formatMoney(x.exp)}</td><td>${formatMoney(x.inc - x.exp)}</td></tr>`).join('')}
            </tbody>
          </table>
        </details>`
        : '<p class="empty">O gráfico aparece conforme você lança receitas e despesas.</p>'}
    </section>`;
}
