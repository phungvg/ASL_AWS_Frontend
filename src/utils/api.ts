const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export interface AnimationFrame {
  letter: string;
  landmarks: [number, number, number][] | null;
  image_data?: string | null;
  duration_ms: number;
}

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export const predictGesture = async (frame: string) => {
  const res = await fetch(`${BASE}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ image: frame }),
  });
  return res.json();
};

export const getSuggestions = async (prefix: string) => {
  const res = await fetch(`${BASE}/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ prefix }),
  });
  return res.json();
};

export const correctWord = async (word: string) => {
  const res = await fetch(`${BASE}/correct`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ word }),
  });
  return res.json();
};

export const completeSentence = async (words: string[]) => {
  const res = await fetch(`${BASE}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ words }),
  });
  return res.json();
};

export const reverseToAnimation = async (
  text: string,
  duration_ms = 600
): Promise<{ frames: AnimationFrame[] }> => {
  const res = await fetch(`${BASE}/reverse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, duration_ms }),
  });
  return res.json();
};

export const sendChat = async (message: string, history: ChatMessage[]) => {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  return res.json();
};

/**
 * Ask Gemini for 2 full sentence completions based on what the user
 * has signed so far (e.g. "hello" → ["Hello, how are you?", "Hello, what is your name?"])
 * Called on every word boundary (space gesture).
 */
export const getSentenceSuggestions = async (
  partial: string
): Promise<{ suggestions: string[] }> => {
  const res = await fetch(`${BASE}/sentence-suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partial }),
  });
  return res.json();
};
