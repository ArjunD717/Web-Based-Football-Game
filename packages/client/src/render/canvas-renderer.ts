// packages/client/src/render/canvas-renderer.ts
import { TAU, TUNING, clamp } from "@fb/shared";
import type { Pitch } from "@fb/sim";
import type { MatchRenderer } from "./renderer";
import type { MatchView, RenderPlayer } from "./view";

/** Presentation-only sizes, exaggerated so a full pitch stays readable. */
const VISUAL = {
  playerRadiusM: 0.62,
  ballRadiusM: 0.42,
  facingLineM: 0.95,
  staminaRingRadiusM: 0.8,
  goalPostDrawRadiusM: 0.13,
  lineWidthM: 0.12,
  horizontalMarginM: 2.4,
  verticalMarginM: 3,
  maxDevicePixelRatio: 2,
  stripeCount: 12,
  netMeshStepM: 0.35,
} as const;

const COLORS = {
  outside: "#06110b",
  surround: "#0b2015",
  grass: "#166b3c",
  grassStripe: "rgba(255, 255, 255, 0.035)",
  line: "rgba(236, 249, 241, 0.74)",
  net: "rgba(232, 247, 238, 0.07)",
  netMesh: "rgba(232, 247, 238, 0.16)",
  post: "#f4fbf6",
  shadow: "rgba(0, 0, 0, 0.34)",
  ball: "#f7fbf8",
  ballDark: "#122017",
  actionShoot: "#ffb36b",
  actionPass: "#7cc7ff",
  actionDribble: "#ffe066",
  controlled: "#f4fbff",
} as const;

export function createCanvasRenderer(
  canvas: HTMLCanvasElement,
): MatchRenderer {
  return new CanvasMatchRenderer(canvas);
}

class CanvasMatchRenderer implements MatchRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly onWindowResize = (): void => {
    this.resize();
  };
  private cssWidth = 1;
  private cssHeight = 1;
  private pixelRatio = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) {
      throw new Error("Canvas 2D context is unavailable");
    }
    this.context = context;

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    const parent = canvas.parentElement;
    if (parent !== null) {
      this.resizeObserver.observe(parent);
    }
    window.addEventListener("resize", this.onWindowResize);
    this.resize();
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    this.cssWidth = Math.max(1, Math.floor(rect?.width ?? 1));
    this.cssHeight = Math.max(1, Math.floor(rect?.height ?? 1));
    this.pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      VISUAL.maxDevicePixelRatio,
    );
    this.canvas.width = Math.floor(this.cssWidth * this.pixelRatio);
    this.canvas.height = Math.floor(this.cssHeight * this.pixelRatio);
  }

  render(view: MatchView): void {
    const ctx = this.context;
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      this.resize();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const layout = this.computeLayout(view.pitch);
    ctx.setTransform(
      this.pixelRatio * layout.scale,
      0,
      0,
      this.pixelRatio * layout.scale,
      this.pixelRatio * layout.offsetX,
      this.pixelRatio * layout.offsetY,
    );

    drawSurround(ctx, view.pitch);
    drawPitch(ctx, view.pitch);
    drawGoals(ctx, view.pitch, view.tick);

    for (const team of [view.away, view.home]) {
      for (const player of team.players) {
        drawPlayerShadow(ctx, player);
      }
    }
    for (const team of [view.away, view.home]) {
      for (const player of team.players) {
        drawPlayer(ctx, player, team.colors);
      }
    }

    drawBall(ctx, view);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
  }

  private computeLayout(pitch: Pitch): {
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
  } {
    const horizontalMargin = VISUAL.horizontalMarginM + pitch.goalNetDepthM;
    const verticalMargin = VISUAL.verticalMarginM;
    const worldWidth = pitch.lengthM + horizontalMargin * 2;
    const worldHeight = pitch.widthM + verticalMargin * 2;
    const scale = Math.min(
      this.cssWidth / worldWidth,
      this.cssHeight / worldHeight,
    );
    return {
      scale,
      offsetX: (this.cssWidth - pitch.lengthM * scale) / 2,
      offsetY: (this.cssHeight - pitch.widthM * scale) / 2,
    };
  }
}

