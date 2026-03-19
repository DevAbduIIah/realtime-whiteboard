# Real-Time Collaborative Whiteboard

A modern, real-time collaborative whiteboard application where multiple users can join rooms and draw together live. Built as a portfolio-quality full-stack project demonstrating real-time systems, WebSocket communication, and interactive canvas drawing.

## Features

- **Room-based Collaboration** - Create or join rooms with unique codes
- **Real-time Drawing** - See others' strokes appear instantly
- **Live Cursor Presence** - Track collaborators' cursor positions with name labels
- **Drawing Tools** - Brush, eraser, color palette, and brush sizes
- **Late Join Sync** - New users see the complete canvas state
- **Clean UI** - Professional, responsive design with visual feedback

## Tech Stack

| Layer      | Technology            | Purpose                                |
| ---------- | --------------------- | -------------------------------------- |
| Frontend   | React 18 + TypeScript | Component architecture, type safety    |
| Build Tool | Vite                  | Fast HMR, modern bundling              |
| Styling    | Tailwind CSS          | Utility-first, responsive design       |
| Backend    | Node.js + Express     | API server, static hosting             |
| Real-time  | Socket.IO             | WebSocket with fallbacks, room support |
| Canvas     | HTML5 Canvas API      | High-performance drawing               |

## Project Structure

```
collaborative-whiteboard/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   │   ├── Canvas.tsx
│   │   │   ├── JoinScreen.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   └── Whiteboard.tsx
│   │   ├── contexts/       # React context providers
│   │   │   └── SocketContext.tsx
│   │   ├── hooks/          # Custom React hooks
│   │   │   └── useCanvasDrawing.ts
│   │   ├── types/          # TypeScript definitions
│   │   └── utils/          # Utility functions
│   └── package.json
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── index.ts        # Express + Socket.IO setup
│   │   ├── socket/         # Socket event handlers
│   │   │   └── handlers.ts
│   │   └── types/          # Shared type definitions
│   └── package.json
└── package.json            # Root workspace scripts
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd collaborative-whiteboard

# Install all dependencies (root, client, and server)
npm run install:all
```

### Development

```bash
# Start both client and server in development mode
npm run dev

# Or run them separately:
npm run dev:client  # Starts Vite dev server on http://localhost:5173
npm run dev:server  # Starts Node.js server on http://localhost:3001
```

### Production Build

```bash
# Build the client
npm run build

# Start the server
npm start
```

## Architecture

### Client Responsibilities

- Render the canvas and handle drawing input
- Manage local drawing state and tool selection
- Connect to server and emit/receive socket events
- Display remote users' strokes and cursors
- Handle room join/leave flow

### Server Responsibilities

- Manage Socket.IO connections and rooms
- Store room state (strokes, users) in memory
- Broadcast drawing events to room participants
- Send full canvas state to late joiners
- Handle user connect/disconnect lifecycle

### Real-time Event Flow

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│   User A    │                    │   Server    │                    │   User B    │
└──────┬──────┘                    └──────┬──────┘                    └──────┬──────┘
       │                                  │                                  │
       │  room:join (roomId, name)        │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │  room:joined (user, roomState)   │                                  │
       │<─────────────────────────────────│                                  │
       │                                  │                                  │
       │                                  │  room:user-joined (user)         │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │  draw:stroke (stroke)            │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │  draw:stroke (stroke)            │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │  cursor:move (x, y)              │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │  cursor:update (cursor)          │
       │                                  │─────────────────────────────────>│
```

## Socket Events

| Event              | Direction       | Payload                | Description                   |
| ------------------ | --------------- | ---------------------- | ----------------------------- |
| `room:join`        | Client → Server | `{ roomId, userName }` | Join a room                   |
| `room:joined`      | Server → Client | `{ user, roomState }`  | Confirm join with full state  |
| `room:user-joined` | Server → Room   | `user`                 | Notify others of new user     |
| `room:user-left`   | Server → Room   | `userId`               | Notify others of user leaving |
| `draw:stroke`      | Bidirectional   | `{ stroke }`           | New drawing stroke            |
| `draw:clear`       | Bidirectional   | -                      | Clear canvas                  |
| `cursor:move`      | Client → Server | `{ x, y }`             | Cursor position update        |
| `cursor:update`    | Server → Room   | `cursor`               | Broadcast cursor to others    |

## Core Requirements Checklist

- [x] Room-based collaboration with room codes
- [x] User identity with display names
- [x] Shared live drawing synced across users
- [x] Live cursor presence with name labels
- [x] Toolbar: brush, eraser, colors, sizes, clear
- [x] Late join synchronization
- [x] Connection lifecycle handling
- [x] Polished, responsive UI
- [x] Clean architecture with separation of concerns
- [x] Runnable local setup

## Future Improvements

- Persistent storage (Redis/database)
- Undo/redo functionality
- Shape tools (rectangle, circle, line)
- Export canvas as image
- User authentication
- Touch/stylus support for tablets
