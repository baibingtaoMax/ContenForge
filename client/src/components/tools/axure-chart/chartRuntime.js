/*
 * Axure 图表运行时（纯 JS，零依赖，预览与 Axure 注入共用这一份源码）
 * v3：向导配置按 family 分发（cartesian/waterfall/pie/funnel/radar/scatter/
 *     gauge/treemap/heatmap/sankey），共 22 张图型卡片。
 * 约定：所有语句显式分号结尾（生成注入码时会按行拼接，勿用 // 行注释）
 * 导出 buildWizardOption / mountChart / mountCustom / mountCustomSource 等；
 * 生成注入码时 export 关键字会被剥掉。
 */

var CR_FONT = '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
var CR = {
  blue: '#2b5cff',
  deepBlue: '#1e3fd4',
  teal: '#19c4c4',
  orange: '#ff8f1f',
  lightBlue: '#aecbff',
  purple: '#7c5cff',
  green: '#18a058',
  red: '#f53f3f',
  yellow: '#f7ba1e',
  grid: '#edf0f3',
  axis: '#a9b0bc',
  label: '#4e5969',
  tooltipBorder: '#e5e6eb'
};
var CR_COLORS = [
  CR.blue, CR.teal, CR.orange, CR.purple, CR.green,
  CR.yellow, CR.red, CR.lightBlue, CR.deepBlue, '#5aa7ff'
];

function crNum(v) { return Number(v) || 0; }
function crColor(i) { return CR_COLORS[i % CR_COLORS.length]; }

/* 大金额简写：过万显示亿（含负值），否则千分位 */
function crMoney(v) {
  v = crNum(v);
  var sign = v < 0 ? '-' : '';
  var a = Math.abs(v);
  if (a >= 10000) {
    var s = (a / 10000).toFixed(2).replace(/\.?0+$/, '');
    return sign + s + '亿';
  }
  return sign + a.toLocaleString();
}

/* 通用数值文本：轴格式决定展示 */
function crFmt(v, fmt) {
  v = crNum(v);
  if (fmt === 'money') { return crMoney(v); }
  if (fmt === 'percent') { return v + '%'; }
  return v.toLocaleString();
}
function crValueText(v, fmt) {
  v = crNum(v);
  if (fmt === 'money') { return v.toLocaleString() + ' 万元'; }
  if (fmt === 'percent') { return v + ' %'; }
  return v.toLocaleString();
}
function crAxisFormatter(fmt) {
  if (fmt === 'money') { return function (v) { return crMoney(v); }; }
  if (fmt === 'percent') { return function (v) { return v + '%'; }; }
  return null;
}

