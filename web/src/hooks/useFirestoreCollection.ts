import { useEffect, useState } from 'react';
import { subscribeToCollection } from '../firebase/firestore';

type CollectionName =
  | 'genres'
  | 'goals'
  | 'tasks'
  | 'selectiveGroups'
  | 'progressLogs'
  | 'notificationSettings';

/** 指定コレクションをリアルタイム購読する汎用フック(未ログイン時は空配列) */
export function useFirestoreCollection<T extends { id: string }>(
  uid: string | undefined,
  name: CollectionName,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const unsubscribe = subscribeToCollection<T>(
      uid,
      name,
      (data) => {
        setItems(data);
        setLoading(false);
      },
      [],
      (err) => {
        // エラー時もloadingをfalseにしないと、App.tsxが「読み込み中...」のまま
        // 復帰不能になる。
        setLoading(false);
        setError(err);
      },
    );
    return unsubscribe;
  }, [uid, name]);

  return { items, loading, error };
}
