'use strict';
// إعداد سمة Chart.js الموحدة لهوية نملية — خط Cairo، شبكة خفيفة، تلميحات RTL

(function () {
  if (typeof Chart === 'undefined') return;
  const SURFACE = '#FBF8F1';
  const INK = '#2B2B23';
  const INK_MUTED = '#8A8A72';
  const GRID = '#EAE2CE';

  Chart.defaults.font.family = "'Cairo', 'Segoe UI', sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = INK_MUTED;

  Chart.defaults.plugins.legend.rtl = true;
  Chart.defaults.plugins.legend.textDirection = 'rtl';
  Chart.defaults.plugins.legend.labels.color = INK;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.boxHeight = 12;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;

  Chart.defaults.plugins.tooltip.rtl = true;
  Chart.defaults.plugins.tooltip.textDirection = 'rtl';
  Chart.defaults.plugins.tooltip.backgroundColor = '#1F2A1A';
  Chart.defaults.plugins.tooltip.titleColor = '#E3C77E';
  Chart.defaults.plugins.tooltip.bodyColor = '#F5EFE3';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.plugins.tooltip.boxPadding = 4;

  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.line.tension = 0.3;
  Chart.defaults.elements.point.radius = 3;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.elements.point.borderWidth = 2;
  Chart.defaults.elements.point.borderColor = SURFACE; // حلقة بلون السطح حول النقاط
  Chart.defaults.elements.bar.borderRadius = 4;
  Chart.defaults.elements.arc.borderWidth = 2;
  Chart.defaults.elements.arc.borderColor = SURFACE; // فجوة سطحية بين شرائح الدونات

  // تعديل خصائص المقاييس بدون استبدال الكائنات (استبدالها يكسر الرسم)
  Chart.defaults.scale.grid.color = GRID;
  Chart.defaults.scale.grid.drawTicks = false;
  Chart.defaults.scale.border.display = false;
  Chart.defaults.scale.ticks.color = INK_MUTED;
  Chart.defaults.scale.ticks.padding = 6;

  window.NAMLIAH_CHART = { SURFACE, INK, INK_MUTED, GRID };
})();
