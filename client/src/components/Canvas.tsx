import {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from "react";
import { useCanvasDrawing } from "../hooks/useCanvasDrawing";
import { getUserColor } from "../utils/userColors";
import {
  boundsIntersect,
  cloneElementWithOffset,
  getElementBounds,
  getResizeHandleAtPoint,
  getResizeHandlePositions,
  getResizeHandlesForElement,
  getSelectionBounds,
  getTopmostElementAtPoint,
  resizeElement,
  translateElement,
} from "../utils/elementGeometry";
import type {
  BoardReaction,
  CursorPosition,
  DrawStroke,
  DrawingState,
  Point,
  ReactionKind,
  ResizeHandle,
  SelectionMode,
  ShapeElement,
  StickyElement,
  TextElement,
  ViewState,
  WhiteboardElement,
} from "../types";

interface MutationOptions {
  captureHistory?: boolean;
}

interface CanvasProps {
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
  drawingState: DrawingState;
  userId: string;
  onStrokeComplete: (stroke: DrawStroke, options?: MutationOptions) => void;
  onElementAdd: (
    element: WhiteboardElement,
    options?: MutationOptions,
  ) => void;
  onElementUpdate: (
    elementId: string,
    updates: Partial<WhiteboardElement>,
  ) => void;
  onElementDelete: (elementId: string, options?: MutationOptions) => void;
  onSelectionMutationStart: () => void;
  onSelectionMutationEnd: () => void;
  onDrawStart?: () => void;
  onMouseMove?: (x: number, y: number, isDrawing: boolean) => void;
  cursors?: Map<string, CursorPosition>;
  reactions?: BoardReaction[];
  activeReactionKind?: ReactionKind | null;
  onReactionAdd?: (reaction: BoardReaction) => void;
  followCursor?: CursorPosition | null;
  followUserName?: string | null;
}

export interface CanvasHandle {
  clearSelection: () => void;
  copySelection: () => boolean;
  deleteSelection: () => boolean;
  duplicateSelection: () => boolean;
  getCanvasElement: () => HTMLCanvasElement | null;
  getExportCanvas: () => HTMLCanvasElement | null;
  hasSelection: () => boolean;
  isEditingText: () => boolean;
  jumpToPoint: (point: Point, zoom?: number) => void;
  pasteClipboard: () => boolean;
}

interface MarqueeSelection {
  start: Point;
  end: Point;
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type SelectionInteraction =
  | {
      type: "dragging";
      startPoint: Point;
      elementIds: string[];
      originalElements: Record<string, WhiteboardElement>;
      historyCaptured: boolean;
    }
  | {
      type: "resizing";
      startPoint: Point;
      elementId: string;
      handle: ResizeHandle;
      originalElement: WhiteboardElement;
      historyCaptured: boolean;
    }
  | {
      type: "marquee";
      startPoint: Point;
      initialSelectionIds: string[];
    };

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const LIVE_UPDATE_DELAY = 40;
const PASTE_OFFSET = 24;
const ERASABLE_SHAPE_TYPES = new Set(["rectangle", "circle", "line", "arrow"]);
const SHAPE_SAMPLE_STEP = 8;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.15;
const VIEWPORT_PADDING = 48;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, value));
}

function getStrokeBounds(stroke: DrawStroke): Bounds | null {
  if (stroke.points.length === 0) {
    return null;
  }

  const coordinates = stroke.points.reduce(
    (accumulator, point) => ({
      left: Math.min(accumulator.left, point.x),
      top: Math.min(accumulator.top, point.y),
      right: Math.max(accumulator.right, point.x),
      bottom: Math.max(accumulator.bottom, point.y),
    }),
    {
      left: stroke.points[0].x,
      top: stroke.points[0].y,
      right: stroke.points[0].x,
      bottom: stroke.points[0].y,
    },
  );

  const padding = Math.max(stroke.size, 8);

  return {
    left: coordinates.left - padding,
    top: coordinates.top - padding,
    right: coordinates.right + padding,
    bottom: coordinates.bottom + padding,
  };
}

function mergeBounds(bounds: Bounds[]): Bounds | null {
  if (bounds.length === 0) {
    return null;
  }

  return bounds.reduce(
    (accumulator, bound) => ({
      left: Math.min(accumulator.left, bound.left),
      top: Math.min(accumulator.top, bound.top),
      right: Math.max(accumulator.right, bound.right),
      bottom: Math.max(accumulator.bottom, bound.bottom),
    }),
    bounds[0],
  );
}

function getBoardContentBounds(
  strokes: DrawStroke[],
  elements: WhiteboardElement[],
): Bounds {
  const strokeBounds = strokes
    .map(getStrokeBounds)
    .filter((bound): bound is Bounds => Boolean(bound));
  const elementBounds = elements.map((element) => getElementBounds(element));
  const contentBounds = mergeBounds([...strokeBounds, ...elementBounds]);

  return (
    contentBounds ?? {
      left: 0,
      top: 0,
      right: CANVAS_WIDTH,
      bottom: CANVAS_HEIGHT,
    }
  );
}

function getCenteredView(
  containerWidth: number,
  containerHeight: number,
  zoom: number,
): ViewState {
  return {
    zoom,
    panX: (containerWidth - CANVAS_WIDTH * zoom) / 2,
    panY: (containerHeight - CANVAS_HEIGHT * zoom) / 2,
  };
}

function getFitView(
  containerWidth: number,
  containerHeight: number,
  contentBounds: Bounds,
): ViewState {
  const contentWidth = Math.max(1, contentBounds.right - contentBounds.left);
  const contentHeight = Math.max(1, contentBounds.bottom - contentBounds.top);
  const availableWidth = Math.max(1, containerWidth - VIEWPORT_PADDING * 2);
  const availableHeight = Math.max(1, containerHeight - VIEWPORT_PADDING * 2);
  const zoom = clampZoom(
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1),
  );

  return {
    zoom,
    panX: containerWidth / 2 - (contentBounds.left + contentWidth / 2) * zoom,
    panY: containerHeight / 2 - (contentBounds.top + contentHeight / 2) * zoom,
  };
}

