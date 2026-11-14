import { useEffect, useRef } from "react";
import { mountLatticeBackground, type LatticeField } from "@/lib/lattice-background";

export function AmbientBackground({ paused }: { paused: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<LatticeField | null>(null);

  useEffect(() => {
    if (!container.current || !canvas.current) return;
    field.current = mountLatticeBackground(container.current, canvas.current);
    return () => {
      field.current?.destroy();
      field.current = null;
    };
  }, []);

  useEffect(() => {
    field.current?.setPaused(paused);
  }, [paused]);

  return (
    <div ref={container} className="ambient-background" data-paused={paused} aria-hidden="true">
      <div className="ambient-background__glow ambient-background__glow--sage" />
      <div className="ambient-background__glow ambient-background__glow--mint" />
      <canvas ref={canvas} className="ambient-background__network" />
    </div>
  );
}