/* #rrggbb + alpha → rgba() */
function crHexA(hex, a) {
  var h = String(hex || CR.blue).replace('#', '');
  if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
  var r = parseInt(h.slice(0, 2), 16);
  var g = parseInt(h.slice(2, 4), 16);
  var b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

function crBaseAxis() {
  return {
    axisTick: { show: false },
    axisLine: { lineStyle: { color: '#e5e6eb' } },
    axisLabel: { color: CR.axis, fontSize: 11 }
  };
}
function crTooltipBase(extra) {
  return Object.assign({
    trigger: 'axis',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderColor: CR.tooltipBorder,
    textStyle: { color: '#1d2129', fontSize: 12 }
  }, extra || {});
}

/* 从季度数组聚合年度。agg：ending=年末季度值（时点类）；sum=四季度合计（流量类）。
   非季度格式类目回退为每年最后一个值。 */
function crAnnual(cats, vals, agg) {
  var order = [];
  var q4 = {};
  var last = {};
  var sum = {};
  var qcnt = {};
  var sawQuarter = false;
  for (var i = 0; i < cats.length; i++) {
    var raw = String(cats[i]);
    var m = raw.match(/^(\d{4})\s*[Qq]?\s*([1-4])?$/);
    var y = m ? m[1] : raw.replace(/年$/, '');
    var q = m && m[2] ? Number(m[2]) : null;
    var v = crNum(vals[i]);
    if (q) { sawQuarter = true; }
    if (!(y in last)) { order.push(y); qcnt[y] = 0; sum[y] = 0; }
    last[y] = v;
    qcnt[y] += 1;
    sum[y] += v;
    if (q === 4) { q4[y] = v; }
  }
  var years = order;
  if (sawQuarter) {
    if (agg === 'sum') {
      years = order.filter(function (yy) { return qcnt[yy] === 4; });
    } else {
      var hasQ4 = order.some(function (yy) { return yy in q4; });
      years = hasQ4 ? order.filter(function (yy) { return yy in q4; }) : order;
    }
  }
  return {
    cats: years.map(function (yy) { return yy + '年'; }),
    vals: years.map(function (yy) {
      if (agg === 'sum') { return sum[yy]; }
      return (yy in q4) ? q4[yy] : last[yy];
    })
  };
}

/* ============================================================
 * 族 1：cartesian 柱线（横向 / 堆叠 / 百分比堆叠 / 双轴 / 年季切换）
 * ============================================================ */

function crSeriesData(cfg, s, annual) {
  if (annual) { return crAnnual(cfg.categories, s.values, cfg.annualMode || 'ending'); }
  return { cats: cfg.categories, vals: s.values.map(crNum) };
}

function crRotate(cats) { return cats.length > 6 ? 38 : 0; }

function buildOption(cfg, mode) {
  var annual = cfg.yearQuarter && mode === 'year';
  var resolved = cfg.series.map(function (s) {
    var src = crSeriesData(cfg, s, annual);
    return { s: s, cats: src.cats, vals: src.vals };
  });
  var cats = resolved[0].cats;
  var hasBar = cfg.series.some(function (s) { return s.type === 'bar'; });
  var hasRightSeries = cfg.series.some(function (s) { return s.axis === 'right'; });
  var showRight = hasRightSeries && cfg.rightAxis;
  var leftFmt = (cfg.leftAxis && cfg.leftAxis.format) || 'number';
  var rightFmt = (cfg.rightAxis && cfg.rightAxis.format) || 'number';
  var nSeries = cfg.series.length;
  var horizontal = !!cfg.horizontal;
  var stack = cfg.stack || 'none';
  var pct = stack === 'percent';

  /* 百分比堆叠：按类目合计把柱值换算成百分比 */
  var pctLookup = {};
  if (pct) {
    var totals = cats.map(function (_, ci) {
      return resolved.reduce(function (acc, r) {
        return acc + (r.s.type === 'bar' ? Math.max(0, crNum(r.vals[ci])) : 0);
      }, 0);
    });
    resolved.forEach(function (r, si) {
      r.pctVals = r.vals.map(function (v, ci) {
        if (r.s.type !== 'bar' || !totals[ci]) { return 0; }
        return Math.round(Math.max(0, crNum(v)) / totals[ci] * 1000) / 10;
      });
      pctLookup[si] = {};
      r.pctVals.forEach(function (pv, ci) { pctLookup[si][cats[ci]] = pv; });
    });
  }

  var shortMap = {};
  cfg.series.forEach(function (s) { if (s.short) { shortMap[s.name] = s.short; } });

  function valueAxis(isRight) {
    var fmt = isRight ? rightFmt : leftFmt;
    var ax = {
      type: 'value',
      scale: !hasBar,
      axisLabel: { color: CR.axis, fontSize: 11 },
      splitLine: { show: !isRight, lineStyle: { color: CR.grid, type: 'dashed' } }
    };
    var f = crAxisFormatter(pct ? 'percent' : fmt);
    if (f) { ax.axisLabel.formatter = f; }
    if (isRight) { ax.splitLine = { show: false }; }
    return ax;
  }
  function categoryAxis() {
    return Object.assign(crBaseAxis(), {
      type: 'category',
      boundaryGap: hasBar,
      data: cats,
      axisLabel: {
        color: CR.axis, fontSize: 11,
        rotate: horizontal ? 0 : crRotate(cats),
        margin: 12
      }
    });
  }

  var series = resolved.map(function (r, si) {
    var s = r.s;
    var onRight = s.axis === 'right' && showRight;
    var axisIdx = onRight ? 1 : 0;
    var fmt = onRight ? rightFmt : leftFmt;
    var color = s.color || crColor(si);
    var isBar = s.type === 'bar';
    var vals = pct && isBar ? r.pctVals : r.vals;

    function barLabel(v) {
      var pos = horizontal ? (crNum(v) >= 0 ? 'right' : 'left') : (crNum(v) >= 0 ? 'top' : 'bottom');
      var text = pct ? crNum(v) + '%' : crFmt(v, fmt);
      return { show: true, fontSize: 10, color: '#6b7280', position: pos, formatter: text };
    }
    function lineLabel() {
      return {
        show: true, position: 'top', fontSize: 10, color: '#6b7280',
        formatter: function (p) {
          var v = p.value;
          return pct ? crNum(v) + '%' : crFmt(v, fmt);
        }
      };
    }

    var out;
    if (isBar) {
      out = {
        name: s.name, type: 'bar',
        barMaxWidth: nSeries > 2 ? 30 : 42,
        data: vals.map(function (raw, ci) {
          var v = crNum(raw);
          var orig = crNum(r.vals[ci]);
          return {
            value: v,
            itemStyle: {
              color: color,
              borderRadius: horizontal
                ? (v >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3])
                : (v >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3])
            },
            label: s.showLabel ? barLabel(v) : { show: false },
            /* tooltip 百分比堆叠时取原值用 */
            _orig: orig
          };
        })
      };
      if (stack !== 'none') { out.stack = '__pf_stack__'; out.barMaxWidth = 46; }
      if (horizontal) { out.xAxisIndex = axisIdx; }
      else { out.yAxisIndex = axisIdx; }
    } else {
      out = {
        name: s.name, type: 'line',
        data: vals, smooth: true,
        symbol: 'circle', symbolSize: 6,
        lineStyle: { width: 2, color: color },
        itemStyle: { color: color },
        label: s.showLabel ? lineLabel() : { show: false }
      };
      if (s.type === 'area') {
        var c = color;
        out.areaStyle = {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: crHexA(c, 0.16) },
            { offset: 1, color: crHexA(c, 0.01) }
          ]
        };
      }
      if (horizontal) { out.xAxisIndex = axisIdx; }
      else { out.yAxisIndex = axisIdx; }
    }
    return out;
  });

  var grid = horizontal
    ? { left: 84, right: showRight ? 64 : 28, top: 64, bottom: 36 }
    : { left: 56, right: showRight ? 56 : 24, top: 64, bottom: crRotate(cats) ? 48 : 36 };

  var tooltipFmt = function (sc) {
    return (sc.axis === 'right' && showRight) ? rightFmt : leftFmt;
  };
  var tooltip = crTooltipBase({
    axisPointer: { type: hasBar ? 'shadow' : 'line', lineStyle: { color: '#c9cdd4', type: 'dashed' } }
  });
  tooltip.formatter = function (ps) {
    var html = ps[0].axisValue + '<br/>';
    ps.forEach(function (p) {
      var sc = cfg.series[p.seriesIndex] || {};
      var f = tooltipFmt(sc);
      var nm = sc.short ? sc.name : p.seriesName;
      var valTxt = crValueText(p.value, f);
      var extra = '';
      if (pct && sc.type === 'bar') {
        var pv = pctLookup[p.seriesIndex][p.axisValue];
        var orig = p.data && p.data._orig != null ? p.data._orig : p.value;
        valTxt = crNum(orig).toLocaleString() + ' 万元';
        extra = '（占比 ' + pv + '%）';
      }
      html += p.marker + nm + '：' + valTxt + extra + '<br/>';
    });
    return html;
  };

  var option = {
    color: cfg.series.map(function (s, i) { return s.color || crColor(i); }),
    legend: {
      top: 6, left: 72, right: showRight ? 64 : 24, itemGap: 12,
      itemWidth: 12, itemHeight: 8,
      textStyle: { fontSize: 11, color: CR.label },
      formatter: function (name) { return shortMap[name] || name; }
    },
    grid: grid,
    tooltip: tooltip
  };

  if (horizontal) {
    option.xAxis = showRight ? [valueAxis(false), valueAxis(true)] : [valueAxis(false)];
    var catY = categoryAxis();
    catY.inverse = true;
    option.yAxis = catY;
  } else {
    option.xAxis = categoryAxis();
    option.yAxis = showRight ? [valueAxis(false), valueAxis(true)] : [valueAxis(false)];
  }
  option.series = series;
  option.textStyle = { fontFamily: CR_FONT };
  return option;
}

