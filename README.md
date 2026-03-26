# Real-Time Collaborative Whiteboard

A collaborative whiteboard built with React, TypeScript, Socket.IO, and the HTML5 Canvas API. Multiple users can join the same room, draw live, manipulate elements, navigate large boards, share links, and work with persistent board state.

## Highlights

### Collaboration

- Room-based collaboration with shareable room codes
- Live drawing sync with late-join state restoration
- Live cursor presence with online, drawing, and idle states
- Participant list with jump-to and follow-collaborator actions
- Quick board reactions and pings
- Connection health, reconnect feedback, and room rejoin handling

### Whiteboard Tools

- Brush and eraser with multiple sizes
- Rectangle, circle, line, and arrow tools
- Text elements and sticky notes
- Fully working select tool
- Single select, multi-select, and marquee selection
- Drag, resize, duplicate, copy, paste, and delete selected elements
- Bring-to-front and send-to-back controls

### Viewport And Canvas

- Zoom in, zoom out, fit-to-screen, and reset zoom controls
- Space-to-pan workflow for larger boards
- Expanded drawing surface for roomier whiteboard sessions
- Pointer-capture drawing so strokes continue cleanly after leaving and re-entering the board

### Board Presentation And Export

- Multiple board backgrounds: dots, grid, plain, blueprint, warm
- Templates: blank, kanban, retrospective
- PNG, SVG, and JSON export
- JSON import
- Exports preserve board presentation and content cleanly

### Persistence And Reliability

- Debounced JSON-file persistence on the server
- Board metadata with title, revision, created/updated timestamps
- Lightweight board snapshots for recovery/version groundwork
- Element normalization and version-aware updates
- Event deduplication for strokes and elements

### Ownership And Privacy Foundation

- Device-persistent local identity foundation
- Board owner assignment on first trusted join
- Public or private board access
- Invite-only private links with access tokens
- Owner-only control for privacy, room mode, and board-wide settings

## Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React 18 + TypeScript | UI, state, typed interaction flows |
| Build Tool | Vite | Fast frontend development and bundling |
| Styling | Tailwind CSS | Responsive styling and UI composition |
| Backend | Node.js + Express | Server and static delivery |
| Real-time | Socket.IO | Room-based multiplayer sync |
| Rendering | HTML5 Canvas API | Whiteboard rendering and interaction |
| Storage | JSON file persistence | Lightweight local persistence layer |

## Project Structure

```text
collaborative-whiteboard/
|-- client/
|   |-- src/
|   |   |-- components/
|   |   |   |-- Canvas.tsx
|   |   |   |-- JoinScreen.tsx
|   |   |   |-- Toolbar.tsx
|   |   |   `-- Whiteboard.tsx
|   |   |-- contexts/
|   |   |   `-- SocketContext.tsx
|   |   |-- hooks/
|   |   |   `-- useCanvasDrawing.ts
|   |   |-- types/
|   |   |   `-- index.ts
|   |   `-- utils/
|   |       |-- auth.ts
|   |       |-- boardPresentation.ts
|   |       |-- export.ts
|   |       |-- presence.ts
|   |       |-- socket.ts
|   |       |-- throttle.ts
|   |       `-- userColors.ts
|   `-- package.json
|-- server/
|   |-- data/
|   |   `-- boards.json
|   |-- src/
|   |   |-- socket/
|   |   |   `-- handlers.ts
|   |   |-- storage/
|   |   |   `-- boardStore.ts
|   |   |-- types/
|   |   |   `-- index.ts
|   |   `-- index.ts
|   `-- package.json
`-- package.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
git clone <repository-url>
cd collaborative-whiteboard
npm run install:all
```

### Development

```bash
npm run dev
```

This starts:

- client on `http://localhost:5173`
- server on `http://localhost:3001`

You can also run them separately:

```bash
npm run dev:client
npm run dev:server
```

### Production Build

```bash
npm run build
npm start
```

The root `build` script now builds both the client and the server.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `V` | Select tool |
| `B` | Brush |
| `E` | Eraser |
| `R` | Rectangle |
| `O` | Circle |
| `L` | Line |
| `A` | Arrow |
| `T` | Text |
| `S` | Sticky note |
| `Esc` | Clear selection or exit reaction mode |
| `Delete` / `Backspace` | Delete selection |
| `Ctrl/Cmd + C` | Copy selection |
| `Ctrl/Cmd + V` | Paste selection |
| `Ctrl/Cmd + D` | Duplicate selection |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Y` | Redo |
| `Ctrl/Cmd + Shift + Z` | Redo alternative |

## Architecture Notes

### Client

- Renders the board and interaction overlays
- Tracks local drawing, selection, viewport, and presence state
- Applies optimistic updates for drawing and element changes
- Handles export/import, sharing, and ownership-aware UI controls

### Server

- Manages room membership and Socket.IO event flow
- Persists board state and metadata to JSON storage
- Deduplicates strokes and elements
- Enforces read-only mode, owner-only board settings, and private-board access

### Ownership Model

This project intentionally uses a minimal ownership foundation instead of a full auth platform:

- each device gets a persistent local `accountId` and `authToken`
- the first trusted joiner becomes the board owner
- private boards require an invite token in the shared link
- board-wide access/mode/theme settings are restricted to the owner

This keeps the system realistic for the current codebase while leaving a clear path to future account-backed auth.

## Core Checklist

- [x] Real-time collaborative drawing
- [x] Working selection and element manipulation
- [x] Viewport zoom and pan
- [x] Multiplayer presence and room health UI
- [x] Shapes, text, sticky notes, and layer ordering controls
- [x] Backgrounds and templates
- [x] PNG, SVG, and JSON export
- [x] JSON import
- [x] Board persistence and metadata
- [x] Read-only mode
- [x] Public/private board foundation
- [x] Responsive desktop/tablet UI

## Future Roadmap

- Replace local device identity with real account auth and sessions
- Move persistence from JSON files to a database-backed model
- Add stronger touch and stylus support, including gesture polish
- Add richer board permissions beyond owner/editor
- Add richer revision history and restore tooling
- Add board browsing, rename flows, and explicit board creation UI
