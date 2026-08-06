"use client";

import { useState, useEffect } from "react";
import {
  USERS,
  getSavedResultsFromCloud,
  getResultFromCloud,
  deleteResultFromCloud,
} from "../lib/firebase";
import { SavedResult } from "../types";

type Props = {
  currentUser: string;
  onUserChange: (user: string) => void;
  onLoad: (saved: SavedResult) => void;
  refreshTrigger: number;
};

export default function Sidebar({
  currentUser,
  onUserChange,
  onLoad,
  refreshTrigger,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [savedList, setSavedList] = useState<
    { id: string; name: string; savedAt: string; summary: any }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && currentUser) {
      loadList();
    }
  }, [isOpen, refreshTrigger, currentUser]);

  const loadList = async () => {
    setLoading(true);
    try {
      const list = await getSavedResultsFromCloud(currentUser);
      setSavedList(list);
    } catch (err) {
      console.error("목록 불러오기 실패:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async (id: string) => {
    setLoadingId(id);
    try {
      const data = await getResultFromCloud(id);
      if (data) {
        onLoad(data as SavedResult);
        setIsOpen(false);
      }
    } catch (err) {
      console.error("불러오기 실패:", err);
      alert("불러오기 실패");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 을(를) 삭제하시겠습니까?`)) return;
    try {
      await deleteResultFromCloud(id);
      setSavedList((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error("삭제 실패:", err);
    }
  };

  return (
    <>
      {/* 좌측 상단 탭 버튼 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-40 px-4 py-2 bg-indigo-600
                   hover:bg-indigo-700 text-white font-bold rounded-lg
                   shadow-lg transition"
      >
        👤 {currentUser}
      </button>

      {/* 사이드바 */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-30 z-40"
            onClick={() => setIsOpen(false)}
          />

          <div className="fixed top-0 left-0 h-full w-80 bg-white shadow-2xl z-50 overflow-y-auto">
            <div className="p-6">
              {/* 헤더 */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">👤 {currentUser}</h2>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl"
                >
                  ✕
                </button>
              </div>

              {/* 사용자 선택 */}
              <div className="mb-6">
                <h3 className="text-xs font-semibold text-gray-400 mb-2">
                  사용자 전환
                </h3>
                <div className="flex flex-wrap gap-2">
                  {USERS.map((user) => (
                    <button
                      key={user}
                      onClick={() => onUserChange(user)}
                      className={`px-3 py-1 rounded-full text-sm font-semibold transition
                        ${currentUser === user
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                    >
                      {user}
                    </button>
                  ))}
                </div>
              </div>

              {/* 저장 목록 */}
              <h3 className="text-sm font-semibold text-gray-500 mb-3">
                📋 {currentUser}님의 저장 목록
              </h3>

              {loading && (
                <p className="text-sm text-gray-400 text-center py-8">
                  ⏳ 불러오는 중...
                </p>
              )}

              {!loading && savedList.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">
                  저장된 결과가 없습니다
                </p>
              )}

              {!loading && savedList.length > 0 && (
                <div className="space-y-2">
                  {savedList.map((item) => (
                    <div
                      key={item.id}
                      className="border border-gray-200 rounded-lg p-3
                                 hover:border-blue-300 hover:bg-blue-50
                                 transition"
                    >
                      <div
                        onClick={() => handleLoad(item.id)}
                        className="cursor-pointer"
                      >
                        <p className="font-bold text-blue-700">
                          {loadingId === item.id ? "⏳ 불러오는 중..." : item.name}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {item.savedAt}
                        </p>
                        {item.summary && (
                          <div className="flex gap-3 text-xs text-gray-500 mt-1">
                            <span>판매 {item.summary.sales?.toLocaleString()}건</span>
                            <span>발주 {item.summary.orders?.toLocaleString()}건</span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item.id, item.name);
                        }}
                        className="text-xs text-red-400 hover:text-red-600 mt-2"
                      >
                        🗑️ 삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}