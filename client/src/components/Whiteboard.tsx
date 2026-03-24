import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  BoardReaction,
  CursorPosition,
  DrawStroke,
  DrawingState,
  PresenceStatus,
  ReactionKind,
  Tool,
  User,
  WhiteboardElement,
} from "../types";

const IDLE_TIMEOUT_MS = 5000;

const REACTION_OPTIONS: Array<{
  kind: ReactionKind;
  badge: string;
  label: string;
  description: string;
}> = [
  {
    kind: "ping",
    badge: "!",
    label: "Ping",
    description: "Click the board to draw attention to a spot.",
  },
  {
    kind: "thumbs",
    badge: "+1",
    label: "Appreciate",
    description: "Drop a quick acknowledgment on the board.",
  },
  {
    kind: "celebrate",
    badge: "*",
    label: "Celebrate",
    description: "Mark a moment with a lightweight cheer.",
  },
  {
    kind: "question",
    badge: "?",
    label: "Question",
    description: "Flag an area that needs attention.",
  },
];

function getPresenceMeta(status: PresenceStatus): {
  label: string;
  tone: string;
  detail: string;
} {
  switch (status) {
    case "drawing":
      return {
        label: "Drawing",
        tone: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        detail: "Actively sketching right now",
      };
    case "idle":
      return {
        label: "Idle",
        tone: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
        detail: "Connected, but currently inactive",
      };
    case "online":
    default:
      return {
        label: "Online",
        tone: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
        detail: "Live in the room and ready",
      };
  }
}

function sortParticipants(currentUserId: string, participants: User[]): User[] {
  const presenceOrder: Record<PresenceStatus, number> = {
    drawing: 0,
    online: 1,
    idle: 2,
  };

  return [...participants].sort((left, right) => {
    if (left.id === currentUserId) return -1;
    if (right.id === currentUserId) return 1;

    const presenceDelta =
      presenceOrder[left.status] - presenceOrder[right.status];
    if (presenceDelta !== 0) {
      return presenceDelta;
    }

    return left.name.localeCompare(right.name);
  });
}

function getConnectionCopy(
  connectionStatus: "connected" | "disconnected" | "reconnecting",
  reconnectAttempt: number,
): {
  label: string;
  detail: string;
  dot: string;
} {
  switch (connectionStatus) {
    case "reconnecting":
      return {
        label: "Reconnecting",
        detail:
          reconnectAttempt > 0
            ? `Attempt ${reconnectAttempt} to restore live sync`
            : "Restoring live sync with the room",
        dot: "bg-amber-500 animate-pulse",
      };
    case "disconnected":
      return {
        label: "Disconnected",
        detail: "Live updates are paused until the socket reconnects",
        dot: "bg-rose-500",
      };
    case "connected":
    default:
      return {
        label: "Healthy",
        detail: "Live sync is stable",
        dot: "bg-emerald-500 animate-pulse",
      };
  }
}

