# ASL Translator — Complete End-to-End Workflow

> **Scope:** Every file under `deploy_azure/`. Covers frontend, backend, models, training, and services.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (Vite + React + TS)      │
│  WebcamStream → api.ts → HTTP POST → FastAPI Backend │
│  ReverseInput  → /reverse                            │
│  Chatbox       → /chat                               │
│  TranscriptPanel ← useSession (localStorage)         │
└──────────────────────────┬──────────────────────────┘
                           │ HTTP (CORS)
┌──────────────────────────▼──────────────────────────┐
│                    BACKEND (FastAPI)                  │
│  app.py → handedness.py → MediaPipe → RF Model       │
│         → routes/reverse → landmark_service.py       │
│         → routes/chat   → gemini_service.py          │
│         → postprocess.py (spellcheck / suggest)      │
└─────────────────────────────────────────────────────┘
```

**Environment variables:**
| Key | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `backend/.env` | Gemini AI model access |
| `ALLOWED_ORIGINS` | `backend/.env` | CORS whitelist |
| `VITE_API_BASE_URL` | `frontend/.env` | Points frontend to backend |

---

## BACKEND

### Entry Point — `backend/app.py`

**Role:** FastAPI application bootstrap.

**What it does:**
1. Loads `.env` via `python-dotenv`
2. Creates `FastAPI` instance with an `asynccontextmanager` lifespan that calls `hands.close()` on shutdown
3. Applies `CORSMiddleware` using `ALLOWED_ORIGINS` from env
4. Registers three route modules: `routes/complete`, `routes/reverse`, `routes/chat`
5. Defines two inline endpoints directly: `POST /predict` and `POST /correct`, `POST /suggest`

**Direct endpoints defined here:**

| Endpoint | Input | Calls | Returns |
|---|---|---|---|
| `POST /predict` | Form: `image` (base64 JPEG) | `handle_frame()` in `handedness.py` | `{prediction: {label, type, hand, confidence, landmarks}}` |
| `POST /correct` | Form: `word` | `spell.correction()` + `suggest_completions()` | `{corrected, suggestions[]}` |
| `POST /suggest` | Form: `prefix` | `suggest_completions()` from `postprocess.py` | `{suggestions[]}` |

**Connects to:** `handedness.py`, `postprocess.py`, `routes/` (all three)

---

### Hand Detection + Prediction — `backend/handedness.py`

**Role:** The core inference engine. Receives a raw video frame and returns a committed letter or space.

**Global singletons created at import time:**
- `letter_model` — loaded from `classifier/classify_letter_model.p`
- `digit_model` — loaded from `classifier/classify_digit_model.p`
- `router` — `HandRouter` instance
- `hands` — `mp.solutions.hands.Hands` (live mode, max 1 hand)
- `gesture_timer` — `GestureTimer(letter_hold_ms=600, repeat_pause_ms=450, word_pause_ms=900)`
- `lock` — `threading.Lock` for thread-safe frame processing

**`HandRouter` class:**
- `predict(results)` — iterates detected hands sorted left-to-right by wrist X
- `_predict_single_hand(results, hand_index, hand_label)`:
  1. `extract_landmarks_by_index()` → 42 raw floats
  2. `normalize_landmarks()` → position/scale-independent 42 floats
  3. Route: `Right hand → letter_model`, `Left hand → digit_model`
  4. `model.predict_proba()` + `model.predict()` → label + confidence
  5. Returns `{landmarks, label, type, hand, confidence}`

**`handle_frame(frame)` function** (called by `app.py /predict`):
1. Acquires thread lock
2. Converts BGR → RGB, runs MediaPipe `hands.process()`
3. Calls `router.predict(results)` → list of predictions
4. Feeds first prediction into `gesture_timer.update(label, hand_present, timestamp_ms)`
5. **Only returns a result if `event.commit_letter` is set** — otherwise returns `{}`
6. If no hand, may return `{label: "space"}` when `event.commit_space` is True

**Imports from:** `utils.py`, `postprocess.py`, `timer.py`

---

### Gesture Timing Gate — `backend/timer.py`

**Role:** Prevents jitter. A letter is only committed after it is held stably for `letter_hold_ms` (600ms). Handles double letters and word spacing.

**`GestureTimer` class — three rules:**

| Rule | Threshold | Behavior |
|---|---|---|
| Letter hold | `letter_hold_ms = 600ms` | Label must be stable for 600ms before commit |
| Repeat letter | `repeat_pause_ms = 450ms` | Same label re-committed only after 450ms release gap |
| Word space | `word_pause_ms = 900ms` | No hand for 900ms → emit one `commit_space` |

**`TimerEvent` dataclass:** `commit_letter: Optional[str]`, `commit_space: bool`

**`update(label, hand_present, timestamp_ms)`** — called on every frame:
- No hand: calls `_release_active_label()`, starts/continues no-hand gap timer
- Hand present: resets no-hand gap; if label changed, starts new streak; if held long enough → sets `commit_letter`

**`update_frame(label, hand_present)`** — advances by fixed `frame_ms` (for testing without real timestamps)

**Called by:** `handedness.py` → `handle_frame()`

---

### Feature Engineering — `backend/utils.py`

**Role:** Shared math and helper library. Used by both training (`train.py`) and inference (`handedness.py`).

**Key functions:**

| Function | Input | Output | Used by |
|---|---|---|---|
| `load_model(path)` | `.p` file path | sklearn RF model | `handedness.py` |
| `extract_landmarks(results)` | MediaPipe results | 42 raw floats | reference/tests |
| `extract_landmarks_by_index(results, i)` | MediaPipe results + hand index | 42 raw floats | `handedness.py` |
| `extract_landmarks_from_image(img_path, hands)` | image path | 42 raw floats | `train.py`, `test_model.py` |
| `normalize_landmarks(landmarks)` | 42 raw floats | 42 normalized floats | `handedness.py`, `train.py` |
| `compute_finger_angles(landmarks)` | 42 floats | 15 joint angles (radians) | experimental |
| `build_feature_vector(landmarks, use_angles)` | 42 floats | 42 or 57 features | utility |
| `get_handedness(results)` | MediaPipe results | `{idx: "Left"/"Right"}` | `handedness.py` |
| `count_hands(results)` | MediaPipe results | int 0-2 | reference |
| `get_wrist_x(results, hand_index)` | MediaPipe results + idx | float 0.0-1.0 | `handedness.py` (sorting) |
| `draw_landmarks(image, pts)` | frame + pixel pts | annotated frame | training/debug |
| `calc_landmark_list(image, lm)` | frame + MediaPipe LMs | pixel coord list | training/debug |

**Normalization logic** (`normalize_landmarks`):
1. Subtract wrist (point 0) → wrist becomes origin (0,0)
2. Divide by distance from wrist to middle MCP (point 9) → scale-invariant
3. Returns 42 floats, position/size-independent

---

### Postprocessing — `backend/postprocess.py`

**Role:** Spell-checking and word completion.

**`DebounceBuffer` class** (defined but not actively wired to the live path — timing now handled by `GestureTimer`):
- `push(char)` → returns char if new, `None` if duplicate
- `reset()` → allows same letter again (for double letters like LL)

**`suggest_completions(prefix, n=5)`:**
1. Searches `pyspellchecker`'s internal word frequency dictionary for words starting with `prefix`
2. Sorts matches by `word_usage_frequency` (most common first)
3. Returns top `n` words

**Called by:** `app.py` (`/correct` and `/suggest`), `handedness.py` (import only)

---

### API Routes — `backend/routes/`

#### `routes/complete.py` → `POST /complete`
- Input: JSON `{words: string[]}`
- Calls: `gemini_service.complete_sentence(words)`
- Returns: `{sentence: string}`
- Use case: Convert ASL-order words ("WANT COFFEE I") into fluent English

#### `routes/reverse.py` → `POST /reverse`
- Input: JSON `{text: string, duration_ms: int = 600}`
- Calls: `landmark_service.get_frames_for_text(text, duration_ms)`
- Returns: `{frames: AnimationFrame[]}`
- Use case: Type "HELLO" → get 5 frames (one image per letter)

#### `routes/chat.py` → `POST /chat`
- Input: JSON `{message: string, history: ChatMessage[]}`
- Calls: `gemini_service.chat_response(message, history)`
- If `result["animate_word"]` is set → calls `landmark_service.get_frames_for_text(word)`
- Returns: `{reply, animation_frames, trigger_animation}`
- Use case: "How do I sign HELLO?" → reply text + H-E-L-L-O animation frames

---

### Services — `backend/services/`

#### `services/gemini_service.py`

**Connects to:** Google Gemini API (`gemini-1.5-flash`)

**`complete_sentence(words: list[str]) → str`:**
- Builds prompt telling Gemini to convert ASL-order word list to fluent English
- Fallback: joins words with spaces on exception

**`chat_response(message, history) → dict`:**
- System prompt: "You are a friendly ASL learning assistant"
- Parses `ANIMATE:[word]` marker from reply — strips it from text, extracts word
- Returns `{reply: str, animate_word: str|None}`
- `animate_word` triggers `landmark_service` in `routes/chat.py`

#### `services/landmark_service.py`

**Role:** Text → animation frame generator for Reverse Mode and Chat.

**Data sources:**
- Letters: `dataset/archive/asl_alphabet_train/<LETTER>/`
- Digits: `dataset/archive/asl_digit_train/<DIGIT>/`

**`get_frames_for_text(text, duration_ms=600) → list[dict]`:**
1. Iterates each character in `text.upper()`
2. Space → blank frame `{letter:" ", landmarks:None, image_data:None, duration_ms:400}`
3. Letter/digit → `_get_first_image_for_char(ch)` → finds folder, picks **first file in sorted order** (deterministic)
4. Loads image as base64 data URL via `_load_image_data_url()` (LRU cached, `maxsize=128`)
5. Returns `{letter, landmarks:None, image_data: "data:image/jpeg;base64,...", duration_ms}`

> **Note:** `landmarks` field is always `None` in reverse mode — only `image_data` is used. The frontend `GestureCanvas` detects this and renders `<img>` instead of the canvas skeleton.

---

### Training Pipeline — `backend/train.py`

**Role:** Offline script. Run once to build models from dataset images.

**Data paths:**
- Letters: `dataset/archive/asl_alphabet_train/` → 26 letter folders + `del`, `space`, `nothing`
- Digits: `dataset/archive/asl_digit_train/` → 10 digit folders

**Pipeline (for each of `letter` and `digit` configs):**

1. **`process_and_save_dataset()`**
   - Iterates all class folders
   - Per image: `extract_landmarks_from_image()` → `normalize_landmarks()` → 42 floats
   - Flip augmentation: `flip_landmarks_x()` — mirrors X coords, doubles dataset size
   - Saves `{data, labels}` to pickle (`letter_dataset.pickle` / `digit_dataset.pickle`)

2. **`train_classifier()`**
   - Loads pickle
   - Validates all vectors are exactly 42 features
   - 80/20 stratified train/test split
   - `RandomForestClassifier(n_estimators=100, n_jobs=-1)`
   - Evaluates accuracy + classification report
   - Saves model: `pickle.dump({'model': clf, 'label_map': ...})`
   - Saves confusion matrix PNG

**Output models** (loaded at runtime by `handedness.py`):
- `classifier/classify_letter_model.p` — 144 MB
- `classifier/classify_digit_model.p` — 7.5 MB

**Key design:** Training uses `normalize_landmarks()` from `utils.py` — **exactly the same function used at inference**. This is critical for prediction accuracy.

---

### Supporting Files

| File | Role |
|---|---|
| `backend/test_model.py` | Evaluates saved models on test images |
| `backend/test_timer.py` | Unit tests for `GestureTimer` |
| `backend/scripts/compute_landmarks_per_letter.py` | Legacy: averages landmarks per class → `data/landmarks_per_letter.json` |
| `backend/data/landmarks_per_letter.json` | Legacy averaged landmark data (not used in live inference) |
| `backend/requirements.txt` | `fastapi, uvicorn, mediapipe, opencv-python-headless, scikit-learn, numpy, google-generativeai, pyspellchecker, imageio` |

---

## FRONTEND

### Entry & Layout

#### `frontend/index.html`
Vite HTML shell. Single `<div id="root">`. Loads `src/main.tsx`.

#### `frontend/src/main.tsx`
React 19 bootstrap. Renders `<App />` into `#root`.

