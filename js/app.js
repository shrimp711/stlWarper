import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { initViewer, setOriginalGeometry, setCompensatedGeometry, buildExportMesh } from './viewer.js';
import { runCompensation, buildDatabaseIndex } from './compensator.js';

const state = {
  database: null,
  materialMap: new Map(),
  loadedGeometry: null,
  baseGeometry: null,
  loadedFileName: 'compensated',
  compensatedGeometry: null,
};

const stlInput = document.getElementById('stlInput');
const materialSelect = document.getElementById('materialSelect');
const presetSelect = document.getElementById('presetSelect');
const runButton = document.getElementById('runButton');
const statusEl = document.getElementById('status');
const modelNameEl = document.getElementById('modelName');
const modelStatsEl = document.getElementById('modelStats');
const languageSelect = document.getElementById('languageSelect');

const uploadLabelEl = document.getElementById('uploadLabel');
const legendOriginalEl = document.getElementById('legendOriginal');
const legendCompensatedEl = document.getElementById('legendCompensated');
const compensationTitleEl = document.getElementById('compensationTitle');
const materialLabelEl = document.getElementById('materialLabel');
const presetLabelEl = document.getElementById('presetLabel');
const nozzleLabelEl = document.getElementById('nozzleLabel');
const bedLabelEl = document.getElementById('bedLabel');
const chamberLabelEl = document.getElementById('chamberLabel');
const strainLabelEl = document.getElementById('strainLabel');
const exportTitleEl = document.getElementById('exportTitle');
const privacyHintEl = document.getElementById('privacyHint');
const statusCenterEl = document.getElementById('statusCenter');
const statusRightEl = document.getElementById('statusRight');

const i18n = {
  zh: {
    htmlLang: 'zh-CN',
    uploadLabel: '上传 STL',
    legendOriginal: '<i class="dot before"></i>原始模型',
    legendCompensated: '<i class="dot after"></i>补偿后模型',
    compensationTitle: '补偿参数',
    materialLabel: '材料',
    presetLabel: '工艺预设',
    nozzleLabel: '喷嘴温度:',
    bedLabel: '热床温度:',
    chamberLabel: '腔体温度:',
    strainLabel: '固有应变:',
    exportTitle: '导出',
    runButton: '一键补偿并下载 STL',
    privacyHint: '所有计算在本地浏览器完成，不上传模型文件。',
    statusCenter: '数据源: material-db/database.json',
    statusRight: '左键旋转 · 右键平移 · 滚轮缩放 · X/Y/Z 旋转 · Shift+X/Y/Z 反向 · R 默认朝向',
    statsTriangles: '三角面',
    statusInit: '等待加载 database.json ...',
    statusDbLoaded: 'database.json 已加载。已提供默认双悬臂梁模型，可直接补偿或上传 STL 替换。',
    statusDbLoadFailed: '数据库加载失败: {message}。请用本地静态服务器打开。',
    statusDefaultOrientation: '已应用默认朝向。快捷键: X/Y/Z 旋转, Shift+X/Y/Z 反向, R 默认朝向。',
    statusRotated: '模型已旋转 {axis} {degree} 度。',
    statusReadingStl: '正在读取 STL ...',
    statusLoadedStl: '已加载 {name}，可开始补偿。',
    statusStlParseFailed: 'STL 解析失败: {message}',
    statusPresetMissing: '当前工艺预设不存在，请重新选择。',
    statusRunningComp: '正在执行补偿计算 ...',
    statusCompDone: '补偿完成，已自动下载。迭代 {iterations} 轮，最大残差 {maxError} mm。',
    statusCompFailed: '补偿失败: {message}',
    errorDbNoPreset: 'database.json 中没有可用的 success 工艺点',
    errorReadStl: '读取 STL 文件失败',
  },
  en: {
    htmlLang: 'en',
    uploadLabel: 'Upload STL',
    legendOriginal: '<i class="dot before"></i>Original Model',
    legendCompensated: '<i class="dot after"></i>Compensated Model',
    compensationTitle: 'COMPENSATION',
    materialLabel: 'Material',
    presetLabel: 'Process Preset',
    nozzleLabel: 'Nozzle Temp:',
    bedLabel: 'Bed Temp:',
    chamberLabel: 'Chamber Temp:',
    strainLabel: 'Inherent Strain:',
    exportTitle: 'EXPORT',
    runButton: 'Compensate and Download STL',
    privacyHint: 'All computations run in your local browser. No model upload required.',
    statusCenter: 'Data: material-db/database.json',
    statusRight: 'Left drag: orbit · Right drag: pan · Scroll: zoom · X/Y/Z rotate · Shift+X/Y/Z reverse · R default orientation',
    statsTriangles: 'triangles',
    statusInit: 'Waiting for database.json ...',
    statusDbLoaded: 'database.json loaded. Default double-cantilever model is ready, or upload your STL.',
    statusDbLoadFailed: 'Database load failed: {message}. Open with a local static server.',
    statusDefaultOrientation: 'Default orientation applied. Shortcuts: X/Y/Z rotate, Shift+X/Y/Z reverse, R default orientation.',
    statusRotated: 'Model rotated {axis} {degree} degrees.',
    statusReadingStl: 'Reading STL ...',
    statusLoadedStl: '{name} loaded. Ready for compensation.',
    statusStlParseFailed: 'STL parse failed: {message}',
    statusPresetMissing: 'Current process preset is unavailable. Please reselect.',
    statusRunningComp: 'Running compensation ...',
    statusCompDone: 'Compensation finished and file downloaded. Iterations: {iterations}, max residual: {maxError} mm.',
    statusCompFailed: 'Compensation failed: {message}',
    errorDbNoPreset: 'No available success preset in database.json',
    errorReadStl: 'Failed to read STL file',
  },
};

