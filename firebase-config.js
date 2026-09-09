// Cole aqui exatamente o objeto de configuração exibido pelo Firebase
// ao registrar um aplicativo Web. Esses identificadores podem ficar no
// repositório; a proteção dos dados é feita pelo arquivo firestore.rules.
export const firebaseConfig = Object.freeze({
  apiKey: "AIzaSyAirtKH9smOdgtOkNk2MUPCUCmMB25-po0",
  authDomain: "agenda-turma-b-insper.firebaseapp.com",
  projectId: "agenda-turma-b-insper",
  storageBucket: "agenda-turma-b-insper.firebasestorage.app",
  messagingSenderId: "844567649518",
  appId: "1:844567649518:web:2bd94cbc2ff0d5a0b827ff",
});

export const appOptions = Object.freeze({
  collectionName: "activities",
});

// ---------Aqui abaixo foi colado o que apareceu para mim no Firebase-------------

// // Import the functions you need from the SDKs you need
// import { initializeApp } from "firebase/app";
// // TODO: Add SDKs for Firebase products that you want to use
// // https://firebase.google.com/docs/web/setup#available-libraries

// // Your web app's Firebase configuration
// const firebaseConfig = {
//   apiKey: "AIzaSyAirtKH9smOdgtOkNk2MUPCUCmMB25-po0",
//   authDomain: "agenda-turma-b-insper.firebaseapp.com",
//   projectId: "agenda-turma-b-insper",
//   storageBucket: "agenda-turma-b-insper.firebasestorage.app",
//   messagingSenderId: "844567649518",
//   appId: "1:844567649518:web:2bd94cbc2ff0d5a0b827ff"
// };

// // Initialize Firebase
// const app = initializeApp(firebaseConfig);