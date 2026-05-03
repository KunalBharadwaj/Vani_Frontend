# 🎨 Chanakya Paint App - Quick Reference Card

## 📦 Installation Commands

```bash
# One-line complete setup
cd ~ && git clone https://github.com/raghuwanshi313/EDP_APP.git && cd EDP_APP && chmod +x *.sh && ./complete-pi5-setup.sh

# Manual setup
git clone https://github.com/raghuwanshi313/EDP_APP.git
cd EDP_APP
npm install
npm run build
```

---

## 🚀 Launch Commands

```bash
# Start app manually
~/launch-chanakya.sh

# Start server only
cd ~/EDP_APP && npm run preview

# Access from browser
chromium-browser http://localhost:4173

# Network access
http://<raspberry-pi-ip>:4173
```

---

## ⌨️ Keyboard Shortcuts

| Key      | Action      | Key      | Action    |
| -------- | ----------- | -------- | --------- |
| `P`      | Pencil      | `E`      | Eraser    |
| `H`      | Highlighter | `R`      | Rectangle |
| `C`      | Circle      | `L`      | Line      |
| `G`      | Fill Bucket | `Delete` | Clear     |
| `Ctrl+Z` | Undo        | `Ctrl+Y` | Redo      |
| `Ctrl+S` | Save        | `Esc`    | Exit Tool |

---

## 🔧 Maintenance Commands

```bash
# Update app
cd ~/EDP_APP && git pull && npm install && npm run build

# Restart app
pkill -f "vite preview" && ~/launch-chanakya.sh

# Check status
ps aux | grep "vite preview"
ps aux | grep chromium

# View logs
journalctl -xe
npm run preview 2>&1 | tee ~/chanakya.log

# Monitor performance
~/EDP_APP/monitor-performance.sh

# Troubleshoot issues
~/EDP_APP/troubleshoot.sh
```

---

## 🐛 Common Issues & Fixes

### **App won't start**

```bash
# Check Node.js version (need 18+)
node --version

# Reinstall dependencies
cd ~/EDP_APP
rm -rf node_modules package-lock.json
npm install
npm run build
```

### **Port already in use**

```bash
# Kill existing process
pkill -f "vite preview"
pkill -f chromium-browser

# Or use different port
npm run preview -- --port 8080
```

### **Slow performance**

```bash
# Check temperature
vcgencmd measure_temp

# Check GPU memory
vcgencmd get_mem gpu

# Optimize GPU (add to /boot/firmware/config.txt)
gpu_mem=256
dtoverlay=vc4-kms-v3d
```

### **Storage full**

```bash
# Clean package cache
sudo apt clean

# Remove old logs
rm -rf ~/.local/share/Trash/*

# Find large files
du -ah ~ | sort -rh | head -20
```

### **Touch screen not working**

```bash
# Install drivers
sudo apt install -y xserver-xorg-input-evdev

# Calibrate
sudo apt install -y xinput-calibrator
xinput_calibrator
```

---

## 📁 Important File Locations

```bash
# App directory
~/EDP_APP/

# Drawings storage (browser IndexedDB)
~/.config/chromium/

# Downloaded files
~/Downloads/

# Chanakya documents
~/Documents/Chanakya/

# Launch script
~/launch-chanakya.sh

# Configuration
/boot/firmware/config.txt
~/.config/autostart/chanakya.desktop
```

---

## 🌐 Network Access

```bash
# Find Raspberry Pi IP
hostname -I

# Access from other devices
http://<pi-ip>:4173

# Enable SSH (for remote access)
sudo systemctl enable ssh
sudo systemctl start ssh
```

---

## 💾 Backup & Restore

```bash
# Backup drawings (export from browser)
# In app: Gallery → Select → Download

# Backup app directory
tar -czf ~/chanakya-backup-$(date +%Y%m%d).tar.gz ~/EDP_APP

# Restore
tar -xzf ~/chanakya-backup-YYYYMMDD.tar.gz -C ~/
```

---

## ⚡ Performance Optimization

