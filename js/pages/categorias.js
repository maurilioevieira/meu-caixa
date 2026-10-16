// =====================================================================
//  pages/categorias.js — Categorias e orçamentos
// ---------------------------------------------------------------------
//  • Lista categorias de despesa e de receita
//  • Mostra quanto já foi gasto no mês em cada despesa (e o limite)
//  • Cadastrar, editar (nome, cor, limite mensal, acompanhamento),
//    arquivar/reativar e excluir
//
//  "Limite mensal" alimenta o quadro "Orçamentos do mês" do Painel.
//  "Acompanhar" dá à categoria uma página própria de acompanhamento
//  (a de bebida alcoólica é a primeira).
// =====================================================================

import { supabase } from '../supabase.js';
import { state } from '../state.js';
import { openModal, toast, confirmAction, ValidationError } from '../ui.js';
import {
  formatMoney, moneyToInput, parseMoney, currentYM, monthRange, formatMonth,
  escapeHTML, safeColor
} from '../utils.js';

// Paleta de cores para categorias (contraste suficiente com fundo branco)
const COLORS = [
  '#23406E', '#2F6F8F', '#1F5C46', '#2E7D5B', '#8A5A00', '#B4541A',
  '#7A3A0C', '#A23B5A', '#9C4A2F', '#4B2A78', '#6B4E9B', '#56635C'
];

const KIND_LABEL = { expense: 'Despesa', income: 'Receita' };

let showArchived = false;
let cache = { cats: [], spent: new Map(), ym: currentYM() };

// ---------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------
async function loadData() {
  const ym = currentYM();
  const { from, to } = monthRange(ym);
  const [catRes, txRes] = await Promise.all([
    supabase.from('categories').select('*').order('name'),
    // Gasto do mês por categoria (mesmo critério do Painel: vencimento)
    supabase.from('transactions').select('category_id, amount')
      .eq('type', 'expense').gte('due_date', from).lte('due_date', to)
  ]);
  if (catRes.error) throw catRes.error;
  if (txRes.error) throw txRes.error;

  const spent = new Map();
  for (const t of txRes.data) spent.set(t.category_id, (spent.get(t.category_id) ?? 0) + Number(t.amount));
  return { cats: catRes.data, spent, ym };
}

// ---------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------
export async function render(view) {
  view.innerHTML = '<p class="muted">Carregando categorias…</p>';
  cache = await loadData();
  draw(view);
}

function draw(view) {
  const visible = cache.cats.filter((c) => showArchived || !c.archived);
  const expenses = visible.filter((c) => c.kind === 'expense');
  const incomes = visible.filter((c) => c.kind === 'income');
  const archivedCount = cache.cats.filter((c) => c.archived).length;

  const budgeted = cache.cats.filter((c) => c.kind === 'expense' && !c.archived && c.monthly_budget);
  const totalBudget = budgeted.reduce((s, c) => s + Number(c.monthly_budget), 0);
  const totalSpentBudgeted = budgeted.reduce((s, c) => s + (cache.spent.get(c.id) ?? 0), 0);

  view.innerHTML = `
    <header class="page-head">
      <h1>Categorias</h1>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary" data-action="new-income">+ Receita</button>
        <button type="button" class="btn btn-primary" data-action="new-expense">+ Despesa</button>
      </div>
    </header>

    <section class="tiles" aria-label="Resumo dos orçamentos">
      <div class="tile tile-dark">
        <div class="tile-label">Orçamento total de ${formatMonth(cache.ym)}</div>
        <div class="tile-value">${formatMoney(totalBudget)}</div>
        <div class="tile-note">${budgeted.length} categoria(s) com limite</div>
      </div>
      <div class="tile">
        <div class="tile-label">Gasto nessas categorias</div>
        <div class="tile-value ${totalBudget && totalSpentBudgeted > totalBudget ? 'text-expense' : ''}">${formatMoney(totalSpentBudgeted)}</div>
        <div class="tile-note">${totalBudget ? `${Math.round((totalSpentBudgeted / totalBudget) * 100)}% do orçamento` : 'defina limites em “Editar”'}</div>
      </div>
    </section>

    <section class="card">
      <h2>Despesas</h2>
      ${expenses.length ? `<div class="cat-list">${expenses.map(catRow).join('')}</div>` : '<p class="empty">Nenhuma categoria de despesa.</p>'}
    </section>

    <section class="card">
      <h2>Receitas</h2>
      ${incomes.length ? `<div class="cat-list">${incomes.map(catRow).join('')}</div>` : '<p class="empty">Nenhuma categoria de receita.</p>'}
    </section>

    ${archivedCount ? `
      <label class="check-line">
        <input type="checkbox" data-action="toggle-archived" ${showArchived ? 'checked' : ''}>
        Mostrar arquivadas (${archivedCount})
      </label>` : ''}
  `;

  view.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.type === 'checkbox') return;
    const cat = btn.dataset.id ? cache.cats.find((c) => c.id === btn.dataset.id) : null;
    switch (btn.dataset.action) {
      case 'new-expense': return openCatForm(view, null, 'expense');
      case 'new-income':  return openCatForm(view, null, 'income');
      case 'edit':        return openCatForm(view, cat, cat.kind);
      case 'archive':     return setArchived(view, cat, true);
      case 'unarchive':   return setArchived(view, cat, false);
      case 'delete':      return removeCat(view, cat);
    }
  };
  view.onchange = (e) => {
    if (e.target.dataset.action === 'toggle-archived') {
      showArchived = e.target.checked;
      draw(view);
    }
  };
}

