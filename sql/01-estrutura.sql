-- =====================================================================
--  CONTROLE FINANCEIRO PESSOAL — PASSO 1: ESTRUTURA DO BANCO
--  Onde executar: Supabase > SQL Editor > New query > colar tudo > Run
--  Executar UMA única vez, no projeto novo.
-- =====================================================================
--  Convenções adotadas:
--  • Dinheiro sempre em numeric(12,2) — nunca float (evita 0,1+0,2≠0,3).
--  • Todos os dados pertencem a um "grupo familiar" (household); você e
--    sua esposa são membros do mesmo grupo e enxergam os mesmos dados.
--  • "Pendente" = paid_at nulo. "Vencido" é calculado na view, nunca salvo.
--  • Totais do mês usam due_date (regime de caixa: quando o dinheiro sai).
--  • Datas "de hoje" no fuso de Fortaleza, não em UTC.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. "Hoje" no fuso de Fortaleza
--    O servidor do Supabase roda em UTC: às 21h de Iguatu já é o dia
--    seguinte em UTC. Esta função evita lançamentos com data errada.
-- ---------------------------------------------------------------------
create or replace function public.today_br()
returns date
language sql stable
set search_path = ''
as $$
  select (now() at time zone 'America/Fortaleza')::date;
$$;


-- ---------------------------------------------------------------------
-- 1. GRUPO FAMILIAR E MEMBROS
--    Só leitura pelo app. Criação e inclusão de membros são feitas
--    por você no SQL Editor (passo 2) — ninguém se "convida" pelo app.
-- ---------------------------------------------------------------------
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  created_at  timestamptz not null default now()
);

create table public.household_members (
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  role          text not null default 'member' check (role in ('owner', 'member')),
  created_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

-- Grupos do usuário logado. "security definer" para a política de RLS
-- não precisar consultar household_members passando pela própria RLS
-- (o que causaria recursão infinita).
create or replace function public.my_household_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select household_id from public.household_members where user_id = auth.uid();
$$;


-- ---------------------------------------------------------------------
-- 2. CONTAS (corrente, poupança, dinheiro, cartão de crédito)
--    Dias de fechamento/vencimento limitados a 1–28 para existirem
--    em todos os meses (fevereiro incluso).
-- ---------------------------------------------------------------------
create table public.accounts (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 60),
  kind             text not null check (kind in ('checking', 'savings', 'cash', 'credit_card')),
  initial_balance  numeric(12,2) not null default 0,
  credit_limit     numeric(12,2) check (credit_limit is null or credit_limit >= 0),
  closing_day      smallint check (closing_day between 1 and 28),
  due_day          smallint check (due_day between 1 and 28),
  color            text not null default '#1F5C46' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (household_id, id),
  constraint accounts_card_fields check (
    (kind = 'credit_card' and closing_day is not null and due_day is not null and initial_balance = 0)
    or
    (kind <> 'credit_card' and closing_day is null and due_day is null and credit_limit is null)
  )
);


-- ---------------------------------------------------------------------
-- 3. CATEGORIAS (com orçamento mensal opcional)
--    is_tracked = categoria com página própria de acompanhamento
--    (ex.: "Bebida alcoólica"). Serve para qualquer outra no futuro.
-- ---------------------------------------------------------------------
create table public.categories (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 40),
  kind            text not null check (kind in ('income', 'expense')),
  color           text not null default '#56635C' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  monthly_budget  numeric(12,2) check (monthly_budget is null or monthly_budget > 0),
  is_tracked      boolean not null default false,
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (household_id, id),
  unique (household_id, kind, name)
);


-- ---------------------------------------------------------------------
-- 4. COMPRAS PARCELADAS (o "cabeçalho"; as parcelas são transações)
-- ---------------------------------------------------------------------
create table public.installment_groups (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households(id) on delete cascade,
  description         text not null check (char_length(description) between 1 and 120),
  total_amount        numeric(12,2) not null check (total_amount > 0),
  installments_count  smallint not null check (installments_count between 2 and 72),
  first_date          date not null,
  account_id          uuid not null,
  category_id         uuid not null,
  created_by          uuid default auth.uid() references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, account_id)  references public.accounts(household_id, id),
  foreign key (household_id, category_id) references public.categories(household_id, id)
);


