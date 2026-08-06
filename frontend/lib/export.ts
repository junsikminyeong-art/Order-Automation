// lib/export.ts
import * as XLSX from "xlsx";
import { OrderResult } from "../types";

/**
 * 발주 엑셀 다운로드
 * 시트1: 발주결과 (회사 제출용 양식)
 * 시트2: 보고서 (발주 근거 보고용)
 * 시트3: 상세내역 (계산 과정 확인용)
 */
export function exportOrderExcel(
  results: OrderResult[],
  fileName: string = "발주결과"
): void {
  const workbook = XLSX.utils.book_new();

  // ─── 시트1: 발주결과 (양식 형태) ───
  buildOrderSheet(workbook, results);

  // ─── 시트2: 보고서 (발주 근거) ───
  buildReportSheet(workbook, results);

  // ─── 시트3: 상세내역 (계산 과정) ───
  buildDetailSheet(workbook, results);

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

// ═══════════════════════════════════════
// 시트1: 발주결과
// ═══════════════════════════════════════
function buildOrderSheet(workbook: XLSX.WorkBook, results: OrderResult[]): void {
  const orderData: any[][] = [];
  const modelGroups = groupByModel(results);

  let isFirst = true;
  for (const [model, items] of modelGroups) {
    if (!isFirst) orderData.push([]);
    isFirst = false;

    const sizes = getUniqueSizes(items);
    orderData.push(["Color", ...sizes]);

    const colorGroups = groupByColor(items);
    for (const [color, colorItems] of colorGroups) {
      const fullCode = colorItems[0]?.fullCode || `CQ-${model}-${color}`;
      const row: any[] = [fullCode];
      for (const size of sizes) {
        const item = colorItems.find((i) => i.size === size);
        if (!item || item.skip || item.orderQty <= 0) {
          row.push("");
        } else {
          row.push(item.orderQty);
        }
      }
      orderData.push(row);
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet(orderData);
  sheet["!cols"] = [{ wch: 22 }, ...orderData[0]?.slice(1).map(() => ({ wch: 10 })) || []];
  XLSX.utils.book_append_sheet(workbook, sheet, "발주결과");
}

// ═══════════════════════════════════════
// 시트2: 보고서 (발주 근거)
// ═══════════════════════════════════════
function buildReportSheet(workbook: XLSX.WorkBook, results: OrderResult[]): void {
  const data: any[][] = [];

  // ─── 1. 발주 설정 정보 ───
  const firstResult = results[0];
  data.push(["📋 발주 보고서"]);
  data.push([]);
  data.push(["[발주 설정]"]);
  data.push(["계산 기준일", new Date().toLocaleDateString("ko-KR")]);
  data.push(["경과일", firstResult?.elapsedDays ? `${firstResult.elapsedDays}일` : "-"]);
  data.push([]);

  // ─── 2. 모델별 총괄 요약 ───
  data.push(["[모델별 발주 총괄]"]);
  data.push([
    "모델",
    "총 판매(1기)",
    "총 입고수량",
    "현재 총 재고",
    "평균 소진율",
    "발주 항목수",
    "총 발주수량",
  ]);

  const modelGroups = groupByModel(results);
  for (const [model, items] of modelGroups) {
    const totalSales = items.reduce((s, r) => s + r.salesQty, 0);
    const totalInbound = items.reduce((s, r) => s + r.inboundQty, 0);
    const totalStock = items.reduce((s, r) => s + r.stockQty, 0);
    const totalOrder = items.filter((r) => !r.skip).reduce((s, r) => s + r.orderQty, 0);
    const orderCount = items.filter((r) => !r.skip && r.orderQty > 0).length;

    // 소진율 = (입고 - 재고) / 입고
    const sellThrough = totalInbound > 0
      ? Math.round(((totalInbound - totalStock) / totalInbound) * 100)
      : 0;

    data.push([
      model,
      totalSales,
      totalInbound,
      totalStock,
      `${sellThrough}%`,
      `${orderCount}건`,
      totalOrder,
    ]);
  }

  data.push([]);
  data.push([]);

  // ─── 3. 모델별 색상 비교표 ───
  for (const [model, items] of modelGroups) {
    data.push([`[${model} 색상별 분석]`]);
    data.push([
      "색상",
      "판매(1기)",
      "입고수량",
      "현재재고",
      "소진율",
      "1년판매예상",
      "성장계수적용",
      "발주수량",
      "판단",
    ]);

    // 색상별 합산
    const colorMap = new Map<string, {
      sales: number;
      inbound: number;
      stock: number;
      annual: number;
      growth: number;
      order: number;
      skipCount: number;
      totalCount: number;
    }>();

    for (const r of items) {
      const existing = colorMap.get(r.color) || {
        sales: 0, inbound: 0, stock: 0,
        annual: 0, growth: 0, order: 0,
        skipCount: 0, totalCount: 0,
      };
      existing.sales += r.salesQty;
      existing.inbound += r.inboundQty;
      existing.stock += r.stockQty;
      existing.annual += r.annualEstimate;
      existing.growth += r.growthApplied;
      existing.order += r.skip ? 0 : r.orderQty;
      existing.skipCount += r.skip ? 1 : 0;
      existing.totalCount += 1;
      colorMap.set(r.color, existing);
    }

    // 판매 많은 순으로 정렬
    const sortedColors = [...colorMap.entries()].sort(
      (a, b) => b[1].sales - a[1].sales
    );

    for (const [color, info] of sortedColors) {
      const sellThrough = info.inbound > 0
        ? Math.round(((info.inbound - info.stock) / info.inbound) * 100)
        : 0;

      let judgment = "";
      if (info.order > 0 && sellThrough >= 80) judgment = "✅ 인기 (발주 권장)";
      else if (info.order > 0 && sellThrough >= 50) judgment = "⭕ 보통 (발주 진행)";
      else if (info.order > 0) judgment = "△ 소진 느림 (발주 소량)";
      else if (sellThrough < 20 && info.sales > 0) judgment = "⚠️ 재고 소진 느림 (발주 제외)";
      else if (info.sales === 0) judgment = "❌ 판매 없음 (발주 제외)";
      else judgment = "➖ 재고 충분 (발주 불필요)";

      data.push([
        color,
        info.sales,
        info.inbound,
        info.stock,
        `${sellThrough}%`,
        info.annual,
        info.growth,
        info.order,
        judgment,
      ]);
    }

    data.push([]);

    // ─── 4. 사이즈별 상세 (피벗 형태) ───
    data.push([`[${model} 사이즈별 발주수량]`]);

    const sizes = getUniqueSizes(items);
    const colorGroups = groupByColor(items);

    // 헤더
    data.push(["색상", ...sizes, "합계"]);

    // 판매수량 표
    data.push(["── 판매수량(1기) ──"]);
    for (const [color, colorItems] of colorGroups) {
      const row: any[] = [color];
      let colorTotal = 0;
      for (const size of sizes) {
        const item = colorItems.find((i) => i.size === size);
        const qty = item?.salesQty || 0;
        row.push(qty || "");
        colorTotal += qty;
      }
      row.push(colorTotal);
      data.push(row);
    }

    data.push([]);

    // 발주수량 표
    data.push(["── 발주수량 ──"]);
    for (const [color, colorItems] of colorGroups) {
      const row: any[] = [color];
      let colorTotal = 0;
      for (const size of sizes) {
        const item = colorItems.find((i) => i.size === size);
        const qty = item && !item.skip ? item.orderQty : 0;
        row.push(qty || "");
        colorTotal += qty;
      }
      row.push(colorTotal);
      data.push(row);
    }

    data.push([]);

    // 재고 표
    data.push(["── 현재 BMS 재고 ──"]);
    for (const [color, colorItems] of colorGroups) {
      const row: any[] = [color];
      let colorTotal = 0;
      for (const size of sizes) {
        const item = colorItems.find((i) => i.size === size);
        const qty = item?.stockQty || 0;
        row.push(qty || "");
        colorTotal += qty;
      }
      row.push(colorTotal);
      data.push(row);
    }

    data.push([]);
    data.push([]);
  }

  // ─── 5. 발주 제외 사유 요약 ───
  data.push(["[발주 제외 항목 요약]"]);
  data.push(["모델코드", "색상", "사이즈", "제외 사유"]);

  const skippedWithReason = results.filter((r) => r.skip && r.skipReason);
  // 같은 사유끼리 묶어서 표시 (사이즈별로 일일이 안 보여주고 색상 단위로 대표)
  const skipSummary = new Map<string, Set<string>>();
  for (const r of skippedWithReason) {
    const key = `${r.fullCode}||${r.skipReason}`;
    const sizes = skipSummary.get(key) || new Set();
    sizes.add(r.size);
    skipSummary.set(key, sizes);
  }

  for (const [key, sizes] of skipSummary) {
    const [code, reason] = key.split("||");
    const sizeText = sizes.size > 3
      ? `${[...sizes].slice(0, 3).join(", ")} 외 ${sizes.size - 3}건`
      : [...sizes].join(", ");
    data.push([code, "", sizeText, reason]);
  }

  // 시트 생성
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [
    { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
    { wch: 28 },
  ];

  // 제목 행 병합 (선택사항)
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }, // 보고서 제목
  ];

  XLSX.utils.book_append_sheet(workbook, sheet, "보고서");
}

// ═══════════════════════════════════════
// 시트3: 상세내역
// ═══════════════════════════════════════
function buildDetailSheet(workbook: XLSX.WorkBook, results: OrderResult[]): void {
  const detailData: any[][] = [
    [
      "모델코드", "모델", "색상", "사이즈",
      "판매수량(1기)", "입고수량", "BMS재고(합산)",
      "경과일", "1년판매예상", "성장계수적용",
      "발주수량", "제외여부", "제외사유",
    ],
  ];
  for (const r of results) {
    detailData.push([
      r.fullCode, r.model, r.color, r.size,
      r.salesQty, r.inboundQty, r.stockQty,
      r.elapsedDays, r.annualEstimate, r.growthApplied,
      r.orderQty, r.skip ? "제외" : "", r.skipReason || "",
    ]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(detailData);
  sheet["!cols"] = [
    { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 8 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 },
    { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "상세내역");
}

// ═══════════════════════════════════════
// 유틸 함수들
// ═══════════════════════════════════════

function groupByModel(results: OrderResult[]): Map<string, OrderResult[]> {
  const map = new Map<string, OrderResult[]>();
  for (const r of results) {
    const list = map.get(r.model) || [];
    list.push(r);
    map.set(r.model, list);
  }
  return map;
}

function groupByColor(results: OrderResult[]): Map<string, OrderResult[]> {
  const map = new Map<string, OrderResult[]>();
  for (const r of results) {
    const list = map.get(r.color) || [];
    list.push(r);
    map.set(r.color, list);
  }
  return map;
}

function getUniqueSizes(results: OrderResult[]): string[] {
  const seen = new Set<string>();
  const sizes: string[] = [];
  for (const r of results) {
    if (!seen.has(r.size)) {
      seen.add(r.size);
      sizes.push(r.size);
    }
  }
  return sizes;
}