import { useRef, useEffect, useState } from "react";
import type { AnimationFrame } from "../utils/api";

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

interface Props {
  frames: AnimationFrame[] | null;
  word?: string;
}

export default function GestureCanvas({ frames, word }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);

  // All mutable animation state lives in refs — no stale closure issues
  const animIdRef = useRef(0);      // incremented to cancel stale timers
  const frameIdxRef = useRef(0);
  const playingRef = useRef(false);
  const loopRef = useRef(loop);
  const speedRef = useRef(speed);
  const framesRef = useRef(frames);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync with latest state — no useEffect needed for this
  loopRef.current = loop;
  speedRef.current = speed;
  framesRef.current = frames;

  // ─── Drawing ────────────────────────────────────────────────────────────
  const draw = (idx: number, lmOverride?: [number, number, number][] | null) => {
    const canvas = canvasRef.current;
    const f = framesRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const lm = lmOverride ?? f?.[idx]?.landmarks;
    if (!lm) return;

    ctx.strokeStyle = "lime";
    ctx.lineWidth = 2;
    CONNECTIONS.forEach(([a, b]) => {
      const [x1, y1] = lm[a];
      const [x2, y2] = lm[b];
      ctx.beginPath();
      ctx.moveTo(x1 * W, y1 * H);
      ctx.lineTo(x2 * W, y2 * H);
      ctx.stroke();
    });

    ctx.fillStyle = "red";
    lm.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x * W, y * H, 5, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  // Draw whenever frameIdx changes (driven by the timer)
  useEffect(() => {
    draw(frameIdx);
  }, [frameIdx, frames]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Reset when frames prop changes ─────────────────────────────────────
  useEffect(() => {
    animIdRef.current++;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    playingRef.current = false;
    setPlaying(false);
    frameIdxRef.current = 0;
    setFrameIdx(0);
  }, [frames]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      animIdRef.current++;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // ─── Timer loop ──────────────────────────────────────────────────────────
  const startTimer = (fromIdx: number) => {
    const id = animIdRef.current;
    const f = framesRef.current;
    if (!f?.length) return;

    const delay = f[fromIdx].duration_ms / speedRef.current;

    timerRef.current = setTimeout(function tick() {
      // Stale timer guard — this animation was cancelled
      if (animIdRef.current !== id || !playingRef.current) return;

      const f2 = framesRef.current!;
      let next = frameIdxRef.current + 1;

      if (next >= f2.length) {
        if (loopRef.current) {
          next = 0;
        } else {
          playingRef.current = false;
          setPlaying(false);
          return;
        }
      }

      frameIdxRef.current = next;
      setFrameIdx(next);

      const nextDelay = f2[next].duration_ms / speedRef.current;
      timerRef.current = setTimeout(tick, nextDelay);
    }, delay);
  };

  // ─── Controls ────────────────────────────────────────────────────────────
  const handlePlayPause = () => {
    if (!frames?.length) return;

    if (playingRef.current) {
      // Pause
      animIdRef.current++;
      if (timerRef.current) clearTimeout(timerRef.current);
      playingRef.current = false;
      setPlaying(false);
    } else {
      // Play
      playingRef.current = true;
      setPlaying(true);
      startTimer(frameIdxRef.current);
    }
  };

  // When speed changes while playing, restart timer from current frame
  const handleSpeedChange = (newSpeed: number) => {
    speedRef.current = newSpeed;
    setSpeed(newSpeed);

    if (playingRef.current) {
      animIdRef.current++;
      if (timerRef.current) clearTimeout(timerRef.current);
      const id = ++animIdRef.current;
      // Reassign so startTimer uses the new id
      animIdRef.current = id;
      startTimer(frameIdxRef.current);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  if (!frames || frames.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 border rounded text-gray-400 text-sm">
        No animation data
      </div>
    );
  }

  const currentFrame = frames[frameIdx];
  const currentImage = currentFrame?.image_data ?? null;

  // Find which letter in `word` corresponds to the current frame
  const letterFrames = frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.letter && f.letter.trim() !== "");
  const activeLetterPos = letterFrames.filter(({ i }) => i <= frameIdx).length - 1;

  // Map position in letterFrames to position in word (skipping spaces)
  let letterNum = -1;
  if (word && activeLetterPos >= 0) {
    let count = -1;
    for (let i = 0; i < word.length; i++) {
      if (word[i] !== " ") count++;
      if (count === activeLetterPos) { letterNum = i; break; }
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {word && (
        <div className="font-mono text-lg tracking-widest">
          {word.split("").map((ch, i) => (
            <span
              key={i}
              className={
                i === letterNum
                  ? "text-cyan-400 font-bold underline"
                  : "text-gray-400"
              }
            >
              {ch}
            </span>
          ))}
        </div>
      )}

      {currentImage ? (
        <img
          src={currentImage}
          alt={`ASL ${currentFrame.letter || "gesture"}`}
          className="w-[300px] h-[300px] object-contain border rounded bg-black"
        />
      ) : (
        <canvas
          ref={canvasRef}
          width={300}
          height={300}
          className="border rounded bg-gray-900"
        />
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handlePlayPause}
          className="px-4 py-1 rounded bg-cyan-600 text-white text-sm font-mono hover:bg-cyan-500"
        >
          {playing ? "Pause" : "Play"}
        </button>

        <select
          value={speed}
          onChange={(e) => handleSpeedChange(Number(e.target.value))}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
        </select>

        <label className="flex items-center gap-1 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => { loopRef.current = e.target.checked; setLoop(e.target.checked); }}
          />
          Loop
        </label>
      </div>
    </div>
  );
}