const nozzleValue = document.getElementById('nozzleValue');
const bedValue = document.getElementById('bedValue');
const chamberValue = document.getElementById('chamberValue');
const strainValue = document.getElementById('strainValue');

const viewerContainer = document.getElementById('viewer');
initViewer(viewerContainer);

function normalizeLanguage(lang) {
  return lang === 'en' ? 'en' : 'zh';
}

function getCurrentLanguage() {
  return normalizeLanguage(state.language);
}

function t(key, params = {}) {
  const lang = getCurrentLanguage();
  const template = i18n[lang][key] ?? i18n.zh[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? `{${name}}`));
}

function setLanguage(lang) {
  state.language = normalizeLanguage(lang);
  document.documentElement.lang = i18n[state.language].htmlLang;
  localStorage.setItem('stlWarper.lang', state.language);
  languageSelect.value = state.language;
  applyStaticTranslations();
  refreshStatusText();
  updateModelStats(state.loadedGeometry);
}

function applyStaticTranslations() {
  uploadLabelEl.textContent = t('uploadLabel');
  legendOriginalEl.innerHTML = t('legendOriginal');
  legendCompensatedEl.innerHTML = t('legendCompensated');
  compensationTitleEl.textContent = t('compensationTitle');
  materialLabelEl.textContent = t('materialLabel');
  presetLabelEl.textContent = t('presetLabel');
  nozzleLabelEl.textContent = t('nozzleLabel');
  bedLabelEl.textContent = t('bedLabel');
  chamberLabelEl.textContent = t('chamberLabel');
  strainLabelEl.textContent = t('strainLabel');
  exportTitleEl.textContent = t('exportTitle');
  runButton.textContent = t('runButton');
  privacyHintEl.textContent = t('privacyHint');
  statusCenterEl.textContent = t('statusCenter');
  statusRightEl.textContent = t('statusRight');
}

function setStatus(message, isError = false) {
  state.lastStatus = { key: null, params: null, message, isError };
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b5433f' : '#28796a';
}

function setStatusByKey(key, params = {}, isError = false) {
  state.lastStatus = { key, params, message: null, isError };
  statusEl.textContent = t(key, params);
  statusEl.style.color = isError ? '#b5433f' : '#28796a';
}