/* ============================================================
 * 族 2：waterfall 瀑布
 * ============================================================ */

function buildWaterfallOption(cfg) {
  var rows = cfg.rows || [];
  var cats = rows.map(function (r) { return r.name; });
  var bases = [];
  var deltas = [];
  var ends = [];
  var colors = { start: CR.blue, add: CR.green, sub: CR.orange, total: CR.deepBlue };
  var cum = 0;
  rows.forEach(function (r) {
    var v = crNum(r.value);
    if (r.kind === 'start') {
      bases.push(0); deltas.push(v); cum = v; ends.push(v);
    } else if (r.kind === 'add') {
      bases.push(cum); deltas.push(v); cum += v; ends.push(cum);
    } else if (r.kind === 'sub') {
      cum -= v; bases.push(cum); deltas.push(v); ends.push(cum);
    } else {
      var tv = v > 0 ? v : cum;
      bases.push(0); deltas.push(tv); cum = tv; ends.push(tv);
    }
  });
  var showLabel = cfg.showLabel !== false;
  var mkLabel = function (isDelta) {
    return function (p) {
      var row = rows[p.dataIndex];
      if (!row) { return ''; }
      if (row.kind === 'add') { return '+' + crMoney(crNum(row.value)); }
      if (row.kind === 'sub') { return '-' + crMoney(crNum(row.value)); }
      return crMoney(crNum(p.value));
    };
  };
  var option = {
    textStyle: { fontFamily: CR_FONT },
    grid: { left: 56, right: 24, top: 40, bottom: 56 },
    tooltip: crTooltipBase({
      axisPointer: { type: 'shadow' },
      formatter: function (ps) {
        var i = ps[0].dataIndex;
        var row = rows[i];
        var sign = row.kind === 'add' ? '+' : row.kind === 'sub' ? '-' : '';
        var valTxt = (row.kind === 'start' || row.kind === 'total')
          ? crMoney(ends[i])
          : sign + crMoney(crNum(row.value));
        return row.name + '<br/>' + valTxt + ' 万元<br/><span style="color:#a9b0bc">余额 ' + crMoney(ends[i]) + '</span>';
      }
    }),
    xAxis: Object.assign(crBaseAxis(), {
      type: 'category', data: cats,
      axisLabel: { color: CR.axis, fontSize: 11, rotate: 28, margin: 12 }
    }),
    yAxis: {
      type: 'value', min: 0,
      axisLabel: { color: CR.axis, fontSize: 11, formatter: function (v) { return crMoney(v); } },
      splitLine: { lineStyle: { color: CR.grid, type: 'dashed' } },
      axisLine: { show: false }, axisTick: { show: false }
    },
    series: [
      {
        name: '_base', type: 'bar', stack: 'wf', barMaxWidth: 46,
        itemStyle: { color: 'transparent' },
        emphasis: { itemStyle: { color: 'transparent' } },
        tooltip: { show: false },
        silent: true,
        data: bases
      },
      {
        name: '_val', type: 'bar', stack: 'wf', barMaxWidth: 46,
        data: deltas.map(function (d, i) {
          var k = rows[i].kind;
          return {
            value: d,
            itemStyle: { color: colors[k] || CR.blue, borderRadius: [3, 3, 0, 0] },
            label: showLabel ? {
              show: true, position: 'top', fontSize: 10, color: '#6b7280',
              formatter: mkLabel(true)
            } : { show: false }
          };
        })
      }
    ]
  };
  return option;
}

/* ============================================================
 * 族 3：pie 饼 / 环 / 玫瑰 / 嵌套双饼
 * ============================================================ */

function crPieTotal(items) {
  return (items || []).reduce(function (a, it) { return a + Math.max(0, crNum(it.value)); }, 0);
}

