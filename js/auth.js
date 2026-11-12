import { firebaseConfig } from "../firebase-config.js";

// Camada de autenticação da Pauta: só diz QUEM é a pessoa. Turmas, papel (líder ou
// aluno) e admin vêm dos dados (ver data.js e firestore.rules.proposta).
//
// Hoje é um MOCK que só funciona em DEV: credenciais falsas E acesso por localhost.
// Fora disso ninguém entra até o login real existir. Para o login real, troque só o
// corpo destas três funções (Firebase Auth com a conta Microsoft/Outlook do Insper:
// OAuthProvider("microsoft.com") restrito ao tenant do Insper) mantendo a interface:
//   usuário = { id: uid do Firebase Auth, name, email }

export const DEV_MODE =
  firebaseConfig.apiKey.startsWith("COLE_") && ["localhost", "127.0.0.1"].includes(location.hostname);

const SESSION_KEY = "agenda-turma-b:DEV:session";
const ALLOWED_DOMAINS = ["al.insper.edu.br", "insper.edu.br"];

// Líder e aluno estão na Turma B (2026.2 e 2026.1, arquivada); "fora" tem e-mail do
// Insper mas nenhuma turma; "admin" administra o site e não está em nenhuma turma.
export const TEST_USERS = !DEV_MODE
  ? []
  : [
      { id: "dev-lider", name: "Líder de teste", email: "lider@al.insper.edu.br" },
      { id: "dev-aluno", name: "Aluno de teste", email: "aluno@al.insper.edu.br" },
      { id: "dev-fora", name: "Fora da turma", email: "fora@al.insper.edu.br" },
      { id: "dev-admin", name: "Admin de teste", email: "admin@insper.edu.br" },
    ];

export async function getCurrentUser() {
  const id = localStorage.getItem(SESSION_KEY);
  return TEST_USERS.find((user) => user.id === id) ?? null;
}

export async function login(email) {
  const address = email.trim().toLowerCase();
  if (!ALLOWED_DOMAINS.includes(address.split("@")[1])) throw new Error("Use seu e-mail do Insper.");
  if (!DEV_MODE) throw new Error("O login com a conta do Insper ainda não está disponível.");

  const user = TEST_USERS.find((item) => item.email === address);
  if (!user) throw new Error("No ambiente de teste, entre com um dos usuários de teste.");
  localStorage.setItem(SESSION_KEY, user.id);
  return user;
}

export async function logout() {
  localStorage.removeItem(SESSION_KEY);
}
