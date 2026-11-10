# Agenda B — Engenharias Insper

Página única e responsiva para concentrar as atividades da Turma B. O projeto usa HTML, CSS e JavaScript puros, pode ser publicado no GitHub Pages e sincroniza os dados da turma com Firebase Authentication e Cloud Firestore.

## O que já funciona

- inserção de data, título e disciplina;
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
- modo local automático enquanto o Firebase não estiver configurado;
- layout adaptado para computador, tablet e celular;
- instrução `noindex` no próprio HTML para evitar indexação por buscadores compatíveis.

## 1. Testar no computador

Abra um terminal dentro da pasta do projeto e execute:

```bash
python3 -m http.server 8000
```

Depois acesse `http://localhost:8000`. Enquanto o Firebase não estiver configurado, o aviso **Prévia local** ficará visível e os dados serão salvos apenas nesse navegador.

> Não abra o `index.html` diretamente pelo explorador de arquivos. Como o JavaScript usa módulos, um servidor local evita bloqueios do navegador.

## 2. Criar o banco compartilhado no Firebase

1. Entre no [console do Firebase](https://console.firebase.google.com/) e crie um projeto.
2. Na página inicial do projeto, registre um aplicativo **Web**.
3. Copie o objeto `firebaseConfig` mostrado pelo Firebase e substitua os valores de exemplo em `firebase-config.js`.
4. Acesse **Build → Authentication → Sign-in method** e ative o provedor **Anonymous**.
5. Acesse **Build → Firestore Database**, crie o banco em **Production mode** e escolha a região com cuidado — ela não poderá ser alterada depois.

O login anônimo acontece automaticamente e não cria nenhuma tela ou senha para os alunos.

### Publicar as regras de segurança

Com Node.js instalado, execute na pasta do projeto:

```bash
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only firestore:rules
```

Escolha o projeto criado no passo anterior. As regras incluídas neste repositório:

- exigem autenticação anônima para ler ou alterar dados;
- validam os campos e as disciplinas permitidas;
- impedem edição de título, data e disciplina depois da inserção;
- permitem exclusão somente de atividades que já estejam no histórico.

## 3. Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie todos os arquivos desta pasta.
2. No repositório, abra **Settings → Pages**.
3. Em **Build and deployment**, escolha **Deploy from a branch**.
4. Selecione a branch `main`, a pasta `/ (root)` e salve.
5. Aguarde o endereço HTTPS aparecer na mesma página.

Se o Firebase solicitar domínios autorizados, adicione o domínio gerado pelo GitHub Pages em **Authentication → Settings → Authorized domains**.

## Sobre privacidade do link

O projeto inclui `noindex`, `nofollow`, `noarchive` e `nosnippet` no próprio HTML. O Google precisa conseguir acessar a página para ler essa instrução, por isso o projeto não bloqueia o rastreamento com `robots.txt`. Isso reduz bastante a descoberta pelo Google, mas **não é uma barreira de segurança**: qualquer pessoa com o link poderá abrir e alterar a agenda, como solicitado.

Para diminuir a descoberta acidental:

- use um nome de repositório difícil de adivinhar;
- compartilhe o endereço somente no grupo da turma;
- não publique o link em redes sociais ou páginas indexadas.

Se no futuro a agenda precisar ser realmente privada, será necessário adotar login institucional ou outra camada de controle de acesso.

## Disciplinas

A lista de disciplinas está fixa em três lugares. Ao mudar, altere os três:

1. `index.html`: opções do `<select id="activity-subject">`;
2. `app.js`: constante `SUBJECTS`;
3. `firestore.rules` (e `firestore.rules.proposta`): função `validSubject`.

## Ambiente de desenvolvimento

- `rodar-dev.bat` abre a agenda em `http://localhost:8000`.
- `firebase-config.js` usa credenciais falsas, então a agenda roda em modo local e não acessa o banco real.
- O modo local carrega `dev-data/seed.json` (snapshot real, fora do git). Rode `resetDevData()` no console para voltar a ele.
- `auth.js` é a camada de login. Hoje é um mock com os usuários `lider@al.insper.edu.br` e `aluno@al.insper.edu.br` (membros da turma) e `fora@al.insper.edu.br` (fora da lista, para testar a tela de acesso restrito); o login real substitui só o corpo das funções desse arquivo.
- Acesso: só quem tem e-mail Insper verificado **e** está em `/members/{email}` (minúsculas) usa a agenda; líderes também precisam estar em `/members`.
- `firestore.rules.proposta` contém as regras novas para revisão, ainda sem deploy. Elas são testadas no emulador numa pasta separada do site (`Desktop	urmab-rules-test`, `npm test`), sem dependências neste projeto.
- `appOptions.classSize` (em `firebase-config.js`) é o N de "X de N concluíram". Em dev vale 2 (os dois usuários de teste); em produção deve ser o número de alunos da turma.
- Dados da Fase 2: cada atividade tem `doneCount` e `deletedAt`; o progresso de cada pessoa fica em `/progress/{uid}` (`done: { idDaAtividade: true }`), que só o próprio usuário lê. No modo local, o progresso fica em `agenda-turma-b:DEV:progress:v1`.
- Dados da Fase 3: coleção `notices` com `title`, `body`, `source` (`lideres` ou `professor`), `sourceDetail`, `date`, `pinned` e `deletedAt`. No modo local: `agenda-turma-b:DEV:notices:v1`.
- Dados da Fase 4: coleção `events` com `type` (`lab`, `workshop`, `vaga`, `outro`), `title`, `description`, `date`, `link` (só http/https) e `deletedAt`. Eventos com data passada saem da lista sem serem apagados. No modo local: `agenda-turma-b:DEV:events:v1`.

## Estrutura

```text
agenda-turma-b/
├── assets/
│   ├── favicon.svg
│   └── insper-logo.svg
├── .gitignore
├── .nojekyll
├── app.js
├── firebase-config.js
├── firebase.json
├── firestore.rules
├── index.html
├── LICENSE
├── README.md
└── styles.css
```

## Identidade e autoria

Projeto criado por **Eduardo Marques**, estudante de Engenharia de Computação. Esta é uma iniciativa estudantil independente e não representa um canal oficial do Insper.

O código está disponibilizado sob a licença MIT. A marca Insper pertence aos seus respectivos titulares e é usada apenas para identificação visual da comunidade acadêmica atendida pelo projeto.
