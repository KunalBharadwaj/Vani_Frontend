// Electron main process - Native desktop app for Raspberry Pi
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeFile } = require('fs').promises;

let mainWindow;

// Create the native application window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        fullscreen: true, // Start in fullscreen for kiosk mode
        frame: true, // Show window frame (set to false for kiosk)
        backgroundColor: '#1a202c',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'electron-preload.js'),
            webSecurity: true,
            sandbox: false
        },
        icon: path.join(__dirname, 'public', 'favicon.ico')
    });

    // Load the built React app
    if (app.isPackaged) {
        // Production: Load from dist folder
        mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    } else {
        // Development: Load from Vite dev server
        mainWindow.loadURL('http://localhost:8080');
        mainWindow.webContents.openDevTools(); // Open DevTools in development
    }

    // Handle window events
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Prevent window from being resized (optional for kiosk mode)
    // mainWindow.setResizable(false);
}

// App lifecycle
app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers for native file operations

// Save file to specific location
ipcMain.handle('save-file', async (event, options) => {
    try {
        const { defaultPath, filters, data } = options;

        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultPath || path.join(app.getPath('downloads'), 'drawing.png'),
            filters: filters || [
                { name: 'PNG Images', extensions: ['png'] },
                { name: 'JPEG Images', extensions: ['jpg', 'jpeg'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!result.canceled && result.filePath) {
            // Convert base64 to buffer if needed
            const buffer = data.startsWith('data:')
                ? Buffer.from(data.split(',')[1], 'base64')
                : Buffer.from(data);

            await writeFile(result.filePath, buffer);
            return { success: true, path: result.filePath };
        }

        return { success: false, canceled: true };
    } catch (error) {
        console.error('Save file error:', error);
        return { success: false, error: error.message };
    }
});

// Open file dialog
ipcMain.handle('open-file', async (event, options) => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: options?.filters || [
                { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] },
                { name: 'PDF Files', extensions: ['pdf'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            const data = await fs.promises.readFile(filePath);
            const base64 = data.toString('base64');
            const ext = path.extname(filePath).toLowerCase();

            let mimeType = 'application/octet-stream';
            if (['.png'].includes(ext)) mimeType = 'image/png';
            else if (['.jpg', '.jpeg'].includes(ext)) mimeType = 'image/jpeg';
            else if (['.gif'].includes(ext)) mimeType = 'image/gif';
            else if (['.pdf'].includes(ext)) mimeType = 'application/pdf';

            return {
                success: true,
                path: filePath,
                name: path.basename(filePath),
                data: `data:${mimeType};base64,${base64}`
            };
        }

        return { success: false, canceled: true };
    } catch (error) {
        console.error('Open file error:', error);
        return { success: false, error: error.message };
    }
});

// Get app info
ipcMain.handle('get-app-info', async () => {
    return {
        appName: app.getName(),
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        userDataPath: app.getPath('userData'),
        documentsPath: app.getPath('documents'),
        downloadsPath: app.getPath('downloads')
    };
});

// Toggle fullscreen
ipcMain.handle('toggle-fullscreen', async () => {
    if (mainWindow) {
        const isFullScreen = mainWindow.isFullScreen();
        mainWindow.setFullScreen(!isFullScreen);
        return { fullscreen: !isFullScreen };
    }
    return { fullscreen: false };
});

// Exit app
ipcMain.handle('exit-app', async () => {
    app.quit();
});

// Show error dialog
ipcMain.handle('show-error', async (event, { title, message }) => {
    await dialog.showErrorBox(title || 'Error', message || 'An error occurred');
});

// Show message dialog
ipcMain.handle('show-message', async (event, { title, message, type }) => {
    return await dialog.showMessageBox(mainWindow, {
        type: type || 'info',
        title: title || 'Message',
        message: message || '',
        buttons: ['OK']
    });
});

// Handle errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});
