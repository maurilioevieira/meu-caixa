// =====================================================================
//  pages/contas.js — Contas e cartões
// ---------------------------------------------------------------------
//  • Lista contas (corrente, poupança, dinheiro) com saldo
//  • Lista cartões com fatura em aberto, limite usado e disponível
//  • Cadastrar, editar, arquivar/reativar e excluir
//
//  Os saldos vêm da view v_account_balances e as faturas da view
//  v_card_invoices — o cálculo fica no banco, a página só exibe.
// =====================================================================

import { supabase } from '../supabase.js';
import { state } from '../state.js';
import { openModal, toast, confirmAction, ValidationError } from '../ui.js';
import {
  formatMoney, moneyToInput, parseMoney, formatDayMonth, formatMonth,
  escapeHTML, safeColor, initials, todayISO
} from '../utils.js';

const KIND_LABEL = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Dinheiro em espécie',
  credit_card: 'Cartão de crédito'
};

// Paleta para escolher a cor da conta (todas com contraste para texto branco)
const COLORS = ['#1F5C46', '#23406E', '#4B2A78', '#A23B5A', '#B4541A', '#8A5A00', '#2F6F8F', '#3E4A44'];

let showArchived = false;
let cache = { accounts: [] };

// ---------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------
async function loadData() {
  const [accRes, balRes, invRes] = await Promise.all([
    supabase.from('accounts').select('*').order('created_at'),
    supabase.from('v_account_balances').select('account_id, balance'),
    supabase.from('v_card_invoices')
      .select('account_id, invoice_month, due_date, pending_total')
      .eq('paid', false)
      .order('invoice_month')
  ]);
  if (accRes.error) throw accRes.error;
  if (balRes.error) throw balRes.error;
  if (invRes.error) throw invRes.error;

  const balance = new Map(balRes.data.map((b) => [b.account_id, Number(b.balance)]));

  // Primeira fatura ainda não paga de cada cartão = "fatura atual"
  const nextInvoice = new Map();
  for (const inv of invRes.data) {
    if (!nextInvoice.has(inv.account_id)) nextInvoice.set(inv.account_id, inv);
  }

  return accRes.data.map((a) => ({
    ...a,
    balance: balance.get(a.id) ?? 0,
    invoice: nextInvoice.get(a.id) ?? null
  }));
}

// ---------------------------------------------------------------------
// Desenho da página
// ---------------------------------------------------------------------
export async function render(view) {
  view.innerHTML = '<p class="muted">Carregando contas…</p>';
  cache.accounts = await loadData();
  draw(view);
}

function draw(view) {
  const all = cache.accounts;
  const visible = all.filter((a) => showArchived || !a.archived);
  const banks = visible.filter((a) => a.kind !== 'credit_card');
  const cards = visible.filter((a) => a.kind === 'credit_card');
  const archivedCount = all.filter((a) => a.archived).length;

  const active = all.filter((a) => !a.archived);
  const totalBanks = active.filter((a) => a.kind !== 'credit_card').reduce((s, a) => s + a.balance, 0);
  const totalDebt = active.filter((a) => a.kind === 'credit_card').reduce((s, a) => s + Math.max(0, -a.balance), 0);

  view.innerHTML = `
    <header class="page-head">
      <h1>Contas e cartões</h1>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary" data-action="new-card">+ Cartão</button>
        <button type="button" class="btn btn-primary" data-action="new-account">+ Conta</button>
      </div>
    </header>

    <section class="tiles" aria-label="Resumo">
      <div class="tile tile-dark">
        <div class="tile-label">Saldo em contas</div>
        <div class="tile-value">${formatMoney(totalBanks)}</div>
        <div class="tile-note">${active.filter((a) => a.kind !== 'credit_card').length} conta(s) ativa(s)</div>
      </div>
      <div class="tile">
        <div class="tile-label">Dívida nos cartões</div>
        <div class="tile-value ${totalDebt > 0 ? 'text-expense' : ''}">${formatMoney(totalDebt)}</div>
        <div class="tile-note">inclui parcelas futuras</div>
      </div>
    </section>

    <section class="card">
      <h2>Contas</h2>
      ${banks.length ? `<div class="acc-list">${banks.map(bankRow).join('')}</div>`
                     : '<p class="muted">Nenhuma conta cadastrada.</p>'}
    </section>

    <section class="card">
      <h2>Cartões de crédito</h2>
      ${cards.length ? `<div class="acc-list">${cards.map(cardRow).join('')}</div>`
                     : '<p class="muted">Nenhum cartão cadastrado. Use o botão “+ Cartão”.</p>'}
    </section>

    ${archivedCount ? `
      <label class="check-line">
        <input type="checkbox" data-action="toggle-archived" ${showArchived ? 'checked' : ''}>
        Mostrar arquivadas (${archivedCount})
      </label>` : ''}
  `;

  // Um único "ouvinte" para todos os botões da página (delegação).
  // Atribuído com onclick/onchange para substituir o anterior a cada
  // desenho, em vez de acumular ouvintes repetidos.
  view.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.type === 'checkbox') return;
    const id = btn.dataset.id;
    const acc = id ? cache.accounts.find((a) => a.id === id) : null;
    switch (btn.dataset.action) {
      case 'new-account': return openAccountForm(view, null, 'checking');
      case 'new-card':    return openAccountForm(view, null, 'credit_card');
      case 'edit':        return openAccountForm(view, acc, acc.kind);
      case 'archive':     return setArchived(view, acc, true);
      case 'unarchive':   return setArchived(view, acc, false);
      case 'delete':      return removeAccount(view, acc);
      case 'pay-invoice': return openPayInvoice(view, acc);
    }
  };
  view.onchange = (e) => {
    if (e.target.dataset.action === 'toggle-archived') {
      showArchived = e.target.checked;
      draw(view);
    }
  };
}

