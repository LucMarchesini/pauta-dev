import { firebaseConfig } from "../firebase-config.js";
import { DEV_MODE } from "./auth.js";

// Serviços de dados da Pauta. Os dois (Firebase e local) têm a mesma interface:
//
//   service.profile()                  → { admin, turmas: [{ id, nome, semestre, arquivada, papel }] }
//   service.openTurma(id, papel)       → serviço da turma (abaixo)
//   service.listTurmas()               → [turma]                         (admin)
//   service.saveTurma(id|null, dados)  → id                              (admin)
//   service.listMembros(id)            → { email: papel }                (admin)
//   service.saveMembros(id, membros)   grava a lista inteira e o tamanho (admin)
//
//   turma.subscribeTurma(onTurma), turma.subscribe(coleção, onItems, onError),
//   turma.subscribeDone(onDone, onError), add, update, trash, restore (por coleção e id),
//   turma.setDone(idDaAtividade, feito) e turma.setMaterias(lista)  (líder)
//
// Modelo em firestore.rules.proposta. E-mails sempre em minúsculas.

export const ACTIVITIES = "activities";
export const NOTICES = "notices";
export const EVENTS = "events";
export const OPPORTUNITIES = "opportunities";
export const FILES = "files";
export const CONTENT = [ACTIVITIES, NOTICES, EVENTS, OPPORTUNITIES, FILES];

const FIREBASE_VERSION = "12.18.0";
const LOCAL_DB_KEY = "agenda-turma-b:DEV:db:v2";
const SEED_URL = "dev-data/seed.json";

