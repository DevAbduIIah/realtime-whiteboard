import { useState, useCallback, useMemo } from "react";
import { useSocket } from "../contexts/SocketContext";
import { Canvas } from "./Canvas";
import { Toolbar } from "./Toolbar";
import { throttle } from "../utils/throttle";
import { getUserColor, getUserInitials } from "../utils/userColors";
import type { DrawStroke, DrawingState, Tool } from "../types";

export function Whiteboard() {
  const {
    currentUser,
    roomState,
    leaveRoom,
    sendStroke,
    sendClear,
    sendCursorMove,
    cursors,
  } = useSocket();

  const [drawingState, setDrawingState] = useState<DrawingState>({
    tool: "brush",
    color: "#000000",
    size: 4,
  });

  const handleToolChange = useCallback((tool: Tool) => {
    setDrawingState((prev) => ({ ...prev, tool }));
  }, []);

  const handleColorChange = useCallback((color: string) => {
    setDrawingState((prev) => ({ ...prev, color }));
  }, []);

  const handleSizeChange = useCallback((size: number) => {
    setDrawingState((prev) => ({ ...prev, size }));
  }, []);

  const handleStrokeComplete = useCallback(
    (stroke: DrawStroke) => {
      sendStroke(stroke);
    },
    [sendStroke],
  );

  const handleClear = useCallback(() => {
    sendClear();
  }, [sendClear]);

  const handleMouseMove = useMemo(
    () =>
      throttle((x: number, y: number) => {
        sendCursorMove(x, y);
      }, 50),
    [sendCursorMove],
  );

  if (!currentUser || !roomState) {
    return null;
  }

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col overflow-hidden">
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center shadow-sm">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </div>
          <div>
            <h1 className="font-semibold text-gray-900">Whiteboard</h1>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="px-2 py-0.5 bg-gray-100 rounded font-mono">
                {currentUser.roomId}
              </span>
              <span>&bull;</span>
              <span>
                {roomState.users.length}{" "}
                {roomState.users.length === 1 ? "participant" : "participants"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center -space-x-2">
            {roomState.users.slice(0, 6).map((user) => {
              const color = getUserColor(user.id);
              const isCurrentUser = user.id === currentUser.id;
              return (
                <div
                  key={user.id}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white border-2 border-white shadow-sm ${color.bg} ${isCurrentUser ? "ring-2 ring-primary-400 ring-offset-1" : ""}`}
                  title={user.name + (isCurrentUser ? " (you)" : "")}
                >
                  {getUserInitials(user.name)}
                </div>
              );
            })}
            {roomState.users.length > 6 && (
              <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-medium border-2 border-white shadow-sm">
                +{roomState.users.length - 6}
              </div>
            )}
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm text-gray-600 font-medium">
              {currentUser.name}
            </span>
          </div>
          <button
            onClick={leaveRoom}
            className="px-4 py-2 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
          >
            Leave
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 gap-4 min-h-0">
        <div className="flex justify-center flex-shrink-0">
          <Toolbar
            drawingState={drawingState}
            onToolChange={handleToolChange}
            onColorChange={handleColorChange}
            onSizeChange={handleSizeChange}
            onClear={handleClear}
          />
        </div>

        <Canvas
          strokes={roomState.strokes}
          drawingState={drawingState}
          userId={currentUser.id}
          onStrokeComplete={handleStrokeComplete}
          onMouseMove={handleMouseMove}
          cursors={cursors}
        />
      </main>
    </div>
  );
}
