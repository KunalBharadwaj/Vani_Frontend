# 🧪 Testing Chanakya Paint Native App

## 🎯 Testing Strategy

You can test the app in **three ways**:

1. **On Windows** (your current machine) - fastest for development
2. **On Raspberry Pi** (target device) - final testing
3. **Cross-platform** - ensure it works everywhere

---

## 💻 Method 1: Test on Windows (Recommended First)

### **Step 1: Install Dependencies**

```powershell
# Open PowerShell in your project folder
cd C:\Users\amanr\EDP_APP\EDP_APP

# Install dependencies (if not done)
npm install

# Install Electron (if not installed)
npm install --save-dev electron electron-builder concurrently wait-on
```

### **Step 2: Run Development Mode**

```powershell
# Option A: Run both Vite and Electron together
npm run electron:dev

# Option B: Run separately (2 terminals)
# Terminal 1:
npm run dev

# Terminal 2:
npm run electron
```

You should see:

- ✅ Vite dev server starts on http://localhost:8080
- ✅ Electron window opens automatically
- ✅ Your Chanakya Paint app loads in the window

### **Step 3: Test Features**

Test all features in the Electron window:

#### **Drawing Tools**

- [ ] Click Pencil tool - draw on canvas
- [ ] Click Eraser - erase drawings
- [ ] Click Highlighter - semi-transparent drawing
- [ ] Click Rectangle - drag to draw rectangle
- [ ] Click Circle - drag to draw circle
- [ ] Click Line - drag to draw line
- [ ] Click Fill Bucket - click to fill area

#### **Colors**

- [ ] Click different preset colors
- [ ] Click custom color picker
- [ ] Change background color

#### **Brush Size**

- [ ] Move brush size slider
- [ ] Verify brush size changes

#### **Canvas Features**

- [ ] Add new page
- [ ] Switch between pages
- [ ] Toggle portrait/landscape
- [ ] Maximize/minimize canvas

#### **File Operations (Native!)**

- [ ] Click Save button - native save dialog should appear
- [ ] Choose location and save file
- [ ] Check that file was saved to chosen location
- [ ] Click Open/Import - native open dialog should appear
- [ ] Select an image file to import

#### **History**

- [ ] Draw something
- [ ] Press Ctrl+Z (undo) - should undo
- [ ] Press Ctrl+Y (redo) - should redo

#### **Gallery**

- [ ] Save to gallery
- [ ] Load from gallery
- [ ] Delete from gallery

### **Step 4: Check Console**

Open DevTools (they should auto-open in dev mode):

- Check for errors in Console tab
- Look for "Electron preload script loaded" message
- Test that `window.electronAPI` exists:
  ```javascript
  console.log("Is Electron:", window.electronAPI?.isElectron);
  ```

---

## 🥧 Method 2: Test on Raspberry Pi 5

### **Step 1: Transfer Files to Pi**

```powershell
# Option A: Use Git (recommended)
# On Raspberry Pi:
git clone https://github.com/raghuwanshi313/EDP_APP.git
cd EDP_APP

# Option B: Copy via SCP from Windows
# On Windows PowerShell:
scp -r C:\Users\amanr\EDP_APP\EDP_APP pi@<pi-ip-address>:~/EDP_APP
```

### **Step 2: Run Setup Script**

```bash
# On Raspberry Pi
cd ~/EDP_APP
chmod +x setup-electron-pi.sh
./setup-electron-pi.sh
```

This will:

- Install Node.js 18+
- Install Electron dependencies
- Build the app
- Create .deb package (optional)
- Install system-wide (optional)

### **Step 3: Launch and Test**

```bash
# Launch the app
~/launch-chanakya.sh

# Or if installed system-wide:
chanakya-paint
```

### **Step 4: Test on Raspberry Pi**

Run through the same feature tests as Windows, plus:

#### **Touch Screen Tests** (if you have touchscreen)

- [ ] Touch to draw
- [ ] Touch buttons and tools
- [ ] Pinch/zoom (if supported)
- [ ] Swipe gestures

#### **Performance Tests**

- [ ] Monitor CPU usage: `htop`
- [ ] Monitor temperature: `vcgencmd measure_temp`
- [ ] Check for lag while drawing
- [ ] Test with large canvas

#### **System Integration Tests**

- [ ] Find app in application menu
- [ ] Launch from desktop icon
- [ ] Check auto-start (if enabled)
- [ ] Test fullscreen mode (F11)

---

## 🔍 Method 3: Quick Test (No Build)

Just want to see if it works without building?

### **On Windows:**

```powershell
cd C:\Users\amanr\EDP_APP\EDP_APP

# Install dependencies
npm install

# Run development mode (no build needed)
npm run electron:dev
```

The app should open in 10-15 seconds!

---

## 📊 Testing Checklist

### **Core Features**

- [ ] App launches successfully
- [ ] No console errors
- [ ] Drawing tools work
- [ ] Colors work
- [ ] Undo/Redo works
- [ ] Save/Load works

### **Native Features** (Electron-specific)

- [ ] Native save dialog appears (not browser download)
- [ ] Native open dialog appears (not file input)
- [ ] Can save to any folder location
- [ ] Can open images from any location
- [ ] Fullscreen toggle works (F11 or via menu)
- [ ] Window can be resized/maximized

### **Performance**

- [ ] Smooth drawing (60fps)
- [ ] No lag when switching tools
- [ ] Fast undo/redo
- [ ] Quick page switching

### **Integration**

