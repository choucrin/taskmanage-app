import { useEffect } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { NavBar } from './components/NavBar';
import { VersionBadge } from './components/VersionBadge';
import { ALLOWED_UID } from './constants';
import { signOutUser } from './firebase/auth';
import { refreshMessagingServiceWorker } from './firebase/messaging';
import { ensurePushRegistration } from './firebase/pushRegistration';
import { AppDataProvider, useAppData } from './hooks/AppDataContext';
import { Archive } from './pages/Archive';
import { GoalForm } from './pages/GoalForm';
import { GoalManagement } from './pages/GoalManagement';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { NotificationSettings } from './pages/NotificationSettings';
import { ProgressBoard } from './pages/ProgressBoard';
import { TaskManagement } from './pages/TaskManagement';
import { TaskSetup } from './pages/TaskSetup';
import './App.css';

function Unauthorized() {
  useEffect(() => {
    // 許可されていないアカウントは即座にサインアウトさせる
    const timer = window.setTimeout(() => signOutUser(), 3000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="login-page">
      <h1>アクセス権がありません</h1>
      <p>このアプリは開発者本人専用です。まもなく自動的にログアウトします。</p>
    </div>
  );
}

function LoadError() {
  return (
    <div className="loading">
      <p>データの読み込みに失敗しました。</p>
      <button type="button" onClick={() => window.location.reload()}>
        再読み込み
      </button>
    </div>
  );
}

function AppRoutes() {
  const { uid, authLoading, loading, hasError } = useAppData();

  useEffect(() => {
    if (uid !== ALLOWED_UID) return;
    // 通知設定タブを開かなくても登録の綻びを直せるよう、起動時にも確認する。
    // トークンはブラウザのデータ削除やSWの登録解除で変わることがあり、
    // 気づかないうちに通知だけが届かなくなるのを防ぐ。
    void ensurePushRegistration(uid);
  }, [uid]);

  if (authLoading) return <div className="loading">読み込み中...</div>;
  if (!uid) return <Login />;
  if (uid !== ALLOWED_UID) return <Unauthorized />;
  if (hasError) return <LoadError />;
  if (loading) return <div className="loading">読み込み中...</div>;

  return (
    <>
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/progress" element={<ProgressBoard />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/goals/new" element={<GoalForm />} />
          <Route path="/goals" element={<GoalManagement />} />
          <Route path="/tasks/new" element={<TaskSetup />} />
          <Route path="/tasks" element={<TaskManagement />} />
          <Route path="/notifications" element={<NotificationSettings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

function App() {
  useEffect(() => {
    // 通知用Service Workerは専用スコープのため通常のページ遷移では更新されない。
    // 起動時に明示的に更新チェックを促し、古い表示ロジックが残らないようにする。
    void refreshMessagingServiceWorker();
  }, []);

  // GitHub Pagesは https://choucrin.github.io/taskmanage-app/ のサブパスで配信される。
  // basenameを渡さないとpathnameが '/taskmanage-app/' のままどのルートにも一致せず、
  // 末尾の <Navigate to="/"> でURLが '/' に書き換わってしまう。
  // その状態で再読み込みするとアプリの外(GitHubのユーザーページ)に出てしまい、
  // Service Workerのスコープからも外れる。ローカル開発ではBASE_URLが '/' のため影響しない。
  return (
    <>
      <Router basename={import.meta.env.BASE_URL}>
        <AppDataProvider>
          <AppRoutes />
        </AppDataProvider>
      </Router>
      {/*
        Routerの外に置く。basenameとURLが食い違うとRouterは配下を何も描画しないため、
        中に入れると「画面が真っ白でバージョンも分からない」状態になってしまう。
        デプロイ反映の確認手段なので、どんな状態でも必ず見えるようにする。
      */}
      <VersionBadge />
    </>
  );
}

export default App;
