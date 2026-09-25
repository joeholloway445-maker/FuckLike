# local-swap

FuckLike workstation worker. Wraps official FaceFusion on the owner's RTX 5080.

Antigravity / any agent: implement this folder per `docs/FACE_SWAP_LOCAL.md`. This README is the human runbook once the scripts exist.

## Status

Scaffold + spec landed 2026-09-25. Install scripts, wrapper, and API are the current build task.

## Target runbook (fill in real pins while implementing)

```powershell
# Windows 11 + RTX 5080
cd local-swap
.\\install_windows.ps1
python api.py
```

```bash
# Linux + RTX 5080
cd local-swap
bash install_linux.sh
python api.py
```

Health check: `http://127.0.0.1:8765/health`

Then open `web/` and use Swap.

## Rules

- Official FaceFusion only: https://github.com/facefusion/facefusion
- Media stays on this machine.
- Only faces you own or have explicit permission to use.
