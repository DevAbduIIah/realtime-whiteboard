import { Server, Socket } from 'socket.io';
import type {
  BoardReaction,
  BoardMetadata,
  ServerToClientEvents,
  ClientToServerEvents,
  User,
  RoomState,
  WhiteboardElement,
} from '../types/index.js';
import {
  getOrCreateBoard,
  updateBoardContent,
  type BoardSecurity,
} from '../storage/boardStore.js';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

interface ExtendedRoomState extends RoomState {
  security: BoardSecurity;
  strokeIds: Set<string>;
  elementIds: Set<string>;
  lastActivity: number;
  saveTimeout: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, ExtendedRoomState>();
interface ConnectedUserSession {
  user: User;
  authToken: string;
}

const userSockets = new Map<string, ConnectedUserSession>();

// Room cleanup grace period (5 minutes)
const ROOM_CLEANUP_DELAY = 5 * 60 * 1000;
// Debounce save delay
const SAVE_DELAY = 2000;

function getMaxZIndex(elements: WhiteboardElement[]): number {
  return elements.reduce(
    (maxZIndex, element) => Math.max(maxZIndex, element.zIndex ?? 0),
    0,
  );
}

function normalizeElement(
  element: WhiteboardElement,
  elements: WhiteboardElement[] = [],
): WhiteboardElement {
  return {
    ...element,
    version: Math.max(1, element.version ?? 1),
    zIndex:
      typeof element.zIndex === 'number'
        ? element.zIndex
        : getMaxZIndex(elements) + 1,
  };
}

function normalizeElements(elements: WhiteboardElement[]): WhiteboardElement[] {
  return elements.map((element) => normalizeElement(element));
}

function getElementVersion(element: Pick<WhiteboardElement, 'version'>): number {
  return Math.max(1, element.version ?? 1);
}

function touchRoomMetadata(roomState: ExtendedRoomState): void {
  const now = new Date().toISOString();
  roomState.metadata = {
    ...roomState.metadata,
    inviteToken: roomState.security.inviteToken,
    updatedAt: now,
    revision: roomState.metadata.revision + 1,
  };
}

function isRoomReadOnly(roomState: ExtendedRoomState): boolean {
  return roomState.metadata.roomMode === 'readonly';
}

function mergeMetadata(
  currentMetadata: BoardMetadata,
  updates: Partial<BoardMetadata>,
  roomState: ExtendedRoomState,
): BoardMetadata {
  return {
    ...currentMetadata,
    title: updates.title ?? currentMetadata.title,
    ownerId: currentMetadata.ownerId,
    ownerName: currentMetadata.ownerName,
    accessLevel: updates.accessLevel ?? currentMetadata.accessLevel,
    shareLink: updates.shareLink ?? currentMetadata.shareLink,
    inviteToken: roomState.security.inviteToken,
    theme: {
      ...currentMetadata.theme,
      ...updates.theme,
    },
    roomMode:
      updates.roomMode === 'readonly'
        ? 'readonly'
        : updates.roomMode === 'edit'
          ? 'edit'
          : currentMetadata.roomMode,
  };
}

function isOwnerSession(
  roomState: ExtendedRoomState,
  accountId: string,
  authToken: string,
): boolean {
  return Boolean(
    roomState.metadata.ownerId &&
      roomState.metadata.ownerId === accountId &&
      roomState.security.ownerAuthToken &&
      roomState.security.ownerAuthToken === authToken,
  );
}

function ensureBoardOwner(
  roomState: ExtendedRoomState,
  accountId: string,
  authToken: string,
  userName: string,
): boolean {
  if (roomState.metadata.ownerId) {
    return false;
  }

  roomState.security = {
    ...roomState.security,
    ownerAuthToken: authToken,
  };
  roomState.metadata = {
    ...roomState.metadata,
    ownerId: accountId,
    ownerName: userName,
    inviteToken: roomState.security.inviteToken,
  };
  touchRoomMetadata(roomState);
  return true;
}

function canJoinRoom(
  roomState: ExtendedRoomState,
  accountId: string,
  authToken: string,
  accessToken?: string,
): boolean {
  if (isOwnerSession(roomState, accountId, authToken)) {
    return true;
  }

  if (roomState.metadata.accessLevel === 'public') {
    return true;
  }

  return Boolean(accessToken && accessToken === roomState.security.inviteToken);
}

function saveRoomToStorage(roomId: string, roomState: ExtendedRoomState): void {
  if (roomState.saveTimeout) {
    clearTimeout(roomState.saveTimeout);
  }
  roomState.saveTimeout = setTimeout(() => {
    updateBoardContent(
      roomId,
      roomState.strokes,
      roomState.elements,
      roomState.metadata,
      roomState.security,
    );
    roomState.saveTimeout = null;
    console.log(`Saved board: ${roomId}`);
  }, SAVE_DELAY);
}

function getOrCreateRoom(roomId: string): ExtendedRoomState {
  if (!rooms.has(roomId)) {
    // Load from persistent storage
    const board = getOrCreateBoard(roomId);

    rooms.set(roomId, {
      metadata: {
        ...board.metadata,
        inviteToken: board.security.inviteToken,
      },
      strokes: board.content.strokes || [],
      elements: normalizeElements(board.content.elements || []),
      users: [],
      security: board.security,
      strokeIds: new Set((board.content.strokes || []).map(s => s.id)),
      elementIds: new Set((board.content.elements || []).map(e => e.id)),
      lastActivity: Date.now(),
      saveTimeout: null,
    });
  }
  const room = rooms.get(roomId)!;
  room.lastActivity = Date.now();
  return room;
}

// Periodically clean up old empty rooms and save to storage
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.users.length === 0 && now - room.lastActivity > ROOM_CLEANUP_DELAY) {
      // Save before cleanup
      if (room.saveTimeout) {
        clearTimeout(room.saveTimeout);
      }
      updateBoardContent(roomId, room.strokes, room.elements, room.metadata, room.security);
      rooms.delete(roomId);
      console.log(`Cleaned up and saved inactive room: ${roomId}`);
    }
  }
}, 60000);

