import { useEffect } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { NavBar } from './components/NavBar';
import { ALLOWED_UID } from './constants';
import { signOutUser } from './firebase/auth';
import { AppDataProvider, useAppData } from './hooks/AppDataContext';
import { Archive } from './pages/Archive';
import { GoalForm } from './pages/GoalForm';
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
  return (
    <Router>
      <AppDataProvider>
        <AppRoutes />
      </AppDataProvider>
    </Router>
  );
}

export default App;
