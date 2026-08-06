// lib/stock.ts
import * as XLSX from "xlsx";
import { StockItem } from "../types";
import { isSizeHeader } from "./utils";

/**
 * 재고 숫자 변환: "품절" → 0, 쉼표 제거, 빈값 → 0
 */
function parseStockNumber(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const str = String(value).trim();
  if (str === "품절") return 0;
  const cleaned = str.replace(/,/g, "");
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * BMS 재고 엑셀 파싱
 *
 * 구조 (2행 헤더):
 * Row 0: [이미지, 모델, , PR별칭, ..., 등록일, 총계, 28W/30L, 30W/30L, ...]
 * Row 1: [, 그룹, 모델명, , ..., , , , ...]
 * Row 2+: 데이터
 *
 * 핵심 컬럼:
 * - 그룹 (col 1): "TXP441"
 * - 모델명 (col 2): "CQ-TXP441-ZZBLK"
 * - 사이즈 컬럼들: "xxW/xxL" 패턴으로 자동 감지
 * - 값: 숫자 또는 "품절"(=0)
 */
export function parseStockData(workbook: XLSX.WorkBook): StockItem[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  const results: StockItem[] = [];
  if (raw.length < 3) return results;

  const headerRow = raw[0];
  const subHeaderRow = raw[1];

  // ─── 모델그룹, 모델명 컬럼 찾기 (서브헤더 기준) ───
  let modelGroupCol = -1;
  let modelNameCol = -1;

  for (let i = 0; i < subHeaderRow.length; i++) {
    const val = String(subHeaderRow[i] ?? "").trim();
    if (val === "그룹") modelGroupCol = i;
    if (val === "모델명") modelNameCol = i;
  }

  // 못 찾으면 기본값 (CSV 기준 col 1, 2)
  if (modelGroupCol === -1) modelGroupCol = 1;
  if (modelNameCol === -1) modelNameCol = 2;

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

    // 모델명이 없거나 "CQ-XXX-XXX" 형태가 아니면 건너뜀
    if (!fullCode || !fullCode.includes("-")) continue;

    const modelGroup = String(row[modelGroupCol] ?? "").trim();

    // 색상 코드 추출: "CQ-TXP441-ZZBLK" → "ZZBLK"
    const parts = fullCode.split("-");
    const color = parts[parts.length - 1] || "";

    for (const { col, size } of sizeColumns) {
      const qty = parseStockNumber(row[col]);
      results.push({
        modelGroup,
        fullCode,
        color,
        size,
        qty,
      });
    }
  }

  return results;
}

/**
 * BMS 재고 조회 — ZZ + 공용 합산
 *
 * 발주 요청 "BLK"에 대해:
 *   ZZBLK 재고 (1개) + BLK 재고 (61개) = 총 62개
 *
 * BLK → ZZBLK 재고 이관이 가능하므로 합산해서 본다
 */
export function findStockQty(
  stockData: StockItem[],
  model: string,
  requestColor: string,
  size: string
): number {
  const baseColor = requestColor.replace(/^ZZ/i, "");
  const zzColor = `ZZ${baseColor}`;

  let total = 0;
  for (const item of stockData) {
    if (item.modelGroup !== model) continue;
    if (item.size !== size) continue;
    if (item.color === zzColor || item.color === baseColor) {
      total += item.qty;
    }
  }

  return total;
}