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
import { calculateOrders, getDefaultSettings } from "../lib/calculate";
import { exportOrderExcel } from "../lib/export";
import { isSizeHeader } from "../lib/utils";
import { SalesItem, StockItem, InboundItem, OrderResult, PackingInfo, OutOfStockInfo } from "../types";

export default function Home() {
  // ─── 파일 상태 ───
  const [salesFiles, setSalesFiles] = useState<File[]>([]);
  const [stockFile, setStockFile] = useState<File | null>(null);
  const [inFiles, setInFiles] = useState<File[]>([]);
  const [orderFile, setOrderFile] = useState<File | null>(null);

  // ─── 입고일 (파일별) ───
  const [inDates, setInDates] = useState<string[]>([]);

  // ─── 계산 설정 ───
  const [growthFactor, setGrowthFactor] = useState<number>(1.2);
  const [orderMonths, setOrderMonths] = useState<number>(12);
  const [salesMonths, setSalesMonths] = useState<number>(12);  // ← 추가

  // ─── 패킹 단위 ───
  const [packingInfos, setPackingInfos] = useState<PackingInfo[]>([]);

  // ─── 품절기간 ───
  const [outOfStockInfos, setOutOfStockInfos] = useState<OutOfStockInfo[]>([]);

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
    if (salesFiles.length === 0 || !stockFile || inFiles.length === 0 || !orderFile) return;

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
        settings.salesMonths = salesMonths;  // ← 추가
        const modelPacking = packingInfos.find((p) => p.model === request.model);

                // 해당 모델의 품절기간 데이터 찾기
        const modelOOS = outOfStockInfos.find((o) => o.model === request.model);

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
          modelOOS?.data
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
                  <h2 className="text-lg font-bold mb-2">🚚 최근 입고내역 (여러 파일 업로드 가능)</h2>
                  <p className="text-gray-700 mb-2">최근 입고된 내역을 확인하기 위한 참고 자료입니다.</p>
                  <ul className="list-disc pl-5 text-gray-600 space-y-1">
                    <li>모델별 / 색상별 / 사이즈별 최근 입고수량을 확인합니다.</li>
                    <li><b>발주수량 계산에는 직접 영향을 주지 않습니다.</b></li>
                    <li>계산 결과를 비교하고 검토하기 위한 참고용 데이터입니다.</li>
                    <li><b>입고일 지정은 필수입니다.</b></li>
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
            {salesFiles.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <label className="text-sm text-gray-600">📅 판매데이터 기간:</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="24"
                  value={salesMonths}
                  onChange={(e) => setSalesMonths(Number(e.target.value))}
                  className="w-16 px-2 py-1 border border-gray-300 rounded-lg
                             text-center text-sm focus:outline-none
                             focus:ring-2 focus:ring-blue-400"
                />
                <span className="text-xs text-gray-400">개월 (기본 12개월)</span>
              </div>
            )}
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

          {/* 최근 입고내역 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">
              📌 BMS &gt; 발주관리 &gt; 발주현황 &gt; 모델명 검색 &gt; 모델명 클릭 &gt; 가장 최근 입고예정일 P/O 클릭 &gt; 그리드 데이터 엑셀파일 다운
            </p>
            <MultiFileDrop
              title="🚚 최근 입고내역 (여러 파일 가능)"
              files={inFiles}
              onFilesChange={setInFiles}
              showDates={true}
              dates={inDates}
              onDatesChange={setInDates}
            />
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
                    📅 {info.model} 품절기간 (개월)
                  </h4>
                  <span className="text-xs text-red-400">
                    ⚠️ 최대 {salesMonths}개월 (판매데이터 기간 이내)
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-red-600">전체 적용:</label>
                    <input
                      type="number"
                      min="0"
                      max={salesMonths}
                      defaultValue={0}
                      onChange={(e) => {
                        const val = Math.min(Number(e.target.value), salesMonths);
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
                                       text-red-700 text-left whitespace-nowrap">
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
                                         font-semibold text-red-800 whitespace-nowrap">
                            {color}
                          </td>
                          <td className="border border-red-200 px-1 py-1">
                            <input
                              type="number"
                              min="0"
                              max={salesMonths}
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
                                max={salesMonths}
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
                <p>🚚 입고 데이터: {summary.inbound.toLocaleString()}건</p>
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
                    <th className="border border-blue-200 px-3 py-2 text-right">입고</th>
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