-- ---------------------------------------------------------------------
-- 5. LANÇAMENTOS RECORRENTES (salário, aluguel, internet, assinaturas)
--    generated_until = último mês já gerado. Assim, se você apagar
--    uma ocorrência de propósito, ela não é recriada.
-- ---------------------------------------------------------------------
create table public.recurrences (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households(id) on delete cascade,
  type             text not null check (type in ('income', 'expense')),
  description      text not null check (char_length(description) between 1 and 120),
  amount           numeric(12,2) not null check (amount > 0),
  account_id       uuid not null,
  category_id      uuid not null,
  day_of_month     smallint not null check (day_of_month between 1 and 28),
  start_month      date not null check (extract(day from start_month) = 1),
  end_month        date check (end_month is null or (extract(day from end_month) = 1 and end_month >= start_month)),
  generated_until  date,
  active           boolean not null default true,
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, account_id)  references public.accounts(household_id, id),
  foreign key (household_id, category_id) references public.categories(household_id, id)
);


-- ---------------------------------------------------------------------
-- 6. TRANSAÇÕES — a tabela central (modelo unificado)
--    Receita, despesa, transferência, conta a pagar/receber, parcela,
--    recorrência e compra no cartão: tudo é uma linha aqui.
--
--    occurred_on   = data da compra / do fato
--    due_date      = vencimento (quando o dinheiro sai ou entra)
--    paid_at       = data do pagamento (nulo = pendente)
--    invoice_month = só cartão: 1º dia do mês em que a fatura vence
--
--    As chaves estrangeiras compostas (household_id, id) garantem que
--    um lançamento nunca aponte para conta/categoria de outro grupo.
-- ---------------------------------------------------------------------
create table public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  type                  text not null check (type in ('income', 'expense', 'transfer')),
  description           text not null check (char_length(description) between 1 and 120),
  amount                numeric(12,2) not null check (amount > 0),
  account_id            uuid not null,
  to_account_id         uuid,
  category_id           uuid,
  occurred_on           date not null default public.today_br(),
  due_date              date not null default public.today_br(),
  paid_at               date,
  invoice_month         date check (invoice_month is null or extract(day from invoice_month) = 1),
  installment_group_id  uuid,
  installment_number    smallint check (installment_number is null or installment_number >= 1),
  recurrence_id         uuid,
  notes                 text check (notes is null or char_length(notes) <= 500),
  created_by            uuid default auth.uid() references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  foreign key (household_id, account_id)    references public.accounts(household_id, id),
  foreign key (household_id, to_account_id) references public.accounts(household_id, id),
  foreign key (household_id, category_id)   references public.categories(household_id, id),
  foreign key (household_id, installment_group_id)
    references public.installment_groups(household_id, id) on delete cascade,
  foreign key (household_id, recurrence_id)
    references public.recurrences(household_id, id) on delete set null (recurrence_id),

  -- Transferência: tem conta de destino e não tem categoria.
  -- Receita/despesa: tem categoria e não tem conta de destino.
  constraint transactions_transfer_shape check (
    (type = 'transfer' and to_account_id is not null and to_account_id <> account_id and category_id is null)
    or
    (type <> 'transfer' and to_account_id is null and category_id is not null)
  ),
  -- Número da parcela existe se, e somente se, pertence a um parcelamento.
  constraint transactions_installment_shape check (
    (installment_group_id is null) = (installment_number is null)
  )
);

create index transactions_household_due_idx  on public.transactions (household_id, due_date);
create index transactions_household_occ_idx  on public.transactions (household_id, occurred_on);
create index transactions_invoice_idx        on public.transactions (account_id, invoice_month) where invoice_month is not null;
create index transactions_category_idx       on public.transactions (category_id);
create index transactions_installment_idx    on public.transactions (installment_group_id) where installment_group_id is not null;
create index transactions_to_account_idx     on public.transactions (to_account_id) where to_account_id is not null;
create unique index transactions_recurrence_uq on public.transactions (recurrence_id, occurred_on) where recurrence_id is not null;


