// =====================================================================
//  app.js — Ponto de entrada do app
// ---------------------------------------------------------------------
//  Responsabilidades:
//   1. Decidir entre tela de login e app (conforme a sessão)
//   2. Carregar o grupo familiar uma única vez e guardar em "state"
//   3. Rotear entre páginas pelo "#" da URL (#/lancamentos, #/contas…)
//      — roteamento por hash funciona no GitHub Pages sem configuração.
//
//  Cada página vive em js/pages/<nome>.js e exporta render(view).
//  Para adicionar uma página: importar aqui, incluir em "routes" e
//  colocar o link no menu do index.html.
// =====================================================================

import { supabase } from './supabase.js';
import { signIn, signOut, onAuthChange, loadHousehold } from './auth.js';
import { escapeHTML, friendlyError } from './utils.js';
import { APP_NAME } from './config.js';
import { state } from './state.js';

import * as painel from './pages/painel.js';
import * as lancamentos from './pages/lancamentos.js';
import * as contas from './pages/contas.js';
import * as teste from './pages/teste.js';

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------
// Rotas: nome no hash → módulo da página
// ---------------------------------------------------------------------
const routes = {
  painel,
  lancamentos,
  contas,
  teste
};
const DEFAULT_ROUTE = 'painel';

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[name] ? name : DEFAULT_ROUTE;
}

async function renderRoute() {
  const name = currentRoute();
  document.querySelectorAll('[data-route]').forEach((a) => {
    const active = a.dataset.route === name;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const view = $('#view');
  view.onclick = null;     // limpa ouvintes da página anterior
  view.onchange = null;
  view.innerHTML = '<p class="muted">Carregando…</p>';
  try {
    await routes[name].render(view);
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
    if (!state.household) {
      state.household = await loadHousehold();
      // Gera os lançamentos recorrentes que "venceram" desde o último acesso
      // (ex.: o salário de dezembro aparece sozinho quando novembro chega).
      // Uma vez por login basta; o banco ignora o que já existe.
      const gen = await supabase.rpc('generate_recurrences');
      if (gen.error) console.error(gen.error);
    }
    $('#user-name').textContent = state.household.me.name;
    await renderRoute();
  } catch (err) {
    $('#view').innerHTML = `<div class="alert alert-error">${escapeHTML(friendlyError(err))}</div>`;
    console.error(err);
  }
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
