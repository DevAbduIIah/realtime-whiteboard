# Real-Time Collaborative Whiteboard

A modern, real-time collaborative whiteboard application where multiple users can join rooms and draw together live. Built as a portfolio-quality full-stack project demonstrating real-time systems, WebSocket communication, and interactive canvas drawing.

![Whiteboard Preview](https://via.placeholder.com/800x400?text=Collaborative+Whiteboard)

## Features

### Core Collaboration

- **Room-based Collaboration** - Create or join rooms with unique codes
- **Real-time Drawing** - See others' strokes appear instantly
- **Live Cursor Presence** - Track collaborators' cursor positions with presence status indicators (online, drawing, idle)
- **Late Join Sync** - New users see the complete canvas state
- **Auto-reconnection** - Seamless reconnection with room state restoration

### Drawing Tools

- **Brush & Eraser** - Free-form drawing with multiple sizes
- **Shape Tools** - Rectangle, circle, line, and arrow with preview
- **Text Tool** - Add text elements anywhere on the canvas
- **Sticky Notes** - Create colorful sticky notes for annotations
- **Select Tool** - Select and manipulate elements (coming soon)
- **Color Palette** - 9 vibrant colors to choose from
- **Size Options** - 5 brush sizes (2px to 20px)

### History & Persistence

- **Undo/Redo** - Full history management (up to 50 actions)
- **Board Persistence** - Automatic saving to JSON file storage
- **Deduplication** - Intelligent event handling prevents duplicate strokes

### Sharing & Export

- **Share Links** - Copy shareable room links instantly
- **Export as PNG** - Download canvas as high-quality image
- **Export as JSON** - Save complete board state
- **Import JSON** - Load previously saved boards

### User Experience

- **Keyboard Shortcuts** - Quick access to all tools (B, E, R, O, L, A, T, S, V)
- **Responsive Design** - Works on desktop and tablet screens
- **Loading States** - Visual feedback for async operations
- **Empty State** - Helpful guidance when canvas is blank
- **Clear Confirmation** - Prevents accidental data loss
- **Toast Notifications** - Smooth feedback for actions
- **Grid Background** - Subtle dot grid for better spatial awareness

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
│   │       ├── export.ts   # Export/import utilities
│   │       ├── socket.ts   # Socket configuration
│   │       ├── throttle.ts
│   │       └── userColors.ts
│   └── package.json
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── index.ts        # Express + Socket.IO setup
│   │   ├── socket/         # Socket event handlers
│   │   │   └── handlers.ts
│   │   ├── storage/        # Persistence layer
│   │   │   └── boardStore.ts
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
- Display remote users' strokes and cursors with presence indicators
- Handle room join/leave flow
- Undo/redo history management (client-side)
- Export/import board data
- Generate shareable links

### Server Responsibilities

- Manage Socket.IO connections and rooms
- Store room state (strokes, elements, users) in memory
- Persist boards to JSON file storage with debounced writes
- Broadcast drawing and element events to room participants
- Send full canvas state to late joiners
- Handle user connect/disconnect lifecycle
- Deduplicate events to prevent race conditions

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

| Event              | Direction       | Payload                | Description                        |
| ------------------ | --------------- | ---------------------- | ---------------------------------- |
| `room:join`        | Client → Server | `{ roomId, userName }` | Join a room                        |
| `room:joined`      | Server → Client | `{ user, roomState }`  | Confirm join with full state       |
| `room:user-joined` | Server → Room   | `user`                 | Notify others of new user          |
| `room:user-left`   | Server → Room   | `userId`               | Notify others of user leaving      |
| `draw:stroke`      | Bidirectional   | `{ stroke }`           | New drawing stroke                 |
| `draw:clear`       | Bidirectional   | -                      | Clear canvas                       |
| `element:add`      | Bidirectional   | `{ element }`          | Add element (text, sticky, shape)  |
| `element:update`   | Bidirectional   | `{ id, updates }`      | Update existing element            |
| `element:delete`   | Bidirectional   | `{ id }`               | Delete element                     |
| `cursor:move`      | Client → Server | `{ x, y, status }`     | Cursor position with status update |
| `cursor:update`    | Server → Room   | `cursor`               | Broadcast cursor to others         |

## Keyboard Shortcuts

| Shortcut           | Action             |
| ------------------ | ------------------ |
| `V`                | Select tool        |
| `B`                | Brush              |
| `E`                | Eraser             |
| `R`                | Rectangle          |
| `O`                | Circle (Oval)      |
| `L`                | Line               |
| `A`                | Arrow              |
| `T`                | Text               |
| `S`                | Sticky note        |
| `Ctrl/Cmd + Z`     | Undo               |
| `Ctrl/Cmd + Y`     | Redo               |
| `Ctrl + Shift + Z` | Redo (alternative) |

## Core Requirements Checklist

- [x] Room-based collaboration with room codes
- [x] User identity with display names
- [x] Shared live drawing synced across users
- [x] Live cursor presence with name labels and status indicators
- [x] Toolbar: brush, eraser, colors, sizes, clear
- [x] Shape tools: rectangle, circle, line, arrow
- [x] Text and sticky note elements
- [x] Late join synchronization
- [x] Connection lifecycle handling with auto-reconnect
- [x] Undo/redo with 50-action history
- [x] Board persistence to JSON file storage
- [x] Export as PNG and JSON
- [x] Import from JSON
- [x] Share room links
- [x] Keyboard shortcuts for all tools
- [x] Polished, responsive UI
- [x] Clean architecture with separation of concerns
- [x] Runnable local setup

## Future Enhancements

- Element selection and manipulation (drag, resize, delete)
- Database integration (PostgreSQL/MongoDB)
- User authentication and private boards
- Board templates and backgrounds
- Touch/stylus support for tablets
- Real-time video/audio chat
- Layer management
- Advanced text formatting
- Collaborative cursors with typing indicators

## License

MIT
