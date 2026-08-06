// lib/inbound.ts
import * as XLSX from "xlsx";
import { InboundItem } from "../types";
import { isSizeHeader } from "./utils";

/**
 * 입고 숫자 변환: 빈값/NaN → 0, 쉼표 제거
 */
function parseNumber(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/,/g, "").trim();
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * 최근입고 엑셀 파싱
 *
 * 구조 (2행 헤더):
 * Row 0: [이미지, 모델그룹, 모델명, 연결모델명, 색상, 전용상품, ..., 합계, , , 28W/30L, 30W/30L, ...]
 * Row 1: [, , , , , , ..., SET, PCS, , , , ...]
 * Row 2+: 데이터
 *
 * 핵심 컬럼:
 * - 모델그룹: "TXP441"
 * - 모델명: "CQ-TXP441-ZZBLK"
 * - 연결모델명: "CQ-TXP441-BLK" (ZZ의 공용 매핑, 없으면 빈칸)
 * - 전용상품: "국내" → ZZ(국내전용), 빈칸 → 공용
 */
export function parseInboundData(workbook: XLSX.WorkBook): InboundItem[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  const results: InboundItem[] = [];
  if (raw.length < 3) return results;

  const headerRow = raw[0];

  // ─── 핵심 컬럼 인덱스 찾기 (헤더에서 검색) ───
  let modelGroupCol = -1;
  let modelNameCol = -1;
  let linkedModelCol = -1;
  let domesticCol = -1;

  for (let i = 0; i < headerRow.length; i++) {
    const val = String(headerRow[i] ?? "").replace(/\n/g, "").trim();
    if (val === "모델그룹") modelGroupCol = i;
    if (val === "모델명") modelNameCol = i;
    if (val === "연결모델명") linkedModelCol = i;
    if (val === "전용상품") domesticCol = i;
  }

  // 못 찾으면 기본값 (CSV 기준)
  if (modelGroupCol === -1) modelGroupCol = 1;
  if (modelNameCol === -1) modelNameCol = 2;
  if (linkedModelCol === -1) linkedModelCol = 3;
  if (domesticCol === -1) domesticCol = 5;

  // ─── 사이즈 컬럼 자동 감지 (헤더에서 "xxW/xxL" 패턴) ───
  const sizeColumns: { col: number; size: string }[] = [];

for (let i = 0; i < headerRow.length; i++) {
  const val = String(headerRow[i] ?? "").trim();
  if (isSizeHeader(val)) {
    sizeColumns.push({ col: i, size: val });
  }
}

  // ─── 데이터 행 파싱 (row 2부터) ───
  for (let r = 2; r < raw.length; r++) {
    const row = raw[r];
    const fullCode = String(row[modelNameCol] ?? "").trim();

    // 모델명이 없으면 건너뜀 (빈 행, 합계 행 등)
    if (!fullCode || !fullCode.includes("-")) continue;

    const modelGroup = String(row[modelGroupCol] ?? "").trim();
    const linkedCode = String(row[linkedModelCol] ?? "").trim();
    const domesticVal = String(row[domesticCol] ?? "").replace(/\n/g, "").trim();
    const isDomestic = domesticVal === "국내";

       // 색상 코드 추출
    const parts = fullCode.split("-");
    const color = parts[parts.length - 1] || "";

    for (const { col, size } of sizeColumns) {
      const qty = parseNumber(row[col]);
      results.push({
        modelGroup,
        fullCode,
        linkedCode,
        color,
        isDomestic,
        size,
        qty,
      });
    }
  }

  return results;
}

/**
 * 입고수량 조회 - 특정 모델+색상+사이즈
 * ZZ 우선 로직
 */
export function findInboundQty(
  inboundData: InboundItem[],
  model: string,
  requestColor: string,
  size: string
): { qty: number; matchedColor: string } {
  const baseColor = requestColor.replace(/^ZZ/i, "");
  const zzColor = `ZZ${baseColor}`;

  const zzMatch = inboundData.find(
    (item) =>
      item.modelGroup === model && item.color === zzColor && item.size === size
  );
  if (zzMatch) {
    return { qty: zzMatch.qty, matchedColor: zzColor };
  }

  const baseMatch = inboundData.find(
    (item) =>
      item.modelGroup === model &&
      item.color === baseColor &&
      item.size === size
  );
  if (baseMatch) {
    return { qty: baseMatch.qty, matchedColor: baseColor };
  }

  return { qty: 0, matchedColor: requestColor };
}