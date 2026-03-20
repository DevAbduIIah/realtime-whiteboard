export interface Point {
  x: number;
  y: number;
}

export type Tool = 'brush' | 'eraser' | 'select' | 'text' | 'sticky' | 'rectangle' | 'circle' | 'line' | 'arrow';

export type ElementType = 'stroke' | 'text' | 'sticky' | 'rectangle' | 'circle' | 'line' | 'arrow';

export interface DrawStroke {
  id: string;
  type?: 'stroke';
  points: Point[];
  color: string;
  size: number;
  tool: 'brush' | 'eraser';
  userId: string;
  x?: number;
  y?: number;
}

export interface TextElement {
  id: string;
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  userId: string;
}

export interface StickyElement {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  userId: string;
}

export interface ShapeElement {
  id: string;
  type: 'rectangle' | 'circle' | 'line' | 'arrow';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  fill?: string;
  userId: string;
}

export type WhiteboardElement = DrawStroke | TextElement | StickyElement | ShapeElement;

export type PresenceStatus = 'online' | 'drawing' | 'idle';

export interface CursorPosition {
  x: number;
  y: number;
  userId: string;
  userName: string;
  status?: PresenceStatus;
}

export interface User {
  id: string;
  name: string;
  roomId: string;
}

export interface RoomState {
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
  users: User[];
}

export interface JoinRoomPayload {
  roomId: string;
  userName: string;
}

export interface DrawPayload {
  stroke: DrawStroke;
}

export interface ElementPayload {
  element: WhiteboardElement;
}

export interface ElementUpdatePayload {
  elementId: string;
  updates: Partial<WhiteboardElement>;
}

export interface ElementDeletePayload {
  elementId: string;
}

export interface CursorPayload {
  x: number;
  y: number;
  status?: PresenceStatus;
}

export interface ServerToClientEvents {
  'room:joined': (data: { user: User; roomState: RoomState }) => void;
  'room:user-joined': (user: User) => void;
  'room:user-left': (userId: string) => void;
  'draw:stroke': (stroke: DrawStroke) => void;
  'draw:clear': () => void;
  'element:add': (element: WhiteboardElement) => void;
  'element:update': (data: { elementId: string; updates: Partial<WhiteboardElement> }) => void;
  'element:delete': (elementId: string) => void;
  'cursor:update': (cursor: CursorPosition) => void;
  'cursor:remove': (userId: string) => void;
  'error': (message: string) => void;
}

export interface ClientToServerEvents {
  'room:join': (payload: JoinRoomPayload) => void;
  'room:leave': () => void;
  'draw:stroke': (payload: DrawPayload) => void;
  'draw:clear': () => void;
  'element:add': (payload: ElementPayload) => void;
  'element:update': (payload: ElementUpdatePayload) => void;
  'element:delete': (payload: ElementDeletePayload) => void;
  'cursor:move': (payload: CursorPayload) => void;
}
