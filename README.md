# Meu Caixa — Controle Financeiro Pessoal

Webapp pessoal (HTML + CSS + JavaScript puro) com Supabase e GitHub Pages.

## Rodar localmente
Os módulos JavaScript (`type="module"`) não funcionam abrindo o arquivo direto
(`file://`). Use um servidor local na pasta do projeto:

    python -m http.server 5500

e acesse http://localhost:5500

## Estrutura
    index.html          login, casca do app, janela de formulário e aviso
    css/style.css       visual
    js/config.js        URL e chave anon do Supabase
    js/supabase.js      cliente único do Supabase
    js/state.js         estado compartilhado (grupo familiar)
    js/data.js          leituras comuns (contas, categorias)
    js/auth.js          login, logout, grupo familiar
    js/utils.js         moeda, datas, escape de HTML, mensagens de erro
    js/ui.js            janela (modal), aviso rápido, confirmação
    js/app.js           inicialização e rotas (#/pagina)
    js/pages/painel.js  Painel (tela inicial)
    js/pages/lancamentos.js  Lançamentos (receitas, despesas, transferências)
    js/pages/contas.js  Contas e cartões (inclui pagar fatura)
    js/pages/teste.js   Teste de conexão (diagnóstico)
    sql/                scripts do banco (passos 1 e 2)