```bash
# Check current settings
vcgencmd measure_temp      # Temperature
vcgencmd measure_clock arm # CPU frequency
vcgencmd get_throttled     # Throttling status
free -h                    # Memory usage

# Optimize swap
sudo apt install -y zram-tools
sudo systemctl restart zramswap

# Disable unnecessary services
sudo systemctl disable bluetooth
sudo systemctl disable avahi-daemon
```

---

## 🎯 System Information

```bash
# Raspberry Pi model
cat /proc/cpuinfo | grep "Model"

# OS version
cat /etc/os-release

# Memory
free -h

# Disk space
df -h

# CPU info
lscpu

# GPU memory
vcgencmd get_mem gpu

# Temperature
vcgencmd measure_temp

# Complete info
~/EDP_APP/troubleshoot.sh
```

---

## 🔄 Auto-start Configuration

```bash
# Enable auto-start
./autostart-setup.sh

# Manual configuration
nano ~/.config/lxsession/LXDE-pi/autostart

# Add this line:
@/bin/bash /home/pi/launch-chanakya.sh

# Disable auto-start
rm ~/.config/autostart/chanakya.desktop
```

---

## 🎨 App Features Checklist

- [x] Drawing tools (Pencil, Eraser, Highlighter)
- [x] Shapes (Rectangle, Circle, Line)
- [x] Fill bucket with flood fill
- [x] 24 preset colors + custom picker
- [x] Adjustable brush size (1-100px)
- [x] Multi-page support
- [x] Undo/Redo history
- [x] Image import (JPG, PNG)
- [x] Background color change
- [x] Portrait/Landscape mode
- [x] Maximize/Minimize canvas
- [x] Save to gallery
- [x] Download PNG files
- [x] PDF viewer
- [x] PDF annotation
- [x] Touch screen support
- [x] Keyboard shortcuts
- [x] Offline mode
- [x] Cloud sync (optional)

---

## 📞 Support Resources

```bash
# View documentation
cat ~/EDP_APP/README.md
cat ~/EDP_APP/RASPBERRY_PI_5_GUIDE.md
cat ~/EDP_APP/OFFLINE_MODE.md

# Run diagnostics
~/EDP_APP/troubleshoot.sh

# Monitor performance
~/EDP_APP/monitor-performance.sh

# Check logs
journalctl -u lightdm -xe
```

---

## 🔒 Security Settings

```bash
# Change default password
passwd

# Enable firewall
sudo apt install -y ufw
sudo ufw enable
sudo ufw allow from 192.168.1.0/24  # Local network

# Disable VNC if not needed
sudo systemctl disable vncserver-x11-serviced

# Update system
sudo apt update && sudo apt upgrade -y
```

---

## ⚙️ Advanced Settings

### **Overclock (with cooling)**

Edit `/boot/firmware/config.txt`:

```ini
over_voltage=2
arm_freq=2400
```

### **Custom resolution**

```ini
hdmi_group=2
hdmi_mode=82  # 1920x1080 60Hz
```

### **Disable screen blanking**

Add to `~/.config/lxsession/LXDE-pi/autostart`:

```bash
@xset s noblank
@xset s off
@xset -dpms
```

---

## 📊 Expected Performance

| Metric              | Value         |
| ------------------- | ------------- |
| Startup time        | 2-3 seconds   |
| Drawing latency     | <16ms (60fps) |
| Memory usage        | 150-300MB     |
| CPU usage           | 15-30% idle   |
| Storage per drawing | 50-500KB      |

---

## 🎓 Educational Use

**Perfect for:**

- Digital art classes
- Math/science annotations
- Drawing exercises
- PDF note-taking
- Interactive whiteboards
- Student projects
- Touchscreen kiosks

---

## ✅ Pre-flight Checklist

Before deployment:

- [ ] Raspberry Pi 5 with adequate cooling
- [ ] GPU memory set to 256MB
- [ ] Node.js 18+ installed
- [ ] App built for production
- [ ] Storage folders created
- [ ] Touchscreen calibrated
- [ ] Auto-start configured (if needed)
- [ ] Network configured
- [ ] Backup strategy in place
- [ ] Tested all features

---

**Ready to paint! 🎨**

For detailed information, see: `RASPBERRY_PI_5_GUIDE.md`
