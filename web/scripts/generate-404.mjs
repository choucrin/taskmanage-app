import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// GitHub Pagesは静的ファイルしか返さないため、/taskmanage-app/goals のような
// アプリ内ルートを直接開いたり、その状態で再読み込みするとGitHubの404ページになる。
// index.html と同じ内容を 404.html として置いておくと、GitHubが404の代わりにこれを返し、
// React Router がURLを解釈してそのまま目的の画面を描画できる。
// (Service Worker導入後はSW側のNavigationRouteでも解決されるが、
//  初回訪問時やSWが無効な環境ではこのファイルが必要)
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(webRoot, 'dist');

copyFileSync(path.join(dist, 'index.html'), path.join(dist, '404.html'));
console.log('[generate-404] dist/404.html を生成しました。');
