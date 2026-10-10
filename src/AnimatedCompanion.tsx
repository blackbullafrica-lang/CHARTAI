import { useEffect, useRef } from "react";
import companionArtwork from "./assets/chart-ai-companion.jpg";

type AnimatedCompanionProps = {
  onActivate: () => void;
};

export function AnimatedCompanion({ onActivate }: AnimatedCompanionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const artwork = new Image();
    artwork.decoding = "async";
    artwork.src = companionArtwork;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionQuery.matches;
    let frame = 0;
    let width = 0;
    let height = 0;
    let pointerX = 0;
    let pointerY = 0;
    let targetX = 0;
    let targetY = 0;
    let start = performance.now();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (now: number) => {
      const elapsed = (now - start) / 1000;
      const motion = reduceMotion ? 0 : 1;
      pointerX += (targetX - pointerX) * 0.075;
      pointerY += (targetY - pointerY) * 0.075;
      const floatY = Math.sin(elapsed * 1.55) * 2.2 * motion;
      const breathing = 1 + Math.sin(elapsed * 1.9) * 0.012 * motion;
      const glow = 0.55 + Math.sin(elapsed * 2.4) * 0.18 * motion;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.max(4, Math.min(width, height) / 2 - 3);

      context.clearRect(0, 0, width, height);
      const halo = context.createRadialGradient(
        centerX,
        centerY,
        radius * 0.15,
        centerX,
        centerY,
        radius * 1.18,
      );
      halo.addColorStop(0, `rgba(77, 230, 180, ${0.22 * glow})`);
      halo.addColorStop(0.62, `rgba(75, 172, 255, ${0.13 * glow})`);
      halo.addColorStop(1, "rgba(52, 211, 160, 0)");
      context.fillStyle = halo;
      context.beginPath();
      context.arc(centerX, centerY, radius * 1.18, 0, Math.PI * 2);
      context.fill();

      context.save();
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.clip();
      context.fillStyle = "#b8e97d";
      context.fillRect(0, 0, width, height);

      if (artwork.complete && artwork.naturalWidth) {
        const size = radius * 2 * breathing;
        const parallaxX = pointerX * 3.2 * motion;
        const parallaxY = pointerY * 2.4 * motion;
        context.save();
        context.translate(centerX + parallaxX, centerY + floatY + parallaxY);
        context.rotate(pointerX * 0.035 * motion);
        context.drawImage(artwork, -size / 2, -size / 2, size, size);
        context.restore();
      }

      const sheenX = ((elapsed * 34) % (radius * 3)) - radius * 1.5;
      const sheen = context.createLinearGradient(
        centerX + sheenX - 12,
        0,
        centerX + sheenX + 12,
        height,
      );
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.5, `rgba(255,255,255,${0.08 * motion})`);
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = sheen;
      context.fillRect(0, 0, width, height);
      context.restore();

      context.lineWidth = 1.5;
      context.strokeStyle = `rgba(64, 224, 171, ${0.64 + glow * 0.22})`;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.stroke();

      const pulse = reduceMotion ? 1 : 0.78 + Math.sin(elapsed * 3.2) * 0.18;
      context.fillStyle = `rgba(53, 218, 163, ${pulse})`;
      context.beginPath();
      context.arc(width - 10, height - 11, 4.2, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = "#111417";
      context.stroke();

      frame = requestAnimationFrame(draw);
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      targetX = Math.max(
        -1,
        Math.min(1, (event.clientX - bounds.left - bounds.width / 2) / (bounds.width / 2)),
      );
      targetY = Math.max(
        -1,
        Math.min(1, (event.clientY - bounds.top - bounds.height / 2) / (bounds.height / 2)),
      );
    };
    const resetPointer = () => {
      targetX = 0;
      targetY = 0;
    };
    const onMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      start = performance.now();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", resetPointer);
    motionQuery.addEventListener("change", onMotionChange);
    resize();
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", resetPointer);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, []);

  return (
    <button
      className="ai-companion"
      type="button"
      aria-label="Ask the animated AI companion"
      title="Ask the AI companion"
      onClick={onActivate}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      <span>
        <strong>AI companion</strong>
        <small>Tap to ask</small>
      </span>
    </button>
  );
}
