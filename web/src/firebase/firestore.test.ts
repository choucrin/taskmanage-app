import { describe, expect, it } from 'vitest';
import { fcmTokenDocId } from './firestore';

describe('fcmTokenDocId', () => {
  // Cloud Functions側(functions/src/notification.ts)にも同名の関数があり、同じ結果を返す必要がある。
  // ずれると、Functionsが失効トークンを削除しようとしても別のドキュメントIDを指して空振りし、
  // 届かない端末への送信が毎日繰り返される。
  // functions/src/notification.test.ts に同じケースを置いているので、片方を直したら両方直すこと。
  it('通常のFCMトークンはそのまま使える', () => {
    const token = 'cXf1a2B3-d4E5_f6:APA91bHqRs-TuV_wXyZ0123456789';
    expect(fcmTokenDocId(token)).toBe(token);
  });

  it("'/' はパス区切りになるため置き換える", () => {
    expect(fcmTokenDocId('abc/def/ghi')).toBe('abc_def_ghi');
  });

  it('空文字でも例外にならない', () => {
    expect(fcmTokenDocId('')).toBe('');
  });
});
