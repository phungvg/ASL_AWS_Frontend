import { useState } from "react";
import { reverseToAnimation, type AnimationFrame } from "../utils/api";
import GestureCanvas from "./GestureCanvas";

export default function ReverseInput() {
  const [input, setInput] = useState("");
  const [frames, setFrames] = useState<AnimationFrame[] | null>(null);
  const [word, setWord] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const data = await reverseToAnimation(trimmed);
      setFrames(data.frames);
      setWord(trimmed.toUpperCase());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-bold">Text → ASL Animation</h3>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Type a word or sentence..."
          className="flex-1 border rounded px-3 py-2 font-mono text-sm"
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || loading}
          className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-mono hover:bg-blue-500 disabled:opacity-40"
        >
          {loading ? "..." : "Animate"}
        </button>
      </div>

      <GestureCanvas frames={frames} word={word} />
    </div>
  );
}
