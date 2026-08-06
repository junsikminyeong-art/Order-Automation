// lib/utils.ts

/**
 * 헤더 값이 사이즈인지 판별
 *
 * 지원 형식:
 * - W/L 형태: 28W/30L, 32W/32L, 40W/34L ...
 * - 의류 사이즈: S, M, L, XL, 2XL, 3XL ...
 * - 변형: L/Short, XL/Long, 2XL/Long, XL/Short ...
 */
export function isSizeHeader(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;

  // W/L 형태: 28W/30L
  if (/^\d+W\/\d+L$/.test(v)) return true;

  // 의류 사이즈: S, M, L, XL, 2XL, 3XL (+ /Short, /Long 등)
  if (/^(\d*X{0,3})?[SML](\/[A-Za-z]+)?$/i.test(v)) return true;

  return false;
}