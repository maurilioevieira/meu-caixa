// =====================================================================
//  pages/lancamentos.js — Lançamentos (receitas, despesas, transferências)
// ---------------------------------------------------------------------
//  • Lista o mês escolhido pelo VENCIMENTO (regime de caixa: o mês em
//    que o dinheiro sai ou entra). Compras no cartão aparecem no mês em
//    que a fatura vence.
//  • Filtros por texto, tipo, situação, conta e categoria (no próprio
//    navegador — o mês inteiro já está carregado, então é instantâneo).
//  • Novo lançamento: simples, parcelado (gera as parcelas) ou repetido
//    todo mês (cria uma recorrência).
//  • Marcar como pago/recebido, editar e excluir.
//
//  Cálculos sensíveis (fatura do cartão, divisão das parcelas) são
//  feitos pelo BANCO. A página só mostra uma prévia para o usuário.
// =====================================================================

import { supabase } from '../supabase.js';
import { state } from '../state.js';
import { fetchAccounts, fetchCategories, byId } from '../data.js';
import { openModal, toast, confirmAction, ValidationError } from '../ui.js';
import {
  formatMoney, moneyToInput, parseMoney, formatDayMonth, formatMonth, formatMonthTitle,
  todayISO, currentYM, addMonths, monthRange, cardInvoiceFor,
  escapeHTML, safeColor
} from '../utils.js';

const TYPE_LABEL = { expense: 'Despesa', income: 'Receita', transfer: 'Transferência' };

// Estado da página (permanece ao trocar de página e voltar)
let ym = currentYM();
const filters = { q: '', type: '', status: '', account: '', category: '' };
let cache = { rows: [], accounts: [], categories: [], accMap: new Map(), catMap: new Map() };

// ---------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------
export async function render(view) {
  view.innerHTML = '<p class="muted">Carregando lançamentos…</p>';
  const { from, to } = monthRange(ym);

  const [accounts, categories, txRes] = await Promise.all([
    fetchAccounts(),
    fetchCategories(),
    supabase.from('v_transactions').select('*')
      .gte('due_date', from).lte('due_date', to)
      .order('due_date').order('created_at')
  ]);
  if (txRes.error) throw txRes.error;

  cache = {
    rows: txRes.data,
    accounts,
    categories,
    accMap: byId(accounts),
    catMap: byId(categories)
  };
  drawShell(view);
  drawList(view);
}

