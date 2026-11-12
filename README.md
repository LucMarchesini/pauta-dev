# Pauta — Engenharias Insper

A Pauta (antiga Agenda B) é a agenda coletiva das turmas de Engenharia do Insper: entregas, calendário, avisos, eventos, oportunidades e arquivos, para várias turmas e semestres. HTML, CSS e JavaScript puros (módulos, sem build), publicável no GitHub Pages, com Firebase Authentication e Cloud Firestore.

## O que já funciona

**Turmas e papéis**
- várias turmas, uma por semestre; quem está em mais de uma troca pelo seletor no topo (a escolha fica salva no navegador);
- papéis por turma: **líder** (escreve o conteúdo e edita as matérias) e **aluno** (lê e marca o próprio "eu já fiz");
- **admins** (painel Admin): criam turmas, copiam membros do semestre anterior, definem membros e líderes por e-mail, arquivam e reativam turmas;
- turma **arquivada** (semestre encerrado): todos consultam, ninguém altera;
- login restrito a e-mails do Insper (hoje com usuários de teste, só em DEV — ver "Ambiente de desenvolvimento").

**Abas**
- **Atividades**: pendentes agrupadas por semana, com contagem regressiva colorida e "faltam Xh" no dia da entrega com horário; "eu já fiz" individual com "X de N concluíram"; filtro por matéria; carga semanal (5+ entregas ou 3+ no mesmo dia viram alerta); histórico e lixeira recolhíveis.
- **Calendário**: grade do mês com entregas, eventos e prazos de oportunidades; detalhe do dia; navegação por teclado; exportar tudo em `.ics`.
- **Avisos**: dos líderes ou repassados de professores, com opção de fixar no topo.
- **Eventos**: laboratórios, workshops e palestras, com horário e link opcionais; saem da lista depois da data.
- **Oportunidades**: estágios, pesquisa/IC, bolsas e competições, com prazo de inscrição e link; saem da lista depois do prazo.
- **Arquivos**: links para OneDrive, Teams ou Drive, por matéria e tipo (slides, lista, gabarito…). Só links, sem upload: o Firebase Storage exigiria o plano pago.

**Em todo lugar**
- **Adicionar ao calendário** em cada entrega, evento e oportunidade: Google Agenda e Outlook (abrem o evento já preenchido) ou `.ics` (iPhone e outros). Sem servidor; se o prazo mudar, é preciso adicionar de novo (o `.ics` atualiza no lugar ao importar de novo, pelo UID).
- **Novidades**: bolinha com o número de itens novos ou alterados em cada aba desde a última visita (por navegador e por turma), etiqueta "Novo" nos itens ao abrir a aba e contador no título da aba do navegador ("(3) Pauta…"). Marcar "eu já fiz" não conta como novidade.
- **Resumo da semana**: texto pronto para o WhatsApp (no celular, abre o compartilhar).
- formulários em janelas (no celular, folha presa embaixo), com erros junto ao campo;
- exclusão suave com lixeira de 7 dias, só para líderes;
- sincronização em tempo real e cache local do Firestore (abre rápido e funciona sem sinal);
- navegação fixa: faixa de abas no computador, barra inferior no celular;
- `noindex` no HTML.

## 1. Testar no computador

Rode `rodar-dev.bat` ou, dentro da pasta do projeto, `python -m http.server 8000` e acesse `http://localhost:8000`.

Com as credenciais falsas de `firebase-config.js` a agenda entra em modo de desenvolvimento: título com `[DEV]`, aviso **Ambiente de desenvolvimento** e um banco local de exemplo, salvo só nesse navegador.

> Não abra o `index.html` direto pelo explorador de arquivos: os módulos JavaScript precisam de um servidor local.

## 2. Banco no Firebase

