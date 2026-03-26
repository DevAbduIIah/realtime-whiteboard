import { useRef, useCallback, PointerEvent } from 'react';
import type { Point, DrawStroke, DrawingState } from '../types';

interface UseCanvasDrawingOptions {
  onStrokeComplete: (stroke: DrawStroke) => void;
  onStrokePreview?: (stroke: DrawStroke | null) => void;
  drawingState: DrawingState;
  userId: string;
}

export function useCanvasDrawing({
  onStrokeComplete,
  onStrokePreview,
  drawingState,
  userId,
}: UseCanvasDrawingOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<Point[]>([]);
  type CanvasPointerLike = {
    clientX: number;
    clientY: number;
  };

  const getCanvasPoint = useCallback(
    (event: CanvasPointerLike): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY,
      };
    },
    []
  );

  const finishStroke = useCallback(() => {
    if (!isDrawingRef.current) return;

    isDrawingRef.current = false;
    onStrokePreview?.(null);

    if (currentPointsRef.current.length > 1) {
      // Only handle brush and eraser tools
      const tool = drawingState.tool === 'brush' || drawingState.tool === 'eraser'
        ? drawingState.tool
        : 'brush';

      const stroke: DrawStroke = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        points: [...currentPointsRef.current],
        color: drawingState.color,
        size: drawingState.size,
        tool,
        userId,
      };

      onStrokeComplete(stroke);
    }

    currentPointsRef.current = [];
  }, [drawingState, onStrokeComplete, onStrokePreview, userId]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;

      isDrawingRef.current = true;
      const point = getCanvasPoint(event);
      currentPointsRef.current = [point];
      onStrokePreview?.(null);
    },
    [getCanvasPoint, onStrokePreview]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      if ((event.buttons & 1) !== 1) {
        finishStroke();
        return;
      }

      const point = getCanvasPoint(event);
      currentPointsRef.current.push(point);

      // Only handle brush and eraser tools
      const tool = drawingState.tool === 'brush' || drawingState.tool === 'eraser'
        ? drawingState.tool
        : 'brush';

      const currentStroke: DrawStroke = {
        id: '',
        points: currentPointsRef.current,
        color: drawingState.color,
        size: drawingState.size,
        tool,
        userId,
      };

      onStrokePreview?.(currentStroke);
    },
    [drawingState, finishStroke, getCanvasPoint, onStrokePreview, userId]
  );

  const handlePointerUp = useCallback(() => {
    finishStroke();
  }, [finishStroke]);

  return {
    canvasRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}

export function generateStrokeId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
