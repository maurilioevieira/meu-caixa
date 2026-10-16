// =====================================================================
//  pages/acompanhamento.js — Acompanhamento de categoria (ex.: bebida)
// ---------------------------------------------------------------------
//  Página dedicada às categorias marcadas como "acompanhadas" em
//  Categorias. A primeira é "Bebida alcoólica".
//
//  DIFERENÇA IMPORTANTE em relação ao Painel e aos Lançamentos:
//  aqui o mês de cada gasto é o da DATA DA COMPRA, não o do vencimento.
//  O objetivo é entender o CONSUMO (quando e quanto se gasta), e não o
//  fluxo de caixa. Por isso uma cerveja comprada no cartão em 14/10
//  conta em outubro aqui, mesmo que a fatura vença em novembro.
//
//  Mostra:
//   • Gasto do mês × limite mensal da categoria
//   • Dias com gasto e média por ocasião (com o mês anterior ao lado)
//   • Acumulado do ano, média mensal e peso no total de despesas
//   • Evolução mês a mês no ano, com a linha do limite
//   • Gasto por dia da semana (em que dias o consumo se concentra)
//   • Lançamentos do mês
// =====================================================================

import { supabase } from '../supabase.js';
import { fetchAccounts, fetchCategories, byId } from '../data.js';
import {
  formatMoney, formatDayMonth, formatMonth, formatMonthTitle,
  todayISO, currentYM, addMonths, monthRange,
  escapeHTML, safeColor
} from '../utils.js';

const COLOR_BAR = '#2F6BB0';    // série única: uma cor só (validada no painel)
const COLOR_OVER = '#D9772F';   // mês acima do limite (sempre com texto junto)
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAYS_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// Estado da página (permanece ao trocar de página e voltar)
let ym = currentYM();
let selectedCategoryId = null;

function weekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ---------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------
export async function render(view) {
  view.innerHTML = '<p class="muted">Carregando acompanhamento…</p>';

  const [categories, accounts] = await Promise.all([fetchCategories(), fetchAccounts()]);
  const tracked = categories.filter((c) => c.is_tracked && c.kind === 'expense' && !c.archived);

  if (!tracked.length) {
    view.innerHTML = `
      <header class="page-head"><h1>Acompanhamento</h1></header>
      <section class="card">
        <p class="empty">Nenhuma categoria está marcada para acompanhamento.
          Em <a href="#/categorias">Categorias</a>, abra “Editar” e marque
          “Acompanhar esta categoria em página própria”.</p>
      </section>`;
    return;
  }

  if (!tracked.some((c) => c.id === selectedCategoryId)) {
    const bebida = tracked.find((c) => /bebida/i.test(c.name));
    selectedCategoryId = (bebida ?? tracked[0]).id;
  }
  const cat = tracked.find((c) => c.id === selectedCategoryId);
  const accMap = byId(accounts);

  // Período carregado: dezembro do ano anterior (para comparar janeiro)
  // até dezembro do ano do mês escolhido.
  const year = ym.slice(0, 4);
  const from = `${Number(year) - 1}-12-01`;
  const to = `${year}-12-31`;

  const [catRes, allRes] = await Promise.all([
    supabase.from('transactions').select('id, description, amount, occurred_on, account_id, notes')
      .eq('type', 'expense').eq('category_id', cat.id)
      .gte('occurred_on', from).lte('occurred_on', to)
      .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }),
    // Total de despesas do ano (para o "peso" da categoria), também pela data da compra
    supabase.from('transactions').select('amount, occurred_on')
      .eq('type', 'expense').gte('occurred_on', `${year}-01-01`).lte('occurred_on', to)
  ]);
  if (catRes.error) throw catRes.error;
  if (allRes.error) throw allRes.error;

  const rows = catRes.data.map((r) => ({ ...r, amount: Number(r.amount) }));
  const limit = cat.monthly_budget ? Number(cat.monthly_budget) : null;
  const today = todayISO();
  const nowYM = currentYM();

  // ------------------------- Mês escolhido e anterior -------------------------
  const inMonth = (m) => rows.filter((r) => r.occurred_on.startsWith(m));
  const stats = (list) => {
    const total = list.reduce((s, r) => s + r.amount, 0);
    const days = new Set(list.map((r) => r.occurred_on)).size;
    return { total, days, avg: days ? total / days : 0 };
  };
  const monthRows = inMonth(ym);
  const cur = stats(monthRows);
  const prevYM = addMonths(ym, -1);
  const prev = stats(inMonth(prevYM));

  // Dias do mês considerados: até hoje no mês atual; o mês todo nos passados
  const { to: monthEnd } = monthRange(ym);
  const daysInMonth = Number(monthEnd.slice(8, 10));
  const daysElapsed = ym === nowYM ? Number(today.slice(8, 10)) : ym < nowYM ? daysInMonth : 0;

  // ------------------------------- Ano -------------------------------
  const yearRows = rows.filter((r) => r.occurred_on.startsWith(year));
  const yearTotal = yearRows.reduce((s, r) => s + r.amount, 0);
  const lastMonthOfYear = year === nowYM.slice(0, 4) ? Number(nowYM.slice(5, 7)) : year < nowYM.slice(0, 4) ? 12 : 0;
  const yearAvg = lastMonthOfYear ? yearTotal / lastMonthOfYear : 0;
  const allExpenses = allRes.data.reduce((s, r) => s + Number(r.amount), 0);
  const share = allExpenses ? (yearTotal / allExpenses) * 100 : 0;

  // Meses do ano
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}`;
    const s = stats(inMonth(m));
    return { ym: m, ...s, future: m > nowYM };
  });
  const monthsOver = limit ? months.filter((m) => !m.future && m.total > limit).length : 0;

  // Dia da semana (ano inteiro até agora)
  const byWeekday = Array(7).fill(0);
  const countWeekday = Array(7).fill(0);
  const seenDays = new Set();
  for (const r of yearRows) {
    byWeekday[weekday(r.occurred_on)] += r.amount;
    if (!seenDays.has(r.occurred_on)) { seenDays.add(r.occurred_on); countWeekday[weekday(r.occurred_on)]++; }
  }
  const topWeekday = byWeekday.some((v) => v > 0) ? byWeekday.indexOf(Math.max(...byWeekday)) : -1;

  // ------------------------------- Desenho -------------------------------
  const pct = limit ? Math.round((cur.total / limit) * 100) : 0;
  const diff = (a, b) => {
    if (!b) return '';
    const d = a - b;
    if (Math.abs(d) < 0.005) return 'igual ao mês anterior';
    return `${d > 0 ? 'mais' : 'menos'} que o mês anterior (${formatMoney(b)})`;
  };

  view.innerHTML = `
    <header class="page-head">
      <div>
        <div class="eyebrow">Acompanhamento · pela data da compra</div>
        <h1 class="title-with-dot"><span class="dot dot-lg" style="background:${safeColor(cat.color)}"></span>${escapeHTML(cat.name)}</h1>
      </div>
      <div class="page-actions">
        ${tracked.length > 1 ? `
          <label class="sr-only" for="acp-cat">Categoria acompanhada</label>
          <select id="acp-cat" class="select-inline">
            ${tracked.map((c) => `<option value="${c.id}" ${c.id === cat.id ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
          </select>` : ''}
        <a class="btn btn-primary btn-as-link" href="#/lancamentos?novo=1&cat=${cat.id}">+ Registrar gasto</a>
      </div>
    </header>

    <nav class="month-nav" aria-label="Escolher mês">
      <button type="button" class="icon-btn" data-action="prev" aria-label="Mês anterior">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>
      </button>
      <h2 class="month-title">${formatMonthTitle(ym)}</h2>
      <button type="button" class="icon-btn" data-action="next" aria-label="Próximo mês">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
      </button>
      ${ym !== nowYM ? '<button type="button" class="btn-link" data-action="today">Voltar ao mês atual</button>' : ''}
    </nav>

    <section class="tiles tiles-4" aria-label="Resumo">
      <div class="tile">
        <div class="tile-label">Gasto no mês</div>
        <div class="tile-value ${limit && pct >= 100 ? 'text-expense' : ''}">${formatMoney(cur.total)}</div>
        ${limit ? `
          <div class="bar" role="img" aria-label="${pct}% do limite"><div class="bar-fill ${pct >= 80 ? 'bar-warn' : ''}" style="width:${Math.min(100, pct)}%"></div></div>
          <div class="tile-note">${pct}% do limite de ${formatMoney(limit)} ·
            ${cur.total <= limit ? `restam ${formatMoney(limit - cur.total)}` : `passou ${formatMoney(cur.total - limit)}`}</div>`
          : `<div class="tile-note">Sem limite definido · <a href="#/categorias">definir</a></div>`}
      </div>
      <div class="tile">
        <div class="tile-label">Dias com gasto</div>
        <div class="tile-value">${cur.days} <span class="tile-unit">de ${daysElapsed || daysInMonth} dias</span></div>
        <div class="tile-note">${formatMonth(prevYM).split(' ')[0]}: ${prev.days} dia(s)</div>
      </div>
      <div class="tile">
        <div class="tile-label">Média por ocasião</div>
        <div class="tile-value">${formatMoney(cur.avg)}</div>
        <div class="tile-note">${cur.days ? (diff(cur.avg, prev.avg) || 'sem gasto no mês anterior') : 'sem gastos no mês'}</div>
      </div>
      <div class="tile tile-dark">
        <div class="tile-label">Acumulado em ${year}</div>
        <div class="tile-value">${formatMoney(yearTotal)}</div>
        <div class="tile-note">média de ${formatMoney(yearAvg)}/mês · ${share.toFixed(1).replace('.', ',')}% das despesas do ano</div>
      </div>
    </section>

    ${chartHTML(months, limit, year, ym, monthsOver)}

    <div class="grid-2">
      <section class="card" aria-labelledby="h-list">
        <h2 id="h-list">Lançamentos de ${formatMonth(ym)}</h2>
        ${monthRows.length ? `
          <ul class="up-list">
            ${monthRows.map((r) => `
              <li class="acp-row">
                <div class="tx-date">${formatDayMonth(r.occurred_on)}</div>
                <div class="up-main">
                  <div class="up-title">${escapeHTML(r.description)}</div>
                  <div class="up-sub">${WEEKDAYS_FULL[weekday(r.occurred_on)]} · ${escapeHTML(accMap.get(r.account_id)?.name ?? '')}</div>
                </div>
                <div class="up-amount">${formatMoney(r.amount)}</div>
              </li>`).join('')}
          </ul>
          <p class="hint" style="margin-top:10px">Para editar ou excluir, use a página <a href="#/lancamentos">Lançamentos</a>.</p>`
          : '<p class="empty">Nenhum gasto nesta categoria no mês.</p>'}
      </section>

      <section class="card" aria-labelledby="h-week">
        <h2 id="h-week">Por dia da semana · ${year}</h2>
        ${topWeekday >= 0 ? `
          <p class="hint" style="margin-bottom:12px">O consumo se concentra ${['domingo', 'sábado'].includes(WEEKDAYS_FULL[topWeekday]) ? 'no' : 'na'} <strong>${WEEKDAYS_FULL[topWeekday]}</strong>.</p>
          <ul class="hbars">
            ${byWeekday.map((v, i) => `
              <li class="hbar">
                <div class="hbar-label">
                  <span>${WEEKDAYS[i]}</span>
                  <span><strong>${formatMoney(v)}</strong> <span class="muted">· ${countWeekday[i]} dia(s)</span></span>
                </div>
                <div class="hbar-track"><div class="hbar-fill" style="width:${v ? Math.max(2, Math.round((v / Math.max(...byWeekday)) * 100)) : 0}%;background:${COLOR_BAR}"></div></div>
              </li>`).join('')}
          </ul>`
          : '<p class="empty">Sem gastos no ano ainda.</p>'}
      </section>
    </div>
  `;

  view.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'prev') { ym = addMonths(ym, -1); render(view); }
    if (btn.dataset.action === 'next') { ym = addMonths(ym, 1); render(view); }
    if (btn.dataset.action === 'today') { ym = currentYM(); render(view); }
  };
  view.onchange = (e) => {
    if (e.target.id === 'acp-cat') { selectedCategoryId = e.target.value; render(view); }
  };
}