1. No [console do Firebase](https://console.firebase.google.com/), crie um projeto e registre um app **Web**; cole o `firebaseConfig` em `firebase-config.js`.
2. **Authentication → Sign-in method**: ative o provedor **Microsoft** (contas Outlook do Insper). O login real ainda precisa ser escrito em `js/auth.js` (ver abaixo).
3. **Firestore Database**: crie o banco em **Production mode** (a região não muda depois).

### Regras de segurança

- `firestore.rules` — as regras **publicadas hoje** (modelo antigo: uma turma, `/activities` na raiz).
- `firestore.rules.proposta` — as regras **novas, sem deploy**, para o modelo com turmas:

```text
/admins/{email}                        quem administra (só pelo console)
/usuarios/{email}                      { turmas: [id, ...] }  — escrito pelos admins
/turmas/{id}                           { nome, semestre, materias, tamanho, arquivada }
/turmas/{id}/membros/{email}           { papel: "aluno" | "lider" }
/turmas/{id}/activities|notices|events|opportunities|files/{id}
/turmas/{id}/progress/{uid}            { done: { idDaAtividade: true } } — só o dono
```

E-mails sempre em minúsculas como id. Ninguém se coloca numa turma nem vira líder ou admin pelo app; turmas de outras pessoas não são legíveis; turma arquivada não aceita escrita. São 103 testes no emulador (`..\ferramentas\teste-regras`, `npm test`).

> **Atenção (Microsoft):** com o provedor `microsoft.com`, o token pode vir com `email_verified == false`, e as regras exigem `true`. Confira no primeiro login real; se for o caso, troque a checagem em `isInsper()` por `request.auth.token.firebase.sign_in_provider == 'microsoft.com'` (com o app restrito ao tenant do Insper).

### Passagem para o modelo novo

1. Escreva o login real em `js/auth.js` (mesma interface: `{ id, name, email }`).
2. Rode `..\ferramentas\admin\preparar-producao.mjs`: cria a turma atual, membros, líderes e admins, e copia as atividades antigas para dentro da turma. Ele já foi ensaiado no emulador e pode ser rodado de novo sem estragar o progresso.
3. Copie `firestore.rules.proposta` para `firestore.rules` e publique:

```bash
npx firebase-tools deploy --only firestore:rules
```

4. A partir daí, turmas, membros e líderes são geridos pelo painel **Admin**.

## 3. Publicar no GitHub Pages

**Settings → Pages → Deploy from a branch**, branch `main`, pasta `/ (root)`. Se o Firebase pedir, adicione o domínio do Pages em **Authentication → Settings → Authorized domains**.

O `noindex` reduz a descoberta pelo Google, mas **não é segurança**: quem protege os dados são o login e as regras.

## Ambiente de desenvolvimento

- `DEV_MODE` (em `js/auth.js`) só vale com as credenciais `COLE_...` **e** acesso por `localhost`/`127.0.0.1`. Fora dele, nada de DEV aparece nem funciona.
- Usuários de teste: `lider@` e `aluno@al.insper.edu.br` (Turma B 2026.2 e 2026.1, arquivada), `admin@insper.edu.br` (admin, sem turma) e `fora@al.insper.edu.br` (sem turma).
- O banco local (`agenda-turma-b:DEV:db:v2`) nasce de `dev-data/seed.json` (fora do git). `resetDevData()` no console volta ao início.
- Testes: `..\ferramentas\teste-navegador` (`python run_all.py`) e `..\ferramentas\teste-regras` (`npm test`).

## Estrutura

```text
turmab-dev/
├── index.html                 todas as abas, janelas de formulário e diálogos
├── styles.css                 base → componentes → tablet → celular → movimento reduzido
├── firebase-config.js
├── js/
│   ├── app.js                 início, papéis, abas, listas, formulários, resumo, calendário
│   ├── admin.js               painel Admin (turmas, membros, arquivar)
│   ├── auth.js                login (mock só em DEV) e DEV_MODE
│   ├── data.js                serviços de dados: Firebase e banco local (DEV)
│   ├── calendar.js            Google Agenda, Outlook, .ics e grade do mês
│   ├── dates.js               datas (AAAA-MM-DD, semanas, formatos)
│   ├── dom.js                 construtores de DOM, ícones, toast, links seguros
│   └── forms.js               erros junto ao campo
├── firestore.rules            regras publicadas hoje
├── firestore.rules.proposta   regras novas (turmas)
├── firebase.json
├── assets/                    favicon e logo
├── dev-data/seed.json         (fora do git)
└── rodar-dev.bat
```

## Identidade e autoria

Projeto criado por **Eduardo Marques**, estudante de Engenharia de Computação, e **Lucas Marchesini**. Iniciativa estudantil independente, não é canal oficial do Insper.

Código sob licença MIT. A marca Insper pertence aos seus titulares e é usada só para identificar a comunidade atendida.
