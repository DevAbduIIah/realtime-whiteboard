export interface Point {
  x: number;
  y: number;
}

export interface DrawStroke {
  id: string;
  points: Point[];
  color: string;
  size: number;
  tool: 'brush' | 'eraser';
  userId: string;
}

export interface CursorPosition {
  x: number;
  y: number;
  userId: string;
  userName: string;
}

export interface User {
  id: string;
  name: string;
  roomId: string;
}

export interface RoomState {
  strokes: DrawStroke[];
  users: User[];
}

export interface JoinRoomPayload {
  roomId: string;
  userName: string;
}

export interface DrawPayload {
  stroke: DrawStroke;
}

export interface CursorPayload {
  x: number;
  y: number;
}

export interface ServerToClientEvents {
  'room:joined': (data: { user: User; roomState: RoomState }) => void;
  'room:user-joined': (user: User) => void;
  'room:user-left': (userId: string) => void;
  'draw:stroke': (stroke: DrawStroke) => void;
  'draw:clear': () => void;
  'cursor:update': (cursor: CursorPosition) => void;
  'cursor:remove': (userId: string) => void;
  'error': (message: string) => void;
}

export interface ClientToServerEvents {
  'room:join': (payload: JoinRoomPayload) => void;
  'room:leave': () => void;
  'draw:stroke': (payload: DrawPayload) => void;
  'draw:clear': () => void;
  'cursor:move': (payload: CursorPayload) => void;
}
