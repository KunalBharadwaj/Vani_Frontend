// LOCAL STORAGE SERVICE - Browser-based storage
// Provides helper functions to store drawings in the browser's IndexedDB
// and to download or export them as files.
import { PDFDocument } from 'pdf-lib';

// IndexedDB database / object store configuration
const DB_NAME = "DrawingsDB";
const DB_VERSION = 1;
const STORE_NAME = "drawings";

/**
 * Initialize IndexedDB
 */
// Open (or create) the IndexedDB database and object store.
const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
    });
};
/**
 * Initialize storage (local only, no API calls)
 */
// Call this once on app startup if you want to ensure the
// IndexedDB database is created before the user interacts with it.
export const initializeStorage = async () => {
    try {
        await initDB();
        return { success: true };
    } catch (error) {
        console.error("Error initializing storage:", error);
        return { success: false, error };
    }
};

/**
 * Upload a file (store locally in IndexedDB)
 * @param {File|Blob} file - The file to upload
 * @param {string} fileName - Optional custom file name
 * @returns {Promise<{success: boolean, url?: string, error?: any}>}
 */
export const uploadFile = async (file, fileName = null) => {
    try {
        const db = await initDB();
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 9);
        const name = fileName || `drawing-${timestamp}-${randomId}.png`;

        // Convert blob to base64
        const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });

        const fileData = {
            id: name,
            name: name,
            data: dataUrl,
            size: file.size,
            type: file.type,
            created_at: timestamp,
        };

        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        await store.put(fileData);

        return {
            success: true,
            url: dataUrl,
            path: name,
        };
    } catch (error) {
        console.error("Error uploading file:", error);
        return { success: false, error };
    }
};

/**
 * Upload canvas as image (store locally)
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {string} fileName - Optional custom file name
 * @returns {Promise<{success: boolean, url?: string, error?: any}>}
 */
export const uploadCanvas = async (canvas, fileName = null) => {
    try {
        return new Promise((resolve) => {
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    resolve({ success: false, error: "Failed to create blob from canvas" });
                    return;
                }

                const result = await uploadFile(blob, fileName);
                resolve(result);
            }, "image/png");
        });
    } catch (error) {
        console.error("Error uploading canvas:", error);
        return { success: false, error };
    }
};

/**
 * List all files in local storage
 * @returns {Promise<{success: boolean, files?: Array, error?: any}>}
 */
export const listFiles = async () => {
    try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const files = request.result.map((file) => ({
                    id: file.id,
                    name: file.name,
                    url: file.data,
                    size: file.size,
                    type: file.type,
                    created_at: file.created_at,
                }));
                resolve({ success: true, files });
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error("Error listing files:", error);
        return { success: false, error };
    }
};

/**
 * Delete a file from local storage
 * @param {string} fileName - The file name/id
 * @returns {Promise<{success: boolean, error?: any}>}
 */
export const deleteFile = async (fileName) => {
    try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        await store.delete(fileName);

        return { success: true };
    } catch (error) {
        console.error("Error deleting file:", error);
        return { success: false, error };
    }
};

/**
 * Download a file from local storage
 * @param {string} fileName - The file name/id
 * @returns {Promise<{success: boolean, blob?: Blob, error?: any}>}
 */
export const downloadFile = async (fileName) => {
    try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(fileName);

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const file = request.result;
                if (!file) {
                    resolve({ success: false, error: "File not found" });
                    return;
                }

                // Convert base64 to blob
                fetch(file.data)
                    .then((res) => res.blob())
                    .then((blob) => resolve({ success: true, blob }))
                    .catch((error) => resolve({ success: false, error }));
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error("Error downloading file:", error);
        return { success: false, error };
    }
};

/**
 * Get data URL for a file (local storage)
 * @param {string} fileName - The file name/id
 * @returns {Promise<string>}
 */
export const getPublicUrl = async (fileName) => {
    try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(fileName);

        return new Promise((resolve) => {
            request.onsuccess = () => {
                const file = request.result;
                resolve(file ? file.data : "");
            };
            request.onerror = () => resolve("");
        });
    } catch (error) {
        console.error("Error getting URL:", error);
        return "";
    }
};

// Store the folder handle for reuse
let savedFolderHandle = null;

/**
 * Pick a folder to save files to (using File System Access API)
 * @returns {Promise<{success: boolean, handle?: FileSystemDirectoryHandle, error?: any}>}
 */
export const pickSaveFolder = async () => {
    try {
        if (!('showDirectoryPicker' in window)) {
            return { success: false, error: "File System Access API not supported in this browser" };
        }

        const handle = await window.showDirectoryPicker({
            mode: 'readwrite',
            startIn: 'pictures'
        });

        savedFolderHandle = handle;
        return { success: true, handle, folderName: handle.name };
    } catch (error) {
        if (error.name === 'AbortError') {
            return { success: false, error: "Folder selection cancelled" };
        }
        console.error("Error picking folder:", error);
        return { success: false, error };
    }
};