function avatar(a) {
  return `<div class="acc-avatar" style="background:${safeColor(a.color)}" aria-hidden="true">${escapeHTML(initials(a.name))}</div>`;
}

function rowActions(a, extra = '') {
  return `
    <div class="acc-actions">
      ${extra}
      <button type="button" class="btn-link" data-action="edit" data-id="${a.id}">Editar</button>
      ${a.archived
        ? `<button type="button" class="btn-link" data-action="unarchive" data-id="${a.id}">Reativar</button>
           <button type="button" class="btn-link btn-link-danger" data-action="delete" data-id="${a.id}">Excluir</button>`
        : `<button type="button" class="btn-link" data-action="archive" data-id="${a.id}">Arquivar</button>`}
    </div>`;
}

function bankRow(a) {
  return `
    <article class="acc-row ${a.archived ? 'is-archived' : ''}">
      ${avatar(a)}
      <div class="acc-main">
        <div class="acc-name">${escapeHTML(a.name)}${a.archived ? ' <span class="tag">arquivada</span>' : ''}</div>
        <div class="acc-sub">${KIND_LABEL[a.kind]}</div>
      </div>
      <div class="acc-value ${a.balance < 0 ? 'text-expense' : ''}">${formatMoney(a.balance)}</div>
      ${rowActions(a)}
    </article>`;
}

function cardRow(a) {
  const debt = Math.max(0, -a.balance);
  const limit = a.credit_limit != null ? Number(a.credit_limit) : null;
  const pct = limit ? Math.min(100, Math.round((debt / limit) * 100)) : 0;
  const inv = a.invoice;

  return `
    <article class="acc-row acc-row-card ${a.archived ? 'is-archived' : ''}">
      ${avatar(a)}
      <div class="acc-main">
        <div class="acc-name">${escapeHTML(a.name)}${a.archived ? ' <span class="tag">arquivado</span>' : ''}</div>
        <div class="acc-sub">Fecha dia ${a.closing_day} · vence dia ${a.due_day}</div>
      </div>
      <div class="acc-value">
        ${inv
          ? `${formatMoney(inv.pending_total)}<div class="acc-sub">fatura de ${formatMonth(inv.invoice_month)} · vence ${formatDayMonth(inv.due_date)}</div>`
          : `<span class="muted">Sem fatura em aberto</span>`}
      </div>
      ${limit !== null ? `
        <div class="acc-limit">
          <div class="bar"><div class="bar-fill ${pct >= 80 ? 'bar-warn' : ''}" style="width:${pct}%"></div></div>
          <div class="acc-limit-text">
            <span>Usado ${formatMoney(debt)} de ${formatMoney(limit)}</span>
            <span>Disponível ${formatMoney(limit - debt)}</span>
          </div>
        </div>` : ''}
      ${rowActions(a, inv && !a.archived
        ? `<button type="button" class="btn-link btn-link-strong" data-action="pay-invoice" data-id="${a.id}">Pagar fatura</button>`
        : '')}
    </article>`;
}

