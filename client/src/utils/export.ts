import type { BoardMetadata, DrawStroke, WhiteboardElement } from '../types';

export interface ExportData {
  version: 2;
  exportedAt: string;
  metadata: BoardMetadata;
  content: {
    strokes: DrawStroke[];
    elements: WhiteboardElement[];
  };
}

interface LegacyExportData {
  version: 1;
  exportedAt: string;
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
}

export interface ParsedImportData {
  metadata: BoardMetadata;
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
}

function normalizeElement(element: WhiteboardElement): WhiteboardElement {
  return {
    ...element,
    version: Math.max(1, element.version ?? 1),
  };
}

function createMetadata(
  metadata: Partial<BoardMetadata> | undefined,
  fallbackId: string,
): BoardMetadata {
  const now = new Date().toISOString();

  return {
    id: metadata?.id || fallbackId,
    title: metadata?.title || `Board ${fallbackId}`,
    createdAt: metadata?.createdAt || now,
    updatedAt: metadata?.updatedAt || now,
    revision: Math.max(0, metadata?.revision ?? 0),
    ownerId: metadata?.ownerId,
    accessLevel: metadata?.accessLevel === 'private' ? 'private' : 'public',
    shareLink: metadata?.shareLink || fallbackId,
  };
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { x?: unknown }).x === 'number' &&
      typeof (value as { y?: unknown }).y === 'number',
  );
}

function isStroke(value: unknown): value is DrawStroke {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const stroke = value as Partial<DrawStroke>;
  return (
    typeof stroke.id === 'string' &&
    Array.isArray(stroke.points) &&
    stroke.points.every(isPoint) &&
    typeof stroke.color === 'string' &&
    typeof stroke.size === 'number' &&
    (stroke.tool === 'brush' || stroke.tool === 'eraser') &&
    typeof stroke.userId === 'string'
  );
}

function isElement(value: unknown): value is WhiteboardElement {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const element = value as Partial<WhiteboardElement>;
  if (
    typeof element.id !== 'string' ||
    typeof element.userId !== 'string' ||
    typeof element.x !== 'number' ||
    typeof element.y !== 'number' ||
    typeof element.type !== 'string'
  ) {
    return false;
  }

  switch (element.type) {
    case 'text':
      return (
        typeof element.text === 'string' &&
        typeof element.fontSize === 'number' &&
        typeof element.color === 'string'
      );
    case 'sticky':
      return (
        typeof element.width === 'number' &&
        typeof element.height === 'number' &&
        typeof element.text === 'string' &&
        typeof element.color === 'string'
      );
    case 'rectangle':
    case 'circle':
    case 'line':
    case 'arrow':
      return (
        typeof element.width === 'number' &&
        typeof element.height === 'number' &&
        typeof element.color === 'string' &&
        typeof element.strokeWidth === 'number'
      );
    default:
      return false;
  }
}

export function exportToJSON(
  strokes: DrawStroke[],
  elements: WhiteboardElement[],
  metadata?: Partial<BoardMetadata>,
): string {
  const resolvedMetadata = createMetadata(metadata, metadata?.id || 'whiteboard');
  const data: ExportData = {
    version: 2,
    exportedAt: new Date().toISOString(),
    metadata: resolvedMetadata,
    content: {
      strokes,
      elements: elements.map((element) => normalizeElement(element)),
    },
  };

  return JSON.stringify(data, null, 2);
}

export function downloadJSON(
  strokes: DrawStroke[],
  elements: WhiteboardElement[],
  filename: string = 'whiteboard',
  metadata?: Partial<BoardMetadata>,
): void {
  const json = exportToJSON(strokes, elements, metadata);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseImportData(jsonString: string): ParsedImportData | null {
  try {
    const data = JSON.parse(jsonString) as ExportData | LegacyExportData;

    if (
      data.version === 2 &&
      data.content &&
      Array.isArray(data.content.strokes) &&
      Array.isArray(data.content.elements)
    ) {
      if (
        !data.content.strokes.every(isStroke) ||
        !data.content.elements.every(isElement)
      ) {
        return null;
      }

      return {
        metadata: createMetadata(data.metadata, data.metadata?.id || 'imported-board'),
        strokes: data.content.strokes,
        elements: data.content.elements.map((element) => normalizeElement(element)),
      };
    }

    if (
      data.version === 1 &&
      Array.isArray(data.strokes) &&
      Array.isArray(data.elements)
    ) {
      if (!data.strokes.every(isStroke) || !data.elements.every(isElement)) {
        return null;
      }

      return {
        metadata: createMetadata(undefined, 'imported-board'),
        strokes: data.strokes,
        elements: data.elements.map((element) => normalizeElement(element)),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function exportToPNG(canvas: HTMLCanvasElement, filename: string = 'whiteboard'): Promise<void> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve();
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function getShareableLink(roomId: string, viewOnly: boolean = false): string {
  const baseUrl = window.location.origin;
  const params = viewOnly ? '?mode=view' : '';
  return `${baseUrl}?room=${roomId}${params}`;
}
