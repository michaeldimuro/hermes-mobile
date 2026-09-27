Monorepo: `app/` (Expo app — its rules are in @app/AGENTS.md), `server/` (Hermes plugin, push relay, macOS launcher), `install/` (installers), `website/` (GitHub Pages site), `docs/`.

- App checks run from `app/`: `npm run lint`, `npm run typecheck`, `npm test`.
- Server tests: `uv run --with pytest python -m pytest server/tests`.
- Installers must stay compatible with macOS's bash 3.2 (`install.sh`) and Windows PowerShell 5.1 (`install.ps1`); keep the website's documented options in sync with them.
