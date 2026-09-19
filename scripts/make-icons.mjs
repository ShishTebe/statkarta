// Значки приложения для сборки GitHub Pages (NFR-04): src/ui/icons/icon.svg → PNG через протокол отладки headless Chrome.
// Запуск: node scripts/make-icons.mjs (PNG хранятся в репозитории, пересобирать при смене рисунка)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './lib-data.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = path.join(ROOT, 'src/ui/icons');
const svg = fs.readFileSync(path.join(DIR, 'icon.svg'), 'utf8');
const SIZES = { 'icon-192.png': 192, 'icon-512.png': 512 };
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'statkarta-icons-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* ждем */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const on = (e) => { const m = JSON.parse(e.data); if (m.id !== id) return; ws.removeEventListener('message', on); m.error ? reject(new Error(m.error.message)) : resolve(m.result); };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  for (const [name, size] of Object.entries(SIZES)) {
    await call('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const html = `<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
    await call('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
    await sleep(400);
    const { data } = await call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    fs.writeFileSync(path.join(DIR, name), Buffer.from(data, 'base64'));
    console.log(`значок: ${name}`);
  }
  ws.close();
} finally {
  chrome.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
