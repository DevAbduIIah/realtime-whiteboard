import type {
  Point,
  ResizeHandle,
  ShapeElement,
  StickyElement,
  TextElement,
  WhiteboardElement,
} from "../types";

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const HANDLE_SIZE = 10;
const TEXT_PADDING_X = 6;
const TEXT_PADDING_Y = 6;
const MIN_BOX_SIZE = 24;
const MIN_TEXT_SIZE = 12;
const TEXT_LINE_HEIGHT = 1.2;

let measurementContext: CanvasRenderingContext2D | null = null;

function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") {
    return null;
  }

  if (!measurementContext) {
    measurementContext = document.createElement("canvas").getContext("2d");
  }

  return measurementContext;
}

function normalizeBounds(
  left: number,
  top: number,
  right: number,
  bottom: number,
): Bounds {
  const normalizedLeft = Math.min(left, right);
  const normalizedRight = Math.max(left, right);
  const normalizedTop = Math.min(top, bottom);
  const normalizedBottom = Math.max(top, bottom);

  return {
    left: normalizedLeft,
    top: normalizedTop,
    right: normalizedRight,
    bottom: normalizedBottom,
    width: normalizedRight - normalizedLeft,
    height: normalizedBottom - normalizedTop,
  };
}

function getDistanceToSegment(
  point: Point,
  start: Point,
  end: Point,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clampedProjection = Math.max(0, Math.min(1, projection));

  const closestX = start.x + dx * clampedProjection;
  const closestY = start.y + dy * clampedProjection;

  return Math.hypot(point.x - closestX, point.y - closestY);
}

export function getTextBounds(element: TextElement): Bounds {
  const context = getMeasurementContext();
  const lines = element.text.split("\n");

  if (context) {
    context.font = `${element.fontSize}px sans-serif`;
  }

  const measuredWidth = lines.reduce((maxWidth, line) => {
    if (!context) {
      return Math.max(maxWidth, line.length * element.fontSize * 0.6);
    }

    return Math.max(maxWidth, context.measureText(line || " ").width);
  }, 0);

  const lineHeight = element.fontSize * TEXT_LINE_HEIGHT;
  const totalHeight = Math.max(lineHeight, lines.length * lineHeight);

  return {
    left: element.x - TEXT_PADDING_X,
    top: element.y - TEXT_PADDING_Y,
    right: element.x + measuredWidth + TEXT_PADDING_X,
    bottom: element.y + totalHeight + TEXT_PADDING_Y,
    width: measuredWidth + TEXT_PADDING_X * 2,
    height: totalHeight + TEXT_PADDING_Y * 2,
  };
}

export function getElementBounds(element: WhiteboardElement): Bounds {
  switch (element.type) {
    case "rectangle":
    case "circle":
    case "sticky":
      return normalizeBounds(
        element.x,
        element.y,
        element.x + element.width,
        element.y + element.height,
      );
    case "line":
    case "arrow":
      return normalizeBounds(
        element.x,
        element.y,
        element.x + element.width,
        element.y + element.height,
      );
    case "text":
      return getTextBounds(element);
    default:
      return normalizeBounds(0, 0, 0, 0);
  }
}

export function getSelectionBounds(elements: WhiteboardElement[]): Bounds | null {
  if (elements.length === 0) {
    return null;
  }

  return elements.reduce<Bounds | null>((combinedBounds, element) => {
    const bounds = getElementBounds(element);

    if (!combinedBounds) {
      return bounds;
    }

    return normalizeBounds(
      Math.min(combinedBounds.left, bounds.left),
      Math.min(combinedBounds.top, bounds.top),
      Math.max(combinedBounds.right, bounds.right),
      Math.max(combinedBounds.bottom, bounds.bottom),
    );
  }, null);
}

export function boundsIntersect(first: Bounds, second: Bounds): boolean {
  return !(
    first.right < second.left ||
    first.left > second.right ||
    first.bottom < second.top ||
    first.top > second.bottom
  );
}

export function pointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

export function hitTestElement(
  element: WhiteboardElement,
  point: Point,
): boolean {
  if (element.type === "line" || element.type === "arrow") {
    const strokeWidth = (element as ShapeElement).strokeWidth;
    const distance = getDistanceToSegment(
      point,
      { x: element.x, y: element.y },
      { x: element.x + element.width, y: element.y + element.height },
    );

    return distance <= Math.max(8, strokeWidth + 6);
  }

  return pointInBounds(point, getElementBounds(element));
}

export function getTopmostElementAtPoint(
  elements: WhiteboardElement[],
  point: Point,
): WhiteboardElement | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    if (hitTestElement(elements[index], point)) {
      return elements[index];
    }
  }

  return null;
}

export function getResizeHandlesForElement(
  element: WhiteboardElement,
): ResizeHandle[] {
  if (element.type === "line" || element.type === "arrow") {
    return ["start", "end"];
  }

  return ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
}

