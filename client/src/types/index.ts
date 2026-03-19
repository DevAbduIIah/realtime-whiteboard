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

export type Tool = 'brush' | 'eraser';

export interface DrawingState {
  tool: Tool;
  color: string;
  size: number;
}
