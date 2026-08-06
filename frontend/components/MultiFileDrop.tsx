"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

type Props = {
  title: string;
  files: File[];
  onFilesChange: (files: File[]) => void;
  // 날짜 입력 관련 (선택)
  dates?: string[];
  onDatesChange?: (dates: string[]) => void;
  showDates?: boolean;
};

export default function MultiFileDrop({
  title,
  files,
  onFilesChange,
  dates = [],
  onDatesChange,
  showDates = false,
}: Props) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const existingNames = new Set(files.map((f) => f.name));
      const newFiles = acceptedFiles.filter(
        (f) => !existingNames.has(f.name)
      );
      onFilesChange([...files, ...newFiles]);

      // 새 파일에 빈 날짜 추가
      if (showDates && onDatesChange) {
        const newDates = [...dates];
        newFiles.forEach(() => newDates.push(""));
        onDatesChange(newDates);
      }
    },
    [files, onFilesChange, dates, onDatesChange, showDates]
  );

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
    if (showDates && onDatesChange) {
      onDatesChange(dates.filter((_, i) => i !== index));
    }
  };

  const removeAll = () => {
    onFilesChange([]);
    if (showDates && onDatesChange) {
      onDatesChange([]);
    }
  };

  const updateDate = (index: number, value: string) => {
    if (onDatesChange) {
      const updated = [...dates];
      updated[index] = value;
      onDatesChange(updated);
    }
  };

  const { getRootProps, getInputProps, isDragActive } =
    useDropzone({
      onDrop,
      multiple: true,
      accept: {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
          ".xlsx",
        ],
        "application/vnd.ms-excel": [".xls"],
      },
    });

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition
        ${
          isDragActive
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-gray-50"
        }`}
      >
        <input {...getInputProps()} />

        <h3 className="font-bold text-lg mb-3">{title}</h3>

        {files.length > 0 ? (
          <>
            <p className="text-green-600 font-semibold">
              ✅ {files.length}개 파일 업로드됨
            </p>
            <p className="text-gray-500 text-sm mt-2">
              클릭하거나 드래그해서 추가
            </p>
          </>
        ) : (
          <>
            <p className="text-3xl">📁</p>
            <p className="mt-3">
              파일을 드래그하거나 클릭하세요 (여러 개 가능)
            </p>
          </>
        )}
      </div>

      {/* 업로드된 파일 목록 */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-3 bg-gray-50
                         rounded-lg px-4 py-2 text-sm"
            >
              <span className="text-gray-700 truncate flex-1">
                📄 {file.name}
              </span>

              {/* 날짜 입력 (showDates일 때만) */}
              {showDates && (
                <input
                  type="date"
                  value={dates[index] || ""}
                  onChange={(e) => updateDate(index, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="px-2 py-1 border border-gray-300 rounded-lg
                             text-gray-700 text-sm focus:outline-none
                             focus:ring-2 focus:ring-blue-400"
                />
              )}

              <button
                onClick={() => removeFile(index)}
                className="text-red-400 hover:text-red-600
                           font-bold text-lg leading-none"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={removeAll}
            className="text-red-500 text-sm hover:underline"
          >
            ❌ 전체 삭제
          </button>
        </div>
      )}
    </div>
  );
}