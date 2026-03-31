// Electron service - Handle native app operations
// This service provides a unified API for file operations that works
// both in Electron (native app) and browser (web app)

/**
 * Check if running in Electron
 */
export const isElectron = () => {
    return typeof window !== 'undefined' && window.electronAPI?.isElectron === true;
};

/**
 * Get app information
 */
export const getAppInfo = async () => {
    if (isElectron()) {
        return await window.electronAPI.getAppInfo();
    }
    return {
        appName: 'Chanakya Paint',
        appVersion: '1.0.0',
        platform: 'web',
        arch: navigator.platform
    };
};

/**
 * Save file using native dialog (Electron) or download (Web)
 */
export const saveFile = async (dataURL, filename = 'drawing.png') => {
    try {
        if (isElectron()) {
            // Native Electron save dialog
            const result = await window.electronAPI.saveFile({
                defaultPath: filename,
                filters: [
                    { name: 'PNG Images', extensions: ['png'] },
                    { name: 'JPEG Images', extensions: ['jpg', 'jpeg'] },
                    { name: 'All Files', extensions: ['*'] }
                ],
                data: dataURL
            });

            if (result.success) {
                return { success: true, path: result.path };
            } else if (result.canceled) {
                return { success: false, canceled: true };
            } else {
                throw new Error(result.error || 'Failed to save file');
            }
        } else {
            // Web browser download
            const link = document.createElement('a');
            link.href = dataURL;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return { success: true, path: filename };
        }
    } catch (error) {
        console.error('Save file error:', error);
        throw error;
    }
};

/**
 * Open file using native dialog (Electron) or input (Web)
 */
export const openFile = async (accept = 'image/*,application/pdf') => {
    try {
        if (isElectron()) {
            // Native Electron open dialog
            const result = await window.electronAPI.openFile({
                filters: [
                    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] },
                    { name: 'PDF Files', extensions: ['pdf'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (result.success) {
                return {
                    success: true,
                    name: result.name,
                    path: result.path,
                    data: result.data
                };
            } else if (result.canceled) {
                return { success: false, canceled: true };
            } else {
                throw new Error(result.error || 'Failed to open file');
            }
        } else {
            // Web browser file input
            return new Promise((resolve, reject) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = accept;

                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (!file) {
                        resolve({ success: false, canceled: true });
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = (event) => {
                        resolve({
                            success: true,
                            name: file.name,
                            data: event.target.result
                        });
                    };
                    reader.onerror = () => reject(new Error('Failed to read file'));
                    reader.readAsDataURL(file);
                };

                input.oncancel = () => resolve({ success: false, canceled: true });
                input.click();
            });
        }
    } catch (error) {
        console.error('Open file error:', error);
        throw error;
    }
};

/**
 * Toggle fullscreen mode
 */
export const toggleFullscreen = async () => {
    if (isElectron()) {
        return await window.electronAPI.toggleFullscreen();
    } else {
        // Web browser fullscreen API
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
            return { fullscreen: true };
        } else {
            await document.exitFullscreen();
            return { fullscreen: false };
        }
    }
};

/**
 * Exit application (Electron only)
 */
export const exitApp = async () => {
    if (isElectron()) {
        await window.electronAPI.exitApp();
    } else {
        window.close();
    }
};

/**
 * Show error dialog
 */
export const showError = async (title, message) => {
    if (isElectron()) {
        await window.electronAPI.showError({ title, message });
    } else {
        alert(`${title}\n\n${message}`);
    }
};

/**
 * Show message dialog
 */
export const showMessage = async (title, message, type = 'info') => {
    if (isElectron()) {
        return await window.electronAPI.showMessage({ title, message, type });
    } else {
        alert(`${title}\n\n${message}`);
        return { response: 0 };
    }
};

/**
 * Get platform information
 */
export const getPlatform = () => {
    if (isElectron()) {
        return {
            isElectron: true,
            platform: window.electronAPI.platform,
            arch: window.electronAPI.arch,
            isRaspberryPi: window.electronAPI.platform === 'linux' &&
                (window.electronAPI.arch === 'arm64' || window.electronAPI.arch === 'arm')
        };
    }
    return {
        isElectron: false,
        platform: 'web',
        arch: navigator.platform,
        isRaspberryPi: false
    };
};