function buildPieOption(cfg) {
  var variant = cfg.variant || 'pie';
  var items = (cfg.items || []).map(function (it, i) {
    return { name: it.name, value: Math.max(0, crNum(it.value)), itemStyle: { color: it.color || crColor(i) } };
  });
  var total = crPieTotal(cfg.items);
  var showLabel = cfg.showLabel !== false;

  var labelOuter = {
    show: showLabel, fontSize: 11, color: CR.label,
    formatter: function (p) { return p.name + '\n' + p.percent + '%'; }
  };
  var labelLine = { length: 8, length2: 8, lineStyle: { color: '#d8dce3' } };

  var series;
  var title = null;

  if (variant === 'nested') {
    var parentOrder = [];
    var parentSum = {};
    var parentColor = {};
    (cfg.items || []).forEach(function (it) {
      var p = it.parent || '其他';
      if (!(p in parentSum)) { parentOrder.push(p); parentSum[p] = 0; parentColor[p] = crColor(parentOrder.length - 1); }
      parentSum[p] += Math.max(0, crNum(it.value));
    });
    var innerData = parentOrder.map(function (p) {
      return { name: p, value: Math.round(parentSum[p] * 100) / 100, itemStyle: { color: parentColor[p] } };
    });
    var outerData = (cfg.items || []).map(function (it) {
      var p = it.parent || '其他';
      return {
        name: it.name, value: Math.max(0, crNum(it.value)),
        itemStyle: { color: it.color || parentColor[p] }
      };
    });
    series = [
      {
        name: '_inner', type: 'pie', radius: [0, '38%'], center: ['50%', '46%'],
        label: { show: true, fontSize: 12, color: '#fff', fontWeight: 600, formatter: '{b}' },
        labelLine: { show: false },
        data: innerData
      },
      {
        name: '_outer', type: 'pie', radius: ['46%', '70%'], center: ['50%', '46%'],
        label: {
          show: showLabel, fontSize: 10, color: CR.label,
          formatter: function (p) { return p.name + ' ' + p.percent + '%'; }
        },
        labelLine: labelLine,
        data: outerData
      }
    ];
  } else {
    var common = {
      name: '_pie', type: 'pie',
      center: ['50%', variant === 'donut' ? '45%' : '47%'],
      data: items,
      label: variant === 'pie' ? labelOuter : {
        show: showLabel, fontSize: 11, color: CR.label,
        formatter: function (p) { return p.name + ' ' + p.percent + '%'; }
      },
      labelLine: labelLine,
      itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 3 }
    };
    if (variant === 'donut') {
      common.radius = ['46%', '69%'];
      common.label = { show: showLabel, fontSize: 11, color: CR.label, formatter: '{b}\n{d}%' };
      title = {
        text: crMoney(total),
        subtext: cfg.centerTitle || '合计',
        left: 'center', top: '36%',
        textStyle: { fontSize: 20, fontWeight: 600, color: '#1d2129' },
        subtextStyle: { fontSize: 12, color: '#869099' },
        itemGap: 4
      };
    } else if (variant === 'rose') {
      common.radius = ['18%', '70%'];
      common.roseType = 'radius';
      common.center = ['50%', '47%'];
    } else {
      common.radius = '66%';
    }
    series = [common];
  }

  var option = {
    textStyle: { fontFamily: CR_FONT },
    color: CR_COLORS,
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: CR.tooltipBorder,
      textStyle: { color: '#1d2129', fontSize: 12 },
      formatter: function (p) {
        return p.name + '<br/>' + p.marker + crNum(p.value).toLocaleString() + ' 万元（' + p.percent + '%）';
      }
    },
    legend: {
      bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 14,
      textStyle: { fontSize: 11, color: CR.label }
    },
    series: series
  };
  if (title) { option.title = title; }
  return option;
}

/* ============================================================
 * 族 4：funnel 漏斗
 * ============================================================ */

function buildFunnelOption(cfg) {
  var stages = (cfg.stages || []).map(function (st) {
    return { name: st.name, value: Math.max(0, crNum(st.value)) };
  }).sort(function (a, b) { return b.value - a.value; });
  var rateMap = {};
  stages.forEach(function (st, i) {
    rateMap[st.name] = i === 0 ? 100 : (st.value && stages[i - 1].value ? Math.round(st.value / stages[i - 1].value * 1000) / 10 : 0);
  });
  var showRate = cfg.showRate !== false;
  var data = stages.map(function (st, i) {
    return {
      name: st.name, value: st.value,
      itemStyle: { color: crColor(i), borderColor: '#fff', borderWidth: 1 },
      rate: rateMap[st.name]
    };
  });
  var option = {
    textStyle: { fontFamily: CR_FONT },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: CR.tooltipBorder,
      textStyle: { color: '#1d2129', fontSize: 12 },
      formatter: function (p) {
        return p.name + '<br/>数量：' + crNum(p.value).toLocaleString() + '<br/>相对上阶段：' + p.data.rate + '%';
      }
    },
    series: [{
      name: '_funnel', type: 'funnel',
      left: '8%', right: '8%', top: 16, bottom: 16,
      minSize: '28%', maxSize: '100%',
      gap: 3,
      sort: 'none',
      label: {
        show: true, position: 'inside', fontSize: 12, color: '#fff', fontWeight: 500,
        formatter: function (p) {
          return showRate ? p.name + '  ' + p.data.rate + '%' : p.name;
        }
      },
      labelLine: { show: false },
      emphasis: { label: { fontSize: 13 } },
      data: data
    }]
  };
  return option;
}

/* ============================================================
 * 族 5：radar 雷达
 * ============================================================ */

function crNiceMax(v) {
  v = crNum(v);
  if (v <= 0) { return 100; }
  if (v <= 100) { return Math.ceil(v / 10) * 10; }
  var pow = Math.pow(10, String(Math.round(v)).length - 1);
  return Math.ceil(v * 1.15 / pow * 10) / 10 * pow;
}

