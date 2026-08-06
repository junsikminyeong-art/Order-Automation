"use client";

import { useState } from "react";
import { OrderResult } from "../types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";

type Props = {
  results: OrderResult[];
  growthFactor: number;
  orderMonths: number;
  onClose: () => void;
};

export default function Report({ results, growthFactor, orderMonths, onClose }: Props) {
  const models = [...new Set(results.map((r) => r.model))];
  const [selectedModel, setSelectedModel] = useState(models[0] || "");

  const modelItems = results.filter((r) => r.model === selectedModel);
  const colors = [...new Set(modelItems.map((r) => r.color))];
  const [selectedColor, setSelectedColor] = useState(colors[0] || "");

  // 클릭된 사이즈 (발주 근거 펼침용)
  const [expandedSize, setExpandedSize] = useState<string | null>(null);

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    const newColors = [...new Set(results.filter((r) => r.model === model).map((r) => r.color))];
    setSelectedColor(newColors[0] || "");
    setExpandedSize(null);
  };

  const handleColorChange = (color: string) => {
    setSelectedColor(color);
    setExpandedSize(null);
  };

  const colorSizeData = modelItems
    .filter((r) => r.color === selectedColor)
    .map((r) => ({
      size: r.size,
      판매: r.salesQty,
      발주: r.skip ? 0 : r.orderQty,
      재고: r.stockQty,
      입고: r.inboundQty,
      skip: r.skip,
      skipReason: r.skipReason || "",
      outOfStockMonths: r.outOfStockMonths,
      packingUnit: r.packingUnit,
      annualEstimate: r.annualEstimate,
      growthApplied: r.growthApplied,
      orderQty: r.orderQty,
    }));

  const modelSummary = models.map((model) => {
    const items = results.filter((r) => r.model === model);
    const totalOrder = items.filter((r) => !r.skip).reduce((s, r) => s + r.orderQty, 0);
    const orderCount = items.filter((r) => !r.skip && r.orderQty > 0).length;
    const totalCount = items.length;
    return { model, totalOrder, orderCount, totalCount };
  });

  const colorOrderData = colors.map((color) => {
    const items = modelItems.filter((r) => r.color === color);
    const totalSales = items.reduce((s, r) => s + r.salesQty, 0);
    const totalOrder = items.filter((r) => !r.skip).reduce((s, r) => s + r.orderQty, 0);
    return { color, 판매합계: totalSales, 발주합계: totalOrder };
  }).sort((a, b) => b.판매합계 - a.판매합계);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto">
      <div className="min-h-screen py-8 px-4">
        <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-2xl p-8">

          {/* 헤더 */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">📊 발주 보고서</h1>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300
                         rounded-lg font-semibold transition"
            >
              ✕ 닫기
            </button>
          </div>

          {/* ═══ 1. 모델별 총괄 ═══ */}
          <section className="mb-8">
            <h2 className="text-lg font-bold mb-3 border-b pb-2">
              📦 모델별 발주 총괄
            </h2>
            <div className="flex gap-6">
              {modelSummary.map((m) => (
                <div
                  key={m.model}
                  onClick={() => handleModelChange(m.model)}
                  className={`flex-1 p-4 rounded-xl border-2 cursor-pointer transition
                    ${selectedModel === m.model
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-blue-300"
                    }`}
                >
                  <p className="font-bold text-lg">{m.model}</p>
                  <p className="text-2xl font-bold text-blue-700 mt-1">
                    {m.totalOrder.toLocaleString()}개
                  </p>
                  <p className="text-sm text-gray-500">
                    {m.orderCount}건 / {m.totalCount}건 발주
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* ═══ 2. 색상 선택 ═══ */}
          <section className="mb-6">
            <h2 className="text-lg font-bold mb-3 border-b pb-2">
              🏷️ {selectedModel} — 색상별 총 판매 vs 발주
            </h2>

            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={colorOrderData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="color" />
                <YAxis />
                <Tooltip formatter={(v: number) => v.toLocaleString()} />
                <Legend />
                <Bar dataKey="판매합계" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                <Bar dataKey="발주합계" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* 색상 비중 표 */}
            <div className="overflow-x-auto mt-4 mb-4">
              <table className="text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-3 py-1 text-left">색상</th>
                    {colorOrderData.map((c) => (
                      <th key={c.color} className="border px-3 py-1 text-center">
                        {c.color}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border px-3 py-1 font-semibold">판매 비중</td>
                    {colorOrderData.map((c) => {
                      const totalSales = colorOrderData.reduce((s, x) => s + x.판매합계, 0);
                      const pct = totalSales > 0
                        ? Math.round((c.판매합계 / totalSales) * 100)
                        : 0;
                      return (
                        <td key={c.color} className="border px-3 py-1 text-center font-bold">
                          <span className={
                            pct >= 20 ? "text-green-600" :
                            pct >= 10 ? "text-blue-600" :
                            pct >= 5 ? "text-yellow-600" : "text-gray-400"
                          }>
                            {pct}%
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 색상 버튼들 */}
            <div className="flex flex-wrap gap-2 mt-4">
              {colors.map((color) => {
                const items = modelItems.filter((r) => r.color === color);
                const hasOrder = items.some((r) => !r.skip && r.orderQty > 0);
                return (
                  <button
                    key={color}
                    onClick={() => handleColorChange(color)}
                    className={`px-4 py-2 rounded-lg font-semibold text-sm transition
                      ${selectedColor === color
                        ? "bg-blue-600 text-white"
                        : hasOrder
                          ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                  >
                    {color} {hasOrder ? "✅" : "➖"}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ═══ 3. 사이즈별 상세 ═══ */}
          <section className="mb-8">
            <h2 className="text-lg font-bold mb-3 border-b pb-2">
              📐 {selectedModel} — {selectedColor} 사이즈별 상세 비교
            </h2>

            {/* 판매 vs 발주 차트 */}
            <h3 className="text-sm font-semibold text-gray-600 mb-2">
              판매(1기) vs 발주수량
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={colorSizeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="size" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip formatter={(v: number) => v.toLocaleString()} />
                <Legend />
                <Bar dataKey="판매" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                <Bar dataKey="발주" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* 입고 vs 재고 차트 */}
            <h3 className="text-sm font-semibold text-gray-600 mt-6 mb-2">
              최근 입고 수량 VS 현재 재고 현황

            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={colorSizeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="size" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip formatter={(v: number) => v.toLocaleString()} />
                <Legend />
                <Bar dataKey="입고" fill="#86efac" radius={[4, 4, 0, 0]} />
                <Bar dataKey="재고" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* 사이즈별 상세 테이블 + 발주 근거 */}
            <p className="text-xs text-gray-400 mt-6 mb-2">
              💡 행을 클릭하면 발주 근거를 확인할 수 있습니다
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-3 py-2 text-left">사이즈</th>
                    <th className="border px-3 py-2 text-right">판매(1기)</th>
                    <th className="border px-3 py-2 text-right">입고</th>
                    <th className="border px-3 py-2 text-right">현재재고</th>
                    <th className="border px-3 py-2 text-right font-bold">발주수량</th>
                    <th className="border px-3 py-2 text-left">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {colorSizeData.map((d, i) => (
                    <>
                      {/* 데이터 행 */}
                      <tr
                        key={`row-${i}`}
                        onClick={() => setExpandedSize(expandedSize === d.size ? null : d.size)}
                        className={`cursor-pointer transition hover:bg-gray-100
                          ${d.skip
                            ? "bg-red-50"
                            : d.발주 > 0
                              ? "bg-blue-50"
                              : i % 2 === 0 ? "bg-white" : "bg-gray-50"
                          }
                          ${expandedSize === d.size ? "ring-2 ring-blue-400" : ""}
                        `}
                      >
                        <td className="border px-3 py-2 font-semibold">
                          {expandedSize === d.size ? "🔽" : "▶️"} {d.size}
                        </td>
                        <td className="border px-3 py-2 text-right">{d.판매.toLocaleString()}</td>
                        <td className="border px-3 py-2 text-right">{d.입고.toLocaleString()}</td>
                        <td className="border px-3 py-2 text-right">{d.재고.toLocaleString()}</td>
                        <td className="border px-3 py-2 text-right font-bold text-blue-700">
                          {d.발주 > 0 ? d.발주.toLocaleString() : "-"}
                        </td>
                        <td className="border px-3 py-2 text-sm text-gray-500">
                          {d.skip ? `❌ ${d.skipReason}` : d.발주 > 0 ? "✅ 발주" : ""}
                        </td>
                      </tr>

                      {/* 발주 근거 펼침 */}
                      {expandedSize === d.size && (
                        <tr key={`detail-${i}`}>
                          <td colSpan={6} className="border px-0 py-0">
                            <div className="bg-indigo-50 p-5 border-l-4 border-indigo-400">
                              <h4 className="font-bold text-indigo-800 mb-3">
                                📝 발주 근거 — {selectedColor} {d.size}
                              </h4>

                              {/* 계산 과정 */}
                              <div className="space-y-2 text-sm">
                                <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                                  <p className="text-gray-600">
                                    ① 판매수량(1기):
                                  </p>
                                  <p className="font-semibold">
                                    {d.판매.toLocaleString()}개
                                  </p>

                                  <p className="text-gray-600">
                                    ② 판매데이터 기간:
                                  </p>
                                  <p className="font-semibold">365일 (최근 1년)</p>

                                  <p className="text-gray-600">
                                    ③ 품절기간:
                                  </p>
                                  <p className="font-semibold">
                                    {d.outOfStockMonths > 0
                                      ? `${d.outOfStockMonths}개월 (${d.outOfStockMonths * 30}일)`
                                      : "없음 (0개월)"
                                    }
                                  </p>

                                  <p className="text-gray-600">
                                    ④ 실제 판매 가능일:
                                  </p>
                                  <p className="font-semibold">
                                    365 - {d.outOfStockMonths * 30} = {365 - d.outOfStockMonths * 30}일
                                  </p>

                                  <p className="text-gray-600">
                                    ⑤ 일평균 판매:
                                  </p>
                                  <p className="font-semibold">
                                    {d.판매} ÷ {365 - d.outOfStockMonths * 30} ={" "}
                                    {((d.판매) / Math.max(1, 365 - d.outOfStockMonths * 30)).toFixed(2)}개/일
                                  </p>

                                  <p className="text-gray-600">
                                    ⑥ {orderMonths}개월 판매예상:
                                  </p>
                                  <p className="font-semibold">
                                    {((d.판매) / Math.max(1, 365 - d.outOfStockMonths * 30)).toFixed(2)} × {orderMonths * 30} ={" "}
                                    {d.annualEstimate.toLocaleString()}개
                                  </p>

                                  <p className="text-gray-600">
                                    ⑦ 성장계수 {growthFactor}× 적용:
                                  </p>
                                  <p className="font-semibold">
                                    {d.annualEstimate.toLocaleString()} × {growthFactor} ={" "}
                                    {d.growthApplied.toLocaleString()}개
                                  </p>

                                  <p className="text-gray-600">
                                    ⑧ BMS 재고 차감:
                                  </p>
                                  <p className="font-semibold">
                                    {d.growthApplied.toLocaleString()} - {d.재고.toLocaleString()} ={" "}
                                    {(d.growthApplied - d.재고).toLocaleString()}개
                                  </p>

                                  <p className="text-gray-600">
                                    ⑨ 패킹단위 {d.packingUnit}개 반올림:
                                  </p>
                                  <p className="font-bold text-lg text-blue-700">
                                    → {d.발주 > 0 ? `${d.발주.toLocaleString()}개` : "0개 (발주 불필요)"}
                                  </p>
                                </div>
                              </div>

                              {/* 판단 문구 */}
                              <div className="mt-4 p-3 rounded-lg bg-white border border-indigo-200">
                                <p className="font-semibold text-indigo-800">
                                  💡 판단:{" "}
                                  {d.skip ? (
                                    <span className="text-red-600">{d.skipReason}</span>
                                  ) : d.outOfStockMonths > 0 && d.판매 > 0 ? (
                                    <span className="text-green-700">
                                      품절 {d.outOfStockMonths}개월에도 {d.판매.toLocaleString()}개 판매
                                      → 실제 수요 높음 (일평균{" "}
                                      {((d.판매) / Math.max(1, 365 - d.outOfStockMonths * 30)).toFixed(1)}개)
                                      → 발주 권장
                                    </span>
                                  ) : d.판매 > 0 && d.재고 === 0 ? (
                                    <span className="text-green-700">
                                      현재 재고 0, 판매 {d.판매.toLocaleString()}개 → 재입고 필요, 발주 권장
                                    </span>
                                  ) : d.판매 > 0 && d.재고 > 0 ? (
                                    <span className="text-blue-700">
                                      현재 재고 {d.재고.toLocaleString()}개 보유, 판매 {d.판매.toLocaleString()}개
                                      → 재고 차감 후 {d.발주.toLocaleString()}개 발주
                                    </span>
                                  ) : (
                                    <span className="text-gray-500">
                                      판매 실적 없음 → 발주 불필요
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {/* 합계 행 */}
                  <tr className="bg-gray-200 font-bold">
                    <td className="border px-3 py-2">합계</td>
                    <td className="border px-3 py-2 text-right">
                      {colorSizeData.reduce((s, d) => s + d.판매, 0).toLocaleString()}
                    </td>
                    <td className="border px-3 py-2 text-right">
                      {colorSizeData.reduce((s, d) => s + d.입고, 0).toLocaleString()}
                    </td>
                    <td className="border px-3 py-2 text-right">
                      {colorSizeData.reduce((s, d) => s + d.재고, 0).toLocaleString()}
                    </td>
                    <td className="border px-3 py-2 text-right text-blue-700">
                      {colorSizeData.reduce((s, d) => s + d.발주, 0).toLocaleString()}
                    </td>
                    <td className="border px-3 py-2"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* 하단 닫기 */}
          <div className="mt-8 text-center">
            <button
              onClick={onClose}
              className="px-8 py-3 bg-gray-200 hover:bg-gray-300
                         rounded-xl font-semibold transition"
            >
              ✕ 보고서 닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}