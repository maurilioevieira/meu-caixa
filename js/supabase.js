// =====================================================================
//  supabase.js — Cliente único do Supabase
// ---------------------------------------------------------------------
//  Um só cliente para o app inteiro: todas as páginas importam daqui.
//  Versão fixada (2.45.4) para uma atualização da biblioteca nunca
//  quebrar o app sem você ter mudado nada.
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // continua logado ao fechar o navegador
    autoRefreshToken: true,    // renova o token sozinho
    detectSessionInUrl: true   // necessário para o link de "esqueci a senha"
  }
});
