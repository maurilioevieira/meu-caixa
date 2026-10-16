// =====================================================================
//  pwa.js — Instalação do app no celular/computador
// ---------------------------------------------------------------------
//  • Registra o service worker (sw.js)
//  • Mostra o botão "Instalar app" quando faz sentido:
//      - Android/Chrome/Edge: o navegador avisa que pode instalar
//        (evento beforeinstallprompt) → o botão abre a instalação nativa
//      - iPhone/iPad (Safari): não existe esse aviso → o botão abre as
//        instruções de "Adicionar à Tela de Início"
//      - Já instalado (aberto como app): o botão não aparece
// =====================================================================

import { openModal, toast } from './ui.js';

const button = document.getElementById('install-btn');
let deferredPrompt = null;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPad novo se identifica como Mac

// 1. Service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('Service worker:', err));
  });
}

// 2. Botão de instalar
if (button && !isStandalone()) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // guarda o aviso para usar no clique do botão
    deferredPrompt = e;
    button.hidden = false;
  });

  if (isIOS()) button.hidden = false;

  button.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') button.hidden = true;
      return;
    }
    if (isIOS()) {
      openModal({
        title: 'Instalar no iPhone',
        submitLabel: 'Entendi',
        bodyHTML: `
          <ol class="steps">
            <li>Abra este endereço no <strong>Safari</strong>.</li>
            <li>Toque no botão <strong>Compartilhar</strong> (quadrado com seta para cima).</li>
            <li>Escolha <strong>Adicionar à Tela de Início</strong> e confirme em <strong>Adicionar</strong>.</li>
          </ol>
          <p class="hint">O ícone “Meu Caixa” aparece na tela inicial e abre em tela cheia, como um aplicativo.</p>`,
        onSubmit: async () => {}
      });
      return;
    }
    toast('Use o menu do navegador → “Instalar app” ou “Adicionar à tela inicial”.');
  });

  window.addEventListener('appinstalled', () => {
    button.hidden = true;
    toast('App instalado.');
  });
}