export function Whiteboard() {
  const {
    currentUser,
    roomState,
    leaveRoom,
    sendStroke,
    sendClear,
    sendCursorMove,
    sendReaction,
    sendElement,
    updateElement,
    deleteElement,
    cursors,
    reactions,
    connectionStatus,
    reconnectAttempt,
    lastRejoinedAt,
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
  const [activeReactionKind, setActiveReactionKind] =
    useState<ReactionKind | null>(null);
  const [followedUserId, setFollowedUserId] = useState<string | null>(null);

  const lastActivityRef = useRef<number>(Date.now());
  const presenceStatusRef = useRef<PresenceStatus>("online");
  const lastCursorPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastRejoinedHandledRef = useRef<number | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<CanvasHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToastMessage = useCallback((message: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    setShowToast(message);
    toastTimeoutRef.current = setTimeout(() => {
      setShowToast(null);
      toastTimeoutRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!lastRejoinedAt || lastRejoinedHandledRef.current === lastRejoinedAt) {
      return;
    }

    lastRejoinedHandledRef.current = lastRejoinedAt;
    showToastMessage("Rejoined the room and resumed live sync.");
  }, [lastRejoinedAt, showToastMessage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
        return;
      }

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
        if (activeReactionKind) {
          setActiveReactionKind(null);
          e.preventDefault();
          return;
        }

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
  }, [activeReactionKind, redo, undo]);

  useEffect(() => {
    const interval = setInterval(() => {
      const lastCursorPoint = lastCursorPointRef.current;
      if (
        !lastCursorPoint ||
        Date.now() - lastActivityRef.current <= IDLE_TIMEOUT_MS ||
        presenceStatusRef.current === "idle"
      ) {
        return;
      }

      presenceStatusRef.current = "idle";
      sendCursorMove(lastCursorPoint.x, lastCursorPoint.y, "idle");
    }, 1000);

    return () => clearInterval(interval);
  }, [sendCursorMove]);

  useEffect(() => {
    if (!roomState || !followedUserId) {
      return;
    }

    if (!roomState.users.some((user) => user.id === followedUserId)) {
      setFollowedUserId(null);
      showToastMessage("Stopped following because that collaborator left.");
    }
  }, [followedUserId, roomState, showToastMessage]);

  const participants = useMemo(() => {
    if (!currentUser || !roomState) {
      return [];
    }

    return sortParticipants(currentUser.id, roomState.users);
  }, [currentUser, roomState]);

  const participantStats = useMemo(() => {
    return participants.reduce(
      (stats, participant) => {
        stats[participant.status] += 1;
        return stats;
      },
      {
        drawing: 0,
        online: 0,
        idle: 0,
      } satisfies Record<PresenceStatus, number>,
    );
  }, [participants]);

  const followedUser = useMemo(
    () => participants.find((participant) => participant.id === followedUserId) ?? null,
    [followedUserId, participants],
  );

  const followedCursor = useMemo<CursorPosition | null>(() => {
    if (!followedUserId) {
      return null;
    }

    return cursors.get(followedUserId) ?? null;
  }, [cursors, followedUserId]);

  const connectionCopy = useMemo(
    () => getConnectionCopy(connectionStatus, reconnectAttempt),
    [connectionStatus, reconnectAttempt],
  );

  const handleToolChange = useCallback((tool: Tool) => {
    setActiveReactionKind(null);
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

  const handleClear = useCallback(() => {
    setShowClearConfirm(true);
  }, []);

  const confirmClear = useCallback(() => {
    sendClear();
    setShowClearConfirm(false);
    showToastMessage("Canvas cleared.");
  }, [sendClear, showToastMessage]);

  const handleShare = useCallback(() => {
    if (!currentUser) return;

    const link = getShareableLink(currentUser.roomId);
    copyToClipboard(link).then(() => {
      showToastMessage("Link copied to clipboard.");
    });
  }, [currentUser, showToastMessage]);

  const handleExportJSON = useCallback(() => {
    if (!roomState || !currentUser) return;

    try {
      downloadJSON(
        roomState.strokes,
        roomState.elements || [],
        `whiteboard-${currentUser.roomId}`,
        roomState.metadata,
      );
      setShowExportMenu(false);
      showToastMessage("Exported board as JSON.");
    } catch (error) {
      showToastMessage("Export failed.");
      console.error("Export error:", error);
    }
  }, [currentUser, roomState, showToastMessage]);

  const handleExportPNG = useCallback(async () => {
    const canvasElement =
      canvasRef.current?.getExportCanvas() ??
      canvasRef.current?.getCanvasElement();
    if (!canvasElement || !currentUser) return;

    setIsExporting(true);
    try {
      await exportToPNG(canvasElement, `whiteboard-${currentUser.roomId}`);
      setShowExportMenu(false);
      showToastMessage("Exported board as PNG.");
    } catch (error) {
      showToastMessage("Export failed.");
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
          data.strokes.forEach((stroke) => sendStroke(stroke));
          data.elements.forEach((element) => sendElement(element));
          showToastMessage(
            `Imported ${data.metadata.title} with ${data.strokes.length} strokes and ${data.elements.length} elements.`,
          );
        } else {
          showToastMessage("Invalid file format.");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [sendElement, sendStroke, showToastMessage],
  );

  const handleMouseMove = useMemo(
    () =>
      throttle((x: number, y: number, drawing: boolean) => {
        lastActivityRef.current = Date.now();
        lastCursorPointRef.current = { x, y };

        const status: PresenceStatus = drawing
          ? "drawing"
          : presenceStatusRef.current === "idle"
            ? "online"
            : presenceStatusRef.current;

        presenceStatusRef.current = status;
        sendCursorMove(x, y, status);
      }, 50),
    [sendCursorMove],
  );

  const handleReactionAdd = useCallback(
    (reaction: BoardReaction) => {
      sendReaction(reaction);
      setActiveReactionKind(null);
      showToastMessage("Reaction sent to the room.");
    },
    [sendReaction, showToastMessage],
  );

  const handleReactionToggle = useCallback((kind: ReactionKind) => {
    setActiveReactionKind((prev) => (prev === kind ? null : kind));
  }, []);

  const handleJumpToUser = useCallback(
    (user: User) => {
      const cursor = cursors.get(user.id);
      if (!cursor) {
        showToastMessage(`${user.name} has not shared a live cursor yet.`);
        return;
      }

      canvasRef.current?.jumpToPoint({ x: cursor.x, y: cursor.y });
      setFollowedUserId(null);
      showToastMessage(`Jumped to ${user.name}.`);
    },
    [cursors, showToastMessage],
  );

  const handleFollowToggle = useCallback(
    (user: User) => {
      if (followedUserId === user.id) {
        setFollowedUserId(null);
        showToastMessage(`Stopped following ${user.name}.`);
        return;
      }

      if (!cursors.has(user.id)) {
        showToastMessage(`${user.name} has not shared a live cursor yet.`);
        return;
      }

      setFollowedUserId(user.id);
      showToastMessage(`Following ${user.name}.`);
    },
    [cursors, followedUserId, showToastMessage],
  );

  if (!currentUser || !roomState) {
    return null;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-br from-gray-50 via-white to-slate-100">
      <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white/85 px-3 py-3 backdrop-blur-sm md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 shadow-sm">
            <svg
              className="h-5 w-5 text-white"
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
            <h1 className="hidden font-semibold text-gray-900 sm:block">
              {roomState.metadata.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="max-w-[110px] truncate rounded bg-gray-100 px-2 py-0.5 font-mono sm:max-w-none">
                {currentUser.roomId}
              </span>
              <span className="hidden sm:inline">&bull;</span>
              <span className="hidden sm:inline">
                {participants.length}{" "}
                {participants.length === 1 ? "participant" : "participants"}
              </span>
              <span className="hidden md:inline">&bull;</span>
              <span className="hidden md:inline">
                {participantStats.drawing} drawing now
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 md:gap-3">
          <div className="hidden items-center -space-x-2 lg:flex">
            {participants.slice(0, 6).map((user) => {
              const color = getUserColor(user.clientId);
              const isCurrent = user.id === currentUser.id;

              return (
                <div
                  key={user.id}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-medium text-white shadow-sm ${color.bg} ${isCurrent ? "ring-2 ring-primary-300 ring-offset-1" : ""}`}
                  title={`${user.name}${isCurrent ? " (you)" : ""}`}
                >
                  {getUserInitials(user.name)}
                </div>
              );
            })}
          </div>

          <div className="hidden h-8 w-px bg-gray-200 md:block" />

          <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 shadow-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${connectionCopy.dot}`} />
            <div className="hidden text-left lg:block">
              <p className="text-xs font-semibold text-gray-700">
                {connectionCopy.label}
              </p>
              <p className="text-[11px] text-gray-500">
                {connectionStatus === "connected"
                  ? currentUser.name
                  : connectionCopy.detail}
              </p>
            </div>
          </div>

          <div className="hidden h-8 w-px bg-gray-200 sm:block" />

          <button
            onClick={handleShare}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 md:px-3"
            title="Copy shareable link"
            aria-label="Share"
          >
            <svg
              className="h-4 w-4"
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
              onClick={() => setShowExportMenu((prev) => !prev)}
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 md:px-3"
              aria-label="Export menu"
            >
              <svg
                className="h-4 w-4"
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
                className="hidden h-3 w-3 md:inline-block"
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
              <div className="absolute right-0 z-50 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  onClick={handleExportJSON}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  <svg
                    className="h-4 w-4"
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
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  <svg
                    className="h-4 w-4"
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
                <div className="my-1 border-t border-gray-200" />
                <button
                  onClick={handleImportClick}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  <svg
                    className="h-4 w-4"
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
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            Leave
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-4 min-h-0">
        <div className="flex flex-shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex justify-center xl:flex-1 xl:justify-start">
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

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white/90 p-2 shadow-sm backdrop-blur-sm">
            {REACTION_OPTIONS.map((reactionOption) => {
              const isActive = activeReactionKind === reactionOption.kind;

              return (
                <button
                  key={reactionOption.kind}
                  onClick={() => handleReactionToggle(reactionOption.kind)}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? "bg-primary-600 text-white shadow-sm"
                      : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                  }`}
                  title={reactionOption.description}
                >
                  <span className="text-xs font-semibold">
                    {reactionOption.badge}
                  </span>
                  <span>{reactionOption.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-1 min-h-0 flex-col gap-4 xl:flex-row">
          <div className="relative flex-1 min-h-[320px] xl:min-h-0">
            {connectionStatus !== "connected" && (
              <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-amber-200 bg-white/95 px-4 py-2 text-sm font-medium text-gray-700 shadow-lg backdrop-blur-sm">
                {connectionCopy.detail}
              </div>
            )}

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
              reactions={reactions}
              activeReactionKind={activeReactionKind}
              onReactionAdd={handleReactionAdd}
              followCursor={followedCursor}
              followUserName={followedUser?.name ?? null}
            />

            {roomState.strokes.length === 0 &&
              (!roomState.elements || roomState.elements.length === 0) && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <svg
                      className="mx-auto mb-4 h-16 w-16 text-gray-300"
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
                    <p className="text-lg font-medium text-gray-400">
                      Start drawing or add elements
                    </p>
                    <p className="mt-1 text-sm text-gray-300">
                      Use the toolbar above to pick a tool or drop a quick
                      reaction.
                    </p>
                  </div>
                </div>
              )}
          </div>

          <aside className="flex w-full flex-col gap-4 xl:w-[320px] xl:max-h-full">
            <section className="rounded-2xl border border-gray-200 bg-white/90 p-4 shadow-sm backdrop-blur-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-500">
                    Room Health
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-gray-900">
                    {connectionCopy.label}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {connectionCopy.detail}
                  </p>
                </div>
                <span className={`mt-1 h-3 w-3 rounded-full ${connectionCopy.dot}`} />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-500">Drawing</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {participantStats.drawing}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-500">Online</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {participantStats.online}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-500">Idle</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {participantStats.idle}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-xs text-gray-500">
                Revision {roomState.metadata.revision} updated{" "}
                {new Date(roomState.metadata.updatedAt).toLocaleTimeString()}
              </p>

              <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-3">
                <p className="text-sm font-medium text-gray-700">
                  {followedUser
                    ? `Currently following ${followedUser.name}.`
                    : activeReactionKind
                      ? `Reaction mode: ${
                          REACTION_OPTIONS.find(
                            (reactionOption) =>
                              reactionOption.kind === activeReactionKind,
                          )?.label ?? "Reaction"
                        }.`
                      : "Jump or follow a collaborator from the list below."}
                </p>
              </div>
            </section>

            <section className="flex min-h-0 flex-col rounded-2xl border border-gray-200 bg-white/90 p-4 shadow-sm backdrop-blur-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-500">
                    Participants
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-gray-900">
                    Room Presence
                  </h2>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
                  {participants.length}
                </span>
              </div>

              <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                {participants.map((user) => {
                  const color = getUserColor(user.clientId);
                  const presenceMeta = getPresenceMeta(user.status);
                  const liveCursor = cursors.get(user.id);
                  const isCurrentUser = user.id === currentUser.id;
                  const isFollowing = followedUserId === user.id;

                  return (
                    <div
                      key={user.id}
                      className="rounded-2xl border border-gray-200 bg-gray-50/70 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl text-sm font-semibold text-white shadow-sm ${color.bg}`}
                        >
                          {getUserInitials(user.name)}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-gray-900">
                              {user.name}
                              {isCurrentUser ? " (You)" : ""}
                            </p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${presenceMeta.tone}`}
                            >
                              {presenceMeta.label}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            {liveCursor
                              ? "Live cursor shared on the board"
                              : presenceMeta.detail}
                          </p>
                        </div>
                      </div>

                      {!isCurrentUser && (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => handleJumpToUser(user)}
                            disabled={!liveCursor}
                            className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
                          >
                            Jump
                          </button>
                          <button
                            onClick={() => handleFollowToggle(user)}
                            disabled={!liveCursor}
                            className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-300 ${
                              isFollowing
                                ? "bg-primary-600 text-white hover:bg-primary-700"
                                : "bg-gray-900 text-white hover:bg-gray-800"
                            }`}
                          >
                            {isFollowing ? "Stop" : "Follow"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {showToast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {showToast}
        </div>
      )}

      {isExporting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="flex items-center gap-3 rounded-lg bg-white p-6">
            <svg
              className="h-5 w-5 animate-spin text-primary-600"
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
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="font-medium text-gray-700">Exporting...</span>
          </div>
        </div>
      )}

      {showExportMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowExportMenu(false)}
        />
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-sm rounded-lg bg-white p-6">
            <h3 className="mb-2 text-lg font-semibold text-gray-900">
              Clear Canvas?
            </h3>
            <p className="mb-6 text-gray-600">
              This will remove all drawings and elements. This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="rounded-lg px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={confirmClear}
                className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white transition-colors hover:bg-red-700"
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
