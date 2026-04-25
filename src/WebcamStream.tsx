import Webcam from "react-webcam";
import { useRef, useEffect, useState } from "react";
import { predictGesture, getSuggestions, correctWord, getSentenceSuggestions } from "./utils/api";

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

interface Props {
  addSentence: (text: string) => void;
  clearSignal: number;  // increment to reset sentence state
}

export default function WebcamStream({ addSentence, clearSignal }: Props) {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [text, setText] = useState("");
  const [sentence, setSentence] = useState("");
  const [currentWord, setCurrentWord] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sentenceSuggestions, setSentenceSuggestions] = useState<string[]>([]);
  const [landmarks, setLandmarks] = useState<number[][] | null>(null);
  const [confidence, setConfidence] = useState("");
  const [hand, setHand] = useState("");
  const [type, setType] = useState("");

  const currentWordRef = useRef("");
  const sentenceRef = useRef("");        // mirror of sentence for use inside async callbacks

  // ─── Clear everything when parent signals a session clear ──────────────
  useEffect(() => {
    if (clearSignal === 0) return; // skip on initial mount
    setSentence("");
    sentenceRef.current = "";
    setCurrentWord("");
    currentWordRef.current = "";
    setSuggestions([]);
    setSentenceSuggestions([]);
    setLandmarks(null);
    setText("");
    setConfidence("");
    setHand("");
    setType("");
  }, [clearSignal]);

  // ─── Keep sentenceRef in sync ─────────────────────────────────────────
  useEffect(() => {
    sentenceRef.current = sentence;
  }, [sentence]);

  // ─── Capture loop: 300ms interval ────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(captureAndSend, 300);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Draw landmark skeleton on canvas overlay ─────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = (canvas.width = canvas.offsetWidth);
    const H = (canvas.height = canvas.offsetHeight);
    ctx.clearRect(0, 0, W, H);

    if (!landmarks || landmarks.length < 21) return;

    // Flip x to compensate for CSS scale-x-[-1] mirror on the webcam
    const fx = (x: number) => (1 - x) * W;
    const fy = (y: number) => y * H;

    ctx.strokeStyle = "lime";
    ctx.lineWidth = 2;
    CONNECTIONS.forEach(([a, b]) => {
      const [x1, y1] = landmarks[a];
      const [x2, y2] = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(fx(x1), fy(y1));
      ctx.lineTo(fx(x2), fy(y2));
      ctx.stroke();
    });

    ctx.fillStyle = "red";
    landmarks.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(fx(x), fy(y), 5, 0, 2 * Math.PI);
      ctx.fill();
    });

    // Bounding box + label
    const xs = landmarks.map(([x]) => fx(x));
    const ys = landmarks.map(([, y]) => fy(y));
    const bx = Math.min(...xs) - 15;
    const bx2 = Math.max(...xs) + 15;
    const by = Math.min(...ys) - 30;
    const by2 = Math.max(...ys) + 15;

    ctx.strokeStyle = "cyan";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bx2 - bx, by2 - by);

    if (text) {
      ctx.fillStyle = "cyan";
      ctx.font = "bold 18px monospace";
      ctx.fillText(text, bx, by - 5);
    }
  }, [landmarks, text]);

  // ─── Capture + flip + send ────────────────────────────────────────────
  const captureAndSend = () => {
    if (!webcamRef.current) return;
    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return;

    const img = new Image();
    img.src = imageSrc;
    img.onload = async () => {
      const offscreen = document.createElement("canvas");
      offscreen.width = img.width;
      offscreen.height = img.height;
      const ctx = offscreen.getContext("2d")!;
      ctx.translate(offscreen.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      await sendToBackend(offscreen.toDataURL("image/jpeg"));
    };
  };

  // ─── Spell-correct + flush current word to sentence ──────────────────
  const correctAndFlush = async () => {
    const word = currentWordRef.current;
    if (!word) return;

    const data = await correctWord(word);
    const corrected: string = data.corrected || word;

    const next = (sentenceRef.current + corrected + " ").trimStart();
    sentenceRef.current = next;
    setSentence(next);
    addSentence(next.trim());

    currentWordRef.current = "";
    setCurrentWord("");
    setSuggestions(data.suggestions || []);

    // Ask Gemini for 2 full sentence suggestions based on what's been signed
    const partial = next.trim();
    if (partial) {
      getSentenceSuggestions(partial)
        .then((res) => setSentenceSuggestions(res.suggestions || []))
        .catch(() => {});
    }
  };

  // ─── Process one prediction from backend ─────────────────────────────
  const sendToBackend = async (imageSrc: string) => {
    const result = await predictGesture(imageSrc);
    const pred = result.prediction;

    if (!pred) {
      setLandmarks(null);
      setText("");
      setConfidence("");
      setHand("");
      setType("");
      return;
    }

    const label: string = pred.label;
    setText(label);
    setConfidence(pred.confidence?.toFixed(2) ?? "");
    setHand(pred.hand ?? "");
    setType(pred.type ?? "");

    if (pred.landmarks) {
      const pairs: number[][] = [];
      for (let i = 0; i < pred.landmarks.length; i += 2) {
        pairs.push([pred.landmarks[i], pred.landmarks[i + 1]]);
      }
      setLandmarks(pairs);
    }

    if (label === "space") {
      await correctAndFlush();
    } else if (label === "del") {
      const updated = currentWordRef.current.slice(0, -1);
      currentWordRef.current = updated;
      setCurrentWord(updated);
    } else {
      const updated = currentWordRef.current + label;
      currentWordRef.current = updated;
      setCurrentWord(updated);

      getSuggestions(updated)
        .then((data) => setSuggestions(data.suggestions || []))
        .catch(() => {});
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-4">
      <h2 className="text-2xl font-bold">American Sign Language</h2>

      <div className="relative w-full max-w-md">
        <Webcam
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          videoConstraints={{ width: 400, height: 300 }}
          className="w-full scale-x-[-1]"
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />
      </div>

      <div className="text-xl font-mono border p-4 text-center w-full max-w-md">
        {text || "Detecting..."}
      </div>

      <div className="text-lg font-mono text-blue-600 min-h-[28px]">
        {currentWord ? `Signing: ${currentWord}` : ""}
      </div>

      {suggestions.length > 0 && (
        <div className="flex gap-2 flex-wrap justify-center">
          {suggestions.map((s) => (
            <button
              key={s}
              className="px-3 py-1 border rounded text-sm font-mono hover:bg-gray-100"
              onClick={() => {
                const next = (sentenceRef.current + s + " ").trimStart();
                sentenceRef.current = next;
                setSentence(next);
                addSentence(next.trim());
                currentWordRef.current = "";
                setCurrentWord("");
                setSuggestions([]);
                setSentenceSuggestions([]);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {sentenceSuggestions.length > 0 && (
        <div className="flex flex-col gap-1 w-full max-w-md">
          <span className="text-xs text-purple-500 font-semibold tracking-wide uppercase px-1">
            ✦ Gemini suggests
          </span>
          <div className="flex flex-col gap-1">
            {sentenceSuggestions.map((s) => (
              <button
                key={s}
                className="w-full text-left px-3 py-2 border border-purple-200 rounded-lg text-sm font-mono bg-purple-50 hover:bg-purple-100 text-purple-900 transition-colors"
                onClick={() => {
                  sentenceRef.current = s + " ";
                  setSentence(s + " ");
                  addSentence(s);
                  currentWordRef.current = "";
                  setCurrentWord("");
                  setSuggestions([]);
                  setSentenceSuggestions([]);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="text-xl font-mono border p-4 w-full max-w-md text-center break-words overflow-y-auto whitespace-pre-wrap min-h-[60px]">
        {sentence || "No signs detected yet."}
      </div>

      <div className="text-sm text-gray-500">
        Confidence: {confidence} | Hand: {hand} | Type: {type}
      </div>
    </div>
  );
}
