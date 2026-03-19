import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import {
  getSocket,
  connectSocket,
  disconnectSocket,
  TypedSocket,
} from "../utils/socket";
import type { User, RoomState, DrawStroke, CursorPosition } from "../types";

interface SocketContextValue {
  socket: TypedSocket;
  isConnected: boolean;
  currentUser: User | null;
  roomState: RoomState | null;
  cursors: Map<string, CursorPosition>;
  joinRoom: (roomId: string, userName: string) => void;
  leaveRoom: () => void;
  sendStroke: (stroke: DrawStroke) => void;
  sendClear: () => void;
  sendCursorMove: (x: number, y: number) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket] = useState(() => getSocket());
  const [isConnected, setIsConnected] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [cursors, setCursors] = useState<Map<string, CursorPosition>>(
    new Map(),
  );

  useEffect(() => {
    connectSocket();

    function onConnect() {
      setIsConnected(true);
    }

    function onDisconnect() {
      setIsConnected(false);
      setCurrentUser(null);
      setRoomState(null);
      setCursors(new Map());
    }

    function onRoomJoined(data: { user: User; roomState: RoomState }) {
      setCurrentUser(data.user);
      setRoomState(data.roomState);
    }

    function onUserJoined(user: User) {
      setRoomState((prev) => {
        if (!prev) return prev;
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
      setRoomState((prev) => {
        if (!prev) return prev;
        return { ...prev, strokes: [...prev.strokes, stroke] };
      });
    }

    function onClear() {
      setRoomState((prev) => {
        if (!prev) return prev;
        return { ...prev, strokes: [] };
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
    socket.on("room:joined", onRoomJoined);
    socket.on("room:user-joined", onUserJoined);
    socket.on("room:user-left", onUserLeft);
    socket.on("draw:stroke", onStroke);
    socket.on("draw:clear", onClear);
    socket.on("cursor:update", onCursorUpdate);
    socket.on("cursor:remove", onCursorRemove);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:joined", onRoomJoined);
      socket.off("room:user-joined", onUserJoined);
      socket.off("room:user-left", onUserLeft);
      socket.off("draw:stroke", onStroke);
      socket.off("draw:clear", onClear);
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
    setCurrentUser(null);
    setRoomState(null);
    setCursors(new Map());
  }, [socket]);

  const sendStroke = useCallback(
    (stroke: DrawStroke) => {
      socket.emit("draw:stroke", { stroke });
      setRoomState((prev) => {
        if (!prev) return prev;
        return { ...prev, strokes: [...prev.strokes, stroke] };
      });
    },
    [socket],
  );

  const sendClear = useCallback(() => {
    socket.emit("draw:clear");
    setRoomState((prev) => {
      if (!prev) return prev;
      return { ...prev, strokes: [] };
    });
  }, [socket]);

  const sendCursorMove = useCallback(
    (x: number, y: number) => {
      socket.emit("cursor:move", { x, y });
    },
    [socket],
  );

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        currentUser,
        roomState,
        cursors,
        joinRoom,
        leaveRoom,
        sendStroke,
        sendClear,
        sendCursorMove,
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