// ---------------------------------------------------------------------
// Pagar fatura
//   O banco (função pay_card_invoice) marca as compras da fatura como
//   pagas e registra uma TRANSFERÊNCIA da conta escolhida para o cartão.
//   Assim o gasto não é contado duas vezes: a despesa já foi contada na
//   compra; o pagamento só move dinheiro da conta para o cartão.
// ---------------------------------------------------------------------
function openPayInvoice(view, card) {
  const inv = card.invoice;
  const banks = cache.accounts.filter((a) => a.kind !== 'credit_card' && !a.archived);
  if (banks.length === 0) return toast('Cadastre uma conta para pagar a fatura.', 'error');

  openModal({
    title: `Pagar fatura — ${card.name}`,
    submitLabel: `Pagar ${formatMoney(inv.pending_total)}`,
    bodyHTML: `
      <p class="info-box">Fatura de <strong>${formatMonth(inv.invoice_month)}</strong>, vencimento
        <strong>${formatDayMonth(inv.due_date)}</strong>: <strong>${formatMoney(inv.pending_total)}</strong>.</p>
      <div class="field">
        <label for="p-from">Pagar com a conta</label>
        <select id="p-from" name="from">
          ${banks.map((b) => `<option value="${b.id}">${escapeHTML(b.name)} — saldo ${formatMoney(b.balance)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="p-date">Data do pagamento</label>
        <input id="p-date" name="date" type="date" required value="${todayISO()}">
      </div>
      <p class="hint">Paga o valor total em aberto da fatura. Pagamento parcial ainda não é suportado.</p>`,
    onSubmit: async (form) => {
      const f = new FormData(form);
      const { data, error } = await supabase.rpc('pay_card_invoice', {
        p_card_id: card.id,
        p_invoice_month: inv.invoice_month,
        p_from_account_id: f.get('from'),
        p_paid_on: f.get('date') || todayISO()
      });
      if (error) throw error;
      toast(`Fatura paga: ${formatMoney(data)}.`);
      await render(view);
    }
  });
}

// ---------------------------------------------------------------------
// Formulário (novo / editar)
// ---------------------------------------------------------------------
function openAccountForm(view, acc, kind) {
  const isCard = kind === 'credit_card';
  const isEdit = !!acc;
  const color = acc ? safeColor(acc.color) : (isCard ? '#4B2A78' : '#1F5C46');

  const bodyHTML = `
    <div class="field">
      <label for="f-name">Nome</label>
      <input id="f-name" name="name" required maxlength="60"
             placeholder="${isCard ? 'Ex.: Nubank' : 'Ex.: Caixa — conta salário'}"
             value="${escapeHTML(acc?.name ?? '')}">
    </div>

    ${isCard ? `
      <div class="field">
        <label for="f-limit">Limite total (opcional)</label>
        <input id="f-limit" name="credit_limit" inputmode="decimal" placeholder="Ex.: 2.500,00"
               value="${moneyToInput(acc?.credit_limit)}">
        <p class="hint">O limite total concedido pelo banco, não o disponível hoje.
          O disponível o app calcula descontando as compras lançadas.</p>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-closing">Dia de fechamento</label>
          <input id="f-closing" name="closing_day" type="number" min="1" max="28" required
                 value="${acc?.closing_day ?? ''}">
        </div>
        <div class="field">
          <label for="f-due">Dia de vencimento</label>
          <input id="f-due" name="due_day" type="number" min="1" max="28" required
                 value="${acc?.due_day ?? ''}">
        </div>
      </div>
      <p class="hint">Dias de 1 a 28, para existirem em todos os meses. Se o seu cartão fecha
        dia 29, 30 ou 31, use 28 — a diferença afeta só compras feitas nesses últimos dias.</p>
    ` : `
      <div class="field">
        <label for="f-kind">Tipo</label>
        <select id="f-kind" name="kind" ${isEdit ? 'disabled' : ''}>
          ${['checking', 'savings', 'cash'].map((k) =>
            `<option value="${k}" ${kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}
        </select>
        ${isEdit ? '<p class="hint">O tipo não pode ser alterado depois de criado.</p>' : ''}
      </div>
      <div class="field">
        <label for="f-initial">Saldo inicial</label>
        <input id="f-initial" name="initial_balance" inputmode="decimal" placeholder="0,00"
               value="${moneyToInput(acc?.initial_balance ?? '')}">
        <p class="hint">Quanto havia na conta quando você começou a usar o app. Os lançamentos
          são somados a partir deste valor. Use sinal de menos se estiver no cheque especial.</p>
      </div>
    `}

    <fieldset class="field">
      <legend>Cor</legend>
      <div class="swatches">
        ${COLORS.map((c) => `
          <label class="swatch" style="background:${c}">
            <input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}>
            <span class="sr-only">${c}</span>
          </label>`).join('')}
      </div>
    </fieldset>

    ${isCard && !isEdit ? `
      <p class="hint">Se o cartão já tem compras em aberto, lance-as depois como despesas no
        cartão: o app calcula sozinho em qual fatura cada uma cai.</p>` : ''}
  `;

  openModal({
    title: isEdit ? `Editar ${isCard ? 'cartão' : 'conta'}` : (isCard ? 'Novo cartão' : 'Nova conta'),
    bodyHTML,
    submitLabel: isEdit ? 'Salvar alterações' : (isCard ? 'Cadastrar cartão' : 'Cadastrar conta'),
    onSubmit: async (form) => {
      const data = readForm(form, isCard, isEdit ? acc.kind : null);
      if (isEdit) {
        const { error } = await supabase.from('accounts').update(data).eq('id', acc.id);
        if (error) throw error;
        toast(isCard ? 'Cartão atualizado.' : 'Conta atualizada.');
      } else {
        const { error } = await supabase.from('accounts')
          .insert({ ...data, household_id: state.household.householdId });
        if (error) throw error;
        toast(isCard ? 'Cartão cadastrado.' : 'Conta cadastrada.');
      }
      await render(view);
    }
  });
}

// Lê e valida os campos. Lança ValidationError com mensagem amigável.
function readForm(form, isCard, fixedKind) {
  const f = new FormData(form);
  const name = String(f.get('name') || '').trim();
  if (!name) throw new ValidationError('Informe o nome.');

  const color = String(f.get('color') || '#1F5C46');
  const data = { name, color };

  if (isCard) {
    const closing = Number(f.get('closing_day'));
    const due = Number(f.get('due_day'));
    if (!Number.isInteger(closing) || closing < 1 || closing > 28) throw new ValidationError('Dia de fechamento deve ser de 1 a 28.');
    if (!Number.isInteger(due) || due < 1 || due > 28) throw new ValidationError('Dia de vencimento deve ser de 1 a 28.');

    const limitText = String(f.get('credit_limit') || '').trim();
    let limit = null;
    if (limitText) {
      limit = parseMoney(limitText);
      if (Number.isNaN(limit) || limit < 0) throw new ValidationError('Limite inválido. Exemplo: 2.500,00');
    }
    Object.assign(data, { closing_day: closing, due_day: due, credit_limit: limit });
    if (!fixedKind) Object.assign(data, { kind: 'credit_card', initial_balance: 0 });
  } else {
    const initialText = String(f.get('initial_balance') || '').trim();
    const initial = initialText ? parseMoney(initialText) : 0;
    if (Number.isNaN(initial)) throw new ValidationError('Saldo inicial inválido. Exemplo: 1.250,00');
    data.initial_balance = initial;
    if (!fixedKind) data.kind = String(f.get('kind') || 'checking');
  }
  return data;
}

// ---------------------------------------------------------------------
// Arquivar / reativar / excluir
// ---------------------------------------------------------------------
async function setArchived(view, acc, archived) {
  if (archived && !confirmAction(`Arquivar "${acc.name}"? Ela some das listas, mas o histórico de lançamentos é mantido.`)) return;
  const { error } = await supabase.from('accounts').update({ archived }).eq('id', acc.id);
  if (error) return toast(error.message, 'error');
  toast(archived ? 'Arquivamento concluído.' : 'Reativação concluída.');
  await render(view);
}

async function removeAccount(view, acc) {
  if (!confirmAction(`Excluir "${acc.name}" definitivamente? Só é possível se não houver nenhum lançamento nela.`)) return;
  const { error } = await supabase.from('accounts').delete().eq('id', acc.id);
  if (error) {
    const msg = error.code === '23503'
      ? 'Esta conta tem lançamentos e não pode ser excluída. Mantenha-a arquivada.'
      : error.message;
    return toast(msg, 'error');
  }
  toast('Exclusão concluída.');
  await render(view);
}
