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
  connectionStatus: "connected" | "disconnected" | "reconnecting";
  reconnectAttempt: number;
  lastRejoinedAt: number | null;
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
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "reconnecting"
  >("disconnected");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastRejoinedAt, setLastRejoinedAt] = useState<number | null>(null);
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
        ...prev,
        strokes: [...prev.strokes, stroke],
      };
    });
  }, []);

  const deleteStrokeLocal = useCallback((strokeId: string) => {
    processedStrokesRef.current.delete(strokeId);
    setRoomState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        strokes: prev.strokes.filter((stroke) => stroke.id !== strokeId),
      };
    });
  }, []);

  const addElementLocal = useCallback((element: WhiteboardElement) => {
    processedElementsRef.current.add(element.id);
    setRoomState((prev) => {
      if (
        !prev ||
        (prev.elements || []).some((existingElement) => existingElement.id === element.id)
      ) {
        return prev;
      }

      return {
        ...prev,
        elements: [...(prev.elements || []), element],
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
    processedElementsRef.current.add(element.id);
    setRoomState((prev) => {
      if (!prev) return prev;

      const existingIndex = (prev.elements || []).findIndex(
        (existingElement) => existingElement.id === element.id,
      );

      if (existingIndex === -1) {
        return {
          ...prev,
          elements: [...(prev.elements || []), element],
        };
      }

      const nextElements = [...(prev.elements || [])];
      nextElements[existingIndex] = element;
      return {
        ...prev,
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
    if (!activeUser) {
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

      if (lastRoomInfoRef.current) {
        awaitingRoomRejoinRef.current = true;
        setIsReconnecting(true);
        setConnectionStatus("reconnecting");
        return;
      }

      setConnectionStatus("disconnected");
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
        elements: data.roomState.elements || [],
      };

      const didRejoin = awaitingRoomRejoinRef.current;

      currentUserRef.current = data.user;
      setCurrentUser(data.user);
      setRoomState(normalizedRoomState);
      roomStateRef.current = normalizedRoomState;
      setReactions([]);
      setIsReconnecting(false);
      setConnectionStatus("connected");
      setReconnectAttempt(0);

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
          ...prev,
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

        return {
          ...prev,
          elements: (prev.elements || []).map((element) =>
            element.id === data.elementId
              ? ({ ...element, ...data.updates } as WhiteboardElement)
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
          ...prev,
          strokes: payload.strokes,
          elements: payload.elements,
        };
      });
    }

    function onCursorUpdate(cursor: CursorPosition) {
      setCursors((prev) => {
        const next = new Map(prev);
        next.set(cursor.userId, cursor);
        return next;
      });
    }

    function onCursorRemove(userId: string) {
      setCursors((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    }

    function onReactionAdd(reaction: BoardReaction) {
      addReactionLocal(reaction);
    }

    socket.on("connect", onConnect);
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
    socket.on("cursor:update", onCursorUpdate);
    socket.on("cursor:remove", onCursorRemove);
    socket.on("reaction:add", onReactionAdd);

    return () => {
      socket.off("connect", onConnect);
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
      socket.off("cursor:update", onCursorUpdate);
      socket.off("cursor:remove", onCursorRemove);
      socket.off("reaction:add", onReactionAdd);
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
    setElementLocal,
    setUserLocal,
    socket,
  ]);

  const joinRoom = useCallback(
    (roomId: string, userName: string) => {
      lastRoomInfoRef.current = { roomId, userName };
      socket.emit("room:join", { roomId, userName, clientId: clientIdRef.current });
    },
    [socket],
  );

  const leaveRoom = useCallback(() => {
    socket.emit("room:leave");
    lastRoomInfoRef.current = null;
    processedStrokesRef.current.clear();
    processedElementsRef.current.clear();
    awaitingRoomRejoinRef.current = false;
    setReconnectAttempt(0);
    setLastRejoinedAt(null);
    currentUserRef.current = null;
    setCurrentUser(null);
    setRoomState(null);
    setCursors(new Map());
    setReactions([]);
    resetHistory();
  }, [resetHistory, socket]);

  const sendStroke = useCallback(
    (stroke: DrawStroke, options?: MutationOptions) => {
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
        ...prev,
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
      const nextElement = cloneElement(element);
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
      const currentElement = currentState?.elements.find(
        (element) => element.id === elementId,
      );
      if (!currentElement) return;

      const capture = historyCaptureRef.current;
      const baseElement = capture.after.get(elementId) ?? currentElement;
      const nextElement = {
        ...baseElement,
        ...updates,
      } as WhiteboardElement;

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

  const deleteElement = useCallback(
    (elementId: string, options?: MutationOptions) => {
      const currentState = roomStateRef.current;
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
        connectionStatus,
        reconnectAttempt,
        lastRejoinedAt,
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