- [ ] App has proper window title
- [ ] App icon displays correctly
- [ ] System notifications work (if used)
- [ ] Keyboard shortcuts work

---

## 🐛 Troubleshooting Tests

### **Test 1: Check Electron Installation**

```powershell
cd C:\Users\amanr\EDP_APP\EDP_APP
npm list electron
```

Should show:

```
└── electron@28.1.0
```

### **Test 2: Check if Electron Runs**

```powershell
npm run electron
```

If it says "Cannot find module 'electron'":

```powershell
npm install electron --save-dev
```

### **Test 3: Check if React Build Exists**

```powershell
# Check if dist folder exists
dir dist

# If not, build it:
npm run build
```

### **Test 4: Test Electron Main Process**

```powershell
# Run electron directly
npx electron .
```

### **Test 5: Check Preload Script**

Open DevTools in Electron app (Ctrl+Shift+I), then in Console:

```javascript
// Should return true
console.log("Is Electron:", window.electronAPI?.isElectron);

// Should return 'win32', 'linux', 'darwin'
console.log("Platform:", window.electronAPI?.platform);

// Should show available APIs
console.log("API:", Object.keys(window.electronAPI));
```

---

## 📝 Test Report Template

After testing, document results:

```
# Chanakya Paint Test Report

**Date:** [Date]
**Platform:** [Windows 11 / Raspberry Pi OS]
**Device:** [PC / Raspberry Pi 5]

## Installation
- [ ] Dependencies installed successfully
- [ ] App built without errors
- [ ] Electron launched successfully

## Core Features
- [ ] Drawing tools: PASS/FAIL
- [ ] Colors: PASS/FAIL
- [ ] Undo/Redo: PASS/FAIL
- [ ] Save/Load: PASS/FAIL

## Native Features
- [ ] Native file dialogs: PASS/FAIL
- [ ] Fullscreen mode: PASS/FAIL
- [ ] Window controls: PASS/FAIL

## Performance
- [ ] Drawing latency: [ms]
- [ ] Memory usage: [MB]
- [ ] CPU usage: [%]

## Issues Found
1. [Issue description]
2. [Issue description]

## Notes
[Any additional observations]
```

---

## 🎯 Recommended Testing Flow

### **Day 1: Windows Development**

1. ✅ Install dependencies
2. ✅ Run `npm run electron:dev`
3. ✅ Test all features
4. ✅ Fix any bugs
5. ✅ Test native file dialogs
6. ✅ Verify all tools work

### **Day 2: Build Testing**

1. ✅ Run `npm run build`
2. ✅ Run `npm run electron` (production mode)
3. ✅ Test performance
4. ✅ Check for production bugs
5. ✅ Build package: `npm run electron:build`

### **Day 3: Raspberry Pi Testing**

1. ✅ Transfer to Raspberry Pi
2. ✅ Run setup script
3. ✅ Test installation
4. ✅ Test all features on Pi
5. ✅ Test with touchscreen
6. ✅ Monitor performance

---

## 🚀 Quick Start Commands

### **Windows Testing**

```powershell
# Navigate to project
cd C:\Users\amanr\EDP_APP\EDP_APP

# Install (first time only)
npm install

# Test in development mode (with hot reload)
npm run electron:dev

# Test production build
npm run build
npm run electron

# Build distributable
npm run electron:build
```

### **Raspberry Pi Testing**

```bash
# One-line setup
cd ~/EDP_APP && chmod +x setup-electron-pi.sh && ./setup-electron-pi.sh

# Launch
~/launch-chanakya.sh

# Or test development
npm run electron:dev
```

---

## 📹 Visual Testing

### **What to Look For**

1. **Window Opens** ✅

   - Electron window should open automatically
   - Should show "Chanakya Paint" in title bar
   - Should load your React app

2. **Native Dialogs** ✅

   - Click Save → Should show Windows/Linux save dialog
   - Click Open → Should show Windows/Linux open dialog
   - NOT browser download/upload prompts!

3. **DevTools** (Development Mode)
   - Should auto-open in dev mode
   - Console should show "Electron preload script loaded"
   - No red errors

---

## 🎬 Next Steps After Testing

### **If Tests Pass on Windows:**

```powershell
# Build for all platforms
npm run electron:build

# Check the 'release' folder for packages
dir release
```

### **If Tests Pass on Raspberry Pi:**

```bash
# Build distributable
npm run electron:build:pi64

# Share the .deb file
# Found in: release/chanakya-paint-arm64.deb
```

### **If Tests Fail:**

1. Check console for errors
2. Verify all files are present
3. Ensure dependencies are installed
4. See ELECTRON_APP_GUIDE.md for troubleshooting

---

## 💡 Pro Tips

1. **Always test in dev mode first** - faster iteration
2. **Test native dialogs specifically** - main benefit of Electron
3. **Test on Windows before Pi** - faster development cycle
4. **Check performance on Pi** - ensure smooth on target device
5. **Test with real content** - import images, create drawings

---

## ✅ Success Criteria

Your app is working correctly if:

✅ Electron window opens without errors  
✅ All drawing tools function properly  
✅ Native save dialog appears (not download)  
✅ Native open dialog appears (not file input)  
✅ Can save files to chosen location  
✅ Can open files from any location  
✅ Performance is smooth (60fps drawing)  
✅ No console errors  
✅ All keyboard shortcuts work

---

**Start testing now:**

```powershell
cd C:\Users\amanr\EDP_APP\EDP_APP
npm install
npm run electron:dev
```

Your app should open in 10-20 seconds! 🚀
