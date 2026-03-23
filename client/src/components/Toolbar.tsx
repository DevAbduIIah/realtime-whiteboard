import type { Tool, DrawingState } from "../types";

interface ToolbarProps {
  drawingState: DrawingState;
  onToolChange: (tool: Tool) => void;
  onColorChange: (color: string) => void;
  onSizeChange: (size: number) => void;
  onClear: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const COLORS = [
  "#000000",
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#14B8A6",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
];

const MIN_SIZE = 1;
const MAX_SIZE = 70;

export function Toolbar({
  drawingState,
  onToolChange,
  onColorChange,
  onSizeChange,
  onClear,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: ToolbarProps) {
  const isDrawingTool = ["brush", "eraser"].includes(drawingState.tool);
  const isShapeTool = ["rectangle", "circle", "line", "arrow"].includes(
    drawingState.tool,
  );
  const isEraserTool = drawingState.tool === "eraser";

  return (
    <div className="bg-white rounded-xl shadow-lg p-3 flex items-center gap-3 flex-wrap max-w-full">
      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`p-2.5 rounded-lg transition-all group relative ${
            canUndo
              ? "hover:bg-gray-100 text-gray-600"
              : "text-gray-300 cursor-not-allowed"
          }`}
          aria-label="Undo"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
            />
          </svg>
          {canUndo && (
            <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              Undo (Ctrl+Z)
            </span>
          )}
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`p-2.5 rounded-lg transition-all group relative ${
            canRedo
              ? "hover:bg-gray-100 text-gray-600"
              : "text-gray-300 cursor-not-allowed"
          }`}
          aria-label="Redo"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
            />
          </svg>
          {canRedo && (
            <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              Redo (Ctrl+Y)
            </span>
          )}
        </button>
      </div>

      <div className="w-px h-8 bg-gray-200" />

      {/* Selection Tool */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onToolChange("select")}
          className={`p-2.5 rounded-lg transition-all ${
            drawingState.tool === "select"
              ? "bg-primary-100 text-primary-600 ring-2 ring-primary-500"
              : "hover:bg-gray-100 text-gray-600"
          }`}
          title="Select (V)"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
            />
          </svg>
        </button>
      </div>

      <div className="w-px h-8 bg-gray-200" />

      {/* Drawing Tools */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onToolChange("brush")}
          className={`p-2.5 rounded-lg transition-all ${
            drawingState.tool === "brush"
              ? "bg-primary-100 text-primary-600 ring-2 ring-primary-500"
              : "hover:bg-gray-100 text-gray-600"
          }`}
          title="Brush (B)"
        >
          <svg
            className="w-5 h-5"
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
        </button>
        <button
          onClick={() => onToolChange("eraser")}
          className={`p-2.5 rounded-lg transition-all ${
            drawingState.tool === "eraser"
              ? "bg-primary-100 text-primary-600 ring-2 ring-primary-500"
              : "hover:bg-gray-100 text-gray-600"
          }`}
          title="Eraser (E)"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>

      <div className="w-px h-8 bg-gray-200" />

      {/* Shape Tools */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onToolChange("rectangle")}
          className={`p-2.5 rounded-lg transition-all ${
            drawingState.tool === "rectangle"
              ? "bg-primary-100 text-primary-600 ring-2 ring-primary-500"
              : "hover:bg-gray-100 text-gray-600"
          }`}
          title="Rectangle (R)"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} />
          </svg>
        </button>
        <button
          onClick={() => onToolChange("circle")}
          className={`p-2.5 rounded-lg transition-all ${
            drawingState.tool === "circle"
              ? "bg-primary-100 text-primary-600 ring-2 ring-primary-500"
              : "hover:bg-gray-100 text-gray-600"
          }`}
          title="Circle (O)"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="9" strokeWidth={2} />
          </svg>
        </button>
        <button
          onClick={() => onToolChange("line")}
          className={`p-2.5 rounded-lg transition-all ${
            drawingState.tool === "line"
              ? "bg-primary-100 text-primary-600 ring-2 ring-primary-500"
              : "hover:bg-gray-100 text-gray-600"
          }`}
          title="Line (L)"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <line
              x1="5"
              y1="19"
              x2="19"
              y2="5"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          onClick={() => onToolChange("arrow")}
          className={`p-2.5 rounded-lg transition-all ${
            drawingState.tool === "arrow"
              ? "bg-primary-100 text-primary-600 ring-2 ring-primary-500"
              : "hover:bg-gray-100 text-gray-600"
          }`}
          title="Arrow (A)"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 8l4 4m0 0l-4 4m4-4H3"
            />
          </svg>
        </button>
      </div>

      <div className="w-px h-8 bg-gray-200" />

      {/* Text & Sticky */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onToolChange("text")}
          className={`p-2.5 rounded-lg transition-all ${
            drawingState.tool === "text"
              ? "bg-primary-100 text-primary-600 ring-2 ring-primary-500"
              : "hover:bg-gray-100 text-gray-600"
          }`}
          title="Text (T)"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16m-7 6h7"
            />
          </svg>
        </button>
        <button
          onClick={() => onToolChange("sticky")}
          className={`p-2.5 rounded-lg transition-all ${
            drawingState.tool === "sticky"
              ? "bg-primary-100 text-primary-600 ring-2 ring-primary-500"
              : "hover:bg-gray-100 text-gray-600"
          }`}
          title="Sticky Note (S)"
        >
          <svg
            className="w-5 h-5"
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
        </button>
      </div>

      <div className="w-px h-8 bg-gray-200" />

      {/* Colors */}
      {isEraserTool ? (
        <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-gray-50 border border-gray-200">
          <span
            className="w-6 h-6 rounded-full border-2 border-gray-300 shadow-sm"
            style={{
              background: "linear-gradient(135deg, #ffffff 0%, #f3f4f6 100%)",
            }}
            title="Eraser"
          />
          <span className="text-xs font-medium text-gray-500">Eraser</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {COLORS.map((color) => (
            <button
              key={color}
              onClick={() => onColorChange(color)}
              className={`w-6 h-6 rounded-full transition-all ${
                drawingState.color === color
                  ? "ring-2 ring-offset-2 ring-primary-500 scale-110"
                  : "hover:scale-105"
              }`}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      )}

      <div className="w-px h-8 bg-gray-200" />

      {/* Sizes - only show for drawing/shape tools */}
      {(isDrawingTool || isShapeTool) && (
        <>
          <div className="flex items-center gap-3 px-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Size</span>
              <input
                type="range"
                min={MIN_SIZE}
                max={MAX_SIZE}
                value={drawingState.size}
                onChange={(e) => onSizeChange(Number(e.target.value))}
                className="w-28 accent-primary-600 cursor-pointer"
                title={`Size ${drawingState.size}`}
              />
            </div>
            <div className="relative w-16">
              <input
                type="number"
                min={MIN_SIZE}
                max={MAX_SIZE}
                value={drawingState.size}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isNaN(value)) return;
                  onSizeChange(Math.max(MIN_SIZE, Math.min(MAX_SIZE, value)));
                }}
                className="w-full pl-2 pr-6 py-1.5 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                aria-label="Brush size"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                px
              </span>
            </div>
          </div>
          <div className="w-px h-8 bg-gray-200" />
        </>
      )}

      {/* Clear */}
      <button
        onClick={onClear}
        className="px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        title="Clear Canvas"
      >
        Clear
      </button>
    </div>
  );
}
