import { io, Socket } from 'socket.io-client';
import type {
  BoardMetadata,
  BoardReaction,
  DrawStroke,
  CursorPosition,
  User,
  RoomState,
  PresenceStatus,
  WhiteboardElement,
} from '../types';

interface BoardStatePayload {
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
}

interface StrokeDeletePayload {
  strokeId: string;
}

interface ReactionPayload {
  reaction: BoardReaction;
}

interface MetadataUpdatePayload {
  updates: Partial<BoardMetadata>;
}

interface ServerToClientEvents {
  'room:joined': (data: { user: User; roomState: RoomState }) => void;
  'room:user-joined': (user: User) => void;
  'room:user-updated': (user: User) => void;
  'room:user-left': (userId: string) => void;
  'draw:stroke': (stroke: DrawStroke) => void;
  'draw:stroke-delete': (strokeId: string) => void;
  'draw:clear': () => void;
  'element:add': (element: WhiteboardElement) => void;
  'element:update': (data: { elementId: string; updates: Partial<WhiteboardElement> }) => void;
  'element:delete': (elementId: string) => void;
  'board:replace': (payload: BoardStatePayload) => void;
  'board:metadata-updated': (metadata: BoardMetadata) => void;
  'cursor:update': (cursor: CursorPosition) => void;
  'cursor:remove': (userId: string) => void;
  'reaction:add': (reaction: BoardReaction) => void;
  error: (message: string) => void;
}

interface ClientToServerEvents {
  'room:join': (payload: { roomId: string; userName: string; clientId: string }) => void;
  'room:leave': () => void;
  'draw:stroke': (payload: { stroke: DrawStroke }) => void;
  'draw:stroke-delete': (payload: StrokeDeletePayload) => void;
  'draw:clear': () => void;
  'element:add': (payload: { element: WhiteboardElement }) => void;
  'element:update': (payload: { elementId: string; updates: Partial<WhiteboardElement> }) => void;
  'element:delete': (payload: { elementId: string }) => void;
  'board:replace': (payload: BoardStatePayload) => void;
  'board:metadata-update': (payload: MetadataUpdatePayload) => void;
  'cursor:move': (payload: { x: number; y: number; status?: PresenceStatus }) => void;
  'reaction:add': (payload: ReactionPayload) => void;
}

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SOCKET_URL = 'http://localhost:3001';

let socket: TypedSocket | null = null;

export function getSocket(): TypedSocket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
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
