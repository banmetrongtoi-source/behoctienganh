/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Star, 
  Shield, 
  Plus, 
  ArrowLeft, 
  Trash2, 
  Save, 
  Volume2, 
  Play, 
  X, 
  Mic, 
  Trophy, 
  Home, 
  BookOpen, 
  ChevronRight,
  ChevronLeft,
  Edit2,
  Loader2,
  Info,
  Settings,
  Turtle,
  Video,
  Film,
  Upload,
  User as UserIcon,
  Check,
  Sparkles
} from "lucide-react";
import confetti from "canvas-confetti";
import { GoogleGenAI } from "@google/genai";
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc, 
  serverTimestamp, 
  query, 
  orderBy 
} from "firebase/firestore";
import { 
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged, 
  User,
  signOut
} from "firebase/auth";
import { getDocFromServer } from "firebase/firestore";
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL 
} from "firebase/storage";
import { db, auth, storage } from "./firebase";
import { Lesson, Word, Screen } from "./types";
import { getMeaningForWord } from "./dictionary";

// --- HELPERS ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return new Error(error instanceof Error ? error.message : "Lỗi phân quyền hoặc kết nối database");
};

const getAIFeedback = async (target: string, recognized: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `So sánh phát âm từ tiếng Anh "${target}" với kết quả nhận diện được là "${recognized}". 
      Hãy đưa ra lời khuyên cực kỳ ngắn gọn (dưới 12 từ) bằng tiếng Việt cho trẻ em để sửa lỗi phát âm này và nhắc bé đọc lại. 
      Ví dụ: "Bé gần đúng rồi, chú ý âm 's' ở cuối và đọc lại nhé!" hoặc "Bé đọc rõ âm 'l' hơn rồi thử lại nha".`,
    });
    return response.text || "Bé đọc lại lần nữa nhé! 💪";
  } catch (e) {
    console.error("AI Feedback Error:", e);
    return "Bé đọc lại lần nữa nhé! 💪";
  }
};

const getSimilarityPercent = (s1: string, s2: string) => {
  if (s1 === s2) return 100;
  if (s1.length === 0 || s2.length === 0) return 0;
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const costs = new Array();
  for (let i = 0; i <= longer.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i == 0) costs[j] = j;
      else {
        if (j > 0) {
          let newValue = costs[j - 1];
          if (longer.charAt(i - 1) != shorter.charAt(j - 1))
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }
  return ((longer.length - costs[shorter.length]) / longer.length) * 100;
};

const getLessonIcon = (title: string, index: number) => {
  const lowerTitle = title.toLowerCase();
  
  if (lowerTitle.includes("màu") || lowerTitle.includes("color")) {
    const colorEmojis = ["🎨", "🌈", "🖍️", "🖌️", "✨"];
    return colorEmojis[index % colorEmojis.length];
  }
  
  if (lowerTitle.includes("xe") || lowerTitle.includes("phương tiện") || lowerTitle.includes("transport")) {
    const vehicleEmojis = ["🚗", "🚌", "✈️", "🚢", "🚁", "🚲"];
    return vehicleEmojis[index % vehicleEmojis.length];
  }
  
  if (lowerTitle.includes("động vật") || lowerTitle.includes("animal") || lowerTitle.includes("thú")) {
    const animalEmojis = ["🐶", "🦁", "🐘", "🦒", "🦖", "🐧"];
    return animalEmojis[index % animalEmojis.length];
  }

  if (lowerTitle.includes("trái cây") || lowerTitle.includes("quả") || lowerTitle.includes("fruit")) {
    const fruitEmojis = ["🍎", "🍌", "🍇", "🍓", "🍉", "🍍"];
    return fruitEmojis[index % fruitEmojis.length];
  }

  if (lowerTitle.includes("số") || lowerTitle.includes("number")) {
    return "🔢";
  }

  // Default icons
  const defaultEmojis = ["🐱", "🦖", "🐻", "🐰", "🦊", "🐼"];
  return defaultEmojis[index % defaultEmojis.length];
};

const getDynamicFontSize = (text: string, isGame: boolean = false) => {
  const len = text.length;
  if (isGame) {
    if (len > 25) return "text-2xl";
    if (len > 15) return "text-3xl";
    if (len > 10) return "text-4xl";
    return "text-5xl";
  } else {
    if (len > 15) return "text-xs";
    return "text-sm";
  }
};

const getDynamicFontSizeForCard = (text: string) => {
  const len = text.length;
  if (len > 25) return "text-[10px]";
  if (len > 20) return "text-[12px]";
  if (len > 15) return "text-sm";
  return "text-lg";
};

const getYouTubeEmbedUrl = (url: string) => {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) {
    return `https://www.youtube.com/embed/${match[2]}`;
  }
  return null;
};

const parseImportText = (text: string): Word[] => {
  const lines = text.split("\n").map(l => l.trim());
  const parsed: Word[] = [];
  let currentWord: Word | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      currentWord = null;
      continue;
    }

    const isImageUrl = line.startsWith("http://") || line.startsWith("https://") || line.startsWith("data:image/");
    const isPhonetic = line.startsWith("/") || line.startsWith("[");

    if (isImageUrl) {
      if (currentWord) currentWord.image = line;
    } else if (isPhonetic) {
      if (currentWord) currentWord.phonetic = line;
    } else {
      if (!currentWord) {
        currentWord = {
          word: line,
          meaning: getMeaningForWord(line),
          image: `https://ui-avatars.com/api/?name=${encodeURIComponent(line)}&background=random&color=fff&size=400&font-size=0.3&bold=true`
        };
        parsed.push(currentWord);
      } else if (!currentWord.meaning) {
        currentWord.meaning = line;
      } else {
        currentWord = {
          word: line,
          meaning: getMeaningForWord(line),
          image: `https://ui-avatars.com/api/?name=${encodeURIComponent(line)}&background=random&color=fff&size=400&font-size=0.3&bold=true`
        };
        parsed.push(currentWord);
      }
    }
  }
  return parsed;
};