#### `frontend/src/App.tsx`
**Role:** Top-level layout and state coordinator.

- Calls `useSession()` → gets `{session, addSentence, clearSession, copyTranscript}`
- `clearSignal` — incrementing integer passed to `WebcamStream` to trigger reset
- Renders two-column layout:
  - **Left:** `<WebcamStream addSentence={addSentence} clearSignal={clearSignal} />`
  - **Right:** `<TranscriptPanel>` + tab switcher (`reverse` | `chat`)
    - Tab "Reverse Mode" → `<ReverseInput />`
    - Tab "Chat" → `<Chatbox />`

---

### Live Webcam — `frontend/src/WebcamStream.tsx`

**Role:** The live ASL capture and text-building engine. The most complex frontend component.

**State managed:**
- `text` — current predicted label (single letter/digit)
- `currentWord` — letters accumulated so far in current word
- `sentence` — full sentence buffer (all flushed words)
- `suggestions` — word completion suggestions
- `landmarks` — 21 `[x,y]` pairs for canvas overlay
- `confidence`, `hand`, `type` — metadata from prediction

**Capture loop** (`setInterval(captureAndSend, 300)`):
1. `webcamRef.current.getScreenshot()` → JPEG base64
2. Creates `<img>`, draws onto **offscreen canvas** with `ctx.scale(-1,1)` — mirrors horizontally
3. Calls `sendToBackend(offscreen.toDataURL("image/jpeg"))`

