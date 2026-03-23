#!/bin/bash
set -e

# =============================================================================
# SapienX Setup Script
#
# Run on a fresh system:
#   curl -fsSL https://raw.githubusercontent.com/LogicalSapien/sapienx/main/scripts/setup.sh | bash
#
# Or if already cloned:
#   bash scripts/setup.sh
# =============================================================================

REPO_URL="https://github.com/LogicalSapien/sapienx.git"
INSTALL_DIR="${SAPIENX_DIR:-$HOME/sapienx}"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       SapienX Setup Script           ║"
echo "╚══════════════════════════════════════╝"
echo ""

# -------------------------------------------
# 1. Check OS
# -------------------------------------------
OS="$(uname -s)"
echo "[1/8] Detected OS: $OS"

# -------------------------------------------
# 2. Install Node.js if missing
# -------------------------------------------
echo ""
echo "[2/8] Checking Node.js..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  echo "  Node.js $NODE_VERSION found."
  # Check minimum version (18+)
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "  WARNING: Node.js 18+ required. You have $NODE_VERSION."
    echo "  Please upgrade: https://nodejs.org/"
    exit 1
  fi
else
  echo "  Node.js not found. Installing..."
  if [ "$OS" = "Linux" ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif [ "$OS" = "Darwin" ]; then
    if command -v brew &> /dev/null; then
      brew install node
    else
      echo "  Please install Node.js: https://nodejs.org/"
      exit 1
    fi
  else
    echo "  Please install Node.js 18+: https://nodejs.org/"
    exit 1
  fi
  echo "  Node.js $(node --version) installed."
fi

# -------------------------------------------
# 3. Install Claude Code CLI if missing
# -------------------------------------------
echo ""
echo "[3/8] Checking Claude Code CLI..."
if command -v claude &> /dev/null; then
  echo "  Claude CLI: $(claude --version 2>&1 | head -1)"
else
  echo "  Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code
  echo "  Claude CLI installed: $(claude --version 2>&1 | head -1)"
fi

# -------------------------------------------
# 4. Authenticate Claude if needed
# -------------------------------------------
echo ""
echo "[4/8] Checking Claude authentication..."
if claude --version &> /dev/null; then
  echo "  Claude CLI is working."
else
  echo "  Claude CLI needs authentication."
  echo "  Running: claude login"
  claude login
fi

# -------------------------------------------
# 5. Clone or update repo
# -------------------------------------------
echo ""
echo "[5/8] Setting up SapienX code..."
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "  SapienX repo found at $INSTALL_DIR. Pulling latest..."
  cd "$INSTALL_DIR"
  git pull origin main
else
  if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]; then
    # Already in the repo (ran from scripts/)
    cd "$INSTALL_DIR"
    echo "  Already in SapienX directory."
  else
    echo "  Cloning SapienX to $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
fi

# -------------------------------------------
# 6. Install dependencies
# -------------------------------------------
echo ""
echo "[6/8] Installing dependencies..."
npm install

# Create data directories
mkdir -p data/session-history
if [ ! -f data/schedules.json ] && [ -f data/schedules.example.json ]; then
  cp data/schedules.example.json data/schedules.json
fi

# -------------------------------------------
# 7. Install pm2 for process management
# -------------------------------------------
echo ""
echo "[7/9] Checking pm2..."
if command -v pm2 &> /dev/null; then
  echo "  pm2 $(pm2 --version) found."
else
  echo "  Installing pm2..."
  if npm install -g pm2 2>/dev/null; then
    echo "  pm2 installed."
  else
    sudo npm install -g pm2 2>/dev/null || echo "  pm2 install failed. Install manually: sudo npm install -g pm2"
  fi
fi

# -------------------------------------------
# 8. Link sapienx command globally
# -------------------------------------------
echo ""
echo "[8/9] Linking sapienx command..."
if npm link 2>/dev/null; then
  echo "  'sapienx' command available globally."
else
  echo "  npm link needs sudo on Linux..."
  sudo npm link 2>/dev/null || echo "  Failed. Run manually: sudo npm link"
fi

# Verify it works
if command -v sapienx &> /dev/null; then
  echo "  $(sapienx version 2>&1 | head -1)"
else
  echo "  sapienx command not in PATH. You can still use: node bin/sapienx"
fi

# -------------------------------------------
# 9. Run interactive configure
# -------------------------------------------
echo ""
echo "[9/9] Running SapienX configuration..."
echo ""
sapienx configure 2>/dev/null || node bin/sapienx configure

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       SapienX Setup Complete!        ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Commands:"
echo "  sapienx start      — Start daemon (WhatsApp in background)"
echo "  sapienx tui        — Interactive terminal chat"
echo "  sapienx status     — Check status"
echo "  sapienx logs       — View logs"
echo "  sapienx configure  — Reconfigure settings"
echo "  sapienx stop       — Stop daemon"
echo "  sapienx restart    — Restart daemon"
echo "  sapienx upgrade    — Update to latest version"
echo ""
echo "Install dir: $INSTALL_DIR"
echo ""
