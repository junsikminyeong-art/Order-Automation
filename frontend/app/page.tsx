"use client";

import Sidebar from "../components/Sidebar";
import { saveResultToCloud } from "../lib/firebase";
import { SavedResult } from "../types";
import { useState } from "react";
import * as XLSX from "xlsx";
import FileDrop from "../components/FileDrop";
import MultiFileDrop from "../components/MultiFileDrop";
import Report from "../components/Report";
import { parseSalesData } from "../lib/sales";
import { parseStockData } from "../lib/stock";
import { parseInboundData } from "../lib/inbound";
import { calculateOutOfStock } from "../lib/stockHistory";
import { calculateOrders, getDefaultSettings } from "../lib/calculate";
import { exportOrderExcel } from "../lib/export";
import { isSizeHeader } from "../lib/utils";
import { SalesItem, StockItem, InboundItem, OrderResult, PackingInfo, OutOfStockInfo, SeasonInfo } from "../types";

export default function Home() {
  // ─── 파일 상태 ───
  const [salesFiles, setSalesFiles] = useState<File[]>([]);
  const [stockFile, setStockFile] = useState<File | null>(null);
  const [inFiles, setInFiles] = useState<File[]>([]);
  const [orderFile, setOrderFile] = useState<File | null>(null);

  // ─── 입고일 (파일별) ───
  const [inDates, setInDates] = useState<string[]>([]);
    const [noInbound, setNoInbound] = useState(false);

  // ─── 계산 설정 ───
  const [growthFactor, setGrowthFactor] = useState<number>(1.2);
  const [orderMonths, setOrderMonths] = useState<number>(12);
  const [salesMonths, setSalesMonths] = useState<number>(12);  // ← 추가

  // ─── 패킹 단위 ───
  const [packingInfos, setPackingInfos] = useState<PackingInfo[]>([]);

  // ─── 품절기간 ───
  const [outOfStockInfos, setOutOfStockInfos] = useState<OutOfStockInfo[]>([]);

    // ─── 시즌 정보 ───
  const [seasonInfos, setSeasonInfos] = useState<SeasonInfo[]>([]);

  // ─── 메모 ───
  const [memo, setMemo] = useState("");

  // ─── 보고서 ───
  const [showReport, setShowReport] = useState(false);

    // ─── 저장 ───
  const [saveTrigger, setSaveTrigger] = useState(0);

    // ─── 현재 사용자 ───
  const [currentUser, setCurrentUser] = useState("최준식");

    // ─── 저장된 결과 보기 모드 ───
  const [viewingMode, setViewingMode] = useState(false);
  const [viewingName, setViewingName] = useState("");

  // ─── 결과 상태 ───
  const [results, setResults] = useState<OrderResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // ─── 파싱 요약 ───
  const [summary, setSummary] = useState<{
    sales: number;
    stock: number;
    inbound: number;
    orders: number;
  } | null>(null);

    // ─── TIP 팝업 ───
  const [showTip, setShowTip] = useState(false);

  const canCalculate =
    salesFiles.length > 0 &&
    stockFile &&
    orderFile;

  // ─── 발주 요청 파일 업로드 시 즉시 파싱 ───
    const handleOrderFileChange = async (file: File | null) => {
    setOrderFile(file);
    setPackingInfos([]);
    setOutOfStockInfos([]);

    if (!file) return;

    try {
      const wb = await readWorkbook(file);
      const requests = parseOrderRequest(wb);

      // 패킹단위 초기화
      const infos: PackingInfo[] = requests.map((req) => ({
        model: req.model,
        sizes: req.sizes,
        units: req.sizes.reduce((acc, size) => {
          acc[size] = 30;
          return acc;
        }, {} as { [size: string]: number }),
      }));
      setPackingInfos(infos);

      // 품절기간 초기화 (전부 0개월)
      const oosInfos: OutOfStockInfo[] = requests.map((req) => ({
        model: req.model,
        colors: req.colors,
        sizes: req.sizes,
        data: req.colors.reduce((acc, color) => {
          acc[color] = req.sizes.reduce((sAcc, size) => {
            sAcc[size] = 0;
            return sAcc;
          }, {} as { [size: string]: number });
          return acc;
        }, {} as { [color: string]: { [size: string]: number } }),
      }));
      setOutOfStockInfos(oosInfos);
            // 시즌 정보 초기화 (기본: 사계절)
      const sInfos: SeasonInfo[] = requests.map((req) => ({
        model: req.model,
        type: "allseason" as const,
        seasonStart: 3,
        seasonEnd: 10,
        salesMonths: 12,
        monthlySales: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      }));
      setSeasonInfos(sInfos);
    } catch (err) {
      console.error("발주 요청 파일 파싱 오류:", err);
    }
  };

  // ─── 특정 모델의 전체 사이즈 패킹단위 일괄 변경 ───
  const updateAllUnits = (modelIndex: number, value: number) => {
    setPackingInfos((prev) => {
      const updated = [...prev];
      const info = { ...updated[modelIndex] };
      info.units = { ...info.units };
      for (const size of info.sizes) {
        info.units[size] = value;
      }
      updated[modelIndex] = info;
      return updated;
    });
  };

  // ─── 특정 사이즈 패킹단위 개별 변경 ───
  const updateSizeUnit = (modelIndex: number, size: string, value: number) => {
    setPackingInfos((prev) => {
      const updated = [...prev];
      const info = { ...updated[modelIndex] };
      info.units = { ...info.units, [size]: value };
      updated[modelIndex] = info;
      return updated;
    });
  };

    // ─── 품절기간: 전체 일괄 변경 ───
  const updateAllOOS = (modelIndex: number, value: number) => {
    setOutOfStockInfos((prev) => {
      const updated = [...prev];
      const info = { ...updated[modelIndex] };
      info.data = { ...info.data };
      for (const color of info.colors) {
        info.data[color] = { ...info.data[color] };
        for (const size of info.sizes) {
          info.data[color][size] = value;
        }
      }
      updated[modelIndex] = info;
      return updated;
    });
  };

  // ─── 품절기간: 색상별 일괄 변경 ───
  const updateColorOOS = (modelIndex: number, color: string, value: number) => {
    setOutOfStockInfos((prev) => {
      const updated = [...prev];
      const info = { ...updated[modelIndex] };
      info.data = { ...info.data };
      info.data[color] = { ...info.data[color] };
      for (const size of info.sizes) {
        info.data[color][size] = value;
      }
      updated[modelIndex] = info;
      return updated;
    });
  };

  // ─── 품절기간: 개별 변경 ───
  const updateSizeOOS = (modelIndex: number, color: string, size: string, value: number) => {
    setOutOfStockInfos((prev) => {
      const updated = [...prev];
      const info = { ...updated[modelIndex] };
      info.data = { ...info.data };
      info.data[color] = { ...info.data[color], [size]: value };
      updated[modelIndex] = info;
      return updated;
    });
  };

  // ─── 저장된 결과 불러오기 ───
  const handleLoadSaved = (saved: SavedResult) => {
    setResults(saved.results);
    setSummary(saved.summary);
    setMemo(saved.memo || "");
    setOrderMonths(saved.orderMonths || 12);
    setGrowthFactor(saved.growthFactor || 1.2);
    setViewingMode(true);
    setViewingName(saved.name);
  };

    // ─── 뒤로가기 (메인 화면으로) ───
  const handleBack = () => {
    setViewingMode(false);
    setViewingName("");
    setResults(null);
    setSummary(null);
  };

  // ─── 결과 저장 ───
  const handleSaveResult = async () => {
    if (!results || !summary) return;

    const name = prompt("저장할 이름을 입력하세요 (예: 20260805)");
    if (!name) return;

    try {
            await saveResultToCloud({
        userName: currentUser,
        name,
        savedAt: new Date().toLocaleString("ko-KR"),
        results,
        growthFactor,
        orderMonths,
        memo,
        summary,
      });
      setSaveTrigger((prev) => prev + 1);
      alert(`"${name}" 저장 완료!`);
    } catch (err) {
      console.error("저장 실패:", err);
      alert("저장에 실패했습니다.");
    }
  };

  // ─── 발주 계산 실행 ───
  const handleCalculate = async () => {
    if (salesFiles.length === 0 || !stockFile || !orderFile) return;

    setLoading(true);
    setError("");
    setResults(null);
    setSummary(null);

    try {
      const [salesWorkbooks, stockWb, inboundWorkbooks, orderWb] = await Promise.all([
        Promise.all(salesFiles.map((f) => readWorkbook(f))),
        readWorkbook(stockFile),
        Promise.all(inFiles.map((f) => readWorkbook(f))),
        readWorkbook(orderFile),
      ]);

      const salesData: SalesItem[] = [];
      salesWorkbooks.forEach((wb, i) => {
        salesData.push(...parseSalesData(wb, salesFiles[i].name));
      });

      const stockData: StockItem[] = parseStockData(stockWb);

      // ─── 최근 입고 파싱 ───
      const inboundData: InboundItem[] = [];
      const inboundDateMap = new Map<string, Date>();

      inboundWorkbooks.forEach((wb, i) => {
        const items = parseInboundData(wb);
        inboundData.push(...items);

        const fileDate = new Date(inDates[i]);
        items.forEach((item) => {
          if (item.modelGroup) {
            inboundDateMap.set(item.modelGroup, fileDate);
          }
        });
      });

      const orderRequests = parseOrderRequest(orderWb);

      const allResults: OrderResult[] = [];

      for (const request of orderRequests) {
        const modelDate = inboundDateMap.get(request.model) || new Date();

        const settings = getDefaultSettings(modelDate);
        settings.growthFactor = growthFactor;
        settings.orderMonths = orderMonths;
        const modelPacking = packingInfos.find((p) => p.model === request.model);

                // 해당 모델의 품절기간 데이터 찾기
        const modelOOS = outOfStockInfos.find((o) => o.model === request.model);
        const modelSeason = seasonInfos.find((s) => s.model === request.model);
        settings.salesMonths = modelSeason?.salesMonths || 12;

        const modelResults = calculateOrders(
          request.model,
          request.prefix,
          request.colors,
          request.sizes,
          salesData,
          stockData,
          inboundData,
          settings,
          modelPacking?.units,
          modelOOS?.data,
          modelSeason?.type || "allseason",
          modelSeason?.seasonStart || 3,
          modelSeason?.seasonEnd || 10,
          modelSeason?.monthlySales || []
        );
        allResults.push(...modelResults);
      }

      setResults(allResults);
      setSummary({
        sales: salesData.length,
        stock: stockData.length,
        inbound: inboundData.length,
        orders: allResults.filter((r) => !r.skip && r.orderQty > 0).length,
      });
    } catch (err: any) {
      setError(err.message || "계산 중 오류가 발생했습니다.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

    return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center py-10">

      {/* 사이드바 */}
      <Sidebar
        currentUser={currentUser}
        onUserChange={setCurrentUser}
        onLoad={handleLoadSaved}
        refreshTrigger={saveTrigger}
/>

      {/* TIP 버튼 */}
      <button
        onClick={() => setShowTip(true)}
        className="fixed top-4 right-4 z-40 px-4 py-2 bg-yellow-500
                   hover:bg-yellow-600 text-white font-bold rounded-lg
                   shadow-lg transition"
      >
        💡 TIP
      </button>

      {/* TIP 팝업 */}
      {showTip && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto">
          <div className="min-h-screen py-8 px-4">
            <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl p-8">
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">💡 사용 가이드</h1>
                <button
                  onClick={() => setShowTip(false)}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold transition"
                >
                  ✕ 닫기
                </button>
              </div>
              <div className="space-y-8 text-sm leading-relaxed">
                <section>
                  <h2 className="text-lg font-bold mb-2">📊 판매데이터 (여러 모델 업로드 가능)</h2>
                  <p className="text-gray-700 mb-2">판매데이터 파일은 <b>지정한 기간 동안 판매된 수량(1기 기준)</b>을 집계하기 위한 파일입니다.</p>
                  <ul className="list-disc pl-5 text-gray-600 space-y-1">
                    <li>여러 모델을 한 번에 업로드할 수 있습니다.</li>
                    <li>발주수량 계산의 기준이 되는 가장 중요한 데이터입니다.</li>
                    <li>발주모델 색상이 예를들어 ZZBLK인 경우, 1기 기준 ZZBLK + BLK + JPBLK 판매수량을 합산하여 집계합니다.</li>
                  </ul>
                </section>
                <hr />
                <section>
                  <h2 className="text-lg font-bold mb-2">📦 BMS 재고</h2>
                  <p className="text-gray-700 mb-2">현재 <b>BMS에 남아있는 재고 수량</b>을 불러오기 위한 파일입니다.</p>
                  <ul className="list-disc pl-5 text-gray-600 space-y-1">
                    <li>현재 보유 재고를 확인하여 발주수량 계산에 활용됩니다.</li>
                  </ul>
                </section>
                <hr />
                <section>
                  <h2 className="text-lg font-bold mb-2">📦 미래 입고 예정 (여러 파일 업로드 가능)</h2>
                  <p className="text-gray-700 mb-2">현재 발주 물량이 입고되기 전에 들어오는 <b>입고 예정 수량</b>을 반영하기 위한 파일입니다.</p>
                  <ul className="list-disc pl-5 text-gray-600 space-y-1">
                    <li>입고 예정 수량은 <b>현재 재고에 합산</b>되어 발주수량 계산에 반영됩니다.</li>
                    <li>예: 현재재고 3,000개 + 입고예정 2,000개 = 확보 가능 재고 5,000개</li>
                    <li>현재 발주 입고 전에 들어오는 물량만 업로드하세요.</li>
                    <li>입고 예정이 없는 경우 <b>"입고 예정 없음"</b>을 체크하면 됩니다.</li>
                  </ul>
                </section>
                <hr />
                <section>
                  <h2 className="text-lg font-bold mb-2">📋 발주 요청 양식</h2>
                  <p className="text-gray-700 mb-2">발주 요청 양식을 업로드하는 파일입니다.</p>
                  <ol className="list-decimal pl-5 text-gray-600 space-y-1">
                    <li>발주 요청 양식을 다운로드합니다.</li>
                    <li>동일한 양식에 <b>모델명과 사이즈</b>를 작성합니다.</li>
                    <li>작성한 파일을 업로드하면 됩니다.</li>
                  </ol>
                </section>
                <hr />
                <section className="bg-yellow-50 rounded-xl p-5 border border-yellow-200">
                  <h2 className="text-xl font-bold mb-4 text-yellow-800">💡 TIP</h2>
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-bold text-yellow-800 mb-1">① 품절 기간을 입력하면 더욱 정확한 계산이 가능합니다.</h3>
                      <p className="text-gray-600 mb-1">예시)</p>
                      <ul className="list-disc pl-5 text-gray-600 space-y-1">
                        <li>품절 기간을 제외한 <b>실제 판매 가능 기간</b>을 계산</li>
                        <li>일평균 판매량 산출</li>
                        <li>이를 기준으로 <b>12개월 예상 판매량</b>을 계산하여 보다 정확한 발주수량을 추천합니다.</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-yellow-800 mb-1">② 계산 설정을 활용해 보세요.</h3>
                      <ul className="list-disc pl-5 text-gray-600 space-y-1">
                        <li>발주를 몇 개월치 기준으로 계산할지 설정할 수 있습니다.</li>
                        <li>성장계수도 함께 설정하여 발주량에 반영할 수 있습니다.</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-yellow-800 mb-1">③ 파일은 순서대로 업로드하는 것을 권장합니다.</h3>
                      <p className="text-gray-600"><b>판매데이터 → BMS 재고 → 최근 입고내역 → 발주 요청 양식</b> 순으로 업로드하면 오류 없이 가장 안정적으로 계산됩니다.</p>
                    </div>
                                        <div>
                      <h3 className="font-bold text-yellow-800 mb-1">
                        ④ 보고서를 저장하여 공유할 수 있습니다.
                      </h3>
                      <ul className="list-disc pl-5 text-gray-600 space-y-1">
                        <li>좌측 상단에서 <b>본인의 이름을 선택</b>한 후 <b>[결과 저장]</b> 버튼을 누르면 보고서가 저장됩니다.</li>
                        <li>저장된 보고서는 보기 편한 형태로 공유하거나 보고할 때 활용할 수 있습니다.</li>
                      </ul>
                    </div>
                                        {/* ⑤ 패킹 단위 반올림 */}
                    <div>
                      <h3 className="font-bold text-yellow-800 mb-1">
                        ⑤ 패킹 단위 반올림 기준은 1/2.5 입니다.
                      </h3>
                      <p className="text-gray-600 mb-2">
                        발주수량은 패킹 단위(예시 30개)에 맞춰{" "}
                        <b>30, 60, 90, 120 …</b> 처럼 딱 떨어지는 수량으로 자동 조정됩니다.
                        이때, <b>올림할지 버림할지를 판단하는 기준이 1/2.5</b> 입니다.
                      </p>

                      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded mb-3">
                        <p className="text-sm font-semibold mb-1">계산 방법</p>
                        <p className="text-sm text-gray-700">
                          패킹 단위 30 ÷ 2.5 = <b>12개</b>
                        </p>
                        <p className="text-sm text-gray-700">
                          👉 30개 단위로 딱 떨어지지 않는 <b>남은 수량이 12개 이상이면 올림</b>,{" "}
                          <b>12개 미만이면 버림</b>
                        </p>
                      </div>

                      <p className="text-sm font-semibold text-gray-700 mb-2">
                        예시) 패킹 단위 30개 기준
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="border px-2 py-1.5 text-left">계산된 발주수량</th>
                              <th className="border px-2 py-1.5 text-left">가까운 단위</th>
                              <th className="border px-2 py-1.5 text-left">남은 수량</th>
                              <th className="border px-2 py-1.5 text-left">12개 이상?</th>
                              <th className="border px-2 py-1.5 text-left">최종 발주수량</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="border px-2 py-1.5">390개</td>
                              <td className="border px-2 py-1.5">390</td>
                              <td className="border px-2 py-1.5">0개</td>
                              <td className="border px-2 py-1.5">-</td>
                              <td className="border px-2 py-1.5"><b>390개</b> <span className="text-gray-400">(딱 맞음)</span></td>
                            </tr>
                            <tr>
                              <td className="border px-2 py-1.5">395개</td>
                              <td className="border px-2 py-1.5">390</td>
                              <td className="border px-2 py-1.5">5개</td>
                              <td className="border px-2 py-1.5">❌ 미만</td>
                              <td className="border px-2 py-1.5"><b>390개</b> <span className="text-gray-400">(버림)</span></td>
                            </tr>
                            <tr>
                              <td className="border px-2 py-1.5">401개</td>
                              <td className="border px-2 py-1.5">390</td>
                              <td className="border px-2 py-1.5">11개</td>
                              <td className="border px-2 py-1.5">❌ 미만</td>
                              <td className="border px-2 py-1.5"><b>390개</b> <span className="text-gray-400">(버림)</span></td>
                            </tr>
                            <tr className="bg-blue-50 font-semibold">
                              <td className="border px-2 py-1.5">402개</td>
                              <td className="border px-2 py-1.5">390</td>
                              <td className="border px-2 py-1.5">12개</td>
                              <td className="border px-2 py-1.5">✅ 이상</td>
                              <td className="border px-2 py-1.5"><b>420개</b> <span className="text-gray-500">(올림)</span></td>
                            </tr>
                            <tr className="bg-blue-50 font-semibold">
                              <td className="border px-2 py-1.5">410개</td>
                              <td className="border px-2 py-1.5">390</td>
                              <td className="border px-2 py-1.5">20개</td>
                              <td className="border px-2 py-1.5">✅ 이상</td>
                              <td className="border px-2 py-1.5"><b>420개</b> <span className="text-gray-500">(올림)</span></td>
                            </tr>
                            <tr>
                              <td className="border px-2 py-1.5">420개</td>
                              <td className="border px-2 py-1.5">420</td>
                              <td className="border px-2 py-1.5">0개</td>
                              <td className="border px-2 py-1.5">-</td>
                              <td className="border px-2 py-1.5"><b>420개</b> <span className="text-gray-400">(딱 맞음)</span></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                                        {/* ⑥ 계산 방식 안내 */}
                    <div>
                      <h3 className="font-bold text-yellow-800 mb-1">
                        ⑥ 발주수량 계산 방식
                      </h3>
                      <p className="text-gray-600 mb-3">
                        상품 유형에 따라 두 가지 방식으로 계산됩니다.
                      </p>

                      {/* 사계절 상품 */}
                      <div className="bg-white border border-yellow-200 rounded-lg p-4 mb-3">
                        <h4 className="font-bold text-gray-800 mb-2">📦 사계절 상품</h4>
                        <p className="text-sm text-gray-600 mb-2">
                          연중 고르게 판매되는 상품에 적합합니다. (예: 기본 청바지, 기본 티셔츠)
                        </p>
                        <div className="bg-gray-50 rounded p-3 text-sm space-y-1">
                          <p>① 일평균 판매 = 판매수량 ÷ (판매데이터 기간 - 품절기간)</p>
                          <p>② 발주 필요수량 = 일평균 × 발주개월수 × 30일</p>
                          <p>③ 성장계수 적용 = 필요수량 × 성장계수</p>
                          <p>④ 확보 가능 재고 = 현재 BMS 재고 + 미래 입고 예정</p>
                          <p className="font-bold text-blue-700">⑤ 최종 발주수량 = ③ - ④ (패킹단위 반올림)</p>
                        </div>
                        <div className="mt-2 text-sm text-gray-500">
                          <p><b>예시)</b> 판매 1,000개 / 12개월 / 품절 2개월 / 발주 8개월 / 성장계수 1.2</p>
                          <p>일평균 = 1,000 ÷ (360-60) = 3.33개 → 8개월 예상 = 3.33 × 240 = 800개</p>
                          <p>성장 적용 = 800 × 1.2 = 960개 → 960 - 재고 = 최종 발주수량</p>
                        </div>
                      </div>

                      {/* 시즌 상품 */}
                      <div className="bg-white border border-yellow-200 rounded-lg p-4 mb-3">
                        <h4 className="font-bold text-gray-800 mb-2">🌞 시즌 상품</h4>
                        <p className="text-sm text-gray-600 mb-2">
                          특정 시즌에 판매가 집중되는 상품에 적합합니다. (예: 여름 반바지, 겨울 패딩)<br />
                          <b>월별 판매량을 입력하면</b> 시즌/비시즌 판매를 자동으로 분리하여 더 정확하게 계산합니다.
                        </p>
                        <div className="bg-gray-50 rounded p-3 text-sm space-y-1">
                          <p className="font-semibold text-blue-700">[시즌 기간 계산]</p>
                          <p>① 시즌 판매량 = 월별 판매량 중 시즌 해당 월 합산</p>
                          <p>② 시즌 일평균 = 시즌 판매량 ÷ (시즌 기간 - 시즌 내 품절기간)</p>
                          <p>③ 시즌 필요수량 = 시즌 일평균 × 시즌 기간</p>
                          <p className="font-semibold text-green-700 mt-2">[비시즌 기간 계산]</p>
                          <p>④ 비시즌 판매량 = 월별 판매량 중 비시즌 해당 월 합산</p>
                          <p>⑤ 비시즌 일평균 = 비시즌 판매량 ÷ (비시즌 기간 - 비시즌 내 품절기간)</p>
                          <p>⑥ 비시즌 필요수량 = 비시즌 일평균 × 비시즌 기간</p>
                          <p className="font-semibold text-purple-700 mt-2">[최종 발주]</p>
                          <p>⑦ 총 필요수량 = 시즌 필요 + 비시즌 필요</p>
                          <p>⑧ 성장계수 적용 = 총 필요수량 × 성장계수</p>
                          <p>⑨ 확보 가능 재고 = 현재 BMS 재고 + 미래 입고 예정</p>
                          <p className="font-bold text-blue-700">⑩ 최종 발주수량 = ⑧ - ⑨ (패킹단위 반올림)</p>
                        </div>
                        <div className="mt-2 text-sm text-gray-500">
                          <p><b>예시)</b> 시즌 3~9월(7개월) / 시즌 내 품절 2개월 / 성장계수 1.2</p>
                          <p>월별: 3월 5,000 / 4월 5,000 / ... / 9월 5,000 → 시즌 합계: 35,000개</p>
                          <p>월별: 10월 500 / 11월 500 / ... / 2월 500 → 비시즌 합계: 2,500개</p>
                          <p>시즌 일평균 = 35,000 ÷ (210-60) = 233개 → 시즌 필요 = 233 × 210 = <b>49,000개</b></p>
                          <p>비시즌 일평균 = 2,500 ÷ 150 = 16.7개 → 비시즌 필요 = 16.7 × 150 = <b>2,500개</b></p>
                          <p>총 필요 = 49,000 + 2,500 = 51,500 × 1.2 = 61,800 - 재고 = 최종 발주수량</p>
                        </div>
                      </div>

                      {/* 왜 시즌 구분이 필요한가 */}
                      <div className="bg-white border border-yellow-200 rounded-lg p-4">
                        <h4 className="font-bold text-gray-800 mb-2">❓ 왜 시즌 구분이 필요한가?</h4>
                        <p className="text-sm text-gray-600 mb-2">
                          시즌 상품을 사계절 방식으로 계산하면, 비시즌의 낮은 판매량이 일평균을 끌어내려
                          <b> 시즌에 필요한 발주수량이 과소 산정</b>됩니다.
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="bg-gray-100">
                                <th className="border px-2 py-1.5 text-left">계산 방식</th>
                                <th className="border px-2 py-1.5 text-left">일평균</th>
                                <th className="border px-2 py-1.5 text-left">시즌 발주</th>
                                <th className="border px-2 py-1.5 text-left">문제점</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="border px-2 py-1.5">사계절 방식</td>
                                <td className="border px-2 py-1.5">37,500 ÷ 360 = <b>104개</b></td>
                                <td className="border px-2 py-1.5">104 × 210 = 21,875개</td>
                                <td className="border px-2 py-1.5 text-red-600">❌ 시즌 수요 과소 추정</td>
                              </tr>
                              <tr className="bg-blue-50">
                                <td className="border px-2 py-1.5">시즌 분리 방식</td>
                                <td className="border px-2 py-1.5">35,000 ÷ 210 = <b>166개</b></td>
                                <td className="border px-2 py-1.5">166 × 210 = 35,000개</td>
                                <td className="border px-2 py-1.5 text-green-600">✅ 정확한 시즌 수요 반영</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>         
                  </div>
                </section>
              </div>
              <div className="mt-8 text-center">
                <button
                  onClick={() => setShowTip(false)}
                  className="px-8 py-3 bg-gray-200 hover:bg-gray-300 rounded-xl font-semibold transition"
                >
                  ✕ 닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl p-10">
                <h1 className="text-3xl font-bold text-center mb-10">
          📦 발주 자동화 시스템
        </h1>

        {/* 저장된 결과 보기 모드: 헤더 + 뒤로가기 */}
        {viewingMode && (
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-indigo-700">📂 {viewingName}</h2>
              <p className="text-sm text-gray-400">저장된 발주 결과</p>
            </div>
            <button
              onClick={handleBack}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300
                         rounded-lg font-semibold transition"
            >
              ← 뒤로가기
            </button>
          </div>
        )}

        {/* 메인 화면 — 보기 모드에서는 숨김 */}
        {!viewingMode && (
          <>

        {/* ─── 파일 업로드 영역 ─── */}
        <div className="space-y-6">

          {/* 판매데이터 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">
              📌 BMS &gt; 발주관리 &gt; 발주계산 &gt; 모델명 검색 &gt; 몰 주문일 기간 설정 &gt; 판매수량 클릭 &gt; 그리드 데이터 엑셀파일 다운
            </p>
                        <MultiFileDrop
              title="📊 판매데이터 (여러 모델 가능)"
              files={salesFiles}
              onFilesChange={setSalesFiles}
            />
          </div>

          {/* BMS 재고 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">
              📌 BMS &gt; 상품관리 &gt; 상품조회 &gt; 재고 표시 &gt; 그리드 데이터 엑셀파일 다운
            </p>
            <FileDrop
              title="📦 BMS 재고"
              file={stockFile}
              onFileChange={setStockFile}
            />
          </div>

          {/* 미래 입고 예정 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">
              📌 BMS &gt; 발주관리 &gt; 발주현황 &gt; 모델명 검색 &gt; 모델명 클릭 &gt; 입고예정 P/O 클릭 &gt; 그리드 데이터 엑셀파일 다운
            </p>
            <div className="flex items-center gap-2 mb-1">
              <input
                type="checkbox"
                id="noInbound"
                checked={inFiles.length === 0 && noInbound}
                onChange={(e) => {
                  setNoInbound(e.target.checked);
                  if (e.target.checked) {
                    setInFiles([]);
                    setInDates([]);
                  }
                }}
                className="w-4 h-4 accent-blue-500"
              />
              <label htmlFor="noInbound" className="text-sm text-gray-600">
                입고 예정 없음
              </label>
            </div>
            {!noInbound && (
              <MultiFileDrop
                title="📦 미래 입고 예정 (현재 발주 입고 전에 들어오는 물량)"
                files={inFiles}
                onFilesChange={setInFiles}
                showDates={true}
                dates={inDates}
                onDatesChange={setInDates}
              />
            )}
            {!noInbound && inFiles.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                💡 현재 발주 물량이 입고되기 전에 들어오는 수량만 업로드하세요. 입고예정 수량은 현재 재고에 합산되어 계산됩니다.
              </p>
            )}
          </div>

                    {/* 발주 요청 양식 */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs text-gray-400">
                📌 양식 파일이 없으면 다운로드:
              </p>
              <a
                href="/Order Form.xlsx"
                download
                className="text-xs text-blue-500 hover:text-blue-700 underline"
              >
                📎 발주요청 양식 다운로드
              </a>
            </div>
            <FileDrop
              title="📋 발주 요청 양식"
              file={orderFile}
              onFileChange={handleOrderFileChange}
            />
          </div>

        </div>

        {/* 시즌 설정 UI */}
        {seasonInfos.length > 0 && (
          <div className="mt-4 space-y-4">
            {seasonInfos.map((info, mi) => (
              <div
                key={mi}
                className="rounded-xl border border-blue-200 bg-blue-50 p-4"
              >
                <h4 className="font-bold text-blue-800 mb-3">
                  📦 {info.model} 상품 유형
                </h4>
                <div className="flex items-center gap-3 mb-3">
                  <label className="text-sm text-blue-700 font-semibold">📅 판매데이터 기간:</label>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={info.salesMonths}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val > 0 && val <= 24) {
                        setSeasonInfos((prev) => {
                          const updated = [...prev];
                          updated[mi] = { ...updated[mi], salesMonths: val };
                          return updated;
                        });
                      }
                    }}
                    className="w-16 px-2 py-1 border border-blue-300 rounded-lg
                               text-center text-sm focus:outline-none
                               focus:ring-2 focus:ring-blue-400"
                  />
                  <span className="text-xs text-blue-500">개월 (기본 12개월)</span>
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={`season-${mi}`}
                      checked={info.type === "allseason"}
                      onChange={() => {
                        setSeasonInfos((prev) => {
                          const updated = [...prev];
                          updated[mi] = { ...updated[mi], type: "allseason" };
                          return updated;
                        });
                      }}
                      className="w-4 h-4 accent-blue-500"
                    />
                    <span className="text-sm font-semibold">사계절 상품</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={`season-${mi}`}
                      checked={info.type === "season"}
                      onChange={() => {
                        setSeasonInfos((prev) => {
                          const updated = [...prev];
                          updated[mi] = { ...updated[mi], type: "season" };
                          return updated;
                        });
                      }}
                      className="w-4 h-4 accent-blue-500"
                    />
                    <span className="text-sm font-semibold">시즌 상품</span>
                  </label>
                  {info.type === "season" && (
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-blue-600">시즌:</label>
                      <select
                        value={info.seasonStart}
                        onChange={(e) => {
                          setSeasonInfos((prev) => {
                            const updated = [...prev];
                            updated[mi] = { ...updated[mi], seasonStart: Number(e.target.value) };
                            return updated;
                          });
                        }}
                        className="px-2 py-1 border border-blue-300 rounded-lg
                                   text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => (
                          <option key={m} value={m}>{m}월</option>
                        ))}
                      </select>
                      <span className="text-sm text-blue-600">~</span>
                      <select
                        value={info.seasonEnd}
                        onChange={(e) => {
                          setSeasonInfos((prev) => {
                            const updated = [...prev];
                            updated[mi] = { ...updated[mi], seasonEnd: Number(e.target.value) };
                            return updated;
                          });
                        }}
                        className="px-2 py-1 border border-blue-300 rounded-lg
                                   text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => (
                          <option key={m} value={m}>{m}월</option>
                        ))}
                      </select>
                      <span className="text-xs text-blue-500">
                        ({(() => {
                          const s = info.seasonStart;
                          const e = info.seasonEnd;
                          return s <= e ? e - s + 1 : 12 - s + 1 + e;
                        })()}개월)
                      </span>
                    </div>
                  )}
                </div>
                {info.type === "season" && (
                  <p className="text-xs text-blue-400 mt-2">
                    ⚠️ 품절기간은 시즌 내 품절만 입력하세요. 비시즌 품절은 입력하지 않아도 됩니다.
                  </p>
                )}

                {/* 월별 판매량 입력 */}
                {info.type === "season" && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <h5 className="text-sm font-semibold text-blue-700">
                        📊 월별 판매량 (모델 전체 기준)
                      </h5>
                    </div>
                    <div className="grid grid-cols-6 gap-2">
                      {["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"].map((label, i) => {
                        return (
                          <div key={i} className="flex flex-col items-center">
                            <label className="text-xs mb-1 font-semibold text-gray-600">
                              {label}
                            </label>
                            <input
                              type="number"
                              min="0"
                              value={info.monthlySales[i] || ""}
                              placeholder="0"
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                setSeasonInfos((prev) => {
                                  const updated = [...prev];
                                  const newMonthly = [...updated[mi].monthlySales];
                                  newMonthly[i] = val;
                                  updated[mi] = { ...updated[mi], monthlySales: newMonthly };
                                  return updated;
                                });
                              }}
                              className="w-full px-1 py-1 border border-gray-300 rounded text-center text-sm
                                focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-2 mt-2">
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
                {/* 패킹단위 설정 UI */}
        {packingInfos.length > 0 && (
          <div className="mt-4 space-y-4">
            {packingInfos.map((info, mi) => (
              <div
                key={mi}
                className="rounded-xl border border-purple-200 bg-purple-50 p-4"
              >
                <div className="flex items-center gap-4 mb-3">
                  <h4 className="font-bold text-purple-800">
                    📦 {info.model} 패킹단위
                  </h4>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-purple-600">일괄 적용:</label>
                    <input
                      type="number"
                      min="1"
                      defaultValue={30}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val > 0) updateAllUnits(mi, val);
                      }}
                      className="w-14 px-2 py-1 border border-purple-300 rounded-lg
                                 text-center text-sm focus:outline-none
                                 focus:ring-2 focus:ring-purple-400"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="text-sm border-collapse">
                    <thead>
                      <tr>
                        {info.sizes.map((size) => (
                          <th
                            key={size}
                            className="border border-purple-200 px-2 py-1
                                       bg-purple-100 text-purple-700 text-center
                                       whitespace-nowrap"
                          >
                            {size}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {info.sizes.map((size) => (
                          <td
                            key={size}
                            className="border border-purple-200 px-1 py-1"
                          >
                            <input
                              type="number"
                              min="1"
                              value={info.units[size] || 30}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                if (val > 0) updateSizeUnit(mi, size, val);
                              }}
                              className="w-14 px-1 py-1 border border-gray-300
                                         rounded text-center text-sm
                                         focus:outline-none focus:ring-2
                                         focus:ring-purple-400"
                            />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

{/* 품절기간 설정 UI */}
        {outOfStockInfos.length > 0 && (
          <div className="mt-4 space-y-4">
            {outOfStockInfos.map((info, mi) => (
              <div
                key={mi}
                className="rounded-xl border border-red-200 bg-red-50 p-4"
              >
                <div className="flex items-center gap-4 mb-3">
                                    <h4 className="font-bold text-red-800">
                    📅 {info.model} 품절기간 (일)
                  </h4>
                  <div
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("ring-2", "ring-red-400"); }}
                    onDragLeave={(e) => { e.currentTarget.classList.remove("ring-2", "ring-red-400"); }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove("ring-2", "ring-red-400");
                      const file = e.dataTransfer.files[0];
                      if (!file) return;
                      try {
                        const data = await file.arrayBuffer();
                        const wb = XLSX.read(data);
                        const modelSeason = seasonInfos[mi];
                        const sStart = modelSeason?.type === "season" ? modelSeason.seasonStart : null;
                        const sEnd = modelSeason?.type === "season" ? modelSeason.seasonEnd : null;
                        const oosResult = calculateOutOfStock(wb, sStart, sEnd, modelSeason?.salesMonths || 12);
                        const modelOOS = oosResult[info.model];
                        if (modelOOS) {
                          setOutOfStockInfos((prev) => {
                            const updated = [...prev];
                            const current = { ...updated[mi] };
                            current.data = { ...current.data };
                            for (const color of current.colors) {
                              current.data[color] = { ...current.data[color] };
                              for (const size of current.sizes) {
                                if (modelOOS[color]?.[size] !== undefined) {
                                  current.data[color][size] = modelOOS[color][size];
                                }
                              }
                            }
                            updated[mi] = current;
                            return updated;
                          });
                          alert(`${info.model} 품절기간 자동 입력 완료!`);
                        } else {
                          alert(`${info.model} 데이터를 찾을 수 없습니다.`);
                        }
                      } catch (err) {
                        console.error(err);
                        alert("파일 파싱 오류");
                      }
                    }}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = ".xlsx,.xls";
                      input.onchange = async (e: any) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const fileData = await file.arrayBuffer();
                          const wb = XLSX.read(fileData);
                          const modelSeason = seasonInfos[mi];
                          const sStart = modelSeason?.type === "season" ? modelSeason.seasonStart : null;
                          const sEnd = modelSeason?.type === "season" ? modelSeason.seasonEnd : null;
                          const oosResult = calculateOutOfStock(wb, sStart, sEnd, modelSeason?.salesMonths || 12);
                                                    const oosResult2 = calculateOutOfStock(wb, sStart, sEnd, modelSeason?.salesMonths || 12);
                          const modelOOS = oosResult2[info.model];
                          if (modelOOS) {
                            setOutOfStockInfos((prev) => {
                              const updated = [...prev];
                              const current = { ...updated[mi] };
                              current.data = { ...current.data };
                              for (const color of current.colors) {
                                current.data[color] = { ...current.data[color] };
                                for (const size of current.sizes) {
                                  if (modelOOS[color]?.[size] !== undefined) {
                                    current.data[color][size] = modelOOS[color][size];
                                  }
                                }
                              }
                              updated[mi] = current;
                              return updated;
                            });
                            alert(`${info.model} 품절기간 자동 입력 완료!`);
                          } else {
                            alert(`${info.model} 데이터를 찾을 수 없습니다.`);
                          }
                        } catch (err) {
                          console.error(err);
                          alert("파일 파싱 오류");
                        }
                      };
                      input.click();
                    }}
                    className="px-4 py-2 border-2 border-dashed border-red-300 rounded-lg
                               bg-red-50 hover:bg-red-100 cursor-pointer transition
                               text-center"
                  >
                    <p className="text-xs font-semibold text-red-600">
                      📂 재고이력 파일을 드래그하거나 클릭하여 업로드
                    </p>
                    <p className="text-xs text-red-400 mt-1">
                      업로드 시 품절기간이 자동으로 계산됩니다 (.xlsx)
                    </p>
                  </div>
                  <span className="text-xs text-red-400">
                    ⚠️ 재고이력 파일 업로드 시 자동 계산됩니다
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-red-600">전체 적용:</label>
                    <input
                      type="number"
                      max={seasonInfos[mi]?.type === "season" ? (() => { const s = seasonInfos[mi]?.seasonStart || 3; const e = seasonInfos[mi]?.seasonEnd || 10; return (s <= e ? e - s + 1 : 12 - s + 1 + e) * 30; })() : (seasonInfos[mi]?.salesMonths || 12) * 30}
                      defaultValue={0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val >= 0) updateAllOOS(mi, val);
                      }}
                      className="w-14 px-2 py-1 border border-red-300 rounded-lg
                                 text-center text-sm focus:outline-none
                                 focus:ring-2 focus:ring-red-400"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="border border-red-200 px-2 py-1 bg-red-100
                                      text-red-700 text-left whitespace-nowrap
                                       sticky left-0 z-10 bg-red-100">
                          색상
                        </th>
                        <th className="border border-red-200 px-2 py-1 bg-red-100
                                       text-red-700 text-center whitespace-nowrap">
                          일괄
                        </th>
                        {info.sizes.map((size) => (
                          <th
                            key={size}
                            className="border border-red-200 px-2 py-1
                                       bg-red-100 text-red-700 text-center
                                       whitespace-nowrap"
                          >
                            {size}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {info.colors.map((color) => (
                        <tr key={color}>
                            <td className="border border-red-200 px-2 py-1
                                         font-semibold text-red-800 whitespace-nowrap
                                         sticky left-0 z-10 bg-red-50">
                            {color}
                          </td>
                          <td className="border border-red-200 px-1 py-1">
                            <input
                              type="number"
                              min="0"
                              max={seasonInfos[mi]?.type === "season" ? (() => { const s = seasonInfos[mi]?.seasonStart || 3; const e = seasonInfos[mi]?.seasonEnd || 10; return (s <= e ? e - s + 1 : 12 - s + 1 + e) * 30; })() : (seasonInfos[mi]?.salesMonths || 12) * 30}
                              defaultValue={0}
                              onChange={(e) => {
                                const val = Math.min(Number(e.target.value), salesMonths);
                                if (val >= 0) updateColorOOS(mi, color, val);
                              }}
                              className="w-12 px-1 py-1 border border-red-300
                                         rounded text-center text-sm bg-red-50
                                         focus:outline-none focus:ring-2
                                         focus:ring-red-400"
                            />
                          </td>
                          {info.sizes.map((size) => (
                            <td
                              key={size}
                              className="border border-red-200 px-1 py-1"
                            >
                              <input
                                type="number"
                                min="0"
                                max={seasonInfos[mi]?.type === "season" ? (() => { const s = seasonInfos[mi]?.seasonStart || 3; const e = seasonInfos[mi]?.seasonEnd || 10; return (s <= e ? e - s + 1 : 12 - s + 1 + e) * 30; })() : (seasonInfos[mi]?.salesMonths || 12) * 30}
                                value={info.data[color]?.[size] ?? 0}
                                onChange={(e) => {
                                  const val = Math.min(Number(e.target.value), salesMonths);
                                  if (val >= 0) updateSizeOOS(mi, color, size, val);
                                }}
                                className="w-12 px-1 py-1 border border-gray-300
                                           rounded text-center text-sm
                                           focus:outline-none focus:ring-2
                                           focus:ring-red-400"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ─── 계산 설정 ─── */}
                {/* ─── 계산 설정 ─── */}
        <div className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
          <h3 className="text-sm font-bold text-gray-600 mb-3">⚙️ 계산 설정</h3>
          <div className="flex gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">발주 개월수</label>
              <input
                type="number"
                step="1"
                min="1"
                max="24"
                value={orderMonths}
                onChange={(e) => setOrderMonths(Number(e.target.value))}
                className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg
                           text-center text-gray-700 focus:outline-none
                           focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-xs text-gray-400">개월</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">성장계수</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={growthFactor}
                onChange={(e) => setGrowthFactor(Number(e.target.value))}
                className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg
                           text-center text-gray-700 focus:outline-none
                           focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
        </div>

        {/* ─── 계산 버튼 ─── */}
        <button
          disabled={!canCalculate || loading}
          onClick={handleCalculate}
          className={`mt-8 w-full py-4 rounded-xl text-lg font-bold transition
            ${
              canCalculate && !loading
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
            }`}
        >
          {loading ? "⏳ 계산 중..." : "🚀 발주 계산하기"}
        </button>

        {/* ─── 오류 표시 ─── */}
        {error && (
          <div className="mt-6 rounded-xl border border-red-300 bg-red-50 p-5">
            <p className="text-red-700 font-semibold">❌ {error}</p>
          </div>
        )}

          </>
        )}

        {/* ─── 결과 표시 ─── */}
        {results && summary && (
          <div className="mt-6 space-y-4">
            {/* 요약 */}
            <div className="rounded-xl border border-green-300 bg-green-50 p-5">
              <h2 className="text-xl font-bold mb-3">✅ 계산 완료</h2>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p>📊 판매 데이터: {summary.sales.toLocaleString()}건</p>
                <p>📦 재고 데이터: {summary.stock.toLocaleString()}건</p>
                <p>📦 입고예정 데이터: {summary.inbound.toLocaleString()}건</p>
                <p>📋 발주 항목: <b>{summary.orders.toLocaleString()}건</b></p>
              </div>
              <p className="mt-2 text-sm text-gray-500">
                📅 입고파일 {inFiles.length}개 |
                성장계수 ×{growthFactor} |
                발주 {orderMonths}개월
              </p>
            </div>

            {/* 발주 결과 테이블 */}
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 overflow-x-auto">
              <h2 className="text-lg font-bold mb-3">📋 발주 수량 요약</h2>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-blue-100">
                    <th className="border border-blue-200 px-3 py-2 text-left">모델코드</th>
                    <th className="border border-blue-200 px-3 py-2 text-left">사이즈</th>
                    <th className="border border-blue-200 px-3 py-2 text-right">판매(1기)</th>
                    <th className="border border-blue-200 px-3 py-2 text-right">입고예정</th>
                    <th className="border border-blue-200 px-3 py-2 text-right">재고</th>
                    <th className="border border-blue-200 px-3 py-2 text-right">1년예상</th>
                    <th className="border border-blue-200 px-3 py-2 text-right font-bold">발주수량</th>
                  </tr>
                </thead>
                <tbody>
                  {results
                    .filter((r) => !r.skip && r.orderQty > 0)
                    .map((r, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-blue-50"}>
                        <td className="border border-blue-200 px-3 py-1">{r.fullCode}</td>
                        <td className="border border-blue-200 px-3 py-1">{r.size}</td>
                        <td className="border border-blue-200 px-3 py-1 text-right">{r.salesQty.toLocaleString()}</td>
                        <td className="border border-blue-200 px-3 py-1 text-right">{r.inboundQty.toLocaleString()}</td>
                        <td className="border border-blue-200 px-3 py-1 text-right">{r.stockQty.toLocaleString()}</td>
                        <td className="border border-blue-200 px-3 py-1 text-right">{r.annualEstimate.toLocaleString()}</td>
                        <td className="border border-blue-200 px-3 py-1 text-right font-bold text-blue-700">
                          {r.orderQty.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {/* 다운로드 버튼 */}
                        <div className="flex gap-4">
              <button
                onClick={() => exportOrderExcel(results, "발주결과")}
                className="flex-1 py-3 bg-green-600 hover:bg-green-700
                           text-white font-bold rounded-xl transition"
              >
                📥 엑셀 다운로드
              </button>
              <button
                onClick={() => setShowReport(true)}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-700
                           text-white font-bold rounded-xl transition"
              >
                📊 보고서 보기
              </button>
                            {!viewingMode && (
                <button
                  onClick={handleSaveResult}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700
                             text-white font-bold rounded-xl transition"
                >
                  💾 결과 저장
                </button>
              )}
            </div>

          </div>
        )}

        {/* 보고서 팝업 */}
                {showReport && results && (
          <Report
            results={results}
            growthFactor={growthFactor}
            orderMonths={orderMonths}
            memo={memo}
            onMemoChange={setMemo}
            onClose={() => setShowReport(false)}
          />
        )}

                

      </div>
    </main>
  );
}

// ─── xlsx 파일 읽기 (워크북 반환) ───
async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const data = await file.arrayBuffer();
  return XLSX.read(data);
}

// ─── 발주 요청 파일 파싱 ───
interface OrderRequest {
  model: string;
  prefix: string;
  colors: string[];
  sizes: string[];
}

function parseOrderRequest(workbook: XLSX.WorkBook): OrderRequest[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  const requests: OrderRequest[] = [];
  let currentSizes: string[] = [];
  let currentModel = "";
  let currentPrefix = "";
  let currentColors: string[] = [];

  for (let r = 0; r < raw.length; r++) {
    const row = raw[r];
    const firstCell = String(row[0] ?? "").trim();

    if (firstCell.toLowerCase() === "color") {
      if (currentModel && currentColors.length > 0) {
        requests.push({
          model: currentModel,
          prefix: currentPrefix,
          colors: [...currentColors],
          sizes: [...currentSizes],
        });
      }

      currentSizes = [];
      for (let c = 1; c < row.length; c++) {
        const val = String(row[c] ?? "").trim();
        if (val && isSizeHeader(val)) {
          currentSizes.push(val);
        }
      }
      currentModel = "";
      currentPrefix = "";
      currentColors = [];
      continue;
    }

    if (!firstCell || !firstCell.includes("-")) continue;

    const parts = firstCell.split("-");
    if (parts.length >= 3) {
      const prefix = parts[0];
      const model = parts[1];
      const color = parts.slice(2).join("-");

      if (!currentModel) {
        currentModel = model;
        currentPrefix = prefix;
      }
      currentColors.push(color);
    }
  }

  if (currentModel && currentColors.length > 0) {
    requests.push({
      model: currentModel,
      prefix: currentPrefix,
      colors: currentColors,
      sizes: currentSizes,
    });
  }

  return requests;
}