export type TargetType = 'count' | 'time';

export type GoalStatus = 'active' | 'archived';

export type TaskStatus = 'not_achieved' | 'achieved' | 'excluded';

export interface Genre {
  id: string;
  name: string;
  createdAt: number;
}

export interface Goal {
  id: string;
  name: string;
  targetType: TargetType;
  /** 100%到達に必要な達成回数、または達成時間(分) */
  targetValue: number;
  /** 全体達成率の目標値(任意、未設定なら100扱い) */
  targetRatePercent?: number;
  genreId?: string;
  status: GoalStatus;
  /** 累積達成回数、または累積達成時間(分) */
  cumulativeAchieved: number;
  createdAt: number;
  archivedAt?: number;
}

export interface TaskSchedule {
  /** 0=日曜〜6=土曜 */
  weekdays?: number[];
  /** 個別日付指定 (YYYY-MM-DD) */
  dates?: string[];
}

export interface Task {
  id: string;
  goalId: string;
  displayName: string;
  schedule: TaskSchedule;
  targetType: TargetType;
  /** このタスク1回分の達成条件(回数 or 分) */
  targetValue: number;
  selectiveGroupId?: string;
  createdAt: number;
}

export interface SelectiveGroup {
  id: string;
  name: string;
  taskIds: string[];
  minRequired: number;
  createdAt: number;
}

export interface ProgressLog {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  taskId: string;
  goalId: string;
  /** 達成回数、または達成時間(分) */
  achievedValue: number;
  status: TaskStatus;
  updatedAt: number;
}

export type NotificationType = 'taskList' | 'progress';

export interface NotificationSetting {
  id: string;
  type: NotificationType;
  enabled: boolean;
  /** HH:mm */
  time: string;
}
