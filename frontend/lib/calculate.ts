// lib/calculate.ts
import { SalesItem, StockItem, InboundItem, OrderResult, CalcSettings, PackingInfo, OutOfStockInfo } from "../types";
import { findSalesQty } from "./sales";
import { findStockQty } from "./stock";
import { findInboundQty } from "./inbound";

/**
 * 경과일 계산 (입고일 ~ 현재)
 */
function getElapsedDays(inboundDate: Date): number {
  const now = new Date();
  const diff = now.getTime() - inboundDate.getTime();
  return Math.max(1, Math.floor(diff / (1000 * 60 * 60 * 24))); // 최소 1일
}

/**
 * 단위 반올림
 * 예: qty=274, unit=30 → 270
 * 예: qty=289, unit=30 → 300
 */
function roundToUnit(qty: number, unit: number): number {
  if (unit <= 0) return Math.round(qty);
  const remainder = qty % unit;
  const base = qty - remainder;
  if (remainder >= unit / 2.5) {
    return base + unit;
  }
  return base;
}

/**
 * 발주수량 계산 — 핵심 로직
 *
 * 계산 흐름:
 * 1. 입고일 ~ 현재 경과일 산출
 * 2. 경과기간 동안 판매수량 → 1년 판매예상 환산
 * 3. 성장계수(기본 1.2배) 적용
 * 4. 현재 BMS 재고 차감
 * 5. 단위(기본 30개) 반올림
 * 6. 입고 후 재고가 거의 안 빠졌으면 발주 제외
 *
 * @param model       모델명 "TXP441"
 * @param colors      발주 요청 색상 배열 ["BLK", "CHC", ...]
 * @param sizes       사이즈 배열 ["28W/30L", "30W/30L", ...]
 * @param salesData   판매 데이터 (플랫 변환 완료)
 * @param stockData   BMS 재고 데이터
 * @param inboundData 최근입고 데이터
 * @param settings    계산 설정 (성장계수, 단위, 입고일 등)
 */
