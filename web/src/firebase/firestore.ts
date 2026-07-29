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
  type DocumentReference,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from './config';
import type { SelectiveGroup, TargetType, Task } from '../types';
import { resolveGroupAfterTaskRemoval } from '../utils/progress';

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

/**
 * 目標の設定内容を更新する。
 * targetRatePercent と genreId は「未設定に戻す」操作が必要になるが、undefinedを渡すだけでは
 * ignoreUndefinedProperties設定によりフィールドが消えないため deleteField() を使う。
 */
export async function updateGoalDetails(
  uid: string,
  goalId: string,
  data: {
    name: string;
    targetType: TargetType;
    targetValue: number;
    targetRatePercent?: number;
    genreId?: string;
    /** 編集後の内容で達成条件を満たしているか */
    meetsThreshold: boolean;
  },
) {
  await updateDoc(doc(db, 'users', uid, 'goals', goalId), {
    name: data.name,
    targetType: data.targetType,
    targetValue: data.targetValue,
    targetRatePercent: data.targetRatePercent ?? deleteField(),
    genreId: data.genreId ?? deleteField(),
    // 目標値を引き上げて未達成に戻った場合の後始末。
    // - アーカイブ済みなら実行中に戻す。目標を延長したのにアーカイブされたままだと
    //   本日のタスクに出てこず、実質的に進められなくなるため。
    // - 自動アーカイブの抑止フラグは役目を終えるので消す
    //   (残したままだと、次に達成しても自動アーカイブされなくなる)
    // 既にactiveでも同じ値を書くだけなので冪等。状態を見て分岐しないことで、
    // 保存直前に別経路でアーカイブされた場合の取りこぼしも防いでいる。
    //
    // 逆に達成条件を満たした場合(目標値の引き下げなど)はここではアーカイブしない。
    // 編集操作で一覧から勝手に消えると分かりにくいため、次の進捗登録時の
    // 自動アーカイブ(useProgressActions)に委ねる。
    ...(data.meetsThreshold
      ? {}
      : { status: 'active', archivedAt: deleteField(), autoArchiveDisabled: deleteField() }),
  });
}

/**
 * 進捗登録に伴う目標の更新。
 * 達成条件を下回っている間は自動アーカイブの抑止フラグを消す。
 * 消さないと、一度手動でアーカイブ解除した目標は、その後タスクを削除するなどして
 * 累積値が下がり再び達成し直しても、二度と自動アーカイブされなくなる。
 */
export async function applyGoalProgress(
  uid: string,
  goalId: string,
  data: { cumulativeAchieved: number; archive: boolean; meetsThreshold: boolean },
) {
  await updateDoc(doc(db, 'users', uid, 'goals', goalId), {
    cumulativeAchieved: data.cumulativeAchieved,
    ...(data.archive ? { status: 'archived', archivedAt: Date.now() } : {}),
    ...(data.meetsThreshold ? {} : { autoArchiveDisabled: deleteField() }),
  });
}

/**
 * 目標のアーカイブ状態を切り替える。
 * アーカイブを解除する際は archivedAt も消す。残したままだとアーカイブ一覧の
 * 「達成日」として誤った日付が表示され続けるため。
 */
export async function setGoalArchived(uid: string, goalId: string, archived: boolean) {
  await updateDoc(doc(db, 'users', uid, 'goals', goalId), {
    status: archived ? 'archived' : 'active',
    archivedAt: archived ? Date.now() : deleteField(),
    // 手動で解除した目標は自動アーカイブの対象から外す。外さないと、達成条件を満たしたままの
    // 目標は次の進捗登録で即座に再アーカイブされ、解除操作が無意味になる。
    // 手動でアーカイブし直した場合はフラグを消し、通常の自動判定に戻す。
    autoArchiveDisabled: archived ? deleteField() : true,
  });
}

/** Firestoreのバッチ書き込み上限(1バッチあたり500オペレーション) */
const BATCH_LIMIT = 500;

/** ドキュメント参照の削除を、バッチ上限ごとに分割してコミットする */
async function deleteRefsInChunks(refs: DocumentReference[]) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

/**
 * 選択的グループから、削除されるタスクを取り除く。
 * グループは目標をまたいでタスクを束ねうるため、他の目標のタスクが残る場合はグループ自体は残す。
 */
async function removeTasksFromGroups(uid: string, groupIds: string[], deletedTaskIds: Set<string>) {
  for (const groupId of groupIds) {
    const ref = doc(db, 'users', uid, 'selectiveGroups', groupId);

    // 呼び出し側が渡すグループIDは購読スナップショット由来で古い可能性があるため、
    // 内容は必ず最新を読み直す。古いtaskIdsでそのまま上書きすると、
    // 直前に他の目標から追加されたタスクが消えてしまう。
    // 既存の deleteTaskAndCleanup / removeTaskFromGroup と同じ方針。
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) continue;

    const resolution = resolveGroupAfterTaskRemoval(
      snapshot.data() as SelectiveGroup,
      deletedTaskIds,
    );
    if (resolution.action === 'none') continue;
    if (resolution.action === 'delete') {
      await deleteDoc(ref);
    } else {
      await updateDoc(ref, {
        taskIds: resolution.taskIds,
        minRequired: resolution.minRequired,
      });
    }
  }
}

/**
 * 目標の削除に伴う一連の後始末を実行する。
 *
 * 進捗ログは「タスク数 × 日数」で増えるためバッチ上限(500)を容易に超える。
 * そのため単一バッチにはせず、以下の順に分けてコミットする。
 *
 *   1. 選択的グループからの除去
 *   2. 進捗ログの削除
 *   3. タスクの削除
 *   4. 目標本体の削除
 *
 * グループ整理を最初に行うのが重要。タスク削除より後に回すと、途中で失敗した後の
 * 再実行時には既にタスクが消えていて「どのタスクをグループから外すか」を復元できず、
 * 存在しないタスクIDを指すダングリング参照がグループに残り続けてしまう
 * (しかもminRequiredが縮小されないため、残ったタスクだけでは永久に達成不能なグループになる)。
 *
 * 目標本体を最後に消すため、途中で失敗しても目標は一覧に残る。
 * 同じ削除操作をやり直せば残りを片付けられ、復旧できない状態にはならない。
 */
export async function deleteGoalAndCleanup(
  uid: string,
  goalId: string,
  taskIds: string[],
  progressLogIds: string[],
  affectedGroupIds: string[],
) {
  await removeTasksFromGroups(uid, affectedGroupIds, new Set(taskIds));
  await deleteRefsInChunks(progressLogIds.map((id) => doc(db, 'users', uid, 'progressLogs', id)));
  await deleteRefsInChunks(taskIds.map((id) => doc(db, 'users', uid, 'tasks', id)));
  await deleteDoc(doc(db, 'users', uid, 'goals', goalId));
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
