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
  colors: string[],
  sizes: string[],
  salesData: SalesItem[],
  stockData: StockItem[],
  inboundData: InboundItem[],
  settings: CalcSettings,
  packingUnits?: { [size: string]: number },
  outOfStockData?: { [color: string]: { [size: string]: number } }
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
        // 판매데이터 = 최근 1년(365일) 중 품절기간 제외한 실제 판매기간 기준
        const outOfStockMonths = outOfStockData?.[color]?.[size] ?? 0;
        const outOfStockDays = outOfStockMonths * 30;
        const salesPeriodDays = 365; // 판매데이터는 최근 1년
        const effectiveSellingDays = Math.max(1, salesPeriodDays - outOfStockDays);

        // 일평균 = 판매수량 ÷ 실제판매가능일 (1년 기준)
        // 판매예상 = 일평균 × 발주개월수 × 30일
        annualEstimate = (sales.qty / effectiveSellingDays) * (settings.orderMonths * 30);

        // 성장계수 적용
        growthApplied = annualEstimate * settings.growthFactor;

        // 현재 재고 차감
        const rawOrderQty = growthApplied - stockQty;

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
        fullCode: `CQ-${model}-${color}`,
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
        outOfStockMonths: outOfStockData?.[color]?.[size] ?? 0,
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
    orderMonths: 12,           // ← 이 줄 추가 (기본 12개월)
  };
}