-- ---------------------------------------------------------------------
-- 7. REGRA DO CARTÃO: em qual fatura cai uma compra
--    Ex.: fecha dia 9, vence dia 16.
--      compra 05/10 → fatura de outubro (vence 16/10)
--      compra 14/10 → fatura de novembro (vence 16/11)
--    Ex.: fecha dia 25, vence dia 5.
--      compra 20/10 → fecha em 25/10 → vence 05/11
-- ---------------------------------------------------------------------
create or replace function public.card_invoice_month(p_account_id uuid, p_date date)
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v_closing  smallint;
  v_due      smallint;
  v_month    date;
begin
  select closing_day, due_day into v_closing, v_due
    from public.accounts
   where id = p_account_id and kind = 'credit_card';
  if not found then
    return null;
  end if;

  -- Mês em que a fatura FECHA (compra no dia do fechamento já vai para a próxima)
  v_month := date_trunc('month', p_date)::date;
  if extract(day from p_date) >= v_closing then
    v_month := (v_month + interval '1 month')::date;
  end if;

  -- Se o vencimento é "antes" do fechamento no calendário, vence no mês seguinte
  if v_due <= v_closing then
    v_month := (v_month + interval '1 month')::date;
  end if;

  return v_month;
end;
$$;


-- ---------------------------------------------------------------------
-- 8. GATILHO DAS TRANSAÇÕES
--    • Atualiza updated_at.
--    • Despesa no cartão: calcula a fatura e o vencimento sozinho.
--    • Qualquer outra: garante invoice_month nulo.
-- ---------------------------------------------------------------------
create or replace function public.tg_transactions_before()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind  text;
  v_due   smallint;
begin
  new.updated_at := now();

  select kind, due_day into v_kind, v_due
    from public.accounts where id = new.account_id;

  if v_kind = 'credit_card' and new.type = 'expense' then
    -- Compra à vista: recalcula a fatura na criação ou se data/conta/tipo mudarem.
    -- Parcela: a fatura vem pronta da função de parcelamento.
    if new.installment_group_id is null and (
         tg_op = 'INSERT'
         or new.occurred_on is distinct from old.occurred_on
         or new.account_id  is distinct from old.account_id
         or new.type        is distinct from old.type
       ) then
      new.invoice_month := public.card_invoice_month(new.account_id, new.occurred_on);
    end if;

    if new.invoice_month is null then
      raise exception 'Despesa no cartão sem fatura definida';
    end if;

    if tg_op = 'INSERT' or new.invoice_month is distinct from old.invoice_month then
      new.due_date := new.invoice_month + (v_due - 1);
    end if;
  else
    new.invoice_month := null;
  end if;

  return new;
end;
$$;

create trigger transactions_before
before insert or update on public.transactions
for each row execute function public.tg_transactions_before();


