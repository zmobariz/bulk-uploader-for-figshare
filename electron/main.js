/**
 * electron/main.js — optional desktop wrapper.
 *
 * Runs the Express server in-process and opens it in a native window, so
 * non-technical users get a double-click app with no terminal.
 *
 * Setup (Electron is heavy, so it is NOT a default dependency):
 *     npm install --save-dev electron
 *     npm run desktop
 *
 * To package installers, add electron-builder:
 *     npm install --save-dev electron-builder
 *     npx electron-builder --win --mac --linux
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const PORT = process.env.PORT || 4137;
process.env.PORT = PORT;

// Start the bundled server in this process.
require(path.join(__dirname, '..', 'server.js'));

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    title: 'Figshare Bulk Uploader',
    webPreferences: { contextIsolation: true },
  });
  // give the server a moment to bind, then load
  setTimeout(() => win.loadURL(`http://localhost:${PORT}`), 800);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