function drawSurround(
  ctx: CanvasRenderingContext2D,
  pitch: Pitch,
): void {
  const margin = VISUAL.horizontalMarginM + pitch.goalNetDepthM;
  ctx.fillStyle = COLORS.surround;
  ctx.fillRect(
    -margin,
    -VISUAL.verticalMarginM,
    pitch.lengthM + margin * 2,
    pitch.widthM + VISUAL.verticalMarginM * 2,
  );
}

function drawPitch(ctx: CanvasRenderingContext2D, pitch: Pitch): void {
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, pitch.lengthM, pitch.widthM);

  const stripeWidth = pitch.lengthM / VISUAL.stripeCount;
  ctx.fillStyle = COLORS.grassStripe;
  for (let i = 0; i < VISUAL.stripeCount; i += 2) {
    ctx.fillRect(i * stripeWidth, 0, stripeWidth, pitch.widthM);
  }

  ctx.save();
  ctx.strokeStyle = COLORS.line;
  ctx.fillStyle = COLORS.line;
  ctx.lineWidth = VISUAL.lineWidthM;
  ctx.lineJoin = "miter";

  ctx.strokeRect(0, 0, pitch.lengthM, pitch.widthM);
  drawLine(ctx, pitch.centreX, 0, pitch.centreX, pitch.widthM);

  ctx.beginPath();
  ctx.arc(pitch.centreX, pitch.centreY, pitch.penaltyArcRadiusM, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(pitch.centreX, pitch.centreY, VISUAL.lineWidthM * 1.5, 0, TAU);
  ctx.fill();

  const halfPenaltyHeight = pitch.penaltyAreaWidthM / 2;
  const halfGoalAreaHeight = pitch.goalAreaWidthM / 2;
  ctx.strokeRect(
    0,
    pitch.centreY - halfPenaltyHeight,
    pitch.penaltyAreaLengthM,
    pitch.penaltyAreaWidthM,
  );
  ctx.strokeRect(
    pitch.lengthM - pitch.penaltyAreaLengthM,
    pitch.centreY - halfPenaltyHeight,
    pitch.penaltyAreaLengthM,
    pitch.penaltyAreaWidthM,
  );
  ctx.strokeRect(
    0,
    pitch.centreY - halfGoalAreaHeight,
    pitch.goalAreaLengthM,
    pitch.goalAreaWidthM,
  );
  ctx.strokeRect(
    pitch.lengthM - pitch.goalAreaLengthM,
    pitch.centreY - halfGoalAreaHeight,
    pitch.goalAreaLengthM,
    pitch.goalAreaWidthM,
  );

  drawPenaltySpot(ctx, pitch.penaltySpotDistanceM, pitch.centreY);
  drawPenaltySpot(
    ctx,
    pitch.lengthM - pitch.penaltySpotDistanceM,
    pitch.centreY,
  );

  drawPenaltyArcs(ctx, pitch);
  drawCornerArcs(ctx, pitch);
  ctx.restore();
}

function drawPenaltySpot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, VISUAL.lineWidthM * 1.6, 0, TAU);
  ctx.fill();
}

function drawPenaltyArcs(
  ctx: CanvasRenderingContext2D,
  pitch: Pitch,
): void {
  const halfAngle = Math.acos(
    (pitch.penaltyAreaLengthM - pitch.penaltySpotDistanceM) /
      pitch.penaltyArcRadiusM,
  );

  ctx.beginPath();
  ctx.arc(
    pitch.penaltySpotDistanceM,
    pitch.centreY,
    pitch.penaltyArcRadiusM,
    -halfAngle,
    halfAngle,
  );
  ctx.stroke();

  const rightSpotX = pitch.lengthM - pitch.penaltySpotDistanceM;
  ctx.beginPath();
  ctx.arc(
    rightSpotX,
    pitch.centreY,
    pitch.penaltyArcRadiusM,
    Math.PI - halfAngle,
    Math.PI + halfAngle,
  );
  ctx.stroke();
}

