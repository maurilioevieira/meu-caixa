// =====================================================================
//  conta.js — Senha: "Esqueci minha senha", nova senha e "Minha conta"
// ---------------------------------------------------------------------
//  Fluxo de recuperação:
//   1. Na tela de login, "Esqueci minha senha" → informa o e-mail.
//   2. O Supabase envia um e-mail com um link.
//   3. O link abre o app já identificado (evento PASSWORD_RECOVERY) e
//      a janela "Definir nova senha" aparece sozinha.
//
//  Troca normal: com o app aberto, toque no seu nome (no menu) →
//  "Minha conta" → nova senha.
// =====================================================================

import { requestPasswordReset, updatePassword, currentEmail } from './auth.js';
import { openModal, toast, ValidationError } from './ui.js';
import { escapeHTML } from './utils.js';

const MIN_LENGTH = 8;

// ---------------------------------------------------------------------
// Esqueci minha senha (tela de login)
// ---------------------------------------------------------------------
export function openForgotPassword(prefillEmail = '') {
  openModal({
    title: 'Esqueci minha senha',
    submitLabel: 'Enviar link',
    bodyHTML: `
      <p class="hint">Informe o e-mail da sua conta. Você vai receber um link para criar uma
        nova senha. O e-mail pode levar alguns minutos — confira também o spam.</p>
      <div class="field">
        <label for="fp-email">E-mail</label>
        <input id="fp-email" name="email" type="email" autocomplete="username" required
               value="${escapeHTML(prefillEmail)}">
      </div>`,
    onSubmit: async (form) => {
      const email = String(new FormData(form).get('email') || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new ValidationError('Informe um e-mail válido.');
      await requestPasswordReset(email);
      // Mensagem neutra de propósito: não confirma se o e-mail existe,
      // para ninguém usar esta tela para descobrir quem tem conta.
      toast('Se o e-mail estiver cadastrado, o link chegará em instantes.');
    }
  });
}

// ---------------------------------------------------------------------
// Nova senha (usada pelo link do e-mail e pela "Minha conta")
// ---------------------------------------------------------------------
function passwordFieldsHTML() {
  return `
    <div class="field">
      <label for="np-pass">Nova senha</label>
      <input id="np-pass" name="password" type="password" autocomplete="new-password"
             minlength="${MIN_LENGTH}" required>
    </div>
    <div class="field">
      <label for="np-pass2">Repita a nova senha</label>
      <input id="np-pass2" name="password2" type="password" autocomplete="new-password"
             minlength="${MIN_LENGTH}" required>
    </div>
    <label class="check-line">
      <input type="checkbox" id="np-show"> Mostrar senha
    </label>
    <p class="hint">Mínimo de ${MIN_LENGTH} caracteres. Uma frase curta que só você conheça
      é mais segura e mais fácil de lembrar do que uma palavra com símbolos.</p>`;
}

function bindShowPassword(form) {
  form.onchange = (e) => {
    if (e.target.id === 'np-show') {
      const type = e.target.checked ? 'text' : 'password';
      form.querySelector('#np-pass').type = type;
      form.querySelector('#np-pass2').type = type;
    }
  };
}

async function savePassword(form) {
  const f = new FormData(form);
  const pass = String(f.get('password') || '');
  const pass2 = String(f.get('password2') || '');
  if (pass.length < MIN_LENGTH) throw new ValidationError(`A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`);
  if (pass !== pass2) throw new ValidationError('As duas senhas não são iguais.');
  await updatePassword(pass);
}

// Chamada quando a pessoa chega pelo link do e-mail
export function openRecoveryPassword() {
  openModal({
    title: 'Definir nova senha',
    submitLabel: 'Salvar nova senha',
    bodyHTML: `
      <p class="info-box">Você entrou pelo link de recuperação. Escolha agora a sua nova senha.</p>
      ${passwordFieldsHTML()}`,
    onOpen: bindShowPassword,
    onSubmit: async (form) => {
      await savePassword(form);
      toast('Senha alterada. Use a nova senha nos próximos acessos.');
    }
  });
}

// "Minha conta" (dentro do app)
export async function openMyAccount(name) {
  const email = await currentEmail();
  openModal({
    title: 'Minha conta',
    submitLabel: 'Trocar senha',
    bodyHTML: `
      <div class="account-box">
        <div><span class="muted">Nome</span><strong>${escapeHTML(name)}</strong></div>
        <div><span class="muted">E-mail</span><strong>${escapeHTML(email)}</strong></div>
      </div>
      <h3 class="modal-subtitle">Trocar senha</h3>
      ${passwordFieldsHTML()}`,
    onOpen: bindShowPassword,
    onSubmit: async (form) => {
      await savePassword(form);
      toast('Senha alterada.');
    }
  });
}