function buildRadarOption(cfg) {
  var entities = cfg.entities || [];
  var dataMax = 0;
  entities.forEach(function (e) {
    (e.values || []).forEach(function (v) { dataMax = Math.max(dataMax, crNum(v)); });
  });
  var max = crNum(cfg.max) > 0 ? crNum(cfg.max) : crNiceMax(dataMax);
  var option = {
    textStyle: { fontFamily: CR_FONT },
    color: entities.map(function (e, i) { return e.color || crColor(i); }),
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: CR.tooltipBorder,
      textStyle: { color: '#1d2129', fontSize: 12 }
    },
    radar: {
      indicator: (cfg.dimensions || []).map(function (d) { return { name: d, max: max }; }),
      center: ['50%', '55%'],
      radius: '60%',
      axisName: { color: '#869099', fontSize: 11 },
      splitLine: { lineStyle: { color: CR.grid } },
      splitArea: { areaStyle: { color: ['#fff', '#fafbfd'] } },
      axisLine: { lineStyle: { color: '#e5e8ef' } }
    },
    legend: {
      bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 14,
      textStyle: { fontSize: 11, color: CR.label }
    },
    series: [{
      type: 'radar',
      symbol: 'circle', symbolSize: 5,
      data: entities.map(function (e, i) {
        var c = e.color || crColor(i);
        return {
          name: e.name,
          value: (e.values || []).map(crNum),
          lineStyle: { width: 2, color: c },
          itemStyle: { color: c },
          areaStyle: e.fill ? { color: crHexA(c, 0.16) } : undefined
        };
      })
    }]
  };
  return option;
}

/* ============================================================
 * 族 6：scatter 散点 / 气泡
 * ============================================================ */

function buildScatterOption(cfg) {
  var groups = cfg.groups || [];
  var bubble = !!cfg.bubble;
  var allSizes = [];
  groups.forEach(function (g) {
    (g.points || []).forEach(function (p) { allSizes.push(crNum(p.size)); });
  });
  var sMin = allSizes.length ? Math.min.apply(null, allSizes) : 0;
  var sMax = allSizes.length ? Math.max.apply(null, allSizes) : 1;
  var xFmt = cfg.xAxisFmt || 'number';
  var yFmt = cfg.yAxisFmt || 'number';

  var series = groups.map(function (g, gi) {
    var color = g.color || crColor(gi);
    return {
      name: g.name, type: 'scatter',
      data: (g.points || []).map(function (p) { return { name: p.name, value: [crNum(p.x), crNum(p.y), crNum(p.size)] }; }),
      symbolSize: bubble ? function (val) {
        var s = crNum(val[2]);
        if (sMax === sMin) { return 18; }
        return 12 + (s - sMin) / (sMax - sMin) * 30;
      } : 12,
      itemStyle: { color: crHexA(color, 0.78), borderColor: color, borderWidth: 1 },
      emphasis: { itemStyle: { color: color } }
    };
  });

  var option = {
    textStyle: { fontFamily: CR_FONT },
    color: groups.map(function (g, i) { return g.color || crColor(i); }),
    grid: { left: 60, right: 28, top: 56, bottom: 56 },
    legend: {
      top: 4, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 14,
      textStyle: { fontSize: 11, color: CR.label }
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: CR.tooltipBorder,
      textStyle: { color: '#1d2129', fontSize: 12 },
      formatter: function (p) {
        var v = p.value;
        var html = p.data.name + '（' + p.seriesName + '）<br/>';
        html += (cfg.xName || 'X') + '：' + crValueText(v[0], xFmt) + '<br/>';
        html += (cfg.yName || 'Y') + '：' + crValueText(v[1], yFmt);
        if (bubble) { html += '<br/>规模：' + crNum(v[2]).toLocaleString(); }
        return html;
      }
    },
    xAxis: {
      type: 'value', scale: true, name: cfg.xName || '',
      nameLocation: 'middle', nameGap: 32,
      nameTextStyle: { color: '#869099', fontSize: 11 },
      axisLabel: { color: CR.axis, fontSize: 11, formatter: crAxisFormatter(xFmt) || undefined },
      splitLine: { lineStyle: { color: CR.grid, type: 'dashed' } },
      axisLine: { show: false }, axisTick: { show: false }
    },
    yAxis: {
      type: 'value', scale: true, name: cfg.yName || '',
      nameLocation: 'middle', nameGap: 44,
      nameTextStyle: { color: '#869099', fontSize: 11 },
      axisLabel: { color: CR.axis, fontSize: 11, formatter: crAxisFormatter(yFmt) || undefined },
      splitLine: { lineStyle: { color: CR.grid, type: 'dashed' } },
      axisLine: { show: false }, axisTick: { show: false }
    },
    series: series
  };
  return option;
}

/* ============================================================
 * 族 7：gauge 仪表盘
 * ============================================================ */

