import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { initViewer, setOriginalGeometry, setCompensatedGeometry, buildExportMesh } from './viewer.js';
import { runCompensation, buildDatabaseIndex } from './compensator.js';

const state = {
  database: null,
  materialMap: new Map(),
  loadedGeometry: null,
  loadedFileName: 'compensated',
  compensatedGeometry: null,
};

const stlInput = document.getElementById('stlInput');
const materialSelect = document.getElementById('materialSelect');
const presetSelect = document.getElementById('presetSelect');
const runButton = document.getElementById('runButton');
const statusEl = document.getElementById('status');

const nozzleValue = document.getElementById('nozzleValue');
const bedValue = document.getElementById('bedValue');
const chamberValue = document.getElementById('chamberValue');
const strainValue = document.getElementById('strainValue');

const viewerContainer = document.getElementById('viewer');
initViewer(viewerContainer);

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b33f11' : '#2f6d5f';
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
  return `${entry.t_melt}C / ${entry.t_bed}C / ${entry.t_chamber}C`;
}

function chooseDefaultPreset(entries) {
  if (!entries || entries.length === 0) {
    return null;
  }

  // 默认选喷嘴温度和热床温度的中位工艺点，减少极端参数导致的过补偿。
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
      throw new Error('database.json 中没有可用的 success 工艺点');
    }

    populateMaterials();
    setStatus('database.json 已加载，可开始上传 STL。');
  } catch (error) {
    setStatus(`数据库加载失败: ${error.message}。请用本地静态服务器打开。`, true);
  }
}

function parseStlFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buffer = reader.result;
        const loader = new STLLoader();
        const geometry = loader.parse(buffer);

        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        resolve(geometry);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('读取 STL 文件失败'));
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
    setStatus('正在读取 STL ...');
    const geometry = await parseStlFile(file);
    state.loadedGeometry = geometry;
    state.compensatedGeometry = null;
    state.loadedFileName = safeFileBaseName(file.name);

    setOriginalGeometry(geometry.clone());
    updateRunButtonState();
    setStatus(`已加载 ${file.name}，可开始补偿。`);
  } catch (error) {
    setStatus(`STL 解析失败: ${error.message}`, true);
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
    setStatus('当前工艺预设不存在，请重新选择。', true);
    return;
  }

  try {
    runButton.disabled = true;
    setStatus('正在执行补偿计算 ...');

    const result = runCompensation(state.loadedGeometry, preset.inherent_strain, {
      relaxFactor: 0.8,
      maxIterations: 6,
      convergenceTol: 0.02,
    });

    state.compensatedGeometry = result.geometry;
    setCompensatedGeometry(result.geometry.clone());

    const outName = `${state.loadedFileName}_${preset.material}_${preset.t_melt}_${preset.t_bed}_${preset.t_chamber}_compensated.stl`;
    downloadGeometryAsStl(result.geometry, outName);

    setStatus(`补偿完成，已自动下载。迭代 ${result.iterations} 轮，最大残差 ${result.maxError.toFixed(4)} mm。`);
  } catch (error) {
    setStatus(`补偿失败: ${error.message}`, true);
  } finally {
    updateRunButtonState();
  }
});

loadDatabase();
