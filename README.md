# 日課管理アプリ

`RequirementsDefinition.md` に基づく個人利用専用のPWA。React + TypeScript + Vite製フロントエンドと、通知送信用のFirebase Cloud Functionsで構成する。

## ディレクトリ構成

```
taskmanage_app/
├── web/          # フロントエンド(React + TypeScript + Vite、PWA)
├── functions/    # Cloud Functions(通知送信、1分ごとのCloud Schedulerで起動)
├── firebase.json
├── .firebaserc.example
└── firestore.indexes.json
```

## 決定済みの仕様

- **目標全体の達成率**:累積達成回数(または累積達成時間)÷ 目標の進捗定義値 × 100% で算出(`web/src/utils/progress.ts` の `calculateGoalPercent`)。`targetRatePercent` を設定した場合はそれをアーカイブ基準として使用し、未設定なら100%。
- **通知スケジュール**:Cloud Schedulerは1分ごとにCloud Functionsを起動し、Firestoreの通知設定時刻(分単位)と現在時刻(Asia/Tokyo)を比較して一致した場合のみ送信する。アプリ内で時刻を変更しても再デプロイは不要。呼び出し回数は月あたり約43,200回で、Cloud Functions無料枠(月200万回)の2%程度、Cloud Schedulerも1ジョブのみで無料枠内。

## ローカル開発

```bash
cd web
npm install
cp .env.example .env.local   # 値は下記「Firebaseプロジェクトのセットアップ」参照
npm run dev
```

`.env.local` は git 管理外(`.gitignore` 済み)。Firebase未接続の状態でもビルド・画面遷移の確認は可能だが、ログインや保存機能を使うには実際のFirebaseプロジェクトへの接続が必要。

達成率計算・選択的グループ判定・タスクのスケジュール判定などのコアロジックには単体テストを用意している:

```bash
npm test
```

## Firebaseプロジェクトのセットアップ(初回のみ、手動作業)

1. [Firebase コンソール](https://console.firebase.google.com/) で新規プロジェクトを作成する。
2. **Authentication** → 「ログイン方法」→ Google を有効化する。
3. **Firestore Database** を作成する(本番モードで開始してよい。ルールは後述の手順で上書きする)。
4. プロジェクト設定 → 全般 → 「マイアプリ」でウェブアプリを追加し、表示された `firebaseConfig` の値を `web/.env.local` の `VITE_FIREBASE_*` に転記する。
5. プロジェクト設定 → Cloud Messaging → 「ウェブ構成」で鍵ペアを生成し、`VITE_FIREBASE_VAPID_KEY` に設定する。
6. `web/public/firebase-messaging-sw.js` は手動で編集しない。`npm run dev` / `npm run build` を実行すると `web/scripts/generate-sw-config.mjs` が `web/firebase-messaging-sw.template.js` と `.env.local` の値から自動生成する(生成物のためgit管理外)。
7. プロジェクトを **Blazeプラン(従量課金)** にアップグレードする(Cloud Functions / Cloud Schedulerの利用に必須)。
8. **予算アラートを必ず設定する**:Google Cloud Console → 請求 → 予算とアラート → 月額 $1 程度で新規作成。Blazeプランは支出上限がないため、想定外の高額請求を防ぐための安全策として省略しないこと。

## 本人限定アクセスの設定(必須)

Googleログインは「Googleアカウントを持つ人なら誰でもログイン可能」なプロバイダのため、これだけでは第三者のログインを防げない。以下の3箇所で開発者本人のFirebase UIDのみを許可するようにしている:

- `web/firestore.rules`(`isOwner()` 関数)
- `web/src/constants.ts`(`ALLOWED_UID`、フロントエンド側の表示制御)
- `functions/src/index.ts`(`ALLOWED_UID`、通知送信対象の絞り込み)

Firebaseプロジェクトを作り直した場合は、初回ログイン後に Firebase Console → Authentication → Users タブで自分のUIDを確認し、上記3箇所を書き換えること。

### APIキーの追加制限(推奨)

Firebase APIキーは秘匿情報ではないが、念のため Google Cloud Console → APIとサービス → 認証情報 で以下を設定しておくと安全性が増す:

- アプリケーションの制限:HTTPリファラー制限で `https://<GitHubユーザー名>.github.io/*`、`https://<project-id>.firebaseapp.com/*`、`http://localhost:*` のみ許可
- APIの制限:Identity Toolkit API / Token Service API / Cloud Firestore API / Firebase Installations API / Cloud Messaging API のみ許可

## Firestore Security Rules / Cloud Functions のデプロイ

Firebase CLIのログインとプロジェクト紐付けが必要(このリポジトリのコード生成では実行していない):

```bash
npm install -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc   # "your-firebase-project-id" を実際のプロジェクトIDに書き換える

# Firestore ルールの反映
firebase deploy --only firestore:rules

# Cloud Functions のデプロイ(Cloud Schedulerジョブも自動作成される)
cd functions
npm install
cd ..
firebase deploy --only functions
```

## GitHub Pages への公開

1. GitHubに空リポジトリを作成し、このディレクトリをpushする(`git remote add origin ...`)。
2. リポジトリの Settings → Pages → Source を「GitHub Actions」に設定する。
3. Settings → Secrets and variables → Actions に以下を登録する(値は手順4で取得したもの):
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_VAPID_KEY`
4. Authentication → Settings → 承認済みドメインに、公開後のGitHub PagesドメインURL(`<ユーザー名>.github.io`)を追加する。
5. `main` ブランチにpushすると `.github/workflows/deploy.yml` が自動でビルド・公開する。

## iPhone/iPadでの利用

Safariでアプリを開き、共有メニューから「ホーム画面に追加」を行うこと。iOS/iPadOSはPWAとしてホーム画面に追加された状態でないとWeb Push通知を受信できない。

## 未実施・要確認事項

- 上記「Firebaseプロジェクトのセットアップ」〜「GitHub Pages への公開」は、実際の認証情報・コンソール操作が必要なためコード生成側では未実施。開発者本人による作業が必要。
- リリース前に、公開リポジトリ化に伴うセキュリティレビューを実施すること(要件定義書 6.2)。
