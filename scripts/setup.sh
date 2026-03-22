#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== SapienX First-Run Setup ==="
echo ""

cd "$PROJECT_DIR"

# Generate .env from .env.example
if [ ! -f .env ]; then
  echo "Setting up .env file..."
  cp .env.example .env

  read -p "Owner WhatsApp phone (with country code, no +): " owner_phone
  sed -i.bak "s/^OWNER_PHONE=.*/OWNER_PHONE=$owner_phone/" .env

  read -p "Owner name: " owner_name
  sed -i.bak "s/^OWNER_NAME=.*/OWNER_NAME=$owner_name/" .env

  read -p "Anthropic API key (leave blank if using claude login): " api_key
  if [ -n "$api_key" ]; then
    sed -i.bak "s/^ANTHROPIC_API_KEY=.*/ANTHROPIC_API_KEY=$api_key/" .env
  fi

  rm -f .env.bak
  echo ".env created."
else
  echo ".env already exists, skipping."
fi

# Install npm dependencies
echo ""
echo "Installing dependencies..."
npm install

# Copy schedules example if needed
if [ ! -f data/schedules.json ]; then
  mkdir -p data/session-history
  cp data/schedules.example.json data/schedules.json
  echo "Created data/schedules.json from template."
fi

# Check Claude CLI
echo ""
if command -v claude &> /dev/null; then
  echo "Claude CLI: $(claude --version 2>&1 | head -1)"
else
  echo "Claude CLI not found. Installing..."
  npm install -g @anthropic-ai/claude-code
  echo "Claude CLI installed."
fi

# Verify claude auth
echo ""
echo "Verifying Claude CLI authentication..."
if claude --version &> /dev/null; then
  echo "Claude CLI is working."
else
  echo "Claude CLI may need authentication."
  echo "Run: claude login"
fi

# Link sapienx globally
echo ""
echo "Linking sapienx command..."
npm link 2>/dev/null || echo "npm link failed (may need sudo on Linux). Run: sudo npm link"

# Mark ready
touch .sapienx-ready
echo ""
echo "=== SapienX setup complete! ==="
echo ""
echo "Next steps:"
echo "  sapienx tui      — Start TUI mode"
echo "  sapienx start    — Start daemon with WhatsApp"
echo "  sapienx health   — Check system health"
