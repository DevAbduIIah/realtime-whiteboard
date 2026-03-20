import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DrawStroke, WhiteboardElement } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../../data');
const BOARDS_FILE = path.join(DATA_DIR, 'boards.json');

export interface Board {
  id: string;
  name: string;
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
  accessLevel: 'public' | 'private';
  shareLink?: string;
}

interface BoardsData {
  boards: Board[];
}

let boardsCache: BoardsData = { boards: [] };
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

async function ensureDataDir(): Promise<void> {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

export async function loadBoards(): Promise<BoardsData> {
  try {
    await ensureDataDir();
    const data = await fs.readFile(BOARDS_FILE, 'utf-8');
    boardsCache = JSON.parse(data);
    return boardsCache;
  } catch {
    // File doesn't exist or is invalid, return empty
    boardsCache = { boards: [] };
    return boardsCache;
  }
}

async function saveBoards(): Promise<void> {
  try {
    await ensureDataDir();
    await fs.writeFile(BOARDS_FILE, JSON.stringify(boardsCache, null, 2));
  } catch (error) {
    console.error('Failed to save boards:', error);
  }
}

function debouncedSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveBoards();
    saveTimeout = null;
  }, 1000);
}

export function getAllBoards(): Board[] {
  return boardsCache.boards.map(b => ({
    ...b,
    strokes: [], // Don't send full content in list
    elements: [],
  }));
}

export function getBoard(id: string): Board | undefined {
  return boardsCache.boards.find(b => b.id === id);
}

export function createBoard(name: string, ownerId?: string): Board {
  const board: Board = {
    id: generateBoardId(),
    name,
    strokes: [],
    elements: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ownerId,
    accessLevel: 'public',
    shareLink: generateShareLink(),
  };

  boardsCache.boards.push(board);
  debouncedSave();

  return board;
}

export function updateBoard(id: string, updates: Partial<Board>): Board | undefined {
  const index = boardsCache.boards.findIndex(b => b.id === id);
  if (index === -1) return undefined;

  boardsCache.boards[index] = {
    ...boardsCache.boards[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  debouncedSave();
  return boardsCache.boards[index];
}

export function updateBoardContent(
  id: string,
  strokes: DrawStroke[],
  elements: WhiteboardElement[]
): Board | undefined {
  const index = boardsCache.boards.findIndex(b => b.id === id);
  if (index === -1) return undefined;

  boardsCache.boards[index].strokes = strokes;
  boardsCache.boards[index].elements = elements;
  boardsCache.boards[index].updatedAt = new Date().toISOString();

  debouncedSave();
  return boardsCache.boards[index];
}

export function deleteBoard(id: string): boolean {
  const index = boardsCache.boards.findIndex(b => b.id === id);
  if (index === -1) return false;

  boardsCache.boards.splice(index, 1);
  debouncedSave();
  return true;
}

export function duplicateBoard(id: string, newName?: string): Board | undefined {
  const original = getBoard(id);
  if (!original) return undefined;

  const duplicate: Board = {
    ...original,
    id: generateBoardId(),
    name: newName || `${original.name} (Copy)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    shareLink: generateShareLink(),
  };

  boardsCache.boards.push(duplicate);
  debouncedSave();

  return duplicate;
}

export function getOrCreateBoard(roomId: string): Board {
  let board = getBoard(roomId);
  if (!board) {
    board = {
      id: roomId,
      name: `Board ${roomId}`,
      strokes: [],
      elements: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessLevel: 'public',
      shareLink: roomId,
    };
    boardsCache.boards.push(board);
    debouncedSave();
  }
  return board;
}

function generateBoardId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateShareLink(): string {
  return Math.random().toString(36).substring(2, 10);
}

// Initialize boards on module load
loadBoards();
