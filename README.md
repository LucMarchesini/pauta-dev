# Agenda B — Engenharias Insper

Página única e responsiva para concentrar as atividades, os avisos e os eventos da Turma B. O projeto usa HTML, CSS e JavaScript puros, pode ser publicado no GitHub Pages e sincroniza os dados da turma com Firebase Authentication e Cloud Firestore.

## O que já funciona

- login restrito a e-mails do Insper e à lista da turma (`/members`); papéis líder e aluno (hoje com login de teste, só no ambiente de dev — ver "Ambiente de desenvolvimento");
- inserção de data, título e disciplina (só líderes);
- disciplinas limitadas a GDE, DesSoft, InstruMed, DesProd, Tópicos e ModSim;
- atividades pendentes em ordem crescente de data, agrupadas por semana;
- histórico (data de entrega vencida) em ordem decrescente de data;
- "eu já fiz" individual por usuário, com "X de N concluíram" e o selo "Turma toda concluiu";
- contagem regressiva com cores (atrasada, até 48h, esta semana) e filtro por disciplina;
- líderes editam título, data e disciplina, e cadastram datas passadas;
- exclusão suave (deletedAt) com lixeira de 7 dias, visível só para líderes;
- abas Atividades, Avisos e Eventos;
- eventos (Laboratório, Workshop, Vaga/Oportunidade, Outro) com link opcional e filtro por tipo;
- avisos publicados pelos líderes (origem "Líderes" ou "Professor — nome/disciplina"), com opção de fixar no topo, edição e lixeira de 7 dias;
- sincronização em tempo real entre os dispositivos;
- modo local (dados só no navegador) apenas no ambiente de dev; em produção, se o Firebase falhar, a agenda mostra o erro de sincronização e não grava nada;
- layout adaptado para computador, tablet e celular;
- instrução `noindex` no próprio HTML para evitar indexação por buscadores compatíveis.

## 1. Testar no computador

Rode `rodar-dev.bat` ou, dentro da pasta do projeto:

```bash
python -m http.server 8000
```

Depois acesse `http://localhost:8000`. Com as credenciais falsas de `firebase-config.js`, a agenda entra no modo de desenvolvimento: título com `[DEV]`, aviso **Ambiente de desenvolvimento** e dados salvos só nesse navegador.

> Não abra o `index.html` diretamente pelo explorador de arquivos. Como o JavaScript usa módulos, um servidor local evita bloqueios do navegador.

## 2. Criar o banco compartilhado no Firebase

