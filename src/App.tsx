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
  Info
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
  signInAnonymously, 
  onAuthStateChanged, 
  User
} from "firebase/auth";
import { getDocFromServer } from "firebase/firestore";
import { db, auth } from "./firebase";
import { Lesson, Word, Screen } from "./types";

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

const speakText = (text: string) => {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.startsWith("en-US") || v.lang.startsWith("en_US") || v.lang.startsWith("en-GB"));
    if (englishVoice) utterance.voice = englishVoice;
    utterance.lang = "en-US";
    utterance.rate = 0.8;
    utterance.pitch = 1.1;
    window.speechSynthesis.speak(utterance);
  }
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
          image: `https://ui-avatars.com/api/?name=${encodeURIComponent(line)}&background=random&color=fff&size=400&font-size=0.3&bold=true`
        };
        parsed.push(currentWord);
      } else if (!currentWord.meaning) {
        currentWord.meaning = line;
      } else {
        currentWord = {
          word: line,
          image: `https://ui-avatars.com/api/?name=${encodeURIComponent(line)}&background=random&color=fff&size=400&font-size=0.3&bold=true`
        };
        parsed.push(currentWord);
      }
    }
  }
  return parsed;
};

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
  const [modal, setModal] = useState<{ title: string; message: string; type: "success" | "warning" | "info" | "error"; onConfirm?: () => void } | null>(null);

  const recognitionRef = useRef<any>(null);

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
      if (u) {
        setUser(u);
      } else {
        signInAnonymously(auth).catch(console.error);
      }
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
    if (passInput === "1234") {
      setIsAdmin(true);
      localStorage.setItem("isAdmin", "true");
      setShowPassModal(false);
      showModal("Thành công", "Chào mừng Admin! Bạn có thể thêm/sửa/xóa bài học.", "success");
    } else {
      showModal("Lỗi", "Mật khẩu không đúng!", "error");
    }
  };

  const handleSaveLesson = async () => {
    let currentUser = user;
    if (!currentUser) {
      try {
        const cred = await signInAnonymously(auth);
        currentUser = cred.user;
        setUser(currentUser);
      } catch (e) {
        console.warn("Auth initialization failed, attempting save anyway...", e);
        // We don't block here anymore because rules are relaxed for lessons
      }
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
          updatedAt: serverTimestamp()
        });
        showModal("Thành công!", "Đã cập nhật bài học thành công 🎉", "success", () => {
          setScreen("setup");
          setEditingLessonId(null);
        });
      } else {
        await addDoc(collection(db, path), {
          title: lessonTitle,
          words: words,
          creatorId: currentUser?.uid || "anonymous",
          createdAt: serverTimestamp()
        });
        showModal("Thành công!", "Đã tạo bài học mới thành công 🎉", "success", () => {
          setScreen("setup");
          setEditingLessonId(null);
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
    if (!currentLesson) return;
    const target = currentLesson.words[currentWordIndex].word;
    const cleanTarget = target.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanRecognized = recognized.toLowerCase().replace(/[^a-z0-9]/g, "");
    const sim = getSimilarityPercent(cleanTarget, cleanRecognized);

    if (sim >= 85 || cleanRecognized.includes(cleanTarget)) {
      setScore(s => s + 1);
      setFeedback({ text: "Giỏi quá! 🎉", type: "success" });
      setMicStatus(`Bé nói: "${recognized}"`);
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      setTimeout(() => {
        if (currentWordIndex + 1 >= currentLesson.words.length) {
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
      speakText(target);
      // Giữ feedback lâu hơn để bé đọc kịp
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  const startGame = (lesson: Lesson) => {
    setCurrentLesson(lesson);
    setCurrentWordIndex(0);
    setScore(0);
    setScreen("game");
    setTimeout(() => speakText(lesson.words[0].word), 500);
  };

  // --- RENDER SCREENS ---

  const renderSetup = () => (
    <div className="flex flex-col p-4">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-fredoka font-bold text-indigo-600">Chọn bài học</h2>
        {isAdmin && (
          <button 
            onClick={() => { setEditingLessonId(null); setLessonTitle(""); setLessonData(""); setScreen("create"); }}
            className="bg-emerald-500 text-white px-4 py-2 rounded-xl font-bold hover:bg-emerald-600 transition-all shadow-md active:scale-95"
          >
            <Plus className="inline-block mr-1 w-5 h-5" /> Tạo mới
          </button>
        )}
      </div>
      
      <div className="flex flex-col gap-4">
        {lessons.length === 0 ? (
          <div className="text-center p-8 bg-indigo-50 rounded-2xl border-2 border-dashed border-indigo-200">
            <BookOpen className="w-12 h-12 text-indigo-300 mx-auto mb-2" />
            <p className="text-slate-500 font-medium">Chưa có bài học nào.</p>
          </div>
        ) : (
          lessons.map(lesson => (
            <div 
              key={lesson.id}
              onClick={() => { setCurrentLesson(lesson); setScreen("preview"); }}
              className="bg-white border-2 border-slate-100 rounded-2xl p-4 flex items-center shadow-sm hover:shadow-md hover:border-indigo-100 transition-all cursor-pointer group"
            >
              <div className="w-16 h-16 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 text-2xl group-hover:scale-110 transition-transform flex-shrink-0">
                <BookOpen className="w-8 h-8" />
              </div>
              <div className="ml-4 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-slate-400 font-semibold">{lesson.words.length} từ</span>
                </div>
                <h3 className="font-bold text-slate-800 text-lg group-hover:text-indigo-600 transition-colors">{lesson.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setEditingLessonId(lesson.id!); 
                        setLessonTitle(lesson.title); 
                        setLessonData(lesson.words.map(w => `${w.word}${w.phonetic ? `\n${w.phonetic}` : ""}${w.meaning ? `\n${w.meaning}` : ""}\n${w.image}`).join("\n\n"));
                        setScreen("create"); 
                      }}
                      className="p-2 rounded-full bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-400 transition-colors"
                      title="Sửa"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        handleDeleteLesson(lesson.id);
                      }}
                      className="p-2 rounded-full bg-slate-100 hover:bg-red-500 hover:text-white text-slate-400 transition-colors"
                      title="Xóa"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                )}
                <ChevronRight className="text-slate-300 group-hover:text-indigo-600 transition-colors" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderCreate = () => (
    <div className="flex flex-col p-4 h-full">
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
    <div className="flex flex-col p-4 h-full">
      <div className="flex justify-between items-center mb-4">
        <button onClick={() => setScreen("setup")} className="text-slate-500 hover:text-indigo-600 transition-colors">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-xl font-fredoka font-bold text-indigo-600 truncate max-w-[200px]">{currentLesson?.title}</h2>
        <div className="w-6"></div>
      </div>
      
      <div className="bg-indigo-50 rounded-2xl p-4 mb-4 text-center">
        <p className="text-slate-600 font-medium">Cùng nghe thử các từ vựng nhé!</p>
      </div>

      <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 p-1">
        {currentLesson?.words.map((item, idx) => (
          <div key={idx} className="bg-white rounded-2xl p-3 shadow-sm flex flex-col items-center border border-slate-100">
            <div className="w-full aspect-square rounded-xl overflow-hidden bg-slate-100 mb-2">
              <img src={item.image} alt={item.word} className="w-full h-full object-cover" />
            </div>
            <h4 className={`font-bold text-slate-800 capitalize w-full text-center break-words leading-tight ${getDynamicFontSize(item.word)}`}>
              {item.word}
            </h4>
            {item.phonetic && <p className="text-[10px] text-indigo-500 font-medium mb-0.5 text-center">{item.phonetic}</p>}
            {item.meaning && <p className="text-xs text-slate-500 font-bold mb-1 text-center">{item.meaning}</p>}
            <button 
              onClick={() => speakText(item.word)}
              className="mt-2 w-full bg-indigo-50 text-indigo-600 py-2 rounded-xl font-bold hover:bg-indigo-100 transition-colors text-sm flex items-center justify-center gap-1 active:scale-95"
            >
              <Volume2 className="w-4 h-4" /> Nghe
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200">
        <button 
          onClick={() => currentLesson && startGame(currentLesson)}
          className="w-full bg-pink-500 text-white py-4 rounded-2xl font-bold text-xl hover:bg-pink-600 transition-all shadow-[0_4px_0_rgb(190,24,93)] active:shadow-[0_0px_0_rgb(190,24,93)] active:translate-y-1"
        >
          <Play className="inline-block mr-2 w-6 h-6" /> Bắt đầu học ngay
        </button>
      </div>
    </div>
  );

  const handleNextWord = () => {
    if (!currentLesson) return;
    if (currentWordIndex < currentLesson.words.length - 1) {
      const nextIndex = currentWordIndex + 1;
      setCurrentWordIndex(nextIndex);
      setFeedback(null);
      setMicStatus("Nhấn mic để đọc");
      setTimeout(() => speakText(currentLesson.words[nextIndex].word), 300);
    } else {
      setScreen("victory");
    }
  };

  const handlePrevWord = () => {
    if (!currentLesson) return;
    if (currentWordIndex > 0) {
      const prevIndex = currentWordIndex - 1;
      setCurrentWordIndex(prevIndex);
      setFeedback(null);
      setMicStatus("Nhấn mic để đọc");
      setTimeout(() => speakText(currentLesson.words[prevIndex].word), 300);
    }
  };

  const renderGame = () => {
    if (!currentLesson) return null;
    const wordObj = currentLesson.words[currentWordIndex];

    return (
      <div className="flex flex-col p-4 h-full bg-slate-50 transition-colors duration-300">
        <div className="flex justify-between items-center mb-4">
          <button onClick={() => showModal("Dừng học?", "Bé có muốn quay lại trang bài học không?", "warning", () => setScreen("preview"))} className="text-slate-400 hover:text-slate-600">
            <X className="w-8 h-8" />
          </button>
          <div className="bg-white px-4 py-1.5 rounded-full shadow-sm font-bold text-indigo-600 border border-indigo-100">
            Từ {currentWordIndex + 1} / {currentLesson.words.length}
          </div>
        </div>

        <div className={`flex-1 bg-white rounded-3xl shadow-lg flex flex-col items-center justify-center p-6 relative transition-all duration-300 border-4 ${feedback?.type === "success" ? "border-emerald-500 bg-emerald-50" : feedback?.type === "warning" ? "border-amber-500 bg-amber-50" : "border-transparent"}`}>
          <AnimatePresence>
            {feedback && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute top-4 left-0 w-full text-center z-10 px-4"
              >
                <div className={`inline-block px-6 py-3 rounded-2xl font-bold text-base shadow-lg leading-tight ${feedback.type === "success" ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}`}>
                  {feedback.text}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="w-48 h-48 sm:w-56 sm:h-56 rounded-2xl overflow-hidden shadow-inner mb-6 bg-slate-100 flex items-center justify-center border-4 border-indigo-50">
            <img src={wordObj.image} alt={wordObj.word} className="w-full h-full object-cover" />
          </div>

          <h2 className={`font-fredoka font-bold text-slate-800 mb-1 uppercase tracking-wide text-center px-4 break-words leading-tight ${getDynamicFontSize(wordObj.word, true)}`}>
            {wordObj.word}
          </h2>
          {wordObj.phonetic && (
            <p className="text-lg font-medium text-indigo-500 mb-1 bg-indigo-50 px-4 py-0.5 rounded-full text-center">
              {wordObj.phonetic}
            </p>
          )}
          {wordObj.meaning && (
            <p className="text-2xl font-bold text-pink-500 mb-4 text-center">
              {wordObj.meaning}
            </p>
          )}
          
          <button 
            onClick={() => speakText(wordObj.word)}
            className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 p-3 rounded-full transition-colors mt-2 mb-6 shadow-sm active:scale-90"
          >
            <Volume2 className="w-8 h-8" />
          </button>

          <div className="mt-auto relative w-full flex justify-center pb-4">
            {isListening && (
              <motion.div 
                initial={{ scale: 0.8, opacity: 0.5 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="absolute inset-0 bg-pink-500 rounded-full"
              />
            )}
            
            <button 
              onClick={toggleListening}
              className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all active:translate-y-1 ${isListening ? "bg-red-500 shadow-red-700" : "bg-pink-500 shadow-pink-700"}`}
            >
              <Mic className={`w-10 h-10 text-white ${isListening ? "animate-pulse" : ""}`} />
            </button>
          </div>
          
          <p className="text-slate-500 font-medium text-sm mt-2">{micStatus}</p>

          {/* NÚT ĐIỀU HƯỚNG */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-2 pointer-events-none">
            <button 
              onClick={handlePrevWord}
              disabled={currentWordIndex === 0}
              className={`w-12 h-12 rounded-full flex items-center justify-center shadow-md transition-all pointer-events-auto ${currentWordIndex === 0 ? "bg-slate-100 text-slate-300 cursor-not-allowed" : "bg-white text-indigo-600 hover:bg-indigo-50 active:scale-90"}`}
            >
              <ChevronLeft className="w-8 h-8" />
            </button>
            <button 
              onClick={handleNextWord}
              className="w-12 h-12 rounded-full bg-white text-indigo-600 flex items-center justify-center shadow-md hover:bg-indigo-50 transition-all active:scale-90 pointer-events-auto"
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderVictory = () => (
    <div className="flex flex-col items-center justify-center p-6 h-full text-center">
      <div className="w-32 h-32 bg-yellow-100 rounded-full flex items-center justify-center mb-6 shadow-lg border-4 border-yellow-300">
        <Trophy className="w-16 h-16 text-amber-500" />
      </div>
      
      <h2 className="text-4xl font-fredoka font-bold text-indigo-600 mb-2">Hoàn thành!</h2>
      <p className="text-lg text-slate-600 mb-8 font-medium">Bé đã đọc chính xác các từ vựng.</p>
      
      <div className="bg-white rounded-2xl p-6 shadow-md border-2 border-indigo-50 w-full mb-8">
        <p className="text-slate-500 font-bold mb-1 uppercase tracking-wider text-sm">Điểm số</p>
        <p className="text-5xl font-fredoka font-bold text-emerald-500">
          {score} / {currentLesson?.words.length}
        </p>
      </div>

      <button 
        onClick={() => setScreen("preview")}
        className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-xl hover:bg-indigo-700 transition-all shadow-[0_4px_0_rgb(67,56,202)] active:shadow-[0_0px_0_rgb(67,56,202)] active:translate-y-1"
      >
        <ArrowLeft className="inline-block mr-2 w-6 h-6" /> Quay lại bài học
      </button>
    </div>
  );

  return (
    <div className="bg-indigo-50 font-quicksand text-slate-800 min-h-screen flex flex-col items-center justify-center p-4">
      {loading && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
          <h2 className="text-2xl font-fredoka text-indigo-600">Đang tải...</h2>
        </div>
      )}

      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden min-h-[600px] flex flex-col relative">
        <header className="bg-indigo-600 text-white p-4 flex justify-between items-center shadow-md z-10">
          <h1 className="font-fredoka text-xl font-bold flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" /> Bé Đọc Từ Vựng
          </h1>
          <button 
            onClick={handleAdminToggle}
            className={`p-2 px-4 rounded-xl transition-all flex items-center gap-2 text-sm font-bold shadow-inner ${isAdmin ? "text-amber-400 bg-indigo-800" : "text-indigo-100 bg-indigo-700 hover:bg-indigo-800"}`}
          >
            <Shield className={`w-5 h-5 ${isAdmin ? "animate-pulse" : ""}`} />
            <span>{isAdmin ? "Chế độ Sửa" : "Admin"}</span>
          </button>
        </header>

        <main className="flex-1 relative overflow-y-auto overflow-x-hidden bg-slate-50">
          <AnimatePresence mode="wait">
            <motion.div
              key={screen}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full"
            >
              {screen === "setup" && renderSetup()}
              {screen === "create" && renderCreate()}
              {screen === "preview" && renderPreview()}
              {screen === "game" && renderGame()}
              {screen === "victory" && renderVictory()}
            </motion.div>
          </AnimatePresence>
        </main>
        <div className="p-2 text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest bg-slate-50 border-t border-slate-100">
          BY TAMBMT
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
                <p className="text-slate-600 font-medium text-sm">Vui lòng nhập mật khẩu để chỉnh sửa (Mặc định: 1234)</p>
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