function worldToScreen(point: Point, viewState: ViewState): Point {
  return {
    x: point.x * viewState.zoom + viewState.panX,
    y: point.y * viewState.zoom + viewState.panY,
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getLineHeight(fontSize: number): number {
  return fontSize * 1.2;
}

function getResizeCursor(handle: ResizeHandle | null): string {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
    case "start":
    case "end":
      return "nwse-resize";
    default:
      return "nwse-resize";
  }
}

function getReactionMeta(kind: ReactionKind): {
  badge: string;
  label: string;
  caption: string;
} {
  switch (kind) {
    case "thumbs":
      return {
        badge: "+1",
        label: "Appreciation",
        caption: "sent appreciation",
      };
    case "celebrate":
      return {
        badge: "*",
        label: "Celebrate",
        caption: "celebrated",
      };
    case "question":
      return {
        badge: "?",
        label: "Question",
        caption: "asked a question",
      };
    case "ping":
    default:
      return {
        badge: "!",
        label: "Ping",
        caption: "pinged this spot",
      };
  }
}

function drawStrokePath(
  ctx: CanvasRenderingContext2D,
  stroke: DrawStroke,
): void {
  if (stroke.points.length < 2) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.size;

  if (stroke.tool === "eraser") {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#ffffff";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
  }

  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

  for (let index = 1; index < stroke.points.length; index += 1) {
    const previousPoint = stroke.points[index - 1];
    const currentPoint = stroke.points[index];
    const midX = (previousPoint.x + currentPoint.x) / 2;
    const midY = (previousPoint.y + currentPoint.y) / 2;

    ctx.quadraticCurveTo(previousPoint.x, previousPoint.y, midX, midY);
  }

  const lastPoint = stroke.points[stroke.points.length - 1];
  ctx.lineTo(lastPoint.x, lastPoint.y);
  ctx.stroke();
  ctx.restore();
}

function getDistanceToSegment(point: Point, start: Point, end: Point): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;

  if (deltaX === 0 && deltaY === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection =
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
    (deltaX * deltaX + deltaY * deltaY);
  const clampedProjection = Math.max(0, Math.min(1, projection));
  const closestX = start.x + deltaX * clampedProjection;
  const closestY = start.y + deltaY * clampedProjection;

  return Math.hypot(point.x - closestX, point.y - closestY);
}

function strokeHitsElement(stroke: DrawStroke, element: WhiteboardElement): boolean {
  const tolerance = Math.max(stroke.size, 12);

  if (element.type === "line" || element.type === "arrow") {
    const start = { x: element.x, y: element.y };
    const end = { x: element.x + element.width, y: element.y + element.height };

    return stroke.points.some(
      (point) => getDistanceToSegment(point, start, end) <= tolerance,
    );
  }

  const bounds = getElementBounds(element);
  const expandedBounds = {
    left: bounds.left - tolerance,
    top: bounds.top - tolerance,
    right: bounds.right + tolerance,
    bottom: bounds.bottom + tolerance,
  };

  return stroke.points.some(
    (point) =>
      point.x >= expandedBounds.left &&
      point.x <= expandedBounds.right &&
      point.y >= expandedBounds.top &&
      point.y <= expandedBounds.bottom,
  );
}

function sampleLinePoints(start: Point, end: Point, step = SHAPE_SAMPLE_STEP): Point[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const segments = Math.max(2, Math.ceil(length / step));

  return Array.from({ length: segments + 1 }, (_, index) => {
    const progress = index / segments;
    return {
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    };
  });
}

function sampleRectangleOutline(element: ShapeElement): Point[][] {
  const left = element.x;
  const right = element.x + element.width;
  const top = element.y;
  const bottom = element.y + element.height;

  return [[
    ...sampleLinePoints({ x: left, y: top }, { x: right, y: top }),
    ...sampleLinePoints({ x: right, y: top }, { x: right, y: bottom }).slice(1),
    ...sampleLinePoints({ x: right, y: bottom }, { x: left, y: bottom }).slice(1),
    ...sampleLinePoints({ x: left, y: bottom }, { x: left, y: top }).slice(1),
  ]];
}

function sampleCircleOutline(element: ShapeElement): Point[][] {
  const radiusX = Math.abs(element.width) / 2;
  const radiusY = Math.abs(element.height) / 2;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const perimeterEstimate =
    Math.PI * (3 * (radiusX + radiusY) - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY)));
  const segments = Math.max(24, Math.ceil(perimeterEstimate / SHAPE_SAMPLE_STEP));

  return [[
    ...Array.from({ length: segments + 1 }, (_, index) => {
      const angle = (index / segments) * Math.PI * 2;
      return {
        x: centerX + radiusX * Math.cos(angle),
        y: centerY + radiusY * Math.sin(angle),
      };
    }),
  ]];
}

function sampleArrowOutline(element: ShapeElement): Point[][] {
  const start = { x: element.x, y: element.y };
  const end = { x: element.x + element.width, y: element.y + element.height };
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = 15;
  const leftHead = {
    x: end.x - headLength * Math.cos(angle - Math.PI / 6),
    y: end.y - headLength * Math.sin(angle - Math.PI / 6),
  };
  const rightHead = {
    x: end.x - headLength * Math.cos(angle + Math.PI / 6),
    y: end.y - headLength * Math.sin(angle + Math.PI / 6),
  };

  return [
    sampleLinePoints(start, end),
    sampleLinePoints(end, leftHead),
    sampleLinePoints(end, rightHead),
  ];
}