function drawCornerArcs(
  ctx: CanvasRenderingContext2D,
  pitch: Pitch,
): void {
  const radius = pitch.cornerArcRadiusM;
  const corners: readonly [number, number, number, number][] = [
    [0, 0, 0, Math.PI / 2],
    [pitch.lengthM, 0, Math.PI / 2, Math.PI],
    [pitch.lengthM, pitch.widthM, Math.PI, Math.PI * 1.5],
    [0, pitch.widthM, Math.PI * 1.5, TAU],
  ];

  for (const [x, y, start, end] of corners) {
    ctx.beginPath();
    ctx.arc(x, y, radius, start, end);
    ctx.stroke();
  }
}

function drawGoals(
  ctx: CanvasRenderingContext2D,
  pitch: Pitch,
  tick: number,
): void {
  drawGoal(ctx, pitch, pitch.homeGoal.lineX, pitch.homeGoal.netDirection, tick);
  drawGoal(ctx, pitch, pitch.awayGoal.lineX, pitch.awayGoal.netDirection, tick);
}

function drawGoal(
  ctx: CanvasRenderingContext2D,
  pitch: Pitch,
  lineX: number,
  netDirection: -1 | 1,
  tick: number,
): void {
  const yMin = pitch.centreY - pitch.goalWidthM / 2;
  const yMax = pitch.centreY + pitch.goalWidthM / 2;
  const netDepth = pitch.goalNetDepthM;
  const netX = lineX + netDirection * netDepth;
  const xMin = Math.min(lineX, netX);

  ctx.save();
  ctx.fillStyle = COLORS.net;
  ctx.fillRect(xMin, yMin, netDepth, pitch.goalWidthM);
  ctx.strokeStyle = COLORS.netMesh;
  ctx.lineWidth = VISUAL.lineWidthM * 0.5;

  for (let depth = VISUAL.netMeshStepM; depth < netDepth; depth += VISUAL.netMeshStepM) {
    const x = lineX + netDirection * depth;
    drawLine(ctx, x, yMin, x, yMax);
  }
  for (let y = yMin + VISUAL.netMeshStepM; y < yMax; y += VISUAL.netMeshStepM) {
    drawLine(ctx, xMin, y, xMin + netDepth, y);
  }

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = VISUAL.lineWidthM;
  ctx.strokeRect(xMin, yMin, netDepth, pitch.goalWidthM);
  drawLine(ctx, lineX, yMin, lineX, yMax);

  ctx.fillStyle = COLORS.post;
  ctx.beginPath();
  ctx.arc(lineX, yMin, VISUAL.goalPostDrawRadiusM, 0, TAU);
  ctx.arc(lineX, yMax, VISUAL.goalPostDrawRadiusM, 0, TAU);
  ctx.fill();

  // Tiny animation on the net keeps the goal readable without implying a score.
  ctx.globalAlpha = 0.08 + 0.03 * Math.sin(tick * 0.02);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(xMin, yMin, netDepth, pitch.goalWidthM);
  ctx.restore();
}

