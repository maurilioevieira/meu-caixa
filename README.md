# Meu Caixa — Controle Financeiro Pessoal

Webapp pessoal (HTML + CSS + JavaScript puro) com Supabase e GitHub Pages.

## Rodar localmente
Os módulos JavaScript (`type="module"`) não funcionam abrindo o arquivo direto
(`file://`). Use um servidor local na pasta do projeto:

    python -m http.server 5500

e acesse http://localhost:5500

## Estrutura
    index.html        login + casca do app
    css/style.css     visual
    js/config.js      URL e chave anon do Supabase
    js/supabase.js    cliente único do Supabase
    js/auth.js        login, logout, grupo familiar
    js/utils.js       moeda, datas, escape de HTML, mensagens de erro
    js/app.js         inicialização e rotas (#/pagina)
    sql/              scripts do banco (passo 1 e passo 2)
