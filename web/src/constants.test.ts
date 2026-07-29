import { describe, expect, it } from 'vitest';
import { ALLOWED_UID, APP_VERSION } from './constants';

describe('APP_VERSION', () => {
  it('ver.NN.N の書式になっている', () => {
    // 画面右下の表示とアップデート報告で使う番号のため、書式のゆれを機械的に防ぐ
    expect(APP_VERSION).toMatch(/^ver\.\d{2}\.\d$/);
  });
});

describe('ALLOWED_UID', () => {
  it('Firestore RulesおよびCloud Functions側と同じUIDを保持している', () => {
    // 3箇所(constants.ts / firestore.rules / functions/src/index.ts)で一致している必要がある。
    // ここが食い違うと、アプリは開けるのに読み書きが全て拒否される状態になる。
    expect(ALLOWED_UID).toBe('OBBBWdPsQqdzrJqDDLcHZ2EpAps2');
  });
});