-- ---------------------------------------------------------------------
-- 9. CRIAR COMPRA PARCELADA (chamada pelo app via supabase.rpc)
--    Gera o cabeçalho + N parcelas pendentes. Centavos que sobram da
--    divisão vão para a última parcela (ex.: 100,00 em 3x = 33,33 +
--    33,33 + 33,34), assim a soma bate exatamente com o total.
-- ---------------------------------------------------------------------
create or replace function public.create_installment_purchase(
  p_household_id  uuid,
  p_description   text,
  p_total         numeric,
  p_count         integer,
  p_first_date    date,
  p_account_id    uuid,
  p_category_id   uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_group  uuid;
  v_kind   text;
  v_base   numeric(12,2);
  v_last   numeric(12,2);
  v_inv    date;
  i        integer;
begin
  if p_count is null or p_count < 2 or p_count > 72 then
    raise exception 'O número de parcelas deve ser entre 2 e 72';
  end if;

  insert into public.installment_groups
    (household_id, description, total_amount, installments_count, first_date, account_id, category_id)
  values
    (p_household_id, p_description, p_total, p_count, p_first_date, p_account_id, p_category_id)
  returning id into v_group;

  select kind into v_kind from public.accounts where id = p_account_id;

  v_base := trunc(p_total / p_count, 2);
  v_last := p_total - v_base * (p_count - 1);

  if v_kind = 'credit_card' then
    v_inv := public.card_invoice_month(p_account_id, p_first_date);
  end if;

  for i in 1..p_count loop
    insert into public.transactions
      (household_id, type, description, amount, account_id, category_id,
       occurred_on, due_date, invoice_month, installment_group_id, installment_number)
    values
      (p_household_id, 'expense',
       p_description || ' (' || i || '/' || p_count || ')',
       case when i = p_count then v_last else v_base end,
       p_account_id, p_category_id,
       p_first_date,
       (p_first_date + make_interval(months => i - 1))::date,
       case when v_inv is not null then (v_inv + make_interval(months => i - 1))::date end,
       v_group, i);
  end loop;

  return v_group;
end;
$$;


-- ---------------------------------------------------------------------
-- 10. PAGAR FATURA DO CARTÃO (chamada pelo app via supabase.rpc)
--     Marca as compras da fatura como pagas e registra uma
--     TRANSFERÊNCIA da conta bancária para o cartão. Assim a despesa
--     não é contada duas vezes: ela já foi contada na compra.
-- ---------------------------------------------------------------------
create or replace function public.pay_card_invoice(
  p_card_id          uuid,
  p_invoice_month    date,
  p_from_account_id  uuid,
  p_paid_on          date default null
)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_household  uuid;
  v_name       text;
  v_total      numeric(12,2);
  v_paid_on    date := coalesce(p_paid_on, public.today_br());
begin
  select household_id, name into v_household, v_name
    from public.accounts
   where id = p_card_id and kind = 'credit_card';
  if not found then
    raise exception 'Cartão não encontrado';
  end if;

  select coalesce(sum(amount), 0) into v_total
    from public.transactions
   where account_id = p_card_id and type = 'expense'
     and invoice_month = p_invoice_month and paid_at is null;

  if v_total = 0 then
    raise exception 'Não há valores pendentes nesta fatura';
  end if;

  update public.transactions
     set paid_at = v_paid_on
   where account_id = p_card_id and type = 'expense'
     and invoice_month = p_invoice_month and paid_at is null;

  insert into public.transactions
    (household_id, type, description, amount, account_id, to_account_id,
     occurred_on, due_date, paid_at)
  values
    (v_household, 'transfer',
     'Pagamento fatura ' || v_name || ' ' || to_char(p_invoice_month, 'MM/YYYY'),
     v_total, p_from_account_id, p_card_id,
     v_paid_on, v_paid_on, v_paid_on);

  return v_total;
end;
$$;


-- ---------------------------------------------------------------------
-- 11. GERAR RECORRÊNCIAS (o app chama ao abrir: supabase.rpc)
--     Cria as ocorrências que faltam até p_until (padrão: fim do
--     próximo mês). O índice único impede duplicar.
-- ---------------------------------------------------------------------
create or replace function public.generate_recurrences(p_until date default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_until  date := coalesce(
             p_until,
             (date_trunc('month', public.today_br()) + interval '2 months - 1 day')::date);
  r        record;
  v_month  date;
  v_last   date;
  v_date   date;
  v_rows   integer;
  v_total  integer := 0;
begin
  for r in
    select * from public.recurrences where active
  loop
    v_month := greatest(r.start_month,
                        coalesce((r.generated_until + interval '1 month')::date, r.start_month));
    v_last  := null;

    while v_month <= v_until
      and (r.end_month is null or v_month <= r.end_month)
    loop
      v_date := v_month + (r.day_of_month - 1);
      exit when v_date > v_until;

      insert into public.transactions
        (household_id, type, description, amount, account_id, category_id,
         occurred_on, due_date, recurrence_id)
      values
        (r.household_id, r.type, r.description, r.amount, r.account_id, r.category_id,
         v_date, v_date, r.id)
      on conflict (recurrence_id, occurred_on) where recurrence_id is not null do nothing;

      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      v_last  := v_month;
      v_month := (v_month + interval '1 month')::date;
    end loop;

    if v_last is not null then
      update public.recurrences set generated_until = v_last where id = r.id;
    end if;
  end loop;

  return v_total;
end;
$$;


-- ---------------------------------------------------------------------
-- 12. VIEWS (security_invoker = a RLS de quem consulta continua valendo)
-- ---------------------------------------------------------------------

-- Lançamentos com status calculado: paid / overdue / pending
create view public.v_transactions
with (security_invoker = true) as
select
  t.*,
  case
    when t.paid_at is not null           then 'paid'
    when t.due_date < public.today_br()  then 'overdue'
    else 'pending'
  end as status
from public.transactions t;

-- Saldo de cada conta.
-- Conta comum: saldo inicial + o que já foi efetivamente pago/recebido.
-- Cartão: saldo negativo = dívida; toda compra (até parcela futura)
-- consome limite, como no banco. Pagamento da fatura reduz a dívida.
create view public.v_account_balances
with (security_invoker = true) as
select
  a.id            as account_id,
  a.household_id,
  a.name,
  a.kind,
  a.color,
  a.archived,
  a.credit_limit,
  a.initial_balance + coalesce(sum(
    case
      when t.to_account_id = a.id then  t.amount   -- transferência recebida
      when t.type = 'income'      then  t.amount
      else                             -t.amount   -- despesa ou transferência enviada
    end
  ) filter (
    where t.paid_at is not null
       or (a.kind = 'credit_card' and t.type = 'expense')
  ), 0)::numeric(12,2) as balance
from public.accounts a
left join public.transactions t
       on t.account_id = a.id or t.to_account_id = a.id
group by a.id;

-- Faturas de cartão: total, quantidade de itens e se já foi paga.
create view public.v_card_invoices
with (security_invoker = true) as
select
  t.household_id,
  t.account_id,
  a.name                                as card_name,
  t.invoice_month,
  (t.invoice_month + (a.due_day - 1))   as due_date,
  sum(t.amount)::numeric(12,2)          as total,
  coalesce(sum(t.amount) filter (where t.paid_at is null), 0)::numeric(12,2) as pending_total,
  count(*)                              as items,
  bool_and(t.paid_at is not null)       as paid
from public.transactions t
join public.accounts a on a.id = t.account_id
where a.kind = 'credit_card' and t.type = 'expense'
group by t.household_id, t.account_id, a.name, t.invoice_month, a.due_day;


-- ---------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY
--     Regra única: você só toca em linhas do(s) seu(s) grupo(s).
--     (O "automatic RLS" do projeto já liga; repetimos por garantia.)
-- ---------------------------------------------------------------------
alter table public.households          enable row level security;
alter table public.household_members   enable row level security;
alter table public.accounts            enable row level security;
alter table public.categories          enable row level security;
alter table public.installment_groups  enable row level security;
alter table public.recurrences         enable row level security;
alter table public.transactions        enable row level security;

create policy households_select on public.households
  for select to authenticated
  using (id in (select public.my_household_ids()));

create policy household_members_select on public.household_members
  for select to authenticated
  using (household_id in (select public.my_household_ids()));

create policy accounts_all on public.accounts
  for all to authenticated
  using      (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

create policy categories_all on public.categories
  for all to authenticated
  using      (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

create policy installment_groups_all on public.installment_groups
  for all to authenticated
  using      (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

create policy recurrences_all on public.recurrences
  for all to authenticated
  using      (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

create policy transactions_all on public.transactions
  for all to authenticated
  using      (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));


-- ---------------------------------------------------------------------
-- 14. PERMISSÕES DA API (lembra que desligamos o "expose automático")
--     Só o papel "authenticated" (usuário logado) recebe acesso.
--     O papel "anon" (chave pública visível no GitHub Pages) não vê nada.
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select on public.households, public.household_members to authenticated;

grant select, insert, update, delete on
  public.accounts,
  public.categories,
  public.installment_groups,
  public.recurrences,
  public.transactions
to authenticated;

grant select on
  public.v_transactions,
  public.v_account_balances,
  public.v_card_invoices
to authenticated;

-- Funções: por padrão o Postgres libera EXECUTE para todos; fechamos.
revoke execute on all functions in schema public from public, anon;

grant execute on function
  public.today_br(),
  public.my_household_ids(),
  public.card_invoice_month(uuid, date),
  public.create_installment_purchase(uuid, text, numeric, integer, date, uuid, uuid),
  public.pay_card_invoice(uuid, date, uuid, date),
  public.generate_recurrences(date)
to authenticated;


-- ---------------------------------------------------------------------
-- 15. CONFERÊNCIA — o resultado deve listar 7 tabelas, todas "true"
-- ---------------------------------------------------------------------
select tablename as tabela, rowsecurity as rls_ativo
  from pg_tables
 where schemaname = 'public'
 order by tablename;
