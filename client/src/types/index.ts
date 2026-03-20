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

export interface DrawingState {
  tool: Tool;
  color: string;
  size: number;
}

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface HistoryState {
  past: WhiteboardElement[][];
  present: WhiteboardElement[];
  future: WhiteboardElement[][];
}
