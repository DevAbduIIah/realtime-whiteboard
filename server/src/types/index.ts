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
  version: number;
  type: 'text';
  x: number;
  y: number;
  zIndex: number;
  text: string;
  fontSize: number;
  color: string;
  userId: string;
}

export interface StickyElement {
  id: string;
  version: number;
  type: 'sticky';
  x: number;
  y: number;
  zIndex: number;
  width: number;
  height: number;
  text: string;
  color: string;
  userId: string;
}

export interface ShapeElement {
  id: string;
  version: number;
  type: 'rectangle' | 'circle' | 'line' | 'arrow';
  x: number;
  y: number;
  zIndex: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  fill?: string;
  userId: string;
}

export type WhiteboardElement = TextElement | StickyElement | ShapeElement;

export type PresenceStatus = 'online' | 'drawing' | 'idle';
export type ReactionKind = 'ping' | 'thumbs' | 'celebrate' | 'question';

export interface CursorPosition {
  x: number;
  y: number;
  userId: string;
  clientId: string;
  userName: string;
  status?: PresenceStatus;
}

export interface User {
  id: string;
  clientId: string;
  accountId: string;
  name: string;
  roomId: string;
  role: 'owner' | 'editor';
  status: PresenceStatus;
  lastActiveAt: number;
}

export type BoardBackground = 'dots' | 'grid' | 'plain' | 'blueprint' | 'warm';
export type BoardTemplate = 'blank' | 'kanban' | 'retrospective';
export type RoomMode = 'edit' | 'readonly';

export interface BoardTheme {
  background: BoardBackground;
  template: BoardTemplate;
}

export interface BoardMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  ownerId?: string;
  ownerName?: string;
  accessLevel: 'public' | 'private';
  shareLink?: string;
  inviteToken?: string;
  roomMode: RoomMode;
  theme: BoardTheme;
}

export interface BoardSnapshot {
  revision: number;
  createdAt: string;
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
}

export interface BoardContent {
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
  snapshots?: BoardSnapshot[];
}

export interface RoomState {
  metadata: BoardMetadata;
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
  users: User[];
}

export interface JoinRoomPayload {
  roomId: string;
  userName: string;
  clientId: string;
  accountId: string;
  authToken: string;
  accessToken?: string;
}

export interface DrawPayload {
  stroke: DrawStroke;
}

export interface StrokeDeletePayload {
  strokeId: string;
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

export interface BoardReaction {
  id: string;
  x: number;
  y: number;
  kind: ReactionKind;
  userId: string;
  clientId: string;
  userName: string;
  createdAt: number;
}

export interface ReactionPayload {
  reaction: BoardReaction;
}

export interface BoardStatePayload {
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
}

export interface MetadataUpdatePayload {
  updates: Partial<BoardMetadata>;
}

export interface ServerToClientEvents {
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
  'error': (message: string) => void;
}

export interface ClientToServerEvents {
  'room:join': (payload: JoinRoomPayload) => void;
  'room:leave': () => void;
  'draw:stroke': (payload: DrawPayload) => void;
  'draw:stroke-delete': (payload: StrokeDeletePayload) => void;
  'draw:clear': () => void;
  'element:add': (payload: ElementPayload) => void;
  'element:update': (payload: ElementUpdatePayload) => void;
  'element:delete': (payload: ElementDeletePayload) => void;
  'board:replace': (payload: BoardStatePayload) => void;
  'board:metadata-update': (payload: MetadataUpdatePayload) => void;
  'cursor:move': (payload: CursorPayload) => void;
  'reaction:add': (payload: ReactionPayload) => void;
}