function buildGaugeOption(cfg) {
  var min = crNum(cfg.min);
  var max = crNum(cfg.max) || 100;
  var decimals = crNum(cfg.decimals) || 0;
  var segRanges = (cfg.segs || []).map(function (sg) {
    return [Math.min(1, Math.max(0, (crNum(sg.to) - min) / (max - min))), sg.color || CR.green];
  });
  if (!segRanges.length) { segRanges.push([1, CR.green]); }
  var option = {
    textStyle: { fontFamily: CR_FONT },
    series: [{
      type: 'gauge',
      center: ['50%', '60%'],
      radius: '88%',
      min: min, max: max,
      startAngle: 210, endAngle: -30,
      axisLine: {
        lineStyle: { width: 16, color: segRanges }
      },
      progress: { show: false },
      pointer: { itemStyle: { color: '#4e5969' }, length: '62%', width: 4 },
      anchor: { show: true, size: 10, itemStyle: { color: '#4e5969', borderColor: '#fff', borderWidth: 2 } },
      axisTick: { distance: -16, length: 5, lineStyle: { color: '#fff', width: 1 } },
      splitLine: { distance: -16, length: 10, lineStyle: { color: '#fff', width: 2 } },
      axisLabel: { color: CR.axis, fontSize: 10, distance: -28 },
      detail: {
        valueAnimation: true,
        offsetCenter: [0, '38%'],
        fontSize: 26, fontWeight: 600, color: '#1d2129',
        formatter: function (v) { return Number(v).toFixed(decimals) + (cfg.unit || ''); }
      },
      title: { show: false },
      data: [{ value: crNum(cfg.value), name: '' }]
    }]
  };
  return option;
}

/* ============================================================
 * 族 8：treemap 矩形树图
 * ============================================================ */

function buildTreemapOption(cfg) {
  var rootOrder = [];
  var buckets = {};
  (cfg.items || []).forEach(function (it) {
    var p = it.parent || '其他';
    if (!(p in buckets)) { rootOrder.push(p); buckets[p] = []; }
    buckets[p].push({ name: it.name, value: Math.max(0, crNum(it.value)) });
  });
  var data = rootOrder.map(function (p, i) {
    return {
      name: p,
      itemStyle: { color: crColor(i) },
      children: buckets[p]
    };
  });
  var option = {
    textStyle: { fontFamily: CR_FONT },
    color: CR_COLORS,
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: CR.tooltipBorder,
      textStyle: { color: '#1d2129', fontSize: 12 },
      formatter: function (p) {
        var path = (p.treePathInfo || []).map(function (n) { return n.name; }).filter(Boolean).slice(1).join(' / ');
        return (path || p.name) + '<br/>' + crMoney(crNum(p.value)) + ' 万元';
      }
    },
    series: [{
      type: 'treemap',
      left: 8, right: 8, top: 8, bottom: 8,
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      label: { show: true, fontSize: 12, color: '#fff', fontWeight: 500 },
      upperLabel: { show: true, height: 22, color: '#fff', fontSize: 12, fontWeight: 600 },
      itemStyle: { borderColor: '#fff', borderWidth: 2, gapWidth: 2 },
      levels: [
        { itemStyle: { borderWidth: 0, gapWidth: 3 } },
        { itemStyle: { borderWidth: 2, gapWidth: 2, borderColor: '#fff' } }
      ],
      data: data
    }]
  };
  return option;
}

/* ============================================================
 * 族 9：heatmap 热力图
 * ============================================================ */

function buildHeatmapOption(cfg) {
  var cols = cfg.cols || [];
  var rows = cfg.rows || [];
  var points = [];
  var vMin = Infinity;
  var vMax = -Infinity;
  rows.forEach(function (r, yi) {
    cols.forEach(function (c, xi) {
      var v = crNum((r.values || [])[xi]);
      points.push([xi, yi, v]);
      if (v < vMin) { vMin = v; }
      if (v > vMax) { vMax = v; }
    });
  });
  if (!isFinite(vMin)) { vMin = 0; vMax = 1; }
  var showLabel = cfg.showLabel === true;
  var option = {
    textStyle: { fontFamily: CR_FONT },
    grid: { left: 84, right: 20, top: 28, bottom: 76 },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: CR.tooltipBorder,
      textStyle: { color: '#1d2129', fontSize: 12 },
      formatter: function (p) {
        var v = p.value;
        return rows[v[1]].name + ' · ' + cols[v[0]] + '<br/>' + crMoney(v[2]) + ' 万元';
      }
    },
    xAxis: Object.assign(crBaseAxis(), {
      type: 'category', data: cols, splitArea: { show: false },
      axisLabel: { color: CR.axis, fontSize: 11, margin: 10 }
    }),
    yAxis: Object.assign(crBaseAxis(), {
      type: 'category', data: rows.map(function (r) { return r.name; }), splitArea: { show: false },
      axisLabel: { color: CR.axis, fontSize: 11 }
    }),
    visualMap: {
      min: vMin, max: vMax,
      calculable: true,
      orient: 'horizontal',
      left: 'center', bottom: 8,
      itemWidth: 12, itemHeight: 140,
      textStyle: { color: CR.axis, fontSize: 10 },
      formatter: function (v) { return crMoney(v); },
      inRange: { color: ['#eef3ff', '#b9cdff', '#5a86f7', CR.blue, CR.deepBlue] }
    },
    series: [{
      type: 'heatmap',
      data: points,
      label: {
        show: showLabel,
        fontSize: 10, color: '#4e5969',
        formatter: function (p) { return crMoney(p.value[2]); }
      },
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.2)' } }
    }]
  };
  return option;
}

/* ============================================================
 * 族 10：sankey 桑基
 * ============================================================ */

