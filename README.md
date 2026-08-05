# FuckLike

Companion platform. Own the stack.

- **Web app** (`web/`) — works offline now: create companions, gallery, chat, settings. Haptics opt-in only.
- **Deploy** (`DEPLOY.md`) — put backend + site live on your Hostinger KVM4.
- **Architecture** (`docs/ARCHITECTURE.md`) — full system including LingBot Infinity + Colab.
- **AI handoff** (`AGENTS.md`) — everything another AI needs to continue without re-deriving the plan.

## Quick test

```bash
cd web && python3 -m http.server 8080
```

Open http://localhost:8080

## Related

Backend: [HDV_Foundation](https://github.com/joeholloway445-maker/HDV_Foundation)