**`sendToBackend(imageSrc)`:**
1. `predictGesture(imageSrc)` → `POST /predict`
2. If `pred` is null → clears landmarks/state
3. Extracts `label, confidence, hand, type`
4. Parses `landmarks` from flat array `[x0,y0,x1,y1...]` → `[[x,y],[x,y]...]` pairs
5. **Label routing:**
   - `"space"` → `correctAndFlush()` — spell-corrects `currentWord`, appends to sentence
   - `"del"` → removes last char from `currentWordRef`
   - Any letter/digit → appends to `currentWord`, calls `getSuggestions(updatedWord)` async

**`correctAndFlush()`:**
1. `correctWord(word)` → `POST /correct` → `{corrected, suggestions}`
2. Appends corrected word + space to sentence
3. Calls `addSentence(sentence.trim())` → stored in session
4. Resets `currentWord`

**Canvas overlay** (drawn on every `landmarks`/`text` change):
- Flips X via `fx = (1 - x) * W` to match CSS `scale-x-[-1]` mirror on webcam video
- Draws 22 bone connections in lime green
- Draws 21 red dots (5px, 8px for fingertips)
- Draws cyan bounding box + label above hand

**Suggestion chips:** Clickable buttons that directly flush the word to sentence, bypassing spell-correct.