const PlayfulBackground = () => (
  <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 bg-[#00B1FF]">
    {/* Sky Gradient */}
    <div className="absolute inset-0 bg-gradient-to-b from-sky-400 to-sky-200" />
    
    {/* Clouds with random positions and varying speeds */}
    <div className="cloud top-[10%] left-0 w-32 h-12" style={{ animationDelay: '0s', animationDuration: '45s' }} />
    <div className="cloud top-[25%] left-0 w-48 h-16" style={{ animationDelay: '-10s', animationDuration: '65s' }} />
    <div className="cloud top-[15%] left-0 w-40 h-14" style={{ animationDelay: '-30s', animationDuration: '55s' }} />
    <div className="cloud top-[35%] left-0 w-60 h-20" style={{ animationDelay: '-15s', animationDuration: '80s' }} />
    
    {/* Birds flying across the sky - More variety and quantity */}
    <div className="absolute top-[10%] left-0 text-2xl animate-bird" style={{ animationDelay: '0s', animationDuration: '18s' }}>🦅</div>
    <div className="absolute top-[20%] left-0 text-xl animate-bird-reverse" style={{ animationDelay: '5s', animationDuration: '22s' }}>🕊️</div>
    <div className="absolute top-[8%] left-0 text-lg animate-bird" style={{ animationDelay: '12s', animationDuration: '15s' }}>🦅</div>
    <div className="absolute top-[15%] left-0 text-xl animate-bird-reverse" style={{ animationDelay: '2s', animationDuration: '25s' }}>🕊️</div>
    <div className="absolute top-[25%] left-0 text-2xl animate-bird" style={{ animationDelay: '8s', animationDuration: '20s' }}>🦅</div>
    <div className="absolute top-[5%] left-0 text-lg animate-bird-reverse" style={{ animationDelay: '15s', animationDuration: '30s' }}>🕊️</div>
    <div className="absolute top-[12%] left-0 text-xl animate-bird" style={{ animationDelay: '4s', animationDuration: '12s' }}>🦅</div>
    
    {/* Sea at bottom */}
    <div className="absolute bottom-0 left-0 right-0 h-[25vh] bg-[#0081C9] z-10">
      <div className="absolute top-0 left-0 right-0 h-4 bg-white/20" />
      <div className="absolute top-8 left-0 right-0 h-4 bg-white/10" />
      
      {/* Ships sailing back and forth - Fixed direction and 3x larger size */}
      <div className="absolute bottom-[10%] left-0 text-[150px] animate-sailing drop-shadow-2xl" style={{ animationDuration: '40s' }}>🚢</div>
      <div className="absolute bottom-[35%] left-0 text-[100px] animate-sailing drop-shadow-xl" style={{ animationDuration: '60s', animationDelay: '-20s' }}>⛵</div>
    </div>
    
    {/* Distant Island */}
    <div className="absolute bottom-[18vh] right-[10%] w-48 h-24 bg-emerald-500 rounded-t-full shadow-lg z-0" />
  </div>
);

// --- COMPONENTS ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [screen, setScreen] = useState<Screen>("setup");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [isAdmin, setIsAdmin] = useState(() => {
    return localStorage.getItem("isAdmin") === "true";
  });
  const [showPassModal, setShowPassModal] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [micStatus, setMicStatus] = useState("Bấm mic để đọc");
  const [feedback, setFeedback] = useState<{ text: string; type: "success" | "warning" | "info" | "error" } | null>(null);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonData, setLessonData] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [modal, setModal] = useState<{ title: string; message: string; type: "success" | "warning" | "info" | "error"; onConfirm?: () => void } | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>(() => localStorage.getItem("selectedVoiceURI") || "");
  const [voiceEngine, setVoiceEngine] = useState<"studio-us" | "studio-uk" | "device">(() => {
    return (localStorage.getItem("voiceEngine") as any) || "studio-us";
  });
  const [autoReadVietnamese, setAutoReadVietnamese] = useState<boolean>(() => {
    const saved = localStorage.getItem("autoReadVietnamese");
    return saved !== null ? saved === "true" : true;
  });
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [isChallengeMode, setIsChallengeMode] = useState(false);
  const [challengeWords, setChallengeWords] = useState<Word[]>([]);
  const [quizOptions, setQuizOptions] = useState<Word[]>([]);

  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const viTimeoutRef = useRef<any>(null);

  useEffect(() => {
    localStorage.setItem("autoReadVietnamese", String(autoReadVietnamese));
  }, [autoReadVietnamese]);

  const clearActiveSpeech = () => {
    if (viTimeoutRef.current) {
      clearTimeout(viTimeoutRef.current);
      viTimeoutRef.current = null;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  const speakVietnamese = (vietnameseText: string, isSlow: boolean = false) => {
    if (!vietnameseText) return;
    const cleanVi = vietnameseText.trim();
    if (!cleanVi) return;

    const viTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=${encodeURIComponent(cleanVi)}`;
    const viAudio = new Audio(viTtsUrl);
    viAudio.playbackRate = isSlow ? 0.75 : 0.95;
    currentAudioRef.current = viAudio;

    const playPromise = viAudio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn("Studio Vietnamese TTS interrupted, falling back to speech synthesis:", err);
        if ("speechSynthesis" in window) {
          const utterVi = new SpeechSynthesisUtterance(cleanVi);
          utterVi.lang = "vi-VN";
          const allVoices = window.speechSynthesis.getVoices();
          const viVoice = allVoices.find(v => v.lang.startsWith("vi") || v.lang.includes("vi_VN"));
          if (viVoice) utterVi.voice = viVoice;
          utterVi.rate = isSlow ? 0.65 : 0.85;
          utterVi.pitch = 1.0;
          window.speechSynthesis.speak(utterVi);
        }
      });
    }
  };

  const updateVoices = () => {
    if (!("speechSynthesis" in window)) return;
    const allVoices = window.speechSynthesis.getVoices();
    if (allVoices.length === 0) return;

    const enVoices = allVoices.filter(v => v.lang.startsWith("en-") || v.lang.startsWith("en_"));
    setVoices(enVoices);
    
    // Auto-select best voice if none selected
    const bestVoice = allVoices.find(v => (v.name.includes("Enhanced") || v.name.includes("Natural") || v.name.includes("Siri") || v.name === "Google US English") && (v.lang.startsWith("en-") || v.lang.startsWith("en_")));
    const currentVoiceValid = allVoices.some(v => v.voiceURI === selectedVoiceURI);

    if (bestVoice && (!selectedVoiceURI || !currentVoiceValid)) {
      setSelectedVoiceURI(bestVoice.voiceURI);
    } else if (!selectedVoiceURI && enVoices.length > 0) {
      const defaultVoice = enVoices.find(v => v.lang === "en-US") || enVoices[0];
      setSelectedVoiceURI(defaultVoice.voiceURI);
    }
  };

  const fallbackSpeech = (text: string, isSlow: boolean = false, viMeaning?: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const allVoices = window.speechSynthesis.getVoices();
    
    let voice = allVoices.find(v => v.voiceURI === selectedVoiceURI);
    if (!voice) {
      voice = allVoices.find(v => (v.name.includes("Enhanced") || v.name.includes("Natural") || v.name.includes("Siri")) && (v.lang.startsWith("en-") || v.lang.startsWith("en_")));
    }
    if (!voice) {
      voice = allVoices.find(v => v.name === "Google US English");
    }
    if (!voice) {
      voice = allVoices.find(v => v.lang === "en-US");
    }
    if (!voice) {
      voice = allVoices.find(v => v.lang.startsWith("en-") || v.lang.startsWith("en_"));
    }
    
    if (voice) {
      utterance.voice = voice;
    }

    utterance.lang = "en-US";
    utterance.rate = isSlow ? 0.6 : 0.85;
    // CRITICAL: Pitch must remain 1.0. On iOS WebKit, non-1.0 pitch causes extreme robotic crackling/buzzing (rè rè).
    utterance.pitch = 1.0;

    if (autoReadVietnamese && viMeaning) {
      utterance.onend = () => {
        viTimeoutRef.current = setTimeout(() => {
          speakVietnamese(viMeaning, isSlow);
        }, 350);
      };
    }

    window.speechSynthesis.speak(utterance);
  };

  const speakText = (text: string, isSlow: boolean = false, meaning?: string) => {
    if (!text) return;
    const cleanText = text.trim();
    const viMeaning = meaning || getMeaningForWord(cleanText);

    clearActiveSpeech();

    // High-quality Studio Audio Engine (100% crystal-clear on iOS, Android, PC, Mac)
    if (voiceEngine === "studio-us" || voiceEngine === "studio-uk") {
      const lang = voiceEngine === "studio-uk" ? "en-GB" : "en-US";
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(cleanText)}`;
      
      const audio = new Audio(ttsUrl);
      audio.playbackRate = isSlow ? 0.65 : 1.0;
      currentAudioRef.current = audio;

      audio.onended = () => {
        if (autoReadVietnamese && viMeaning) {
          viTimeoutRef.current = setTimeout(() => {
            speakVietnamese(viMeaning, isSlow);
          }, 350);
        }
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn("Studio audio stream playback interrupted, falling back to clean speechSynthesis:", err);
          fallbackSpeech(cleanText, isSlow, viMeaning);
        });
      }
    } else {
      fallbackSpeech(cleanText, isSlow, viMeaning);
    }
  };

  const speakWord = (wordObj: Word | { word: string; meaning?: string }, isSlow: boolean = false) => {
    if (!wordObj) return;
    const viMeaning = wordObj.meaning || getMeaningForWord(wordObj.word);
    speakText(wordObj.word, isSlow, viMeaning);
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login Error:", error);
      showModal("Lỗi đăng nhập", "Không thể đăng nhập bằng Google. Vui lòng thử lại.", "error");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setIsAdmin(false);
      localStorage.setItem("isAdmin", "false");
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  useEffect(() => {
    updateVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  useEffect(() => {
    if (selectedVoiceURI) {
      localStorage.setItem("selectedVoiceURI", selectedVoiceURI);
    }
  }, [selectedVoiceURI]);

  useEffect(() => {
    localStorage.setItem("voiceEngine", voiceEngine);
  }, [voiceEngine]);

  useEffect(() => {
    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'lessons', 'connection-test'));
      } catch (error: any) {
        if (error.message?.includes('the client is offline')) {
          console.error("Firebase connection error: Client is offline. Check config.");
        }
      }
    };
    testConnection();

    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    const lessonsRef = collection(db, "lessons");
    const q = query(lessonsRef, orderBy("createdAt", "desc"));
    const unsubscribeLessons = onSnapshot(q, (snapshot) => {
      const fetchedLessons: Lesson[] = [];
      snapshot.forEach(doc => {
        fetchedLessons.push({ id: doc.id, ...doc.data() } as Lesson);
      });
      setLessons(fetchedLessons);
      setLoading(false);
    }, (error) => {
      console.error("Firestore Listen Error:", error);
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeLessons();
    };
  }, []);

  const handleAdminToggle = () => {
    if (isAdmin) {
      setIsAdmin(false);
      localStorage.setItem("isAdmin", "false");
      showModal("Thông báo", "Đã thoát chế độ chỉnh sửa.", "info");
    } else {
      setPassInput("");
      setShowPassModal(true);
    }
  };

  const handleVerifyPass = () => {
    if (passInput === "091132") {
      setIsAdmin(true);
      localStorage.setItem("isAdmin", "true");
      setShowPassModal(false);
      showModal("Thành công", "Chào mừng Admin! Bạn có thể thêm/sửa/xóa bài học.", "success");
    } else {
      showModal("Lỗi", "Mật khẩu không đúng!", "error");
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) {
      showModal("Yêu cầu đăng nhập", "Vui lòng đăng nhập để tải video lên!", "warning", handleLogin);
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    // Tăng giới hạn lên 500MB cho video lớn
    const MAX_SIZE = 500 * 1024 * 1024; 
    if (file.size > MAX_SIZE) {
      showModal("Lỗi", "Video quá lớn! Vui lòng chọn video dưới 500MB.", "error");
      return;
    }

    setIsUploadingVideo(true);
    setUploadProgress(0);

    try {
      const storageRef = ref(storage, `videos/${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        "state_changed",
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(Math.round(progress));
        },
        (error) => {
          console.error("Upload Error:", error);
          showModal("Lỗi", "Không thể tải video lên. Vui lòng thử lại.", "error");
          setIsUploadingVideo(false);
        },
        async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          setVideoUrl(url);
          setIsUploadingVideo(false);
          showModal("Thành công", "Đã tải video lên thành công!", "success");
        }
      );
    } catch (error) {
      console.error("Upload Error:", error);
      showModal("Lỗi", "Có lỗi xảy ra khi bắt đầu tải lên.", "error");
      setIsUploadingVideo(false);
    }
  };

  const handleSaveLesson = async () => {
    if (!user) {
      return showModal("Yêu cầu đăng nhập", "Vui lòng đăng nhập để thực hiện thao tác này!", "warning", handleLogin);
    }

    if (!lessonTitle.trim()) return showModal("Thiếu thông tin", "Vui lòng nhập tên bài học!", "warning");
    const words = parseImportText(lessonData);
    if (words.length === 0) return showModal("Lỗi định dạng", "Vui lòng nhập từ vựng theo đúng định dạng!", "error");

    setLoading(true);
    const path = "lessons";
    try {
      if (editingLessonId) {
        const docRef = doc(db, path, editingLessonId);
        await updateDoc(docRef, {
          title: lessonTitle,
          words: words,
          videoUrl: videoUrl,
          updatedAt: serverTimestamp()
        });
        showModal("Thành công!", "Đã cập nhật bài học thành công 🎉", "success", () => {
          setScreen("setup");
          setEditingLessonId(null);
          setVideoUrl("");
        });
      } else {
        await addDoc(collection(db, path), {
          title: lessonTitle,
          words: words,
          videoUrl: videoUrl,
          creatorId: user?.uid || "anonymous",
          createdAt: serverTimestamp()
        });
        showModal("Thành công!", "Đã tạo bài học mới thành công 🎉", "success", () => {
          setScreen("setup");
          setEditingLessonId(null);
          setVideoUrl("");
        });
      }
    } catch (error: any) {
      console.error("Save Error:", error);
      const enhancedError = handleFirestoreError(error, editingLessonId ? OperationType.UPDATE : OperationType.CREATE, path);
      showModal("Lỗi lưu bài học", enhancedError.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLesson = async (id?: string) => {
    const targetId = id || editingLessonId;
    if (!targetId) return;
    
    showModal("Xác nhận Xóa", "Bạn có chắc chắn muốn xóa bài học này?", "warning", async () => {
      setLoading(true);
      const path = "lessons";
      try {
        await deleteDoc(doc(db, path, targetId));
        showModal("Đã xóa", "Bài học đã được xóa thành công!", "success", () => {
          setScreen("setup");
          setEditingLessonId(null);
        });
      } catch (error: any) {
        const enhancedError = handleFirestoreError(error, OperationType.DELETE, path);
        showModal("Lỗi", enhancedError.message, "error");
      } finally {
        setLoading(false);
      }
    });
  };

  const showModal = (title: string, message: string, type: "success" | "warning" | "info" | "error", onConfirm?: () => void) => {
    setModal({ title, message, type, onConfirm });
  };

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showModal("Lỗi", "Thiết bị không hỗ trợ nhận diện giọng nói.", "error");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onstart = () => {
      setIsListening(true);
      setMicStatus("Đang nghe bé đọc...");
    };
    recognition.onresult = (event: any) => {
      const result = event.results[0][0].transcript;
      checkPronunciation(result);
    };
    recognition.onerror = (event: any) => {
      setIsListening(false);
      setMicStatus("Không nghe rõ, thử lại nhé");
      console.error("Speech Error", event.error);
    };
    recognition.onend = () => setIsListening(false);
    
    recognitionRef.current = recognition;
    recognition.start();
  };

  const checkPronunciation = async (recognized: string) => {
    const list = isChallengeMode ? challengeWords : currentLesson?.words;
    if (!list || list.length === 0) return;
    
    const targetObj = list[currentWordIndex];
    const target = targetObj.word;
    const cleanTarget = target.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanRecognized = recognized.toLowerCase().replace(/[^a-z0-9]/g, "");
    const sim = getSimilarityPercent(cleanTarget, cleanRecognized);

    if (sim >= 85 || cleanRecognized.includes(cleanTarget)) {
      setScore(s => s + 1);
      setFeedback({ text: "Giỏi quá! 🎉", type: "success" });
      setMicStatus(`Bé nói: "${recognized}"`);
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      setTimeout(() => {
        if (currentWordIndex + 1 >= list.length) {
          setScreen("victory");
        } else {
          setCurrentWordIndex(i => i + 1);
          setFeedback(null);
          setMicStatus("Bấm mic để đọc");
        }
      }, 1500);
    } else {
      setMicStatus("Đang phân tích lỗi...");
      const aiTip = await getAIFeedback(target, recognized);
      setFeedback({ text: aiTip, type: "warning" });
      setMicStatus(`Bé nói: "${recognized}"`);
      speakWord(targetObj);
      // Giữ feedback lâu hơn để bé đọc kịp
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  const startGame = (lesson: Lesson) => {
    setIsChallengeMode(false);
    // Sort words by length for increasing difficulty
    const sortedWords = [...lesson.words].sort((a, b) => a.word.length - b.word.length);
    setCurrentLesson({ ...lesson, words: sortedWords });
    setCurrentWordIndex(0);
    setScore(0);
    setScreen("game");
    if (sortedWords.length > 0) {
      setTimeout(() => speakWord(sortedWords[0]), 500);
    }
  };

  const startQuiz = (lesson: Lesson) => {
    setIsChallengeMode(false);
    // Sort words by length for increasing difficulty
    const sortedWords = [...lesson.words].sort((a, b) => a.word.length - b.word.length);
    const updatedLesson = { ...lesson, words: sortedWords };
    setCurrentLesson(updatedLesson);
    setCurrentWordIndex(0);
    setScore(0);
    setScreen("quiz");
    generateQuizOptions(0, updatedLesson);
  };

  const generateQuizOptions = (wordIndex: number, lesson: Lesson) => {
    const target = lesson.words[wordIndex];
    let pool = [...lesson.words];
    
    // Add words from other lessons if current is too small for 4 options
    if (pool.length < 4) {
      lessons.forEach(l => {
        if (l.id !== lesson.id) pool.push(...l.words);
      });
    }

    const uniquePool = Array.from(new Map(pool.map(w => [w.word.toLowerCase(), w])).values());
    let distractors = uniquePool.filter(w => w.word.toLowerCase() !== target.word.toLowerCase());
    distractors = distractors.sort(() => 0.5 - Math.random()).slice(0, 3);
    
    const options = [target, ...distractors].sort(() => 0.5 - Math.random());
    setQuizOptions(options);
    setTimeout(() => speakWord(target), 500);
  };

  const handleSelectQuizOption = (word: Word) => {
    if (!currentLesson) return;
    const target = currentLesson.words[currentWordIndex];
    
    if (word.word.toLowerCase() === target.word.toLowerCase()) {
      setScore(s => s + 1);
      setFeedback({ text: "Chính xác! Bé giỏi quá! 🌟", type: "success" });
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      
      setTimeout(() => {
        if (currentWordIndex + 1 >= currentLesson.words.length) {
          setScreen("victory");
        } else {
          const nextIndex = currentWordIndex + 1;
          setCurrentWordIndex(nextIndex);
          setFeedback(null);
          generateQuizOptions(nextIndex, currentLesson);
        }
      }, 1500);
    } else {
      setFeedback({ text: "Ồ! Chưa đúng rồi, thử lại nhé!", type: "warning" });
      speakWord(target);
      setTimeout(() => setFeedback(null), 2000);
    }
  };

  // --- RENDER SCREENS ---

  const renderSetup = () => (
    <div className="flex flex-col p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
      <div className="flex justify-between items-center mb-6">
        <div className="flex flex-col">
          <h2 className="text-2xl sm:text-3xl font-fredoka font-bold text-indigo-700">Chọn bài học</h2>
          <button 
            onClick={() => setShowVoiceSettings(true)}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-indigo-700 transition-colors mt-0.5 group"
          >
            <Settings className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-500" />
            <span>Cài đặt giọng đọc cho bé</span>
          </button>
        </div>
        {isAdmin && (
          <button 
            onClick={() => { 
              setEditingLessonId(null); 
              setLessonTitle(""); 
              setLessonData(""); 
              setVideoUrl("");
              setScreen("create"); 
            }}
            className="bg-emerald-500 text-white px-4 py-2.5 rounded-xl font-bold hover:bg-emerald-600 transition-all shadow-md active:scale-95 flex items-center gap-1"
          >
            <Plus className="w-5 h-5" /> Tạo mới bài học
          </button>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 sm:p-4 mb-6 flex items-start gap-3 shadow-xs">
        <div className="bg-amber-100 p-2 rounded-xl text-amber-600 flex-shrink-0">
          <Sparkles className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <p className="text-xs sm:text-sm font-bold text-amber-900 mb-0.5">Giọng đọc chuẩn Studio & Tự động dịch nghĩa Tiếng Việt:</p>
          <p className="text-xs text-amber-800 leading-relaxed">
            Hệ thống đã đồng bộ phát âm chuẩn bản ngữ (khử rè 100% trên iOS) và <span className="font-bold text-emerald-700">tự động đọc nghĩa tiếng Việt ngay sau từ tiếng Anh</span> cho bé chưa biết chữ dễ dàng hiểu nghĩa. Ba mẹ có thể bấm <span className="font-bold">"Cài đặt giọng đọc cho bé"</span> để điều chỉnh nhé!
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6 pb-12">
        {lessons.length === 0 ? (
          <div className="col-span-2 text-center p-12 bg-white/50 backdrop-blur-sm rounded-[3rem] border-4 border-dashed border-sky-200">
            <BookOpen className="w-16 h-16 text-sky-300 mx-auto mb-3" />
            <p className="text-sky-600 font-bold uppercase tracking-widest text-sm">Bé chưa có bài học nào!</p>
          </div>
        ) : (
          lessons.map((lesson, idx) => {
            const colors = [
              "bg-aloyellow border-aloyellow", 
              "bg-alopurple border-alopurple", 
              "bg-aloorange border-aloorange", 
              "bg-emerald-500 border-emerald-500"
            ];
            const themeColor = colors[idx % colors.length];
            
            return (
              <motion.div 
                key={lesson.id}
                whileHover={{ scale: 1.05, y: -5 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => { setCurrentLesson(lesson); setScreen("preview"); }}
                className={`aspect-[4/5] rounded-[2rem] sm:rounded-[2.5rem] border-4 sm:border-8 border-white shadow-2xl overflow-hidden relative group cursor-pointer ${themeColor}`}
              >
                <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="h-full flex flex-col items-center justify-center p-2 pb-4 sm:p-4 sm:pb-6">
                  <div className="relative mb-2">
                    <div className="absolute inset-0 bg-black/10 rounded-full blur-xl scale-125" />
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white rounded-full flex items-center justify-center text-4xl sm:text-5xl shadow-lg relative z-10 group-hover:rotate-12 transition-transform">
                      {getLessonIcon(lesson.title, idx)}
                    </div>
                  </div>
                  <div className="bg-white/95 backdrop-blur-sm px-2 py-1 rounded-full shadow-md mb-2 min-w-[80%] flex justify-center">
                    <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none whitespace-nowrap">{lesson.words.length} TỪ VỰNG</span>
                  </div>
                  <div className="flex-1 flex items-center justify-center w-full">
                    <h3 className={`${getDynamicFontSizeForCard(lesson.title)} font-arial font-bold text-white text-center leading-tight uppercase tracking-tight drop-shadow-md px-1 w-full break-words`}>
                      {lesson.title}
                    </h3>
                  </div>
                </div>
                
                {isAdmin && (
                  <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setEditingLessonId(lesson.id!); 
                        setLessonTitle(lesson.title); 
                        setLessonData(lesson.words.map(w => `${w.word}${w.phonetic ? `\n${w.phonetic}` : ""}${w.meaning ? `\n${w.meaning}` : ""}\n${w.image}`).join("\n\n"));
                        setVideoUrl(lesson.videoUrl || "");
                        setScreen("create"); 
                      }}
                      className="p-1.5 rounded-lg bg-white/20 backdrop-blur-md text-white hover:bg-white hover:text-indigo-600 transition-all"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        handleDeleteLesson(lesson.id);
                      }}
                      className="p-1.5 rounded-lg bg-white/20 backdrop-blur-md text-white hover:bg-red-500 hover:text-white transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );

  const renderCreate = () => (
    <div className="flex flex-col p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full h-full pb-12">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setScreen("setup")} className="text-slate-500 hover:text-indigo-600 transition-colors">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h2 className="text-2xl font-fredoka font-bold text-indigo-600">{editingLessonId ? "Sửa bài học" : "Tạo bài học mới"}</h2>
        </div>
        {editingLessonId && (
          <button onClick={handleDeleteLesson} className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors">
            <Trash2 className="w-6 h-6" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 flex-1">
        <div>
          <label className="block font-bold text-slate-700 mb-1">Tên bài học</label>
          <input 
            type="text" 
            value={lessonTitle}
            onChange={(e) => setLessonTitle(e.target.value)}
            placeholder="VD: Động vật đáng yêu" 
            className="w-full border-2 border-indigo-100 rounded-xl p-3 focus:outline-none focus:border-indigo-600 transition-colors font-semibold"
          />
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1 flex items-center gap-2">
            <Video className="w-4 h-4 text-indigo-600" /> Video bài học (Tùy chọn)
          </label>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input 
                type="text" 
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="Dán link video hoặc tải lên bên dưới" 
                className="flex-1 border-2 border-indigo-100 rounded-xl p-3 focus:outline-none focus:border-indigo-600 transition-colors text-sm"
              />
              {videoUrl && (
                <button 
                  onClick={() => setVideoUrl("")}
                  className="p-3 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition-colors"
                  title="Xóa video"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </div>
            
            <div className="relative">
              <input 
                type="file" 
                accept="video/*"
                onChange={handleVideoUpload}
                className="hidden" 
                id="video-upload"
                disabled={isUploadingVideo}
              />
              <label 
                htmlFor="video-upload"
                className={`flex flex-col items-center justify-center gap-2 p-3 border-2 border-dashed border-indigo-200 rounded-xl cursor-pointer hover:bg-indigo-50 transition-all ${isUploadingVideo ? "opacity-100 cursor-not-allowed bg-indigo-50" : ""}`}
              >
                {isUploadingVideo ? (
                  <div className="w-full flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                      <span className="text-sm font-bold text-indigo-600">Đang tải lên: {uploadProgress}%</span>
                    </div>
                    <div className="w-full h-2 bg-indigo-100 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${uploadProgress}%` }}
                        className="h-full bg-indigo-600"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-indigo-600" />
                    <span className="text-sm font-bold text-indigo-600">Tải video từ máy tính</span>
                  </>
                )}
              </label>
            </div>
          </div>
        </div>
        
        <div className="flex-1 flex flex-col">
          <label className="block font-bold text-slate-700 mb-1">
            Nhập nhanh từ vựng <br />
            <span className="text-xs font-normal text-slate-500">(Dòng 1: Từ, Dòng 2: Phiên âm, Dòng 3: Nghĩa, Dòng 4: Link Ảnh)</span>
          </label>
          <textarea 
            value={lessonData}
            onChange={(e) => setLessonData(e.target.value)}
            className="w-full flex-1 border-2 border-indigo-100 rounded-xl p-3 focus:outline-none focus:border-indigo-600 transition-colors text-sm font-mono whitespace-pre min-h-[200px]" 
            placeholder="Apple&#10;/ˈæp.əl/&#10;Táo&#10;https://images.unsplash.com/photo-1560806887-1e4cd0b6faa6?w=200&#10;&#10;Banana&#10;/bəˈnɑː.nə/&#10;Chuối&#10;https://images.unsplash.com/photo-1571771894821-ad990241274d?w=200"
          />
        </div>

        <button 
          onClick={handleSaveLesson}
          className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition-all shadow-lg active:scale-95 mt-2"
        >
          <Save className="inline-block mr-2 w-5 h-5" /> {editingLessonId ? "Cập nhật bài học" : "Lưu bài học"}
        </button>
      </div>
    </div>
  );

  const renderPreview = () => (
    <div className="flex flex-col p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full h-full">
      <div className="flex justify-between items-center mb-6">
        <button onClick={() => setScreen("setup")} className="w-10 h-10 flex items-center justify-center bg-white/20 hover:bg-white/40 text-white rounded-xl transition-all shadow-md">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-2xl sm:text-3xl font-fredoka font-bold text-white uppercase drop-shadow-md truncate max-w-md text-center">{currentLesson?.title}</h2>
        <div className="w-10"></div>
      </div>
      
      {currentLesson?.videoUrl && (
        <div className="mb-6 max-w-2xl mx-auto w-full rounded-[2.5rem] overflow-hidden shadow-2xl border-4 sm:border-8 border-white bg-black aspect-video flex items-center justify-center relative">
          {getYouTubeEmbedUrl(currentLesson.videoUrl) ? (
            <iframe
              width="100%"
              height="100%"
              src={getYouTubeEmbedUrl(currentLesson.videoUrl)!}
              title="YouTube video player"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="w-full h-full"
            ></iframe>
          ) : (
            <video 
              src={currentLesson.videoUrl} 
              controls 
              className="w-full h-full"
              poster="https://images.unsplash.com/photo-1485846234645-a62644f84728?w=400&q=80"
            />
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6 p-1">
        {currentLesson?.words.map((item, idx) => {
          const meaning = item.meaning || getMeaningForWord(item.word);
          return (
            <div key={idx} className="card-bubble bg-white p-3 sm:p-5 flex flex-col items-center group active:scale-95 cursor-pointer border-white">
              <div 
                onClick={() => speakWord(item)}
                className="w-full aspect-square rounded-[2rem] overflow-hidden bg-sky-50 mb-3 border-2 border-sky-100 group-hover:border-aloblue transition-colors relative"
              >
                <img src={item.image} alt={item.word} className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
              </div>
              <h4 className={`font-bold font-fredoka text-aloblue capitalize w-full text-center break-words leading-tight tracking-tight drop-shadow-sm ${getDynamicFontSize(item.word)}`}>
                {item.word}
              </h4>
              {item.phonetic && <p className="text-[10px] text-slate-400 font-bold mb-1 opacity-70 italic">{item.phonetic}</p>}
              {meaning && (
                <p className="text-xs text-emerald-700 font-bold mb-3 text-center bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                  🇻🇳 {meaning}
                </p>
              )}
              
              <div className="mt-auto flex gap-2 w-full">
                <button 
                  onClick={() => speakWord(item)}
                  className="flex-1 bg-aloblue text-white py-2 rounded-2xl font-bold hover:bg-sky-600 transition-all shadow-md active:translate-y-1"
                  title="Đọc từ vựng và nghĩa tiếng Việt"
                >
                  <Volume2 className="w-5 h-5 mx-auto" />
                </button>
                <button 
                  onClick={() => speakWord(item, true)}
                  className="flex-1 bg-aloorange text-white py-2 rounded-2xl font-bold hover:bg-orange-600 transition-all shadow-md active:translate-y-1"
                  title="Đọc chậm"
                >
                  <Turtle className="w-5 h-5 mx-auto" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 max-w-md mx-auto w-full grid grid-cols-2 gap-4 pb-4">
        <button 
          onClick={() => currentLesson && startGame(currentLesson)}
          className="bg-emerald-500 btn-alo text-lg shadow-[0_6px_0_#059669]"
        >
          Luyện đọc
        </button>
        <button 
          onClick={() => currentLesson && startQuiz(currentLesson)}
          className="bg-aloorange btn-alo text-lg shadow-[0_6px_0_#C05600]"
        >
          Trò chơi
        </button>
      </div>
    </div>
  );

  const handleNextWord = () => {
    const list = isChallengeMode ? challengeWords : currentLesson?.words;
    if (!list) return;
    if (currentWordIndex < list.length - 1) {
      const nextIndex = currentWordIndex + 1;
      setCurrentWordIndex(nextIndex);
      setFeedback(null);
      setMicStatus("Nhấn mic để đọc");
      setTimeout(() => speakWord(list[nextIndex]), 300);
    } else {
      setScreen("victory");
    }
  };

  const handlePrevWord = () => {
    const list = isChallengeMode ? challengeWords : currentLesson?.words;
    if (!list) return;
    if (currentWordIndex > 0) {
      const prevIndex = currentWordIndex - 1;
      setCurrentWordIndex(prevIndex);
      setFeedback(null);
      setMicStatus("Nhấn mic để đọc");
      setTimeout(() => speakWord(list[prevIndex]), 300);
    }
  };

  const renderGame = () => {
    const list = isChallengeMode ? challengeWords : currentLesson?.words;
    if (!list) return null;
    const wordObj = list[currentWordIndex];
    const totalWords = list.length;
    const difficultyLevel = Math.floor(wordObj.word.length / 3) + 1;

    return (
      <div className="flex flex-col p-2 sm:p-6 max-w-6xl mx-auto w-full h-full relative">
        <div className="flex justify-between items-center mb-4 sm:mb-6 relative z-10 w-full">
          <button 
            onClick={() => showModal("Dừng chơi?", `Bé có muốn quay lại trang ${isChallengeMode ? 'chính' : 'bài học'} không?`, "warning", () => setScreen(isChallengeMode ? "setup" : "preview"))} 
            className="w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center bg-white/20 hover:bg-white/40 text-white rounded-2xl transition-all shadow-md active:scale-95"
            title="Đóng"
          >
            <X className="w-6 h-6 sm:w-7 sm:h-7" />
          </button>
          
          <div className="bg-white/95 backdrop-blur-md px-6 py-2 sm:py-2.5 rounded-full shadow-xl border-2 border-sky-100 flex items-center gap-3">
            <div className={`font-fredoka font-bold text-sm sm:text-base ${isChallengeMode ? "text-aloorange" : "text-aloblue"}`}>
               {isChallengeMode ? `THỬ THÁCH ${currentWordIndex + 1}/${totalWords}` : `TỪ ${currentWordIndex + 1}/${totalWords}`}
            </div>
            <div className="flex items-center gap-0.5">
               {[...Array(Math.min(5, difficultyLevel || 0))].map((_, i) => (
                 <Star key={i} className="w-4 h-4 fill-aloyellow text-aloyellow" />
               ))}
            </div>
          </div>
          <div className="w-11 sm:w-12"></div>
        </div>

        <div className={`flex-1 card-bubble bg-white p-4 sm:p-8 lg:p-12 flex flex-col items-center justify-center relative transition-all duration-300 border-white shadow-[0_30px_60px_-12px_rgba(0,0,0,0.25)] rounded-[2.5rem] sm:rounded-[3.5rem] w-full ${feedback?.type === "success" ? "ring-8 ring-emerald-400" : feedback?.type === "warning" ? "ring-8 ring-aloorange" : ""}`}>
          <AnimatePresence>
            {feedback && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute top-4 sm:top-6 left-0 w-full text-center z-20 px-4"
              >
                <div className={`inline-block px-8 py-3.5 rounded-2xl font-bold text-base sm:text-lg shadow-xl leading-tight ${feedback.type === "success" ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}`}>
                  {feedback.text}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="w-full flex-1 flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-14 z-10 my-auto py-2">
            {/* Big Word Image */}
            <div 
              onClick={() => speakWord(wordObj)}
              className="w-56 h-56 sm:w-72 sm:h-72 md:w-80 md:h-80 lg:w-[360px] lg:h-[360px] rounded-[2.5rem] sm:rounded-[3.5rem] overflow-hidden shadow-2xl bg-sky-50 flex items-center justify-center border-4 sm:border-8 border-sky-100 shrink-0 cursor-pointer group"
              title="Bấm để nghe đọc (Anh - Việt)"
            >
              <img src={wordObj.image} alt={wordObj.word} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            </div>

            {/* Word Content & Controls */}
            <div className="flex flex-col items-center lg:items-start text-center lg:text-left justify-center flex-1 max-w-xl">
              <h2 className={`font-fredoka font-bold text-slate-800 uppercase tracking-tight break-words leading-none drop-shadow-sm mb-2 text-4xl sm:text-5xl md:text-6xl ${getDynamicFontSize(wordObj.word, true)}`}>
                {wordObj.word}
              </h2>

              {wordObj.phonetic && (
                <p className="text-base sm:text-lg text-slate-400 font-bold mb-1 opacity-80 italic">{wordObj.phonetic}</p>
              )}
              {(() => {
                const meaning = wordObj.meaning || getMeaningForWord(wordObj.word);
                return meaning ? (
                  <div className="flex items-center gap-2 mb-4 bg-emerald-50 px-5 py-2 rounded-full border border-emerald-200 shadow-xs">
                    <span className="text-xl">🇻🇳</span>
                    <span className="text-base sm:text-xl text-emerald-800 font-bold">{meaning}</span>
                  </div>
                ) : null;
              })()}
              
              <div className="flex items-center gap-4 my-2 sm:my-3">
                <button 
                  onClick={() => speakWord(wordObj)}
                  className="bg-aloblue text-white px-6 py-3.5 sm:py-4 rounded-3xl transition-all shadow-lg active:translate-y-1 hover:scale-105 flex items-center gap-2.5 font-fredoka font-bold text-base sm:text-lg"
                  title="Nghe đọc tiếng Anh và tiếng Việt"
                >
                  <Volume2 className="w-7 h-7 sm:w-8 sm:h-8" />
                  <span>Nghe</span>
                </button>
                <button 
                  onClick={() => speakWord(wordObj, true)}
                  className="bg-aloorange text-white px-6 py-3.5 sm:py-4 rounded-3xl transition-all shadow-lg active:translate-y-1 hover:scale-105 flex items-center gap-2.5 font-fredoka font-bold text-base sm:text-lg"
                  title="Đọc chậm từng từ"
                >
                  <Turtle className="w-7 h-7 sm:w-8 sm:h-8" />
                  <span>Đọc chậm</span>
                </button>
              </div>

              {/* Mic Status and Button */}
              <div className="flex flex-col items-center lg:items-start mt-4 sm:mt-6">
                <div className="relative mb-2">
                  {isListening && (
                    <motion.div 
                      initial={{ scale: 0.8, opacity: 0.5 }}
                      animate={{ scale: 2, opacity: 0 }}
                      transition={{ repeat: Infinity, duration: 1 }}
                      className="absolute inset-0 bg-red-400 rounded-full"
                    />
                  )}
                  
                  <button 
                    onClick={toggleListening}
                    className={`relative z-10 w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 ${isListening ? "bg-red-500" : "bg-emerald-500"}`}
                  >
                    <Mic className={`w-10 h-10 sm:w-12 sm:h-12 text-white ${isListening ? "animate-pulse" : ""}`} />
                  </button>
                </div>
                <p className="text-slate-400 font-bold uppercase tracking-widest text-xs sm:text-sm">{micStatus}</p>
              </div>
            </div>
          </div>

          <div className="absolute inset-x-2 sm:inset-x-4 lg:inset-x-6 top-1/2 -translate-y-1/2 flex justify-between pointer-events-none z-20">
            <button 
              onClick={handlePrevWord}
              disabled={currentWordIndex === 0}
              className={`w-12 h-12 sm:w-16 sm:h-16 lg:w-18 lg:h-18 rounded-2xl sm:rounded-3xl flex items-center justify-center shadow-2xl transition-all pointer-events-auto active:scale-90 ${currentWordIndex === 0 ? "bg-slate-100 text-slate-300 opacity-30 cursor-not-allowed" : "bg-white text-aloblue border-4 border-sky-100 hover:bg-sky-50"}`}
              title="Từ trước"
            >
              <ChevronLeft className="w-7 h-7 sm:w-9 sm:h-9 lg:w-11 lg:h-11" />
            </button>
            <button 
              onClick={handleNextWord}
              className="w-12 h-12 sm:w-16 sm:h-16 lg:w-18 lg:h-18 rounded-2xl sm:rounded-3xl bg-white text-aloblue border-4 border-sky-100 flex items-center justify-center shadow-2xl active:scale-90 pointer-events-auto hover:bg-sky-50"
              title="Từ tiếp theo"
            >
              <ChevronRight className="w-7 h-7 sm:w-9 sm:h-9 lg:w-11 lg:h-11" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderQuiz = () => {
    if (!currentLesson) return null;
    const targetWord = currentLesson.words[currentWordIndex];
    const totalWords = currentLesson.words.length;

    return (
      <div className="flex flex-col p-2 sm:p-6 max-w-6xl mx-auto w-full h-full relative">
        <div className="flex justify-between items-center mb-4 sm:mb-6 relative z-10 w-full">
          <button 
            onClick={() => setScreen("preview")} 
            className="w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center bg-white/20 hover:bg-white/40 text-white rounded-2xl transition-all shadow-md active:scale-95"
            title="Đóng"
          >
            <X className="w-6 h-6 sm:w-7 sm:h-7" />
          </button>
          <div className="bg-white/95 backdrop-blur-md px-6 py-2 sm:py-2.5 rounded-full shadow-xl border-2 border-sky-100">
            <span className="font-fredoka font-bold text-aloblue uppercase tracking-tight text-sm sm:text-base">Câu hỏi {currentWordIndex + 1}/{totalWords}</span>
          </div>
          <div className="w-11 sm:w-12"></div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-6 sm:gap-8 relative z-10 w-full my-auto">
          <div className="w-full max-w-xl flex flex-col items-center gap-3">
            <h3 className="text-2xl sm:text-3xl lg:text-4xl font-fredoka font-bold text-white text-center drop-shadow-lg leading-tight uppercase">
              Bé hãy chọn hình của từ:
            </h3>
            
            {(() => {
              const quizMeaning = targetWord.meaning || getMeaningForWord(targetWord.word);
              return (
                <button 
                  onClick={() => speakWord(targetWord)}
                  className="card-bubble bg-white px-8 py-4 sm:py-5 w-full max-w-md flex items-center justify-center gap-4 border-white active:scale-95 group transition-all shadow-xl rounded-3xl cursor-pointer"
                >
                  <div className="w-14 h-14 sm:w-16 sm:h-16 bg-aloblue text-white rounded-2xl flex items-center justify-center shadow-md group-hover:rotate-12 transition-transform shrink-0">
                    <Volume2 className="w-8 h-8 sm:w-10 sm:h-10" />
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-3xl sm:text-4xl lg:text-5xl font-fredoka font-bold text-aloblue tracking-tight uppercase leading-none">{targetWord.word}</span>
                    {quizMeaning && (
                      <span className="text-sm sm:text-base text-emerald-700 font-bold mt-1 bg-emerald-50 px-3 py-0.5 rounded-full border border-emerald-200">
                        🇻🇳 {quizMeaning}
                      </span>
                    )}
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Bấm để nghe đọc (Anh - Việt) 🔊</p>
                  </div>
                </button>
              );
            })()}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8 w-full max-w-5xl mx-auto">
            {quizOptions.map((option, idx) => (
              <motion.button
                key={`${currentWordIndex}-${idx}`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleSelectQuizOption(option)}
                className="aspect-square bg-white rounded-[2.5rem] sm:rounded-[3rem] p-3 sm:p-4 shadow-2xl border-4 sm:border-8 border-white hover:border-aloblue/50 active:scale-95 transition-all flex items-center justify-center relative group cursor-pointer"
              >
                <img src={option.image} alt="Option" className="w-full h-full object-cover rounded-[1.8rem] sm:rounded-[2.2rem] group-hover:scale-105 transition-transform duration-300" />
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderVictory = () => {
    const list = isChallengeMode ? challengeWords : currentLesson?.words;
    return (
      <div className="flex flex-col items-center justify-center p-6 h-full text-center relative overflow-hidden bg-emerald-50/20">
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
          <div className="absolute top-10 left-10 w-20 h-20 bg-yellow-200 rounded-full blur-3xl opacity-30 animate-float" />
          <div className="absolute bottom-10 right-10 w-32 h-32 bg-pink-200 rounded-full blur-3xl opacity-30 animate-bubble" />
        </div>
        
        <div className="w-40 h-40 bg-white rounded-[3rem] flex items-center justify-center mb-8 shadow-2xl border-4 border-yellow-300 relative z-10 animate-bubble">
          <Trophy className="w-20 h-20 text-amber-500" />
          <motion.div 
            animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            className="absolute -top-4 -right-4 bg-pink-500 text-white w-14 h-14 rounded-full flex items-center justify-center font-fredoka font-bold border-4 border-white shadow-xl text-sm"
          >
            TUYỆT!
          </motion.div>
        </div>
        
        <div className="relative z-10">
          <h2 className="text-5xl font-fredoka font-bold text-indigo-600 mb-3 drop-shadow-sm">{isChallengeMode ? "Đỉnh quá bé ơi!" : "Hoàn thành!"}</h2>
          <p className="text-xl text-slate-500 mb-10 font-bold uppercase tracking-tight">
            {isChallengeMode ? "Bé đã vượt qua thử thách khó rồi đấy!" : "Bé đã hoàn thành bài học xuất sắc!"}
          </p>
          
          <div className="bg-white rounded-[2.5rem] p-8 shadow-xl border-4 border-indigo-50 w-full max-w-sm mb-10 mx-auto transform -rotate-1">
            <p className="text-slate-400 font-bold mb-2 uppercase tracking-widest text-sm">Điểm số của bé</p>
            <div className="flex items-center justify-center gap-3">
              <Star className="w-8 h-8 text-yellow-400 fill-yellow-400" />
              <p className={`text-6xl font-fredoka font-bold ${isChallengeMode ? "text-pink-500" : "text-emerald-500"}`}>
                {score} / {list?.length}
              </p>
              <Star className="w-8 h-8 text-yellow-400 fill-yellow-400" />
            </div>
          </div>

          <button 
            onClick={() => setScreen(isChallengeMode ? "setup" : "preview")}
            className="w-full max-w-xs bg-indigo-600 text-white py-5 rounded-3xl font-fredoka font-bold text-2xl hover:bg-indigo-700 transition-all shadow-[0_6px_0_rgb(67,56,202)] active:shadow-[0_0px_0_rgb(67,56,202)] active:translate-y-1 group"
          >
            <ArrowLeft className="inline-block mr-2 w-7 h-7 group-hover:-translate-x-1 transition-transform" /> 
            {isChallengeMode ? "Về trang chính" : "Tiếp tục học"}
          </button>
        </div>
      </div>
    );
  };

  const previewVoice = (engine: "studio-us" | "studio-uk" | "device", voiceURI?: string) => {
    clearActiveSpeech();

    const sampleText = "Hello! Welcome to English for Kids!";
    const sampleVi = "Xin chào các bé đến với Tiếng Anh!";

    if (engine === "studio-us" || engine === "studio-uk") {
      const lang = engine === "studio-uk" ? "en-GB" : "en-US";
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(sampleText)}`;
      const audio = new Audio(ttsUrl);
      currentAudioRef.current = audio;

      if (autoReadVietnamese) {
        audio.onended = () => {
          viTimeoutRef.current = setTimeout(() => {
            speakVietnamese(sampleVi);
          }, 350);
        };
      }

      audio.play().catch(() => {
        fallbackSpeech(sampleText, false, autoReadVietnamese ? sampleVi : undefined);
      });
    } else {
      if (!("speechSynthesis" in window)) return;
      const utterance = new SpeechSynthesisUtterance(sampleText);
      const allVoices = window.speechSynthesis.getVoices();
      const targetVoice = allVoices.find(x => x.voiceURI === (voiceURI || selectedVoiceURI));
      if (targetVoice) utterance.voice = targetVoice;
      utterance.lang = "en-US";
      utterance.rate = 0.85;
      utterance.pitch = 1.0;

      if (autoReadVietnamese) {
        utterance.onend = () => {
          viTimeoutRef.current = setTimeout(() => {
            speakVietnamese(sampleVi);
          }, 350);
        };
      }

      window.speechSynthesis.speak(utterance);
    }
  };

  const renderVoiceSettings = () => (
    <div className="fixed inset-0 bg-slate-900/50 z-[110] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50/80">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-md">
              <Volume2 className="w-6 h-6" />
            </div>
            <div className="flex flex-col">
              <h3 className="text-xl font-fredoka font-bold text-indigo-900 leading-tight">Cài đặt Giọng Đọc Chuẩn</h3>
              <p className="text-xs text-indigo-500 font-bold">Đồng bộ âm thanh chuẩn bản ngữ trên mọi thiết bị</p>
            </div>
          </div>
          <button 
            onClick={() => setShowVoiceSettings(false)} 
            className="w-10 h-10 rounded-xl bg-white/80 hover:bg-white text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors shadow-xs"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {/* Notice Box for iOS and Mobile */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-800 leading-relaxed">
              <span className="font-bold">Đã khắc phục hoàn toàn trên iOS:</span> Hệ thống sử dụng âm thanh Studio chất lượng cao, khử triệt để hiện tượng rè tiếng hay méo giọng trên iPhone/iPad và đồng bộ chuẩn xác 100%.
            </div>
          </div>

          {/* Bilingual Reading Mode for Pre-literate Kids */}
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-2xl p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-bold text-xl shrink-0 shadow-sm">
                  🇻🇳
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-sm sm:text-base">Đọc song ngữ Anh - Việt</span>
                    <span className="text-[10px] bg-amber-500 text-white font-bold px-2 py-0.5 rounded-full">Bé chưa biết chữ</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Sau khi đọc từ tiếng Anh, hệ thống <strong>đọc luôn nghĩa tiếng Việt</strong> (Ví dụ: <em>"Apple" ➔ "Quả táo"</em>) giúp bé hiểu nghĩa ngay mà chưa cần đọc chữ.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAutoReadVietnamese(!autoReadVietnamese)}
                className={`w-14 h-8 rounded-full transition-colors relative p-1 shrink-0 ${autoReadVietnamese ? "bg-emerald-500" : "bg-slate-300"}`}
                title={autoReadVietnamese ? "Đang bật" : "Đang tắt"}
              >
                <div className={`w-6 h-6 rounded-full bg-white transition-transform shadow-md ${autoReadVietnamese ? "translate-x-6" : "translate-x-0"}`} />
              </button>
            </div>

            <div className="pt-2 border-t border-amber-200/60 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs text-amber-900 font-medium">
                Trạng thái: <strong className={autoReadVietnamese ? "text-emerald-700" : "text-slate-500"}>{autoReadVietnamese ? "BẬT (Đọc Tiếng Anh + Tiếng Việt)" : "TẮT (Chỉ đọc Tiếng Anh)"}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  speakWord({ word: "Apple", meaning: "Quả táo" });
                }}
                className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-900 font-bold text-xs hover:bg-amber-100 transition-colors flex items-center gap-1 shadow-xs"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Nghe thử: "Apple ➔ Quả táo"</span>
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
              1. Giọng Chuẩn Studio Quốc Tế (Khuyên dùng)
            </p>

            {/* US Voice Option */}
            <div 
              onClick={() => {
                setVoiceEngine("studio-us");
                previewVoice("studio-us");
              }}
              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                voiceEngine === "studio-us" 
                ? "border-indigo-600 bg-indigo-50/70 shadow-sm" 
                : "border-slate-100 hover:border-indigo-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className="text-3xl">🇺🇸</div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-base">Tiếng Anh - Mỹ (Studio US Natural)</span>
                    <span className="text-[10px] bg-emerald-500 text-white font-bold px-2 py-0.5 rounded-full">Khuyên dùng</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Giọng đọc bản ngữ chuẩn Mỹ, trong trẻo, tự nhiên và không rè tiếng.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setVoiceEngine("studio-us");
                    previewVoice("studio-us");
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white border border-indigo-200 text-indigo-600 font-bold text-xs hover:bg-indigo-600 hover:text-white transition-colors flex items-center gap-1 shadow-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Nghe thử</span>
                </button>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${voiceEngine === "studio-us" ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"}`}>
                  {voiceEngine === "studio-us" && <Check className="w-3.5 h-3.5" />}
                </div>
              </div>
            </div>

            {/* UK Voice Option */}
            <div 
              onClick={() => {
                setVoiceEngine("studio-uk");
                previewVoice("studio-uk");
              }}
              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                voiceEngine === "studio-uk" 
                ? "border-indigo-600 bg-indigo-50/70 shadow-sm" 
                : "border-slate-100 hover:border-indigo-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className="text-3xl">🇬🇧</div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-base">Tiếng Anh - Anh (Studio UK Royal)</span>
                    <span className="text-[10px] bg-sky-500 text-white font-bold px-2 py-0.5 rounded-full">Chuẩn Anh</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Ngữ điệu quý tộc Anh chuẩn mực, trầm ấm và tròn vành rõ chữ.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setVoiceEngine("studio-uk");
                    previewVoice("studio-uk");
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white border border-indigo-200 text-indigo-600 font-bold text-xs hover:bg-indigo-600 hover:text-white transition-colors flex items-center gap-1 shadow-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Nghe thử</span>
                </button>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${voiceEngine === "studio-uk" ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"}`}>
                  {voiceEngine === "studio-uk" && <Check className="w-3.5 h-3.5" />}
                </div>
              </div>
            </div>
          </div>

          {/* Option 2: Device Voice (Offline) */}
          <div className="space-y-3 pt-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
              2. Giọng Hệ Thống Máy (Offline)
            </p>

            <div 
              onClick={() => {
                setVoiceEngine("device");
                previewVoice("device");
              }}
              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                voiceEngine === "device" 
                ? "border-indigo-600 bg-indigo-50/70 shadow-sm" 
                : "border-slate-100 hover:border-indigo-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className="text-3xl">📱</div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-base">Bộ tổng hợp giọng của thiết bị</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Dùng giọng có sẵn trên máy (Đã khử rè với pitch 1.0 trên iOS).</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setVoiceEngine("device");
                    previewVoice("device");
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white border border-indigo-200 text-indigo-600 font-bold text-xs hover:bg-indigo-600 hover:text-white transition-colors flex items-center gap-1 shadow-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Nghe thử</span>
                </button>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${voiceEngine === "device" ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"}`}>
                  {voiceEngine === "device" && <Check className="w-3.5 h-3.5" />}
                </div>
              </div>
            </div>

            {/* Detailed device voice list if device mode selected */}
            {voiceEngine === "device" && (
              <div className="pl-4 pr-1 py-2 space-y-2 border-l-2 border-indigo-200">
                <p className="text-xs text-slate-500 font-medium">Danh sách giọng có trên máy của bạn:</p>
                {voices.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Đang tải danh sách giọng máy...</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {voices.map(voice => (
                      <button
                        key={voice.voiceURI}
                        onClick={() => {
                          setSelectedVoiceURI(voice.voiceURI);
                          previewVoice("device", voice.voiceURI);
                        }}
                        className={`w-full p-2.5 rounded-xl text-left text-xs transition-all border flex items-center justify-between ${
                          selectedVoiceURI === voice.voiceURI 
                          ? "border-indigo-600 bg-white font-bold text-indigo-700 shadow-xs" 
                          : "border-slate-100 hover:border-slate-200 bg-slate-50 text-slate-600"
                        }`}
                      >
                        <div className="truncate mr-2">
                          <span className="block truncate">{voice.name}</span>
                          <span className="text-[10px] text-slate-400 uppercase">{voice.lang}</span>
                        </div>
                        {selectedVoiceURI === voice.voiceURI && <Star className="w-4 h-4 fill-indigo-600 text-indigo-600 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Modal Footer */}
        <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-100 flex items-center gap-3">
          <button 
            onClick={() => setShowVoiceSettings(false)}
            className="w-full bg-indigo-600 text-white py-3.5 rounded-2xl font-bold text-base hover:bg-indigo-700 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
          >
            <Check className="w-5 h-5" />
            <span>Đã Xong & Lưu Cài Đặt</span>
          </button>
        </div>
      </motion.div>
    </div>
  );

  return (
    <div className="bg-[#00B1FF] font-arial text-slate-800 min-h-screen w-full flex flex-col relative overflow-hidden">
      <PlayfulBackground />
      {loading && (
        <div className="fixed inset-0 bg-sky-400/90 backdrop-blur-md z-50 flex flex-col items-center justify-center text-white">
          <Loader2 className="w-16 h-16 animate-spin mb-4" />
          <h2 className="text-3xl font-fredoka drop-shadow-md">Bé đợi chút nha...</h2>
        </div>
      )}

      <div className="w-full flex-1 flex flex-col relative z-20 overflow-hidden">
        <header className="bg-gradient-to-r from-aloblue to-[#0081C9] text-white px-4 sm:px-8 py-3.5 sm:py-4 flex justify-between items-center z-10 relative overflow-hidden shadow-md">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
          <div className="max-w-7xl mx-auto w-full flex justify-between items-center">
            <h1 
              onClick={() => setScreen("setup")}
              className="font-fredoka text-xl sm:text-2xl font-bold flex items-center gap-3 relative z-10 tracking-tight drop-shadow-md uppercase cursor-pointer select-none"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-2xl flex items-center justify-center text-xl sm:text-2xl shadow-xl rotate-3 hover:rotate-0 transition-transform">🐱</div>
              Fun with words
            </h1>
            <div className="flex items-center gap-2 sm:gap-3 relative z-10">
              {user ? (
                <div className="flex items-center gap-2 sm:gap-3">
                  <button 
                    onClick={handleAdminToggle}
                    className={`p-2 sm:px-3 sm:py-2 rounded-xl sm:rounded-2xl transition-all shadow-md flex items-center gap-1.5 font-bold text-xs sm:text-sm ${isAdmin ? "bg-amber-400 text-white" : "bg-white/20 text-white hover:bg-white/30"}`}
                    title={isAdmin ? "Tắt Sửa" : "Bật Sửa"}
                  >
                    <UserIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden sm:inline">{isAdmin ? "Admin (Bật)" : "Admin"}</span>
                  </button>
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full overflow-hidden border-2 border-white shadow-md">
                    <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} alt="User" className="w-full h-full object-cover" />
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-red-500 text-white hover:bg-red-600 transition-all shadow-md"
                    title="Đăng xuất"
                  >
                    <X className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={handleLogin}
                  className="bg-white/20 text-white px-3 sm:px-4 py-2 rounded-xl sm:rounded-2xl hover:bg-white/30 transition-all shadow-md active:scale-95 flex items-center gap-2 font-bold text-xs sm:text-sm"
                  title="Đăng nhập"
                >
                  <UserIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="hidden sm:inline">Đăng nhập</span>
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 relative overflow-y-auto overflow-x-hidden p-2 sm:p-4 lg:p-6 bg-white/25 backdrop-blur-xs flex flex-col">
          <AnimatePresence mode="wait">
            <motion.div
              key={screen}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="h-full w-full"
            >
              {screen === "setup" && renderSetup()}
              {screen === "create" && renderCreate()}
              {screen === "preview" && renderPreview()}
              {screen === "game" && renderGame()}
              {screen === "quiz" && renderQuiz()}
              {screen === "victory" && renderVictory()}
            </motion.div>
          </AnimatePresence>
        </main>
        <div className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest bg-slate-50 border-t border-slate-100 relative overflow-hidden h-14 sm:h-16 flex items-center justify-center">
          <div className="absolute inset-0 pointer-events-none">
             <div className="absolute top-1/2 -translate-y-1/2 flex items-center gap-6 animate-[chasing_15s_linear_infinite]" style={{ width: 'fit-content' }}>
                <span className="text-3xl sm:text-4xl drop-shadow-md">🏃</span>
                <span className="text-5xl sm:text-6xl drop-shadow-lg">🦖</span>
             </div>
          </div>
          <span className="relative z-10 bg-white/95 px-5 py-1.5 rounded-full backdrop-blur-md shadow-sm border border-indigo-50 text-indigo-500 font-bold text-xs">BY TAMBMT</span>
        </div>
      </div>

      {/* CUSTOM MODAL */}
      <AnimatePresence>
        {modal && (
          <div className="fixed inset-0 bg-slate-900/40 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl"
            >
              <div className="text-center mb-6">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl ${modal.type === "success" ? "bg-emerald-100 text-emerald-500" : modal.type === "error" ? "bg-red-100 text-red-500" : modal.type === "warning" ? "bg-amber-100 text-amber-500" : "bg-indigo-100 text-indigo-600"}`}>
                  <Info className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-fredoka font-bold text-slate-800 mb-2">{modal.title}</h3>
                <p className="text-slate-600 font-medium">{modal.message}</p>
              </div>
              <div className="flex gap-3">
                {modal.onConfirm && modal.type === "warning" && (
                  <button 
                    onClick={() => setModal(null)}
                    className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    Hủy
                  </button>
                )}
                <button 
                  onClick={() => {
                    const confirm = modal.onConfirm;
                    setModal(null);
                    if (confirm) confirm();
                  }}
                  className={`flex-1 py-3 rounded-xl font-bold text-white transition-colors shadow-md ${modal.type === "success" ? "bg-emerald-500 hover:bg-emerald-600" : modal.type === "error" ? "bg-red-500 hover:bg-red-600" : modal.type === "warning" ? "bg-amber-500 hover:bg-amber-600" : "bg-indigo-600 hover:bg-indigo-700"}`}
                >
                  Đồng ý
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL MẬT KHẨU ADMIN */}
      <AnimatePresence>
        {showVoiceSettings && renderVoiceSettings()}
        {showPassModal && (
          <div className="fixed inset-0 bg-slate-900/40 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl"
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-fredoka font-bold text-slate-800 mb-2">Xác nhận Admin</h3>
                <p className="text-slate-600 font-medium text-sm">Vui lòng nhập mật khẩu để chỉnh sửa</p>
              </div>
              
              <input 
                type="password"
                value={passInput}
                onChange={(e) => setPassInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyPass()}
                placeholder="Mật khẩu..."
                autoFocus
                className="w-full border-2 border-indigo-100 rounded-xl p-3 mb-6 focus:outline-none focus:border-indigo-600 text-center font-bold tracking-widest text-xl"
              />

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowPassModal(false)}
                  className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={handleVerifyPass}
                  className="flex-1 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition-colors"
                >
                  Xác nhận
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
