const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

function createWindow() {
    const win = new BrowserWindow({ width: 1280, height: 800, webPreferences: { nodeIntegration: true } });
    // Start local server
    const server = spawn('node', ['server.js']);
    setTimeout(() => win.loadURL('http://localhost:3000'), 2000);
    win.on('closed', () => server.kill());
}

app.whenReady().then(createWindow);