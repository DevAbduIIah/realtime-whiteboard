import { Server, Socket } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  User,
  DrawStroke,
  RoomState,
  WhiteboardElement,
} from '../types/index.js';
import { getOrCreateBoard, updateBoardContent } from '../storage/boardStore.js';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

interface ExtendedRoomState extends RoomState {
  strokeIds: Set<string>;
  elementIds: Set<string>;
  lastActivity: number;
  saveTimeout: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, ExtendedRoomState>();
const userSockets = new Map<string, User>();

// Room cleanup grace period (5 minutes)
const ROOM_CLEANUP_DELAY = 5 * 60 * 1000;
// Debounce save delay
const SAVE_DELAY = 2000;

function saveRoomToStorage(roomId: string, roomState: ExtendedRoomState): void {
  if (roomState.saveTimeout) {
    clearTimeout(roomState.saveTimeout);
  }
  roomState.saveTimeout = setTimeout(() => {
    updateBoardContent(roomId, roomState.strokes, roomState.elements);
    roomState.saveTimeout = null;
    console.log(`Saved board: ${roomId}`);
  }, SAVE_DELAY);
}

function getOrCreateRoom(roomId: string): ExtendedRoomState {
  if (!rooms.has(roomId)) {
    // Load from persistent storage
    const board = getOrCreateBoard(roomId);

    rooms.set(roomId, {
      strokes: board.strokes || [],
      elements: board.elements || [],
      users: [],
      strokeIds: new Set((board.strokes || []).map(s => s.id)),
      elementIds: new Set((board.elements || []).map(e => e.id)),
      lastActivity: Date.now(),
      saveTimeout: null,
    });
  }
  const room = rooms.get(roomId)!;
  room.lastActivity = Date.now();
  return room;
}

// Periodically clean up old empty rooms and save to storage
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.users.length === 0 && now - room.lastActivity > ROOM_CLEANUP_DELAY) {
      // Save before cleanup
      if (room.saveTimeout) {
        clearTimeout(room.saveTimeout);
      }
      updateBoardContent(roomId, room.strokes, room.elements);
      rooms.delete(roomId);
      console.log(`Cleaned up and saved inactive room: ${roomId}`);
    }
  }
}, 60000);

export function setupSocketHandlers(io: TypedServer): void {
  io.on('connection', (socket: TypedSocket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('room:join', ({ roomId, userName }) => {
      // Handle case where user is already in the room (reconnect scenario)
      const existingUser = userSockets.get(socket.id);
      if (existingUser) {
        handleUserLeave(socket, io);
      }

      const user: User = {
        id: socket.id,
        name: userName,
        roomId,
      };

      userSockets.set(socket.id, user);
      socket.join(roomId);

      const roomState = getOrCreateRoom(roomId);

      // Check if user with same name already exists (duplicate check)
      const existingUserIndex = roomState.users.findIndex(u => u.id === socket.id);
      if (existingUserIndex === -1) {
        roomState.users.push(user);
      } else {
        roomState.users[existingUserIndex] = user;
      }

      // Send room state without Set objects (can't serialize)
      socket.emit('room:joined', {
        user,
        roomState: {
          strokes: roomState.strokes,
          elements: roomState.elements,
          users: roomState.users,
        },
      });

      socket.to(roomId).emit('room:user-joined', user);

      console.log(`${userName} joined room: ${roomId} (${roomState.users.length} users)`);
    });

    socket.on('room:leave', () => {
      handleUserLeave(socket, io);
    });

    socket.on('draw:stroke', ({ stroke }) => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;

      // Prevent duplicate strokes
      if (roomState.strokeIds.has(stroke.id)) {
        return;
      }

      roomState.strokeIds.add(stroke.id);
      roomState.strokes.push(stroke);
      roomState.lastActivity = Date.now();

      // Persist to storage
      saveRoomToStorage(user.roomId, roomState);

      socket.to(user.roomId).emit('draw:stroke', stroke);
    });

    socket.on('draw:stroke-delete', ({ strokeId }) => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;

      roomState.strokes = roomState.strokes.filter((stroke) => stroke.id !== strokeId);
      roomState.strokeIds.delete(strokeId);
      roomState.lastActivity = Date.now();

      saveRoomToStorage(user.roomId, roomState);

      socket.to(user.roomId).emit('draw:stroke-delete', strokeId);
    });

    socket.on('draw:clear', () => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (roomState) {
        roomState.strokes = [];
        roomState.elements = [];
        roomState.strokeIds.clear();
        roomState.elementIds.clear();
        roomState.lastActivity = Date.now();

        // Persist to storage
        saveRoomToStorage(user.roomId, roomState);
      }

      socket.to(user.roomId).emit('draw:clear');
    });

    socket.on('element:add', ({ element }) => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;

      // Prevent duplicate elements
      if (roomState.elementIds.has(element.id)) {
        return;
      }

      roomState.elementIds.add(element.id);
      roomState.elements.push(element);
      roomState.lastActivity = Date.now();

      // Persist to storage
      saveRoomToStorage(user.roomId, roomState);

      socket.to(user.roomId).emit('element:add', element);
    });

    socket.on('element:update', ({ elementId, updates }) => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;

      const elementIndex = roomState.elements.findIndex(e => e.id === elementId);
      if (elementIndex !== -1) {
        roomState.elements[elementIndex] = {
          ...roomState.elements[elementIndex],
          ...updates,
        } as WhiteboardElement;
        roomState.lastActivity = Date.now();

        // Persist to storage
        saveRoomToStorage(user.roomId, roomState);
      }

      socket.to(user.roomId).emit('element:update', { elementId, updates });
    });

    socket.on('element:delete', ({ elementId }) => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;

      roomState.elements = roomState.elements.filter(e => e.id !== elementId);
      roomState.elementIds.delete(elementId);
      roomState.lastActivity = Date.now();

      // Persist to storage
      saveRoomToStorage(user.roomId, roomState);

      socket.to(user.roomId).emit('element:delete', elementId);
    });

    socket.on('board:replace', ({ strokes, elements }) => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;

      roomState.strokes = strokes;
      roomState.elements = elements;
      roomState.strokeIds = new Set(strokes.map((stroke) => stroke.id));
      roomState.elementIds = new Set(elements.map((element) => element.id));
      roomState.lastActivity = Date.now();

      saveRoomToStorage(user.roomId, roomState);

      socket.to(user.roomId).emit('board:replace', { strokes, elements });
    });

    socket.on('cursor:move', ({ x, y, status }) => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      socket.to(user.roomId).emit('cursor:update', {
        x,
        y,
        userId: user.id,
        userName: user.name,
        status: status || 'online',
      });
    });

    socket.on('disconnect', () => {
      handleUserLeave(socket, io);
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

function handleUserLeave(socket: TypedSocket, io: TypedServer): void {
  const user = userSockets.get(socket.id);
  if (!user) return;

  const roomState = rooms.get(user.roomId);
  if (roomState) {
    roomState.users = roomState.users.filter((u) => u.id !== user.id);
    roomState.lastActivity = Date.now();
    // Don't delete room immediately - keep for reconnection grace period
  }

  socket.to(user.roomId).emit('room:user-left', user.id);
  socket.to(user.roomId).emit('cursor:remove', user.id);

  socket.leave(user.roomId);
  userSockets.delete(socket.id);
}