// ---------------------------------------------------------------------
// Estrutura da página (cabeçalho + filtros). Desenhada uma vez por
// carregamento; a lista é redesenhada a cada filtro, sem perder o foco
// do campo de busca.
// ---------------------------------------------------------------------
function drawShell(view) {
  const activeAccounts = cache.accounts.filter((a) => !a.archived);
  const activeCats = cache.categories.filter((c) => !c.archived);

  view.innerHTML = `
    <header class="page-head">
      <h1>Lançamentos</h1>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" data-action="new">+ Novo lançamento</button>
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
      ${ym !== currentYM() ? '<button type="button" class="btn-link" data-action="today">Voltar ao mês atual</button>' : ''}
    </nav>

    <section id="tx-tiles" class="tiles tiles-3" aria-label="Resumo do mês"></section>

    <section class="card filters" aria-label="Filtros">
      <div class="field field-search">
        <label for="flt-q">Buscar</label>
        <input id="flt-q" type="search" placeholder="Descrição ou observação" value="${escapeHTML(filters.q)}">
      </div>
      <div class="field">
        <label for="flt-type">Tipo</label>
        <select id="flt-type">
          <option value="">Todos</option>
          ${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${filters.type === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="flt-status">Situação</label>
        <select id="flt-status">
          <option value="">Todas</option>
          <option value="open" ${filters.status === 'open' ? 'selected' : ''}>Em aberto</option>
          <option value="overdue" ${filters.status === 'overdue' ? 'selected' : ''}>Vencidos</option>
          <option value="paid" ${filters.status === 'paid' ? 'selected' : ''}>Pagos / recebidos</option>
        </select>
      </div>
      <div class="field">
        <label for="flt-account">Conta</label>
        <select id="flt-account">
          <option value="">Todas</option>
          ${activeAccounts.map((a) => `<option value="${a.id}" ${filters.account === a.id ? 'selected' : ''}>${escapeHTML(a.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="flt-category">Categoria</label>
        <select id="flt-category">
          <option value="">Todas</option>
          ${activeCats.map((c) => `<option value="${c.id}" ${filters.category === c.id ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
        </select>
      </div>
    </section>

    <section class="card">
      <div id="tx-list" class="tx-list"></div>
    </section>
  `;

  view.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const tx = btn.dataset.id ? cache.rows.find((r) => r.id === btn.dataset.id) : null;
    switch (btn.dataset.action) {
      case 'new':   return openTxForm(view, null);
      case 'prev':  ym = addMonths(ym, -1); return render(view);
      case 'next':  ym = addMonths(ym, 1);  return render(view);
      case 'today': ym = currentYM();       return render(view);
      case 'pay':   return setPaid(view, tx, true);
      case 'unpay': return setPaid(view, tx, false);
      case 'edit':  return openTxForm(view, tx);
      case 'delete': return removeTx(view, tx);
      case 'clear-filters':
        Object.assign(filters, { q: '', type: '', status: '', account: '', category: '' });
        return render(view);
    }
  };

  // Filtros: atualizam só a lista
  const bind = (id, key, evt = 'change') => {
    view.querySelector(id).addEventListener(evt, (e) => { filters[key] = e.target.value; drawList(view); });
  };
  bind('#flt-q', 'q', 'input');
  bind('#flt-type', 'type');
  bind('#flt-status', 'status');
  bind('#flt-account', 'account');
  bind('#flt-category', 'category');
}

// ---------------------------------------------------------------------
// Lista + resumo (redesenhados a cada filtro)
// ---------------------------------------------------------------------
function applyFilters(rows) {
  const q = filters.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (filters.type && r.type !== filters.type) return false;
    if (filters.status === 'paid' && r.status !== 'paid') return false;
    if (filters.status === 'open' && r.status === 'paid') return false;
    if (filters.status === 'overdue' && r.status !== 'overdue') return false;
    if (filters.account && r.account_id !== filters.account && r.to_account_id !== filters.account) return false;
    if (filters.category && r.category_id !== filters.category) return false;
    if (q && !(`${r.description} ${r.notes || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function hasFilters() {
  return Object.values(filters).some((v) => v);
}

function drawList(view) {
  const rows = applyFilters(cache.rows);

  // Resumo: transferências não são receita nem despesa
  const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const openExpense = rows.filter((r) => r.type === 'expense' && r.status !== 'paid').reduce((s, r) => s + Number(r.amount), 0);
  const openIncome = rows.filter((r) => r.type === 'income' && r.status !== 'paid').reduce((s, r) => s + Number(r.amount), 0);
  const result = income - expense;

  view.querySelector('#tx-tiles').innerHTML = `
    <div class="tile">
      <div class="tile-label">Receitas${hasFilters() ? ' (filtradas)' : ''}</div>
      <div class="tile-value text-income">${formatMoney(income)}</div>
      <div class="tile-note">${openIncome > 0 ? `${formatMoney(openIncome)} a receber` : 'tudo recebido'}</div>
    </div>
    <div class="tile">
      <div class="tile-label">Despesas${hasFilters() ? ' (filtradas)' : ''}</div>
      <div class="tile-value text-expense">${formatMoney(expense)}</div>
      <div class="tile-note">${openExpense > 0 ? `${formatMoney(openExpense)} a pagar` : 'tudo pago'}</div>
    </div>
    <div class="tile tile-dark">
      <div class="tile-label">Resultado do mês</div>
      <div class="tile-value">${result >= 0 ? '+ ' : '− '}${formatMoney(Math.abs(result))}</div>
      <div class="tile-note">receitas − despesas</div>
    </div>
  `;

  const list = view.querySelector('#tx-list');
  if (cache.rows.length === 0) {
    list.innerHTML = `<p class="empty">Nenhum lançamento em ${formatMonth(ym)}. Use “+ Novo lançamento”.</p>`;
    return;
  }
  if (rows.length === 0) {
    list.innerHTML = `<p class="empty">Nenhum lançamento com esses filtros.
      <button type="button" class="btn-link" data-action="clear-filters">Limpar filtros</button></p>`;
    return;
  }
  list.innerHTML = rows.map(txRow).join('');
}

function txRow(r) {
  const acc = cache.accMap.get(r.account_id);
  const to = r.to_account_id ? cache.accMap.get(r.to_account_id) : null;
  const cat = r.category_id ? cache.catMap.get(r.category_id) : null;
  const isCardExpense = r.type === 'expense' && acc?.kind === 'credit_card';
  const isInvoicePayment = r.type === 'transfer' && to?.kind === 'credit_card';

  // Linha de detalhe: categoria · conta  (ou  origem → destino)
  const sub = r.type === 'transfer'
    ? `${escapeHTML(acc?.name ?? '?')} → ${escapeHTML(to?.name ?? '?')}`
    : `<span class="dot" style="background:${safeColor(cat?.color)}"></span>${escapeHTML(cat?.name ?? 'Sem categoria')} · ${escapeHTML(acc?.name ?? '?')}`;

  const tags = [];
  if (r.recurrence_id) tags.push('<span class="tag">recorrente</span>');

  // Situação
  let status;
  if (isInvoicePayment) status = '<span class="status status-paid">Fatura paga</span>';
  else if (r.type === 'transfer') status = '<span class="status status-neutral">Transferido</span>';
  else if (r.status === 'paid') status = `<span class="status status-paid">${r.type === 'income' ? 'Recebido' : 'Pago'}</span>`;
  else if (isCardExpense) status = `<span class="status status-card">Fatura ${formatDayMonth(r.due_date)}</span>`;
  else if (r.status === 'overdue') status = '<span class="status status-overdue">Vencido</span>';
  else status = `<span class="status status-pending">${r.type === 'income' ? 'A receber' : 'A pagar'}</span>`;

  // Ações
  const actions = [];
  if (r.type !== 'transfer' && !isCardExpense) {
    actions.push(r.status === 'paid'
      ? `<button type="button" class="btn-link" data-action="unpay" data-id="${r.id}">Desfazer ${r.type === 'income' ? 'recebimento' : 'pagamento'}</button>`
      : `<button type="button" class="btn-link btn-link-strong" data-action="pay" data-id="${r.id}">${r.type === 'income' ? 'Marcar recebido' : 'Marcar pago'}</button>`);
  }
  if (isInvoicePayment) {
    // Pagamento de fatura não se edita: alterar o valor desalinharia a
    // fatura. Se foi lançado errado, desfaz-se e paga-se de novo.
    actions.push(`<button type="button" class="btn-link btn-link-danger" data-action="delete" data-id="${r.id}">Desfazer pagamento da fatura</button>`);
  } else {
    actions.push(`<button type="button" class="btn-link" data-action="edit" data-id="${r.id}">Editar</button>`);
    actions.push(`<button type="button" class="btn-link btn-link-danger" data-action="delete" data-id="${r.id}">Excluir</button>`);
  }

  const sign = r.type === 'income' ? '+ ' : r.type === 'expense' ? '− ' : '';
  const amountClass = r.type === 'income' ? 'text-income' : r.type === 'expense' ? 'text-expense' : '';

  return `
    <article class="tx-row ${r.status === 'paid' ? 'is-paid' : ''}">
      <div class="tx-date">${formatDayMonth(r.due_date)}</div>
      <div class="tx-main">
        <div class="tx-desc">${escapeHTML(r.description)} ${tags.join(' ')}</div>
        <div class="tx-sub">${sub}</div>
      </div>
      <div class="tx-side">
        <div class="tx-amount ${amountClass}">${sign}${formatMoney(r.amount)}</div>
        ${status}
      </div>
      <div class="tx-actions">${actions.join('')}</div>
    </article>`;
}

// ---------------------------------------------------------------------
// Marcar pago / desfazer
// ---------------------------------------------------------------------
async function setPaid(view, tx, paid) {
  const { error } = await supabase.from('transactions')
    .update({ paid_at: paid ? todayISO() : null })
    .eq('id', tx.id);
  if (error) return toast(error.message, 'error');
  toast(paid ? (tx.type === 'income' ? 'Marcado como recebido.' : 'Marcado como pago.') : 'Situação desfeita.');
  await render(view);
}

// ---------------------------------------------------------------------
// Excluir (com opções para parcelas e recorrências)
// ---------------------------------------------------------------------
async function removeTx(view, tx) {
  const toAcc = tx.to_account_id ? cache.accMap.get(tx.to_account_id) : null;
  if (tx.type === 'transfer' && toAcc?.kind === 'credit_card') {
    if (!confirmAction(`Desfazer “${tx.description}”? O dinheiro volta para a conta de origem e as compras dessa fatura voltam a ficar em aberto.`)) return;
    // As compras quitadas por este pagamento são as do cartão marcadas
    // como pagas na mesma data do pagamento.
    const reopen = await supabase.from('transactions').update({ paid_at: null })
      .eq('account_id', tx.to_account_id).eq('type', 'expense').eq('paid_at', tx.paid_at);
    if (reopen.error) return toast(reopen.error.message, 'error');
    const { error } = await supabase.from('transactions').delete().eq('id', tx.id);
    if (error) return toast(error.message, 'error');
    toast('Pagamento da fatura desfeito.');
    return render(view);
  }

  if (tx.installment_group_id) {
    return openModal({
      title: 'Excluir parcela',
      submitLabel: 'Excluir',
      bodyHTML: `
        <p>“${escapeHTML(tx.description)}” faz parte de uma compra parcelada.</p>
        <label class="check-line"><input type="radio" name="scope" value="one" checked> Excluir só esta parcela</label>
        <label class="check-line"><input type="radio" name="scope" value="all"> Excluir a compra inteira (todas as parcelas, inclusive as já pagas)</label>`,
      onSubmit: async (form) => {
        const scope = new FormData(form).get('scope');
        const q = scope === 'all'
          ? supabase.from('installment_groups').delete().eq('id', tx.installment_group_id)
          : supabase.from('transactions').delete().eq('id', tx.id);
        const { error } = await q;
        if (error) throw error;
        toast(scope === 'all' ? 'Compra parcelada excluída.' : 'Parcela excluída.');
        await render(view);
      }
    });
  }

  if (tx.recurrence_id) {
    return openModal({
      title: 'Excluir lançamento recorrente',
      submitLabel: 'Excluir',
      bodyHTML: `
        <p>“${escapeHTML(tx.description)}” se repete todo mês.</p>
        <label class="check-line"><input type="radio" name="scope" value="one" checked> Excluir só este mês</label>
        <label class="check-line"><input type="radio" name="scope" value="future"> Excluir este e os próximos em aberto, e parar de repetir</label>`,
      onSubmit: async (form) => {
        const scope = new FormData(form).get('scope');
        if (scope === 'future') {
          const stop = await supabase.from('recurrences').update({ active: false }).eq('id', tx.recurrence_id);
          if (stop.error) throw stop.error;
          const del = await supabase.from('transactions').delete()
            .eq('recurrence_id', tx.recurrence_id)
            .gte('occurred_on', tx.occurred_on)
            .is('paid_at', null);
          if (del.error) throw del.error;
        }
        const { error } = await supabase.from('transactions').delete().eq('id', tx.id);
        if (error) throw error;
        toast(scope === 'future' ? 'Recorrência encerrada.' : 'Lançamento excluído.');
        await render(view);
      }
    });
  }

  if (!confirmAction(`Excluir “${tx.description}” (${formatMoney(tx.amount)})?`)) return;
  const { error } = await supabase.from('transactions').delete().eq('id', tx.id);
  if (error) return toast(error.message, 'error');
  toast('Lançamento excluído.');
  await render(view);
}

// ---------------------------------------------------------------------
// Formulário: novo / editar
// ---------------------------------------------------------------------
function accountOptions(list, selected) {
  const banks = list.filter((a) => a.kind !== 'credit_card');
  const cards = list.filter((a) => a.kind === 'credit_card');
  const opt = (a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${escapeHTML(a.name)}</option>`;
  let html = '';
  if (banks.length) html += `<optgroup label="Contas">${banks.map(opt).join('')}</optgroup>`;
  if (cards.length) html += `<optgroup label="Cartões de crédito">${cards.map(opt).join('')}</optgroup>`;
  return html;
}

function categoryOptions(kind, selected) {
  const list = cache.categories.filter((c) => c.kind === kind && (!c.archived || c.id === selected));
  return list.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('');
}

function openTxForm(view, tx) {
  const isEdit = !!tx;
  const isInstallment = !!tx?.installment_group_id;
  const usable = cache.accounts.filter((a) => !a.archived || a.id === tx?.account_id || a.id === tx?.to_account_id);
  if (usable.length === 0) {
    toast('Cadastre uma conta antes de lançar.', 'error');
    return;
  }

  const type0 = tx?.type ?? 'expense';
  const today = todayISO();
  const date0 = tx?.occurred_on ?? today;
  const due0 = tx?.due_date ?? today;
  const paid0 = tx ? tx.paid_at !== null : true;

  const bodyHTML = `
    <div class="seg" role="radiogroup" aria-label="Tipo de lançamento">
      ${['expense', 'income', 'transfer'].map((k) => `
        <label class="seg-item seg-${k}">
          <input type="radio" name="type" value="${k}" ${type0 === k ? 'checked' : ''} ${isEdit ? 'disabled' : ''}>
          <span>${TYPE_LABEL[k]}</span>
        </label>`).join('')}
    </div>

    <div class="field">
      <label for="t-amount" id="t-amount-label">Valor</label>
      <input id="t-amount" name="amount" inputmode="decimal" required placeholder="0,00" class="input-amount"
             value="${tx ? moneyToInput(tx.amount) : ''}">
    </div>

    <div class="field">
      <label for="t-desc">Descrição</label>
      <input id="t-desc" name="description" required maxlength="${isInstallment ? 110 : 120}"
             placeholder="Ex.: Mercado do mês" value="${escapeHTML(tx?.description ?? '')}">
    </div>

    <div class="field" id="w-cat">
      <label for="t-cat">Categoria</label>
      <select id="t-cat" name="category_id"></select>
    </div>

    <div class="field">
      <label for="t-acc" id="t-acc-label">Conta ou cartão</label>
      <select id="t-acc" name="account_id" ${isInstallment ? 'disabled' : ''}></select>
    </div>

    <div class="field" id="w-to">
      <label for="t-to">Para a conta</label>
      <select id="t-to" name="to_account_id"></select>
    </div>

    <div class="field">
      <label for="t-date" id="t-date-label">Data</label>
      <input id="t-date" name="date" type="date" required value="${date0}" ${isInstallment ? 'disabled' : ''}>
    </div>

    <p class="info-box" id="w-card-info" hidden></p>

    <label class="check-line" id="w-paid">
      <input type="checkbox" id="t-paid" name="paid" ${paid0 ? 'checked' : ''}>
      <span id="t-paid-label">Já foi pago</span>
    </label>

    <div class="field" id="w-due">
      <label for="t-due">Vencimento</label>
      <input id="t-due" name="due_date" type="date" value="${due0}">
    </div>

    ${isEdit ? '' : `
      <div id="w-inst">
        <label class="check-line">
          <input type="checkbox" id="t-inst" name="installments">
          Compra parcelada
        </label>
        <div class="field-row" id="w-count" hidden>
          <div class="field">
            <label for="t-count">Nº de parcelas</label>
            <input id="t-count" name="count" type="number" min="2" max="72" value="2">
          </div>
          <p class="hint inst-preview" id="t-inst-preview"></p>
        </div>
      </div>

      <div id="w-rep">
        <label class="check-line">
          <input type="checkbox" id="t-rep" name="repeat">
          Repetir todo mês
        </label>
        <p class="hint" id="w-rep-hint" hidden>Cria os lançamentos deste e do próximo mês. Os seguintes
          aparecem sozinhos conforme os meses passam, até você encerrar a repetição.</p>
      </div>
    `}

    ${isInstallment ? '<p class="hint">Parcela de compra parcelada: conta e data da compra não podem ser alteradas. Para mudar tudo, exclua a compra inteira e lance de novo.</p>' : ''}
    ${tx?.recurrence_id ? '<p class="hint">Lançamento recorrente: a alteração vale só para este mês.</p>' : ''}

    <div class="field">
      <label for="t-notes">Observações (opcional)</label>
      <input id="t-notes" name="notes" maxlength="500" value="${escapeHTML(tx?.notes ?? '')}">
    </div>
  `;

  openModal({
    title: isEdit ? `Editar ${TYPE_LABEL[type0].toLowerCase()}` : 'Novo lançamento',
    bodyHTML,
    submitLabel: isEdit ? 'Salvar alterações' : 'Salvar lançamento',
    onOpen: (form) => setupForm(form, tx, usable),
    onSubmit: async (form) => {
      await saveTx(form, tx);
      await render(view);
    }
  });
}

// Liga os campos do formulário: o que aparece depende do tipo,
// da conta escolhida e das opções marcadas.
function setupForm(form, tx, usable) {
  const $ = (s) => form.querySelector(s);
  const isEdit = !!tx;
  let lastType = null;

  const update = () => {
    const type = form.querySelector('input[name=type]:checked').value;

    // Conta: receitas e transferências só em contas (cartão não recebe)
    if (type !== lastType) {
      const keepAcc = $('#t-acc').value || tx?.account_id;
      const accList = type === 'expense' ? usable : usable.filter((a) => a.kind !== 'credit_card');
      $('#t-acc').innerHTML = accountOptions(accList, keepAcc);
      if (type !== 'transfer') {
        $('#t-cat').innerHTML = categoryOptions(type, tx?.category_id);
      }
      lastType = type;
    }

    if (type === 'transfer') {
      const from = $('#t-acc').value;
      const keepTo = $('#t-to').value || tx?.to_account_id;
      const toList = usable.filter((a) => a.kind !== 'credit_card' && a.id !== from);
      $('#t-to').innerHTML = accountOptions(toList, keepTo);
    }

    const acc = cache.accMap.get($('#t-acc').value);
    const isCard = acc?.kind === 'credit_card';
    const inst = $('#t-inst')?.checked ?? false;
    const rep = $('#t-rep')?.checked ?? false;

    $('#w-cat').hidden = type === 'transfer';
    $('#w-to').hidden = type !== 'transfer';
    $('#t-acc-label').textContent = type === 'transfer' ? 'Sai da conta' : type === 'income' ? 'Entra na conta' : 'Conta ou cartão';

    // Situação pago/vencimento: não se aplica a cartão (paga-se a fatura),
    // a transferência (é imediata) nem a parcelamento (parcelas nascem em aberto)
    const showPaid = type !== 'transfer' && !isCard && !inst;
    $('#w-paid').hidden = !showPaid;
    $('#t-paid-label').textContent = type === 'income' ? 'Já foi recebido' : 'Já foi pago';
    $('#w-due').hidden = !(showPaid && !$('#t-paid').checked);

    $('#t-date-label').textContent = (type === 'expense' && isCard) ? 'Data da compra' : 'Data';

    // Opções só para lançamento novo
    if (!isEdit) {
      $('#w-inst').hidden = type !== 'expense' || rep;
      $('#w-rep').hidden = type === 'transfer' || inst;
      $('#w-count').hidden = !inst;
      $('#w-rep-hint').hidden = !rep;
      $('#t-amount-label').textContent = inst ? 'Valor total da compra' : 'Valor';

      if (inst) {
        const total = parseMoney($('#t-amount').value);
        const n = Number($('#t-count').value);
        $('#t-inst-preview').textContent = (total > 0 && n >= 2 && n <= 72)
          ? `${n}x de ${formatMoney(Math.floor((total / n) * 100) / 100)}` +
            (Math.round(total * 100) % n ? ' (a última ajusta os centavos)' : '')
          : '';
      }
    }

    // Prévia da fatura do cartão
    const info = $('#w-card-info');
    const date = $('#t-date').value;
    if (type === 'expense' && isCard && date) {
      const inv = isEdit && tx.invoice_month
        ? { ym: tx.invoice_month.slice(0, 7), dueDate: tx.due_date }
        : cardInvoiceFor(acc.closing_day, acc.due_day, date);
      info.textContent = `${inst ? 'A 1ª parcela cai' : 'Cai'} na fatura de ${formatMonth(inv.ym)} (vence ${formatDayMonth(inv.dueDate)}).`;
      info.hidden = false;
    } else {
      info.hidden = true;
    }
  };

  // Atribuição (onchange/oninput) em vez de addEventListener: a janela é
  // compartilhada e a próxima abertura substitui estas reações.
  form.onchange = update;
  form.oninput = (e) => {
    if (['t-amount', 't-count', 't-date'].includes(e.target.id)) update();
  };
  update();
}

// Lê, valida e grava
async function saveTx(form, tx) {
  const f = new FormData(form);
  const $ = (s) => form.querySelector(s);
  const hh = state.household.householdId;

  const type = tx?.type ?? f.get('type');
  const amount = parseMoney(f.get('amount'));
  if (!(amount > 0)) throw new ValidationError('Informe um valor maior que zero. Exemplo: 49,90');

  const description = String(f.get('description') || '').trim();
  if (!description) throw new ValidationError('Informe a descrição.');

  const accountId = $('#t-acc').value;
  const acc = cache.accMap.get(accountId);
  if (!acc) throw new ValidationError('Escolha a conta.');
  const isCard = acc.kind === 'credit_card';

  const date = $('#t-date').value;
  if (!date) throw new ValidationError('Informe a data.');

  const notes = String(f.get('notes') || '').trim() || null;
  const categoryId = type === 'transfer' ? null : $('#t-cat').value;
  if (type !== 'transfer' && !categoryId) throw new ValidationError('Escolha a categoria.');

  // ---------------- Transferência ----------------
  if (type === 'transfer') {
    const toId = $('#t-to').value;
    if (!toId) throw new ValidationError('Escolha a conta de destino (cadastre pelo menos duas contas).');
    const row = {
      type, description, amount, account_id: accountId, to_account_id: toId,
      occurred_on: date, due_date: date, paid_at: date, notes
    };
    const res = tx
      ? await supabase.from('transactions').update(row).eq('id', tx.id)
      : await supabase.from('transactions').insert({ ...row, household_id: hh });
    if (res.error) throw res.error;
    toast(tx ? 'Transferência atualizada.' : 'Transferência registrada.');
    return;
  }

  // Situação (só para conta comum)
  const paid = !isCard && $('#t-paid').checked;
  const due = paid ? date : ($('#t-due').value || date);

  // ---------------- Edição ----------------
  if (tx) {
    const row = { description, amount, category_id: categoryId, notes };
    if (!tx.installment_group_id) {
      row.account_id = accountId;
      row.occurred_on = date;
    }
    // No cartão, vencimento e pagamento seguem a fatura (o banco calcula)
    if (!isCard) {
      row.due_date = due;
      row.paid_at = paid ? (tx.paid_at ?? date) : null;
    } else if (cache.accMap.get(tx.account_id)?.kind !== 'credit_card') {
      row.paid_at = null;   // mudou de conta comum para cartão
    }
    const { error } = await supabase.from('transactions').update(row).eq('id', tx.id);
    if (error) throw error;
    toast('Lançamento atualizado.');
    return;
  }

  // ---------------- Parcelado ----------------
  if ($('#t-inst')?.checked) {
    const n = Number(f.get('count'));
    if (!Number.isInteger(n) || n < 2 || n > 72) throw new ValidationError('O número de parcelas deve ser de 2 a 72.');
    if (amount / n < 0.01) throw new ValidationError('Valor muito baixo para esse número de parcelas.');
    const { error } = await supabase.rpc('create_installment_purchase', {
      p_household_id: hh,
      p_description: description,
      p_total: amount,
      p_count: n,
      p_first_date: date,
      p_account_id: accountId,
      p_category_id: categoryId
    });
    if (error) throw error;
    toast(`Compra parcelada em ${n}x registrada.`);
    return;
  }

  // ---------------- Repetir todo mês ----------------
  if ($('#t-rep')?.checked) {
    const day = Math.min(Number(date.slice(8, 10)), 28);
    const startMonth = `${date.slice(0, 7)}-01`;
    const rec = await supabase.from('recurrences').insert({
      household_id: hh, type, description, amount,
      account_id: accountId, category_id: categoryId,
      day_of_month: day, start_month: startMonth
    }).select('id').single();
    if (rec.error) throw rec.error;

    const gen = await supabase.rpc('generate_recurrences');
    if (gen.error) throw gen.error;

    if (paid) {
      const first = `${date.slice(0, 7)}-${String(day).padStart(2, '0')}`;
      const upd = await supabase.from('transactions').update({ paid_at: date })
        .eq('recurrence_id', rec.data.id).eq('occurred_on', first);
      if (upd.error) throw upd.error;
    }
    toast(`${TYPE_LABEL[type]} recorrente criada (todo dia ${day}).`);
    return;
  }

  // ---------------- Simples ----------------
  const row = {
    household_id: hh, type, description, amount,
    account_id: accountId, category_id: categoryId,
    occurred_on: date, notes
  };
  if (!isCard) {
    row.due_date = due;
    row.paid_at = paid ? date : null;
  }
  const { error } = await supabase.from('transactions').insert(row);
  if (error) throw error;
  toast(`${TYPE_LABEL[type]} registrada.`);
}