---

### Session Management — `frontend/src/hooks/useSession.ts`

**Role:** Persistent transcript state across page reloads.

- `STORAGE_KEY = "asl_session"`
- Initializes from `localStorage` on mount
- `addSentence(text)` → creates `{id: UUID, text, time}` entry, saves to localStorage
- `clearSession()` → removes localStorage key, resets state
- `copyTranscript()` → formats `[HH:MM:SS] sentence` per line, writes to clipboard

**Used by:** `App.tsx` (distributes `addSentence` to `WebcamStream`, `session` to `TranscriptPanel`)

---

### API Layer — `frontend/src/utils/api.ts`

**Role:** Single source of truth for all backend HTTP calls. All components go through this file.

**Base URL:** `VITE_API_BASE_URL` env var, defaults to `http://localhost:8000`

| Export | Method | Endpoint | Body Format | Returns |
|---|---|---|---|---|
| `predictGesture(frame)` | POST | `/predict` | `application/x-www-form-urlencoded` | `{prediction}` |
| `getSuggestions(prefix)` | POST | `/suggest` | form | `{suggestions[]}` |
| `correctWord(word)` | POST | `/correct` | form | `{corrected, suggestions[]}` |
| `completeSentence(words[])` | POST | `/complete` | JSON | `{sentence}` |
| `reverseToAnimation(text, duration_ms)` | POST | `/reverse` | JSON | `{frames: AnimationFrame[]}` |
| `sendChat(message, history[])` | POST | `/chat` | JSON | `{reply, animation_frames, trigger_animation}` |

**TypeScript interfaces defined here:**
- `AnimationFrame: {letter, landmarks, image_data, duration_ms}`
- `ChatMessage: {role: "user"|"model", content}`

---

### Transcript Panel — `components/TranscriptPanel.tsx`

