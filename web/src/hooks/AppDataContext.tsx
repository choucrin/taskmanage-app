import { createContext, useContext, type ReactNode } from 'react';
import { ALLOWED_UID } from '../constants';
import type { Genre, Goal, NotificationSetting, ProgressLog, SelectiveGroup, Task } from '../types';
import { useAuth } from './useAuth';
import { useFirestoreCollection } from './useFirestoreCollection';

interface AppDataValue {
  uid: string | undefined;
  authLoading: boolean;
  genres: Genre[];
  goals: Goal[];
  tasks: Task[];
  selectiveGroups: SelectiveGroup[];
  progressLogs: ProgressLog[];
  notificationSettings: NotificationSetting[];
  loading: boolean;
  hasError: boolean;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;
  // 許可されたUID以外は、Firestore Rulesでどうせ拒否されるため購読自体を開始しない
  // (permission-deniedエラーの発生と無駄なリクエストを防ぐ)。
  const subscribeUid = uid === ALLOWED_UID ? uid : undefined;

  const genres = useFirestoreCollection<Genre>(subscribeUid, 'genres');
  const goals = useFirestoreCollection<Goal>(subscribeUid, 'goals');
  const tasks = useFirestoreCollection<Task>(subscribeUid, 'tasks');
  const selectiveGroups = useFirestoreCollection<SelectiveGroup>(subscribeUid, 'selectiveGroups');
  const progressLogs = useFirestoreCollection<ProgressLog>(subscribeUid, 'progressLogs');
  const notificationSettings = useFirestoreCollection<NotificationSetting>(
    subscribeUid,
    'notificationSettings',
  );

  const loading =
    authLoading ||
    genres.loading ||
    goals.loading ||
    tasks.loading ||
    selectiveGroups.loading ||
    progressLogs.loading ||
    notificationSettings.loading;

  // いずれかの購読がエラーになった場合、loadingが false になっても
  // データが揃わないままレンダリングされてしまうため、専用フラグで区別する。
  const hasError = Boolean(
    genres.error ||
      goals.error ||
      tasks.error ||
      selectiveGroups.error ||
      progressLogs.error ||
      notificationSettings.error,
  );

  const value: AppDataValue = {
    uid,
    authLoading,
    genres: genres.items,
    goals: goals.items,
    tasks: tasks.items,
    selectiveGroups: selectiveGroups.items,
    progressLogs: progressLogs.items,
    notificationSettings: notificationSettings.items,
    loading,
    hasError,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
