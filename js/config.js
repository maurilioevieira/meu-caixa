// =====================================================================
//  config.js — Configuração do projeto Supabase
// ---------------------------------------------------------------------
//  A chave "anon" é PÚBLICA por natureza: ela vai para o navegador de
//  qualquer forma. Quem protege os dados é o RLS + os GRANTs do passo 1
//  (o papel anon não tem acesso a nenhuma tabela).
//  NUNCA coloque aqui a chave "service_role" — essa ignora o RLS.
// =====================================================================

export const SUPABASE_URL = 'https://ytmskbiayudtyoqsxaym.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0bXNrYmlheXVkdHlvcXN4YXltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMDY5OTMsImV4cCI6MjEwNzY4Mjk5M30.fE-z3ZQ5Chlpg8b2sVFlRzlbs0Ia0uLSVOQWaeWtPA0';

export const APP_NAME = 'Meu Caixa';
