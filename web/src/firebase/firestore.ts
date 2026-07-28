import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from './config';

type CollectionName =
  | 'genres'
  | 'goals'
  | 'tasks'
  | 'selectiveGroups'
  | 'progressLogs'
  | 'notificationSettings';

function userCollection(uid: string, name: CollectionName) {
  return collection(db, 'users', uid, name);
}

export function subscribeToCollection<T extends { id: string }>(
  uid: string,
  name: CollectionName,
  callback: (items: T[]) => void,
  constraints: QueryConstraint[] = [orderBy('createdAt', 'asc')],
) {
  const q = query(userCollection(uid, name), ...constraints);
  return onSnapshot(q, (snapshot) => {
    const items = snapshot.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as T,
    );
    callback(items);
  });
}

export async function addItem<T extends DocumentData>(
  uid: string,
  name: CollectionName,
  data: T,
) {
  const ref = await addDoc(userCollection(uid, name), {
    ...data,
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function updateItem(
  uid: string,
  name: CollectionName,
  id: string,
  data: Partial<DocumentData>,
) {
  await updateDoc(doc(db, 'users', uid, name, id), data);
}

export async function deleteItem(uid: string, name: CollectionName, id: string) {
  await deleteDoc(doc(db, 'users', uid, name, id));
}

/** Cloud Functionsからの通知送信先として、ユーザードキュメントにFCMトークンを保存する */
export async function saveFcmToken(uid: string, token: string) {
  await setDoc(doc(db, 'users', uid), { fcmToken: token }, { merge: true });
}

/** 通知設定(taskList/progress)を決定的なドキュメントIDでUpsertする */
export async function upsertNotificationSetting(
  uid: string,
  type: 'taskList' | 'progress',
  data: DocumentData,
) {
  await setDoc(
    doc(db, 'users', uid, 'notificationSettings', type),
    { ...data, type },
    { merge: true },
  );
}

/** 特定日付・特定タスクの進捗ログを、決定的なドキュメントIDでUpsertする */
export async function upsertProgressLog(
  uid: string,
  taskId: string,
  date: string,
  data: DocumentData,
) {
  const id = `${date}_${taskId}`;
  await setDoc(
    doc(db, 'users', uid, 'progressLogs', id),
    { ...data, taskId, date, updatedAt: Date.now() },
    { merge: true },
  );
  return id;
}
