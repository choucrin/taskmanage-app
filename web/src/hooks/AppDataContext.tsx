import { createContext, useContext, type ReactNode } from 'react';
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
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;

  const genres = useFirestoreCollection<Genre>(uid, 'genres');
  const goals = useFirestoreCollection<Goal>(uid, 'goals');
  const tasks = useFirestoreCollection<Task>(uid, 'tasks');
  const selectiveGroups = useFirestoreCollection<SelectiveGroup>(uid, 'selectiveGroups');
  const progressLogs = useFirestoreCollection<ProgressLog>(uid, 'progressLogs');
  const notificationSettings = useFirestoreCollection<NotificationSetting>(
    uid,
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
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
