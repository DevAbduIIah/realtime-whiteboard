import type {
  BoardBackground,
  BoardMetadata,
  BoardTemplate,
} from "../types";

export const BOARD_WIDTH = 1920;
export const BOARD_HEIGHT = 1080;

interface TemplateColumn {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

export const BOARD_BACKGROUND_OPTIONS: Array<{
  id: BoardBackground;
  label: string;
  description: string;
}> = [
  {
    id: "dots",
    label: "Dots",
    description: "A light workshop board with dotted alignment markers.",
  },
  {
    id: "grid",
    label: "Grid",
    description: "A clean square grid for diagrams and wireframes.",
  },
  {
    id: "plain",
    label: "Plain",
    description: "Minimal whiteboard surface with no guide marks.",
  },
  {
    id: "blueprint",
    label: "Blueprint",
    description: "High-contrast drafting surface for structured planning.",
  },
  {
    id: "warm",
    label: "Warm",
    description: "Soft paper-like backdrop for notes and workshop boards.",
  },
];

export const BOARD_TEMPLATE_OPTIONS: Array<{
  id: BoardTemplate;
  label: string;
  description: string;
}> = [
  {
    id: "blank",
    label: "Blank",
    description: "Start with an empty canvas.",
  },
  {
    id: "kanban",
    label: "Kanban",
    description: "Three lanes for ideas, active work, and done items.",
  },
  {
    id: "retrospective",
    label: "Retro",
    description: "Workshop layout for wins, issues, and actions.",
  },
];

function getTemplateColumns(template: BoardTemplate): TemplateColumn[] {
  if (template === "blank") {
    return [];
  }

  const padding = 80;
  const headerHeight = 72;
  const columnGap = 24;
  const columnWidth = (BOARD_WIDTH - padding * 2 - columnGap * 2) / 3;
  const columnHeight = BOARD_HEIGHT - padding * 2 - headerHeight;
  const titles =
    template === "kanban"
      ? ["Ideas", "In Progress", "Done"]
      : ["Went Well", "Needs Work", "Action Items"];
  const fills =
    template === "kanban"
      ? ["rgba(59, 130, 246, 0.06)", "rgba(249, 115, 22, 0.06)", "rgba(16, 185, 129, 0.06)"]
      : ["rgba(16, 185, 129, 0.06)", "rgba(244, 63, 94, 0.06)", "rgba(245, 158, 11, 0.06)"];

  return titles.map((title, index) => ({
    title,
    x: padding + index * (columnWidth + columnGap),
    y: padding,
    width: columnWidth,
    height: columnHeight + headerHeight,
    fill: fills[index],
  }));
}

export function getBoardSurfaceStyle(background: BoardBackground): {
  backgroundColor: string;
  backgroundImage?: string;
  backgroundSize?: string;
} {
  switch (background) {
    case "plain":
      return {
        backgroundColor: "#ffffff",
      };
    case "grid":
      return {
        backgroundColor: "#f8fafc",
        backgroundImage:
          "linear-gradient(rgba(148, 163, 184, 0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.18) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      };
    case "blueprint":
      return {
        backgroundColor: "#0f172a",
        backgroundImage:
          "linear-gradient(rgba(56, 189, 248, 0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.14) 1px, transparent 1px)",
        backgroundSize: "36px 36px",
      };
    case "warm":
      return {
        backgroundColor: "#fff7ed",
        backgroundImage:
          "linear-gradient(rgba(234, 88, 12, 0.08) 1px, transparent 1px)",
        backgroundSize: "100% 56px",
      };
    case "dots":
    default:
      return {
        backgroundColor: "#f8fafc",
        backgroundImage:
          "radial-gradient(circle, rgba(148, 163, 184, 0.35) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      };
  }
}

function drawBackgroundPattern(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: BoardBackground,
): void {
  const surface = getBoardSurfaceStyle(background);

  ctx.save();
  ctx.fillStyle = surface.backgroundColor;
  ctx.fillRect(0, 0, width, height);

  switch (background) {
    case "dots":
      ctx.fillStyle = "rgba(148, 163, 184, 0.32)";
      for (let x = 10; x < width; x += 20) {
        for (let y = 10; y < height; y += 20) {
          ctx.beginPath();
          ctx.arc(x, y, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    case "grid":
      ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      break;
    case "blueprint":
      ctx.strokeStyle = "rgba(56, 189, 248, 0.16)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += 36) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      break;
    case "warm":
      ctx.strokeStyle = "rgba(234, 88, 12, 0.08)";
      ctx.lineWidth = 1;
      for (let y = 20; y <= height; y += 56) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      break;
    case "plain":
    default:
      break;
  }

  ctx.restore();
}

function drawTemplateOverlay(
  ctx: CanvasRenderingContext2D,
  template: BoardTemplate,
): void {
  const columns = getTemplateColumns(template);
  if (columns.length === 0) {
    return;
  }

  ctx.save();
  columns.forEach((column) => {
    ctx.fillStyle = column.fill;
    ctx.strokeStyle = "rgba(100, 116, 139, 0.22)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.fillRect(column.x, column.y, column.width, column.height);
    ctx.strokeRect(column.x, column.y, column.width, column.height);
    ctx.setLineDash([]);
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 28px sans-serif";
    ctx.fillText(column.title, column.x + 24, column.y + 42);
  });
  ctx.restore();
}

export function drawBoardPresentation(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  metadata: BoardMetadata,
): void {
  drawBackgroundPattern(ctx, width, height, metadata.theme.background);
  drawTemplateOverlay(ctx, metadata.theme.template);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getSvgPatternMarkup(background: BoardBackground): string {
  switch (background) {
    case "dots":
      return `
        <pattern id="board-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="1.1" fill="rgba(148, 163, 184, 0.35)" />
        </pattern>
      `;
    case "grid":
      return `
        <pattern id="board-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148, 163, 184, 0.28)" stroke-width="1" />
        </pattern>
      `;
    case "blueprint":
      return `
        <pattern id="board-pattern" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(56, 189, 248, 0.22)" stroke-width="1" />
        </pattern>
      `;
    case "warm":
      return `
        <pattern id="board-pattern" width="1920" height="56" patternUnits="userSpaceOnUse">
          <path d="M 0 20 L 1920 20" fill="none" stroke="rgba(234, 88, 12, 0.10)" stroke-width="1" />
        </pattern>
      `;
    case "plain":
    default:
      return "";
  }
}

export function getBoardSvgPresentation(
  metadata: BoardMetadata,
  width = BOARD_WIDTH,
  height = BOARD_HEIGHT,
): {
  defs: string;
  markup: string;
} {
  const surface = getBoardSurfaceStyle(metadata.theme.background);
  const patternMarkup = getSvgPatternMarkup(metadata.theme.background);
  const columns = getTemplateColumns(metadata.theme.template);
  const defs = patternMarkup ? `<defs>${patternMarkup}</defs>` : "";
  const patternFill = patternMarkup ? `<rect width="${width}" height="${height}" fill="url(#board-pattern)" />` : "";
  const templateMarkup = columns
    .map(
      (column) => `
        <rect x="${column.x}" y="${column.y}" width="${column.width}" height="${column.height}" fill="${column.fill}" stroke="rgba(100, 116, 139, 0.22)" stroke-width="2" stroke-dasharray="10 10" />
        <text x="${column.x + 24}" y="${column.y + 42}" fill="#0f172a" font-size="28" font-weight="600" font-family="sans-serif">${escapeXml(column.title)}</text>
      `,
    )
    .join("");

  return {
    defs,
    markup: `
      <rect width="${width}" height="${height}" fill="${surface.backgroundColor}" />
      ${patternFill}
      ${templateMarkup}
    `,
  };
}