export function getResizeHandlePositions(
  element: WhiteboardElement,
): Record<ResizeHandle, Point> {
  if (element.type === "line" || element.type === "arrow") {
    return {
      n: { x: 0, y: 0 },
      ne: { x: 0, y: 0 },
      e: { x: 0, y: 0 },
      se: { x: 0, y: 0 },
      s: { x: 0, y: 0 },
      sw: { x: 0, y: 0 },
      w: { x: 0, y: 0 },
      nw: { x: 0, y: 0 },
      start: { x: element.x, y: element.y },
      end: { x: element.x + element.width, y: element.y + element.height },
    };
  }

  const bounds = getElementBounds(element);
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;

  return {
    nw: { x: bounds.left, y: bounds.top },
    n: { x: centerX, y: bounds.top },
    ne: { x: bounds.right, y: bounds.top },
    e: { x: bounds.right, y: centerY },
    se: { x: bounds.right, y: bounds.bottom },
    s: { x: centerX, y: bounds.bottom },
    sw: { x: bounds.left, y: bounds.bottom },
    w: { x: bounds.left, y: centerY },
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
  };
}

export function getResizeHandleAtPoint(
  element: WhiteboardElement,
  point: Point,
): ResizeHandle | null {
  const handlePositions = getResizeHandlePositions(element);

  for (const handle of getResizeHandlesForElement(element)) {
    const handlePoint = handlePositions[handle];
    const bounds = normalizeBounds(
      handlePoint.x - HANDLE_SIZE,
      handlePoint.y - HANDLE_SIZE,
      handlePoint.x + HANDLE_SIZE,
      handlePoint.y + HANDLE_SIZE,
    );

    if (pointInBounds(point, bounds)) {
      return handle;
    }
  }

  return null;
}

export function translateElement(
  element: WhiteboardElement,
  deltaX: number,
  deltaY: number,
): WhiteboardElement {
  if (element.type === "text") {
    return {
      ...element,
      x: element.x + deltaX,
      y: element.y + deltaY,
    };
  }

  if (element.type === "sticky") {
    return {
      ...element,
      x: element.x + deltaX,
      y: element.y + deltaY,
    };
  }

  return {
    ...element,
    x: element.x + deltaX,
    y: element.y + deltaY,
  };
}

function resizeBoxBounds(
  bounds: Bounds,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
): Bounds {
  let left = bounds.left;
  let right = bounds.right;
  let top = bounds.top;
  let bottom = bounds.bottom;

  if (handle.includes("w")) {
    left += deltaX;
  }
  if (handle.includes("e")) {
    right += deltaX;
  }
  if (handle.includes("n")) {
    top += deltaY;
  }
  if (handle.includes("s")) {
    bottom += deltaY;
  }

  if (Math.abs(right - left) < MIN_BOX_SIZE) {
    if (handle.includes("w")) {
      left = right - MIN_BOX_SIZE;
    } else if (handle.includes("e")) {
      right = left + MIN_BOX_SIZE;
    }
  }

  if (Math.abs(bottom - top) < MIN_BOX_SIZE) {
    if (handle.includes("n")) {
      top = bottom - MIN_BOX_SIZE;
    } else if (handle.includes("s")) {
      bottom = top + MIN_BOX_SIZE;
    }
  }

  return normalizeBounds(left, top, right, bottom);
}

export function resizeElement(
  element: WhiteboardElement,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
): WhiteboardElement {
  if (element.type === "line" || element.type === "arrow") {
    if (handle === "start") {
      return {
        ...element,
        x: element.x + deltaX,
        y: element.y + deltaY,
        width: element.width - deltaX,
        height: element.height - deltaY,
      };
    }

    return {
      ...element,
      width: element.width + deltaX,
      height: element.height + deltaY,
    };
  }

  const originalBounds = getElementBounds(element);
  const resizedBounds = resizeBoxBounds(originalBounds, handle, deltaX, deltaY);

  if (element.type === "text") {
    const widthScale = resizedBounds.width / Math.max(originalBounds.width, 1);
    const heightScale = resizedBounds.height / Math.max(originalBounds.height, 1);
    const nextFontSize = Math.max(
      MIN_TEXT_SIZE,
      Math.round(element.fontSize * Math.max(widthScale, heightScale)),
    );

    return {
      ...element,
      x: resizedBounds.left + TEXT_PADDING_X,
      y: resizedBounds.top + TEXT_PADDING_Y,
      fontSize: nextFontSize,
    };
  }

  return {
    ...element,
    x: resizedBounds.left,
    y: resizedBounds.top,
    width: resizedBounds.width,
    height: resizedBounds.height,
  } as ShapeElement | StickyElement;
}

export function cloneElementWithOffset(
  element: WhiteboardElement,
  id: string,
  offsetX: number,
  offsetY: number,
  userId: string,
): WhiteboardElement {
  const translated = translateElement(element, offsetX, offsetY);

  return {
    ...translated,
    id,
    version: 1,
    userId,
  } as WhiteboardElement;
}
