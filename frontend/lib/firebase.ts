// lib/firebase.ts
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  where,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBIL_OFNCGb6tiO1c9vpe4wkwJ3iXKlKtg",
  authDomain: "order-automation-69703.firebaseapp.com",
  projectId: "order-automation-69703",
  storageBucket: "order-automation-69703.firebasestorage.app",
  messagingSenderId: "491640355504",
  appId: "1:491640355504:web:c9e3d4e120bda0683d1975",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const COLLECTION_NAME = "saved-results";

// 사용자 목록
export const USERS = [
  "최준식",
  "고미란",
  "장현정",
  "연지영",
  "허우연",
  "김송이",
  "이단비",
  "이재임",
];

/**
 * 결과 저장 (사용자별)
 */
export async function saveResultToCloud(data: {
  userName: string;
  name: string;
  savedAt: string;
  results: any[];
  growthFactor: number;
  orderMonths: number;
  summary: any;
}): Promise<string> {
  const docRef = await addDoc(collection(db, COLLECTION_NAME), data);
  return docRef.id;
}

/**
 * 특정 사용자의 저장된 결과 목록
 */
export async function getSavedResultsFromCloud(
  userName: string
): Promise<{ id: string; name: string; savedAt: string; summary: any }[]> {
  const q = query(
    collection(db, COLLECTION_NAME),
    where("userName", "==", userName)
  );
  const snapshot = await getDocs(q);

  const results = snapshot.docs.map((doc) => ({
    id: doc.id,
    name: doc.data().name,
    savedAt: doc.data().savedAt,
    summary: doc.data().summary,
  }));

  // 최신순 정렬 (클라이언트에서)
  return results.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * 저장된 결과 하나 가져오기
 */
export async function getResultFromCloud(docId: string): Promise<any | null> {
  const { getDoc } = await import("firebase/firestore");
  const docRef = doc(db, COLLECTION_NAME, docId);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  }
  return null;
}

/**
 * 결과 삭제
 */
export async function deleteResultFromCloud(docId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION_NAME, docId));
}