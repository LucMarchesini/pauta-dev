import { appOptions, firebaseConfig } from "./firebase-config.js";
import { DEV_MODE } from "./auth.js";

// Serviços de dados da Agenda B. Os dois têm a mesma interface:
//   subscribe(coleção, onItems, onError), subscribeDone(onDone, onError),
//   add, update, trash, restore (por coleção e id) e setDone(idDaAtividade, feito).
// - createFirebaseService: Firestore (produção).
// - createLocalService: localStorage, só no ambiente de dev (ver app.js).

export const ACTIVITIES = appOptions.collectionName;
export const NOTICES = "notices";
export const EVENTS = "events";

const FIREBASE_VERSION = "12.18.0";
const LOCAL_PREFIX = "agenda-turma-b:DEV:";
const LOCAL_PROGRESS_KEY = `${LOCAL_PREFIX}progress:v1`;

// Progresso individual: /progress/{uid} guarda { done: { [activityId]: true } }, legível só
// pelo próprio usuário. A atividade guarda apenas doneCount, então ninguém vê quem não fez.
export async function createFirebaseService(user) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, authModule, firestore] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);

  const app = initializeApp(firebaseConfig);
  const auth = authModule.getAuth(app);
  await authModule.signInAnonymously(auth);

  const db = firestore.getFirestore(app);
  const now = firestore.serverTimestamp;
  const reference = (name, id) => firestore.doc(db, name, id);
  const progress = firestore.doc(db, "progress", user.id);
  const update = (name, id, fields) =>
    firestore.updateDoc(reference(name, id), { ...fields, updatedAt: now() });

  return {
    // As regras só deixam alunos lerem o que não está na lixeira, então a consulta
    // deles precisa pedir exatamente isso (regras não filtram, recusam).
    subscribe(name, onItems, onError) {
      const source = firestore.collection(db, name);
      firestore.onSnapshot(
        user.role === "lider" ? source : firestore.query(source, firestore.where("deletedAt", "==", null)),
        (snapshot) =>
          onItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data({ serverTimestamps: "estimate" }) }))),
        onError,
      );
    },

    subscribeDone(onDone, onError) {
      firestore.onSnapshot(progress, (snapshot) => onDone(Object.keys(snapshot.data()?.done ?? {})), onError);
    },

    add(name, data) {
      return firestore.addDoc(firestore.collection(db, name), {
        ...data,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      });
    },

    update,
    trash: (name, id) => update(name, id, { deletedAt: now() }),
    restore: (name, id) => update(name, id, { deletedAt: null }),

    setDone(id, done) {
      const batch = firestore.writeBatch(db);
      batch.set(progress, { done: { [id]: done ? true : firestore.deleteField() } }, { merge: true });
      batch.update(reference(ACTIVITIES, id), { doneCount: firestore.increment(done ? 1 : -1) });
      return batch.commit();
    },
  };
}

// Só em DEV: dados no localStorage; na primeira vez, carrega o snapshot de dev-data.
export async function createLocalService(userId) {
  await seedLocalItems();
  const cache = {};
  const listeners = {};
  const progress = readLocal(LOCAL_PROGRESS_KEY, {}); // { [userId]: [activityId, ...] }
  let onDone = null;

  const items = (name) => (cache[name] ??= readLocal(localKey(name), []));

  const notify = (name) => {
    const doneIds = Object.values(progress).flat();
    listeners[name]?.(
      items(name).map((item) =>
        name === ACTIVITIES
          ? { ...item, doneCount: doneIds.filter((id) => id === item.id).length }
          : { ...item },
      ),
    );
  };

  const save = (name) => {
    localStorage.setItem(localKey(name), JSON.stringify(items(name)));
    notify(name);
  };

  const update = async (name, id, fields) => {
    cache[name] = items(name).map((item) =>
      item.id === id ? { ...item, ...fields, updatedAt: new Date().toISOString() } : item,
    );
    save(name);
  };

  return {
    subscribe(name, onItems) {
      listeners[name] = onItems;
      notify(name);
    },

    subscribeDone(callback) {
      onDone = callback;
      onDone(progress[userId] ?? []);
    },

    async add(name, data) {
      const now = new Date().toISOString();
      items(name).push({ id: crypto.randomUUID(), ...data, deletedAt: null, createdAt: now, updatedAt: now });
      save(name);
    },

    update,
    trash: (name, id) => update(name, id, { deletedAt: new Date().toISOString() }),
    restore: (name, id) => update(name, id, { deletedAt: null }),

    async setDone(id, done) {
      const mine = (progress[userId] ?? []).filter((item) => item !== id);
      progress[userId] = done ? [...mine, id] : mine;
      localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(progress));
      notify(ACTIVITIES);
      onDone?.(progress[userId]);
    },
  };
}

function localKey(name) {
  return `${LOCAL_PREFIX}${name}:v1`;
}

// Dev: popula o localStorage com o snapshot estático na primeira execução.
// Para voltar ao snapshot original, rode no console: resetDevData()
async function seedLocalItems() {
  if (localStorage.getItem(localKey(ACTIVITIES)) !== null || !appOptions.seedUrl) return;
  try {
    const response = await fetch(appOptions.seedUrl, { cache: "no-store" });
    if (response.ok) localStorage.setItem(localKey(ACTIVITIES), JSON.stringify(await response.json()));
  } catch (error) {
    console.warn("Sem snapshot de dev:", error);
  }
}

if (DEV_MODE) {
  window.resetDevData = () => {
    [ACTIVITIES, NOTICES, EVENTS].forEach((name) => localStorage.removeItem(localKey(name)));
    localStorage.removeItem(LOCAL_PROGRESS_KEY);
    location.reload();
  };
}

function readLocal(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved?.constructor === fallback.constructor ? saved : fallback;
  } catch {
    return fallback;
  }
}
