// Đổi dương → âm lịch (thuật toán Hồ Ngọc Đức, múi giờ +7) — bản dùng trên máy chủ, chép từ tờ lịch (public/screens.js) để tự sinh ngày lễ âm lịch
const LUNAR = (() => {
  const F = Math.floor, PI = Math.PI, dr = PI / 180, TZ = 7;
  const jd = (d, m, y) => { const a = F((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3; return d + F((153 * mm + 2) / 5) + 365 * yy + F(yy / 4) - F(yy / 100) + F(yy / 400) - 32045; };
  const newMoon = k => {
    const T = k / 1236.85, T2 = T * T, T3 = T2 * T, s = Math.sin;
    const J = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3 + 0.00033 * s((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3, Mp = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3, Fx = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    const C = (0.1734 - 0.000393 * T) * s(M * dr) + 0.0021 * s(2 * dr * M) - 0.4068 * s(Mp * dr) + 0.0161 * s(dr * 2 * Mp) - 0.0004 * s(dr * 3 * Mp) + 0.0104 * s(dr * 2 * Fx) - 0.0051 * s(dr * (M + Mp))
      - 0.0074 * s(dr * (M - Mp)) + 0.0004 * s(dr * (2 * Fx + M)) - 0.0004 * s(dr * (2 * Fx - M)) - 0.0006 * s(dr * (2 * Fx + Mp)) + 0.0010 * s(dr * (2 * Fx - Mp)) + 0.0005 * s(dr * (2 * Mp + M));
    const dt = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
    return J + C - dt;
  };
  const nmDay = k => F(newMoon(k) + 0.5 + TZ / 24);
  const sunRad = n => { const T = (n - 0.5 - TZ / 24 - 2451545) / 36525, T2 = T * T, M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2, L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    const L = (L0 + (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M) + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M)) * dr; return L - PI * 2 * F(L / (PI * 2)); };
  const sunL = n => F(sunRad(n) / PI * 6);
  const m11 = y => { const k = F((jd(31, 12, y) - 2415021) / 29.530588853); let n = nmDay(k); if (sunL(n) >= 9) n = nmDay(k - 1); return n; };
  const leapOff = a => { const k = F((a - 2415021.076998695) / 29.530588853 + 0.5); let last, i = 1, arc = sunL(nmDay(k + i)); do { last = arc; i++; arc = sunL(nmDay(k + i)); } while (arc !== last && i < 14); return i - 1; };
  return (d, m, y) => {
    const n = jd(d, m, y), k = F((n - 2415021.076998695) / 29.530588853); let ms = nmDay(k + 1), kk = k + 1; if (ms > n) { ms = nmDay(k); kk = k; }
    let a11 = m11(y), b11 = a11, ly; if (a11 >= ms) { ly = y; a11 = m11(y - 1); } else { ly = y + 1; b11 = m11(y + 1); }
    const diff = F((ms - a11) / 29); let lm = diff + 11, leap = false;
    if (b11 - a11 > 365) { const lo = leapOff(a11); if (diff >= lo) { lm = diff + 10; leap = diff === lo; } }
    if (lm > 12) lm -= 12; if (lm >= 11 && diff < 4) ly -= 1;
    return { day: n - ms + 1, month: lm, year: ly, leap, big: nmDay(kk + 1) - ms === 30, jd: n, sun: sunRad(n) * 180 / PI };   // sun: kinh độ mặt trời (độ) đầu ngày → tiết khí
  };
})();
module.exports = LUNAR;
