import { NavLink } from 'react-router-dom';
import { signOutUser } from '../firebase/auth';

const links = [
  { to: '/', label: '本日のタスク' },
  { to: '/progress', label: '進捗管理' },
  { to: '/goals/new', label: '目標登録' },
  { to: '/tasks/new', label: 'タスク設定' },
  { to: '/tasks', label: 'タスク管理' },
  { to: '/archive', label: 'アーカイブ' },
  { to: '/notifications', label: '通知設定' },
];

export function NavBar() {
  return (
    <nav className="navbar">
      <ul className="navbar__list">
        {links.map((link) => (
          <li key={link.to}>
            {/* /tasksは/tasks/newの前方一致になるためendを指定し、両方が同時に
                アクティブ表示されるのを防ぐ */}
            <NavLink to={link.to} end={link.to === '/' || link.to === '/tasks'}>
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <button type="button" className="navbar__logout" onClick={() => signOutUser()}>
        ログアウト
      </button>
    </nav>
  );
}
