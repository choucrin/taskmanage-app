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

  useEffect(() => {
    if (!uid) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeToCollection<T>(uid, name, (data) => {
      setItems(data);
      setLoading(false);
    });
    return unsubscribe;
  }, [uid, name]);

  return { items, loading };
}
