import { Timestamp } from "firebase/firestore";

export interface Word {
  word: string;
  image: string;
}

export interface Lesson {
  id?: string;
  title: string;
  creatorId: string;
  words: Word[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type Screen = "setup" | "create" | "preview" | "game" | "victory";
