// Service to provide 100% authentic, native Vietnamese speech (khử hoàn toàn hiện tượng lớ lớ do giọng Tây đọc tiếng Việt)

const CACHE_STORAGE_KEY = "kids_app_vi_audio_cache_v1";

// In-memory cache
const memoryAudioCache = new Map<string, string>();

// Initialize from localStorage if available
try {
  const saved = localStorage.getItem(CACHE_STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    Object.entries(parsed).forEach(([k, v]) => {
      if (typeof v === "string") memoryAudioCache.set(k, v);
    });
  }
} catch {
  // Ignore localStorage read errors
}

const persistCache = () => {
  try {
    const obj: Record<string, string> = {};
    memoryAudioCache.forEach((v, k) => {
      obj[k] = v;
    });
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage quota errors
  }
};

/**
 * Check if the device / browser has a true native Vietnamese voice.
 * CRITICAL: Must return null if only English/foreign voices are installed,
 * so we NEVER let an English voice read Vietnamese text with an American accent ("lớ lớ").
 */
export const getNativeDeviceVietnameseVoice = (): SpeechSynthesisVoice | null => {
  if (!("speechSynthesis" in window)) return null;
  const allVoices = window.speechSynthesis.getVoices();
  if (!allVoices || allVoices.length === 0) return null;

  // 1. Google Vietnamese (Chrome / Android) or Microsoft Natural (Edge / Windows) or Apple Linh (iOS / macOS)
  const premiumVi = allVoices.find(v => {
    const name = v.name.toLowerCase();
    const lang = (v.lang || "").toLowerCase().replace("_", "-");
    const isViLang = lang === "vi-vn" || lang === "vi" || lang.startsWith("vi-") || lang.startsWith("vi_");
    const isViName = name.includes("vietnam") || name.includes("tiếng việt") || name.includes("linh") || name.includes("hoaimy") || name.includes("namminh") || name.includes("an");
    return (isViLang || isViName) && (name.includes("google") || name.includes("natural") || name.includes("enhanced") || name.includes("linh") || name.includes("hoaimy") || name.includes("namminh"));
  });
  if (premiumVi) return premiumVi;

  // 2. Any voice with explicit Vietnamese language tag
  const viLangVoice = allVoices.find(v => {
    const lang = (v.lang || "").toLowerCase().replace("_", "-");
    return lang === "vi-vn" || lang === "vi_vn" || lang === "vi" || lang.startsWith("vi-") || lang.startsWith("vi_");
  });
  if (viLangVoice) return viLangVoice;

  // 3. Any voice containing "tiếng việt" or "vietnamese" in name
  const viNameVoice = allVoices.find(v => {
    const name = v.name.toLowerCase();
    return name.includes("tiếng việt") || name.includes("vietnam");
  });
  if (viNameVoice) return viNameVoice;

  return null;
};

/**
 * Fetch authentic Vietnamese audio URL from Google Neural TTS via soundoftext API
 */
export const fetchVietnameseAudioUrl = async (text: string): Promise<string | null> => {
  const clean = text.trim();
  if (!clean) return null;

  const cacheKey = clean.toLowerCase();
  if (memoryAudioCache.has(cacheKey)) {
    return memoryAudioCache.get(cacheKey)!;
  }

  try {
    const createRes = await fetch("https://api.soundoftext.com/sounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engine: "Google",
        data: {
          text: clean,
          voice: "vi-VN"
        }
      })
    });

    if (!createRes.ok) return null;
    const createData = await createRes.json();
    if (!createData.success || !createData.id) return null;

    const id = createData.id;

    // Poll once or twice (usually ready in <150ms)
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 200));
      const statusRes = await fetch(`https://api.soundoftext.com/sounds/${id}`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.status === "Done" && statusData.location) {
          const audioUrl = statusData.location;
          memoryAudioCache.set(cacheKey, audioUrl);
          persistCache();
          return audioUrl;
        }
      }
    }
  } catch (err) {
    console.warn("Could not fetch Vietnamese audio URL from soundoftext:", err);
  }

  return null;
};

/**
 * Prefetch Vietnamese audio for a list of words or phrases to make playback instant
 */
export const prefetchVietnameseAudio = (texts: string[]) => {
  const unique = Array.from(new Set(texts.map(t => t.trim()).filter(Boolean)));
  // Process in small batches with slight staggering
  unique.forEach((text, idx) => {
    const cacheKey = text.toLowerCase();
    if (!memoryAudioCache.has(cacheKey)) {
      setTimeout(() => {
        fetchVietnameseAudioUrl(text).catch(() => {});
      }, idx * 150);
    }
  });
};

// Global active audio tracker
let activeViAudio: HTMLAudioElement | null = null;

export const stopActiveVietnameseSpeech = () => {
  if (activeViAudio) {
    activeViAudio.pause();
    activeViAudio.currentTime = 0;
    activeViAudio = null;
  }
};

/**
 * Speak Vietnamese text with 100% native Vietnamese voice.
 * Strategy:
 * 1. If audio URL is cached or fetchable: play native Studio MP3 audio.
 * 2. If network fails OR device has genuine Vietnamese voice: use device's Vietnamese voice.
 * 3. CRITICAL: If device has NO Vietnamese voice, NEVER use default English voice!
 */
export const playVietnameseSpeech = async (
  vietnameseText: string,
  isSlow: boolean = false,
  onEnded?: () => void
): Promise<void> => {
  const clean = vietnameseText.trim();
  if (!clean) {
    if (onEnded) onEnded();
    return;
  }

  stopActiveVietnameseSpeech();

  // Try authentic Studio audio first
  const audioUrl = await fetchVietnameseAudioUrl(clean);
  if (audioUrl) {
    const audio = new Audio(audioUrl);
    audio.playbackRate = isSlow ? 0.75 : 0.95;
    activeViAudio = audio;

    audio.onended = () => {
      activeViAudio = null;
      if (onEnded) onEnded();
    };

    audio.onerror = () => {
      activeViAudio = null;
      fallbackToDeviceVoice(clean, isSlow, onEnded);
    };

    try {
      await audio.play();
      return;
    } catch {
      // Autoplay or playback failure, fallback
      activeViAudio = null;
    }
  }

  // Fallback to genuine native device voice
  fallbackToDeviceVoice(clean, isSlow, onEnded);
};

const fallbackToDeviceVoice = (
  cleanText: string,
  isSlow: boolean,
  onEnded?: () => void
) => {
  if (!("speechSynthesis" in window)) {
    if (onEnded) onEnded();
    return;
  }

  const nativeVoice = getNativeDeviceVietnameseVoice();

  // CRITICAL ANTI-LỚ LỚ RULE:
  // If no native Vietnamese voice is installed on this device,
  // DO NOT allow the browser to use its default English voice to read Vietnamese!
  if (!nativeVoice) {
    console.warn(
      "No native Vietnamese voice found on device speech synthesis. Skipped English fallback to prevent accented speech."
    );
    if (onEnded) onEnded();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.voice = nativeVoice;
  utterance.lang = nativeVoice.lang || "vi-VN";
  utterance.rate = isSlow ? 0.7 : 0.9;
  utterance.pitch = 1.0;

  utterance.onend = () => {
    if (onEnded) onEnded();
  };
  utterance.onerror = () => {
    if (onEnded) onEnded();
  };

  window.speechSynthesis.speak(utterance);
};
