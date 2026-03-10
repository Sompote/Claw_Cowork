#!/bin/bash
set -e

echo ""
echo "======================================"
echo "  Claw Cowork — Setup & Start"
echo "======================================"
echo ""

# Move to script directory so it works from anywhere
cd "$(dirname "$0")"

# Install server dependencies
echo "[1/3] Installing server dependencies..."
npm install

# Install client dependencies
echo ""
echo "[2/3] Installing client dependencies..."
npm install --prefix client

# Create .env if missing
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo ""
    echo "[!] Created .env from .env.example — edit it to set ACCESS_TOKEN."
  fi
fi

echo ""
echo "[3/3] Starting Claw Cowork on port ${PORT:-3001}..."
echo ""
npm run dev
