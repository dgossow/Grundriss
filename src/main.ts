import './styles.css';
import { App } from './app';
import { isElectron, isMac } from './platform';

document.documentElement.classList.toggle('electron', isElectron);
document.documentElement.classList.toggle('mac', isMac);
const root = document.getElementById('app')!;
const app = new App(root);
// für Tests/Debugging
(window as unknown as { grundrissApp: App }).grundrissApp = app;