// "Turma B" + "2026.2" → "turma-b-2026-2"
export function turmaId(nome, semestre) {
  const slug = `${nome} ${semestre}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.slice(0, 60);
}

export function createService(user) {
  return DEV_MODE ? createLocalService(user) : createFirebaseService(user);
}

// ---------- Firebase (produção) ----------

async function createFirebaseService(user) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp, getApps }, fs] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  // O login real (auth.js) também usa o app do Firebase: reaproveita se já existir.
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  // Cache local: a agenda abre na hora e funciona sem sinal.
  const db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
  const now = fs.serverTimestamp;
  const email = user.email.toLowerCase();

  return {
    async profile() {
      const [admin, usuario] = await Promise.all([
        fs.getDoc(fs.doc(db, "admins", email)),
        fs.getDoc(fs.doc(db, "usuarios", email)),
      ]);
      const ids = usuario.data()?.turmas ?? [];
      const turmas = await Promise.all(
        ids.map(async (id) => {
          try {
            const [turma, membro] = await Promise.all([
              fs.getDoc(fs.doc(db, "turmas", id)),
              fs.getDoc(fs.doc(db, "turmas", id, "membros", email)),
            ]);
            return turma.exists() && membro.exists() ? { id, ...turma.data(), papel: membro.data().papel } : null;
          } catch {
            return null; // removido da turma depois de a lista ser gravada
          }
        }),
      );
      return { admin: admin.exists(), turmas: turmas.filter(Boolean) };
    },

    openTurma(id, papel) {
      const turmaRef = fs.doc(db, "turmas", id);
      const ref = (name, docId) => fs.doc(db, "turmas", id, name, docId);
      const progress = fs.doc(db, "turmas", id, "progress", user.id);
      const update = (name, docId, fields) => fs.updateDoc(ref(name, docId), { ...fields, updatedAt: now() });

      return {
        subscribeTurma(onTurma, onError) {
          fs.onSnapshot(turmaRef, (snapshot) => onTurma({ id, ...snapshot.data() }), onError);
        },
        // As regras só deixam alunos lerem o que não está na lixeira, então a consulta
        // deles precisa pedir exatamente isso (regras não filtram, recusam).
        subscribe(name, onItems, onError) {
          const source = fs.collection(db, "turmas", id, name);
          fs.onSnapshot(
            papel === "lider" ? source : fs.query(source, fs.where("deletedAt", "==", null)),
            (snapshot) =>
              onItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data({ serverTimestamps: "estimate" }) }))),
            onError,
          );
        },
        subscribeDone(onDone, onError) {
          fs.onSnapshot(progress, (snapshot) => onDone(Object.keys(snapshot.data()?.done ?? {})), onError);
        },
        add(name, data) {
          return fs.addDoc(fs.collection(db, "turmas", id, name), {
            ...data,
            deletedAt: null,
            createdAt: now(),
            updatedAt: now(),
          });
        },
        update,
        trash: (name, docId) => update(name, docId, { deletedAt: now() }),
        restore: (name, docId) => update(name, docId, { deletedAt: null }),
        setDone(activityId, done) {
          const batch = fs.writeBatch(db);
          batch.set(progress, { done: { [activityId]: done ? true : fs.deleteField() } }, { merge: true });
          batch.update(ref(ACTIVITIES, activityId), { doneCount: fs.increment(done ? 1 : -1) });
          return batch.commit();
        },
        setMaterias: (materias) => fs.updateDoc(turmaRef, { materias, updatedAt: now() }),
      };
    },

    async listTurmas() {
      const snapshot = await fs.getDocs(fs.collection(db, "turmas"));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },

    async saveTurma(id, data) {
      if (id) {
        await fs.updateDoc(fs.doc(db, "turmas", id), { ...data, updatedAt: now() });
        return id;
      }
      const newId = turmaId(data.nome, data.semestre);
      if ((await fs.getDoc(fs.doc(db, "turmas", newId))).exists()) throw new DuplicateTurma();
      await fs.setDoc(fs.doc(db, "turmas", newId), { ...data, tamanho: 0, createdAt: now(), updatedAt: now() });
      return newId;
    },

    async listMembros(id) {
      const snapshot = await fs.getDocs(fs.collection(db, "turmas", id, "membros"));
      return Object.fromEntries(snapshot.docs.map((item) => [item.id, item.data().papel]));
    },

    // Grava membros e /usuarios em lotes (limite do Firestore: 500 escritas por batch).
    async saveMembros(id, membros) {
      const before = await this.listMembros(id);
      const writes = [];
      for (const [address, papel] of Object.entries(membros)) {
        if (before[address] === papel) continue;
        writes.push((batch) => batch.set(fs.doc(db, "turmas", id, "membros", address), { papel }));
        if (!before[address]) {
          writes.push((batch) =>
            batch.set(fs.doc(db, "usuarios", address), { turmas: fs.arrayUnion(id) }, { merge: true }),
          );
        }
      }
      for (const address of Object.keys(before)) {
        if (membros[address]) continue;
        writes.push((batch) => batch.delete(fs.doc(db, "turmas", id, "membros", address)));
        writes.push((batch) =>
          batch.set(fs.doc(db, "usuarios", address), { turmas: fs.arrayRemove(id) }, { merge: true }),
        );
      }
      writes.push((batch) =>
        batch.update(fs.doc(db, "turmas", id), { tamanho: Object.keys(membros).length, updatedAt: now() }),
      );
      for (let start = 0; start < writes.length; start += 400) {
        const batch = fs.writeBatch(db);
        writes.slice(start, start + 400).forEach((write) => write(batch));
        await batch.commit();
      }
    },
  };
}

// ---------- Local (só DEV): o "banco" inteiro num item do localStorage ----------

async function createLocalService(user) {
  const db = (await readLocalDb()) ?? (await seedLocalDb());
  const email = user.email.toLowerCase();
  const listeners = new Map(); // "turma/coleção" → callback
  const save = () => localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
  const stamp = () => new Date().toISOString();
  const clone = (value) => structuredClone(value);
  const publicTurma = (id) => {
    const { membros, progress, ...turma } = db.turmas[id];
    CONTENT.forEach((name) => delete turma[name]);
    return { id, ...clone(turma) };
  };

  return {
    async profile() {
      const ids = db.usuarios[email]?.turmas ?? [];
      const turmas = ids
        .filter((id) => db.turmas[id]?.membros[email])
        .map((id) => ({ ...publicTurma(id), papel: db.turmas[id].membros[email] }));
      return { admin: db.admins.includes(email), turmas };
    },

    openTurma(id) {
      const turma = db.turmas[id];
      const notify = (name) => {
        if (name === "turma") return listeners.get(`${id}/turma`)?.(publicTurma(id));
        const done = Object.values(turma.progress).flat();
        listeners.get(`${id}/${name}`)?.(
          clone(turma[name]).map((item) =>
            name === ACTIVITIES ? { ...item, doneCount: done.filter((doneId) => doneId === item.id).length } : item,
          ),
        );
      };
      const update = async (name, docId, fields) => {
        turma[name] = turma[name].map((item) => (item.id === docId ? { ...item, ...fields, updatedAt: stamp() } : item));
        save();
        notify(name);
      };

      return {
        subscribeTurma(onTurma) {
          listeners.set(`${id}/turma`, onTurma);
          notify("turma");
        },
        subscribe(name, onItems) {
          listeners.set(`${id}/${name}`, onItems);
          notify(name);
        },
        subscribeDone(onDone) {
          listeners.set(`${id}/done`, onDone);
          onDone(turma.progress[user.id] ?? []);
        },
        async add(name, data) {
          turma[name].push({ id: crypto.randomUUID(), ...data, deletedAt: null, createdAt: stamp(), updatedAt: stamp() });
          save();
          notify(name);
        },
        update,
        trash: (name, docId) => update(name, docId, { deletedAt: stamp() }),
        restore: (name, docId) => update(name, docId, { deletedAt: null }),
        async setDone(activityId, done) {
          const mine = (turma.progress[user.id] ?? []).filter((item) => item !== activityId);
          turma.progress[user.id] = done ? [...mine, activityId] : mine;
          save();
          notify(ACTIVITIES);
          listeners.get(`${id}/done`)?.(turma.progress[user.id]);
        },
        async setMaterias(materias) {
          turma.materias = [...materias];
          turma.updatedAt = stamp();
          save();
          notify("turma");
        },
      };
    },

    async listTurmas() {
      return Object.keys(db.turmas).map(publicTurma);
    },

    async saveTurma(id, data) {
      if (id) {
        Object.assign(db.turmas[id], data, { updatedAt: stamp() });
      } else {
        id = turmaId(data.nome, data.semestre);
        if (db.turmas[id]) throw new DuplicateTurma();
        db.turmas[id] = emptyTurma({ ...data, tamanho: 0 });
      }
      save();
      return id;
    },

    async listMembros(id) {
      return clone(db.turmas[id].membros);
    },

    async saveMembros(id, membros) {
      const before = db.turmas[id].membros;
      for (const address of Object.keys(before)) {
        if (!membros[address]) {
          const turmas = db.usuarios[address]?.turmas ?? [];
          db.usuarios[address] = { turmas: turmas.filter((item) => item !== id) };
        }
      }
      for (const address of Object.keys(membros)) {
        const turmas = db.usuarios[address]?.turmas ?? [];
        if (!turmas.includes(id)) db.usuarios[address] = { turmas: [...turmas, id] };
      }
      db.turmas[id].membros = { ...membros };
      db.turmas[id].tamanho = Object.keys(membros).length;
      db.turmas[id].updatedAt = stamp();
      save();
    },
  };
}

export class DuplicateTurma extends Error {
  constructor() {
    super("Já existe uma turma com esse nome e semestre.");
  }
}

function emptyTurma(data) {
  const stamp = new Date().toISOString();
  return {
    ...data,
    createdAt: stamp,
    updatedAt: stamp,
    membros: {},
    progress: {},
    ...Object.fromEntries(CONTENT.map((name) => [name, []])),
  };
}

async function readLocalDb() {
  try {
    const db = JSON.parse(localStorage.getItem(LOCAL_DB_KEY));
    return db?.turmas ? db : null;
  } catch {
    return null;
  }
}

// Primeira execução em DEV: uma turma aberta com o snapshot de dev-data e uma turma
// arquivada do semestre anterior. Usuários de teste em auth.js.
async function seedLocalDb() {
  let activities = [];
  try {
    const response = await fetch(SEED_URL, { cache: "no-store" });
    if (response.ok) activities = await response.json();
  } catch (error) {
    console.warn("Sem snapshot de dev:", error);
  }
  const materias = ["GDE", "DesSoft", "InstruMed", "DesProd", "Tópicos", "ModSim"];
  const membros = { "lider@al.insper.edu.br": "lider", "aluno@al.insper.edu.br": "aluno" };
  const atual = emptyTurma({ nome: "Turma B", semestre: "2026.2", materias, tamanho: 2, arquivada: false });
  atual.membros = { ...membros };
  atual.activities = activities;
  const anterior = emptyTurma({ nome: "Turma B", semestre: "2026.1", materias, tamanho: 2, arquivada: true });
  anterior.membros = { ...membros };
  anterior.activities = [
    { id: "antiga-1", title: "Projeto final", subject: "DesSoft", dueDate: "2026-06-20", deletedAt: null },
    { id: "antiga-2", title: "Prova 2", subject: "GDE", dueDate: "2026-06-12", deletedAt: null },
  ];

  const db = {
    admins: ["admin@insper.edu.br"],
    usuarios: {
      "lider@al.insper.edu.br": { turmas: ["turma-b-2026-2", "turma-b-2026-1"] },
      "aluno@al.insper.edu.br": { turmas: ["turma-b-2026-2", "turma-b-2026-1"] },
    },
    turmas: { "turma-b-2026-2": atual, "turma-b-2026-1": anterior },
  };
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
  return db;
}

// Para voltar ao estado inicial de DEV, rode no console: resetDevData()
if (DEV_MODE) {
  window.resetDevData = () => {
    Object.keys(localStorage)
      .filter((key) => key.startsWith("agenda-turma-b:DEV:") && !key.endsWith(":session"))
      .forEach((key) => localStorage.removeItem(key));
    location.reload();
  };
}