function catRow(c) {
  const spent = cache.spent.get(c.id) ?? 0;
  const budget = c.monthly_budget ? Number(c.monthly_budget) : null;
  const pct = budget ? Math.round((spent / budget) * 100) : 0;

  let detail = '';
  if (c.kind === 'expense') {
    detail = budget
      ? `${formatMoney(spent)} de ${formatMoney(budget)} no mês · ${pct}%`
      : `${formatMoney(spent)} no mês · sem limite`;
  }

  return `
    <article class="cat-row ${c.archived ? 'is-archived' : ''}">
      <span class="cat-swatch" style="background:${safeColor(c.color)}" aria-hidden="true"></span>
      <div class="cat-main">
        <div class="cat-name">
          ${escapeHTML(c.name)}
          ${c.is_tracked ? '<span class="tag tag-accent">acompanhada</span>' : ''}
          ${c.archived ? '<span class="tag">arquivada</span>' : ''}
        </div>
        ${detail ? `<div class="cat-sub">${detail}${budget && pct >= 100 ? ' · limite ultrapassado' : budget && pct >= 80 ? ' · acima de 80%' : ''}</div>` : ''}
        ${budget ? `<div class="bar cat-bar"><div class="bar-fill ${pct >= 80 ? 'bar-warn' : ''}" style="width:${Math.min(100, pct)}%"></div></div>` : ''}
      </div>
      <div class="acc-actions cat-actions">
        <button type="button" class="btn-link" data-action="edit" data-id="${c.id}">Editar</button>
        ${c.archived
          ? `<button type="button" class="btn-link" data-action="unarchive" data-id="${c.id}">Reativar</button>
             <button type="button" class="btn-link btn-link-danger" data-action="delete" data-id="${c.id}">Excluir</button>`
          : `<button type="button" class="btn-link" data-action="archive" data-id="${c.id}">Arquivar</button>`}
      </div>
    </article>`;
}

// ---------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------
function openCatForm(view, cat, kind) {
  const isEdit = !!cat;
  const isExpense = kind === 'expense';
  const color = cat ? safeColor(cat.color) : (isExpense ? '#B4541A' : '#1F5C46');

  const bodyHTML = `
    <div class="field">
      <label for="c-name">Nome</label>
      <input id="c-name" name="name" required maxlength="40"
             placeholder="${isExpense ? 'Ex.: Farmácia' : 'Ex.: Plantão extra'}"
             value="${escapeHTML(cat?.name ?? '')}">
      <p class="hint">Categoria de <strong>${KIND_LABEL[kind].toLowerCase()}</strong>.
        ${isEdit ? 'O tipo não pode ser mudado depois de criada.' : ''}</p>
    </div>

    ${isExpense ? `
      <div class="field">
        <label for="c-budget">Limite mensal (opcional)</label>
        <input id="c-budget" name="monthly_budget" inputmode="decimal" placeholder="Ex.: 350,00"
               value="${moneyToInput(cat?.monthly_budget)}">
        <p class="hint">Aparece em “Orçamentos do mês” no Painel, com alerta ao passar de 80%.
          Deixe em branco para não ter limite.</p>
      </div>

      <label class="check-line">
        <input type="checkbox" name="is_tracked" ${cat?.is_tracked ? 'checked' : ''}>
        Acompanhar esta categoria em página própria
      </label>
    ` : ''}

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
  `;

  openModal({
    title: isEdit ? 'Editar categoria' : `Nova categoria de ${KIND_LABEL[kind].toLowerCase()}`,
    bodyHTML,
    submitLabel: isEdit ? 'Salvar alterações' : 'Criar categoria',
    onSubmit: async (form) => {
      const f = new FormData(form);
      const name = String(f.get('name') || '').trim();
      if (!name) throw new ValidationError('Informe o nome.');

      const row = { name, color: String(f.get('color') || color) };
      if (isExpense) {
        const text = String(f.get('monthly_budget') || '').trim();
        let budget = null;
        if (text) {
          budget = parseMoney(text);
          if (!(budget > 0)) throw new ValidationError('Limite inválido. Exemplo: 350,00 (ou deixe em branco).');
        }
        row.monthly_budget = budget;
        row.is_tracked = f.get('is_tracked') === 'on';
      }

      const res = isEdit
        ? await supabase.from('categories').update(row).eq('id', cat.id)
        : await supabase.from('categories').insert({ ...row, kind, household_id: state.household.householdId });
      if (res.error) {
        if (res.error.code === '23505') throw new ValidationError(`Já existe uma categoria de ${KIND_LABEL[kind].toLowerCase()} chamada “${name}”.`);
        throw res.error;
      }
      toast(isEdit ? 'Categoria atualizada.' : 'Categoria criada.');
      await render(view);
    }
  });
}

// ---------------------------------------------------------------------
// Arquivar / reativar / excluir
// ---------------------------------------------------------------------
async function setArchived(view, cat, archived) {
  if (archived && !confirmAction(`Arquivar “${cat.name}”? Ela some das opções de novos lançamentos, mas os lançamentos antigos continuam com ela.`)) return;
  const { error } = await supabase.from('categories').update({ archived }).eq('id', cat.id);
  if (error) return toast(error.message, 'error');
  toast(archived ? 'Categoria arquivada.' : 'Categoria reativada.');
  await render(view);
}

async function removeCat(view, cat) {
  if (!confirmAction(`Excluir “${cat.name}” definitivamente? Só é possível se nenhum lançamento usar esta categoria.`)) return;
  const { error } = await supabase.from('categories').delete().eq('id', cat.id);
  if (error) {
    const msg = error.code === '23503'
      ? 'Há lançamentos nesta categoria; ela não pode ser excluída. Mantenha-a arquivada.'
      : error.message;
    return toast(msg, 'error');
  }
  toast('Categoria excluída.');
  await render(view);
}
