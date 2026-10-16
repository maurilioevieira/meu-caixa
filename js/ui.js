// =====================================================================
//  ui.js — Componentes de interface reutilizáveis: janela (modal) e aviso
// ---------------------------------------------------------------------
//  A janela usa o elemento nativo <dialog> do navegador: ele já cuida
//  de foco, tecla Esc e fundo escurecido, sem biblioteca externa.
// =====================================================================

import { escapeHTML, friendlyError } from './utils.js';

const dialog = document.getElementById('modal');
const form = document.getElementById('modal-form');
const titleEl = document.getElementById('modal-title');
const bodyEl = document.getElementById('modal-body');
const errorEl = document.getElementById('modal-error');
const submitBtn = document.getElementById('modal-submit');
const cancelBtn = document.getElementById('modal-cancel');

let currentSubmit = null;

/**
 * Abre a janela com um formulário.
 * @param {object}   opts
 * @param {string}   opts.title        Título da janela
 * @param {string}   opts.bodyHTML     HTML dos campos (já escapado por quem chama)
 * @param {string}   opts.submitLabel  Texto do botão principal
 * @param {Function} opts.onOpen       Chamada após abrir (para ligar eventos dos campos —
 *                                     use form.onchange / form.oninput, nunca addEventListener)
 * @param {Function} opts.onSubmit     async (formElement) → se lançar erro, ele aparece na janela
 */
export function openModal({ title, bodyHTML, submitLabel = 'Salvar', onOpen, onSubmit }) {
  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHTML;
  errorEl.textContent = '';
  submitBtn.textContent = submitLabel;
  submitBtn.disabled = false;
  currentSubmit = onSubmit;
  // Limpa reações da janela anterior: a janela é a mesma para todos os
  // formulários, então reações antigas não podem sobreviver à troca.
  form.onchange = null;
  form.oninput = null;
  dialog.showModal();
  if (onOpen) onOpen(form);
  const first = bodyEl.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled])');
  if (first) first.focus();
}

export function closeModal() {
  dialog.close();
  currentSubmit = null;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentSubmit) return;
  errorEl.textContent = '';
  submitBtn.disabled = true;
  const label = submitBtn.textContent;
  submitBtn.textContent = 'Salvando…';
  try {
    await currentSubmit(form);
    closeModal();
  } catch (err) {
    errorEl.textContent = friendlyError(err);
    if (!(err instanceof ValidationError)) console.error(err);   // erro de digitação não é bug
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = label;
  }
});

cancelBtn.addEventListener('click', closeModal);

// Erro de validação feito no próprio app (mensagem já pronta para o usuário)
export class ValidationError extends Error {}

// ---------------------------------------------------------------------
// Aviso rápido no rodapé ("Conta salva.")
// ---------------------------------------------------------------------
const toastEl = document.getElementById('toast');
let toastTimer;

export function toast(message, type = 'ok') {
  toastEl.innerHTML = escapeHTML(message);
  toastEl.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3200);
}

// ---------------------------------------------------------------------
// Confirmação simples antes de ações destrutivas
// ---------------------------------------------------------------------
export function confirmAction(message) {
  return window.confirm(message);
}
