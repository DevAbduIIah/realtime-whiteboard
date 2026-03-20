import {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useCanvasDrawing } from "../hooks/useCanvasDrawing";
import { getUserColor } from "../utils/userColors";
import type {
  DrawStroke,
  DrawingState,
  CursorPosition,
  WhiteboardElement,
  ShapeElement,
  TextElement,
  StickyElement,
  Point,
} from "../types";

interface CanvasProps {
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
  drawingState: DrawingState;
  userId: string;
  onStrokeComplete: (stroke: DrawStroke) => void;
  onElementAdd: (element: WhiteboardElement) => void;
  onDrawStart?: () => void;
  onMouseMove?: (x: number, y: number, isDrawing: boolean) => void;
  cursors?: Map<string, CursorPosition>;
}

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const Canvas = forwardRef<HTMLCanvasElement, CanvasProps>(
  function Canvas(
    {
      strokes,
      elements,
      drawingState,
      userId,
      onStrokeComplete,
      onElementAdd,
      onDrawStart,
      onMouseMove,
      cursors = new Map(),
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [shapeStart, setShapeStart] = useState<Point | null>(null);
    const [previewShape, setPreviewShape] = useState<ShapeElement | null>(null);
    const [textInput, setTextInput] = useState<{
      x: number;
      y: number;
      visible: boolean;
    }>({ x: 0, y: 0, visible: false });
    const [textValue, setTextValue] = useState("");
    const textInputRef = useRef<HTMLTextAreaElement>(null);

    const isShapeTool = ["rectangle", "circle", "line", "arrow"].includes(
      drawingState.tool,
    );
    const isTextTool = drawingState.tool === "text";
    const isStickyTool = drawingState.tool === "sticky";
    const isDrawingTool = ["brush", "eraser"].includes(drawingState.tool);

    const {
      canvasRef,
      handleMouseDown: originalHandleMouseDown,
      handleMouseMove,
      handleMouseUp: originalHandleMouseUp,
      handleMouseLeave: originalHandleMouseLeave,
      redrawCanvas,
    } = useCanvasDrawing({
      onStrokeComplete,
      strokes,
      drawingState,
      userId,
    });

    // Expose the canvas element to parent via ref
    useImperativeHandle(ref, () => canvasRef.current!, [canvasRef]);

    const getCanvasPoint = useCallback(
      (e: React.MouseEvent): Point => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const scaleX = CANVAS_WIDTH / rect.width;
        const scaleY = CANVAS_HEIGHT / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
        };
      },
      [canvasRef],
    );

    // Draw elements (shapes) on canvas
    const drawElements = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Redraw strokes first
      redrawCanvas();

      // Draw all elements
      const allElements = previewShape ? [...elements, previewShape] : elements;

      allElements.forEach((element) => {
        ctx.save();
        ctx.strokeStyle =
          element.type !== "sticky" ? (element as ShapeElement).color : "#000";
        ctx.lineWidth =
          element.type !== "sticky" && element.type !== "text"
            ? (element as ShapeElement).strokeWidth
            : 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        switch (element.type) {
          case "rectangle":
            ctx.beginPath();
            ctx.rect(element.x, element.y, element.width, element.height);
            if ((element as ShapeElement).fill) {
              ctx.fillStyle = (element as ShapeElement).fill!;
              ctx.fill();
            }
            ctx.stroke();
            break;

          case "circle":
            ctx.beginPath();
            const radiusX = element.width / 2;
            const radiusY = element.height / 2;
            ctx.ellipse(
              element.x + radiusX,
              element.y + radiusY,
              Math.abs(radiusX),
              Math.abs(radiusY),
              0,
              0,
              Math.PI * 2,
            );
            if ((element as ShapeElement).fill) {
              ctx.fillStyle = (element as ShapeElement).fill!;
              ctx.fill();
            }
            ctx.stroke();
            break;

          case "line":
            ctx.beginPath();
            ctx.moveTo(element.x, element.y);
            ctx.lineTo(element.x + element.width, element.y + element.height);
            ctx.stroke();
            break;

          case "arrow":
            const endX = element.x + element.width;
            const endY = element.y + element.height;
            ctx.beginPath();
            ctx.moveTo(element.x, element.y);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            // Draw arrowhead
            const angle = Math.atan2(element.height, element.width);
            const headLength = 15;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(
              endX - headLength * Math.cos(angle - Math.PI / 6),
              endY - headLength * Math.sin(angle - Math.PI / 6),
            );
            ctx.moveTo(endX, endY);
            ctx.lineTo(
              endX - headLength * Math.cos(angle + Math.PI / 6),
              endY - headLength * Math.sin(angle + Math.PI / 6),
            );
            ctx.stroke();
            break;

          case "text":
            const textEl = element as TextElement;
            ctx.font = `${textEl.fontSize}px sans-serif`;
            ctx.fillStyle = textEl.color;
            ctx.fillText(textEl.text, textEl.x, textEl.y + textEl.fontSize);
            break;

          case "sticky":
            const sticky = element as StickyElement;
            ctx.fillStyle = sticky.color;
            ctx.fillRect(sticky.x, sticky.y, sticky.width, sticky.height);
            ctx.strokeStyle = "#00000022";
            ctx.strokeRect(sticky.x, sticky.y, sticky.width, sticky.height);
            // Draw text
            ctx.fillStyle = "#000";
            ctx.font = "16px sans-serif";
            const lines = sticky.text.split("\n");
            lines.forEach((line, i) => {
              ctx.fillText(line, sticky.x + 10, sticky.y + 25 + i * 20);
            });
            break;
        }
        ctx.restore();
      });
    }, [canvasRef, elements, previewShape, redrawCanvas]);

    useEffect(() => {
      drawElements();
    }, [drawElements]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      console.log("Canvas mounted - dimensions:", {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        rectWidth: rect.width,
        rectHeight: rect.height,
        rectTop: rect.top,
        rectLeft: rect.left,
      });

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }, [canvasRef]);

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const point = getCanvasPoint(e);
      console.log("Canvas mouseDown:", {
        tool: drawingState.tool,
        isDrawingTool,
        point,
      });

      if (isTextTool) {
        setTextInput({ x: point.x, y: point.y, visible: true });
        setTextValue("");
        setTimeout(() => textInputRef.current?.focus(), 0);
        return;
      }

      if (isStickyTool) {
        const stickyColors = [
          "#FEF3C7",
          "#DBEAFE",
          "#FCE7F3",
          "#D1FAE5",
          "#FEE2E2",
        ];
        const sticky: StickyElement = {
          id: generateId(),
          type: "sticky",
          x: point.x,
          y: point.y,
          width: 200,
          height: 150,
          text: "Click to edit...",
          color: stickyColors[Math.floor(Math.random() * stickyColors.length)],
          userId,
        };
        onElementAdd(sticky);
        return;
      }

      if (isShapeTool) {
        setShapeStart(point);
        setIsDrawing(true);
        onDrawStart?.();
        return;
      }

      if (isDrawingTool) {
        setIsDrawing(true);
        onDrawStart?.();
        originalHandleMouseDown(e);
      }
    };

    const handleMouseUp = () => {
      if (isShapeTool && shapeStart && previewShape) {
        onElementAdd(previewShape);
        setShapeStart(null);
        setPreviewShape(null);
      }

      setIsDrawing(false);
      if (isDrawingTool) {
        originalHandleMouseUp();
      }
    };

    const handleMouseLeave = () => {
      setIsDrawing(false);
      setShapeStart(null);
      setPreviewShape(null);
      if (isDrawingTool) {
        originalHandleMouseLeave();
      }
    };

    const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const point = getCanvasPoint(e);

      if (isShapeTool && shapeStart && isDrawing) {
        const shape: ShapeElement = {
          id: generateId(),
          type: drawingState.tool as "rectangle" | "circle" | "line" | "arrow",
          x: Math.min(shapeStart.x, point.x),
          y: Math.min(shapeStart.y, point.y),
          width: point.x - shapeStart.x,
          height: point.y - shapeStart.y,
          color: drawingState.color,
          strokeWidth: drawingState.size,
          userId,
        };

        // For line and arrow, use start point directly
        if (drawingState.tool === "line" || drawingState.tool === "arrow") {
          shape.x = shapeStart.x;
          shape.y = shapeStart.y;
        }

        setPreviewShape(shape);
      }

      if (isDrawingTool) {
        handleMouseMove(e);
      }

      if (onMouseMove && canvasRef.current) {
        onMouseMove(point.x, point.y, isDrawing);
      }
    };

    const handleTextSubmit = () => {
      if (textValue.trim() && textInput.visible) {
        const text: TextElement = {
          id: generateId(),
          type: "text",
          x: textInput.x,
          y: textInput.y,
          text: textValue,
          fontSize: 24,
          color: drawingState.color,
          userId,
        };
        onElementAdd(text);
      }
      setTextInput({ x: 0, y: 0, visible: false });
      setTextValue("");
    };

    const getCursor = () => {
      switch (drawingState.tool) {
        case "select":
          return "default";
        case "text":
          return "text";
        case "sticky":
          return "copy";
        default:
          return "crosshair";
      }
    };

    return (
      <div
        ref={containerRef}
        className="relative flex-1 h-full overflow-hidden rounded-xl shadow-inner"
        style={{
          background: "#f9fafb",
          backgroundImage:
            "radial-gradient(circle, #e5e7eb 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="absolute inset-0 w-full h-full rounded-xl"
          style={{ cursor: getCursor(), background: "transparent" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />

        {/* Text input overlay */}
        {textInput.visible && containerRef.current && (
          <div
            className="absolute"
            style={{
              left:
                (textInput.x / CANVAS_WIDTH) *
                containerRef.current.getBoundingClientRect().width,
              top:
                (textInput.y / CANVAS_HEIGHT) *
                containerRef.current.getBoundingClientRect().height,
            }}
          >
            <textarea
              ref={textInputRef}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onBlur={handleTextSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleTextSubmit();
                }
                if (e.key === "Escape") {
                  setTextInput({ x: 0, y: 0, visible: false });
                  setTextValue("");
                }
              }}
              className="min-w-[200px] p-2 border-2 border-primary-500 rounded-lg shadow-lg focus:outline-none resize-none"
              style={{ color: drawingState.color }}
              placeholder="Type here..."
              autoFocus
            />
          </div>
        )}

        {/* Remote cursors */}
        {Array.from(cursors.entries()).map(([cursorUserId, cursor]) => {
          if (cursorUserId === userId) return null;

          const container = containerRef.current;
          if (!container) return null;

          const rect = container.getBoundingClientRect();
          const scaleX = rect.width / CANVAS_WIDTH;
          const scaleY = rect.height / CANVAS_HEIGHT;

          const userColor = getUserColor(cursorUserId);
          const isUserDrawing = cursor.status === "drawing";

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
                className={`drop-shadow-md ${isUserDrawing ? "scale-110" : ""}`}
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
                {isUserDrawing && (
                  <span className="ml-1 inline-flex items-center">
                    <span className="w-1 h-1 bg-white rounded-full animate-pulse" />
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    );
  },
);
