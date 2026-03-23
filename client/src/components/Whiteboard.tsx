import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { useSocket } from "../contexts/SocketContext";
import { Canvas, type CanvasHandle } from "./Canvas";
import { Toolbar } from "./Toolbar";
import { throttle } from "../utils/throttle";
import { getUserColor, getUserInitials } from "../utils/userColors";
import {
  downloadJSON,
  exportToPNG,
  copyToClipboard,
  getShareableLink,
  parseImportData,
} from "../utils/export";
import type {
  DrawStroke,
  DrawingState,
  Tool,
  PresenceStatus,
  WhiteboardElement,
} from "../types";

export function Whiteboard() {
  const {
    currentUser,
    roomState,
    leaveRoom,
    sendStroke,
    sendClear,
    sendCursorMove,
    sendElement,
    updateElement,
    deleteElement,
    cursors,
    connectionStatus,
    canUndo,
    canRedo,
    captureHistorySnapshot,
    commitCapturedHistory,
    undo,
    redo,
  } = useSocket();

  const [drawingState, setDrawingState] = useState<DrawingState>({
    tool: "brush",
    color: "#000000",
    size: 4,
  });
  const [showToast, setShowToast] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const lastActivityRef = useRef<number>(Date.now());
  const presenceStatusRef = useRef<PresenceStatus>("online");
  const canvasRef = useRef<CanvasHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
        return;
      }

      // Tool shortcuts (single letter without modifiers)
      if (e.key === "Delete" || e.key === "Backspace") {
        if (canvasRef.current?.deleteSelection()) {
          e.preventDefault();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        if (canvasRef.current?.copySelection()) {
          e.preventDefault();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        if (canvasRef.current?.pasteClipboard()) {
          e.preventDefault();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        if (canvasRef.current?.duplicateSelection()) {
          e.preventDefault();
          return;
        }
      }

      if (e.key === "Escape") {
        if (canvasRef.current?.hasSelection()) {
          canvasRef.current.clearSelection();
          e.preventDefault();
          return;
        }
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case "v":
            setDrawingState((prev) => ({ ...prev, tool: "select" }));
            break;
          case "b":
            setDrawingState((prev) => ({ ...prev, tool: "brush" }));
            break;
          case "e":
            setDrawingState((prev) => ({ ...prev, tool: "eraser" }));
            break;
          case "r":
            setDrawingState((prev) => ({ ...prev, tool: "rectangle" }));
            break;
          case "o":
            setDrawingState((prev) => ({ ...prev, tool: "circle" }));
            break;
          case "l":
            setDrawingState((prev) => ({ ...prev, tool: "line" }));
            break;
          case "a":
            setDrawingState((prev) => ({ ...prev, tool: "arrow" }));
            break;
          case "t":
            setDrawingState((prev) => ({ ...prev, tool: "text" }));
            break;
          case "s":
            setDrawingState((prev) => ({ ...prev, tool: "sticky" }));
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  // Track idle state
  useEffect(() => {
    const checkIdle = () => {
      const now = Date.now();
      if (
        now - lastActivityRef.current > 5000 &&
        presenceStatusRef.current !== "idle"
      ) {
        presenceStatusRef.current = "idle";
      }
    };

    const interval = setInterval(checkIdle, 1000);
    return () => clearInterval(interval);
  }, []);

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
    (stroke: DrawStroke, options?: { captureHistory?: boolean }) => {
      sendStroke(stroke, options);
      presenceStatusRef.current = "online";
    },
    [sendStroke],
  );

  const handleElementAdd = useCallback(
    (element: WhiteboardElement, options?: { captureHistory?: boolean }) => {
      sendElement(element, options);
    },
    [sendElement],
  );

  const handleDrawStart = useCallback(() => {
    presenceStatusRef.current = "drawing";
    lastActivityRef.current = Date.now();
  }, []);

  const showToastMessage = useCallback((message: string) => {
    setShowToast(message);
    setTimeout(() => setShowToast(null), 2000);
  }, []);

  const handleClear = useCallback(() => {
    setShowClearConfirm(true);
  }, []);

  const confirmClear = useCallback(() => {
    sendClear();
    setShowClearConfirm(false);
    showToastMessage("Canvas cleared");
  }, [sendClear, showToastMessage]);

  const handleShare = useCallback(() => {
    if (!currentUser) return;
    const link = getShareableLink(currentUser.roomId);
    copyToClipboard(link).then(() => {
      showToastMessage("Link copied to clipboard!");
    });
  }, [currentUser, showToastMessage]);

  const handleExportJSON = useCallback(() => {
    if (!roomState || !currentUser) return;
    try {
      downloadJSON(
        roomState.strokes,
        roomState.elements || [],
        `whiteboard-${currentUser.roomId}`,
      );
      setShowExportMenu(false);
      showToastMessage("Exported as JSON");
    } catch (error) {
      showToastMessage("Export failed");
      console.error("Export error:", error);
    }
  }, [roomState, currentUser, showToastMessage]);

  const handleExportPNG = useCallback(async () => {
    const canvasElement =
      canvasRef.current?.getExportCanvas() ??
      canvasRef.current?.getCanvasElement();
    if (!canvasElement || !currentUser) return;
    setIsExporting(true);
    try {
      await exportToPNG(canvasElement, `whiteboard-${currentUser.roomId}`);
      setShowExportMenu(false);
      showToastMessage("Exported as PNG");
    } catch (error) {
      showToastMessage("Export failed");
      console.error("Export error:", error);
    } finally {
      setIsExporting(false);
    }
  }, [currentUser, showToastMessage]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
    setShowExportMenu(false);
  }, []);

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        const data = parseImportData(content);
        if (data) {
          // Import strokes and elements
          data.strokes.forEach((stroke) => sendStroke(stroke));
          data.elements.forEach((element) => sendElement(element));
          showToastMessage(
            `Imported ${data.strokes.length} strokes and ${data.elements.length} elements`,
          );
        } else {
          showToastMessage("Invalid file format");
        }
      };
      reader.readAsText(file);
      // Reset input so same file can be imported again
      e.target.value = "";
    },
    [sendStroke, sendElement, showToastMessage],
  );

  const handleMouseMove = useMemo(
    () =>
      throttle((x: number, y: number, drawing: boolean) => {
        lastActivityRef.current = Date.now();
        const status: PresenceStatus = drawing
          ? "drawing"
          : presenceStatusRef.current;
        presenceStatusRef.current = status;
        sendCursorMove(x, y, status);
      }, 50),
    [sendCursorMove],
  );

  if (!currentUser || !roomState) {
    return null;
  }

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col overflow-hidden">
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 px-3 md:px-4 py-3 flex items-center justify-between flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
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
          <div className="min-w-0">
            <h1 className="font-semibold text-gray-900 hidden sm:block">
              Whiteboard
            </h1>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="px-2 py-0.5 bg-gray-100 rounded font-mono truncate max-w-[100px] sm:max-w-none">
                {currentUser.roomId}
              </span>
              <span className="hidden sm:inline">&bull;</span>
              <span className="hidden sm:inline">
                {roomState.users.length}{" "}
                {roomState.users.length === 1 ? "participant" : "participants"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          <div className="hidden md:flex items-center -space-x-2">
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
          <div className="w-px h-8 bg-gray-200 hidden md:block" />
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-green-500 animate-pulse"
                  : connectionStatus === "reconnecting"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-red-500"
              }`}
            />
            <span className="text-sm text-gray-600 font-medium hidden lg:block">
              {connectionStatus === "reconnecting"
                ? "Reconnecting..."
                : currentUser.name}
            </span>
          </div>
          <div className="w-px h-8 bg-gray-200 hidden sm:block" />
          <button
            onClick={handleShare}
            className="flex items-center gap-2 px-2 md:px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
            title="Copy shareable link"
            aria-label="Share"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
            <span className="hidden md:inline">Share</span>
          </button>
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-2 md:px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
              aria-label="Export menu"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              <span className="hidden md:inline">Export</span>
              <svg
                className="w-3 h-3 hidden md:inline-block"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                <button
                  onClick={handleExportJSON}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Export JSON
                </button>
                <button
                  onClick={handleExportPNG}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  Export PNG
                </button>
                <div className="border-t border-gray-200 my-1" />
                <button
                  onClick={handleImportClick}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                  Import JSON
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
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
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
        </div>

        <div className="relative flex-1 min-h-0 h-full">
          <Canvas
            ref={canvasRef}
            strokes={roomState.strokes}
            elements={roomState.elements || []}
            drawingState={drawingState}
            userId={currentUser.id}
            onStrokeComplete={handleStrokeComplete}
            onElementAdd={handleElementAdd}
            onElementUpdate={updateElement}
            onElementDelete={deleteElement}
            onSelectionMutationStart={captureHistorySnapshot}
            onSelectionMutationEnd={commitCapturedHistory}
            onDrawStart={handleDrawStart}
            onMouseMove={handleMouseMove}
            cursors={cursors}
          />
          {/* Empty state */}
          {roomState.strokes.length === 0 &&
            (!roomState.elements || roomState.elements.length === 0) && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <svg
                    className="w-16 h-16 text-gray-300 mx-auto mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                  <p className="text-gray-400 text-lg font-medium">
                    Start drawing or add elements
                  </p>
                  <p className="text-gray-300 text-sm mt-1">
                    Use the toolbar above to select a tool
                  </p>
                </div>
              </div>
            )}
        </div>
      </main>

      {/* Toast notification */}
      {showToast && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 animate-fade-in">
          {showToast}
        </div>
      )}

      {/* Export loading overlay */}
      {isExporting && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex items-center gap-3">
            <svg
              className="animate-spin h-5 w-5 text-primary-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <span className="text-gray-700 font-medium">Exporting...</span>
          </div>
        </div>
      )}

      {/* Click outside to close export menu */}
      {showExportMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowExportMenu(false)}
        />
      )}

      {/* Clear confirmation dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Clear Canvas?
            </h3>
            <p className="text-gray-600 mb-6">
              This will remove all drawings and elements. This action cannot be
              undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmClear}
                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors font-medium"
              >
                Clear Canvas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
