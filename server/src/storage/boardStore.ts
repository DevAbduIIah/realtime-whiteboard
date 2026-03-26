import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  BoardBackground,
  BoardContent,
  BoardMetadata,
  BoardSnapshot,
  BoardTemplate,
  DrawStroke,
  WhiteboardElement,
} from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../../data');
const BOARDS_FILE = path.join(DATA_DIR, 'boards.json');
const STORAGE_SCHEMA_VERSION = 4;
const MAX_SNAPSHOTS = 3;
const SNAPSHOT_INTERVAL = 20;

export interface BoardSecurity {
  ownerAuthToken?: string;
  inviteToken: string;
}

export interface BoardRecord {
  metadata: BoardMetadata;
  content: BoardContent;
  security: BoardSecurity;
}

export interface BoardSummary extends BoardMetadata {
  strokeCount: number;
  elementCount: number;
  snapshotCount: number;
}

interface BoardsData {
  schemaVersion: number;
  boards: BoardRecord[];
}

interface LegacyBoardShape {
  id: string;
  name?: string;
  title?: string;
  strokes?: DrawStroke[];
  elements?: WhiteboardElement[];
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
  ownerId?: string;
  ownerName?: string;
  accessLevel?: 'public' | 'private';
  shareLink?: string;
  inviteToken?: string;
  security?: Partial<BoardSecurity>;
  roomMode?: 'edit' | 'readonly';
  theme?: {
    background?: BoardBackground;
    template?: BoardTemplate;
  };
  snapshots?: BoardSnapshot[];
}

let boardsCache: BoardsData = { schemaVersion: STORAGE_SCHEMA_VERSION, boards: [] };
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function normalizeElement(element: WhiteboardElement): WhiteboardElement {
  return {
    ...element,
    version: Math.max(1, element.version ?? 1),
    zIndex: typeof element.zIndex === 'number' ? element.zIndex : 0,
  };
}

function createDefaultTheme(): BoardMetadata['theme'] {
  return {
    background: 'dots',
    template: 'blank',
  };
}

function generateInviteToken(): string {
  return Math.random().toString(36).slice(2, 12);
}

function normalizeSecurity(
  security?: Partial<BoardSecurity>,
  inviteTokenFromMetadata?: string,
): BoardSecurity {
  return {
    ownerAuthToken: security?.ownerAuthToken,
    inviteToken:
      security?.inviteToken ||
      inviteTokenFromMetadata ||
      generateInviteToken(),
  };
}

function normalizeMetadata(metadata: BoardMetadata): BoardMetadata {
  return {
    ...metadata,
    title: metadata.title || `Board ${metadata.id}`,
    revision: Math.max(0, metadata.revision ?? 0),
    ownerName: metadata.ownerName || undefined,
    accessLevel: metadata.accessLevel === 'private' ? 'private' : 'public',
    shareLink: metadata.shareLink || metadata.id,
    inviteToken: metadata.inviteToken || undefined,
    roomMode: metadata.roomMode === 'readonly' ? 'readonly' : 'edit',
    theme: {
      background: metadata.theme?.background ?? 'dots',
      template: metadata.theme?.template ?? 'blank',
    },
  };
}

function normalizeElements(elements: WhiteboardElement[] = []): WhiteboardElement[] {
  return elements.map((element) => normalizeElement(element));
}

function normalizeSnapshots(snapshots: BoardSnapshot[] = []): BoardSnapshot[] {
  return snapshots.map((snapshot) => ({
    revision: Math.max(1, snapshot.revision ?? 1),
    createdAt: snapshot.createdAt ?? new Date().toISOString(),
    strokes: Array.isArray(snapshot.strokes) ? snapshot.strokes : [],
    elements: normalizeElements(Array.isArray(snapshot.elements) ? snapshot.elements : []),
  }));
}

function createBoardRecord(
  id: string,
  title: string,
  owner?: {
    ownerId?: string;
    ownerName?: string;
    ownerAuthToken?: string;
  },
): BoardRecord {
  const now = new Date().toISOString();
  const security = normalizeSecurity({
    ownerAuthToken: owner?.ownerAuthToken,
  });

  return {
    metadata: {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      ownerId: owner?.ownerId,
      ownerName: owner?.ownerName,
      accessLevel: 'public',
      shareLink: id,
      inviteToken: security.inviteToken,
      roomMode: 'edit',
      theme: createDefaultTheme(),
    },
    content: {
      strokes: [],
      elements: [],
      snapshots: [],
    },
    security,
  };
}

