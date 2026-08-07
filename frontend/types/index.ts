// types/index.ts

// ─── 기존 (유지) ───
export interface ExcelInfo {
  fileName: string;
  sheetName: string;
  rowCount: number;
  rows: any[];
}

// ─── 판매 데이터 (피벗 → 플랫 변환 후) ───
export interface SalesItem {
  model: string;    // "TXP441" (파일명에서 추출)
  color: string;    // "ZZBLK", "BLK" 등
  size: string;     // "28W/30L"
  qty: number;      // 1기 판매수량
}

// ─── BMS 재고 ───
export interface StockItem {
  modelGroup: string;  // "TXP441"
  fullCode: string;    // "CQ-TXP441-ZZBLK"
  color: string;       // "ZZBLK"
  size: string;        // "28W/30L"
  qty: number;         // 재고수량 (품절 = 0)
}

// ─── 최근 입고 ───
export interface InboundItem {
  modelGroup: string;    // "TXP441"
  fullCode: string;      // "CQ-TXP441-ZZBLK"
  linkedCode: string;    // "CQ-TXP441-BLK" (연결모델명, 없으면 "")
  color: string;         // "ZZBLK"
  isDomestic: boolean;   // 전용상품 = "국내" → true
  size: string;          // "28W/30L"
  qty: number;           // 입고수량
}

// ─── 발주 요청 (빈 양식에서 파싱) ───
export interface OrderRequestItem {
  brand: string;     // "CQ"
  model: string;     // "TXP441"
  color: string;     // "BLK"
  fullCode: string;  // "CQ-TXP441-BLK"
  sizes: string[];   // ["28W/30L", "30W/30L", ...]
}

// ─── 발주 계산 결과 ───
export interface OrderResult {
  fullCode: string;       // "CQ-TXP441-BLK"
  model: string;          // "TXP441"
  color: string;          // "BLK" (발주 요청 기준)
  size: string;           // "28W/30L"
  salesQty: number;       // 판매수량 (1기)
  inboundQty: number;     // 입고수량
  stockQty: number;       // BMS 재고 (ZZ+공용 합산)
  elapsedDays: number;    // 입고일~현재 경과일
  annualEstimate: number; // 1년 판매예상
  growthApplied: number;  // 성장계수 적용 후
  orderQty: number;       // 최종 발주수량 (단위 반올림)
  skip: boolean;          // 발주 제외 여부
  skipReason?: string;    // 제외 사유
  outOfStockMonths: number;   // ← 추가
  packingUnit: number;        // ← 추가
}

// ─── 계산 설정 (사용자 조정 가능) ───
export interface CalcSettings {
  inboundDate: Date;          // 최근 입고일 (사용자 입력)
  growthFactor: number;       // 성장계수 (기본 1.2)
  minOrderQty: number;        // 최소 발주수량 (기본 0)
  excludeColors: string[];    // 제외 색상
  excludeSizes: string[];     // 제외 사이즈
  minSalesThreshold: number;  // 최소 판매량 이하 제외 (기본 0)
  orderMonths: number;        // ← 이 줄 추가 (발주 개월수)
  salesMonths: number;  // ← 추가
}

// ─── 입고 파일 + 날짜 쌍 ───
export interface InboundFileEntry {
  file: File;
  date: string; // "2025-12-24" 형식
}

// ─── 패킹 단위 (모델+사이즈별) ───
export interface PackingInfo {
  model: string;
  sizes: string[];
  units: { [size: string]: number }; // 사이즈별 패킹단위
}

// ─── 품절기간 (모델별 색상×사이즈) ───
export interface OutOfStockInfo {
  model: string;
  colors: string[];
  sizes: string[];
  data: { [color: string]: { [size: string]: number } }; // 개월 단위
}

// ─── 저장된 발주 결과 ───
export interface SavedResult {
  id: string;
  name: string;
  savedAt: string;
  results: OrderResult[];
  growthFactor: number;
  orderMonths: number;
  summary: {
    sales: number;
    stock: number;
    inbound: number;
    orders: number;
  };
}