export function calculateOrders(
  model: string,
  prefix: string,
  colors: string[],
  sizes: string[],
  salesData: SalesItem[],
  stockData: StockItem[],
  inboundData: InboundItem[],
  settings: CalcSettings,
  packingUnits?: { [size: string]: number },
  outOfStockData?: { [color: string]: { [size: string]: number } },
  seasonType: "allseason" | "season" = "allseason",
  seasonStart: number = 3,
  seasonEnd: number = 10,
  monthlySales: number[] = []
): OrderResult[] {
  const results: OrderResult[] = [];
  const elapsedDays = getElapsedDays(settings.inboundDate);

  for (const color of colors) {
    // ─── 제외 색상 체크 ───
    if (settings.excludeColors.includes(color)) continue;

    for (const size of sizes) {
      // ─── 제외 사이즈 체크 ───
      if (settings.excludeSizes.includes(size)) continue;

      // ─── 1. 판매수량 조회 (ZZ 우선) ───
      const sales = findSalesQty(salesData, model, color, size);

      // ─── 2. BMS 재고 조회 (ZZ + 공용 합산) ───
      const stockQty = findStockQty(stockData, model, color, size);

      // ─── 3. 입고수량 조회 (ZZ 우선) ───
      const inbound = findInboundQty(inboundData, model, color, size);

      // ─── 4. 발주 제외 판단 ───
      let skip = false;
      let skipReason = "";

      // 조건1: 판매수량이 최소 기준 이하
      if (sales.qty <= settings.minSalesThreshold) {
        skip = true;
        skipReason = `판매수량 부족 (${sales.qty}개)`;
      }

      // ─── 5. 발주수량 계산 ───
      let annualEstimate = 0;
      let growthApplied = 0;
      let orderQty = 0;

      if (!skip) {
        // 품절기간 보정
          const outOfStockDays = outOfStockData?.[color]?.[size] ?? 0;

                if (seasonType === "season") {
          // 시즌 월 목록 계산 (예: 3~10월 또는 11~2월 같은 연도 넘기는 경우도 처리)
          const seasonMonthIndices: number[] = [];
          if (seasonStart <= seasonEnd) {
            for (let m = seasonStart; m <= seasonEnd; m++) seasonMonthIndices.push(m - 1);
          } else {
            for (let m = seasonStart; m <= 12; m++) seasonMonthIndices.push(m - 1);
            for (let m = 1; m <= seasonEnd; m++) seasonMonthIndices.push(m - 1);
          }

          const seasonMonthCount = seasonMonthIndices.length;
          const nonSeasonMonthCount = 12 - seasonMonthCount;
          const seasonDays = seasonMonthCount * 30;
          const nonSeasonDays = nonSeasonMonthCount * 30;

          const hasMonthlySales = monthlySales.length === 12 && monthlySales.some((v) => v > 0);

          if (hasMonthlySales) {
            // ─── B방식: 시즌/비시즌 분리 계산 ───
            const totalMonthly = monthlySales.reduce((a, b) => a + b, 0);
            let seasonMonthlyTotal = 0;
            for (const i of seasonMonthIndices) {
              seasonMonthlyTotal += monthlySales[i];
            }
            const nonSeasonMonthlyTotal = totalMonthly - seasonMonthlyTotal;

            const seasonRatio = totalMonthly > 0 ? seasonMonthlyTotal / totalMonthly : 1;
            const nonSeasonRatio = totalMonthly > 0 ? nonSeasonMonthlyTotal / totalMonthly : 0;

            const seasonSalesQty = sales.qty * seasonRatio;
            const nonSeasonSalesQty = sales.qty * nonSeasonRatio;

            // 시즌 계산 (품절기간 = 시즌 내 품절)
            const effectiveSeasonDays = Math.max(1, seasonDays - outOfStockDays);
            const seasonDailyAvg = seasonSalesQty / effectiveSeasonDays;
            const seasonNeed = seasonDailyAvg * seasonDays;

            // 비시즌 계산
            const nonSeasonNeed = nonSeasonDays > 0 ? nonSeasonSalesQty : 0;

            annualEstimate = seasonNeed + nonSeasonNeed;
          } else {
            // ─── A방식: 월별 데이터 없으면 단순 시즌 계산 ───
            const effectiveSellingDays = Math.max(1, seasonDays - outOfStockDays);
            const dailyAvg = sales.qty / effectiveSellingDays;
            annualEstimate = dailyAvg * seasonDays;
          }
        } else {
          // ─── 사계절 상품 계산 ───
          const totalSellingDays = settings.salesMonths * 30;
          const effectiveSellingDays = Math.max(1, totalSellingDays - outOfStockDays);
          const dailyAvg = sales.qty / effectiveSellingDays;
          annualEstimate = dailyAvg * settings.orderMonths * 30;
        }

        // 성장계수 적용
        growthApplied = annualEstimate * settings.growthFactor;

        // 현재 재고 + 입고예정 차감
        const totalAvailableStock = stockQty + inbound.qty;
        const rawOrderQty = growthApplied - totalAvailableStock;

                // 단위 반올림 (사이즈별 패킹단위 우선, 없으면 기본값)
        if (rawOrderQty > 0) {
          const unit = packingUnits?.[size] ?? 1;
          orderQty = roundToUnit(rawOrderQty, unit);
        }

        // 최소 발주수량 체크
        if (orderQty > 0 && orderQty < settings.minOrderQty) {
          orderQty = settings.minOrderQty;
        }

        // 계산 후에도 발주수량이 0이면 제외
        if (orderQty <= 0) {
          skip = true;
          skipReason = "재고 충분 (발주수량 0)";
        }
      }

            results.push({
        fullCode: `${prefix}-${model}-${color}`,
        model,
        color,
        size,
        salesQty: sales.qty,
        inboundQty: inbound.qty,
        stockQty,
        elapsedDays,
        annualEstimate: Math.round(annualEstimate),
        growthApplied: Math.round(growthApplied),
        orderQty,
        skip,
        skipReason,
        outOfStockDays: outOfStockData?.[color]?.[size] ?? 0,
        packingUnit: packingUnits?.[size] ?? 1,
      });
    }
  }

  return results;
}

/**
 * 기본 설정값
 */
export function getDefaultSettings(inboundDate: Date): CalcSettings {
  return {
    inboundDate,
    growthFactor: 1.2,
    minOrderQty: 0,
    excludeColors: [],
    excludeSizes: [],
    minSalesThreshold: 0,
    orderMonths: 12,
    salesMonths: 12,
  };
}