function drawPlayerShadow(
  ctx: CanvasRenderingContext2D,
  player: RenderPlayer,
): void {
  ctx.save();
  ctx.fillStyle = COLORS.shadow;
  ctx.beginPath();
  ctx.ellipse(
    player.x + 0.12,
    player.y + 0.16,
    VISUAL.playerRadiusM * 0.9,
    VISUAL.playerRadiusM * 0.6,
    0,
    0,
    TAU,
  );
  ctx.fill();
  ctx.restore();
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: RenderPlayer,
  colors: { readonly primary: string; readonly secondary: string; readonly keeper: string },
): void {
  const bodyColor = player.goalkeeper ? colors.keeper : colors.primary;
  const facingX = Math.cos(player.facing);
  const facingY = Math.sin(player.facing);

  ctx.save();

  ctx.strokeStyle = colors.secondary;
  ctx.lineWidth = VISUAL.lineWidthM * 1.2;
  ctx.beginPath();
  ctx.moveTo(player.x, player.y);
  ctx.lineTo(
    player.x + facingX * VISUAL.facingLineM,
    player.y + facingY * VISUAL.facingLineM,
  );
  ctx.stroke();

  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = colors.secondary;
  ctx.lineWidth = VISUAL.lineWidthM;
  ctx.beginPath();
  ctx.arc(player.x, player.y, VISUAL.playerRadiusM, 0, TAU);
  ctx.fill();
  ctx.stroke();

  drawStaminaRing(ctx, player);

  if (isActionState(player.state)) {
    ctx.strokeStyle = actionColor(player.state);
    ctx.lineWidth = VISUAL.lineWidthM * 1.3;
    ctx.beginPath();
    ctx.arc(player.x, player.y, VISUAL.playerRadiusM + 0.14, 0, TAU);
    ctx.stroke();
  }

  if (player.controlled) {
    ctx.strokeStyle = COLORS.controlled;
    ctx.lineWidth = VISUAL.lineWidthM * 1.55;
    ctx.beginPath();
    ctx.arc(player.x, player.y, VISUAL.playerRadiusM + 0.26, 0, TAU);
    ctx.stroke();
  }

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.62)";
  ctx.lineWidth = 0.1;
  ctx.font =
    '700 0.8px "Segoe UI", ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeText(String(player.number), player.x, player.y + 0.03);
  ctx.fillText(String(player.number), player.x, player.y + 0.03);

  ctx.restore();
}

function drawStaminaRing(
  ctx: CanvasRenderingContext2D,
  player: RenderPlayer,
): void {
  const stamina = clamp(player.stamina, 0, 1);
  const color =
    stamina > 0.55 ? "rgba(126, 235, 159, 0.9)" : stamina > 0.25 ? "rgba(241, 196, 92, 0.95)" : "rgba(240, 125, 125, 0.95)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.arc(
    player.x,
    player.y,
    VISUAL.staminaRingRadiusM,
    -Math.PI / 2,
    -Math.PI / 2 + stamina * TAU,
  );
  ctx.stroke();
}

function drawBall(ctx: CanvasRenderingContext2D, view: MatchView): void {
  const ball = view.ball;
  const lift = Math.max(0, ball.z - TUNING.ball.radiusM);

  ctx.save();
  ctx.fillStyle = COLORS.shadow;
  ctx.beginPath();
  ctx.ellipse(
    ball.x,
    ball.y + 0.04,
    VISUAL.ballRadiusM * (1 - Math.min(0.35, lift * 0.04)),
    VISUAL.ballRadiusM * 0.55 * (1 - Math.min(0.35, lift * 0.04)),
    0,
    0,
    TAU,
  );
  ctx.fill();

  if (lift > 0.08) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(ball.x, ball.y - lift);
    ctx.stroke();
  }

  const x = ball.x;
  const y = ball.y - lift;
  const radius = VISUAL.ballRadiusM;

  ctx.translate(x, y);
  ctx.rotate((view.tick * 0.09 + ball.spinZ * 0.01) % TAU);
  ctx.fillStyle = "rgba(3, 12, 7, 0.55)";
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.28, 0, TAU);
  ctx.fill();
  ctx.fillStyle = COLORS.ball;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.42)";
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = COLORS.ballDark;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.3, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = "rgba(18, 32, 23, 0.55)";
  ctx.lineWidth = 0.055;
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * radius * 0.34, Math.sin(angle) * radius * 0.34);
    ctx.lineTo(Math.cos(angle) * radius * 0.82, Math.sin(angle) * radius * 0.82);
    ctx.stroke();
  }

  ctx.restore();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function actionColor(state: string): string {
  if (state === "shoot" || state === "volley" || state === "header") {
    return COLORS.actionShoot;
  }
  if (state === "pass") {
    return COLORS.actionPass;
  }
  return COLORS.actionDribble;
}

function isActionState(state: string): boolean {
  return (
    state === "shoot" ||
    state === "pass" ||
    state === "dribble" ||
    state === "header" ||
    state === "volley"
  );
}
