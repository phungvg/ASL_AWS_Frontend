import { useState } from "react";
import WebcamStream from "./WebcamStream";
import TranscriptPanel from "./components/TranscriptPanel";
import ReverseInput from "./components/ReverseInput";
import Chatbox from "./components/Chatbox";
import { useSession } from "./hooks/useSession";
import "./App.css";

type Tab = "reverse" | "chat";

export default function App() {
  const { session, addSentence, clearSession, copyTranscript } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>("reverse");
  const [clearSignal, setClearSignal] = useState(0);

  const handleClear = () => {
    clearSession();
    setClearSignal((n) => n + 1); // tell WebcamStream to reset too
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b bg-white px-6 py-3">
        <h1 className="text-xl font-bold tracking-tight">ASL Translator</h1>
      </header>

      <main className="flex flex-col md:flex-row gap-6 p-6 max-w-6xl mx-auto">
        {/* Left: webcam + signing */}
        <section className="flex-1 min-w-0">
          <WebcamStream addSentence={addSentence} clearSignal={clearSignal} />
        </section>

        {/* Right: transcript + tools */}
        <aside className="flex-1 min-w-0 flex flex-col gap-6">
          <TranscriptPanel
            session={session}
            onCopy={copyTranscript}
            onClear={handleClear}
          />

          {/* Tab switcher */}
          <div>
            <div className="flex border-b mb-4">
              {(["reverse", "chat"] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-mono capitalize border-b-2 -mb-px transition-colors ${
                    activeTab === tab
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab === "reverse" ? "Reverse Mode" : "Chat"}
                </button>
              ))}
            </div>

            {activeTab === "reverse" && <ReverseInput />}
            {activeTab === "chat" && <Chatbox />}
          </div>
        </aside>
      </main>
    </div>
  );
}
