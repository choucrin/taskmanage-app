import { useState } from 'react';
import { signInWithGoogle } from '../firebase/auth';

export function Login() {
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error('Googleログインエラー:', e);
      const code = e instanceof Object && 'code' in e ? String(e.code) : 'unknown';
      setError(`ログインに失敗しました(${code})。もう一度お試しください。`);
    }
  }

  return (
    <div className="login-page">
      <h1>日課管理アプリ</h1>
      <p>本人確認のためGoogleアカウントでログインしてください。</p>
      <button type="button" onClick={handleLogin}>
        Googleでログイン
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