1. Entre no [console do Firebase](https://console.firebase.google.com/) e crie um projeto.
2. Na página inicial do projeto, registre um aplicativo **Web**.
3. Copie o objeto `firebaseConfig` mostrado pelo Firebase e substitua os valores de exemplo em `firebase-config.js`.
4. Acesse **Build → Authentication → Sign-in method** e ative o provedor usado pelo login. Atenção: hoje o `app.js` entra no Firebase com login **anônimo**, mas as regras propostas exigem e-mail do Insper verificado; o login real (planejado: conta Google do Insper, em `auth.js`) precisa existir antes de publicar essas regras.
5. Acesse **Build → Firestore Database**, crie o banco em **Production mode** e escolha a região com cuidado — ela não poderá ser alterada depois.

### Regras de segurança

Há dois arquivos de regras:

- `firestore.rules` — as regras **publicadas hoje** (o `firebase.json` aponta para ele): qualquer usuário autenticado (inclusive anônimo) lê e altera atividades no modelo antigo (campo `completed`), e só apaga atividades já concluídas.
- `firestore.rules.proposta` — as regras **novas, ainda sem deploy**: só quem tem e-mail Insper verificado **e** está em `/members/{email}` lê ou grava; só líderes (`/leaders/{uid}`) escrevem atividades, avisos e eventos; nada é apagado de verdade (lixeira com `deletedAt`); cada pessoa só lê e grava o próprio progresso; `/members` e `/leaders` só pelo console.

Para publicar (com Node.js instalado, na pasta do projeto):

```bash
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only firestore:rules
```

Esse comando publica o `firestore.rules`. Para adotar a proposta, substitua o conteúdo do `firestore.rules` pelo da proposta antes do deploy.

## 3. Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie todos os arquivos desta pasta.
2. No repositório, abra **Settings → Pages**.
3. Em **Build and deployment**, escolha **Deploy from a branch**.
4. Selecione a branch `main`, a pasta `/ (root)` e salve.
5. Aguarde o endereço HTTPS aparecer na mesma página.

Se o Firebase solicitar domínios autorizados, adicione o domínio gerado pelo GitHub Pages em **Authentication → Settings → Authorized domains**.

## Sobre privacidade do link

O projeto inclui `noindex`, `nofollow`, `noarchive` e `nosnippet` no próprio HTML. O Google precisa conseguir acessar a página para ler essa instrução, por isso o projeto não bloqueia o rastreamento com `robots.txt`. Isso reduz bastante a descoberta pelo Google, mas **não é uma barreira de segurança**.

Com as regras publicadas hoje (`firestore.rules`), qualquer pessoa com o link pode abrir e alterar a agenda. Com as regras propostas e o login real, só membros da turma leem e só líderes alteram.

Para diminuir a descoberta acidental:

- use um nome de repositório difícil de adivinhar;
- compartilhe o endereço somente no grupo da turma;
- não publique o link em redes sociais ou páginas indexadas.

## Disciplinas

A lista de disciplinas está fixa em quatro lugares. Ao mudar, altere todos:

1. `index.html`: opções do `<select id="activity-subject">`;
2. `app.js`: constante `SUBJECTS`;
3. `firestore.rules`: função `validSubject`;
4. `firestore.rules.proposta`: função `isValidActivity`.

## Ambiente de desenvolvimento

- `rodar-dev.bat` abre a agenda em `http://localhost:8000`.
- `DEV_MODE` (em `auth.js`) vale só com as credenciais falsas (`COLE_...`) de `firebase-config.js` **e** acesso por `localhost`/`127.0.0.1`. Tudo o que é de dev depende dele: login de teste, `[DEV]` no título, aviso de ambiente, modo local, snapshot e `resetDevData()`. Fora do DEV_MODE nada disso aparece nem funciona.
- O modo local carrega `dev-data/seed.json` (snapshot real, fora do git). Rode `resetDevData()` no console para voltar a ele.
- `auth.js` é a camada de login. Hoje é um mock com os usuários `lider@al.insper.edu.br` e `aluno@al.insper.edu.br` (membros da turma) e `fora@al.insper.edu.br` (fora da lista, para testar a tela de acesso restrito); o login real substitui só o corpo das funções desse arquivo.
- Acesso: só quem tem e-mail Insper verificado **e** está em `/members/{email}` (minúsculas) usa a agenda; líderes também precisam estar em `/members`.
- `firestore.rules.proposta` é testada no emulador numa pasta separada do site (`Desktop\turmab-rules-test`, `npm test`, 86 testes), sem dependências neste projeto. Se aparecer "port taken", encerre o processo Java preso na porta 8085.
- Os testes do navegador (Playwright) ficam em `Desktop\turmab-tests` (`python run_all.py`); o README de lá explica também a comparação de capturas de tela.
- `appOptions.classSize` (em `firebase-config.js`) é o N de "X de N concluíram". Em dev vale 2 (os dois usuários de teste); em produção deve ser o número de alunos da turma.
- Atividades: `title`, `subject`, `dueDate`, `doneCount` e `deletedAt`; o progresso de cada pessoa fica em `/progress/{uid}` (`done: { idDaAtividade: true }`), que só o próprio usuário lê. No modo local, o progresso fica em `agenda-turma-b:DEV:progress:v1`.
- Avisos: coleção `notices` com `title`, `body`, `source` (`lideres` ou `professor`), `sourceDetail`, `date`, `pinned` e `deletedAt`. No modo local: `agenda-turma-b:DEV:notices:v1`.
- Eventos: coleção `events` com `type` (`lab`, `workshop`, `vaga`, `outro`), `title`, `description`, `date`, `link` (só http/https) e `deletedAt`. Eventos com data passada saem da lista sem serem apagados. No modo local: `agenda-turma-b:DEV:events:v1`.
- Todo documento de conteúdo também tem `createdAt` e `updatedAt` (horário do servidor).

## Estrutura

```text
agenda-turma-b/
├── assets/
│   ├── favicon.svg
│   └── insper-logo.svg
├── dev-data/
│   └── seed.json              (fora do git)
├── .gitignore
├── .nojekyll
├── app.js                     interface: login, abas, formulários, listas
├── auth.js                    login (mock só em DEV) e DEV_MODE
├── firebase-config.js
├── firebase.json
├── firestore.rules            regras publicadas hoje
├── firestore.rules.proposta   regras novas (sem deploy)
├── index.html
├── LICENSE
├── README.md
├── rodar-dev.bat
└── styles.css
```

## Identidade e autoria

Projeto criado por **Eduardo Marques**, estudante de Engenharia de Computação. Esta é uma iniciativa estudantil independente e não representa um canal oficial do Insper.

O código está disponibilizado sob a licença MIT. A marca Insper pertence aos seus respectivos titulares e é usada apenas para identificação visual da comunidade acadêmica atendida pelo projeto.
