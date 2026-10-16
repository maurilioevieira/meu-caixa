// =====================================================================
//  data.js — Leituras comuns a várias páginas (contas e categorias)
// ---------------------------------------------------------------------
//  Centralizar aqui evita repetir a mesma consulta em cada página e
//  garante que todas usem os mesmos critérios de ordenação.
// =====================================================================

import { supabase } from './supabase.js';

export const KIND_LABEL = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Dinheiro em espécie',
  credit_card: 'Cartão de crédito'
};

// Todas as contas e cartões (inclusive arquivados), em ordem de cadastro
export async function fetchAccounts() {
  const { data, error } = await supabase.from('accounts').select('*').order('created_at');
  if (error) throw error;
  return data;
}

// Todas as categorias (inclusive arquivadas), em ordem alfabética
export async function fetchCategories() {
  const { data, error } = await supabase.from('categories').select('*').order('name');
  if (error) throw error;
  return data;
}

// Transforma uma lista em Map por id, para buscas rápidas
export function byId(list) {
  return new Map(list.map((x) => [x.id, x]));
}
