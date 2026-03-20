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
import type {
  User,
  RoomState,
  DrawStroke,
  CursorPosition,
  PresenceStatus,
  WhiteboardElement,
} from "../types";

interface HistoryEntry {
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
}

interface SocketContextValue {
  socket: TypedSocket;
  isConnected: boolean;
  isReconnecting: boolean;
  connectionStatus: "connected" | "disconnected" | "reconnecting";
  currentUser: User | null;
  roomState: RoomState | null;
  cursors: Map<string, CursorPosition>;
  canUndo: boolean;
  canRedo: boolean;
  joinRoom: (roomId: string, userName: string) => void;
  leaveRoom: () => void;
  sendStroke: (stroke: DrawStroke) => void;
  sendClear: () => void;
  sendCursorMove: (x: number, y: number, status?: PresenceStatus) => void;
  sendElement: (element: WhiteboardElement) => void;
  updateElement: (
    elementId: string,
    updates: Partial<WhiteboardElement>,
  ) => void;
  deleteElement: (elementId: string) => void;
  undo: () => void;
  redo: () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

const MAX_HISTORY = 50;

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket] = useState(() => getSocket());
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "reconnecting"
  >("disconnected");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [cursors, setCursors] = useState<Map<string, CursorPosition>>(
    new Map(),
  );
  const lastRoomInfoRef = useRef<{ roomId: string; userName: string } | null>(
    null,
  );
  const processedStrokesRef = useRef<Set<string>>(new Set());
  const processedElementsRef = useRef<Set<string>>(new Set());

  // History for undo/redo
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushHistory = useCallback(() => {
    if (!roomState) return;

    // Remove any future history when new action is taken
    historyRef.current = historyRef.current.slice(
      0,
      historyIndexRef.current + 1,
    );

    historyRef.current.push({
      strokes: [...roomState.strokes],
      elements: [...(roomState.elements || [])],
    });

    // Limit history size
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    } else {
      historyIndexRef.current++;
    }

    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, [roomState]);

  useEffect(() => {
    connectSocket();

    function onConnect() {
      setIsConnected(true);
      setIsReconnecting(false);
      setConnectionStatus("connected");

      // Rejoin room if we were in one before disconnect
      if (lastRoomInfoRef.current) {
        socket.emit("room:join", lastRoomInfoRef.current);
      }
    }

    function onDisconnect() {
      setIsConnected(false);
      setConnectionStatus("disconnected");
      setCursors(new Map());
    }

    function onReconnectAttempt() {
      setIsReconnecting(true);
      setConnectionStatus("reconnecting");
    }

    function onReconnectFailed() {
      setIsReconnecting(false);
      setConnectionStatus("disconnected");
    }

    function onRoomJoined(data: { user: User; roomState: RoomState }) {
      const normalizedRoomState = {
        ...data.roomState,
        elements: data.roomState.elements || [],
      };
      setCurrentUser(data.user);
      setRoomState(normalizedRoomState);
      // Store room info for potential reconnection
      lastRoomInfoRef.current = {
        roomId: data.user.roomId,
        userName: data.user.name,
      };
      // Reset processed strokes and elements
      processedStrokesRef.current = new Set(
        normalizedRoomState.strokes.map((s) => s.id),
      );
      processedElementsRef.current = new Set(
        normalizedRoomState.elements.map((e) => e.id),
      );
      // Reset history
      historyRef.current = [
        {
          strokes: [...normalizedRoomState.strokes],
          elements: [...normalizedRoomState.elements],
        },
      ];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    }

    function onUserJoined(user: User) {
      setRoomState((prev) => {
        if (!prev) return prev;
        // Prevent duplicate users
        if (prev.users.some((u) => u.id === user.id)) return prev;
        return { ...prev, users: [...prev.users, user] };
      });
    }

    function onUserLeft(userId: string) {
      setRoomState((prev) => {
        if (!prev) return prev;
        return { ...prev, users: prev.users.filter((u) => u.id !== userId) };
      });
      setCursors((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    }

    function onStroke(stroke: DrawStroke) {
      // Prevent duplicate stroke processing
      if (processedStrokesRef.current.has(stroke.id)) return;
      processedStrokesRef.current.add(stroke.id);

      setRoomState((prev) => {
        if (!prev) return prev;
        return { ...prev, strokes: [...prev.strokes, stroke] };
      });
    }

    function onClear() {
      processedStrokesRef.current.clear();
      processedElementsRef.current.clear();
      setRoomState((prev) => {
        if (!prev) return prev;
        return { ...prev, strokes: [], elements: [] };
      });
    }

    function onElementAdd(element: WhiteboardElement) {
      if (processedElementsRef.current.has(element.id)) return;
      processedElementsRef.current.add(element.id);

      setRoomState((prev) => {
        if (!prev) return prev;
        return { ...prev, elements: [...(prev.elements || []), element] };
      });
    }

    function onElementUpdate(data: {
      elementId: string;
      updates: Partial<WhiteboardElement>;
    }) {
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          elements: (prev.elements || []).map((e) =>
            e.id === data.elementId
              ? ({ ...e, ...data.updates } as WhiteboardElement)
              : e,
          ),
        };
      });
    }

    function onElementDelete(elementId: string) {
      processedElementsRef.current.delete(elementId);
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          elements: (prev.elements || []).filter((e) => e.id !== elementId),
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

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    socket.io.on("reconnect_failed", onReconnectFailed);
    socket.on("room:joined", onRoomJoined);
    socket.on("room:user-joined", onUserJoined);
    socket.on("room:user-left", onUserLeft);
    socket.on("draw:stroke", onStroke);
    socket.on("draw:clear", onClear);
    socket.on("element:add", onElementAdd);
    socket.on("element:update", onElementUpdate);
    socket.on("element:delete", onElementDelete);
    socket.on("cursor:update", onCursorUpdate);
    socket.on("cursor:remove", onCursorRemove);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      socket.io.off("reconnect_failed", onReconnectFailed);
      socket.off("room:joined", onRoomJoined);
      socket.off("room:user-joined", onUserJoined);
      socket.off("room:user-left", onUserLeft);
      socket.off("draw:stroke", onStroke);
      socket.off("draw:clear", onClear);
      socket.off("element:add", onElementAdd);
      socket.off("element:update", onElementUpdate);
      socket.off("element:delete", onElementDelete);
      socket.off("cursor:update", onCursorUpdate);
      socket.off("cursor:remove", onCursorRemove);
      disconnectSocket();
    };
  }, [socket]);

  const joinRoom = useCallback(
    (roomId: string, userName: string) => {
      socket.emit("room:join", { roomId, userName });
    },
    [socket],
  );

  const leaveRoom = useCallback(() => {
    socket.emit("room:leave");
    lastRoomInfoRef.current = null;
    processedStrokesRef.current.clear();
    processedElementsRef.current.clear();
    setCurrentUser(null);
    setRoomState(null);
    setCursors(new Map());
  }, [socket]);

  const sendStroke = useCallback(
    (stroke: DrawStroke) => {
      pushHistory();
      // Track this stroke to prevent processing our own emitted stroke
      processedStrokesRef.current.add(stroke.id);
      socket.emit("draw:stroke", { stroke });
      setRoomState((prev) => {
        if (!prev) return prev;
        return { ...prev, strokes: [...prev.strokes, stroke] };
      });
    },
    [socket, pushHistory],
  );

  const sendClear = useCallback(() => {
    pushHistory();
    processedStrokesRef.current.clear();
    processedElementsRef.current.clear();
    socket.emit("draw:clear");
    setRoomState((prev) => {
      if (!prev) return prev;
      return { ...prev, strokes: [], elements: [] };
    });
  }, [socket, pushHistory]);

  const sendCursorMove = useCallback(
    (x: number, y: number, status?: PresenceStatus) => {
      socket.emit("cursor:move", { x, y, status });
    },
    [socket],
  );

  const sendElement = useCallback(
    (element: WhiteboardElement) => {
      pushHistory();
      processedElementsRef.current.add(element.id);
      socket.emit("element:add", { element });
      setRoomState((prev) => {
        if (!prev) return prev;
        return { ...prev, elements: [...(prev.elements || []), element] };
      });
    },
    [socket, pushHistory],
  );

  const updateElement = useCallback(
    (elementId: string, updates: Partial<WhiteboardElement>) => {
      socket.emit("element:update", { elementId, updates });
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          elements: (prev.elements || []).map((e) =>
            e.id === elementId
              ? ({ ...e, ...updates } as WhiteboardElement)
              : e,
          ),
        };
      });
    },
    [socket],
  );

  const deleteElement = useCallback(
    (elementId: string) => {
      pushHistory();
      processedElementsRef.current.delete(elementId);
      socket.emit("element:delete", { elementId });
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          elements: (prev.elements || []).filter((e) => e.id !== elementId),
        };
      });
    },
    [socket, pushHistory],
  );

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;

    historyIndexRef.current--;
    const entry = historyRef.current[historyIndexRef.current];

    setRoomState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        strokes: entry.strokes,
        elements: entry.elements,
      };
    });

    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;

    historyIndexRef.current++;
    const entry = historyRef.current[historyIndexRef.current];

    setRoomState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        strokes: entry.strokes,
        elements: entry.elements,
      };
    });

    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        isReconnecting,
        connectionStatus,
        currentUser,
        roomState,
        cursors,
        canUndo,
        canRedo,
        joinRoom,
        leaveRoom,
        sendStroke,
        sendClear,
        sendCursorMove,
        sendElement,
        updateElement,
        deleteElement,
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
