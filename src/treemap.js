/**
 * Squarified Treemap 布局算法（Bruls et al. 2000）
 * 输入 items: [{ value: 数值(字节), ref: 引用 }]，输出矩形列表。
 */
(function () {
  function compute(items, x, y, w, h) {
    if (!items || items.length === 0 || w <= 0 || h <= 0) return [];
    const sorted = items.slice().sort((a, b) => b.value - a.value);
    const total = sorted.reduce((s, it) => s + it.value, 0);
    if (total <= 0) return [];

    // 关键：value 可能是任意量纲（如字节），必须归一化为「面积」，
    // 使 sum(value) == w*h。否则 layoutRow 里 ww = sum/rh 就不是像素长度，
    // 会导致矩形尺寸天文数字、画布被单个色块填满。
    const scale = (w * h) / total;
    const areas = sorted.map((it) => ({ value: it.value * scale, ref: it.ref }));

    // 一行内最差长宽比
    function worst(row, length) {
      const sum = row.reduce((s, it) => s + it.value, 0);
      if (sum <= 0) return Infinity;
      let max = 0;
      let min = Infinity;
      for (const it of row) {
        if (it.value > max) max = it.value;
        if (it.value < min) min = it.value;
      }
      if (min <= 0) return Infinity;
      const s2 = sum * sum;
      const l2 = length * length;
      return Math.max((l2 * max) / s2, s2 / (l2 * min));
    }

    function layoutRow(row, rx, ry, rw, rh) {
      const sum = row.reduce((s, it) => s + it.value, 0);
      const rects = [];
      if (rw >= rh) {
        const ww = sum / rh;
        let yy = ry;
        for (const it of row) {
          const hh = it.value / ww;
          rects.push({ x: rx, y: yy, w: ww, h: hh, ref: it.ref });
          yy += hh;
        }
      } else {
        const hh = sum / rw;
        let xx = rx;
        for (const it of row) {
          const ww = it.value / hh;
          rects.push({ x: xx, y: ry, w: ww, h: hh, ref: it.ref });
          xx += ww;
        }
      }
      return rects;
    }

    const rects = [];
    let rx = x;
    let ry = y;
    let rw = w;
    let rh = h;
    let idx = 0;

    while (idx < areas.length) {
      if (rw <= 0.5 || rh <= 0.5) break;
      const side = Math.min(rw, rh);
      const row = [areas[idx]];
      let i = idx + 1;
      while (i < areas.length) {
        const candidate = row.concat(areas[i]);
        if (worst(candidate, side) > worst(row, side)) break;
        row.push(areas[i]);
        i++;
      }
      const sum = row.reduce((s, it) => s + it.value, 0);
      rects.push(...layoutRow(row, rx, ry, rw, rh));
      if (rw >= rh) {
        const ww = sum / rh;
        rx += ww;
        rw -= ww;
      } else {
        const hh = sum / rw;
        ry += hh;
        rh -= hh;
      }
      idx = i;
    }

    return rects;
  }

  window.Treemap = { compute };
})();
