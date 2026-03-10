#!/bin/bash
# Claw Cowork — Full installer for fresh Ubuntu container
# Usage (inside Docker Ubuntu container):
#   curl -fsSL https://raw.githubusercontent.com/Sompote/Claw_Cowork/master/install.sh | bash
# or after cloning:
#   bash install.sh

set -e

echo ""
echo "============================================="
echo "  Claw Cowork — Full Install"
echo "============================================="
echo ""

# ── 1. System packages ────────────────────────────────────────────────────────
echo "[1/5] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
  curl \
  git \
  wget \
  gnupg \
  ca-certificates \
  build-essential \
  python3 \
  python3-pip \
  python3-venv \
  nano

# ── 2. Python packages ────────────────────────────────────────────────────────
echo ""
echo "[2/5] Installing Python packages..."
pip3 install -q requests pandas numpy matplotlib seaborn scipy fpdf2 python-docx reportlab pillow

# ── 3. Node.js 22 ─────────────────────────────────────────────────────────────
echo ""
echo "[3/5] Installing Node.js 22..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs
else
  echo "      Node.js already installed: $(node --version)"
fi

# ── 4. Clone repository ───────────────────────────────────────────────────────
echo ""
echo "[4/5] Cloning Claw Cowork..."
cd /root
if [ -d "claw_cowork/.git" ]; then
  echo "      Repo already exists, pulling latest..."
  cd claw_cowork
  git pull
else
  git clone https://github.com/Sompote/Claw_Cowork.git claw_cowork
  cd claw_cowork
fi

# ── 5. Install Node dependencies ──────────────────────────────────────────────
echo ""
echo "[5/5] Installing Node dependencies..."
npm install --silent
npm install --prefix client --silent

# ── .env setup ────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    echo "PORT=3001" > .env
  fi
  echo ""
  echo "  [!] .env created. Set your ACCESS_TOKEN:"
  echo "      nano /root/claw_cowork/.env"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo "  Install complete!"
echo "============================================="
echo ""
echo "  To start Claw Cowork:"
echo "    cd /root/claw_cowork && npm run dev"
echo ""
echo "  Or start now? (Ctrl+C to skip)"
echo "  Starting in 5 seconds..."
sleep 5

npm run dev
