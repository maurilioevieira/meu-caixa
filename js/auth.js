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

// Chama o callback sempre que alguém entra ou sai
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
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
