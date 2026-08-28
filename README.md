# Vani — Real-time Collaborative Notes, PDF & Whiteboard

A multi-user, real-time collaborative workspace: a shared **infinite whiteboard**
and **PDF annotator** with **live audio/video**, and **Chanakya**, an in-app AI
assistant. Open a room link and everyone draws, annotates, talks, and edits the
same document together — with conflict-free sync.

[![React](https://img.shields.io/badge/React-18-61dafb)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646cff)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-38bdf8)](https://tailwindcss.com)
[![Tests](https://img.shields.io/badge/tests-38%20unit%20%2B%204%20e2e-brightgreen)](#-testing--ci)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088ff)](.github/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-green)](#-license)

**🔗 Live demo:** https://vani-frontend.vercel.app &nbsp;·&nbsp; **Backend:** [KunalBharadwaj/Vani_Backend](https://github.com/KunalBharadwaj/Vani_Backend)

> This is the **frontend** (React). The realtime server lives in a separate repo — see [Vani_Backend](https://github.com/KunalBharadwaj/Vani_Backend).

<!-- Tip: add a screenshot or GIF here for extra impact, e.g. ![Vani](docs/demo.gif) -->

---

## Why it's interesting (the hard parts)

- **Conflict-free realtime collaboration** — documents are **Yjs CRDTs** synced over
  a single WebSocket. Concurrent edits from many users merge without conflicts;
  late joiners receive full state and stay consistent via a state-vector diff.
- **A pooled, ref-counted connection layer** — multiple components share **one**
  WebSocket and **one** Y.Doc per room (`hooks/useCollaboration.js`), with
  exponential-backoff reconnect and graceful session-expiry handling.
- **Live audio/video** via Agora, with call signaling ("ring") multiplexed over
  the same collaboration socket.
- **Real auth** — Google OAuth2 → JWT in an httpOnly cookie, a CSRF nonce, and a
  WebSocket auth handshake.
- **AI features** — an assistant chat plus "circle-to-search" (select any region
  of a page and get an AI explanation).

## Features

- 🖊️ Infinite-canvas whiteboard — pencil/highlighter/shapes/fill, pressure-style
  strokes (perfect-freehand), pan/zoom, per-user undo/redo, multi-page.
- 📄 PDF viewing & annotation, shared live with the room.
- 👥 Real-time multiplayer with presence and host/owner roles.
- 🎙️ In-room audio & video calls.
- 🤖 Chanakya AI assistant — chat, reminders, and image-region explanations.
- 🌓 Light/dark theme, installable **PWA**, offline-capable canvas storage (IndexedDB).

## Architecture

The full write-up — system context, the OAuth→JWT→WS auth flow, the CRDT sync
protocol, and a component map (with diagrams) — is in **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

At a glance: React SPA → REST + one WebSocket → Node/TS server (Yjs + LevelDB,
Agora tokens, OAuth). Both editors stay mounted across routes so their canvas
state survives navigation.

## Tech stack

| Area | Tech |
|------|------|
| UI | React 18, Vite, Tailwind CSS, shadcn/ui |
| Realtime | Yjs (CRDT), native WebSocket |
| Media | Agora RTC SDK |
| PDF / canvas | react-pdf, pdf.js, pdf-lib, perfect-freehand, HTML5 Canvas |
| State/data | React Query, IndexedDB |
| Testing | Vitest + Testing Library (unit), Playwright (e2e) |

## 🧪 Testing & CI

Engineering rigor is a first-class concern here, not an afterthought:

- **38 unit tests** (Vitest + jsdom) covering the collaboration/auth logic,
  panel geometry, color/stroke math, IndexedDB storage, and shared components.
- **4 Playwright e2e tests** — auth gating, the assistant panel, and route rendering.
- **CI** (GitHub Actions) runs **lint → unit tests → build** on every push and PR.

```bash
npm test          # unit tests (Vitest)
npm run test:e2e  # end-to-end (Playwright)
npm run lint      # ESLint
```

## Getting started

```bash
npm install
cp .env.example .env     # set VITE_BACKEND_URL (defaults to the deployed backend)
npm run dev              # http://localhost:8080
```

Production build:

```bash
npm run build && npm run preview
```

You'll also need the [backend](https://github.com/KunalBharadwaj/Vani_Backend)
running (locally or the deployed instance) for auth, collaboration, media, and AI.

## Project structure

```
src/
├── components/
│   ├── paint/        # Whiteboard canvas engine + tools
│   ├── pdf/          # PDF viewer/annotator
│   ├── ai/           # Chanakya assistant widget
│   ├── shared/       # Room dashboard, video chat, shared modals
│   └── ui/           # shadcn/ui primitives
├── hooks/
│   └── useCollaboration.js   # pooled WebSocket + Yjs client
├── context/          # Media (Agora) + theme providers
├── services/         # IndexedDB storage + export helpers
├── lib/              # Pure, tested helpers (geometry, color, strokes, panel)
└── pages/
```

## Authors

- **Kunal Bharadwaj** — [@KunalBharadwaj](https://github.com/KunalBharadwaj)
- **Aman Raghuwanshi** — [@raghuwanshi313](https://github.com/raghuwanshi313)

## License

MIT
