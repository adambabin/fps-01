import { Game } from './game';
import './style.css';

const canvas = document.getElementById('game') as HTMLCanvasElement;
try {
  new Game(canvas);
} catch (err) {
  console.error(err);
  document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#eee">This game needs WebGL 2. Please try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</div>';
}
