"use client";

import { useDropzone } from "react-dropzone";

type Props = {
  title: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
};

export default function FileDrop({
  title,
  file,
  onFileChange,
}: Props) {
  const { getRootProps, getInputProps, isDragActive } =
    useDropzone({
      onDrop: (acceptedFiles) => {
        if (acceptedFiles.length > 0) {
          onFileChange(acceptedFiles[0]);
        }
      },
      multiple: false,
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

        {file ? (
          <>
            <p className="text-green-600 font-semibold">
              ✅ {file.name}
            </p>

            <p className="text-gray-500 text-sm mt-2">
              클릭하거나 드래그해서 변경
            </p>
          </>
        ) : (
          <>
            <p className="text-3xl">📁</p>

            <p className="mt-3">
              파일을 드래그하거나 클릭하세요.
            </p>
          </>
        )}
      </div>

      {file && (
        <button
          onClick={() => onFileChange(null)}
          className="text-red-500 text-sm hover:underline"
        >
          ❌ 파일 삭제
        </button>
      )}
    </div>
  );
}