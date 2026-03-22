import { Timestamp } from "firebase/firestore";

export interface Word {
  word: string;
  phonetic?: string;
  meaning?: string;
  image: string;
}

export interface Lesson {
  id?: string;
  title: string;
  creatorId: string;
  words: Word[];
  videoUrl?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type Screen = "setup" | "create" | "preview" | "game" | "victory";
