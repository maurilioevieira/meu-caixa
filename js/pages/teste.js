// =====================================================================
//  pages/teste.js — Teste de conexão
//  Confere, uma a uma, as peças do banco (passos 1 e 2).
//  Fica no app como ferramenta de diagnóstico.
// =====================================================================

import { supabase } from '../supabase.js';
import { state } from '../state.js';
import { formatMoney, escapeHTML, safeColor } from '../utils.js';

const KIND_LABEL = { checking: 'Conta corrente', savings: 'Poupança', cash: 'Dinheiro', credit_card: 'Cartão' };

export async function render(view) {
  const h = state.household;

  const [accRes, catRes, rpcRes] = await Promise.all([
    supabase.from('v_account_balances').select('name, kind, balance').order('name'),
    supabase.from('categories').select('name, kind, color, is_tracked').order('kind').order('name'),
    supabase.rpc('generate_recurrences')
  ]);
  if (accRes.error) throw accRes.error;
  if (catRes.error) throw catRes.error;
  if (rpcRes.error) throw rpcRes.error;

  const despesas = catRes.data.filter((c) => c.kind === 'expense');
  const receitas = catRes.data.filter((c) => c.kind === 'income');
  const chip = (c) => `
    <span class="chip"><span class="dot" style="background:${safeColor(c.color)}"></span>${escapeHTML(c.name)}${c.is_tracked ? ' <small>(acompanhada)</small>' : ''}</span>`;

  view.innerHTML = `
    <h1>Teste de conexão</h1>
    <div class="alert alert-ok">Tudo certo: login, RLS, views e funções responderam.</div>

    <section class="card">
      <h2>Grupo familiar</h2>
      <p><strong>${escapeHTML(h.householdName)}</strong></p>
      <ul class="list">
        ${h.members.map((m) => `<li>${escapeHTML(m.name)} <span class="muted">· ${m.role === 'owner' ? 'dono' : 'membro'}</span></li>`).join('')}
      </ul>
    </section>

    <section class="card">
      <h2>Contas (${accRes.data.length})</h2>
      <ul class="list">
        ${accRes.data.map((a) => `<li><span>${escapeHTML(a.name)} <span class="muted">· ${KIND_LABEL[a.kind]}</span></span><strong>${formatMoney(a.balance)}</strong></li>`).join('')}
      </ul>
    </section>

    <section class="card">
      <h2>Categorias de despesa (${despesas.length})</h2>
      <div class="chips">${despesas.map(chip).join('')}</div>
      <h2 style="margin-top:20px">Categorias de receita (${receitas.length})</h2>
      <div class="chips">${receitas.map(chip).join('')}</div>
    </section>

    <section class="card">
      <h2>Funções</h2>
      <p>generate_recurrences → <strong>${rpcRes.data}</strong> lançamento(s) gerado(s) <span class="muted">(0 é o esperado sem recorrências cadastradas)</span></p>
    </section>
  `;
}