function migrateBoardRecord(input: LegacyBoardShape | BoardRecord): BoardRecord {
  if ('metadata' in input && 'content' in input) {
    const security = normalizeSecurity(
      'security' in input ? input.security : undefined,
      input.metadata.inviteToken,
    );
    return {
      metadata: {
        ...normalizeMetadata({
          ...input.metadata,
          inviteToken: security.inviteToken,
        }),
      },
      content: {
        strokes: Array.isArray(input.content.strokes) ? input.content.strokes : [],
        elements: normalizeElements(Array.isArray(input.content.elements) ? input.content.elements : []),
        snapshots: normalizeSnapshots(input.content.snapshots),
      },
      security,
    };
  }

  const now = new Date().toISOString();
  const security = normalizeSecurity(input.security, input.inviteToken);
  return {
    metadata: {
      id: input.id,
      title: input.title || input.name || `Board ${input.id}`,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
      revision: Math.max(0, input.revision ?? 0),
      ownerId: input.ownerId,
      ownerName: input.ownerName,
      accessLevel: input.accessLevel === 'private' ? 'private' : 'public',
      shareLink: input.shareLink || input.id,
      inviteToken: security.inviteToken,
      roomMode: input.roomMode === 'readonly' ? 'readonly' : 'edit',
      theme: {
        background: input.theme?.background ?? 'dots',
        template: input.theme?.template ?? 'blank',
      },
    },
    content: {
      strokes: Array.isArray(input.strokes) ? input.strokes : [],
      elements: normalizeElements(Array.isArray(input.elements) ? input.elements : []),
      snapshots: normalizeSnapshots(input.snapshots),
    },
    security,
  };
}

function migrateBoardsData(raw: unknown): BoardsData {
  if (!raw || typeof raw !== 'object') {
    return { schemaVersion: STORAGE_SCHEMA_VERSION, boards: [] };
  }

  const maybeBoards = (raw as { boards?: unknown }).boards;
  const boards = Array.isArray(maybeBoards)
    ? maybeBoards.map((board) => migrateBoardRecord(board as LegacyBoardShape | BoardRecord))
    : [];

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    boards,
  };
}

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
    boardsCache = migrateBoardsData(JSON.parse(data));
    return boardsCache;
  } catch {
    boardsCache = { schemaVersion: STORAGE_SCHEMA_VERSION, boards: [] };
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

function getBoardIndex(id: string): number {
  return boardsCache.boards.findIndex((board) => board.metadata.id === id);
}

function maybeCreateSnapshots(
  metadata: BoardMetadata,
  strokes: DrawStroke[],
  elements: WhiteboardElement[],
  existingSnapshots: BoardSnapshot[] = [],
): BoardSnapshot[] {
  const shouldSnapshot =
    metadata.revision > 0 &&
    (metadata.revision % SNAPSHOT_INTERVAL === 0 ||
      (existingSnapshots.length === 0 && (strokes.length > 0 || elements.length > 0)));

  if (!shouldSnapshot) {
    return existingSnapshots;
  }

  const nextSnapshot: BoardSnapshot = {
    revision: metadata.revision,
    createdAt: metadata.updatedAt,
    strokes: strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })),
    elements: normalizeElements(elements).map((element) => ({ ...element })),
  };

  return [...existingSnapshots, nextSnapshot].slice(-MAX_SNAPSHOTS);
}

export function getAllBoards(): BoardSummary[] {
  return boardsCache.boards.map((board) => ({
    ...board.metadata,
    strokeCount: board.content.strokes.length,
    elementCount: board.content.elements.length,
    snapshotCount: board.content.snapshots?.length ?? 0,
  }));
}

export function getBoard(id: string): BoardRecord | undefined {
  return boardsCache.boards.find((board) => board.metadata.id === id);
}