function buildSankeyOption(cfg) {
  var nodeSet = {};
  (cfg.nodes || []).forEach(function (n) { nodeSet[String(n)] = 1; });
  (cfg.links || []).forEach(function (l) {
    nodeSet[String(l.source)] = 1;
    nodeSet[String(l.target)] = 1;
  });
  var data = Object.keys(nodeSet).map(function (n) { return { name: n }; });
  var links = (cfg.links || []).map(function (l) {
    return { source: String(l.source), target: String(l.target), value: Math.max(0, crNum(l.value)) };
  });
  var option = {
    textStyle: { fontFamily: CR_FONT },
    color: CR_COLORS,
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: CR.tooltipBorder,
      textStyle: { color: '#1d2129', fontSize: 12 },
      formatter: function (p) {
        if (p.dataType === 'edge') {
          return p.data.source + ' → ' + p.data.target + '<br/>' + crMoney(p.data.value) + ' 万元';
        }
        return p.name;
      }
    },
    series: [{
      type: 'sankey',
      left: 96, right: 120, top: 16, bottom: 16,
      nodeWidth: 14, nodeGap: 12,
      layoutIterations: 32,
      emphasis: { focus: 'adjacency' },
      data: data,
      links: links,
      label: { fontSize: 11, color: CR.label },
      lineStyle: { color: 'gradient', opacity: 0.32, curveness: 0.5 },
      itemStyle: { borderWidth: 0 }
    }]
  };
  return option;
}

/* ============================================================
 * 分发：向导配置 → ECharts option
 * ============================================================ */

export function buildWizardOption(cfg, mode) {
  var fam = cfg.family || 'cartesian';
  if (fam === 'waterfall') { return buildWaterfallOption(cfg); }
  if (fam === 'pie') { return buildPieOption(cfg); }
  if (fam === 'funnel') { return buildFunnelOption(cfg); }
  if (fam === 'radar') { return buildRadarOption(cfg); }
  if (fam === 'scatter') { return buildScatterOption(cfg); }
  if (fam === 'gauge') { return buildGaugeOption(cfg); }
  if (fam === 'treemap') { return buildTreemapOption(cfg); }
  if (fam === 'heatmap') { return buildHeatmapOption(cfg); }
  if (fam === 'sankey') { return buildSankeyOption(cfg); }
  return buildOption(cfg, mode);
}

/* Axure 元件本身是 position:absolute；只在 static 时补 relative，
   绝不能把 absolute 改成 relative，否则元件脱离 Axure 定位、整图跑偏。 */
function crEnsurePosition(el) {
  var pos = '';
  if (window.getComputedStyle) { pos = window.getComputedStyle(el).position; }
  if (pos === 'static' || pos === '') { el.style.position = 'relative'; }
}

function crChart(el, echarts) {
  var old = echarts.getInstanceByDom(el);
  if (old) { old.dispose(); }
  var chart = echarts.init(el);
  setTimeout(function () { chart.resize(); }, 60);
  return chart;
}

function crOverlays(el, cfg, chart, build) {
  function overlay(css) {
    var d = document.createElement('div');
    d.className = 'cr-overlay';
    d.style.cssText = 'position:absolute;z-index:6;font-family:' + CR_FONT + ';pointer-events:none;' + css;
    el.appendChild(d);
    return d;
  }
  var fam = cfg.family || 'cartesian';
  var unitTop = fam === 'cartesian' ? '38px' : '8px';
  if (cfg.unitTag && fam !== 'gauge') {
    overlay('left:10px;top:' + unitTop + ';font-size:12px;color:#869099;').textContent = cfg.unitTag;
  }
  if (cfg.period && !cfg.yearQuarter) {
    overlay('right:6px;top:8px;font-size:13px;color:#a9b0bc;').textContent = cfg.period;
  }
  if (cfg.yearQuarter && fam === 'cartesian') {
    var box = document.createElement('div');
    box.className = 'cr-overlay';
    box.style.cssText = 'position:absolute;right:6px;top:6px;z-index:7;display:flex;gap:14px;font-family:' + CR_FONT + ';';
    var mode = 'year';
    ['year', 'quarter'].forEach(function (m) {
      var b = document.createElement('span');
      b.textContent = m === 'year' ? '年度' : '季度';
      b.dataset.crMode = m;
      b.style.cssText = 'cursor:pointer;font-size:13px;color:#a9b0bc;pointer-events:auto;';
      b.onclick = function () {
        mode = m;
        chart.setOption(build(m), true);
        Array.prototype.forEach.call(box.children, function (x) {
          var on = x.dataset.crMode === mode;
          x.style.color = on ? '#1d2129' : '#a9b0bc';
          x.style.fontWeight = on ? '600' : '400';
        });
      };
      box.appendChild(b);
    });
    el.appendChild(box);
    Array.prototype.forEach.call(box.children, function (x) {
      var on = x.dataset.crMode === mode;
      x.style.color = on ? '#1d2129' : '#a9b0bc';
      x.style.fontWeight = on ? '600' : '400';
    });
  }
}

function crObserveResize(el, echarts, chart) {
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { chart.resize(); });
    ro.observe(el);
    el.__crRO = ro;
  }
}

/* 向导模式：CFG 驱动整图（v3 按 family 分发） */
export function mountChart(el, echarts, cfg) {
  if (!el || !echarts || !cfg) { return null; }
  if (el.__crTimers) {
    el.__crTimers.forEach(function (id) { clearInterval(id); clearTimeout(id); });
    el.__crTimers = [];
  }
  crEnsurePosition(el);
  Array.prototype.forEach.call(el.querySelectorAll('.cr-overlay'), function (n) { n.remove(); });
  var chart = crChart(el, echarts);
  chart.setOption(buildWizardOption(cfg, cfg.yearQuarter ? 'year' : undefined));
  crOverlays(el, cfg, chart, function (m) { return buildWizardOption(cfg, m); });
  crObserveResize(el, echarts, chart);
  return chart;
}

