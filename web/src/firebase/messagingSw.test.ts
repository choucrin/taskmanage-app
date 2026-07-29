import { describe, expect, it } from 'vitest';
// Viteの ?raw インポートでテンプレートを文字列として読み込む。
// node:fs を使うとアプリ側のtsconfig(types: vite/clientのみ)で型エラーになるため。
import template from '../../firebase-messaging-sw.template.js?raw';
import generateScript from '../../scripts/generate-sw-config.mjs?raw';
import functionsSource from '../../../functions/src/index.ts?raw';

/**
 * FCM用Service Workerのテンプレートに対する回帰テスト。
 *
 * 「本日のタスク一覧の通知が同時刻に2件届く」不具合は、Functions側が `notification`
 * フィールド付きで送信し、ブラウザの自動表示とSWの showNotification() が二重に走ったことが原因だった。
 * 同じ構成に戻っていないことをここで機械的に検出する。
 */
describe('firebase-messaging-sw.template.js', () => {
  it('通知の表示内容をpayload.notificationから読まない(二重表示の再発防止)', () => {
    // payload.notification は「ブラウザが既に表示済み」の判定にのみ使ってよい。
    // title/body の取得元にすると、ブラウザの自動表示と合わせて2件表示される。
    expect(template).not.toMatch(/payload\.notification\??\.(title|body)/);
  });

  it('notificationフィールド付きメッセージでは自前表示せず早期returnする', () => {
    // フォーマッタが改行や波括弧を入れても落ちないよう空白に寛容な正規表現にする
    expect(template).toMatch(/if\s*\(\s*payload\.notification\s*\)\s*\{?\s*return/);
  });

  it('表示内容はpayload.dataから読む', () => {
    expect(template).toMatch(/payload\.data/);
    expect(template).toMatch(/data\.title/);
    expect(template).toMatch(/data\.body/);
  });

  it('二重送信されても表示が1件に保たれるようtagを指定する', () => {
    expect(template).toMatch(/tag:\s*data\.tag/);
  });

  it('通知タップでアプリを開くハンドラを持つ', () => {
    expect(template).toMatch(/addEventListener\(['"]notificationclick['"]/);
  });

  it('サブパス配信で404にならないようアイコンとURLはbaseパスを基準にする', () => {
    // GitHub Pagesは /taskmanage-app/ 配下で配信されるため、'/'始まりの絶対パスは壊れる
    expect(template).not.toMatch(/icon:\s*['"]\/icons\//);
    expect(template).toMatch(/__VITE_BASE_PATH__icons\//);
  });

  it('テンプレートの全プレースホルダーを生成スクリプトが置換できる', () => {
    // 形式チェックだけだと、生成スクリプトが知らない新規プレースホルダーを
    // テンプレートに足したときに未置換のまま出荷されてしまうため、集合として突き合わせる
    const inTemplate = new Set(template.match(/__[A-Z_]+__/g) ?? []);
    const inScript = new Set(generateScript.match(/__[A-Z_]+__/g) ?? []);
    expect(inTemplate.size).toBeGreaterThan(0);

    const unreplaceable = [...inTemplate].filter((p) => !inScript.has(p));
    expect(unreplaceable).toEqual([]);
  });
});

describe('Cloud Functions側の通知送信', () => {
  it('notificationフィールドを使わずdata限定メッセージで送る(二重表示の再発防止)', () => {
    // `notification` を付けるとブラウザが自動表示し、SWの showNotification() と合わせて2件になる。
    // SW側にも早期returnの防御はあるが、根本原因側でも復活を検出する。
    const sendCall = /messaging\.send\(\{[\s\S]*?\}\);/.exec(functionsSource)?.[0] ?? '';
    expect(sendCall).not.toBe('');
    expect(sendCall).not.toMatch(/\bnotification\s*:/);
    expect(sendCall).toMatch(/\bdata\s*:/);
  });
});