export function createBoard(title: string, ownerId?: string): BoardRecord {
  const board = createBoardRecord(generateBoardId(), title, { ownerId });
  boardsCache.boards.push(board);
  debouncedSave();
  return board;
}

export function updateBoard(
  id: string,
  updates: Partial<
    Pick<
      BoardMetadata,
      'title' | 'accessLevel' | 'ownerId' | 'ownerName' | 'shareLink' | 'inviteToken' | 'roomMode' | 'theme'
    >
  > & { name?: string },
): BoardRecord | undefined {
  const index = getBoardIndex(id);
  if (index === -1) return undefined;

  const currentBoard = boardsCache.boards[index];
  const security = normalizeSecurity(
    {
      ...currentBoard.security,
      inviteToken: updates.inviteToken ?? currentBoard.security.inviteToken,
    },
    updates.inviteToken,
  );

  boardsCache.boards[index] = {
    ...currentBoard,
    metadata: normalizeMetadata({
      ...currentBoard.metadata,
      ...updates,
      theme: {
        ...currentBoard.metadata.theme,
        ...updates.theme,
      },
      title: updates.title || updates.name || currentBoard.metadata.title,
      inviteToken: security.inviteToken,
      updatedAt: new Date().toISOString(),
    }),
    security,
  };

  debouncedSave();
  return boardsCache.boards[index];
}

export function updateBoardContent(
  id: string,
  strokes: DrawStroke[],
  elements: WhiteboardElement[],
  metadataOverride?: BoardMetadata,
  securityOverride?: BoardSecurity,
): BoardRecord | undefined {
  const index = getBoardIndex(id);
  if (index === -1) return undefined;

  const currentBoard = boardsCache.boards[index];
  const nextSecurity = normalizeSecurity(
    securityOverride ?? currentBoard.security,
    metadataOverride?.inviteToken ?? currentBoard.metadata.inviteToken,
  );

  const nextMetadata: BoardMetadata = metadataOverride
    ? normalizeMetadata({ ...metadataOverride, inviteToken: nextSecurity.inviteToken })
    : normalizeMetadata({
        ...currentBoard.metadata,
        updatedAt: new Date().toISOString(),
        revision: currentBoard.metadata.revision + 1,
        inviteToken: nextSecurity.inviteToken,
      });
  const normalizedElements = normalizeElements(elements);

  boardsCache.boards[index] = {
    metadata: nextMetadata,
    content: {
      strokes,
      elements: normalizedElements,
      snapshots: maybeCreateSnapshots(
        nextMetadata,
        strokes,
        normalizedElements,
        currentBoard.content.snapshots,
      ),
    },
    security: nextSecurity,
  };

  debouncedSave();
  return boardsCache.boards[index];
}

export function deleteBoard(id: string): boolean {
  const index = getBoardIndex(id);
  if (index === -1) return false;

  boardsCache.boards.splice(index, 1);
  debouncedSave();
  return true;
}

export function duplicateBoard(id: string, newTitle?: string): BoardRecord | undefined {
  const original = getBoard(id);
  if (!original) return undefined;

  const duplicate = createBoardRecord(
    generateBoardId(),
    newTitle || `${original.metadata.title} (Copy)`,
    {
      ownerId: original.metadata.ownerId,
      ownerName: original.metadata.ownerName,
      ownerAuthToken: original.security.ownerAuthToken,
    },
  );

  duplicate.metadata.accessLevel = original.metadata.accessLevel;
  duplicate.metadata.roomMode = original.metadata.roomMode;
  duplicate.metadata.theme = { ...original.metadata.theme };
  duplicate.content = {
    strokes: original.content.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
    elements: original.content.elements.map((element) => ({ ...normalizeElement(element) })),
    snapshots: [],
  };

  boardsCache.boards.push(duplicate);
  debouncedSave();
  return duplicate;
}

export function getOrCreateBoard(roomId: string): BoardRecord {
  const existingBoard = getBoard(roomId);
  if (existingBoard) {
    return existingBoard;
  }

  const board = createBoardRecord(roomId, `Board ${roomId}`);
  boardsCache.boards.push(board);
  debouncedSave();
  return board;
}

function generateBoardId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

loadBoards();