function sampleShapeOutline(element: ShapeElement): Point[][] {
  switch (element.type) {
    case "rectangle":
      return sampleRectangleOutline(element);
    case "circle":
      return sampleCircleOutline(element);
    case "arrow":
      return sampleArrowOutline(element);
    case "line":
      return [
        sampleLinePoints(
          { x: element.x, y: element.y },
          { x: element.x + element.width, y: element.y + element.height },
        ),
      ];
    default:
      return [];
  }
}

function isPointErased(point: Point, eraserStroke: DrawStroke, radius: number): boolean {
  if (eraserStroke.points.length === 0) {
    return false;
  }

  for (let index = 1; index < eraserStroke.points.length; index += 1) {
    if (
      getDistanceToSegment(
        point,
        eraserStroke.points[index - 1],
        eraserStroke.points[index],
      ) <= radius
    ) {
      return true;
    }
  }

  return eraserStroke.points.some(
    (eraserPoint) => Math.hypot(point.x - eraserPoint.x, point.y - eraserPoint.y) <= radius,
  );
}

function splitRemainingShapeSegments(
  element: ShapeElement,
  eraserStroke: DrawStroke,
): Point[][] {
  const eraseRadius = Math.max(eraserStroke.size / 2, element.strokeWidth / 2) + 2;

  return sampleShapeOutline(element).flatMap((polyline) => {
    const segments: Point[][] = [];
    let currentSegment: Point[] = [];

    polyline.forEach((point) => {
      if (isPointErased(point, eraserStroke, eraseRadius)) {
        if (currentSegment.length >= 2) {
          segments.push(currentSegment);
        }
        currentSegment = [];
        return;
      }

      currentSegment.push(point);
    });

    if (currentSegment.length >= 2) {
      segments.push(currentSegment);
    }

    return segments;
  });
}

function getElementUpdates(
  element: WhiteboardElement,
): Partial<WhiteboardElement> {
  switch (element.type) {
    case "text":
      return {
        x: element.x,
        y: element.y,
        fontSize: element.fontSize,
      } as Partial<WhiteboardElement>;
    case "sticky":
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      } as Partial<WhiteboardElement>;
    default:
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      } as Partial<WhiteboardElement>;
  }
}

function buildElementMap(
  elementIds: string[],
  source: Map<string, WhiteboardElement>,
): Record<string, WhiteboardElement> {
  return elementIds.reduce<Record<string, WhiteboardElement>>(
    (result, elementId) => {
      const element = source.get(elementId);
      if (element) {
        result[elementId] = element;
      }
      return result;
    },
    {},
  );
}

