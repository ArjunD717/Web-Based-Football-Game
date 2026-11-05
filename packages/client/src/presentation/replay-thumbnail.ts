// packages/client/src/presentation/replay-thumbnail.ts
import type { MatchView } from "../render/view";

const THUMBNAIL_WIDTH = 128;
const THUMBNAIL_HEIGHT = 80;
const PADDING = 5;

/** Draws a compact top-down pitch storyboard frame on a 2D canvas. */
export function drawReplayThumbnail(
  canvas: HTMLCanvasElement,
  view: MatchView,
): boolean {
  const context = canvas.getContext("2d");
  if (context === null) {
    return false;
  }
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;

  const width = THUMBNAIL_WIDTH - PADDING * 2;
  const height = THUMBNAIL_HEIGHT - PADDING * 2;
  const scaleX = width / view.pitch.lengthM;
  const scaleY = height / view.pitch.widthM;
  const px = (x: number): number => PADDING + x * scaleX;
  const py = (y: number): number => PADDING + y * scaleY;

  context.fillStyle = "#0b2a17";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#1b5b33";
  context.fillRect(PADDING, PADDING, width, height);

  context.strokeStyle = "rgba(235, 255, 240, 0.55)";
  context.lineWidth = 1;
  context.strokeRect(PADDING, PADDING, width, height);
  context.beginPath();
  context.moveTo(px(view.pitch.lengthM / 2), PADDING);
  context.lineTo(px(view.pitch.lengthM / 2), PADDING + height);
  context.stroke();
  context.beginPath();
  context.arc(
    px(view.pitch.lengthM / 2),
    py(view.pitch.widthM / 2),
    view.pitch.cornerArcRadiusM * Math.min(scaleX, scaleY),
    0,
    Math.PI * 2,
  );
  context.stroke();

  const drawBox = (x: number, boxWidth: number): void => {
    context.strokeRect(
      px(x),
      py((view.pitch.widthM - view.pitch.penaltyAreaWidthM) / 2),
      boxWidth * scaleX,
      view.pitch.penaltyAreaWidthM * scaleY,
    );
  };
  drawBox(0, view.pitch.penaltyAreaLengthM);
  drawBox(
    view.pitch.lengthM - view.pitch.penaltyAreaLengthM,
    view.pitch.penaltyAreaLengthM,
  );

  for (const player of [...view.home.players, ...view.away.players]) {
    context.beginPath();
    context.arc(px(player.x), py(player.y), 2.4, 0, Math.PI * 2);
    context.fillStyle =
      player.team === "home"
        ? view.home.colors.primary
        : view.away.colors.primary;
    context.fill();
    context.strokeStyle = "rgba(255, 255, 255, 0.85)";
    context.stroke();
  }

  context.beginPath();
  context.arc(px(view.ball.x), py(view.ball.y), 2.1, 0, Math.PI * 2);
  context.fillStyle = "#fff";
  context.fill();
  context.strokeStyle = "#111";
  context.stroke();

  return true;
}
