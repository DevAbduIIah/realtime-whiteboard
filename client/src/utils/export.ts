import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  getBoardSvgPresentation,
} from './boardPresentation';
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

function triggerDownload(
  url: string,
  filename: string,
  revokeAfterDownload: boolean = false,
): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  window.setTimeout(() => {
    document.body.removeChild(link);
    if (revokeAfterDownload) {
      URL.revokeObjectURL(url);
    }
  }, 250);
}

function normalizeElement(element: WhiteboardElement): WhiteboardElement {
  return {
    ...element,
    version: Math.max(1, element.version ?? 1),
    zIndex: typeof element.zIndex === 'number' ? element.zIndex : 0,
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
    ownerName: metadata?.ownerName,
    accessLevel: metadata?.accessLevel === 'private' ? 'private' : 'public',
    shareLink: metadata?.shareLink || fallbackId,
    inviteToken: metadata?.inviteToken,
    roomMode: metadata?.roomMode === 'readonly' ? 'readonly' : 'edit',
    theme: {
      background: metadata?.theme?.background || 'dots',
      template: metadata?.theme?.template || 'blank',
    },
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
  triggerDownload(url, `${filename}.json`, true);
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
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to create PNG export.'));
        return;
      }

      const url = URL.createObjectURL(blob);
      triggerDownload(url, `${filename}.png`, true);
      resolve();
    }, 'image/png');
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getSvgStrokePath(stroke: DrawStroke): string {
  if (stroke.points.length === 0) {
    return '';
  }

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    return `M ${point.x} ${point.y} L ${point.x + 0.01} ${point.y + 0.01}`;
  }

  const commands = [`M ${stroke.points[0].x} ${stroke.points[0].y}`];

  for (let index = 1; index < stroke.points.length; index += 1) {
    const previousPoint = stroke.points[index - 1];
    const currentPoint = stroke.points[index];
    const midX = (previousPoint.x + currentPoint.x) / 2;
    const midY = (previousPoint.y + currentPoint.y) / 2;
    commands.push(`Q ${previousPoint.x} ${previousPoint.y} ${midX} ${midY}`);
  }

  const lastPoint = stroke.points[stroke.points.length - 1];
  commands.push(`L ${lastPoint.x} ${lastPoint.y}`);
  return commands.join(' ');
}

function getLineHeight(fontSize: number): number {
  return fontSize * 1.2;
}

function getOrderedElements(elements: WhiteboardElement[]): WhiteboardElement[] {
  return [...elements].sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
}

export function exportToSVG(
  strokes: DrawStroke[],
  elements: WhiteboardElement[],
  metadata: Partial<BoardMetadata> | undefined,
): string {
  const resolvedMetadata = createMetadata(metadata, metadata?.id || 'whiteboard');
  const boardPresentation = getBoardSvgPresentation(resolvedMetadata);
  const strokeMarkup = strokes
    .map((stroke) => {
      const strokeColor = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
      return `<path d="${getSvgStrokePath(stroke)}" fill="none" stroke="${strokeColor}" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join('');
  const elementMarkup = getOrderedElements(elements)
    .map((element) => {
      switch (element.type) {
        case 'rectangle': {
          return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" fill="${element.fill || 'none'}" stroke="${element.color}" stroke-width="${element.strokeWidth}" rx="6" />`;
        }
        case 'circle': {
          return `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${Math.abs(element.width) / 2}" ry="${Math.abs(element.height) / 2}" fill="${element.fill || 'none'}" stroke="${element.color}" stroke-width="${element.strokeWidth}" />`;
        }
        case 'line': {
          return `<line x1="${element.x}" y1="${element.y}" x2="${element.x + element.width}" y2="${element.y + element.height}" stroke="${element.color}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />`;
        }
        case 'arrow': {
          const endX = element.x + element.width;
          const endY = element.y + element.height;
          const angle = Math.atan2(element.height, element.width);
          const headLength = 15;
          const leftHeadX = endX - headLength * Math.cos(angle - Math.PI / 6);
          const leftHeadY = endY - headLength * Math.sin(angle - Math.PI / 6);
          const rightHeadX = endX - headLength * Math.cos(angle + Math.PI / 6);
          const rightHeadY = endY - headLength * Math.sin(angle + Math.PI / 6);

          return `
            <line x1="${element.x}" y1="${element.y}" x2="${endX}" y2="${endY}" stroke="${element.color}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />
            <line x1="${endX}" y1="${endY}" x2="${leftHeadX}" y2="${leftHeadY}" stroke="${element.color}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />
            <line x1="${endX}" y1="${endY}" x2="${rightHeadX}" y2="${rightHeadY}" stroke="${element.color}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />
          `;
        }
        case 'text': {
          return element.text
            .split('\n')
            .map(
              (line, index) =>
                `<text x="${element.x}" y="${element.y + element.fontSize + index * getLineHeight(element.fontSize)}" fill="${element.color}" font-size="${element.fontSize}" font-family="sans-serif">${escapeXml(line || ' ')}</text>`,
            )
            .join('');
        }
        case 'sticky': {
          const textMarkup = element.text
            .split('\n')
            .map(
              (line, index) =>
                `<text x="${element.x + 10}" y="${element.y + 25 + index * 20}" fill="#111827" font-size="16" font-family="sans-serif">${escapeXml(line || ' ')}</text>`,
            )
            .join('');
          return `
            <rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" fill="${element.color}" stroke="#00000022" stroke-width="1" rx="10" />
            ${textMarkup}
          `;
        }
        default:
          return '';
      }
    })
    .join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" fill="none">
      ${boardPresentation.defs}
      ${boardPresentation.markup}
      ${strokeMarkup}
      ${elementMarkup}
    </svg>
  `.trim();
}

export function downloadSVG(
  strokes: DrawStroke[],
  elements: WhiteboardElement[],
  filename: string = 'whiteboard',
  metadata?: Partial<BoardMetadata>,
): void {
  const svg = exportToSVG(strokes, elements, metadata);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${filename}.svg`, true);
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function parseShareableLink(search: string): {
  roomId: string;
  viewOnly: boolean;
  accessToken: string;
} {
  const searchParams = new URLSearchParams(search);
  const rawRoomId = searchParams.get('room') || '';
  const [roomId, nestedSearch = ''] = rawRoomId.split('?');
  const nestedParams = new URLSearchParams(nestedSearch);
  const accessToken =
    searchParams.get('access') ||
    nestedParams.get('access') ||
    '';

  return {
    roomId,
    viewOnly:
      searchParams.get('mode') === 'view' ||
      nestedParams.get('mode') === 'view',
    accessToken,
  };
}

export function getShareableLink(
  roomId: string,
  options?: {
    viewOnly?: boolean;
    accessToken?: string;
  },
): string {
  const url = new URL(window.location.origin);
  url.searchParams.set('room', roomId);

  if (options?.viewOnly) {
    url.searchParams.set('mode', 'view');
  }

  if (options?.accessToken) {
    url.searchParams.set('access', options.accessToken);
  }

  return url.toString();
}
