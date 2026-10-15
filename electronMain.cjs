const { app, BrowserWindow, session } = require('electron');
const path = require('path');

function createWindow() {
  // Automatically allow webcam access for QR code scanning on PC
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: '3D Indoor Campus Navigation System',
    backgroundColor: '#090d16',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});