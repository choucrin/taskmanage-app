import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from './config';
import type { SelectiveGroup, Task } from '../types';

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
  constraints: QueryConstraint[] = [],
  onError?: (error: Error) => void,
) {
  // orderBy('createdAt', ...) をデフォルトにしない: Firestoreのquery orderByは
  // 指定フィールドを持たないドキュメントを結果から除外してしまう。
  // upsertNotificationSetting/upsertProgressLog はcreatedAtを書き込まないため、
  // 以前このデフォルトを使っていた際はnotificationSettings/progressLogsの
  // 書き込みが購読結果に一切反映されない不具合があった。
  const q = query(userCollection(uid, name), ...constraints);
  return onSnapshot(
    q,
    (snapshot) => {
      // サーバ側のorderByは使わないため、表示順(作成順)はここでクライアントソートする。
      // createdAtを持たないドキュメント(notificationSettings等)は0扱いで先頭に来るだけで実害はない。
      const items = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as T)
        .sort((a, b) => {
          const aTime = (a as { createdAt?: number }).createdAt ?? 0;
          const bTime = (b as { createdAt?: number }).createdAt ?? 0;
          return aTime - bTime;
        });
      callback(items);
    },
    (error) => {
      // エラーコールバックを渡さないと、購読エラー時にloadingがtrueのまま
      // 固まり続け、App.tsxの「読み込み中...」から復帰できなくなる。
      console.error(`Firestore購読エラー(${name}):`, error);
      onError?.(error);
    },
  );
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

/**
 * 選択的グループからtaskIdを除去する。taskIdsが空になった場合はグループごと削除する。
 * 残タスク数がminRequiredを下回った場合は、永久に達成不能にならないようminRequiredも調整する。
 */
export async function removeTaskFromGroup(uid: string, groupId: string, taskId: string) {
  const ref = doc(db, 'users', uid, 'selectiveGroups', groupId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return;

  const group = snapshot.data() as SelectiveGroup;
  const remainingTaskIds = group.taskIds.filter((id) => id !== taskId);
  if (remainingTaskIds.length === 0) {
    await deleteDoc(ref);
  } else {
    const minRequired = Math.min(group.minRequired, remainingTaskIds.length);
    await updateDoc(ref, { taskIds: remainingTaskIds, minRequired });
  }
}

/**
 * 選択的グループにtaskIdを追加する(重複していれば何もしない)。
 * グループが既に存在しない場合はfalseを返すので、呼び出し側は
 * selectiveGroupIdを書き込む前に必ずこの戻り値を確認すること
 * (確認しないと、存在しないグループを指すダングリング参照が生まれる)。
 */
export async function addTaskToGroup(
  uid: string,
  groupId: string,
  taskId: string,
): Promise<boolean> {
  const ref = doc(db, 'users', uid, 'selectiveGroups', groupId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return false;

  const group = snapshot.data() as SelectiveGroup;
  if (!group.taskIds.includes(taskId)) {
    await updateDoc(ref, { taskIds: [...group.taskIds, taskId] });
  }
  return true;
}

/** タスクのselectiveGroupIdフィールドを削除する(undefinedを渡すだけでは
 * ignoreUndefinedProperties設定によりフィールドが消えないため deleteField() を使う) */
export async function clearTaskSelectiveGroup(uid: string, taskId: string) {
  await updateDoc(doc(db, 'users', uid, 'tasks', taskId), { selectiveGroupId: deleteField() });
}

/**
 * タスク削除に伴う一連の後始末をアトミックに実行する。
 * - タスク本体の削除
 * - 紐づくprogressLogsの削除(残すと目標の累積達成値に永久に計上され続けるため)
 * - 目標のcumulativeAchievedを再計算後の値に更新
 * - 所属していた選択的グループからの除去(空になればグループごと削除)
 * writeBatchでまとめることで、途中失敗による「タスクは消えたがグループ参照が
 * 残る」等の中途半端な状態を防ぐ。
 */
export async function deleteTaskAndCleanup(
  uid: string,
  task: Task,
  progressLogIds: string[],
  newCumulativeAchieved: number,
) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, 'tasks', task.id));
  for (const logId of progressLogIds) {
    batch.delete(doc(db, 'users', uid, 'progressLogs', logId));
  }
  batch.update(doc(db, 'users', uid, 'goals', task.goalId), {
    cumulativeAchieved: newCumulativeAchieved,
  });

  if (task.selectiveGroupId) {
    const groupRef = doc(db, 'users', uid, 'selectiveGroups', task.selectiveGroupId);
    const snapshot = await getDoc(groupRef);
    if (snapshot.exists()) {
      const group = snapshot.data() as SelectiveGroup;
      const remainingTaskIds = group.taskIds.filter((id) => id !== task.id);
      if (remainingTaskIds.length === 0) {
        batch.delete(groupRef);
      } else {
        batch.update(groupRef, {
          taskIds: remainingTaskIds,
          minRequired: Math.min(group.minRequired, remainingTaskIds.length),
        });
      }
    }
  }

  await batch.commit();
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