/**
 * Save canvas to the selected folder
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {string} fileName - The file name
 * @param {FileSystemDirectoryHandle} folderHandle - Optional folder handle (uses saved one if not provided)
 * @returns {Promise<{success: boolean, path?: string, error?: any}>}
 */
export const saveCanvasToFolder = async (canvas, fileName = null, folderHandle = null) => {
    try {
        const handle = folderHandle || savedFolderHandle;

        if (!handle) {
            return { success: false, error: "No folder selected. Please select a folder first." };
        }

        const timestamp = Date.now();
        const name = fileName || `drawing-${timestamp}.png`;

        // Create file in the folder
        const fileHandle = await handle.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();

        // Convert canvas to blob
        const blob = await new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), 'image/png');
        });

        await writable.write(blob);
        await writable.close();

        return { success: true, path: `${handle.name}/${name}`, fileName: name };
    } catch (error) {
        console.error("Error saving to folder:", error);
        return { success: false, error: error.message || error };
    }
};

/**
 * Download canvas as file (traditional download - goes to Downloads folder)
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {string} fileName - The file name
 */
export const downloadCanvas = (canvas, fileName = null) => {
    const timestamp = Date.now();
    const name = fileName || `drawing-${timestamp}.png`;

    const link = document.createElement('a');
    link.download = name;
    link.href = canvas.toDataURL('image/png');
    link.click();

    return { success: true, fileName: name };
};

/**
 * Download canvas to Downloads folder (alternative function)
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {string} fileName - The file name
 */
export const downloadCanvasToDownloads = (canvas, fileName = null) => {
    try {
        const timestamp = Date.now();
        const name = fileName || `drawing-${timestamp}.png`;

        const link = document.createElement('a');
        link.download = name;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        return { success: true, fileName: name };
    } catch (error) {
        console.error("Error downloading canvas:", error);
        return { success: false, error: error.message || error };
    }
};

/**
 * Convert a data URL (base64) string to a Uint8Array
 * @param {string} dataUrl
 * @returns {Uint8Array}
 */
const dataUrlToUint8 = (dataUrl) => {
    const base64 = dataUrl.split(',')[1];
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

/**
 * Download the given canvas as a single-page PDF
 * @param {HTMLCanvasElement} canvas
 * @param {string|null} fileName
 * @returns {Promise<{success: boolean, fileName?: string, error?: any}>}
 */
export const downloadCanvasAsPDF = async (canvas, fileName = null) => {
    try {
        if (!canvas) {
            return { success: false, error: 'Canvas is not available' };
        }

        const timestamp = Date.now();
        const name = (fileName && fileName.endsWith('.pdf'))
            ? fileName
            : (fileName ? `${fileName}.pdf` : `drawing-${timestamp}.pdf`);

        // Create PDF sized to canvas dimensions
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([canvas.width, canvas.height]);

        // Convert canvas image to bytes and embed
        const pngDataUrl = canvas.toDataURL('image/png');
        const imageBytes = dataUrlToUint8(pngDataUrl);
        const pngImage = await pdfDoc.embedPng(imageBytes);

        // Draw image to fill the whole page
        page.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height,
        });

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        return { success: true, fileName: name };
    } catch (error) {
        console.error('Error downloading canvas as PDF:', error);
        return { success: false, error: error.message || error };
    }
};

/**
 * Download multiple canvas pages (data URLs) as a single multi-page PDF
 * @param {Array<{name?: string, canvasData: string}>} pages - Array of pages with data URLs
 * @param {string|null} fileName - Desired output file name (will end with .pdf)
 * @returns {Promise<{success: boolean, fileName?: string, error?: any}>}
 */
export const downloadPagesAsPDF = async (pages, fileName = null) => {
    try {
        if (!Array.isArray(pages) || pages.length === 0) {
            return { success: false, error: 'No pages to export' };
        }

        const timestamp = Date.now();
        const name = (fileName && fileName.endsWith('.pdf'))
            ? fileName
            : (fileName ? `${fileName}.pdf` : `drawings-${timestamp}.pdf`);

        const pdfDoc = await PDFDocument.create();

        for (const page of pages) {
            const dataUrl = page?.canvasData;
            if (!dataUrl) continue;

            // Convert data URL to bytes and embed as PNG
            const imageBytes = dataUrlToUint8(dataUrl);
            const pngImage = await pdfDoc.embedPng(imageBytes);

            const imgWidth = pngImage.width;
            const imgHeight = pngImage.height;

            // Create a PDF page matching the image dimensions
            const pdfPage = pdfDoc.addPage([imgWidth, imgHeight]);
            pdfPage.drawImage(pngImage, {
                x: 0,
                y: 0,
                width: imgWidth,
                height: imgHeight,
            });
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        return { success: true, fileName: name };
    } catch (error) {
        console.error('Error downloading pages as PDF:', error);
        return { success: false, error: error.message || error };
    }
};

/**
 * Check if a save folder is already selected
 * @returns {boolean}
 */
export const hasSavedFolder = () => {
    return savedFolderHandle !== null;
};

/**
 * Get the name of the saved folder
 * @returns {string|null}
 */
export const getSavedFolderName = () => {
    return savedFolderHandle ? savedFolderHandle.name : null;
};
