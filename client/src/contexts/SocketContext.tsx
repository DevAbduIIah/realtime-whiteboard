import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import {
  getSocket,
  connectSocket,
  disconnectSocket,
  TypedSocket,
} from "../utils/socket";
import { getOrCreateClientId } from "../utils/presence";
import type {
  BoardMetadata,
  BoardReaction,
  User,
  RoomState,
  DrawStroke,
  CursorPosition,
  PresenceStatus,
  WhiteboardElement,
} from "../types";

interface MutationOptions {
  captureHistory?: boolean;
}

interface HistoryCapture {
  active: boolean;
  before: Map<string, WhiteboardElement>;
  after: Map<string, WhiteboardElement>;
}

type HistoryOperation =
  | { type: "stroke:add"; strokes: DrawStroke[] }
  | { type: "stroke:delete"; strokes: DrawStroke[] }
  | { type: "element:add"; elements: WhiteboardElement[] }
  | { type: "element:delete"; elements: WhiteboardElement[] }
  | { type: "element:set"; elements: WhiteboardElement[] };

interface HistoryEntry {
  undo: HistoryOperation[];
  redo: HistoryOperation[];
}

interface SocketContextValue {
  socket: TypedSocket;
  isConnected: boolean;
  isReconnecting: boolean;
  isJoiningRoom: boolean;
  connectionStatus: "connected" | "disconnected" | "reconnecting";
  reconnectAttempt: number;
  lastRejoinedAt: number | null;
  lastError: string | null;
  currentUser: User | null;
  roomState: RoomState | null;
  cursors: Map<string, CursorPosition>;
  reactions: BoardReaction[];
  canUndo: boolean;
  canRedo: boolean;
  joinRoom: (roomId: string, userName: string) => void;
  leaveRoom: () => void;
  sendStroke: (stroke: DrawStroke, options?: MutationOptions) => void;
  sendClear: () => void;
  sendCursorMove: (x: number, y: number, status?: PresenceStatus) => void;
  sendReaction: (reaction: BoardReaction) => void;
  sendElement: (element: WhiteboardElement, options?: MutationOptions) => void;
  updateElement: (
    elementId: string,
    updates: Partial<WhiteboardElement>,
  ) => void;
  updateBoardMetadata: (updates: Partial<BoardMetadata>) => void;
  deleteElement: (elementId: string, options?: MutationOptions) => void;
  captureHistorySnapshot: () => void;
  commitCapturedHistory: () => void;
  undo: () => void;
  redo: () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

const MAX_HISTORY = 50;
const REACTION_TTL = 4500;

function cloneStroke(stroke: DrawStroke): DrawStroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
  };
}

function cloneElement<T extends WhiteboardElement>(element: T): T {
  return { ...element };
}

function normalizeElement<T extends WhiteboardElement>(element: T): T {
  return {
    ...element,
    version: Math.max(1, element.version ?? 1),
    zIndex: typeof element.zIndex === "number" ? element.zIndex : 0,
  };
}

function normalizeElements(elements: WhiteboardElement[]): WhiteboardElement[] {
  return elements.map((element) => normalizeElement(element));
}

function getElementVersion(element: Pick<WhiteboardElement, "version">): number {
  return Math.max(1, element.version ?? 1);
}

function shouldApplyElementUpdate(
  currentElement: WhiteboardElement,
  nextElement: WhiteboardElement,
): boolean {
  return getElementVersion(nextElement) >= getElementVersion(currentElement);
}

function applyElementUpdates(
  currentElement: WhiteboardElement,
  updates: Partial<WhiteboardElement>,
): WhiteboardElement {
  return normalizeElement({
    ...currentElement,
    ...updates,
  } as WhiteboardElement);
}

function getMaxZIndex(elements: WhiteboardElement[]): number {
  return elements.reduce(
    (maxZIndex, element) => Math.max(maxZIndex, element.zIndex ?? 0),
    0,
  );
}

