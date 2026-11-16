import { useEffect, useRef } from 'react';

interface WaveformCanvasProps {
  peaks: number[];
  progress: number; // 0 to 1
  onSeek?: (ratio: number) => void;
  height?: number;
  ariaLabel?: string;
  testId?: string;
}

export function WaveformCanvas({
  peaks,
  progress,
  onSeek,
  height = 72,
  ariaLabel = 'Forma de onda do áudio',
  testId = 'waveform-canvas',
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(120, Math.floor(rect.width));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const safePeaks = peaks.length > 0 ? peaks : Array.from({ length: 64 }, () => 0.15);
      const count = safePeaks.length;
      const gap = 2;
      const barWidth = Math.max(2, (width - (count - 1) * gap) / count);
      const midY = height / 2;

      // Subtle center baseline
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.fillRect(0, midY - 0.5, width, 1);

      const clampedProgress = Math.max(0, Math.min(1, progress));

      for (let i = 0; i < count; i++) {
        const x = i * (barWidth + gap);
        const norm = Math.max(0.05, Math.min(1, safePeaks[i]));
        const barH = Math.max(4, norm * (height - 12));
        const y = midY - barH / 2;
        const barRatio = (i + 0.5) / count;

        if (barRatio <= clampedProgress) {
          ctx.fillStyle = '#E58E26';
        } else if (norm < 0.12) {
          // Natural pause region
          ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        } else {
          ctx.fillStyle = 'rgba(241, 243, 247, 0.34)';
        }

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, 1.5);
        ctx.fill();
      }

      // Playhead needle
      if (clampedProgress > 0 && clampedProgress < 1) {
        const needleX = clampedProgress * width;
        ctx.fillStyle = '#FBBF24';
        ctx.fillRect(needleX - 1, 2, 2, height - 4);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [peaks, progress, height]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onSeek || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio);
  };

  return (
    <div ref={containerRef} className="w-full select-none">
      <canvas
        ref={canvasRef}
        data-testid={testId}
        role={onSeek ? 'slider' : 'img'}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={onSeek ? 0 : undefined}
        onPointerDown={handlePointerDown}
        onKeyDown={(e) => {
          if (!onSeek) return;
          if (e.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.05));
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.05));
        }}
        className={`w-full block rounded ${onSeek ? 'cursor-pointer' : ''} focus-visible:outline-2 focus-visible:outline-[#E58E26]`}
      />
    </div>
  );
}
