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
 * 특정 월이 시즌 기간인지 판별
 */
function isInSeason(month: number, seasonStart: number, seasonEnd: number): boolean {
  if (seasonStart <= seasonEnd) {
    return month >= seasonStart && month <= seasonEnd;
  }
  return month >= seasonStart || month <= seasonEnd;
}

/**
 * 재고 시뮬레이션: startDate → endDate 까지 일별 재고 추적
 * - 매일 시즌/비시즌 일평균만큼 차감
 * - 입고 스케줄 도착일에 수량 추가
 * - 재고 0 이하면 0 유지
 */
function simulateRemainingStock(
  currentStock: number,
  schedule: { date: Date; qty: number }[],
  seasonDailyAvg: number,
  offSeasonDailyAvg: number,
  seasonStart: number,
  seasonEnd: number,
  startDate: Date,
  endDate: Date
): number {
  let stock = currentStock;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current < end) {
    for (const s of schedule) {
      const d = new Date(s.date);
      d.setHours(0, 0, 0, 0);
      if (current.getTime() === d.getTime()) {
        stock += s.qty;
      }
    }

    const month = current.getMonth() + 1;
    const avg = isInSeason(month, seasonStart, seasonEnd)
      ? seasonDailyAvg
      : offSeasonDailyAvg;
    stock = Math.max(0, stock - avg);

    current.setDate(current.getDate() + 1);
  }

  return Math.max(0, Math.round(stock));
}

/**
 * 커버 기간 필요수량: startDate → endDate 까지 일별 필요량 합산
 */
function calculateCoverNeed(
  seasonDailyAvg: number,
  offSeasonDailyAvg: number,
  seasonStart: number,
  seasonEnd: number,
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current < end) {
    const month = current.getMonth() + 1;
    total += isInSeason(month, seasonStart, seasonEnd)
      ? seasonDailyAvg
      : offSeasonDailyAvg;
    current.setDate(current.getDate() + 1);
  }

  return Math.round(total);
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
  monthlySales: number[] = [],
  inboundSchedule: { date: Date; model: string; color: string; size: string; qty: number }[] = []
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
      let remainingStock = stockQty;
      let coverNeedValue = 0;

      if (!skip) {
        const outOfStockDays = outOfStockData?.[color]?.[size] ?? 0;

        // ─── 일평균 계산 (시즌/비시즌) ───
        let seasonDailyAvg = 0;
        let offSeasonDailyAvg = 0;

        if (seasonType === "season") {
          const seasonMonthIndices: number[] = [];
          if (seasonStart <= seasonEnd) {
            for (let m = seasonStart; m <= seasonEnd; m++) seasonMonthIndices.push(m - 1);
          } else {
            for (let m = seasonStart; m <= 12; m++) seasonMonthIndices.push(m - 1);
            for (let m = 1; m <= seasonEnd; m++) seasonMonthIndices.push(m - 1);
          }

          const seasonMonthCount = seasonMonthIndices.length;
          const nonSeasonMonthCount = 12 - seasonMonthCount;
          const sDays = seasonMonthCount * 30;
          const nsDays = nonSeasonMonthCount * 30;

          const hasMonthlySales = monthlySales.length === 12 && monthlySales.some((v) => v > 0);

          if (hasMonthlySales) {
            const totalMonthly = monthlySales.reduce((a, b) => a + b, 0);
            let seasonMonthlyTotal = 0;
            for (const i of seasonMonthIndices) seasonMonthlyTotal += monthlySales[i];
            const nonSeasonMonthlyTotal = totalMonthly - seasonMonthlyTotal;

            const seasonRatio = totalMonthly > 0 ? seasonMonthlyTotal / totalMonthly : 1;
            const nonSeasonRatio = totalMonthly > 0 ? nonSeasonMonthlyTotal / totalMonthly : 0;

            const seasonSalesQty = sales.qty * seasonRatio;
            const nonSeasonSalesQty = sales.qty * nonSeasonRatio;

            const effectiveSeasonDays = Math.max(1, sDays - outOfStockDays);
            seasonDailyAvg = seasonSalesQty / effectiveSeasonDays;
            offSeasonDailyAvg = nsDays > 0 ? nonSeasonSalesQty / nsDays : 0;
          } else {
            const effectiveSeasonDays = Math.max(1, sDays - outOfStockDays);
            seasonDailyAvg = sales.qty / effectiveSeasonDays;
            offSeasonDailyAvg = 0;
          }
        } else {
          // 사계절 상품
          const totalSellingDays = settings.salesMonths * 30;
          const effectiveSellingDays = Math.max(1, totalSellingDays - outOfStockDays);
          const dailyAvg = sales.qty / effectiveSellingDays;
          seasonDailyAvg = dailyAvg;
          offSeasonDailyAvg = dailyAvg;
        }

        // ─── 재고 시뮬레이션: 오늘 → 발주 입고일 ───
        const baseColor = color.replace(/^(ZZ|JP|KR|US|EU|CN|HK|TW)/i, "");
        const relevantSchedule = inboundSchedule
          .filter(ib => ib.model === model && ib.size === size &&
            ib.color.replace(/^(ZZ|JP|KR|US|EU|CN|HK|TW)/i, "") === baseColor)
          .map(ib => ({ date: ib.date, qty: ib.qty }));

        remainingStock = simulateRemainingStock(
          stockQty, relevantSchedule,
          seasonDailyAvg, offSeasonDailyAvg,
          seasonStart, seasonEnd,
          new Date(), settings.orderDeliveryDate
        );

        // ─── 커버 기간 필요수량: 발주 입고일 → 커버 종료일 ───
        coverNeedValue = calculateCoverNeed(
          seasonDailyAvg, offSeasonDailyAvg,
          seasonStart, seasonEnd,
          settings.orderDeliveryDate, settings.coverEndDate
        );

        annualEstimate = coverNeedValue;
        growthApplied = Math.round(coverNeedValue * settings.growthFactor);

        const rawOrderQty = growthApplied - remainingStock;

        // 단위 반올림
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
        remainingStockAtDelivery: remainingStock,
        coverNeed: coverNeedValue,
      });
    }
  }

  return results;
}

/**
 * 기본 설정값
 */
export function getDefaultSettings(inboundDate: Date): CalcSettings {
  const deliveryDate = new Date();
  deliveryDate.setMonth(deliveryDate.getMonth() + 1);
  const coverEnd = new Date(deliveryDate);
  coverEnd.setMonth(coverEnd.getMonth() + 12);

  return {
    inboundDate,
    growthFactor: 1.2,
    minOrderQty: 0,
    excludeColors: [],
    excludeSizes: [],
    minSalesThreshold: 0,
    orderMonths: 12,
    salesMonths: 12,
    orderDeliveryDate: deliveryDate,
    coverEndDate: coverEnd,
  };
}