function isReadOnlyMetadata(metadata?: BoardMetadata | null): boolean {
  return metadata?.roomMode === "readonly";
}

function bumpMetadata<T extends RoomState>(roomState: T): T {
  return {
    ...roomState,
    metadata: {
      ...roomState.metadata,
      updatedAt: new Date().toISOString(),
      revision: roomState.metadata.revision + 1,
    },
  };
}

function mergeUsers(users: User[], nextUser: User): User[] {
  const existingIndex = users.findIndex(
    (user) => user.id === nextUser.id || user.clientId === nextUser.clientId,
  );

  if (existingIndex === -1) {
    return [...users, nextUser];
  }

  const nextUsers = [...users];
  nextUsers[existingIndex] = nextUser;
  return nextUsers;
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const clientIdRef = useRef(getOrCreateClientId());
  const [socket] = useState(() => getSocket());
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "reconnecting"
  >("disconnected");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastRejoinedAt, setLastRejoinedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [cursors, setCursors] = useState<Map<string, CursorPosition>>(
    new Map(),
  );
  const [reactions, setReactions] = useState<BoardReaction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const roomStateRef = useRef<RoomState | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const lastRoomInfoRef = useRef<{ roomId: string; userName: string } | null>(
    null,
  );
  const awaitingRoomRejoinRef = useRef(false);
  const processedStrokesRef = useRef<Set<string>>(new Set());
  const processedElementsRef = useRef<Set<string>>(new Set());
  const pendingCursorUpdatesRef = useRef<Map<string, CursorPosition>>(new Map());
  const pendingCursorRemovalsRef = useRef<Set<string>>(new Set());
  const cursorFrameRef = useRef<number | null>(null);
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const historyCaptureRef = useRef<HistoryCapture>({
    active: false,
    before: new Map(),
    after: new Map(),
  });

  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    const interval = setInterval(() => {
      setReactions((prev) =>
        prev.filter((reaction) => Date.now() - reaction.createdAt < REACTION_TTL),
      );
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const flushPendingCursorUpdates = useCallback(() => {
    cursorFrameRef.current = null;

    if (
      pendingCursorUpdatesRef.current.size === 0 &&
      pendingCursorRemovalsRef.current.size === 0
    ) {
      return;
    }

    setCursors((prev) => {
      const next = new Map(prev);

      pendingCursorRemovalsRef.current.forEach((userId) => {
        next.delete(userId);
      });

      pendingCursorUpdatesRef.current.forEach((cursor, userId) => {
        next.set(userId, cursor);
      });

      pendingCursorUpdatesRef.current.clear();
      pendingCursorRemovalsRef.current.clear();
      return next;
    });
  }, []);

  const scheduleCursorFlush = useCallback(() => {
    if (cursorFrameRef.current !== null) {
      return;
    }

    cursorFrameRef.current = window.requestAnimationFrame(flushPendingCursorUpdates);
  }, [flushPendingCursorUpdates]);

  useEffect(() => {
    return () => {
      if (cursorFrameRef.current !== null) {
        window.cancelAnimationFrame(cursorFrameRef.current);
      }
    };
  }, []);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyIndexRef.current >= 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const resetHistory = useCallback(() => {
    historyRef.current = [];
    historyIndexRef.current = -1;
    historyCaptureRef.current = {
      active: false,
      before: new Map(),
      after: new Map(),
    };
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  const pushHistoryEntry = useCallback(
    (entry: HistoryEntry) => {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push(entry);

      if (historyRef.current.length > MAX_HISTORY) {
        historyRef.current.shift();
      } else {
        historyIndexRef.current += 1;
      }

      if (historyRef.current.length === MAX_HISTORY && historyIndexRef.current >= MAX_HISTORY) {
        historyIndexRef.current = MAX_HISTORY - 1;
      }

      syncHistoryFlags();
    },
    [syncHistoryFlags],
  );

  const addStrokeLocal = useCallback((stroke: DrawStroke) => {
    processedStrokesRef.current.add(stroke.id);
    setRoomState((prev) => {
      if (!prev || prev.strokes.some((existingStroke) => existingStroke.id === stroke.id)) {
        return prev;
      }

      return {
        ...bumpMetadata(prev),
        strokes: [...prev.strokes, stroke],
      };
    });
  }, []);

  const deleteStrokeLocal = useCallback((strokeId: string) => {
    processedStrokesRef.current.delete(strokeId);
    setRoomState((prev) => {
      if (!prev) return prev;
      return {
        ...bumpMetadata(prev),
        strokes: prev.strokes.filter((stroke) => stroke.id !== strokeId),
      };
    });
  }, []);

  const addElementLocal = useCallback((element: WhiteboardElement) => {
    const normalizedElement = normalizeElement(element);
    processedElementsRef.current.add(normalizedElement.id);
    setRoomState((prev) => {
      if (!prev) {
        return prev;
      }

      const existingIndex = (prev.elements || []).findIndex(
        (existingElement) => existingElement.id === normalizedElement.id,
      );

      if (existingIndex === -1) {
        return {
          ...bumpMetadata(prev),
          elements: [...(prev.elements || []), normalizedElement],
        };
      }

      const existingElement = prev.elements[existingIndex];
      if (!shouldApplyElementUpdate(existingElement, normalizedElement)) {
        return prev;
      }

      const nextElements = [...(prev.elements || [])];
      nextElements[existingIndex] = normalizedElement;

      return {
        ...bumpMetadata(prev),
        elements: nextElements,
      };
    });
  }, []);

  const deleteElementLocal = useCallback((elementId: string) => {
    processedElementsRef.current.delete(elementId);
    setRoomState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        elements: (prev.elements || []).filter((element) => element.id !== elementId),
      };
    });
  }, []);

  const setElementLocal = useCallback((element: WhiteboardElement) => {
    const normalizedElement = normalizeElement(element);
    processedElementsRef.current.add(normalizedElement.id);
    setRoomState((prev) => {
      if (!prev) return prev;

      const existingIndex = (prev.elements || []).findIndex(
        (existingElement) => existingElement.id === normalizedElement.id,
      );

      if (existingIndex === -1) {
        return {
          ...bumpMetadata(prev),
          elements: [...(prev.elements || []), normalizedElement],
        };
      }

      if (
        !shouldApplyElementUpdate(prev.elements[existingIndex], normalizedElement)
      ) {
        return prev;
      }

      const nextElements = [...(prev.elements || [])];
      nextElements[existingIndex] = normalizedElement;
      return {
        ...bumpMetadata(prev),
        elements: nextElements,
      };
    });
  }, []);

  const setUserLocal = useCallback((user: User) => {
    setRoomState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        users: mergeUsers(prev.users, user),
      };
    });

    if (currentUserRef.current?.clientId === user.clientId) {
      setCurrentUser(user);
    }
  }, []);

  const setBoardMetadataLocal = useCallback((metadata: BoardMetadata) => {
    setRoomState((prev) => {
      if (!prev) return prev;
      const nextState = {
        ...prev,
        metadata,
      };
      roomStateRef.current = nextState;
      return nextState;
    });
  }, []);

  const removeUserLocal = useCallback((userId: string) => {
    setRoomState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        users: prev.users.filter((user) => user.id !== userId),
      };
    });

    if (currentUserRef.current?.id === userId) {
      setCurrentUser((prev) => (prev?.id === userId ? null : prev));
    }
  }, []);

  const updateCurrentUserPresenceLocal = useCallback((status: PresenceStatus) => {
    const activeUser = currentUserRef.current;
    if (!activeUser || activeUser.status === status) {
      return;
    }

    const nextUser: User = {
      ...activeUser,
      status,
      lastActiveAt: Date.now(),
    };

    currentUserRef.current = nextUser;
    setCurrentUser(nextUser);
    setRoomState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        users: mergeUsers(prev.users, nextUser),
      };
    });
  }, []);

  const addReactionLocal = useCallback((reaction: BoardReaction) => {
    setReactions((prev) => {
      const nextReactions = prev.filter(
        (existingReaction) => existingReaction.id !== reaction.id,
      );
      return [...nextReactions, reaction];
    });
  }, []);

  const emitStrokeAdd = useCallback(
    (stroke: DrawStroke) => {
      socket.emit("draw:stroke", { stroke });
    },
    [socket],
  );

  const emitStrokeDelete = useCallback(
    (strokeId: string) => {
      socket.emit("draw:stroke-delete", { strokeId });
    },
    [socket],
  );

  const emitElementAdd = useCallback(
    (element: WhiteboardElement) => {
      socket.emit("element:add", { element });
    },
    [socket],
  );

  const emitElementDelete = useCallback(
    (elementId: string) => {
      socket.emit("element:delete", { elementId });
    },
    [socket],
  );

  const emitElementSet = useCallback(
    (element: WhiteboardElement) => {
      const { id, ...updates } = element;
      socket.emit("element:update", {
        elementId: id,
        updates,
      });
    },
    [socket],
  );

  const applyHistoryOperation = useCallback(
    (operation: HistoryOperation) => {
      switch (operation.type) {
        case "stroke:add":
          operation.strokes.forEach((stroke) => {
            addStrokeLocal(stroke);
            emitStrokeAdd(stroke);
          });
          break;
        case "stroke:delete":
          operation.strokes.forEach((stroke) => {
            deleteStrokeLocal(stroke.id);
            emitStrokeDelete(stroke.id);
          });
          break;
        case "element:add":
          operation.elements.forEach((element) => {
            addElementLocal(element);
            emitElementAdd(element);
          });
          break;
        case "element:delete":
          operation.elements.forEach((element) => {
            deleteElementLocal(element.id);
            emitElementDelete(element.id);
          });
          break;
        case "element:set":
          operation.elements.forEach((element) => {
            setElementLocal(element);
            emitElementSet(element);
          });
          break;
      }
    },
    [
      addElementLocal,
      addStrokeLocal,
      deleteElementLocal,
      deleteStrokeLocal,
      emitElementAdd,
      emitElementDelete,
      emitElementSet,
      emitStrokeAdd,
      emitStrokeDelete,
      setElementLocal,
    ],
  );

  useEffect(() => {
    connectSocket();

    function onConnect() {
      setIsConnected(true);
      setLastError(null);

      if (lastRoomInfoRef.current) {
        setIsReconnecting(true);
        setConnectionStatus("reconnecting");
        socket.emit("room:join", {
          ...lastRoomInfoRef.current,
          clientId: clientIdRef.current,
        });
        return;
      }

      setIsReconnecting(false);
      setConnectionStatus("connected");
    }

    function onDisconnect() {
      setIsConnected(false);
      setCursors(new Map());
      pendingCursorUpdatesRef.current.clear();
      pendingCursorRemovalsRef.current.clear();

      if (lastRoomInfoRef.current) {
        awaitingRoomRejoinRef.current = true;
        setIsReconnecting(true);
        setConnectionStatus("reconnecting");
        return;
      }

      setConnectionStatus("disconnected");
    }

    function onConnectError(error: Error) {
      setIsJoiningRoom(false);
      setLastError(error.message || "Unable to reach the whiteboard server.");
    }

    function onReconnectAttempt(attempt: number) {
      setIsReconnecting(true);
      setConnectionStatus("reconnecting");
      setReconnectAttempt(attempt);
    }

    function onReconnectFailed() {
      setIsReconnecting(false);
      setConnectionStatus("disconnected");
      setReconnectAttempt(0);
    }

    function onRoomJoined(data: { user: User; roomState: RoomState }) {
      const normalizedRoomState = {
        ...data.roomState,
        elements: normalizeElements(data.roomState.elements || []),
      };

      const didRejoin = awaitingRoomRejoinRef.current;

      currentUserRef.current = data.user;
      setCurrentUser(data.user);
      setRoomState(normalizedRoomState);
      roomStateRef.current = normalizedRoomState;
      setReactions([]);
      setIsJoiningRoom(false);
      setIsReconnecting(false);
      setConnectionStatus("connected");
      setReconnectAttempt(0);
      setLastError(null);

      if (didRejoin) {
        setLastRejoinedAt(Date.now());
      }
      awaitingRoomRejoinRef.current = false;

      lastRoomInfoRef.current = {
        roomId: data.user.roomId,
        userName: data.user.name,
      };

      processedStrokesRef.current = new Set(
        normalizedRoomState.strokes.map((stroke) => stroke.id),
      );
      processedElementsRef.current = new Set(
        normalizedRoomState.elements.map((element) => element.id),
      );
      pendingCursorUpdatesRef.current.clear();
      pendingCursorRemovalsRef.current.clear();

      resetHistory();
    }

    function onUserJoined(user: User) {
      setUserLocal(user);
    }

    function onUserUpdated(user: User) {
      setUserLocal(user);
    }

    function onUserLeft(userId: string) {
      removeUserLocal(userId);

      setCursors((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    }

    function onStroke(stroke: DrawStroke) {
      if (processedStrokesRef.current.has(stroke.id)) return;
      addStrokeLocal(stroke);
    }

    function onStrokeDelete(strokeId: string) {
      deleteStrokeLocal(strokeId);
    }

    function onClear() {
      processedStrokesRef.current.clear();
      processedElementsRef.current.clear();
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...bumpMetadata(prev),
          strokes: [],
          elements: [],
        };
      });
    }

    function onElementAdd(element: WhiteboardElement) {
      if (processedElementsRef.current.has(element.id)) return;
      addElementLocal(element);
    }

    function onElementUpdate(data: {
      elementId: string;
      updates: Partial<WhiteboardElement>;
    }) {
      setRoomState((prev) => {
        if (!prev) return prev;

        const existingElement = (prev.elements || []).find(
          (element) => element.id === data.elementId,
        );
        if (!existingElement) {
          return prev;
        }

        const nextElement = applyElementUpdates(existingElement, data.updates);
        if (!shouldApplyElementUpdate(existingElement, nextElement)) {
          return prev;
        }

        return {
          ...bumpMetadata(prev),
          elements: (prev.elements || []).map((element) =>
            element.id === data.elementId
              ? nextElement
              : element,
          ),
        };
      });
    }

    function onElementDelete(elementId: string) {
      deleteElementLocal(elementId);
    }

    function onBoardReplace(payload: {
      strokes: DrawStroke[];
      elements: WhiteboardElement[];
    }) {
      processedStrokesRef.current = new Set(payload.strokes.map((stroke) => stroke.id));
      processedElementsRef.current = new Set(
        payload.elements.map((element) => element.id),
      );

      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...bumpMetadata(prev),
          strokes: payload.strokes,
          elements: normalizeElements(payload.elements),
        };
      });
    }

    function onCursorUpdate(cursor: CursorPosition) {
      pendingCursorRemovalsRef.current.delete(cursor.userId);
      pendingCursorUpdatesRef.current.set(cursor.userId, cursor);
      scheduleCursorFlush();
    }

    function onCursorRemove(userId: string) {
      pendingCursorUpdatesRef.current.delete(userId);
      pendingCursorRemovalsRef.current.add(userId);
      scheduleCursorFlush();
    }

    function onReactionAdd(reaction: BoardReaction) {
      addReactionLocal(reaction);
    }

    function onBoardMetadataUpdated(metadata: BoardMetadata) {
      setBoardMetadataLocal(metadata);
    }

    function onError(message: string) {
      setLastError(message);
      setIsJoiningRoom(false);
    }

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    socket.io.on("reconnect_failed", onReconnectFailed);
    socket.on("room:joined", onRoomJoined);
    socket.on("room:user-joined", onUserJoined);
    socket.on("room:user-updated", onUserUpdated);
    socket.on("room:user-left", onUserLeft);
    socket.on("draw:stroke", onStroke);
    socket.on("draw:stroke-delete", onStrokeDelete);
    socket.on("draw:clear", onClear);
    socket.on("element:add", onElementAdd);
    socket.on("element:update", onElementUpdate);
    socket.on("element:delete", onElementDelete);
    socket.on("board:replace", onBoardReplace);
    socket.on("board:metadata-updated", onBoardMetadataUpdated);
    socket.on("cursor:update", onCursorUpdate);
    socket.on("cursor:remove", onCursorRemove);
    socket.on("reaction:add", onReactionAdd);
    socket.on("error", onError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      socket.io.off("reconnect_failed", onReconnectFailed);
      socket.off("room:joined", onRoomJoined);
      socket.off("room:user-joined", onUserJoined);
      socket.off("room:user-updated", onUserUpdated);
      socket.off("room:user-left", onUserLeft);
      socket.off("draw:stroke", onStroke);
      socket.off("draw:stroke-delete", onStrokeDelete);
      socket.off("draw:clear", onClear);
      socket.off("element:add", onElementAdd);
      socket.off("element:update", onElementUpdate);
      socket.off("element:delete", onElementDelete);
      socket.off("board:replace", onBoardReplace);
      socket.off("board:metadata-updated", onBoardMetadataUpdated);
      socket.off("cursor:update", onCursorUpdate);
      socket.off("cursor:remove", onCursorRemove);
      socket.off("reaction:add", onReactionAdd);
      socket.off("error", onError);
      disconnectSocket();
    };
  }, [
    addElementLocal,
    addReactionLocal,
    addStrokeLocal,
    deleteElementLocal,
    deleteStrokeLocal,
    removeUserLocal,
    resetHistory,
    scheduleCursorFlush,
    setBoardMetadataLocal,
    setElementLocal,
    setUserLocal,
    socket,
  ]);

  const joinRoom = useCallback(
    (roomId: string, userName: string) => {
      lastRoomInfoRef.current = { roomId, userName };
      setIsJoiningRoom(true);
      setLastError(null);
      socket.emit("room:join", { roomId, userName, clientId: clientIdRef.current });
    },
    [socket],
  );

  const leaveRoom = useCallback(() => {
    socket.emit("room:leave");
    lastRoomInfoRef.current = null;
    processedStrokesRef.current.clear();
    processedElementsRef.current.clear();
    pendingCursorUpdatesRef.current.clear();
    pendingCursorRemovalsRef.current.clear();
    if (cursorFrameRef.current !== null) {
      window.cancelAnimationFrame(cursorFrameRef.current);
      cursorFrameRef.current = null;
    }
    awaitingRoomRejoinRef.current = false;
    setReconnectAttempt(0);
    setLastRejoinedAt(null);
    setIsJoiningRoom(false);
    setLastError(null);
    currentUserRef.current = null;
    setCurrentUser(null);
    setRoomState(null);
    setCursors(new Map());
    setReactions([]);
    resetHistory();
  }, [resetHistory, socket]);

  const sendStroke = useCallback(
    (stroke: DrawStroke, options?: MutationOptions) => {
      if (isReadOnlyMetadata(roomStateRef.current?.metadata)) {
        setLastError("This board is currently in read-only mode.");
        return;
      }

      const nextStroke = cloneStroke(stroke);
      addStrokeLocal(nextStroke);
      emitStrokeAdd(nextStroke);

      if (options?.captureHistory !== false) {
        pushHistoryEntry({
          undo: [{ type: "stroke:delete", strokes: [nextStroke] }],
          redo: [{ type: "stroke:add", strokes: [nextStroke] }],
        });
      }
    },
    [addStrokeLocal, emitStrokeAdd, pushHistoryEntry],
  );

  const sendClear = useCallback(() => {
    const currentState = roomStateRef.current;
    if (!currentState) return;
    if (isReadOnlyMetadata(currentState.metadata)) {
      setLastError("This board is currently in read-only mode.");
      return;
    }

    const clearedStrokes = currentState.strokes.map(cloneStroke);
    const clearedElements = (currentState.elements || []).map(cloneElement);

    if (clearedStrokes.length === 0 && clearedElements.length === 0) {
      return;
    }

    processedStrokesRef.current.clear();
    processedElementsRef.current.clear();
    socket.emit("draw:clear");
    setRoomState((prev) => {
      if (!prev) return prev;
      return {
        ...bumpMetadata(prev),
        strokes: [],
        elements: [],
      };
    });

    pushHistoryEntry({
      undo: [
        { type: "stroke:add", strokes: clearedStrokes },
        { type: "element:add", elements: clearedElements },
      ],
      redo: [
        { type: "stroke:delete", strokes: clearedStrokes },
        { type: "element:delete", elements: clearedElements },
      ],
    });
  }, [pushHistoryEntry, socket]);

  const sendCursorMove = useCallback(
    (x: number, y: number, status?: PresenceStatus) => {
      const nextStatus = status || "online";
      updateCurrentUserPresenceLocal(nextStatus);
      socket.emit("cursor:move", { x, y, status: nextStatus });
    },
    [socket, updateCurrentUserPresenceLocal],
  );

  const sendReaction = useCallback(
    (reaction: BoardReaction) => {
      const activeUser = currentUserRef.current;
      if (!activeUser) {
        return;
      }

      const nextReaction: BoardReaction = {
        ...reaction,
        userId: activeUser.id,
        clientId: activeUser.clientId,
        userName: activeUser.name,
        createdAt: reaction.createdAt || Date.now(),
      };

      addReactionLocal(nextReaction);
      socket.emit("reaction:add", { reaction: nextReaction });
    },
    [addReactionLocal, socket],
  );

  const sendElement = useCallback(
    (element: WhiteboardElement, options?: MutationOptions) => {
      const currentState = roomStateRef.current;
      if (isReadOnlyMetadata(currentState?.metadata)) {
        setLastError("This board is currently in read-only mode.");
        return;
      }

      const nextElement = normalizeElement({
        ...cloneElement(element),
        zIndex:
          typeof element.zIndex === "number"
            ? element.zIndex
            : getMaxZIndex(currentState?.elements || []) + 1,
      } as WhiteboardElement);
      addElementLocal(nextElement);
      emitElementAdd(nextElement);

      if (options?.captureHistory !== false) {
        pushHistoryEntry({
          undo: [{ type: "element:delete", elements: [nextElement] }],
          redo: [{ type: "element:add", elements: [nextElement] }],
        });
      }
    },
    [addElementLocal, emitElementAdd, pushHistoryEntry],
  );

  const updateElement = useCallback(
    (elementId: string, updates: Partial<WhiteboardElement>) => {
      const currentState = roomStateRef.current;
      if (isReadOnlyMetadata(currentState?.metadata)) {
        setLastError("This board is currently in read-only mode.");
        return;
      }

      const currentElement = currentState?.elements.find(
        (element) => element.id === elementId,
      );
      if (!currentElement) return;

      const capture = historyCaptureRef.current;
      const baseElement = capture.after.get(elementId) ?? currentElement;
      const nextElement = normalizeElement({
        ...baseElement,
        ...updates,
        version: Math.max(
          getElementVersion(baseElement),
          getElementVersion(currentElement),
        ) + 1,
      } as WhiteboardElement);

      if (capture.active) {
        if (!capture.before.has(elementId)) {
          capture.before.set(elementId, cloneElement(currentElement));
        }
        capture.after.set(elementId, cloneElement(nextElement));
      } else {
        pushHistoryEntry({
          undo: [{ type: "element:set", elements: [cloneElement(currentElement)] }],
          redo: [{ type: "element:set", elements: [cloneElement(nextElement)] }],
        });
      }

      setElementLocal(nextElement);
      emitElementSet(nextElement);
    },
    [emitElementSet, pushHistoryEntry, setElementLocal],
  );

  const updateBoardMetadata = useCallback(
    (updates: Partial<BoardMetadata>) => {
      const currentState = roomStateRef.current;
      if (!currentState) {
        return;
      }

      const nextMetadata: BoardMetadata = {
        ...currentState.metadata,
        ...updates,
        theme: {
          ...currentState.metadata.theme,
          ...updates.theme,
        },
      };

      setBoardMetadataLocal(nextMetadata);
      socket.emit("board:metadata-update", { updates });
    },
    [setBoardMetadataLocal, socket],
  );

  const deleteElement = useCallback(
    (elementId: string, options?: MutationOptions) => {
      const currentState = roomStateRef.current;
      if (isReadOnlyMetadata(currentState?.metadata)) {
        setLastError("This board is currently in read-only mode.");
        return;
      }

      const element = currentState?.elements.find(
        (existingElement) => existingElement.id === elementId,
      );
      if (!element) return;

      const deletedElement = cloneElement(element);
      deleteElementLocal(elementId);
      emitElementDelete(elementId);

      if (options?.captureHistory !== false) {
        pushHistoryEntry({
          undo: [{ type: "element:add", elements: [deletedElement] }],
          redo: [{ type: "element:delete", elements: [deletedElement] }],
        });
      }
    },
    [deleteElementLocal, emitElementDelete, pushHistoryEntry],
  );

  const captureHistorySnapshot = useCallback(() => {
    historyCaptureRef.current = {
      active: true,
      before: new Map(),
      after: new Map(),
    };
  }, []);

  const commitCapturedHistory = useCallback(() => {
    const capture = historyCaptureRef.current;

    if (!capture.active) {
      return;
    }

    historyCaptureRef.current = {
      active: false,
      before: new Map(),
      after: new Map(),
    };

    if (capture.before.size === 0 || capture.after.size === 0) {
      return;
    }

    pushHistoryEntry({
      undo: [
        {
          type: "element:set",
          elements: Array.from(capture.before.values()).map(cloneElement),
        },
      ],
      redo: [
        {
          type: "element:set",
          elements: Array.from(capture.after.values()).map(cloneElement),
        },
      ],
    });
  }, [pushHistoryEntry]);

  const undo = useCallback(() => {
    if (historyIndexRef.current < 0) return;

    const entry = historyRef.current[historyIndexRef.current];
    entry.undo.forEach(applyHistoryOperation);
    historyIndexRef.current -= 1;
    syncHistoryFlags();
  }, [applyHistoryOperation, syncHistoryFlags]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;

    const entry = historyRef.current[historyIndexRef.current + 1];
    entry.redo.forEach(applyHistoryOperation);
    historyIndexRef.current += 1;
    syncHistoryFlags();
  }, [applyHistoryOperation, syncHistoryFlags]);

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        isReconnecting,
        isJoiningRoom,
        connectionStatus,
        reconnectAttempt,
        lastRejoinedAt,
        lastError,
        currentUser,
        roomState,
        cursors,
        reactions,
        canUndo,
        canRedo,
        joinRoom,
        leaveRoom,
        sendStroke,
        sendClear,
        sendCursorMove,
        sendReaction,
        sendElement,
        updateElement,
        updateBoardMetadata,
        deleteElement,
        captureHistorySnapshot,
        commitCapturedHistory,
        undo,
        redo,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
}