export function setupSocketHandlers(io: TypedServer): void {
  io.on('connection', (socket: TypedSocket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('room:join', ({ roomId, userName, clientId, accountId, authToken, accessToken }) => {
      // Handle case where user is already in the room (reconnect scenario)
      const existingUser = userSockets.get(socket.id);
      if (existingUser) {
        handleUserLeave(socket, io);
      }

      const roomState = getOrCreateRoom(roomId);
      const didClaimOwnership = ensureBoardOwner(
        roomState,
        accountId,
        authToken,
        userName,
      );
      const isOwner = isOwnerSession(roomState, accountId, authToken);

      if (!canJoinRoom(roomState, accountId, authToken, accessToken)) {
        socket.emit('error', 'This private board requires a valid invite link.');
        return;
      }

      const now = Date.now();
      const user: User = {
        id: socket.id,
        clientId,
        accountId,
        name: userName,
        roomId,
        role: isOwner ? 'owner' : 'editor',
        status: 'online',
        lastActiveAt: now,
      };

      socket.join(roomId);
      userSockets.set(socket.id, { user, authToken });

      if (isOwner && roomState.metadata.ownerName !== userName) {
        roomState.metadata = {
          ...roomState.metadata,
          ownerName: userName,
          inviteToken: roomState.security.inviteToken,
        };
        touchRoomMetadata(roomState);
      }

      if (didClaimOwnership || isOwner) {
        saveRoomToStorage(roomId, roomState);
      }

      const existingUserIndex = roomState.users.findIndex(
        (roomUser) => roomUser.clientId === clientId,
      );

      let previousSocketId: string | null = null;
      if (existingUserIndex === -1) {
        roomState.users.push(user);
      } else {
        previousSocketId = roomState.users[existingUserIndex].id;
        roomState.users[existingUserIndex] = user;
        if (previousSocketId !== socket.id) {
          userSockets.delete(previousSocketId);
        }
      }

      // Send room state without Set objects (can't serialize)
      socket.emit('room:joined', {
        user,
        roomState: {
          metadata: roomState.metadata,
          strokes: roomState.strokes,
          elements: roomState.elements,
          users: roomState.users,
        },
      });

      if (existingUserIndex === -1) {
        socket.to(roomId).emit('room:user-joined', user);
      } else {
        socket.to(roomId).emit('room:user-updated', user);
        if (previousSocketId && previousSocketId !== user.id) {
          socket.to(roomId).emit('cursor:remove', previousSocketId);
        }
      }

      console.log(`${userName} joined room: ${roomId} (${roomState.users.length} users)`);
    });

    socket.on('room:leave', () => {
      handleUserLeave(socket, io);
    });

    socket.on('draw:stroke', ({ stroke }) => {
      const session = userSockets.get(socket.id);
      const user = session?.user;
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;
      if (isRoomReadOnly(roomState)) {
        socket.emit('error', 'This board is currently in read-only mode.');
        return;
      }

      // Prevent duplicate strokes
      if (roomState.strokeIds.has(stroke.id)) {
        return;
      }

      roomState.strokeIds.add(stroke.id);
      roomState.strokes.push(stroke);
      roomState.lastActivity = Date.now();
      touchRoomMetadata(roomState);

      // Persist to storage
      saveRoomToStorage(user.roomId, roomState);

      socket.to(user.roomId).emit('draw:stroke', stroke);
    });

    socket.on('draw:stroke-delete', ({ strokeId }) => {
      const session = userSockets.get(socket.id);
      const user = session?.user;
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;
      if (isRoomReadOnly(roomState)) {
        socket.emit('error', 'This board is currently in read-only mode.');
        return;
      }

      roomState.strokes = roomState.strokes.filter((stroke) => stroke.id !== strokeId);
      roomState.strokeIds.delete(strokeId);
      roomState.lastActivity = Date.now();
      touchRoomMetadata(roomState);

      saveRoomToStorage(user.roomId, roomState);

      socket.to(user.roomId).emit('draw:stroke-delete', strokeId);
    });

    socket.on('draw:clear', () => {
      const session = userSockets.get(socket.id);
      const user = session?.user;
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (roomState && isRoomReadOnly(roomState)) {
        socket.emit('error', 'This board is currently in read-only mode.');
        return;
      }
      if (roomState) {
        roomState.strokes = [];
        roomState.elements = [];
        roomState.strokeIds.clear();
        roomState.elementIds.clear();
        roomState.lastActivity = Date.now();
        touchRoomMetadata(roomState);

        // Persist to storage
        saveRoomToStorage(user.roomId, roomState);
      }

      socket.to(user.roomId).emit('draw:clear');
    });

    socket.on('element:add', ({ element }) => {
      const session = userSockets.get(socket.id);
      const user = session?.user;
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;
      if (isRoomReadOnly(roomState)) {
        socket.emit('error', 'This board is currently in read-only mode.');
        return;
      }

      const normalizedElement = normalizeElement(element, roomState.elements);

      // Prevent duplicate elements
      if (roomState.elementIds.has(normalizedElement.id)) {
        return;
      }

      roomState.elementIds.add(normalizedElement.id);
      roomState.elements.push(normalizedElement);
      roomState.lastActivity = Date.now();
      touchRoomMetadata(roomState);

      // Persist to storage
      saveRoomToStorage(user.roomId, roomState);

      socket.to(user.roomId).emit('element:add', normalizedElement);
    });

    socket.on('element:update', ({ elementId, updates }) => {
      const session = userSockets.get(socket.id);
      const user = session?.user;
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;
      if (isRoomReadOnly(roomState)) {
        socket.emit('error', 'This board is currently in read-only mode.');
        return;
      }

      const elementIndex = roomState.elements.findIndex(e => e.id === elementId);
      let appliedUpdates: Partial<WhiteboardElement> | null = null;
      if (elementIndex !== -1) {
        const currentElement = roomState.elements[elementIndex];
        const nextElement = normalizeElement({
          ...currentElement,
          ...updates,
        } as WhiteboardElement, roomState.elements);

        if (getElementVersion(nextElement) < getElementVersion(currentElement)) {
          return;
        }

        roomState.elements[elementIndex] = {
          ...roomState.elements[elementIndex],
          ...nextElement,
        } as WhiteboardElement;
        roomState.lastActivity = Date.now();
        touchRoomMetadata(roomState);
        appliedUpdates = nextElement;

        // Persist to storage
        saveRoomToStorage(user.roomId, roomState);
      }

      if (appliedUpdates) {
        socket.to(user.roomId).emit('element:update', {
          elementId,
          updates: appliedUpdates,
        });
      }
    });

    socket.on('element:delete', ({ elementId }) => {
      const session = userSockets.get(socket.id);
      const user = session?.user;
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;
      if (isRoomReadOnly(roomState)) {
        socket.emit('error', 'This board is currently in read-only mode.');
        return;
      }

      roomState.elements = roomState.elements.filter(e => e.id !== elementId);
      roomState.elementIds.delete(elementId);
      roomState.lastActivity = Date.now();
      touchRoomMetadata(roomState);

      // Persist to storage
      saveRoomToStorage(user.roomId, roomState);

      socket.to(user.roomId).emit('element:delete', elementId);
    });

    socket.on('board:replace', ({ strokes, elements }) => {
      const session = userSockets.get(socket.id);
      const user = session?.user;
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;
      if (isRoomReadOnly(roomState)) {
        socket.emit('error', 'This board is currently in read-only mode.');
        return;
      }

      roomState.strokes = strokes;
      roomState.elements = normalizeElements(elements);
      roomState.strokeIds = new Set(strokes.map((stroke) => stroke.id));
      roomState.elementIds = new Set(elements.map((element) => element.id));
      roomState.lastActivity = Date.now();
      touchRoomMetadata(roomState);

      saveRoomToStorage(user.roomId, roomState);

      socket.to(user.roomId).emit('board:replace', {
        strokes,
        elements: roomState.elements,
      });
    });

    socket.on('board:metadata-update', ({ updates }) => {
      const session = userSockets.get(socket.id);
      const user = session?.user;
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      if (!roomState) return;
      if (!isOwnerSession(roomState, user.accountId, session?.authToken ?? '')) {
        socket.emit('error', 'Only the board owner can change board settings.');
        return;
      }

      roomState.metadata = mergeMetadata(roomState.metadata, updates, roomState);
      touchRoomMetadata(roomState);
      roomState.lastActivity = Date.now();
      saveRoomToStorage(user.roomId, roomState);

      io.to(user.roomId).emit('board:metadata-updated', roomState.metadata);
    });

    socket.on('cursor:move', ({ x, y, status }) => {
      const session = userSockets.get(socket.id);
      const user = session?.user;
      if (!user) return;

      const roomState = rooms.get(user.roomId);
      const nextStatus = status || 'online';

      if (roomState) {
        const userIndex = roomState.users.findIndex((roomUser) => roomUser.id === user.id);
        if (userIndex !== -1) {
          const nextUser: User = {
            ...roomState.users[userIndex],
            status: nextStatus,
            lastActiveAt: Date.now(),
          };
          roomState.users[userIndex] = nextUser;
          userSockets.set(socket.id, {
            user: nextUser,
            authToken: session?.authToken ?? '',
          });

          if (nextUser.status !== user.status) {
            io.to(user.roomId).emit('room:user-updated', nextUser);
          }
        }
      }

      socket.to(user.roomId).emit('cursor:update', {
        x,
        y,
        userId: user.id,
        clientId: user.clientId,
        userName: user.name,
        status: nextStatus,
      });
    });

    socket.on('reaction:add', ({ reaction }) => {
      const session = userSockets.get(socket.id);
      const user = session?.user;
      if (!user) return;

      const nextReaction: BoardReaction = {
        ...reaction,
        userId: user.id,
        clientId: user.clientId,
        userName: user.name,
        createdAt: reaction.createdAt || Date.now(),
      };

      socket.to(user.roomId).emit('reaction:add', nextReaction);
    });

    socket.on('disconnect', () => {
      handleUserLeave(socket, io);
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

function handleUserLeave(socket: TypedSocket, io: TypedServer): void {
  const session = userSockets.get(socket.id);
  const user = session?.user;
  if (!user) return;

  const roomState = rooms.get(user.roomId);
  if (roomState) {
    roomState.users = roomState.users.filter((u) => u.id !== user.id);
    roomState.lastActivity = Date.now();
    // Don't delete room immediately - keep for reconnection grace period
  }

  socket.to(user.roomId).emit('room:user-left', user.id);
  socket.to(user.roomId).emit('cursor:remove', user.id);

  socket.leave(user.roomId);
  userSockets.delete(socket.id);
}