// ---------------------------------------------------------------------
// Gráfico do ano: uma coluna por mês, linha tracejada do limite
// ---------------------------------------------------------------------
function chartHTML(months, limit, year, ym, monthsOver) {
  const max = Math.max(...months.map((m) => m.total), limit ?? 0, 1);
  const H = 150;
  const h = (v) => (v > 0 ? Math.max(3, Math.round((v / max) * H)) : 0);
  const short = (m) => formatMonth(m).slice(0, 3);

  return `
    <section class="card" aria-labelledby="h-year">
      <div class="card-head">
        <h2 id="h-year">Evolução mês a mês · ${year}</h2>
        <div class="legend" aria-hidden="true">
          <span><i style="background:${COLOR_BAR}"></i>Dentro do limite</span>
          ${limit ? `<span><i style="background:${COLOR_OVER}"></i>Acima do limite</span>
          <span><i class="legend-line"></i>Limite ${formatMoney(limit)}</span>` : ''}
        </div>
      </div>
      ${limit && monthsOver ? `<p class="hint" style="margin:-4px 0 8px">${monthsOver} mês(es) acima do limite em ${year}.</p>` : ''}
      <div class="chart-scroll">
        <div class="cols cols-12">
          ${limit ? `<div class="limit-line" style="bottom:${Math.round((limit / max) * H) + 28}px" aria-hidden="true"></div>` : ''}
          ${months.map((m) => {
            const over = limit && m.total > limit;
            return `
              <div class="col ${m.ym === ym ? 'col-current' : ''}" tabindex="0"
                   aria-label="${formatMonth(m.ym)}: ${formatMoney(m.total)}${over ? ', acima do limite' : ''}">
                <div class="col-bars">
                  <div class="col-bar col-bar-single" style="height:${h(m.total)}px;background:${over ? COLOR_OVER : COLOR_BAR}"></div>
                </div>
                <div class="col-label">${short(m.ym)}</div>
                <div class="col-tip" aria-hidden="true">
                  <strong>${formatMonthTitle(m.ym)}</strong>
                  <span>${m.future ? 'mês ainda não chegou' : `${formatMoney(m.total)} em ${m.days} dia(s)`}</span>
                  ${over ? `<span>Acima do limite em ${formatMoney(m.total - limit)}</span>` : ''}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
      <details class="table-view">
        <summary>Ver em tabela</summary>
        <table>
          <thead><tr><th scope="col">Mês</th><th scope="col">Gasto</th><th scope="col">Dias</th><th scope="col">Média/ocasião</th></tr></thead>
          <tbody>
            ${months.filter((m) => !m.future).map((m) => `
              <tr><th scope="row">${formatMonthTitle(m.ym)}</th><td>${formatMoney(m.total)}</td><td>${m.days}</td><td>${formatMoney(m.avg)}</td></tr>`).join('')}
          </tbody>
        </table>
      </details>
    </section>`;
}
