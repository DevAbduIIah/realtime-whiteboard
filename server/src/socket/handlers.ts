import { Server, Socket } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  User,
  DrawStroke,
  RoomState,
} from '../types/index.js';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

const rooms = new Map<string, RoomState>();
const userSockets = new Map<string, User>();

function getOrCreateRoom(roomId: string): RoomState {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { strokes: [], users: [] });
  }
  return rooms.get(roomId)!;
}

export function setupSocketHandlers(io: TypedServer): void {
  io.on('connection', (socket: TypedSocket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('room:join', ({ roomId, userName }) => {
      const user: User = {
        id: socket.id,
        name: userName,
        roomId,
      };

      userSockets.set(socket.id, user);

      socket.join(roomId);

      const roomState = getOrCreateRoom(roomId);
      roomState.users.push(user);

      socket.emit('room:joined', { user, roomState });

      socket.to(roomId).emit('room:user-joined', user);

      console.log(`${userName} joined room: ${roomId}`);
    });

    socket.on('room:leave', () => {
      handleUserLeave(socket, io);
    });

    socket.on('draw:stroke', ({ stroke }) => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (roomState) {
        roomState.strokes.push(stroke);
      }

      socket.to(user.roomId).emit('draw:stroke', stroke);
    });

    socket.on('draw:clear', () => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (roomState) {
        roomState.strokes = [];
      }

      socket.to(user.roomId).emit('draw:clear');
    });

    socket.on('cursor:move', ({ x, y }) => {
      const user = userSockets.get(socket.id);
      if (!user) return;

      socket.to(user.roomId).emit('cursor:update', {
        x,
        y,
        userId: user.id,
        userName: user.name,
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

    if (roomState.users.length === 0) {
      rooms.delete(user.roomId);
    }
  }

  socket.to(user.roomId).emit('room:user-left', user.id);
  socket.to(user.roomId).emit('cursor:remove', user.id);

  socket.leave(user.roomId);
  userSockets.delete(socket.id);
}
