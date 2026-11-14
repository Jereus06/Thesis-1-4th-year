/**
 * Canvas adaptation of the supplied LATTICE network background.
 * Kept local to its React owner: no global script, injected styles or dependencies.
 */
type Node = { x: number; y: number; z: number; phase: number; speed: number };
type Projection = { x: number; y: number; depth: number; phase: number };
type Wave = { x: number; y: number; time: number };

export type LatticeField = { setPaused: (paused: boolean) => void; destroy: () => void };

const TAU = Math.PI * 2;
const FRAME_INTERVAL = 1000 / 30;
const INTERACTIVE =
  "a,button,input,select,textarea,label,summary,[role=button],[role=combobox],[contenteditable]";
const INK = "33, 116, 82";
const LIGHT = "84, 161, 111";

function seed(index: number) {
  const value = Math.sin(index * 127.1 + 3.7) * 43758.5453;
  return value - Math.floor(value);
}

export function mountLatticeBackground(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
): LatticeField | null {
  let context: CanvasRenderingContext2D | null;
  try {
    context = canvas.getContext("2d", { alpha: true });
  } catch {
    return null;
  }
  if (!context) return null;
  const ctx = context;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let paused = true;
  let reducedMotion = media.matches;
  let printing = false;
  let lost = false;
  let destroyed = false;
  let frame: number | null = null;
  let previousFrame = 0;
  let time = 0;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let nodes: Node[] = [];
  let mouseX = 0;
  let mouseY = 0;
  let targetX = 0;
  let targetY = 0;
  let press: { x: number; y: number } | null = null;
  const waves: Wave[] = [];

  function running() {
    return !paused && !reducedMotion && !printing && !document.hidden && !lost && !destroyed;
  }

  function project(node: Node): Projection {
    const scale = Math.min(width, height);
    const x = node.x * width * 0.64 + Math.sin(time * node.speed + node.phase) * scale * 0.07;
    const y =
      node.y * height * 0.64 + Math.cos(time * node.speed * 0.8 + node.phase) * scale * 0.07;
    const z = node.z + Math.sin(time * 0.08 + node.phase) * 0.13;
    const yaw = Math.sin(time * 0.07) * 0.2 + mouseX * 0.08;
    const pitch = Math.cos(time * 0.05) * 0.12 + mouseY * 0.05;
    const rotatedX = x * Math.cos(yaw) - z * scale * Math.sin(yaw);
    const rotatedZ = (x / scale) * Math.sin(yaw) + z * Math.cos(yaw);
    const rotatedY = y * Math.cos(pitch) - rotatedZ * scale * Math.sin(pitch);
    const depth = 2.8 / (3 + rotatedZ);
    return {
      x: width / 2 + rotatedX * depth,
      y: height / 2 + rotatedY * depth,
      depth,
      phase: node.phase,
    };
  }

  function paint() {
    if (!width || !height || lost || destroyed) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = "round";
    const points = nodes.map(project);
    const reach = Math.max(110, Math.min(220, Math.min(width, height) * 0.3));
    const reachSquared = reach * reach;

    for (let index = 0; index < points.length; index++) {
      const start = points[index];
      const nearby: { point: Projection; distance: number; index: number }[] = [];
      for (let next = index + 1; next < points.length; next++) {
        const end = points[next];
        const distance = (start.x - end.x) ** 2 + (start.y - end.y) ** 2;
        if (distance < reachSquared) nearby.push({ point: end, distance, index: next });
      }
      nearby.sort((a, b) => a.distance - b.distance);
      for (const link of nearby.slice(0, 3)) {
        const end = link.point;
        const length = Math.sqrt(link.distance);
        const opacity = (1 - length / reach) * 0.3 + 0.045;
        const bend = Math.sin(time * 0.4 + index + link.index) * Math.min(8, length * 0.06);
        const controlX = (start.x + end.x) / 2 - ((end.y - start.y) / Math.max(1, length)) * bend;
        const controlY = (start.y + end.y) / 2 + ((end.x - start.x) / Math.max(1, length)) * bend;

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.quadraticCurveTo(controlX, controlY, end.x, end.y);
        ctx.strokeStyle = `rgba(${LIGHT}, ${opacity * 0.22})`;
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${INK}, ${opacity})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // A small signal travels along selected connections, as in the supplied effect.
        if ((index + link.index) % 7 === 0) {
          const progress = (time * 0.13 + seed(index + link.index)) % 1;
          const remaining = 1 - progress;
          const x =
            remaining ** 2 * start.x + 2 * remaining * progress * controlX + progress ** 2 * end.x;
          const y =
            remaining ** 2 * start.y + 2 * remaining * progress * controlY + progress ** 2 * end.y;
          ctx.beginPath();
          ctx.fillStyle = `rgba(${INK}, 0.52)`;
          ctx.arc(x, y, 1.6, 0, TAU);
          ctx.fill();
        }
      }
      if (nearby.length > 1) {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(nearby[0].point.x, nearby[0].point.y);
        ctx.lineTo(nearby[1].point.x, nearby[1].point.y);
        ctx.closePath();
        ctx.fillStyle = `rgba(${LIGHT}, 0.025)`;
        ctx.fill();
      }
    }

    for (const point of points) {
      const pulse = 0.5 + Math.sin(time * 0.65 + point.phase) * 0.2;
      const radius = Math.max(0.7, Math.min(2.1, point.depth * 1.35));
      ctx.beginPath();
      ctx.fillStyle = `rgba(${LIGHT}, ${pulse * 0.1})`;
      ctx.arc(point.x, point.y, radius * 4, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = `rgba(${INK}, ${pulse})`;
      ctx.arc(point.x, point.y, radius, 0, TAU);
      ctx.fill();
    }
    for (let index = waves.length - 1; index >= 0; index--) {
      const wave = waves[index];
      const age = time - wave.time;
      if (age > 1.4) {
        waves.splice(index, 1);
        continue;
      }
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${INK}, ${(1 - age / 1.4) * 0.12})`;
      ctx.lineWidth = 1;
      ctx.arc(wave.x, wave.y, 8 + age * 160, 0, TAU);
      ctx.stroke();
    }
  }

  function tick(timestamp: number) {
    frame = null;
    if (!running()) return;
    if (!previousFrame || timestamp - previousFrame >= FRAME_INTERVAL) {
      const elapsed = previousFrame ? Math.min((timestamp - previousFrame) / 1000, 0.08) : 0;
      previousFrame = timestamp;
      time += elapsed;
      mouseX += (targetX - mouseX) * Math.min(1, elapsed * 2);
      mouseY += (targetY - mouseY) * Math.min(1, elapsed * 2);
      paint();
    }
    frame = window.requestAnimationFrame(tick);
  }

  function sync() {
    if (!running()) {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      previousFrame = 0;
      press = null;
    } else if (frame === null) {
      previousFrame = 0;
      frame = window.requestAnimationFrame(tick);
    }
  }

  function resize() {
    if (destroyed) return;
    const bounds = container.getBoundingClientRect();
    const nextWidth = Math.round(bounds.width);
    const nextHeight = Math.round(bounds.height);
    if (nextWidth < 2 || nextHeight < 2) return;
    const nextRatio = Math.min(
      window.devicePixelRatio || 1,
      1.5,
      Math.sqrt(1_600_000 / (nextWidth * nextHeight)),
    );
    if (width === nextWidth && height === nextHeight && ratio === nextRatio) return;
    width = nextWidth;
    height = nextHeight;
    ratio = nextRatio;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const count = Math.round(
      Math.max(36, Math.min(width < 720 ? 48 : 110, (width * height) / 14000)),
    );
    nodes = Array.from({ length: count }, (_, index) => ({
      x: seed(index * 5 + 1) * 2 - 1,
      y: seed(index * 5 + 2) * 2 - 1,
      z: seed(index * 5 + 3) * 1.4 - 0.7,
      phase: seed(index * 5 + 4) * TAU,
      speed: 0.06 + seed(index * 5 + 5) * 0.08,
    }));
    paint();
  }

  function pointerMove(event: PointerEvent) {
    if (!running() || event.pointerType !== "mouse") return;
    targetX = (event.clientX / width) * 2 - 1;
    targetY = (event.clientY / height) * 2 - 1;
  }
  function pointerLeave(event: PointerEvent) {
    if (event.relatedTarget === null) {
      targetX = targetY = 0;
      press = null;
    }
  }
  function pointerDown(event: PointerEvent) {
    if (!running() || event.pointerType !== "mouse" || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    press = { x: event.clientX, y: event.clientY };
  }
  function pointerUp(event: PointerEvent) {
    if (running() && press && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 10) {
      waves.push({ x: event.clientX, y: event.clientY, time });
      if (waves.length > 3) waves.shift();
    }
    press = null;
  }
  function motionChange() {
    reducedMotion = media.matches;
    sync();
  }
  function beforePrint() {
    printing = true;
    sync();
  }
  function afterPrint() {
    printing = false;
    sync();
  }
  function contextLost() {
    lost = true;
    sync();
  }
  function contextRestored() {
    lost = false;
    paint();
    sync();
  }

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  observer?.observe(container);
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", pointerMove, { passive: true });
  window.addEventListener("pointerout", pointerLeave, { passive: true });
  window.addEventListener("pointerdown", pointerDown, { passive: true });
  window.addEventListener("pointerup", pointerUp, { passive: true });
  window.addEventListener("pointercancel", pointerUp, { passive: true });
  window.addEventListener("beforeprint", beforePrint);
  window.addEventListener("afterprint", afterPrint);
  document.addEventListener("visibilitychange", sync);
  media.addEventListener("change", motionChange);
  canvas.addEventListener("contextlost", contextLost);
  canvas.addEventListener("contextrestored", contextRestored);
  resize();

  return {
    setPaused(value) {
      paused = value;
      sync();
    },
    destroy() {
      destroyed = true;
      sync();
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerout", pointerLeave);
      window.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      document.removeEventListener("visibilitychange", sync);
      media.removeEventListener("change", motionChange);
      canvas.removeEventListener("contextlost", contextLost);
      canvas.removeEventListener("contextrestored", contextRestored);
    },
  };
}
