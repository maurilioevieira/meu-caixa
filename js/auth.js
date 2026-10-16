// =====================================================================
//  auth.js — Login, logout e dados do usuário logado
// =====================================================================

import { supabase } from './supabase.js';

// Sessão atual (null se ninguém estiver logado)
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Chama o callback sempre que alguém entra ou sai.
// Recebe também o tipo do evento: 'PASSWORD_RECOVERY' indica que a pessoa
// chegou pelo link de "esqueci minha senha" e precisa definir a nova.
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((event, session) => callback(session, event));
}

// Endereço para onde o link do e-mail de recuperação leva de volta.
// Precisa estar na lista "Redirect URLs" do Supabase (passo 4.4).
function appAddress() {
  return window.location.origin + window.location.pathname.replace(/index\.html$/, '');
}

// Envia o e-mail com o link para criar uma nova senha
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: appAddress()
  });
  if (error) throw error;
}

// Troca a senha de quem está logado (inclusive quem veio pelo link do e-mail)
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// E-mail de quem está logado
export async function currentEmail() {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? '';
}

// Grupo familiar do usuário logado + membros.
// Graças ao RLS, a consulta só devolve o grupo do qual ele faz parte.
export async function loadHousehold() {
  const { data: { user } } = await supabase.auth.getUser();

  const { data: members, error } = await supabase
    .from('household_members')
    .select('household_id, user_id, display_name, role, households(name)');

  if (error) throw error;
  if (!members || members.length === 0) {
    throw new Error('Seu usuário não está vinculado a nenhum grupo familiar (confira o passo 2).');
  }

  const me = members.find((m) => m.user_id === user.id);
  return {
    householdId: me.household_id,
    householdName: me.households?.name ?? 'Casa',
    me: { id: user.id, email: user.email, name: me.display_name, role: me.role },
    members: members.map((m) => ({ id: m.user_id, name: m.display_name, role: m.role }))
  };
}