function refreshStatusText() {
  if (!state.lastStatus) {
    return;
  }

  if (state.lastStatus.key) {
    statusEl.textContent = t(state.lastStatus.key, state.lastStatus.params || {});
    statusEl.style.color = state.lastStatus.isError ? '#b5433f' : '#28796a';
    return;
  }

  statusEl.textContent = state.lastStatus.message || '';
  statusEl.style.color = state.lastStatus.isError ? '#b5433f' : '#28796a';
}

function refreshOriginalPreview() {
  if (!state.loadedGeometry) {
    return;
  }
  setOriginalGeometry(state.loadedGeometry.clone());
  updateModelStats(state.loadedGeometry);
}

function updateModelStats(geometry) {
  if (!geometry) {
    modelStatsEl.textContent = `0 ${t('statsTriangles')} · 0.00 × 0.00 × 0.00 mm`;
    return;
  }

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const x = Math.max(box.max.x - box.min.x, 0);
  const y = Math.max(box.max.y - box.min.y, 0);
  const z = Math.max(box.max.z - box.min.z, 0);

  const triangleCount = geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor(geometry.getAttribute('position').count / 3);

  modelStatsEl.textContent = `${triangleCount} ${t('statsTriangles')} · ${x.toFixed(2)} × ${y.toFixed(2)} × ${z.toFixed(2)} mm`;
}

function updateRunButtonState() {
  const ready = Boolean(state.loadedGeometry && materialSelect.value && presetSelect.value);
  runButton.disabled = !ready;
}

function updatePresetCard() {
  const material = materialSelect.value;
  const key = presetSelect.value;
  const entry = state.database?.[key];

  if (!material || !entry) {
    nozzleValue.textContent = '-';
    bedValue.textContent = '-';
    chamberValue.textContent = '-';
    strainValue.textContent = '-';
    return;
  }

  nozzleValue.textContent = String(entry.t_melt);
  bedValue.textContent = String(entry.t_bed);
  chamberValue.textContent = String(entry.t_chamber);
  strainValue.textContent = `[${entry.inherent_strain.map((v) => Number(v).toFixed(6)).join(', ')}]`;
}

function populateMaterials() {
  const materials = Array.from(state.materialMap.keys()).sort((a, b) => a.localeCompare(b));
  materialSelect.innerHTML = '';

  materials.forEach((material) => {
    const option = document.createElement('option');
    option.value = material;
    option.textContent = material;
    materialSelect.appendChild(option);
  });

  if (materials.length > 0) {
    materialSelect.value = materials[0];
  }

  populatePresetsForMaterial();
}

function buildPresetLabel(entry) {
  return `${entry.t_melt}°C / ${entry.t_bed}°C / ${entry.t_chamber}°C`;
}

function chooseDefaultPreset(entries) {
  if (!entries || entries.length === 0) {
    return null;
  }

  // Use middle process point by nozzle/bed/chamber sorting to avoid extreme compensation.
  const sorted = [...entries].sort((a, b) => {
    if (a.t_melt !== b.t_melt) return a.t_melt - b.t_melt;
    if (a.t_bed !== b.t_bed) return a.t_bed - b.t_bed;
    return a.t_chamber - b.t_chamber;
  });
  return sorted[Math.floor(sorted.length / 2)];
}

function populatePresetsForMaterial() {
  const material = materialSelect.value;
  const entries = state.materialMap.get(material) || [];

  presetSelect.innerHTML = '';

  entries.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.key;
    option.textContent = buildPresetLabel(entry);
    presetSelect.appendChild(option);
  });

  const preferred = chooseDefaultPreset(entries);
  if (preferred) {
    presetSelect.value = preferred.key;
  }

  updatePresetCard();
  updateRunButtonState();
}

async function loadDatabase() {
  try {
    const response = await fetch('./material-db/database.json');
    if (!response.ok) {
      throw new Error(`database.json load failed: ${response.status}`);
    }

    state.database = await response.json();
    state.materialMap = buildDatabaseIndex(state.database);

    if (state.materialMap.size === 0) {
      throw new Error(t('errorDbNoPreset'));
    }

    populateMaterials();
    setStatusByKey('statusDbLoaded');
  } catch (error) {
    setStatusByKey('statusDbLoadFailed', { message: error.message }, true);
  }
}

