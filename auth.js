import { firebaseConfig } from "./firebase-config.js";

// Camada de autenticação da Agenda B.
// Hoje é um MOCK que só funciona em DEV: credenciais falsas E acesso por localhost.
// Fora disso ninguém entra (nem como líder) até o login real existir.
// Para o login real, troque só o corpo destas três funções (ex.: Firebase Auth
// com conta Google do Insper) mantendo a mesma interface.
// O papel daqui serve apenas para a interface; quem garante a permissão é o
// backend (ver firestore.rules.proposta).

export const DEV_MODE =
  firebaseConfig.apiKey.startsWith("COLE_") &&
  ["localhost", "127.0.0.1"].includes(location.hostname);

const SESSION_KEY = "agenda-turma-b:DEV:session";
const ALLOWED_DOMAINS = ["al.insper.edu.br", "insper.edu.br"];

const TEST_USERS = !DEV_MODE ? [] : [
  { id: "dev-lider", name: "Líder de teste", email: "lider@al.insper.edu.br", role: "lider" },
  { id: "dev-aluno", name: "Aluno de teste", email: "aluno@al.insper.edu.br", role: "aluno" },
];

export async function getCurrentUser() {
  const id = localStorage.getItem(SESSION_KEY);
  return TEST_USERS.find((user) => user.id === id) ?? null;
}

export async function login(email) {
  const address = email.trim().toLowerCase();
  if (!ALLOWED_DOMAINS.includes(address.split("@")[1])) {
    throw new Error("Use seu e-mail do Insper.");
  }

  if (!DEV_MODE) throw new Error("O login com a conta do Insper ainda não está disponível.");

  const user = TEST_USERS.find((item) => item.email === address);
  if (!user) throw new Error("No ambiente de teste, entre como líder ou aluno de teste.");

  localStorage.setItem(SESSION_KEY, user.id);
  return user;
}

export async function logout() {
  localStorage.removeItem(SESSION_KEY);
}
