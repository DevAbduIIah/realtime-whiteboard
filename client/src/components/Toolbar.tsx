import type { Tool, DrawingState } from "../types";

interface ToolbarProps {
  drawingState: DrawingState;
  onToolChange: (tool: Tool) => void;
  onColorChange: (color: string) => void;
  onSizeChange: (size: number) => void;
  onClear: () => void;
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

const SIZES = [2, 4, 8, 12, 20];

export function Toolbar({
  drawingState,
  onToolChange,
  onColorChange,
  onSizeChange,
  onClear,
}: ToolbarProps) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-3 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-1">
        <button
          onClick={() => onToolChange("brush")}
          className={`p-2.5 rounded-lg transition-all ${
            drawingState.tool === "brush"
              ? "bg-primary-100 text-primary-600 ring-2 ring-primary-500"
              : "hover:bg-gray-100 text-gray-600"
          }`}
          title="Brush"
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
          title="Eraser"
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

      <div className="flex items-center gap-1.5">
        {COLORS.map((color) => (
          <button
            key={color}
            onClick={() => onColorChange(color)}
            className={`w-7 h-7 rounded-full transition-all ${
              drawingState.color === color
                ? "ring-2 ring-offset-2 ring-primary-500 scale-110"
                : "hover:scale-105"
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>

      <div className="w-px h-8 bg-gray-200" />

      <div className="flex items-center gap-1.5">
        {SIZES.map((size) => (
          <button
            key={size}
            onClick={() => onSizeChange(size)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              drawingState.size === size
                ? "bg-primary-100 ring-2 ring-primary-500"
                : "hover:bg-gray-100"
            }`}
            title={`Size ${size}`}
          >
            <span
              className="rounded-full bg-gray-800"
              style={{
                width: Math.min(size + 2, 20),
                height: Math.min(size + 2, 20),
              }}
            />
          </button>
        ))}
      </div>

      <div className="w-px h-8 bg-gray-200" />

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