- Displays `session: SessionEntry[]` as a scrolling timeline
- Auto-scrolls to latest entry
- **"Clear" button** has a 2-step confirmation (click once → "Confirm Clear", auto-reverts after 3s)
- **"Copy"** calls `onCopy()` from `useSession`

---

### Reverse Mode — `components/ReverseInput.tsx`

- Text input → user types English text
- On submit: `reverseToAnimation(text)` → `POST /reverse` → `{frames}`
- Passes `frames` and `word.toUpperCase()` to `<GestureCanvas>`
- `GestureCanvas` plays back the frame sequence letter by letter

---

### Animation Player — `components/GestureCanvas.tsx`

**Role:** Plays back `AnimationFrame[]` sequences from reverse mode or chat.

**State:** `frameIdx`, `playing`, `loop`, `speed` (0.5x / 1x / 2x)

**Rendering logic per frame:**
- If `frame.image_data` exists → render `<img src={image_data}>` (reverse mode always hits this)
- Else → draw skeleton on `<canvas>` using `frame.landmarks`

**Timer loop** (uses `setTimeout` chain, not `setInterval`):
- Each frame's `duration_ms / speed` determines delay to next frame
- Uses `animIdRef` to cancel stale timers when frames prop changes
- Supports loop/stop at end

**Letter highlight:** When `word` prop is passed, highlights the current letter in `CYAN` underline as animation plays.

**Controls:** Play/Pause, Speed selector, Loop checkbox

---

### Chat — `components/Chatbox.tsx`

- Maintains local `messages: {role, content, frames?}[]`
- Sends `sendChat(message, history)` → `POST /chat`
- If `data.trigger_animation` is true → attaches `data.animation_frames` to assistant message
- Renders assistant messages with optional inline `<GestureCanvas frames={msg.frames} />`
- Three starter prompt buttons shown when no messages yet

---

## WORKFLOW 1: Live ASL → Text (Primary Path)

```
[User holds up hand]
       ↓
WebcamStream: setInterval 300ms
       ↓
captureAndSend() → mirror flip offscreen canvas
       ↓
api.ts predictGesture(base64JPEG)
       ↓
POST /predict (form-encoded)
       ↓
app.py: base64 decode → cv2.imdecode → handle_frame(frame)
       ↓
handedness.py handle_frame():
  ├─ cv2 BGR→RGB → hands.process(rgb)
  ├─ router.predict(results)
  │   ├─ get_handedness() → {0: "Right"}
  │   ├─ extract_landmarks_by_index(results, 0) → 42 floats
  │   ├─ normalize_landmarks() → 42 normalized floats
  │   └─ letter_model.predict() + predict_proba() → label + confidence
  └─ gesture_timer.update(label, hand_present=True, now_ms)
      ├─ if held < 600ms → return {} (no commit yet)
      └─ if held ≥ 600ms → return {commit_letter: "A"}
       ↓
app.py returns {prediction: {label:"A", type:"letter", hand:"Right", confidence:0.91, landmarks:[...]}}
       ↓
WebcamStream sendToBackend():
  ├─ setLandmarks([[x,y]×21]) → triggers canvas redraw
  ├─ setText("A")
  └─ label = "A" → currentWord += "A" → getSuggestions("A")
       ↓
[User lowers hand for 900ms]
       ↓
gesture_timer → commit_space=True → backend returns {label:"space"}
       ↓
WebcamStream: correctAndFlush()
  ├─ correctWord("apple") → POST /correct → {corrected:"apple", suggestions:[...]}
  ├─ sentence += "apple "
  └─ addSentence("apple") → useSession → localStorage
```

---

## WORKFLOW 2: Reverse Mode (Text → ASL Animation)

```
[User types "HELLO" in ReverseInput]
       ↓
handleSubmit() → reverseToAnimation("HELLO")
       ↓
POST /reverse {text:"HELLO", duration_ms:600}
       ↓
routes/reverse.py → landmark_service.get_frames_for_text("HELLO", 600)
       ↓
For each char H,E,L,L,O:
  _get_first_image_for_char(ch)
  → dataset/archive/asl_alphabet_train/H/ → sorted()[0] → "H0001.jpg"
  → _load_image_data_url(path) [LRU cached]
  → "data:image/jpeg;base64,..."
       ↓
Returns [{letter:"H", image_data:"data:...", landmarks:null, duration_ms:600}, ×5]
       ↓
ReverseInput: setFrames(data.frames) → passes to GestureCanvas
       ↓
GestureCanvas: plays frames with setTimeout chain
  Each frame: image_data exists → renders <img>
  Highlights current letter in word display
```

