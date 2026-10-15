// lib/stockHistory.ts
import * as XLSX from "xlsx";

interface StockRecord {
  fullCode: string;
  model: string;
  color: string;
  size: string;
  date: Date;
  qty: number;
}

/**
 * 재고이력 엑셀 파싱
 * 컬럼: 모델명(풀코드), 단품명(사이즈), 현재고, 재고변동일자, 재고수량
 */
function parseStockHistory(workbook: XLSX.WorkBook): StockRecord[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  const records: StockRecord[] = [];
  if (raw.length < 2) return records;

  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];
    const fullCode = String(row[0] ?? "").trim();
    const size = String(row[1] ?? "").trim();
    const dateVal = row[3];
    const qty = Number(row[4]) || 0;

    if (!fullCode || !fullCode.includes("-") || !size) continue;

    const parts = fullCode.split("-");
    const model = parts[1] || "";
    const color = parts.slice(2).join("-") || "";

    let date: Date;
    if (typeof dateVal === "number") {
      date = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
    } else {
      date = new Date(String(dateVal));
    }
    if (isNaN(date.getTime())) continue;

    records.push({ fullCode, model, color, size, date, qty });
  }

  return records;
}

/**
 * 품절기간 자동 계산
 * 
 * @param workbook 재고이력 엑셀
 * @param seasonStart 시즌 시작월 (1~12), null이면 전체 기간
 * @param seasonEnd 시즌 종료월 (1~12)
 * @param salesMonths 판매데이터 기간 (개월)
 * @returns 모델 > 색상 > 사이즈 > 품절개월수
 */
export function calculateOutOfStock(
  workbook: XLSX.WorkBook,
  seasonStart: number | null,
  seasonEnd: number | null,
  salesMonths: number = 12
): { [model: string]: { [color: string]: { [size: string]: number } } } {
  const records = parseStockHistory(workbook);
  if (records.length === 0) return {};

  // 모델+색상+사이즈별 그룹핑
  const groups = new Map<string, StockRecord[]>();
  for (const rec of records) {
    const key = `${rec.model}||${rec.color}||${rec.size}`;
    const list = groups.get(key) || [];
    list.push(rec);
    groups.set(key, list);
  }

  const result: { [model: string]: { [color: string]: { [size: string]: number } } } = {};

  for (const [key, recs] of groups) {
    const [model, color, size] = key.split("||");

    // 날짜순 정렬
    recs.sort((a, b) => a.date.getTime() - b.date.getTime());

    // 품절(재고=0) 일수 계산
    let outOfStockDays = 0;

    for (let i = 0; i < recs.length - 1; i++) {
      if (recs[i].qty === 0) {
        const start = recs[i].date;
        const end = recs[i + 1].date;
        const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);

        // 시즌 필터링
        if (seasonStart !== null && seasonEnd !== null) {
          // 시즌 기간에 해당하는 일수만 카운트
          let current = new Date(start);
          while (current < end) {
            const month = current.getMonth() + 1; // 1~12
            let inSeason = false;
            if (seasonStart <= seasonEnd) {
              inSeason = month >= seasonStart && month <= seasonEnd;
            } else {
              inSeason = month >= seasonStart || month <= seasonEnd;
            }
            if (inSeason) outOfStockDays++;
            current.setDate(current.getDate() + 1);
          }
        } else {
          outOfStockDays += days;
        }
      }
    }

    // 마지막 레코드가 0이면 현재까지 품절
    const lastRec = recs[recs.length - 1];
    if (lastRec.qty === 0) {
      const start = lastRec.date;
      const end = new Date();

      if (seasonStart !== null && seasonEnd !== null) {
        let current = new Date(start);
        while (current < end) {
          const month = current.getMonth() + 1;
          let inSeason = false;
          if (seasonStart <= seasonEnd) {
            inSeason = month >= seasonStart && month <= seasonEnd;
          } else {
            inSeason = month >= seasonStart || month <= seasonEnd;
          }
          if (inSeason) outOfStockDays++;
          current.setDate(current.getDate() + 1);
        }
      } else {
        outOfStockDays += (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      }
    }

    // 일수 → 개월 (반올림)
        if (!result[model]) result[model] = {};
    if (!result[model][color]) result[model][color] = {};
    result[model][color][size] = Math.round(outOfStockDays);
  }

  return result;
}