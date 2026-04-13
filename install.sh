#!/usr/bin/env bash
set -euo pipefail

# ─── Ray Installer ────────────────────────────────────────────────────────────
# Usage: curl -fsSL https://raw.githubusercontent.com/Bigalan09/Ray/main/install.sh | bash
# Env overrides:
#   RAY_DIR    — install directory (default: ~/ray)
#   RAY_TAG    — image tag to pull   (default: latest)
# ──────────────────────────────────────────────────────────────────────────────

REPO="Bigalan09/Ray"
GHCR_OWNER="bigalan09"
RAW="https://raw.githubusercontent.com/${REPO}/main"
RAY_DIR="${RAY_DIR:-$HOME/ray}"
RAY_TAG="${RAY_TAG:-latest}"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '  \033[34m→\033[0m %s\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()   { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

bold "Ray installer"
echo ""

# ── Prereq checks ──────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install it from https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required. Update Docker Desktop or install the plugin."
command -v curl >/dev/null 2>&1   || die "curl is required."

ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ── Install directory ───────────────────────────────────────────────────────────
if [[ -d "$RAY_DIR" ]]; then
  warn "Directory $RAY_DIR already exists — updating in place"
else
  mkdir -p "$RAY_DIR"
  info "Created $RAY_DIR"
fi

cd "$RAY_DIR"

# ── Download config files from GitHub ──────────────────────────────────────────
info "Fetching docker-compose.yml …"
curl -fsSL "${RAW}/docker-compose.ghcr.yml" -o docker-compose.yml

info "Fetching workspace-template …"
mkdir -p workspace-template config workspace

for f in config/agents.yaml config/models.yaml config/tools.yaml config/skills.yaml \
          config/schedules.yaml config/guardrails.yaml config/SOUL.md config/USER.md \
          config/BOOTSTRAP.md; do
  curl -fsSL "${RAW}/${f}" -o "${f}" 2>/dev/null && info "  ${f}" || warn "  skipped ${f} (not found)"
done

for f in workspace-template/MEMORY.md workspace-template/mcp_servers.json; do
  curl -fsSL "${RAW}/${f}" -o "${f}" 2>/dev/null && info "  ${f}" || warn "  skipped ${f} (not found)"
done

# Copy workspace-template into workspace (don't overwrite existing files)
cp -n workspace-template/* workspace/ 2>/dev/null || true

# ── .env setup ────────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  curl -fsSL "${RAW}/.env.example" -o .env.example
  cp .env.example .env
  echo ""
  bold "Configuration needed"
  echo ""
  echo "  Edit $RAY_DIR/.env and set your OPENAI_API_KEY, then run:"
  echo ""
  echo "    cd $RAY_DIR && docker compose up -d"
  echo ""
  warn ".env created from template — fill it in before starting Ray"
else
  ok ".env already exists — skipping"
fi

# ── Pull images ───────────────────────────────────────────────────────────────
echo ""
info "Pulling Ray images (tag: ${RAY_TAG}) …"
RAY_TAG="${RAY_TAG}" docker compose pull

# ── Start ─────────────────────────────────────────────────────────────────────
if grep -q "OPENAI_API_KEY=your-openai-api-key" .env 2>/dev/null; then
  echo ""
  bold "Next steps"
  echo ""
  echo "  1. Edit $RAY_DIR/.env — set OPENAI_API_KEY"
  echo "  2. Start Ray:"
  echo ""
  echo "     cd $RAY_DIR && docker compose up -d"
  echo ""
  echo "  3. Open http://localhost:3000"
else
  echo ""
  info "Starting Ray …"
  RAY_TAG="${RAY_TAG}" docker compose up -d
  echo ""
  ok "Ray is running at http://localhost:3000"
  echo ""
  echo "  Useful commands:"
  echo "    cd $RAY_DIR"
  echo "    docker compose logs -f          # live logs"
  echo "    docker compose pull && docker compose up -d   # update"
  echo "    docker compose down             # stop"
fi