function autoOrientToMinHeight(geometry) {
  const candidates = [
    new THREE.Euler(0, 0, 0),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
    new THREE.Euler(-Math.PI * 0.5, 0, 0),
    new THREE.Euler(0, Math.PI * 0.5, 0),
    new THREE.Euler(0, -Math.PI * 0.5, 0),
    new THREE.Euler(Math.PI, 0, 0),
    new THREE.Euler(0, Math.PI, 0),
  ];

  let bestGeometry = geometry.clone();
  let bestHeight = Infinity;
  let bestSupportArea = -Infinity;

  candidates.forEach((euler) => {
    const candidate = geometry.clone();
    const rotate = new THREE.Matrix4().makeRotationFromEuler(euler);
    candidate.applyMatrix4(rotate);
    candidate.computeBoundingBox();

    const box = candidate.boundingBox;
    const xSpan = Math.max(box.max.x - box.min.x, 1e-6);
    const ySpan = Math.max(box.max.y - box.min.y, 1e-6);
    const zSpan = Math.max(box.max.z - box.min.z, 1e-6);
    const supportArea = xSpan * ySpan;

    if (zSpan < bestHeight - 1e-6 || (Math.abs(zSpan - bestHeight) <= 1e-6 && supportArea > bestSupportArea)) {
      bestHeight = zSpan;
      bestSupportArea = supportArea;
      bestGeometry = candidate;
    }
  });

  return bestGeometry;
}

function placeGeometryOnBuildPlate(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;

  const cx = (box.max.x + box.min.x) * 0.5;
  const cy = (box.max.y + box.min.y) * 0.5;
  const zMin = box.min.z;

  geometry.translate(-cx, -cy, -zMin);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();
  return geometry;
}

function normalizeGeometryPose(geometry) {
  const oriented = autoOrientToMinHeight(geometry);
  return placeGeometryOnBuildPlate(oriented);
}

function applyDefaultOrientation() {
  if (!state.baseGeometry) {
    return;
  }
  state.loadedGeometry = normalizeGeometryPose(state.baseGeometry.clone());
  state.compensatedGeometry = null;
  refreshOriginalPreview();
  updateRunButtonState();
  setStatusByKey('statusDefaultOrientation');
}

function rotateModelByAxis(axis, positive = true) {
  if (!state.loadedGeometry) {
    return;
  }

  const angle = positive ? Math.PI * 0.5 : -Math.PI * 0.5;
  const rotate = new THREE.Matrix4();
  if (axis === 'x') rotate.makeRotationX(angle);
  if (axis === 'y') rotate.makeRotationY(angle);
  if (axis === 'z') rotate.makeRotationZ(angle);

  const next = state.loadedGeometry.clone();
  next.applyMatrix4(rotate);
  state.loadedGeometry = placeGeometryOnBuildPlate(next);
  state.compensatedGeometry = null;

  refreshOriginalPreview();
  updateRunButtonState();
  setStatusByKey('statusRotated', { axis: axis.toUpperCase(), degree: positive ? '+90' : '-90' });
}

function setupOrientationShortcuts() {
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    const key = event.key.toLowerCase();
    const positive = !event.shiftKey;

    if (key === 'x' || key === 'y' || key === 'z') {
      event.preventDefault();
      rotateModelByAxis(key, positive);
      return;
    }

    if (key === 'r') {
      event.preventDefault();
      applyDefaultOrientation();
    }
  });
}

