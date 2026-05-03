#!/bin/bash

# Chanakya Paint - Native Electron App Setup for Raspberry Pi 5
# This script sets up the native desktop application (not web app)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}=========================================="
echo "   Chanakya Paint"
echo "   Native Desktop App Setup"
echo "   Raspberry Pi 5"
echo "==========================================${NC}"
echo ""

print_step() {
    echo ""
    echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}${BOLD}$1${NC}"
    echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Step 1: System Update
print_step "Step 1: Updating System"
sudo apt update
sudo apt upgrade -y
print_success "System updated"

# Step 2: Install Dependencies
print_step "Step 2: Installing System Dependencies"

sudo apt install -y \
    curl \
    wget \
    git \
    build-essential \
    libgtk-3-0 \
    libnotify4 \
    libnss3 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    libatspi2.0-0 \
    libdrm2 \
    libgbm1 \
    libxcb-dri3-0 \
    libasound2

print_success "System dependencies installed"

# Step 3: Install Node.js 18+
print_step "Step 3: Installing Node.js 18.x"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        print_success "Node.js $(node -v) already installed"
    else
        echo "Upgrading Node.js to 18.x..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt install -y nodejs
    fi
else
    echo "Installing Node.js 18.x..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
fi

print_success "Node.js $(node -v) installed"
print_success "npm $(npm -v) installed"

# Step 4: Clone/Update App
print_step "Step 4: Setting up Chanakya App"

cd ~

if [ -d "EDP_APP" ]; then
    echo "Updating existing installation..."
    cd EDP_APP
    git pull
    print_success "App updated"
else
    echo "Cloning repository..."
    git clone https://github.com/raghuwanshi313/EDP_APP.git
    cd EDP_APP
    print_success "App cloned"
fi

# Step 5: Install Dependencies
print_step "Step 5: Installing App Dependencies"

npm install
print_success "React dependencies installed"

# Install Electron if not present
if ! npm list electron &> /dev/null; then
    echo "Installing Electron..."
    npm install --save-dev electron electron-builder concurrently wait-on
    print_success "Electron installed"
else
    print_success "Electron already installed"
fi

# Step 6: Build React App
print_step "Step 6: Building React Application"

npm run build
print_success "React app built"

# Step 7: Build Electron App
print_step "Step 7: Building Native Desktop Application"

read -p "Build distributable package (.deb)? This takes 5-10 minutes. (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm run electron:build:pi64
    print_success "Native app built"
    
    if [ -d "release" ]; then
        echo ""
        echo -e "${GREEN}Built packages:${NC}"
        ls -lh release/*.deb release/*.AppImage 2>/dev/null || echo "No packages found"
    fi
else
    print_success "Skipped package build (can run with: npm run electron)"
fi

# Step 8: Create Launch Script
print_step "Step 8: Creating Launch Scripts"

# Development launch script
cat > ~/launch-chanakya-dev.sh << 'EOF'
#!/bin/bash
# Launch Chanakya in development mode

cd ~/EDP_APP
npm run electron:dev
EOF

chmod +x ~/launch-chanakya-dev.sh
print_success "Development launch script: ~/launch-chanakya-dev.sh"

# Production launch script
cat > ~/launch-chanakya.sh << 'EOF'
#!/bin/bash
# Launch Chanakya native app

cd ~/EDP_APP

# Check if built app exists
if [ -d "release/linux-arm64-unpacked" ]; then
    ./release/linux-arm64-unpacked/chanakya-paint --no-sandbox
elif [ -f "/opt/Chanakya Paint/chanakya-paint" ]; then
    /opt/Chanakya\ Paint/chanakya-paint --no-sandbox
else
    # Run from source
    npm run build 2>/dev/null || true
    npm run electron
fi
EOF

chmod +x ~/launch-chanakya.sh
print_success "Production launch script: ~/launch-chanakya.sh"

# Step 9: Install .deb Package (if exists)
print_step "Step 9: Installing Desktop Application"

if [ -f "release/"*".deb" ]; then
    read -p "Install .deb package system-wide? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo dpkg -i release/*.deb
        sudo apt-get install -f -y
        print_success "Desktop application installed"
        print_success "Launch from menu or run: chanakya-paint"
    else
        print_success "Skipped system installation"
    fi
else
    print_success "No .deb package to install (run npm run electron:build:pi64)"
fi

# Step 10: Desktop Entry
print_step "Step 10: Creating Desktop Entry"

mkdir -p ~/.local/share/applications

cat > ~/.local/share/applications/chanakya-paint.desktop << EOF
[Desktop Entry]
Type=Application
Name=Chanakya Paint
Comment=Educational Drawing Application
Exec=$HOME/launch-chanakya.sh
Icon=$HOME/EDP_APP/public/favicon.ico
Terminal=false
Categories=Education;Graphics;
EOF

print_success "Desktop entry created"

# Step 11: Auto-start Configuration
print_step "Step 11: Auto-start Configuration"

read -p "Enable auto-start on boot? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    mkdir -p ~/.config/autostart
    cp ~/.local/share/applications/chanakya-paint.desktop ~/.config/autostart/
    print_success "Auto-start enabled"
else
    print_success "Skipped auto-start"
fi

# Step 12: GPU Optimization
print_step "Step 12: Optimizing GPU Settings"

CONFIG_FILE="/boot/firmware/config.txt"
if [ -f "$CONFIG_FILE" ]; then
    if ! grep -q "gpu_mem=256" "$CONFIG_FILE"; then
        sudo bash -c "echo '' >> $CONFIG_FILE"
        sudo bash -c "echo '# Chanakya Paint - GPU Settings' >> $CONFIG_FILE"
        sudo bash -c "echo 'gpu_mem=256' >> $CONFIG_FILE"
        sudo bash -c "echo 'dtoverlay=vc4-kms-v3d' >> $CONFIG_FILE"
        print_success "GPU settings configured (reboot required)"
    else
        print_success "GPU already configured"
    fi
fi

# Summary
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}   ✓ NATIVE APP SETUP COMPLETE!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BOLD}Launch Options:${NC}"
echo ""
echo "1. ${BOLD}Desktop Icon:${NC}"
echo "   Find 'Chanakya Paint' in application menu"
echo ""
echo "2. ${BOLD}Command Line:${NC}"
echo "   ~/launch-chanakya.sh"
echo ""
echo "3. ${BOLD}Development Mode:${NC}"
echo "   ~/launch-chanakya-dev.sh"
echo ""
echo "4. ${BOLD}If installed system-wide:${NC}"
echo "   chanakya-paint"
echo ""
echo -e "${BOLD}Build Commands:${NC}"
echo ""
echo "   npm run electron:dev          - Development with hot reload"
echo "   npm run electron              - Run production build"
echo "   npm run electron:build:pi64   - Build .deb package"
echo ""
echo -e "${BOLD}Documentation:${NC}"
echo ""
echo "   cat ~/EDP_APP/ELECTRON_APP_GUIDE.md"
echo ""
echo -e "${YELLOW}Note: If GPU settings were changed, reboot for best performance!${NC}"
echo ""
echo -e "${GREEN}Enjoy your native desktop app! 🎨${NC}"
echo ""