/* C 路线：自定义 option 源码。两种形态都支持：
   1) 对象字面量 (可含 formatter 等函数)，new Function('return ('+src+')')()
   2) ECharts 官网示例风格的完整脚本：前面定义数据函数/变量，中间 option = {...}，
   末尾可有 setInterval 动态刷新、myChart.setOption 调用。
   预览与注入共用本文件，保证所见即所得。 */
function crStripFence(source) {
  var src = String(source == null ? '' : source).trim();
  var fence = src.match(/```(?:js|javascript|json)?\s*([\s\S]*?)```/i);
  if (fence) { src = fence[1].trim(); }
  return src;
}

/* 字面量形态求值 */
export function crEvalOption(source) {
  var src = crStripFence(source);
  if (!src) { throw new Error('option 是空的'); }
  var option = new Function('return (' + src + ');')();
  if (!option || typeof option !== 'object') { throw new Error('求值结果不是 ECharts option 对象'); }
  return option;
}

/* 脚本形态特征：option 赋值（裸/var/let/const）或直接 myChart.setOption */
var CR_SCRIPT_HINT = /(^|[\s;{}])(?:var\s+|let\s+|const\s+)?option\s*=(?!=)|myChart\.setOption\s*\(/;
var CR_SCRIPT_ARGS = ['myChart', 'echarts', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout'];
var CR_SCRIPT_TAIL = '\n;return (typeof option!=="undefined")?option:null;';

/* 分类：literal 对象字面量 / script 完整脚本；都不是就抛真实错误 */
export function crClassifySource(source) {
  var src = crStripFence(source);
  if (!src) { throw new Error('option 是空的'); }
  try {
    var option = new Function('return (' + src + ');')();
    if (option && typeof option === 'object') { return { kind: 'literal', src: src, option: option }; }
  } catch (e) { /* 可能是脚本形态，继续判断 */ }
  if (CR_SCRIPT_HINT.test(src)) { return { kind: 'script', src: src, option: null }; }
  var err;
  try { new Function('return (' + src + ');')(); } catch (e) { err = e; }
  throw err || new Error('看不出是 ECharts option：粘对象字面量，或含 option = {...} 的完整示例代码');
}

/* 只校验不挂载：字面量求值验结构；脚本只做构造期语法检查（不执行，避免注册定时器） */
export function crCheckSource(source) {
  var c = crClassifySource(source);
  if (c.kind === 'literal') {
    if (!('series' in c.option) && !('xAxis' in c.option)) {
      throw new Error('看不出是 ECharts option（至少要有 series 或 xAxis）');
    }
    return c;
  }
  new Function(CR_SCRIPT_ARGS.join(','), c.src + CR_SCRIPT_TAIL);
  return c;
}

/* 完整脚本形态执行 */
function crRunScript(el, echarts, src) {
  if (el.__crTimers) {
    el.__crTimers.forEach(function (id) { clearInterval(id); clearTimeout(id); });
  }
  var timers = el.__crTimers = [];
  var wrapInterval = function (fn, ms) { var id = setInterval(fn, ms); timers.push(id); return id; };
  var wrapTimeout = function (fn, ms) {
    var id = setTimeout(function () {
      var i = timers.indexOf(id); if (i >= 0) { timers.splice(i, 1); }
      fn();
    }, ms);
    timers.push(id); return id;
  };
  var realChart = null;
  var earlyOption = null;
  var myChart = new Proxy({}, {
    get: function (t, k) {
      if (k === 'setOption') {
        return function () {
          if (realChart) { return realChart.setOption.apply(realChart, arguments); }
          earlyOption = arguments[0];
        };
      }
      if (realChart && typeof realChart[k] === 'function') {
        return function () { return realChart[k].apply(realChart, arguments); };
      }
      if (realChart) { return realChart[k]; }
      return function () {};
    },
    set: function (t, k, v) {
      if (realChart) { try { realChart[k] = v; } catch (e) {} }
      t[k] = v; return true;
    }
  });
  var fn = new Function(CR_SCRIPT_ARGS.join(','), src + CR_SCRIPT_TAIL);
  var option = fn(myChart, echarts, wrapInterval, wrapTimeout, clearInterval, clearTimeout) || earlyOption;
  if (!option || typeof option !== 'object') {
    throw new Error('脚本里没找到 option：需要 option = {...} 或 myChart.setOption(...)');
  }
  crEnsurePosition(el);
  Array.prototype.forEach.call(el.querySelectorAll('.cr-overlay'), function (n) { n.remove(); });
  var chart = crChart(el, echarts);
  chart.setOption(option, true);
  realChart = chart;
  crObserveResize(el, echarts, chart);
  return chart;
}

/* 源码 → 分类 → 求值/执行 → 挂载：预览端与 Axure 注入端统一入口 */
export function mountCustomSource(el, echarts, source) {
  if (!el || !echarts) { return null; }
  var c = crClassifySource(source);
  if (c.kind === 'script') { return crRunScript(el, echarts, c.src); }
  if (el.__crTimers) {
    el.__crTimers.forEach(function (id) { clearInterval(id); clearTimeout(id); });
    el.__crTimers = [];
  }
  return mountCustom(el, echarts, c.option);
}

/* C 路线：自定义 option，工具退化为预览+注入器；不叠加任何浮层 */
export function mountCustom(el, echarts, option) {
  if (!el || !echarts) { return null; }
  crEnsurePosition(el);
  Array.prototype.forEach.call(el.querySelectorAll('.cr-overlay'), function (n) { n.remove(); });
  var chart = crChart(el, echarts);
  chart.setOption(option, true);
  crObserveResize(el, echarts, chart);
  return chart;
}
