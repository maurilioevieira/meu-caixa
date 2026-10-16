// =====================================================================
//  sw.js — Service worker do Meu Caixa (o que torna o app "instalável")
// ---------------------------------------------------------------------
//  Estratégias, por tipo de requisição:
//
//  1. Dados do Supabase (*.supabase.co): NUNCA passam pelo cache.
//     Dinheiro tem que ser sempre o valor atual do banco.
//
//  2. Arquivos do próprio app (html, css, js, ícones): REDE PRIMEIRO.
//     Online, sempre baixa a versão mais nova (você publica uma
//     atualização no GitHub e ela aparece na hora). Sem internet, usa a
//     cópia guardada — o app abre e mostra "sem conexão" em vez de uma
//     tela de erro do navegador.
//
//  3. Fontes do Google (CDN): CACHE PRIMEIRO. Mudam raramente; sem
//     elas o app usa a fonte do sistema. (A biblioteca do Supabase fica
//     no próprio projeto, em js/vendor/, e entra no item 2.)
//
//  Ao mudar a lista de arquivos, aumente VERSION para limpar o cache antigo.
// =====================================================================

const VERSION = 'meu-caixa-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/config.js',
  './js/data.js',
  './js/state.js',
  './js/supabase.js',
  './js/ui.js',
  './js/utils.js',
  './js/pwa.js',
  './js/conta.js',
  './js/vendor/supabase-2.45.4.js',
  './js/pages/painel.js',
  './js/pages/lancamentos.js',
  './js/pages/contas.js',
  './js/pages/acompanhamento.js',
  './js/pages/categorias.js',
  './js/pages/teste.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Instalação: guarda a "casca" do app
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// Ativação: apaga caches de versões anteriores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // gravações vão direto
  const url = new URL(req.url);

  // 1. Supabase: sempre direto da rede
  if (url.hostname.endsWith('supabase.co')) return;

  // 3. CDN: cache primeiro
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // 2. Arquivos do app: rede primeiro, cópia guardada se estiver offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true })
            .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
        )
    );
  }
});
