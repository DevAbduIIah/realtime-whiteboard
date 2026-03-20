import type { DrawStroke, WhiteboardElement } from '../types';

export interface ExportData {
  version: 1;
  exportedAt: string;
  strokes: DrawStroke[];
  elements: WhiteboardElement[];
}

export function exportToJSON(strokes: DrawStroke[], elements: WhiteboardElement[]): string {
  const data: ExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    strokes,
    elements,
  };
  return JSON.stringify(data, null, 2);
}

export function downloadJSON(strokes: DrawStroke[], elements: WhiteboardElement[], filename: string = 'whiteboard'): void {
  const json = exportToJSON(strokes, elements);
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

export function parseImportData(jsonString: string): ExportData | null {
  try {
    const data = JSON.parse(jsonString);
    if (data.version === 1 && Array.isArray(data.strokes)) {
      return data as ExportData;
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
