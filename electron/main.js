/**
 * electron/main.js — desktop wrapper.
 * Runs the bundled Express server in-process on a free port and shows it in a
 * native window. No Node install, no terminal, no admin rights required.
 *
 * Auto-update (opt-out with NO_UPDATE_CHECK=1):
 *   - Where supported (Windows per-user installer, Linux AppImage) the app
 *     downloads new releases from GitHub in the background and offers a
 *     "Restart to update" prompt in the UI.
 *   - The portable .exe and unsigned macOS build can't self-install, so they
 *     fall back to a "new version available — Download" banner instead.
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const net = require('net');
const http = require('http');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

function waitForServer(port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (res) => { res.resume(); resolve(); });
      req.on('error', () => { (Date.now() - start > timeoutMs) ? reject(new Error('server timeout')) : setTimeout(tryOnce, 250); });
      req.on('timeout', () => req.destroy());
    };
    tryOnce();
  });
}

const RELEASES_URL = 'https://github.com/zmobariz/bulk-uploader-for-figshare/releases';

function wireUpdater(win) {
  let autoUpdater = null;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { autoUpdater = null; }

  const send = (state, info) => { if (win && !win.isDestroyed()) win.webContents.send('updater:state', { state, info: info || {} }); };

  // The portable .exe sets PORTABLE_EXECUTABLE_DIR and can't self-install;
  // dev (unpackaged) has no update metadata; both fall back to the notify banner.
  const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  const enabled = app.isPackaged && !isPortable && process.env.NO_UPDATE_CHECK !== '1' && !!autoUpdater;

  if (autoUpdater) {
    autoUpdater.autoDownload = true;
    // Never install silently: a downloaded update is applied only when the user
    // clicks "Restart to update" (as documented in ASSURANCE.md).
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('checking-for-update', () => send('checking'));
    autoUpdater.on('update-available', (i) => send('available', { version: i && i.version }));
    autoUpdater.on('update-not-available', () => send('none'));
    autoUpdater.on('download-progress', (p) => send('downloading', { percent: p && p.percent }));
    autoUpdater.on('update-downloaded', (i) => send('downloaded', { version: i && i.version }));
    autoUpdater.on('error', (e) => send('error', { message: String((e && e.message) || e) }));
  }

  // Only our own UI (the main window's top frame, on the local server origin) may drive the updater.
  const fromApp = (e) => !!(win && !win.isDestroyed() && e.sender === win.webContents && e.senderFrame
    && e.senderFrame === win.webContents.mainFrame && isAppUrl(e.senderFrame.url));

  ipcMain.on('updater:check', (e) => {
    if (!fromApp(e)) return;
    if (!enabled) return send('error'); // -> renderer shows the "Download" notify banner instead
    try { autoUpdater.checkForUpdates().catch((err) => send('error', { message: String((err && err.message) || err) })); }
    catch (err) { send('error', { message: String((err && err.message) || err) }); }
  });
  ipcMain.on('updater:restart', (e) => { if (!fromApp(e)) return; try { autoUpdater && autoUpdater.quitAndInstall(); } catch (err) {} });
  ipcMain.on('updater:open-releases', (e) => { if (fromApp(e)) shell.openExternal(RELEASES_URL); });
}

let win;
let appOrigin = null; // http://127.0.0.1:<port>, set once the server port is known
const isAppUrl = (u) => { try { return new URL(u).origin === appOrigin; } catch (e) { return false; } };
const isHttpsUrl = (u) => { try { return new URL(u).protocol === 'https:'; } catch (e) { return false; } };

// Defence in depth for the renderer: it may only ever show our local UI.
app.on('web-contents-created', (_e, contents) => {
  // Links with target=_blank open in the user's browser (https only), never in an Electron window.
  contents.setWindowOpenHandler(({ url }) => { if (isHttpsUrl(url)) shell.openExternal(url); return { action: 'deny' }; });
  // No navigating the app window away from the local UI.
  contents.on('will-navigate', (ev, url) => { if (!isAppUrl(url)) { ev.preventDefault(); if (isHttpsUrl(url)) shell.openExternal(url); } });
  contents.on('will-redirect', (ev, url) => { if (!isAppUrl(url)) ev.preventDefault(); });
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

async function createWindow() {
  const port = await findFreePort();
  process.env.PORT = String(port);
  appOrigin = `http://127.0.0.1:${port}`;
  require(path.join(__dirname, '..', 'server.js'));

  // The app needs no camera, mic, notifications, HID/USB/serial, etc.
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (session.defaultSession.setDevicePermissionHandler) session.defaultSession.setDevicePermissionHandler(() => false);

  win = new BrowserWindow({
    width: 1120, height: 920, minWidth: 720, minHeight: 600,
    title: 'Bulk Uploader for Figshare', backgroundColor: '#f6f7fb',
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      webSecurity: true, webviewTag: false, spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (win.removeMenu) win.removeMenu();
  wireUpdater(win);
  try { await waitForServer(port, 20000); } catch (e) { /* load anyway */ }
  win.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
