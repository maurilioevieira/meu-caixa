// =====================================================================
//  app.js — Ponto de entrada do app
// ---------------------------------------------------------------------
//  Responsabilidades:
//   1. Decidir entre tela de login e app (conforme a sessão)
//   2. Carregar o grupo familiar uma única vez e guardar em "state"
//   3. Rotear entre páginas pelo "#" da URL (#/painel, #/lancamentos…)
//      — roteamento por hash funciona no GitHub Pages sem configuração.
//
//  Nesta etapa só existe a página "Teste de conexão". As demais páginas
//  entram nos próximos passos, cada uma em js/pages/<nome>.js.
// =====================================================================

import { supabase } from './supabase.js';
import { signIn, signOut, onAuthChange, loadHousehold } from './auth.js';
import { formatMoney, escapeHTML, friendlyError } from './utils.js';
import { APP_NAME } from './config.js';

// Estado global simples, compartilhado entre as páginas
export const state = {
  household: null   // { householdId, householdName, me, members }
};

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------
// Rotas: nome no hash → função que desenha a página dentro de #view
// ---------------------------------------------------------------------
const routes = {
  teste: renderTeste
};
const DEFAULT_ROUTE = 'teste';

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[name] ? name : DEFAULT_ROUTE;
}

async function renderRoute() {
  const name = currentRoute();
  document.querySelectorAll('[data-route]').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
  });
  const view = $('#view');
  view.innerHTML = '<p class="muted">Carregando…</p>';
  try {
    await routes[name](view);
  } catch (err) {
    view.innerHTML = `<div class="alert alert-error">${escapeHTML(friendlyError(err))}</div>`;
    console.error(err);
  }
}

// ---------------------------------------------------------------------
// Telas: login ou app
// ---------------------------------------------------------------------
function showLogin() {
  state.household = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-email').focus();
}

async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  try {
    if (!state.household) state.household = await loadHousehold();
    $('#user-name').textContent = state.household.me.name;
    await renderRoute();
  } catch (err) {
    $('#view').innerHTML = `<div class="alert alert-error">${escapeHTML(friendlyError(err))}</div>`;
    console.error(err);
  }
}

// ---------------------------------------------------------------------
// Página: Teste de conexão
// Confere, uma a uma, as peças do passo 1 e do passo 2.
// ---------------------------------------------------------------------
async function renderTeste(view) {
  const h = state.household;

  const [accRes, catRes, rpcRes] = await Promise.all([
    supabase.from('v_account_balances').select('name, kind, balance').order('name'),
    supabase.from('categories').select('name, kind, color, is_tracked').order('kind').order('name'),
    supabase.rpc('generate_recurrences')
  ]);
  if (accRes.error) throw accRes.error;
  if (catRes.error) throw catRes.error;
  if (rpcRes.error) throw rpcRes.error;

  const kinds = { checking: 'Conta corrente', savings: 'Poupança', cash: 'Dinheiro', credit_card: 'Cartão' };
  const despesas = catRes.data.filter((c) => c.kind === 'expense');
  const receitas = catRes.data.filter((c) => c.kind === 'income');
  const chip = (c) => `
    <span class="chip"><span class="dot" style="background:${escapeHTML(c.color)}"></span>${escapeHTML(c.name)}${c.is_tracked ? ' <small>(acompanhada)</small>' : ''}</span>`;

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
        ${accRes.data.map((a) => `<li><span>${escapeHTML(a.name)} <span class="muted">· ${kinds[a.kind]}</span></span><strong>${formatMoney(a.balance)}</strong></li>`).join('')}
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
      <p>generate_recurrences → <strong>${rpcRes.data}</strong> lançamento(s) gerado(s) <span class="muted">(0 é o esperado agora)</span></p>
    </section>
  `;
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const msg = $('#login-msg');
  msg.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    await signIn($('#login-email').value, $('#login-password').value);
    // onAuthChange cuida de abrir o app
  } catch (err) {
    msg.textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

$('#logout-btn').addEventListener('click', () => signOut());

window.addEventListener('hashchange', () => {
  if (state.household) renderRoute();
});

// ---------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------
document.title = APP_NAME;

// O Supabase dispara este evento logo ao carregar (INITIAL_SESSION),
// então ele sozinho decide se abre o login ou o app.
// O setTimeout é recomendação da documentação do supabase-js: chamar
// outras funções do Supabase DENTRO deste callback pode travar o login.
let lastUserId;
onAuthChange((session) => {
  const uid = session?.user?.id ?? null;
  if (uid === lastUserId) return;   // ignora renovações de token
  lastUserId = uid;
  setTimeout(() => { if (uid) showApp(); else showLogin(); }, 0);
});
