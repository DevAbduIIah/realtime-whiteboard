import { io, Socket } from 'socket.io-client';
import type { DrawStroke, CursorPosition, User, RoomState } from '../types';

interface ServerToClientEvents {
  'room:joined': (data: { user: User; roomState: RoomState }) => void;
  'room:user-joined': (user: User) => void;
  'room:user-left': (userId: string) => void;
  'draw:stroke': (stroke: DrawStroke) => void;
  'draw:clear': () => void;
  'cursor:update': (cursor: CursorPosition) => void;
  'cursor:remove': (userId: string) => void;
  error: (message: string) => void;
}

interface ClientToServerEvents {
  'room:join': (payload: { roomId: string; userName: string }) => void;
  'room:leave': () => void;
  'draw:stroke': (payload: { stroke: DrawStroke }) => void;
  'draw:clear': () => void;
  'cursor:move': (payload: { x: number; y: number }) => void;
}

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SOCKET_URL = 'http://localhost:3001';

let socket: TypedSocket | null = null;

export function getSocket(): TypedSocket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function connectSocket(): void {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
}

export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}