function createDefaultDoubleCantileverGeometry() {
  const parts = [];

  const base = new THREE.BoxGeometry(28, 32, 18);
  base.translate(-38, 0, 9);
  parts.push(base);

  const beamTop = new THREE.BoxGeometry(92, 6, 4);
  beamTop.translate(10, 9, 16);
  parts.push(beamTop);

  const beamBottom = new THREE.BoxGeometry(92, 6, 4);
  beamBottom.translate(10, -9, 16);
  parts.push(beamBottom);

  const rootWeb = new THREE.BoxGeometry(18, 24, 8);
  rootWeb.translate(-12, 0, 12);
  parts.push(rootWeb);

  const tipBridge = new THREE.BoxGeometry(8, 24, 5);
  tipBridge.translate(54, 0, 16.5);
  parts.push(tipBridge);

  const merged = mergeGeometries(parts, false);
  return normalizeGeometryPose(merged);
}

function parseStlFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buffer = reader.result;
        const loader = new STLLoader();
        const geometry = loader.parse(buffer);

        resolve(normalizeGeometryPose(geometry));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error(t('errorReadStl')));
    reader.readAsArrayBuffer(file);
  });
}

function safeFileBaseName(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

function downloadGeometryAsStl(geometry, fileName) {
  const mesh = buildExportMesh(geometry);
  const exporter = new STLExporter();
  const exported = exporter.parse(mesh, { binary: true });

  let blob;
  if (exported instanceof DataView) {
    blob = new Blob([exported.buffer], { type: 'model/stl' });
  } else if (exported instanceof ArrayBuffer) {
    blob = new Blob([exported], { type: 'model/stl' });
  } else {
    blob = new Blob([exported], { type: 'model/stl' });
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

stlInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    setStatusByKey('statusReadingStl');
    const sourceGeometry = await parseStlFile(file);
    state.baseGeometry = sourceGeometry.clone();
    state.loadedGeometry = normalizeGeometryPose(sourceGeometry);
    state.compensatedGeometry = null;
    state.loadedFileName = safeFileBaseName(file.name);
    modelNameEl.textContent = file.name;

    refreshOriginalPreview();
    updateRunButtonState();
    setStatusByKey('statusLoadedStl', { name: file.name });
  } catch (error) {
    setStatusByKey('statusStlParseFailed', { message: error.message }, true);
  }
});

materialSelect.addEventListener('change', () => {
  populatePresetsForMaterial();
});

presetSelect.addEventListener('change', () => {
  updatePresetCard();
  updateRunButtonState();
});

runButton.addEventListener('click', async () => {
  if (!state.loadedGeometry || !state.database) {
    return;
  }

  const key = presetSelect.value;
  const preset = state.database[key];
  if (!preset) {
    setStatusByKey('statusPresetMissing', {}, true);
    return;
  }

  try {
    runButton.disabled = true;
    setStatusByKey('statusRunningComp');

    const result = runCompensation(state.loadedGeometry, preset.inherent_strain, {
      relaxFactor: 0.8,
      maxIterations: 6,
      convergenceTol: 0.02,
    });

    state.compensatedGeometry = result.geometry;
    setCompensatedGeometry(result.geometry.clone());

    const outName = `${state.loadedFileName}_${preset.material}_${preset.t_melt}_${preset.t_bed}_${preset.t_chamber}_compensated.stl`;
    downloadGeometryAsStl(result.geometry, outName);

    setStatusByKey('statusCompDone', {
      iterations: result.iterations,
      maxError: result.maxError.toFixed(4),
    });
  } catch (error) {
    setStatusByKey('statusCompFailed', { message: error.message }, true);
  } finally {
    updateRunButtonState();
  }
});

function initDefaultModel() {
  const geometry = createDefaultDoubleCantileverGeometry();
  state.baseGeometry = geometry.clone();
  state.loadedGeometry = normalizeGeometryPose(geometry);
  state.compensatedGeometry = null;
  state.loadedFileName = 'double_cantilever_default';
  modelNameEl.textContent = 'double_cantilever_default.stl';
  refreshOriginalPreview();
}

initDefaultModel();
setupOrientationShortcuts();
const initialLang = normalizeLanguage(localStorage.getItem('stlWarper.lang') || document.documentElement.lang || 'zh');
state.language = initialLang;
languageSelect.addEventListener('change', () => setLanguage(languageSelect.value));
setLanguage(initialLang);
setStatusByKey('statusInit');
loadDatabase();
