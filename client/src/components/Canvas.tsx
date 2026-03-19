import { useEffect, useRef } from "react";
import { useCanvasDrawing } from "../hooks/useCanvasDrawing";
import { getUserColor } from "../utils/userColors";
import type { DrawStroke, DrawingState, CursorPosition } from "../types";

interface CanvasProps {
  strokes: DrawStroke[];
  drawingState: DrawingState;
  userId: string;
  onStrokeComplete: (stroke: DrawStroke) => void;
  onMouseMove?: (x: number, y: number) => void;
  cursors?: Map<string, CursorPosition>;
}

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export function Canvas({
  strokes,
  drawingState,
  userId,
  onStrokeComplete,
  onMouseMove,
  cursors = new Map(),
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    canvasRef,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
  } = useCanvasDrawing({
    onStrokeComplete,
    strokes,
    drawingState,
    userId,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [canvasRef]);

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    handleMouseMove(e);

    if (onMouseMove && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      onMouseMove(x, y);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-gray-200 rounded-xl shadow-inner"
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="absolute inset-0 w-full h-full cursor-crosshair bg-white rounded-xl"
        onMouseDown={handleMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
      {Array.from(cursors.entries()).map(([cursorUserId, cursor]) => {
        if (cursorUserId === userId) return null;

        const container = containerRef.current;
        if (!container) return null;

        const rect = container.getBoundingClientRect();
        const scaleX = rect.width / CANVAS_WIDTH;
        const scaleY = rect.height / CANVAS_HEIGHT;

        const userColor = getUserColor(cursorUserId);

        return (
          <div
            key={cursorUserId}
            className="absolute pointer-events-none transition-all duration-75 ease-out"
            style={{
              left: cursor.x * scaleX,
              top: cursor.y * scaleY,
              transform: "translate(-2px, -2px)",
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              className="drop-shadow-md"
            >
              <path
                d="M5.65376 12.4563L5.65376 3.9563L14.1538 12.4563H9.15376L5.65376 12.4563Z"
                fill={userColor.fill}
                stroke="white"
                strokeWidth="1.5"
              />
            </svg>
            <span
              className={`absolute left-4 top-4 px-2 py-0.5 text-xs font-medium text-white rounded-full whitespace-nowrap shadow-sm ${userColor.bg}`}
            >
              {cursor.userName}
            </span>
          </div>
        );
      })}
    </div>
  );
}
