import { NavLink } from 'react-router-dom';
import { signOutUser } from '../firebase/auth';

const links = [
  { to: '/', label: '本日のタスク' },
  { to: '/progress', label: '進捗管理' },
  { to: '/goals/new', label: '目標登録' },
  { to: '/tasks/new', label: 'タスク設定' },
  { to: '/archive', label: 'アーカイブ' },
  { to: '/notifications', label: '通知設定' },
];

export function NavBar() {
  return (
    <nav className="navbar">
      <ul className="navbar__list">
        {links.map((link) => (
          <li key={link.to}>
            <NavLink to={link.to} end={link.to === '/'}>
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
