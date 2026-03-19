import { useRef, useCallback, useEffect, MouseEvent } from 'react';
import type { Point, DrawStroke, DrawingState } from '../types';

interface UseCanvasDrawingOptions {
  onStrokeComplete: (stroke: DrawStroke) => void;
  strokes: DrawStroke[];
  drawingState: DrawingState;
  userId: string;
}

export function useCanvasDrawing({
  onStrokeComplete,
  strokes,
  drawingState,
  userId,
}: UseCanvasDrawingOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<Point[]>([]);
  const lastPointRef = useRef<Point | null>(null);

  const getCanvasPoint = useCallback(
    (e: MouseEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    []
  );

  const drawStroke = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      stroke: DrawStroke,
      isPartial = false
    ) => {
      if (stroke.points.length < 2) return;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.size;

      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
      }

      ctx.beginPath();

      const startIndex = isPartial ? Math.max(0, stroke.points.length - 2) : 0;
      ctx.moveTo(stroke.points[startIndex].x, stroke.points[startIndex].y);

      for (let i = startIndex + 1; i < stroke.points.length; i++) {
        const p0 = stroke.points[i - 1];
        const p1 = stroke.points[i];

        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;

        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
      }

      const lastPoint = stroke.points[stroke.points.length - 1];
      ctx.lineTo(lastPoint.x, lastPoint.y);
      ctx.stroke();
      ctx.restore();
    },
    []
  );

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    strokes.forEach((stroke) => {
      drawStroke(ctx, stroke);
    });
  }, [strokes, drawStroke]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;

      isDrawingRef.current = true;
      const point = getCanvasPoint(e);
      currentPointsRef.current = [point];
      lastPointRef.current = point;
    },
    [getCanvasPoint]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const point = getCanvasPoint(e);
      currentPointsRef.current.push(point);

      const currentStroke: DrawStroke = {
        id: '',
        points: currentPointsRef.current,
        color: drawingState.color,
        size: drawingState.size,
        tool: drawingState.tool,
        userId,
      };

      drawStroke(ctx, currentStroke, true);
      lastPointRef.current = point;
    },
    [getCanvasPoint, drawingState, userId, drawStroke]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawingRef.current) return;

    isDrawingRef.current = false;

    if (currentPointsRef.current.length > 1) {
      const stroke: DrawStroke = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        points: [...currentPointsRef.current],
        color: drawingState.color,
        size: drawingState.size,
        tool: drawingState.tool,
        userId,
      };

      onStrokeComplete(stroke);
    }

    currentPointsRef.current = [];
    lastPointRef.current = null;
  }, [drawingState, userId, onStrokeComplete]);

  const handleMouseLeave = useCallback(() => {
    if (isDrawingRef.current) {
      handleMouseUp();
    }
  }, [handleMouseUp]);

  return {
    canvasRef,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    redrawCanvas,
  };
}

export function generateStrokeId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
