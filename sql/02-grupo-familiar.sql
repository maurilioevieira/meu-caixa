-- =====================================================================
--  CONTROLE FINANCEIRO PESSOAL — PASSO 2: GRUPO FAMILIAR E DADOS INICIAIS
--  Pré-requisito: os DOIS usuários já criados em Authentication > Users.
--  Onde executar: Supabase > SQL Editor > New query > colar tudo > Run
--  Executar UMA única vez.
-- =====================================================================
--  >>> EDITE APENAS AS 4 LINHAS MARCADAS COM "EDITAR" <<<
-- =====================================================================

do $$
declare
  -- EDITAR: e-mails exatamente como cadastrados em Authentication > Users
  v_email_1  text := 'seu-email@exemplo.com';         -- EDITAR (você — dono)
  v_email_2  text := 'email-da-esposa@exemplo.com';   -- EDITAR (esposa — membro)

  -- EDITAR: nomes que aparecerão no app ("lançado por ...")
  v_nome_1   text := 'Maurílio';                      -- EDITAR
  v_nome_2   text := 'Nadir';                         -- EDITAR

  v_user_1   uuid;
  v_user_2   uuid;
  v_house    uuid;
begin
  -- 1. Localiza os usuários (sem diferenciar maiúsculas/minúsculas)
  select id into v_user_1 from auth.users where lower(email) = lower(trim(v_email_1));
  select id into v_user_2 from auth.users where lower(email) = lower(trim(v_email_2));

  if v_user_1 is null then
    raise exception 'Usuário não encontrado: %. Confira o e-mail em Authentication > Users.', v_email_1;
  end if;
  if v_user_2 is null then
    raise exception 'Usuário não encontrado: %. Confira o e-mail em Authentication > Users.', v_email_2;
  end if;

  -- Evita rodar duas vezes por engano
  if exists (select 1 from public.household_members where user_id in (v_user_1, v_user_2)) then
    raise exception 'Um dos usuários já pertence a um grupo. O passo 2 já foi executado.';
  end if;

  -- 2. Cria o grupo familiar e vincula os dois
  insert into public.households (name) values ('Casa') returning id into v_house;

  insert into public.household_members (household_id, user_id, display_name, role) values
    (v_house, v_user_1, v_nome_1, 'owner'),
    (v_house, v_user_2, v_nome_2, 'member');

  -- 3. Conta inicial: dinheiro em espécie (bancos e cartões serão
  --    cadastrados pelo próprio app, com saldo e datas reais)
  insert into public.accounts (household_id, name, kind, initial_balance, color) values
    (v_house, 'Carteira', 'cash', 0, '#1F5C46');

  -- 4. Categorias de DESPESA
  insert into public.categories (household_id, name, kind, color, is_tracked) values
    (v_house, 'Moradia',          'expense', '#23406E', false),
    (v_house, 'Alimentação',      'expense', '#B4541A', false),
    (v_house, 'Mercado',          'expense', '#8A5A00', false),
    (v_house, 'Transporte',       'expense', '#2F6F8F', false),
    (v_house, 'Saúde',            'expense', '#A23B5A', false),
    (v_house, 'Educação',         'expense', '#4B2A78', false),
    (v_house, 'Lazer',            'expense', '#2E7D5B', false),
    (v_house, 'Bebida alcoólica', 'expense', '#7A3A0C', true),   -- página própria
    (v_house, 'Vestuário',        'expense', '#6B4E9B', false),
    (v_house, 'Assinaturas',      'expense', '#3E5C76', false),
    (v_house, 'Presentes',        'expense', '#9C4A2F', false),
    (v_house, 'Outras despesas',  'expense', '#56635C', false);

  -- 5. Categorias de RECEITA
  insert into public.categories (household_id, name, kind, color) values
    (v_house, 'Salário',          'income', '#1F5C46'),
    (v_house, 'Renda extra',      'income', '#2E7D5B'),
    (v_house, 'Reembolso',        'income', '#3F7F6A'),
    (v_house, 'Outras receitas',  'income', '#56635C');

  raise notice 'Grupo criado com sucesso: %', v_house;
end;
$$;


-- ---------------------------------------------------------------------
-- CONFERÊNCIA — deve mostrar 2 membros, 1 conta e 16 categorias
-- ---------------------------------------------------------------------
select 'membros'    as item, count(*) as total from public.household_members
union all
select 'contas',             count(*)          from public.accounts
union all
select 'categorias',         count(*)          from public.categories;