---

## WORKFLOW 3: Chat Assistant

```
[User types "How do I sign HELLO?"]
       ↓
Chatbox send() → sendChat(message, history)
       ↓
POST /chat {message, history:[]}
       ↓
routes/chat.py → gemini_service.chat_response()
       ↓
Gemini: system_prompt + message
       ↓
Reply: "Great question! HELLO: ... ANIMATE:[HELLO]"
       ↓
gemini_service parses ANIMATE:[HELLO]:
  reply = "Great question! HELLO: ..."
  animate_word = "HELLO"
       ↓
routes/chat.py: animate_word → get_frames_for_text("HELLO")
       ↓
Returns {reply, animation_frames:[...], trigger_animation:true}
       ↓
Chatbox: assistantMsg = {role:"model", content:reply, frames:animation_frames}
       ↓
Renders: text bubble + <GestureCanvas frames={...} />
```

---

## WORKFLOW 4: Offline Training

```
python train.py both
       ↓
For each config (letter, digit):
  process_and_save_dataset():
    For each class folder:
      For each image (up to samples_per_class):
        cv2.imread → BGR→RGB → hands.process()
        → normalize_landmarks() → 42 floats
        + flip_landmarks_x() → 42 floats (augmentation)
    → pickle.dump {data, labels} → letter_dataset.pickle
       ↓
  train_classifier():
    load pickle → filter bad vectors
    → 80/20 stratified split
    → RandomForestClassifier(n_estimators=100)
    → evaluate (accuracy + classification_report)
    → pickle.dump {model, label_map} → classify_letter_model.p
    → save confusion_matrix_letter.png
       ↓
hands.close()
```

**Training → Runtime connection:**
- `normalize_landmarks()` in `utils.py` is shared identically by `train.py` and `handedness.py`
- Model is saved as `{'model': clf}` and loaded with `load_model()` from `utils.py`

---

## Data Flow Summary Table

| Data | Origin | Destination | Format |
|---|---|---|---|
| Webcam JPEG | `WebcamStream` (browser) | `/predict` | Base64 form field |
| Raw landmarks | MediaPipe | `HandRouter` | 42 floats (x,y pairs) |
| Normalized landmarks | `utils.normalize_landmarks()` | RF model | 42 floats |
| Prediction | RF model | `app.py` → frontend | JSON `{label, confidence, hand, type, landmarks}` |
| Committed letter | `GestureTimer` | `WebcamStream` | string or `"space"`/`"del"` |
| Current word | `WebcamStream` state | `/suggest` | Form prefix |
| Corrected word | `/correct` + `pyspellchecker` | `useSession` | string |
| Session transcript | `useSession` | `TranscriptPanel` + localStorage | `SessionEntry[]` |
| ASL frames | `landmark_service` | `GestureCanvas` | `AnimationFrame[]` with base64 images |
| Chat reply | Gemini API | `Chatbox` | JSON with optional frames |

---

## Identified Gaps / Notes

1. **`DebounceBuffer`** in `postprocess.py` is defined but **not connected** in the live path — timing is fully handled by `GestureTimer`. The class exists as legacy/alternative.

2. **`build_feature_vector(use_angles=True)`** (57 features) is defined in `utils.py` but both production models are trained on 42 features. The 57-feature path is experimental only.

3. **`landmark_service`** always sets `landmarks: None` in frames — `GestureCanvas` never draws skeletons for reverse mode, only images.

4. **`data/landmarks_per_letter.json`** (precomputed averages) and `scripts/compute_landmarks_per_letter.py` are legacy artifacts. Reverse mode now uses real training images.

5. **`completeSentence()`** (`/complete` endpoint) is defined in `api.ts` but **no frontend component calls it** — the route and service exist but are unused in the current UI.

6. **`GestureCanvas`** defines its own `CONNECTIONS` array identical to the one in `WebcamStream.tsx` — duplicated, could be extracted to a shared util.

7. **Single-hand only** — `handedness.py` initializes MediaPipe with `max_num_hands=1`, so dual-hand processing in `HandRouter` (`sorted_hands` loop) never processes more than one hand in production.
