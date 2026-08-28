# 🎨 Chanakya - Drawing Application

A professional drawing/paint application for Raspberry Pi 5, delivered as a browser-based web app (installable as a PWA).

![React](https://img.shields.io/badge/React-18-blue)
![Vite](https://img.shields.io/badge/Vite-5-purple)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-cyan)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

- 🖌️ **Drawing Tools** - Pencil, Eraser, Highlighter, Shapes (Rectangle, Circle, Line), Fill bucket
- 🎨 **Color Picker** - 24 preset colors + custom color selector
- 📏 **Brush Size** - Adjustable brush size (1-100px)
- ↩️ **Undo/Redo** - Full history support
- 💾 **Save Options** - Gallery, PNG download, folder save (Chrome/Edge)
- 🖼️ **Gallery** - View and load previously saved drawings
- 📄 **PDF Support** - View and annotate PDF documents
- 🌈 **Background Color** - Changeable canvas background
- ⌨️ **Keyboard Shortcuts** - Quick tool switching
- 📱 **Touch Support** - Works with touch screens
- 🔌 **Offline Mode** - Works without internet connection

## 🛠️ Tech Stack

| Technology   | Purpose              |
| ------------ | -------------------- |
| React 18     | UI Framework         |
| Vite         | Build Tool           |
| Tailwind CSS | Styling              |
| shadcn/ui    | UI Components        |
| HTML5 Canvas | Drawing              |
| IndexedDB    | Data Storage         |

## 🚀 Quick Start

#### Prerequisites

- Node.js 18+
- npm or yarn

#### Installation

```bash
# Clone the repository
git clone https://github.com/raghuwanshi313/EDP_APP.git

# Navigate to project directory
cd EDP_APP

# Install dependencies
npm install

# Start development server
npm run dev
```

Open your browser at `http://localhost:8080`

### Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## ⌨️ Keyboard Shortcuts

| Key      | Action              |
| -------- | ------------------- |
| `P`      | Pencil tool         |
| `E`      | Eraser tool         |
| `R`      | Rectangle tool      |
| `C`      | Circle tool         |
| `L`      | Line tool           |
| `G`      | Fill (paint bucket) |
| `Ctrl+Z` | Undo                |
| `Ctrl+Y` | Redo                |
| `Ctrl+S` | Save                |

## 📁 Project Structure

```
src/
├── components/
│   ├── paint/
│   │   ├── PaintCanvas.jsx    # Main canvas component
│   │   ├── Toolbar.jsx        # Top toolbar
│   │   ├── ToolButton.jsx     # Tool button component
│   │   ├── ColorPalette.jsx   # Color picker
│   │   ├── BrushSizeSlider.jsx# Brush size control
│   │   └── SavedPagesGallery.jsx # Gallery component
│   └── ui/                    # Reusable UI components
├── services/
│   └── storageService.js      # File saving utilities
├── pages/
│   ├── Index.jsx              # Home page
│   └── NotFound.jsx           # 404 page
└── App.jsx                    # Main app component
```

## 🍓 Raspberry Pi 5 Deployment

Chanakya is optimized for Raspberry Pi 5! Complete automated setup available.

### **Quick Setup (Recommended)**

```bash
# One-line installation
cd ~ && git clone https://github.com/raghuwanshi313/EDP_APP.git && cd EDP_APP && chmod +x *.sh && ./complete-pi5-setup.sh
```

The setup script will:

- ✅ Install Node.js 18+
- ✅ Configure GPU acceleration
- ✅ Setup Zram swap
- ✅ Build production version
- ✅ Create launch scripts
- ✅ Configure auto-start (optional)

### **Launch App**

```bash
# Start app in kiosk mode
~/launch-chanakya.sh

# Or manually
cd ~/EDP_APP && npm run preview
chromium-browser --kiosk http://localhost:4173
```

### **Full Documentation**

See comprehensive guides:

- 📘 **[RASPBERRY_PI_5_GUIDE.md](./RASPBERRY_PI_5_GUIDE.md)** - Complete deployment guide
- 📗 **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Commands & troubleshooting
- 📙 **[OFFLINE_MODE.md](./OFFLINE_MODE.md)** - Offline features

### **Helpful Scripts**

```bash
./troubleshoot.sh          # Diagnose issues
./monitor-performance.sh   # Monitor system performance
./autostart-setup.sh      # Enable auto-start on boot
```

## 💾 Data Storage

All data is stored locally - **no external APIs or databases required**:

- **Gallery** - Saved in browser's localStorage
- **Download** - Direct PNG download to device
- **Folder Save** - Save to specific folder (Chrome/Edge)

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 👨‍💻 Author

**Aman Raghuwanshi**

- GitHub: [@raghuwanshi313](https://github.com/raghuwanshi313)

---

Made with ❤️ for Raspberry Pi
