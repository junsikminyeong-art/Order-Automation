// lib/sales.ts
import * as XLSX from "xlsx";
import { SalesItem } from "../types";

/**
 * 파일명에서 모델명 추출
 * "TXP441 최근 1년 판매데이터.xlsx" → "TXP441"
 */
export function extractModelFromFileName(fileName: string): string {
  // "TXP441", "TXP406" 같은 영문+숫자 패턴을 찾음
  const match = fileName.match(/([A-Za-z]+\d+)/);
  return match ? match[1].toUpperCase() : fileName.split(/[\s_-]/)[0];
}

/**
 * 문자열 → 숫자 변환 (쉼표 제거, 빈값/NaN → 0)
 */
function parseNumber(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/,/g, "").trim();
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * 판매데이터 엑셀 파싱
 * 피벗 테이블(행=색상, 열=사이즈) → 플랫 리스트로 변환
 * 1기 데이터만 추출, 2기는 무시
 */
export function parseSalesData(
  workbook: XLSX.WorkBook,
  fileName: string
): SalesItem[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  const model = extractModelFromFileName(fileName);
  const results: SalesItem[] = [];

  if (raw.length < 3) return results; // 최소 헤더2줄 + 데이터1줄

  const headerRow = raw[0]; // [색상, 합계, , , 28W/30L, , 30W/30L, ...]
  const subHeader = raw[1]; // [, 1기, 2기, , 1기, 2기, 1기, 2기, ...]

  // ─── 사이즈별 1기 컬럼 위치 매핑 ───
  // headerRow에서 사이즈명을 추적하면서
  // subHeader에서 "1기"인 컬럼만 수집
  const sizeColumns: { col: number; size: string }[] = [];
  let currentSize = "";

  for (let i = 0; i < headerRow.length; i++) {
    const header = String(headerRow[i] ?? "").trim();
    const sub = String(subHeader[i] ?? "").trim();

    // 새로운 사이즈명이 나타나면 갱신
    if (header !== "" && header !== "색상" && header !== "합계") {
      currentSize = header;
    }

    // "합계" 영역(보통 col 1~2)의 1기는 건너뜀
    // currentSize가 실제 사이즈일 때만 수집
    if (sub === "1기" && currentSize !== "" && currentSize !== "합계") {
      sizeColumns.push({ col: i, size: currentSize });
    }
  }

  // ─── 데이터 행 파싱 (row 2부터) ───
  for (let r = 2; r < raw.length; r++) {
    const row = raw[r];
    const color = String(row[0] ?? "").trim();

    // 빈 행이나 "합계" 행은 건너뜀
    if (!color || color === "합계") continue;

    for (const { col, size } of sizeColumns) {
      const qty = parseNumber(row[col]);
      results.push({
        model,
        color,
        size,
        qty,
      });
    }
  }

  return results;
}

/**
 * 판매 데이터에서 특정 색상의 판매수량 조회
 * ZZ 우선 로직: 발주요청이 "BLK"면 → "ZZBLK" 먼저 찾고, 없으면 "BLK"
 */
/**
 * 색상에서 접두어(ZZ, JP 등) 제거 → 기본 색상 추출
 * "ZZBLK" → "BLK", "JPBLK" → "BLK", "BLK" → "BLK"
 */
function getBaseColor(color: string): string {
  return color.replace(/^(ZZ|JP|KR|US|EU|CN|HK|TW)/i, "");
}

/**
 * 판매 데이터에서 특정 색상의 판매수량 조회
 * 기본 색상이 같은 모든 변형을 합산
 * 예: 발주양식 "BLK" → ZZBLK + BLK + JPBLK 전부 합산
 */
export function findSalesQty(
  salesData: SalesItem[],
  model: string,
  requestColor: string,
  size: string
): { qty: number; matchedColor: string } {
  const baseColor = getBaseColor(requestColor);

  // 기본 색상이 같은 모든 항목 합산
  let totalQty = 0;
  for (const s of salesData) {
    if (s.model !== model || s.size !== size) continue;
    if (getBaseColor(s.color) === baseColor) {
      totalQty += s.qty;
    }
  }

  return { qty: totalQty, matchedColor: requestColor };
}