export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  {
    strokes,
    elements,
    drawingState,
    userId,
    onStrokeComplete,
    onElementAdd,
    onElementUpdate,
    onElementDelete,
    onSelectionMutationStart,
    onSelectionMutationEnd,
    onDrawStart,
    onMouseMove,
    cursors = new Map(),
    reactions = [],
    activeReactionKind = null,
    onReactionAdd,
    followCursor = null,
    followUserName = null,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasViewportInteractionRef = useRef(false);
  const hasInitializedViewportRef = useRef(false);
  const panSessionRef = useRef<{
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [viewState, setViewState] = useState<ViewState>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const [isViewportPanning, setIsViewportPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [shapeStart, setShapeStart] = useState<Point | null>(null);
  const [previewShape, setPreviewShape] = useState<ShapeElement | null>(null);
  const [textInput, setTextInput] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 0, y: 0, visible: false });
  const [textValue, setTextValue] = useState("");
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("idle");
  const [activeResizeHandle, setActiveResizeHandle] =
    useState<ResizeHandle | null>(null);
  const [marqueeSelection, setMarqueeSelection] =
    useState<MarqueeSelection | null>(null);
  const [clipboardElements, setClipboardElements] = useState<
    WhiteboardElement[]
  >([]);
  const [liveElementOverrides, setLiveElementOverrides] = useState<
    Record<string, WhiteboardElement>
  >({});

  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const selectionInteractionRef = useRef<SelectionInteraction | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawFrameRef = useRef<number | null>(null);
  const pendingSyncElementsRef = useRef<WhiteboardElement[] | null>(null);
  const liveElementOverridesRef = useRef<Record<string, WhiteboardElement>>({});

  const isShapeTool = ["rectangle", "circle", "line", "arrow"].includes(
    drawingState.tool,
  );
  const isTextTool = drawingState.tool === "text";
  const isStickyTool = drawingState.tool === "sticky";
  const isDrawingTool = ["brush", "eraser"].includes(drawingState.tool);
  const isSelectTool = drawingState.tool === "select";

  const handleStrokeCompleteInternal = useCallback(
    (stroke: DrawStroke) => {
      onStrokeComplete(stroke);

      if (stroke.tool !== "eraser") {
        return;
      }

      const erasedShapes = elements
        .filter((element) => ERASABLE_SHAPE_TYPES.has(element.type))
        .filter((element) => strokeHitsElement(stroke, element))
        .map((element) => element as ShapeElement);

      if (erasedShapes.length === 0) {
        return;
      }

      erasedShapes.forEach((shape) => {
        const remainingSegments = splitRemainingShapeSegments(shape, stroke);
        onElementDelete(shape.id, { captureHistory: false });

        remainingSegments.forEach((points) => {
          onStrokeComplete(
            {
              id: generateId(),
              type: "stroke",
              points,
              color: shape.color,
              size: shape.strokeWidth,
              tool: "brush",
              userId,
            },
            { captureHistory: false },
          );
        });
      });
    },
    [elements, onElementDelete, onStrokeComplete, userId],
  );

  const {
    canvasRef,
    handleMouseDown: originalHandleMouseDown,
    handleMouseMove,
    handleMouseUp: originalHandleMouseUp,
    handleMouseLeave: originalHandleMouseLeave,
  } = useCanvasDrawing({
    onStrokeComplete: handleStrokeCompleteInternal,
    drawingState,
    userId,
  });

  const resolvedElements = useMemo(
    () =>
      elements.map((element) => liveElementOverrides[element.id] ?? element),
    [elements, liveElementOverrides],
  );

  const resolvedElementMap = useMemo(
    () => new Map(resolvedElements.map((element) => [element.id, element])),
    [resolvedElements],
  );

  const selectedElements = useMemo(
    () =>
      selectedElementIds
        .map((elementId) => resolvedElementMap.get(elementId))
        .filter((element): element is WhiteboardElement => Boolean(element)),
    [resolvedElementMap, selectedElementIds],
  );

  const singleSelectedElement =
    selectedElements.length === 1 ? selectedElements[0] : null;
  const selectionBounds = useMemo(
    () => getSelectionBounds(selectedElements),
    [selectedElements],
  );
  const contentBounds = useMemo(
    () => getBoardContentBounds(strokes, elements),
    [elements, strokes],
  );

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

  const fitToScreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    hasViewportInteractionRef.current = false;
    hasInitializedViewportRef.current = true;
    setViewState(
      getFitView(
        container.clientWidth,
        container.clientHeight,
        contentBounds,
      ),
    );
  }, [contentBounds]);

  const resetZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    hasViewportInteractionRef.current = true;
    hasInitializedViewportRef.current = true;
    setViewState(getCenteredView(container.clientWidth, container.clientHeight, 1));
  }, []);

  const zoomAtPoint = useCallback((nextZoom: number, anchorX: number, anchorY: number) => {
    setViewState((previousState) => {
      const clampedZoom = clampZoom(nextZoom);
      const worldX = (anchorX - previousState.panX) / previousState.zoom;
      const worldY = (anchorY - previousState.panY) / previousState.zoom;

      return {
        zoom: clampedZoom,
        panX: anchorX - worldX * clampedZoom,
        panY: anchorY - worldY * clampedZoom,
      };
    });
  }, []);

  const zoomIn = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    hasViewportInteractionRef.current = true;
    zoomAtPoint(
      viewState.zoom * ZOOM_STEP,
      container.clientWidth / 2,
      container.clientHeight / 2,
    );
  }, [viewState.zoom, zoomAtPoint]);

  const zoomOut = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    hasViewportInteractionRef.current = true;
    zoomAtPoint(
      viewState.zoom / ZOOM_STEP,
      container.clientWidth / 2,
      container.clientHeight / 2,
    );
  }, [viewState.zoom, zoomAtPoint]);

  const centerViewOnPoint = useCallback((point: Point, nextZoom?: number) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    hasViewportInteractionRef.current = true;
    hasInitializedViewportRef.current = true;

    setViewState((previousState) => {
      const resolvedZoom = clampZoom(nextZoom ?? previousState.zoom);
      return {
        zoom: resolvedZoom,
        panX: container.clientWidth / 2 - point.x * resolvedZoom,
        panY: container.clientHeight / 2 - point.y * resolvedZoom,
      };
    });
  }, []);

  const clearPendingSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    pendingSyncElementsRef.current = null;
  }, []);

  const dispatchElementSync = useCallback(
    (nextElements: WhiteboardElement[]) => {
      nextElements.forEach((element) => {
        onElementUpdate(element.id, getElementUpdates(element));
      });
    },
    [onElementUpdate],
  );

  const queueElementSync = useCallback(
    (nextElements: WhiteboardElement[]) => {
      pendingSyncElementsRef.current = nextElements;

      if (syncTimeoutRef.current) {
        return;
      }

      syncTimeoutRef.current = setTimeout(() => {
        syncTimeoutRef.current = null;
        const pendingElements = pendingSyncElementsRef.current;
        pendingSyncElementsRef.current = null;

        if (pendingElements) {
          dispatchElementSync(pendingElements);
        }
      }, LIVE_UPDATE_DELAY);
    },
    [dispatchElementSync],
  );

  const flushElementSync = useCallback(
    (nextElements?: WhiteboardElement[]) => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }

      const pendingElements = nextElements ?? pendingSyncElementsRef.current;
      pendingSyncElementsRef.current = null;

      if (pendingElements && pendingElements.length > 0) {
        dispatchElementSync(pendingElements);
      }
    },
    [dispatchElementSync],
  );

  const clearSelection = useCallback(() => {
    clearPendingSync();
    setSelectedElementIds([]);
    setSelectionMode("idle");
    setActiveResizeHandle(null);
    setMarqueeSelection(null);
    liveElementOverridesRef.current = {};
    setLiveElementOverrides({});
    selectionInteractionRef.current = null;
  }, [clearPendingSync]);

  const copySelection = useCallback(() => {
    if (selectedElements.length === 0) {
      return false;
    }

    setClipboardElements(selectedElements.map((element) => ({ ...element })));
    return true;
  }, [selectedElements]);

  const pasteElements = useCallback(
    (sourceElements: WhiteboardElement[]) => {
      if (sourceElements.length === 0) {
        return false;
      }

      const duplicatedElements = sourceElements.map((element) =>
        cloneElementWithOffset(
          element,
          generateId(),
          PASTE_OFFSET,
          PASTE_OFFSET,
          userId,
        ),
      );

      duplicatedElements.forEach((element) => {
        onElementAdd(element);
      });

      setClipboardElements(duplicatedElements.map((element) => ({ ...element })));
      setSelectedElementIds(duplicatedElements.map((element) => element.id));
      setSelectionMode("idle");
      setActiveResizeHandle(null);

      return true;
    },
    [onElementAdd, userId],
  );

  const pasteClipboard = useCallback(() => {
    return pasteElements(clipboardElements);
  }, [clipboardElements, pasteElements]);

  const duplicateSelection = useCallback(() => {
    return pasteElements(selectedElements);
  }, [pasteElements, selectedElements]);

  const deleteSelection = useCallback(() => {
    if (selectedElementIds.length === 0) {
      return false;
    }

    selectedElementIds.forEach((elementId) => {
      onElementDelete(elementId);
    });
    clearSelection();

    return true;
  }, [
    clearSelection,
    onElementDelete,
    selectedElementIds,
  ]);

  useEffect(() => {
    return () => {
      clearPendingSync();
    };
  }, [clearPendingSync]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateViewport = () => {
      if (!hasInitializedViewportRef.current) {
        hasInitializedViewportRef.current = true;
        setViewState(
          getFitView(
            container.clientWidth,
            container.clientHeight,
            contentBounds,
          ),
        );
        return;
      }

      if (hasViewportInteractionRef.current) {
        setViewState((previousState) => ({
          ...previousState,
          panX: clamp(previousState.panX, -CANVAS_WIDTH * previousState.zoom, container.clientWidth),
          panY: clamp(previousState.panY, -CANVAS_HEIGHT * previousState.zoom, container.clientHeight),
        }));
        return;
      }

      setViewState((previousState) => ({
        ...previousState,
        panX: clamp(previousState.panX, -CANVAS_WIDTH * previousState.zoom, container.clientWidth),
        panY: clamp(previousState.panY, -CANVAS_HEIGHT * previousState.zoom, container.clientHeight),
      }));
    };

    updateViewport();

    const observer = new ResizeObserver(() => {
      updateViewport();
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, [contentBounds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      event.preventDefault();
      setIsSpacePressed(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      setIsSpacePressed(false);
      setIsViewportPanning(false);
      panSessionRef.current = null;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!isViewportPanning) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const session = panSessionRef.current;
      if (!session) {
        return;
      }

      hasViewportInteractionRef.current = true;
      setViewState((previousState) => ({
        ...previousState,
        panX: session.startPanX + (event.clientX - session.startClientX),
        panY: session.startPanY + (event.clientY - session.startClientY),
      }));
    };

    const handleMouseUp = () => {
      setIsViewportPanning(false);
      panSessionRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isViewportPanning]);

  useEffect(() => {
    setSelectedElementIds((previousIds) => {
      const nextIds = previousIds.filter((elementId) =>
        elements.some((element) => element.id === elementId),
      );

      return nextIds.length === previousIds.length ? previousIds : nextIds;
    });
  }, [elements]);

  useEffect(() => {
    if (!isSelectTool) {
      clearSelection();
    }
  }, [clearSelection, isSelectTool]);

  useEffect(() => {
    if (!followCursor) {
      return;
    }

    centerViewOnPoint({ x: followCursor.x, y: followCursor.y });
  }, [centerViewOnPoint, followCursor]);

  const drawSelectionOverlay = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (selectionBounds) {
        ctx.save();
        ctx.strokeStyle = "#2563EB";
        ctx.fillStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(
          selectionBounds.left,
          selectionBounds.top,
          selectionBounds.width,
          selectionBounds.height,
        );
        ctx.setLineDash([]);

        if (singleSelectedElement) {
          const handlePositions = getResizeHandlePositions(singleSelectedElement);
          getResizeHandlesForElement(singleSelectedElement).forEach((handle) => {
            const handlePoint = handlePositions[handle];
            ctx.beginPath();
            ctx.rect(handlePoint.x - 5, handlePoint.y - 5, 10, 10);
            ctx.fill();
            ctx.stroke();
          });
        }

        ctx.restore();
      }

      if (marqueeSelection) {
        const left = Math.min(marqueeSelection.start.x, marqueeSelection.end.x);
        const top = Math.min(marqueeSelection.start.y, marqueeSelection.end.y);
        const width = Math.abs(marqueeSelection.end.x - marqueeSelection.start.x);
        const height = Math.abs(
          marqueeSelection.end.y - marqueeSelection.start.y,
        );

        ctx.save();
        ctx.fillStyle = "rgba(37, 99, 235, 0.08)";
        ctx.strokeStyle = "#2563EB";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 6]);
        ctx.fillRect(left, top, width, height);
        ctx.strokeRect(left, top, width, height);
        ctx.restore();
      }
    },
    [marqueeSelection, selectionBounds, singleSelectedElement],
  );

  const renderScene = useCallback(
    (
      targetCanvas: HTMLCanvasElement,
      options: {
        includePreviewShape: boolean;
        includeSelectionOverlay: boolean;
      },
    ) => {
      const ctx = targetCanvas.getContext("2d");
      if (!ctx) {
        return;
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
      strokes.forEach((stroke) => drawStrokePath(ctx, stroke));

      const allElements =
        options.includePreviewShape && previewShape
          ? [...resolvedElements, previewShape]
          : resolvedElements;

      allElements.forEach((element) => {
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        switch (element.type) {
          case "rectangle": {
            const bounds = getElementBounds(element);
            ctx.strokeStyle = element.color;
            ctx.lineWidth = element.strokeWidth;
            ctx.beginPath();
            ctx.rect(bounds.left, bounds.top, bounds.width, bounds.height);
            if (element.fill) {
              ctx.fillStyle = element.fill;
              ctx.fill();
            }
            ctx.stroke();
            break;
          }

          case "circle": {
            const bounds = getElementBounds(element);
            ctx.strokeStyle = element.color;
            ctx.lineWidth = element.strokeWidth;
            ctx.beginPath();
            ctx.ellipse(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
              bounds.width / 2,
              bounds.height / 2,
              0,
              0,
              Math.PI * 2,
            );
            if (element.fill) {
              ctx.fillStyle = element.fill;
              ctx.fill();
            }
            ctx.stroke();
            break;
          }

          case "line": {
            ctx.strokeStyle = element.color;
            ctx.lineWidth = element.strokeWidth;
            ctx.beginPath();
            ctx.moveTo(element.x, element.y);
            ctx.lineTo(element.x + element.width, element.y + element.height);
            ctx.stroke();
            break;
          }

          case "arrow": {
            const endX = element.x + element.width;
            const endY = element.y + element.height;
            const angle = Math.atan2(element.height, element.width);
            const headLength = 15;

            ctx.strokeStyle = element.color;
            ctx.lineWidth = element.strokeWidth;
            ctx.beginPath();
            ctx.moveTo(element.x, element.y);
            ctx.lineTo(endX, endY);
            ctx.stroke();

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
          }

          case "text": {
            const lines = element.text.split("\n");
            const lineHeight = getLineHeight(element.fontSize);

            ctx.fillStyle = element.color;
            ctx.font = `${element.fontSize}px sans-serif`;
            lines.forEach((line, lineIndex) => {
              ctx.fillText(
                line,
                element.x,
                element.y + element.fontSize + lineIndex * lineHeight,
              );
            });
            break;
          }

          case "sticky": {
            ctx.fillStyle = element.color;
            ctx.fillRect(element.x, element.y, element.width, element.height);
            ctx.strokeStyle = "#00000022";
            ctx.strokeRect(element.x, element.y, element.width, element.height);
            ctx.fillStyle = "#111827";
            ctx.font = "16px sans-serif";
            const lines = element.text.split("\n");
            lines.forEach((line, lineIndex) => {
              ctx.fillText(
                line,
                element.x + 10,
                element.y + 25 + lineIndex * 20,
              );
            });
            break;
          }
        }

        ctx.restore();
      });

      if (options.includeSelectionOverlay) {
        drawSelectionOverlay(ctx);
      }
    },
    [drawSelectionOverlay, previewShape, resolvedElements, strokes],
  );

  const drawElements = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    renderScene(canvas, {
      includePreviewShape: true,
      includeSelectionOverlay: isSelectTool,
    });
  }, [canvasRef, isSelectTool, renderScene]);

  useImperativeHandle(
    ref,
    () => ({
      clearSelection,
      copySelection,
      deleteSelection,
      duplicateSelection,
      getCanvasElement: () => canvasRef.current,
      getExportCanvas: () => {
        if (typeof document === "undefined") {
          return null;
        }

        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = CANVAS_WIDTH;
        exportCanvas.height = CANVAS_HEIGHT;
        renderScene(exportCanvas, {
          includePreviewShape: false,
          includeSelectionOverlay: false,
        });

        return exportCanvas;
      },
      hasSelection: () => selectedElementIds.length > 0,
      isEditingText: () => textInput.visible,
      jumpToPoint: (point: Point, zoom?: number) => centerViewOnPoint(point, zoom),
      pasteClipboard,
    }),
    [
      canvasRef,
      centerViewOnPoint,
      clearSelection,
      copySelection,
      deleteSelection,
      duplicateSelection,
      pasteClipboard,
      renderScene,
      selectedElementIds.length,
      textInput.visible,
    ],
  );

  useEffect(() => {
    if (drawFrameRef.current !== null) {
      cancelAnimationFrame(drawFrameRef.current);
    }

    drawFrameRef.current = requestAnimationFrame(() => {
      drawFrameRef.current = null;
      drawElements();
    });

    return () => {
      if (drawFrameRef.current !== null) {
        cancelAnimationFrame(drawFrameRef.current);
        drawFrameRef.current = null;
      }
    };
  }, [drawElements]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [canvasRef]);

  const handleSelectMouseDown = useCallback(
    (point: Point, shiftKey: boolean) => {
      const currentSingleSelected =
        selectedElements.length === 1 ? selectedElements[0] : null;

      if (currentSingleSelected) {
        const resizeHandle = getResizeHandleAtPoint(
          currentSingleSelected,
          point,
        );

        if (resizeHandle) {
          selectionInteractionRef.current = {
            type: "resizing",
            startPoint: point,
            elementId: currentSingleSelected.id,
            handle: resizeHandle,
            originalElement: currentSingleSelected,
            historyCaptured: false,
          };
          setSelectionMode("resizing");
          setActiveResizeHandle(resizeHandle);
          setMarqueeSelection(null);
          return;
        }
      }

      const hitElement = getTopmostElementAtPoint(resolvedElements, point);

      if (hitElement) {
        const nextSelectedIds = shiftKey
          ? selectedElementIds.includes(hitElement.id)
            ? selectedElementIds
            : [...selectedElementIds, hitElement.id]
          : selectedElementIds.includes(hitElement.id)
            ? selectedElementIds
            : [hitElement.id];

        setSelectedElementIds(nextSelectedIds);
        setSelectionMode("dragging");
        setActiveResizeHandle(null);
        setMarqueeSelection(null);
        selectionInteractionRef.current = {
          type: "dragging",
          startPoint: point,
          elementIds: nextSelectedIds,
          originalElements: buildElementMap(nextSelectedIds, resolvedElementMap),
          historyCaptured: false,
        };
        return;
      }

      const initialSelectionIds = shiftKey ? selectedElementIds : [];
      setSelectedElementIds(initialSelectionIds);
      setSelectionMode("marquee");
      setActiveResizeHandle(null);
      setMarqueeSelection({ start: point, end: point });
      selectionInteractionRef.current = {
        type: "marquee",
        startPoint: point,
        initialSelectionIds,
      };
    },
    [resolvedElementMap, resolvedElements, selectedElementIds, selectedElements],
  );

  const startViewportPan = useCallback(
    (clientX: number, clientY: number) => {
      panSessionRef.current = {
        startClientX: clientX,
        startClientY: clientY,
        startPanX: viewState.panX,
        startPanY: viewState.panY,
      };
      setIsViewportPanning(true);
    },
    [viewState.panX, viewState.panY],
  );

  const handleContainerMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!(isSpacePressed || event.button === 1)) {
        return;
      }

      event.preventDefault();
      hasViewportInteractionRef.current = true;
      startViewportPan(event.clientX, event.clientY);
    },
    [isSpacePressed, startViewportPan],
  );

  const handleContainerWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      event.preventDefault();
      hasViewportInteractionRef.current = true;

      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) {
        return;
      }

      const zoomDirection = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAtPoint(
        viewState.zoom * zoomDirection,
        event.clientX - containerRect.left,
        event.clientY - containerRect.top,
      );
    },
    [viewState.zoom, zoomAtPoint],
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) {
      return;
    }

    if (isSpacePressed || isViewportPanning) {
      e.preventDefault();
      return;
    }

    const point = getCanvasPoint(e);

    if (activeReactionKind && onReactionAdd) {
      onReactionAdd({
        id: generateId(),
        x: point.x,
        y: point.y,
        kind: activeReactionKind,
        userId,
        clientId: userId,
        userName: "",
        createdAt: Date.now(),
      });
      return;
    }

    if (isSelectTool) {
      handleSelectMouseDown(point, e.shiftKey);
      return;
    }

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
        version: 1,
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

  const handleSelectionInteraction = useCallback(
    (point: Point, shiftKey: boolean) => {
      const interaction = selectionInteractionRef.current;
      if (!interaction) {
        return;
      }

      if (interaction.type === "marquee") {
        const marqueeBounds = {
          left: Math.min(interaction.startPoint.x, point.x),
          top: Math.min(interaction.startPoint.y, point.y),
          right: Math.max(interaction.startPoint.x, point.x),
          bottom: Math.max(interaction.startPoint.y, point.y),
          width: Math.abs(point.x - interaction.startPoint.x),
          height: Math.abs(point.y - interaction.startPoint.y),
        };

        // Marquee selection uses intersection so partial overlaps count.
        const intersectingIds = resolvedElements
          .filter((element) =>
            boundsIntersect(getElementBounds(element), marqueeBounds),
          )
          .map((element) => element.id);

        const nextSelectedIds = shiftKey
          ? Array.from(
              new Set([...interaction.initialSelectionIds, ...intersectingIds]),
            )
          : intersectingIds;

        setMarqueeSelection({ start: interaction.startPoint, end: point });
        setSelectedElementIds(nextSelectedIds);
        return;
      }

      const deltaX = point.x - interaction.startPoint.x;
      const deltaY = point.y - interaction.startPoint.y;

      if (!interaction.historyCaptured && (deltaX !== 0 || deltaY !== 0)) {
        onSelectionMutationStart();
        if (interaction.type === "dragging") {
          selectionInteractionRef.current = {
            ...interaction,
            historyCaptured: true,
          };
        } else {
          selectionInteractionRef.current = {
            ...interaction,
            historyCaptured: true,
          };
        }
      }

      if (interaction.type === "dragging") {
        const updatedElements = interaction.elementIds
          .map((elementId) => interaction.originalElements[elementId])
          .filter(Boolean)
          .map((element) => translateElement(element, deltaX, deltaY));

        const nextOverrides = updatedElements.reduce<
          Record<string, WhiteboardElement>
        >((result, element) => {
          result[element.id] = element;
          return result;
        }, {});

        liveElementOverridesRef.current = nextOverrides;
        setLiveElementOverrides(nextOverrides);
        queueElementSync(updatedElements);
        return;
      }

      const resizedElement = resizeElement(
        interaction.originalElement,
        interaction.handle,
        deltaX,
        deltaY,
      );

      liveElementOverridesRef.current = { [resizedElement.id]: resizedElement };
      setLiveElementOverrides({ [resizedElement.id]: resizedElement });
      queueElementSync([resizedElement]);
    },
    [onSelectionMutationStart, queueElementSync, resolvedElements],
  );

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);

    if (isSelectTool) {
      handleSelectionInteraction(point, e.shiftKey);
    } else if (isShapeTool && shapeStart && isDrawing) {
      const deltaX = point.x - shapeStart.x;
      const deltaY = point.y - shapeStart.y;

      const shape: ShapeElement =
        drawingState.tool === "line" || drawingState.tool === "arrow"
          ? {
              id: generateId(),
              version: 1,
              type: drawingState.tool,
              x: shapeStart.x,
              y: shapeStart.y,
              width: deltaX,
              height: deltaY,
              color: drawingState.color,
              strokeWidth: drawingState.size,
              userId,
            }
          : {
              id: generateId(),
              version: 1,
              type: drawingState.tool as "rectangle" | "circle",
              x: Math.min(shapeStart.x, point.x),
              y: Math.min(shapeStart.y, point.y),
              width: Math.abs(deltaX),
              height: Math.abs(deltaY),
              color: drawingState.color,
              strokeWidth: drawingState.size,
              userId,
            };

      setPreviewShape(shape);
    } else if (isDrawingTool) {
      handleMouseMove(e);
    }

    if (onMouseMove) {
      onMouseMove(point.x, point.y, isDrawing);
    }
  };

  const finishSelectionInteraction = useCallback(() => {
    const interaction = selectionInteractionRef.current;
    if (!interaction) {
      return;
    }

    if (interaction.type === "dragging" || interaction.type === "resizing") {
      const finalElements = Object.values(liveElementOverridesRef.current);

      if (finalElements.length > 0) {
        flushElementSync(finalElements);
        liveElementOverridesRef.current = {};
        setLiveElementOverrides({});
        if (interaction.historyCaptured) {
          onSelectionMutationEnd();
        }
      } else {
        clearPendingSync();
      }
    }

    selectionInteractionRef.current = null;
    setSelectionMode("idle");
    setActiveResizeHandle(null);
    setMarqueeSelection(null);
  }, [clearPendingSync, flushElementSync, onSelectionMutationEnd]);

  const handleMouseUp = () => {
    if (isSelectTool) {
      finishSelectionInteraction();
      return;
    }

    if (isShapeTool) {
      if (shapeStart && previewShape) {
        onElementAdd(previewShape);
      }
      setShapeStart(null);
      setPreviewShape(null);
    }

    setIsDrawing(false);
    if (isDrawingTool) {
      originalHandleMouseUp();
    }
  };

  const handleMouseLeave = () => {
    if (isSelectTool) {
      finishSelectionInteraction();
      return;
    }

    setIsDrawing(false);
    setShapeStart(null);
    setPreviewShape(null);
    if (isDrawingTool) {
      originalHandleMouseLeave();
    }
  };

  const handleTextSubmit = () => {
    if (textValue.trim() && textInput.visible) {
      const text: TextElement = {
        id: generateId(),
        version: 1,
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
    if (isViewportPanning) {
      return "grabbing";
    }

    if (isSpacePressed) {
      return "grab";
    }

    if (selectionMode === "dragging") {
      return "grabbing";
    }

    if (selectionMode === "resizing") {
      return getResizeCursor(activeResizeHandle);
    }

    if (activeReactionKind) {
      return "crosshair";
    }

    switch (drawingState.tool) {
      case "select":
        return selectedElementIds.length > 0 ? "move" : "default";
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
      onMouseDown={handleContainerMouseDown}
      onWheel={handleContainerWheel}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: `${CANVAS_WIDTH}px`,
          height: `${CANVAS_HEIGHT}px`,
          transform: `translate(${viewState.panX}px, ${viewState.panY}px) scale(${viewState.zoom})`,
          transformOrigin: "top left",
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="absolute inset-0 rounded-xl"
          style={{
            width: `${CANVAS_WIDTH}px`,
            height: `${CANVAS_HEIGHT}px`,
            cursor: getCursor(),
            background: "transparent",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
      </div>

      {textInput.visible && containerRef.current && (
        <div
          className="absolute"
          style={{
            left: worldToScreen({ x: textInput.x, y: textInput.y }, viewState).x,
            top: worldToScreen({ x: textInput.x, y: textInput.y }, viewState).y,
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

      {Array.from(cursors.entries()).map(([cursorUserId, cursor]) => {
        if (cursorUserId === userId) return null;

        const userColor = getUserColor(cursor.clientId);
        const isUserDrawing = cursor.status === "drawing";
        const screenPoint = worldToScreen(
          { x: cursor.x, y: cursor.y },
          viewState,
        );

        return (
          <div
            key={cursorUserId}
            className="absolute pointer-events-none transition-all duration-75 ease-out"
            style={{
              left: screenPoint.x,
              top: screenPoint.y,
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

      {reactions.map((reaction) => {
        const userColor = getUserColor(reaction.clientId);
        const reactionMeta = getReactionMeta(reaction.kind);
        const screenPoint = worldToScreen(
          { x: reaction.x, y: reaction.y },
          viewState,
        );
        const isPing = reaction.kind === "ping";

        return (
          <div
            key={reaction.id}
            className="absolute pointer-events-none"
            style={{
              left: screenPoint.x,
              top: screenPoint.y,
              transform: "translate(-50%, -50%)",
            }}
          >
            {isPing ? (
              <div className="relative flex items-center justify-center">
                <span
                  className={`absolute h-16 w-16 rounded-full opacity-25 animate-ping ${userColor.bg}`}
                />
                <span
                  className={`relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-white text-lg font-semibold text-white shadow-xl ${userColor.bg}`}
                >
                  {reactionMeta.badge}
                </span>
              </div>
            ) : (
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-white text-lg font-semibold text-white shadow-xl animate-bounce ${userColor.bg}`}
              >
                {reactionMeta.badge}
              </div>
            )}
            <span className="mt-2 inline-flex rounded-full bg-white/95 px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm">
              {reaction.userName} {reactionMeta.caption}
            </span>
          </div>
        );
      })}

      {followUserName && (
        <div className="absolute left-4 top-4 rounded-xl border border-primary-100 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-500">
            Follow Mode
          </p>
          <p className="text-sm font-medium text-gray-700">
            Centering on {followUserName}
          </p>
        </div>
      )}

      {activeReactionKind && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-primary-100 bg-white/95 px-4 py-2 text-sm font-medium text-gray-700 shadow-lg backdrop-blur-sm">
          Click anywhere on the board to place a {getReactionMeta(activeReactionKind).label.toLowerCase()}.
        </div>
      )}

      <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 shadow-lg border border-gray-200 backdrop-blur-sm">
        <button
          onClick={zoomOut}
          className="w-8 h-8 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
          title="Zoom out"
        >
          -
        </button>
        <button
          onClick={resetZoom}
          className="min-w-[72px] px-2 py-1.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          title="Reset zoom"
        >
          {Math.round(viewState.zoom * 100)}%
        </button>
        <button
          onClick={zoomIn}
          className="w-8 h-8 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
          title="Zoom in"
        >
          +
        </button>
        <div className="w-px h-6 bg-gray-200" />
        <button
          onClick={fitToScreen}
          className="px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          title="Fit board to screen"
        >
          Fit
        </button>
        <span className="hidden sm:inline text-xs text-gray-400">
          Hold Space to pan
        </span>
      </div>
    </div>
  );
});
