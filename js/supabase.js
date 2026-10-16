// =====================================================================
//  supabase.js — Cliente único do Supabase
// ---------------------------------------------------------------------
//  Um só cliente para o app inteiro: todas as páginas importam daqui.
//  A biblioteca (versão 2.45.4) fica DENTRO do projeto, em js/vendor/,
//  em vez de vir de um CDN. Motivos:
//   • o app instalado abre mesmo sem internet (o service worker guarda
//     o arquivo junto com o resto do app);
//   • não depende de servidor de terceiros estar no ar;
//   • a versão só muda quando você trocar o arquivo.
// =====================================================================

import { createClient } from './vendor/supabase-2.45.4.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // continua logado ao fechar o navegador
    autoRefreshToken: true,    // renova o token sozinho
    detectSessionInUrl: true   // necessário para o link de "esqueci a senha"
  }
});
