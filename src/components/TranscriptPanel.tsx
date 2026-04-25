import { useRef, useEffect, useState } from "react";
import type { SessionEntry } from "../hooks/useSession";

interface Props {
  session: SessionEntry[];
  onCopy: () => void;
  onClear: () => void;
}

export default function TranscriptPanel({ session, onCopy, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session]);

  const handleClear = () => {
    if (confirming) {
      onClear();
      setConfirming(false);
    } else {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Session Transcript</h3>
        <div className="flex gap-2">
          <button
            onClick={onCopy}
            disabled={session.length === 0}
            className="px-3 py-1 border rounded text-sm hover:bg-gray-100 disabled:opacity-40"
          >
            Copy
          </button>
          <button
            onClick={handleClear}
            disabled={session.length === 0}
            className={`px-3 py-1 border rounded text-sm disabled:opacity-40 ${
              confirming
                ? "bg-red-600 text-white hover:bg-red-500"
                : "hover:bg-gray-100"
            }`}
          >
            {confirming ? "Confirm Clear" : "Clear"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-[200px] max-h-[500px] border rounded p-3">
        {session.length === 0 ? (
          <p className="text-gray-400 text-sm text-center mt-8">
            Completed sentences will appear here.
          </p>
        ) : (
          session.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-0.5">
              <span className="text-xs text-gray-400">{entry.time}</span>
              <div className="bg-blue-50 border border-blue-100 rounded px-3 py-2 text-sm font-mono">
                {entry.text}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
