// AMBIENTE DE DESENVOLVIMENTO — Firebase desligado de propósito.
// Com os valores "COLE_..." o app entra em modo local (localStorage) e
// carrega o snapshot estático de dev-data/seed.json. Nada aqui toca o site no ar.
// A config de produção continua só na pasta original (Desktop\turmab).
export const firebaseConfig = Object.freeze({
  apiKey: "COLE_DESLIGADO_EM_DEV",
  authDomain: "COLE_DESLIGADO_EM_DEV",
  projectId: "COLE_DESLIGADO_EM_DEV",
  storageBucket: "",
  messagingSenderId: "",
  appId: "COLE_DESLIGADO_EM_DEV",
});

export const appOptions = Object.freeze({
  collectionName: "activities",
  // Usado só no modo local: dados iniciais quando o localStorage está vazio.
  seedUrl: "dev-data/seed.json",
});
