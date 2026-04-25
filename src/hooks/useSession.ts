import { useState, useCallback } from "react";

export interface SessionEntry {
  id: string;
  text: string;
  time: string;
}

const STORAGE_KEY = "asl_session";

function loadFromStorage(): SessionEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(entries: SessionEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function useSession() {
  const [session, setSession] = useState<SessionEntry[]>(loadFromStorage);

  const addSentence = useCallback((text: string) => {
    const entry: SessionEntry = {
      id: crypto.randomUUID(),
      text,
      time: new Date().toLocaleTimeString(),
    };
    setSession((prev) => {
      const next = [...prev, entry];
      saveToStorage(next);
      return next;
    });
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession([]);
  }, []);

  const copyTranscript = useCallback(() => {
    const text = session
      .map((e) => `[${e.time}] ${e.text}`)
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
  }, [session]);

  return { session, addSentence, clearSession, copyTranscript };
}
