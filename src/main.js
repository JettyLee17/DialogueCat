// 引入 Tailwind CSS
import './style.css'

// ========== 唯一 ID 生成器 ==========
let _idCounter = 0;
function uniqueId(prefix = 'img') {
  return `${prefix}-${Date.now()}-${++_idCounter}-${Math.random().toString(36).substr(2, 6)}`;
}

// ========== Toast 通知系统 ==========
function showToast(message, type = 'info', duration = 2500) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ========== 全局核心状态 ==========
let imgList = [];
let globalSettings = {
  gapSize: 0,
  yPercent: 0,
  hPercent: 12
};

// 剪贴板，用于存储独立裁剪参数
let copiedCrop = null;

// 图片缓存：src -> { img: HTMLImageElement, width, height, aspectRatio }
const imageCache = new Map();

// 预览缩放
let previewScale = 1;
const BASE_PREVIEW_WIDTH = 600;
const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.0;

// ========== 撤销/重做系统 ==========
const MAX_HISTORY = 50;
let historyStack = [];
let historyIndex = -1;

function saveHistory() {
  // 截断当前位置之后的历史
  historyStack = historyStack.slice(0, historyIndex + 1);
  // 深拷贝当前状态
  historyStack.push(JSON.parse(JSON.stringify(imgList)));
  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
  }
  historyIndex = historyStack.length - 1;
}

function undo() {
  if (historyIndex <= 0) {
    showToast('没有更多可撤销的操作', 'info');
    return;
  }
  historyIndex--;
  imgList = JSON.parse(JSON.stringify(historyStack[historyIndex]));
  updateLayersList();
  renderCollage();
  showToast('已撤销', 'success');
}

function redo() {
  if (historyIndex >= historyStack.length - 1) {
    showToast('没有更多可重做的操作', 'info');
    return;
  }
  historyIndex++;
  imgList = JSON.parse(JSON.stringify(historyStack[historyIndex]));
  updateLayersList();
  renderCollage();
  showToast('已重做', 'success');
}

// ========== 防抖工具 ==========
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) cancelAnimationFrame(timer);
    timer = requestAnimationFrame(() => {
      fn.apply(this, args);
      timer = null;
    });
  };
}

// ========== 图片加载与缓存 ==========
function loadImage(src) {
  if (imageCache.has(src)) {
    return Promise.resolve(imageCache.get(src));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const data = {
        img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        aspectRatio: img.naturalWidth / Math.max(img.naturalHeight, 1)
      };
      imageCache.set(src, data);
      resolve(data);
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

// ========== 图层管理函数 ==========

function copyCropParams(index) {
  const item = imgList[index];
  copiedCrop = {
    yPercent: item.yPercent,
    hPercent: item.hPercent
  };
  showToast('裁剪参数已复制', 'success');
  updateLayersList();
}

function pasteCropParams(index) {
  if (!copiedCrop) return;
  saveHistory();
  imgList[index].yPercent = copiedCrop.yPercent;
  imgList[index].hPercent = copiedCrop.hPercent;
  renderCollage();
  updateLayersList();
  showToast('裁剪参数已粘贴', 'success');
}

function updateLayersList() {
  const container = document.getElementById('layersContainer');
  if (!container) return;

  if (imgList.length === 0) {
    container.innerHTML = `
      <div id="emptyLayersState" class="text-center py-16 text-zinc-500 text-xs flex flex-col items-center justify-center space-y-3">
        <svg class="w-10 h-10 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
        </svg>
        <span>暂无导入图片，请在上方上传截图</span>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  imgList.forEach((item, index) => {
    const layerEl = document.createElement('div');
    layerEl.className = `p-3 bg-zinc-900 border ${item.mode === 'full' ? 'border-amber-500/40 bg-zinc-900/90' : 'border-zinc-800'} rounded-xl transition-all relative flex flex-col space-y-3`;
    layerEl.dataset.layerIndex = index;

    const showCropControls = item.mode === 'strip';
    const isCustom = item.customCrop;

    const pasteBtnClass = copiedCrop
      ? 'bg-amber-500 text-black font-semibold hover:bg-amber-400'
      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed';

    layerEl.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <button data-action="drag-handle" data-index="${index}" class="p-0.5 text-zinc-500 hover:text-zinc-300 rounded transition" title="拖拽排序">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z"/></svg>
          </button>
          <span class="w-5 h-5 bg-zinc-800 text-zinc-400 rounded text-[11px] font-mono flex items-center justify-center font-bold">
            ${index + 1}
          </span>
          <span class="text-xs font-semibold ${item.mode === 'full' ? 'text-amber-400' : 'text-zinc-300'}">
            ${item.mode === 'full' ? '🎬 完整电影画幅' : '🎞️ 台词精简切片'}
          </span>
        </div>
        <div class="flex items-center space-x-1">
          <button data-action="move-up" data-index="${index}" class="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition" title="上移">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7"/></svg>
          </button>
          <button data-action="move-down" data-index="${index}" class="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition" title="下移">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/></svg>
          </button>
          <button data-action="delete" data-index="${index}" class="p-1 text-red-400 hover:text-red-300 hover:bg-red-950/20 rounded transition ml-1" title="删除">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>

      <div class="flex items-center space-x-3">
        <div class="w-16 h-10 bg-black rounded-md overflow-hidden shrink-0 border border-zinc-700/50 flex items-center justify-center relative">
          <img src="${item.src}" class="w-full h-full object-cover">
          ${item.mode === 'strip' ? '<div class="absolute inset-x-0 bottom-0 top-2/3 bg-amber-500/20 border-t border-amber-500/60"></div>' : ''}
        </div>
        <div class="flex-1 grid grid-cols-2 gap-1.5">
          <button data-action="set-full" data-index="${index}" class="py-1 px-1.5 rounded text-[10px] font-medium transition ${item.mode === 'full' ? 'bg-amber-500 text-black shadow' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}">
            完整画面
          </button>
          <button data-action="set-strip" data-index="${index}" class="py-1 px-1.5 rounded text-[10px] font-medium transition ${item.mode === 'strip' ? 'bg-amber-500 text-black shadow' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}">
            台词切片
          </button>
        </div>
      </div>

      ${showCropControls ? `
        <div class="pt-2 border-t border-zinc-800/50 flex flex-col space-y-2">
          <div class="flex items-center justify-between text-[11px] bg-zinc-950/40 p-1.5 rounded border border-zinc-800/60">
            <span class="text-zinc-400">⚙️ 启用独立裁剪参数</span>
            <input type="checkbox" data-action="toggle-custom" data-index="${index}" ${isCustom ? 'checked' : ''} class="w-4 h-4 accent-amber-500 cursor-pointer">
          </div>

          ${isCustom ? `
            <div class="space-y-2 bg-amber-500/5 rounded border border-amber-500/10">
              <div data-action="toggle-crop-collapse" data-index="${index}" class="flex items-center justify-between p-2.5 rounded-t border-b border-amber-500/10 hover:bg-amber-500/10 transition cursor-pointer select-none">
                <span class="flex items-center gap-1 text-[10px] text-amber-400/80 font-semibold tracking-wider">
                  <span data-crop-arrow="${index}" class="text-[8px]">▼</span>
                  微调参数
                </span>
                <div class="flex items-center gap-1.5">
                  <button data-action="copy-crop" data-index="${index}" class="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[9px] font-medium transition" title="复制当前图层裁剪参数">复制</button>
                  <button data-action="paste-crop" data-index="${index}" ${copiedCrop ? '' : 'disabled'} class="px-2 py-0.5 ${pasteBtnClass} rounded text-[9px] transition" title="粘贴已保存的裁剪参数">粘贴</button>
                </div>
              </div>
              <div data-crop-body="${index}" class="p-2.5 pt-2 space-y-2">
                <div>
                  <div class="flex justify-between text-[10px] text-amber-400 font-medium">
                    <span>独立底部间距</span>
                    <span class="font-mono" data-y-display="${index}">${item.yPercent}%</span>
                  </div>
                  <input type="range" min="0" max="100" value="${item.yPercent}" data-action="update-y" data-index="${index}" class="w-full accent-amber-500 bg-zinc-950 h-1 rounded">
                </div>
                <div>
                  <div class="flex justify-between text-[10px] text-amber-400 font-medium">
                    <span>独立切片高度</span>
                    <span class="font-mono" data-h-display="${index}">${item.hPercent}%</span>
                  </div>
                  <input type="range" min="3" max="40" value="${item.hPercent}" data-action="update-h" data-index="${index}" class="w-full accent-amber-500 bg-zinc-950 h-1 rounded">
                </div>
              </div>
            </div>
          ` : `
            <div class="text-[10px] text-zinc-500 italic flex items-center justify-between px-1">
              <span>应用全局对齐设置</span>
              <span class="font-mono">底:${globalSettings.yPercent}% / 高:${globalSettings.hPercent}%</span>
            </div>
          `}
        </div>
      ` : ''}
    `;
    container.appendChild(layerEl);
  });

  // 绑定拖拽排序事件
  bindLayerDragEvents();
  // 同步更新移动端图层列表
  updateMobileLayersList();
}

function updateMobileLayersList() {
  const container = document.getElementById('mobileLayersContainer');
  if (!container) return;

  if (imgList.length === 0) {
    container.innerHTML = '<div class="text-center py-8 text-zinc-500 text-xs">暂无导入图片</div>';
    return;
  }

  container.innerHTML = '';

  imgList.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = `p-3 bg-zinc-900 border ${item.mode === 'full' ? 'border-amber-500/40' : 'border-zinc-800'} rounded-xl`;
    card.dataset.layerIndex = index;

    const showCropControls = item.mode === 'strip';
    const isCustom = item.customCrop;

    const pasteBtnClass = copiedCrop
      ? 'bg-amber-500 text-black font-semibold hover:bg-amber-400'
      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed';

    card.innerHTML = `
      <div class="flex items-center gap-1.5 mb-2">
        <span class="w-6 h-6 bg-zinc-800 text-zinc-400 rounded text-[11px] font-mono flex items-center justify-center font-bold shrink-0">${index + 1}</span>
        <div class="w-12 h-9 bg-black rounded-md overflow-hidden shrink-0 border border-zinc-700/50">
          <img src="${item.src}" class="w-full h-full object-cover">
        </div>
        <div class="flex items-center gap-1 flex-1 min-w-0">
          <button data-action="set-full" data-index="${index}" class="flex-1 py-1 px-1 rounded text-[10px] font-medium leading-tight transition ${item.mode === 'full' ? 'bg-amber-500 text-black shadow' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}">完整画面</button>
          <button data-action="set-strip" data-index="${index}" class="flex-1 py-1 px-1 rounded text-[10px] font-medium leading-tight transition ${item.mode === 'strip' ? 'bg-amber-500 text-black shadow' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}">台词切片</button>
        </div>
        <div class="flex items-center gap-0.5 shrink-0">
          <button data-action="move-up" data-index="${index}" class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition" title="上移"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7"/></svg></button>
          <button data-action="move-down" data-index="${index}" class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition" title="下移"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/></svg></button>
          <button data-action="delete" data-index="${index}" class="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-950/20 rounded transition" title="删除"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
        </div>
      </div>
      ${showCropControls ? `
        <div class="mt-2 pt-2 border-t border-zinc-800/50 space-y-2">
          <div class="flex items-center justify-between text-[11px] bg-zinc-950/40 p-1.5 rounded border border-zinc-800/60">
            <span class="text-zinc-400">启用独立裁剪</span>
            <input type="checkbox" data-action="toggle-custom" data-index="${index}" ${isCustom ? 'checked' : ''} class="w-4 h-4 accent-amber-500 cursor-pointer">
          </div>
          ${isCustom ? `
            <div class="space-y-2 bg-amber-500/5 rounded border border-amber-500/10">
              <div data-action="toggle-crop-collapse" data-index="${index}" class="flex items-center justify-between p-2 rounded-t border-b border-amber-500/10 hover:bg-amber-500/10 transition cursor-pointer select-none">
                <span class="flex items-center gap-1 text-[10px] text-amber-400/80 font-semibold tracking-wider">
                  <span data-crop-arrow="${index}" class="text-[8px]">▼</span>
                  微调参数
                </span>
                <div class="flex items-center gap-1">
                  <button data-action="copy-crop" data-index="${index}" class="px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[9px] font-medium transition">复制</button>
                  <button data-action="paste-crop" data-index="${index}" ${copiedCrop ? '' : 'disabled'} class="px-1.5 py-0.5 ${pasteBtnClass} rounded text-[9px] transition">粘贴</button>
                </div>
              </div>
              <div data-crop-body="${index}" class="p-2 pt-1.5 space-y-2">
                <div>
                  <div class="flex justify-between text-[10px] text-amber-400 font-medium">
                    <span>底部间距</span>
                    <span class="font-mono" data-y-display="${index}">${item.yPercent}%</span>
                  </div>
                  <input type="range" min="0" max="100" value="${item.yPercent}" data-action="update-y" data-index="${index}" class="w-full accent-amber-500 bg-zinc-950 h-1 rounded">
                </div>
                <div>
                  <div class="flex justify-between text-[10px] text-amber-400 font-medium">
                    <span>切片高度</span>
                    <span class="font-mono" data-h-display="${index}">${item.hPercent}%</span>
                  </div>
                  <input type="range" min="3" max="40" value="${item.hPercent}" data-action="update-h" data-index="${index}" class="w-full accent-amber-500 bg-zinc-950 h-1 rounded">
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}
    `;

    container.appendChild(card);
  });
}

// ========== 拖拽排序 ==========
let dragSourceIndex = null;

function bindLayerDragEvents() {
  const container = document.getElementById('layersContainer');
  const layers = container.querySelectorAll('[data-layer-index]');

  layers.forEach(layerEl => {
    const handle = layerEl.querySelector('[data-action="drag-handle"]');
    if (!handle) return;

    handle.draggable = true;

    handle.addEventListener('dragstart', (e) => {
      dragSourceIndex = parseInt(layerEl.dataset.layerIndex);
      layerEl.classList.add('layer-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSourceIndex);
    });

    handle.addEventListener('dragend', () => {
      layerEl.classList.remove('layer-dragging');
      container.querySelectorAll('.layer-drag-over').forEach(el => el.classList.remove('layer-drag-over'));
      removeDropIndicator(container);
      dragSourceIndex = null;
    });

    layerEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const targetIndex = parseInt(layerEl.dataset.layerIndex);
      if (targetIndex === dragSourceIndex) return;

      const rect = layerEl.getBoundingClientRect();
      const insertBefore = (e.clientY - rect.top) < (rect.height / 2);

      removeDropIndicator(container);
      const line = document.createElement('div');
      line.className = 'layer-drop-line';
      if (insertBefore) {
        layerEl.parentNode.insertBefore(line, layerEl);
      } else {
        layerEl.parentNode.insertBefore(line, layerEl.nextSibling);
      }
    });

    layerEl.addEventListener('drop', (e) => {
      e.preventDefault();
      removeDropIndicator(container);
      if (dragSourceIndex === null) return;

      const targetIndex = parseInt(layerEl.dataset.layerIndex);
      if (targetIndex === dragSourceIndex) return;

      const rect = layerEl.getBoundingClientRect();
      const insertBefore = (e.clientY - rect.top) < (rect.height / 2);

      let insertAt = insertBefore ? targetIndex : targetIndex + 1;
      if (dragSourceIndex < insertAt) insertAt--;

      saveHistory();
      const [moved] = imgList.splice(dragSourceIndex, 1);
      imgList.splice(insertAt, 0, moved);
      updateLayersList();
      renderCollage();
      showToast('图层顺序已更新', 'success');
    });
  });
}

function removeDropIndicator(container) {
  const existing = container.querySelector('.layer-drop-line');
  if (existing) existing.remove();
}

// ========== 事件委托处理图层操作 ==========
document.getElementById('layersContainer').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const index = parseInt(btn.dataset.index);

  switch (action) {
    case 'move-up': moveLayer(index, -1); break;
    case 'move-down': moveLayer(index, 1); break;
    case 'delete': deleteLayer(index); break;
    case 'set-full': setLayerMode(index, 'full'); break;
    case 'set-strip': setLayerMode(index, 'strip'); break;
    case 'copy-crop': copyCropParams(index); break;
    case 'paste-crop': pasteCropParams(index); break;
    case 'toggle-crop-collapse': {
      const card = btn.closest('[data-layer-index]');
      if (!card) break;
      const body = card.querySelector(`[data-crop-body="${index}"]`);
      const arrow = card.querySelector(`[data-crop-arrow="${index}"]`);
      if (!body) break;
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      if (arrow) arrow.textContent = collapsed ? '▼' : '▶';
      break;
    }
  }
});

document.getElementById('layersContainer').addEventListener('change', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;
  const index = parseInt(el.dataset.index);

  if (action === 'toggle-custom') {
    toggleCustomCrop(index, el.checked);
  }
});

document.getElementById('layersContainer').addEventListener('input', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;
  const index = parseInt(el.dataset.index);

  if (action === 'update-y') {
    updateLayerCrop(index, 'yPercent', el.value);
  } else if (action === 'update-h') {
    updateLayerCrop(index, 'hPercent', el.value);
  }
});

// ========== 图层操作函数 ==========

function toggleCustomCrop(index, isChecked) {
  saveHistory();
  imgList[index].customCrop = isChecked;
  updateLayersList();
  renderCollage();
}

function moveLayer(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= imgList.length) return;
  saveHistory();
  const temp = imgList[index];
  imgList[index] = imgList[targetIndex];
  imgList[targetIndex] = temp;
  updateLayersList();
  renderCollage();
}

function deleteLayer(index) {
  saveHistory();
  imgList.splice(index, 1);
  updateLayersList();
  renderCollage();
  showToast('图层已删除', 'success');
}

function setLayerMode(index, mode) {
  saveHistory();
  imgList[index].mode = mode;
  updateLayersList();
  renderCollage();
}

function updateLayerCrop(index, prop, value) {
  imgList[index][prop] = parseInt(value);
  // 同步更新显示的数值标签
  const displayEl = document.querySelector(`[data-${prop === 'yPercent' ? 'y' : 'h'}-display="${index}"]`);
  if (displayEl) {
    displayEl.textContent = `${value}%`;
  }
  renderCollage();
}

// ========== 图片上传处理 ==========

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadLoading = document.getElementById('uploadLoading');

dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('border-amber-500', 'bg-zinc-900/50');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('border-amber-500', 'bg-zinc-900/50');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('border-amber-500', 'bg-zinc-900/50');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  fileInput.value = ''; // 重置以允许重复选择同一文件
});

async function handleFiles(files) {
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (imageFiles.length === 0) {
    showToast('未检测到有效的图片文件', 'error');
    return;
  }

  uploadLoading.classList.remove('hidden');

  try {
    const promises = imageFiles.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const data = await loadImage(e.target.result);
            resolve({
              id: uniqueId('uploaded'),
              src: e.target.result,
              mode: 'strip',
              customCrop: false,
              yPercent: 0,
              hPercent: 12,
              width: data.width,
              height: data.height,
              aspectRatio: data.aspectRatio
            });
          } catch (err) {
            console.warn('图片加载失败:', err);
            resolve(null);
          }
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    });

    const results = await Promise.all(promises);
    const validImages = results.filter(item => item !== null);

    if (validImages.length > 0) {
      // 自动识别：第一张设为完整画面，后续为台词切片
      const startIndex = imgList.length;
      validImages.forEach((item, i) => {
        if (startIndex === 0 && i === 0) {
          item.mode = 'full';
        } else {
          item.mode = 'strip';
        }
      });
      saveHistory();
      imgList = [...imgList, ...validImages];
      updateLayersList();
      renderCollage();
      showToast(`成功导入 ${validImages.length} 张图片`, 'success');
    } else {
      showToast('所有图片加载失败', 'error');
    }
  } catch (err) {
    showToast('图片读取过程中发生错误', 'error');
    console.error(err);
  } finally {
    uploadLoading.classList.add('hidden');
  }
}

// ========== 清空列表 ==========
document.getElementById('clearAllBtn').addEventListener('click', () => {
  if (imgList.length === 0) return;
  saveHistory();
  imgList = [];
  copiedCrop = null;
  updateLayersList();
  renderCollage();
  showToast('已清空所有图层', 'success');
});

// ========== 渲染核心：拼贴预览（优化版 - 使用 rAF 防抖） ==========

function renderCollageInto(container, previewWidth) {
  container.innerHTML = '';
  const baseWidth = imgList[0]?.width || 1920;
  const scaleFactor = previewWidth / baseWidth;

  imgList.forEach((item, index) => {
    const block = document.createElement('div');
    block.className = "relative w-full overflow-hidden bg-black select-none";

    const finalY = item.customCrop ? item.yPercent : globalSettings.yPercent;
    const finalH = item.customCrop ? item.hPercent : globalSettings.hPercent;
    const aspect = item.aspectRatio || (16 / 9);

    if (item.mode === 'full') {
      const fullHeight = previewWidth / aspect;
      block.style.height = `${fullHeight}px`;
      const img = document.createElement('img');
      img.src = item.src;
      img.className = "w-full h-full object-cover pointer-events-none";
      img.loading = "lazy";
      block.appendChild(img);
    } else {
      const stripHeight = previewWidth * (finalH / 100);
      block.style.height = `${stripHeight}px`;
      const cropper = document.createElement('div');
      cropper.className = "absolute inset-0 w-full h-full overflow-hidden";
      const img = document.createElement('img');
      img.src = item.src;
      img.className = "absolute w-full h-auto pointer-events-none";
      img.loading = "lazy";
      const originHeight = previewWidth / aspect;
      img.style.height = `${originHeight}px`;
      const bottomOffset = originHeight * (finalY / 100);
      const cropTop = originHeight - bottomOffset - stripHeight;
      img.style.top = `-${Math.max(0, cropTop)}px`;
      cropper.appendChild(img);
      block.appendChild(cropper);
    }

    if (index < imgList.length - 1 && globalSettings.gapSize > 0) {
      block.style.marginBottom = `${globalSettings.gapSize * scaleFactor}px`;
    }

    container.appendChild(block);
  });
}

function calculateExportResolution() {
  if (imgList.length === 0) return "0 x 0";
  const baseWidth = imgList[0].width || 1920;
  let totalHeight = 0;
  imgList.forEach((item, index) => {
    const aspect = item.aspectRatio || (16 / 9);
    const finalH = item.customCrop ? item.hPercent : globalSettings.hPercent;
    if (item.mode === 'full') {
      totalHeight += baseWidth / aspect;
    } else {
      totalHeight += baseWidth * (finalH / 100);
    }
    if (index < imgList.length - 1) {
      totalHeight += globalSettings.gapSize;
    }
  });
  return `${baseWidth} x ${Math.round(totalHeight)} px`;
}

const debouncedRenderCollage = debounce(renderCollage, 16);

function renderCollage() {
  globalSettings.gapSize = parseInt(document.getElementById('gapSizeSlider').value);
  globalSettings.yPercent = parseInt(document.getElementById('globalYPercentSlider').value);
  globalSettings.hPercent = parseInt(document.getElementById('globalHPercentSlider').value);

  document.getElementById('gapSizeVal').innerText = globalSettings.gapSize;
  document.getElementById('globalYPercentVal').innerText = globalSettings.yPercent;
  document.getElementById('globalHPercentVal').innerText = globalSettings.hPercent;

  // 同步移动端数值显示
  const mYVal = document.getElementById('mobileGlobalYPercentVal');
  const mHVal = document.getElementById('mobileGlobalHPercentVal');
  const mGVal = document.getElementById('mobileGapSizeVal');
  if (mYVal) mYVal.innerText = globalSettings.yPercent + '%';
  if (mHVal) mHVal.innerText = globalSettings.hPercent + '%';
  if (mGVal) mGVal.innerText = globalSettings.gapSize + 'px';

  const desktopPreview = document.getElementById('htmlPreview');
  desktopPreview.style.backgroundColor = '#000000';

  if (imgList.length === 0) {
    const emptyHTML = `
      <div class="py-24 text-center text-zinc-600 flex flex-col items-center justify-center space-y-3">
        <svg class="w-12 h-12 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
        <span class="text-xs">预览区为空，请上传影视截图</span>
      </div>
    `;
    desktopPreview.innerHTML = emptyHTML;
    desktopPreview.style.width = `${Math.round(BASE_PREVIEW_WIDTH * previewScale)}px`;
    document.getElementById('previewResolution').innerText = "0 x 0";
    const mStrip = document.getElementById('mobilePreviewStrip');
    if (mStrip) mStrip.innerHTML = '<div class="flex items-center justify-center h-full text-zinc-600 text-[10px]">暂无内容</div>';
    const mFs = document.getElementById('mobileFullscreenPreview');
    if (mFs) mFs.innerHTML = '';
    return;
  }

  const baseWidth = imgList[0].width || 1920;
  const previewWidth = Math.round(BASE_PREVIEW_WIDTH * previewScale);

  renderCollageInto(desktopPreview, previewWidth);
  desktopPreview.style.width = `${previewWidth}px`;

  const mStrip = document.getElementById('mobilePreviewStrip');
  if (mStrip) {
    mStrip.style.width = '';
    renderCollageInto(mStrip, mStrip.clientWidth || window.innerWidth - 32);
  }

  const res = calculateExportResolution();
  document.getElementById('previewResolution').innerText = res + ' px';
}

// ========== 高保真无损大图 Canvas 拼接渲染（优化版 - 复用缓存） ==========

async function generateHighResCanvas() {
  if (imgList.length === 0) {
    showToast('请先导入图片', 'error');
    return;
  }

  // 读取导出设置
  const widthOption = document.getElementById('exportWidth').value;
  const format = document.getElementById('exportFormat').value;
  const quality = parseFloat(document.getElementById('exportQuality').value);

  // 显示导出 loading
  const exportBtn = document.getElementById('exportBtn');
  const originalExportText = exportBtn.innerHTML;
  exportBtn.disabled = true;
  exportBtn.innerHTML = '<div class="loading-spinner" style="width:16px;height:16px;border-width:2px;"></div><span>导出中...</span>';

  try {
    const originalBaseWidth = imgList[0].width || 1920;
    const gap = globalSettings.gapSize;

    // 计算实际导出宽度
    let exportWidth = originalBaseWidth;
    if (widthOption !== 'original') {
      exportWidth = parseInt(widthOption);
    }
    const scaleFactor = exportWidth / originalBaseWidth;
    const scaledGap = Math.round(gap * scaleFactor);

    // 复用缓存的图片对象
    const imageLoadPromises = imgList.map((item) => loadImage(item.src));
    const loadedImages = await Promise.all(imageLoadPromises);

    let totalHeight = 0;
    const renderData = loadedImages.map((data, index) => {
      const item = imgList[index];
      const finalY = item.customCrop ? item.yPercent : globalSettings.yPercent;
      const finalH = item.customCrop ? item.hPercent : globalSettings.hPercent;
      const aspect = data.aspectRatio;

      let blockH = 0;
      if (item.mode === 'full') {
        blockH = exportWidth / aspect;
      } else {
        blockH = exportWidth * (finalH / 100);
      }

      totalHeight += blockH;
      if (index < loadedImages.length - 1) {
        totalHeight += scaledGap;
      }

      return {
        imgObj: data.img,
        mode: item.mode,
        yPercent: finalY,
        hPercent: finalH,
        blockHeight: blockH,
        aspect: aspect,
        naturalWidth: data.width,
        naturalHeight: data.height
      };
    });

    // 安全检查
    const MAX_CANVAS_DIMENSION = 16384;
    if (exportWidth > MAX_CANVAS_DIMENSION || totalHeight > MAX_CANVAS_DIMENSION) {
      showToast(`输出尺寸 (${exportWidth}x${Math.round(totalHeight)}) 超过浏览器限制，请减少图片数量或降低输出宽度`, 'error');
      return;
    }

    const exportCanvas = document.createElement('canvas');
    const exportCtx = exportCanvas.getContext('2d');

    exportCanvas.width = exportWidth;
    exportCanvas.height = Math.round(totalHeight);

    let currentY = 0;
    renderData.forEach((imgData) => {
      exportCtx.save();

      if (imgData.mode === 'full') {
        const sw = imgData.naturalWidth;
        const sh = sw / imgData.aspect;
        const sy = Math.max(0, (imgData.naturalHeight - sh) / 2);

        exportCtx.drawImage(
          imgData.imgObj,
          0, sy, sw, Math.min(sh, imgData.naturalHeight),
          0, currentY, exportWidth, imgData.blockHeight
        );
      } else {
        const sw = imgData.naturalWidth;
        const sh = sw * (imgData.hPercent / 100);
        const bottomOffsetPx = imgData.naturalHeight * (imgData.yPercent / 100);
        let sy = imgData.naturalHeight - bottomOffsetPx - sh;

        sy = Math.max(0, sy);
        const maxSh = imgData.naturalHeight - sy;
        const actualSh = Math.min(sh, maxSh);

        exportCtx.drawImage(
          imgData.imgObj,
          0, sy, sw, Math.max(actualSh, 1),
          0, currentY, exportWidth, imgData.blockHeight
        );
      }

      exportCtx.restore();
      currentY += imgData.blockHeight + scaledGap;
    });

    // 确定输出 MIME 类型和文件扩展名
    const mimeMap = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      webp: 'image/webp'
    };
    const extMap = {
      png: '.png',
      jpeg: '.jpg',
      webp: '.webp'
    };
    const mime = mimeMap[format] || 'image/png';
    const ext = extMap[format] || '.png';
    const qualityParam = (format === 'png') ? undefined : quality;

    const finalImgData = exportCanvas.toDataURL(mime, qualityParam);

    // 更新下载链接
    const downloadLink = document.getElementById('downloadLink');
    downloadLink.href = finalImgData;
    downloadLink.download = `台词拼贴_${exportWidth}x${Math.round(totalHeight)}${ext}`;

    const previewImg = document.getElementById('finalRenderedImage');
    previewImg.src = finalImgData;

    // 更新模态框中的尺寸信息
    const sizeInfo = document.getElementById('exportSizeInfo');
    if (sizeInfo) {
      // 估算文件大小
      const base64Length = finalImgData.length - (finalImgData.indexOf(',') + 1);
      const fileSizeBytes = Math.round(base64Length * 0.75);
      const sizeMB = (fileSizeBytes / 1024 / 1024).toFixed(1);
      sizeInfo.textContent = `${exportWidth} x ${Math.round(totalHeight)} px · ${sizeMB} MB · ${format.toUpperCase()}`;
    }

    const modal = document.getElementById('exportModal');
    modal.classList.remove('hidden');
    showToast(`导出成功 (${exportWidth}x${Math.round(totalHeight)}, ${format.toUpperCase()})`, 'success');
  } catch (err) {
    console.error('导出失败:', err);
    showToast('导出过程中发生错误，请重试', 'error');
  } finally {
    exportBtn.disabled = false;
    exportBtn.innerHTML = originalExportText;
  }
}

// ========== 预览缩放控制 ==========

function setPreviewScale(newScale) {
  previewScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
  renderCollage();
}

function fitPreviewToWidth() {
  const wrapper = document.getElementById('previewContainerWrapper');
  if (!wrapper || imgList.length === 0) return;
  requestAnimationFrame(() => {
    const availWidth = wrapper.parentElement.clientWidth - 18;
    const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, availWidth / BASE_PREVIEW_WIDTH));
    setPreviewScale(newScale);
  });
}

document.getElementById('zoomInBtn').addEventListener('click', () => {
  setPreviewScale(previewScale + ZOOM_STEP);
});

document.getElementById('zoomOutBtn').addEventListener('click', () => {
  setPreviewScale(previewScale - ZOOM_STEP);
});

document.getElementById('zoomResetBtn').addEventListener('click', () => {
  setPreviewScale(1);
});

document.getElementById('fitWidthBtn').addEventListener('click', fitPreviewToWidth);

// ========== 滑块监听（使用防抖优化） ==========
document.getElementById('gapSizeSlider').addEventListener('input', debouncedRenderCollage);
document.getElementById('globalYPercentSlider').addEventListener('input', debouncedRenderCollage);
document.getElementById('globalHPercentSlider').addEventListener('input', debouncedRenderCollage);

// ========== 移动端滑块同步 ==========
function syncMobileSliders() {
  const mY = document.getElementById('mobileGlobalYPercentSlider');
  const mH = document.getElementById('mobileGlobalHPercentSlider');
  const mG = document.getElementById('mobileGapSizeSlider');
  if (mY) mY.value = document.getElementById('globalYPercentSlider').value;
  if (mH) mH.value = document.getElementById('globalHPercentSlider').value;
  if (mG) mG.value = document.getElementById('gapSizeSlider').value;
}

// 桌面滑块变化时同步到移动端
const origGapInput = document.getElementById('gapSizeSlider').oninput;
document.getElementById('gapSizeSlider').addEventListener('input', syncMobileSliders);
document.getElementById('globalYPercentSlider').addEventListener('input', syncMobileSliders);
document.getElementById('globalHPercentSlider').addEventListener('input', syncMobileSliders);

// ========== 按钮事件绑定 ==========
document.getElementById('exportBtn').addEventListener('click', generateHighResCanvas);

// 格式切换时显示/隐藏质量选择器
document.getElementById('exportFormat').addEventListener('change', (e) => {
  const qualitySelect = document.getElementById('exportQuality');
  if (e.target.value === 'png') {
    qualitySelect.classList.add('hidden');
  } else {
    qualitySelect.classList.remove('hidden');
  }
});

document.getElementById('closeModalBtn').addEventListener('click', () => {
  document.getElementById('exportModal').classList.add('hidden');
});
document.getElementById('modalCloseBtn').addEventListener('click', () => {
  document.getElementById('exportModal').classList.add('hidden');
});

// 点击模态框背景关闭
document.getElementById('exportModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('exportModal').classList.add('hidden');
  }
});

// ========== 键盘快捷键 ==========
document.addEventListener('keydown', (e) => {
  // 如果焦点在输入框中，不处理快捷键
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;

  // Ctrl+Z 撤销
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
    e.preventDefault();
    undo();
    return;
  }

  // Ctrl+Shift+Z 重做
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') {
    e.preventDefault();
    redo();
    return;
  }

  // Delete 删除选中图层（暂用最后操作的概念）
  if (e.key === 'Delete' && imgList.length > 0) {
    // 删除最后一个图层（简单实现）
    saveHistory();
    imgList.pop();
    updateLayersList();
    renderCollage();
    showToast('已删除最后一个图层', 'success');
  }

  // Escape 关闭模态框
  if (e.key === 'Escape') {
    document.getElementById('exportModal').classList.add('hidden');
  }
});

// ========== 移动端功能初始化 ==========

function initMobileTabs() {
  const tabs = document.querySelectorAll('[data-mobile-tab]');
  if (!tabs.length) return;

  const panelMap = { gallery: 'mobileTabGallery', adjust: 'mobileTabAdjust', export: 'mobileTabExport' };

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.mobileTab;
      const isActive = btn.classList.contains('active');

      if (_mobilePanelState === 2 || _mobilePanelState === -1) {
        // 收起或自定义拖拽状态 → 展开到半展开，显示该 tab
        _mobilePanelState = 1;
        setActiveTab(btn, tab, tabs, panelMap);
        applyMobilePanelState();
      } else if (isActive) {
        // 点击当前激活的 tab → 收起
        _mobilePanelState = 2;
        applyMobilePanelState();
      } else {
        // 切换到其他 tab，保持当前展开状态
        setActiveTab(btn, tab, tabs, panelMap);
      }
    });
  });
}

function setActiveTab(btn, tab, tabs, panelMap) {
  tabs.forEach(b => {
    b.classList.remove('active', 'text-amber-400');
    b.classList.add('text-zinc-500');
  });
  btn.classList.add('active', 'text-amber-400');
  btn.classList.remove('text-zinc-500');
  document.querySelectorAll('.mobile-tab-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById(panelMap[tab]);
  if (panel) panel.classList.remove('hidden');
}

function initMobileImport() {
  const importBtn = document.getElementById('mobileImportBtn');
  const fileInput = document.getElementById('mobileFileInput');
  if (!importBtn || !fileInput) return;

  importBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = '';
  });
}

function initMobileLayerEvents() {
  const container = document.getElementById('mobileLayersContainer');
  if (!container) return;

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const index = parseInt(btn.dataset.index);

    switch (action) {
      case 'move-up': moveLayer(index, -1); break;
      case 'move-down': moveLayer(index, 1); break;
      case 'delete': deleteLayer(index); break;
      case 'set-full': setLayerMode(index, 'full'); break;
      case 'set-strip': setLayerMode(index, 'strip'); break;
      case 'copy-crop': copyCropParams(index); break;
      case 'paste-crop': pasteCropParams(index); break;
      case 'toggle-crop-collapse': {
        const card = btn.closest('[data-layer-index]');
        if (!card) break;
        const body = card.querySelector(`[data-crop-body="${index}"]`);
        const arrow = card.querySelector(`[data-crop-arrow="${index}"]`);
        if (!body) break;
        const collapsed = body.style.display === 'none';
        body.style.display = collapsed ? '' : 'none';
        if (arrow) arrow.textContent = collapsed ? '▼' : '▶';
        break;
      }
    }
  });

  container.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const index = parseInt(el.dataset.index);
    if (action === 'toggle-custom') toggleCustomCrop(index, el.checked);
  });

  container.addEventListener('input', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const index = parseInt(el.dataset.index);
    if (action === 'update-y') updateLayerCrop(index, 'yPercent', el.value);
    else if (action === 'update-h') updateLayerCrop(index, 'hPercent', el.value);
  });
}

function initMobileLayerDrag() {
  const container = document.getElementById('mobileLayersContainer');
  if (!container) return;

  let state = null;

  function getScrollParent(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') return el;
    }
    return document.documentElement;
  }

  function getInsertPosition(y) {
    const cards = container.querySelectorAll('[data-layer-index]');
    for (const card of cards) {
      if (card === state.element) continue;
      const rect = card.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        return card;
      }
    }
    return null; // end of list
  }

  function removeLine() {
    const line = container.querySelector('.layer-drop-line');
    if (line) line.remove();
  }

  container.addEventListener('touchstart', (e) => {
    const card = e.target.closest('[data-layer-index]');
    if (!card) return;
    if (e.target.closest('button, input, select')) return;

    const touch = e.touches[0];
    state = {
      element: card,
      index: parseInt(card.dataset.layerIndex),
      startY: touch.clientY,
      startX: touch.clientX,
      clone: null,
      active: false,
      timer: setTimeout(() => {
        if (!state) return;
        state.active = true;
        card.classList.add('layer-dragging');

        const rect = card.getBoundingClientRect();
        const clone = card.cloneNode(true);
        clone.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;z-index:999;pointer-events:none;transform:scale(1.05);opacity:0.9;box-shadow:0 8px 24px rgba(0,0,0,0.4);transition:none;border-radius:12px;`;
        document.body.appendChild(clone);
        state.clone = clone;
        state.cloneBaseTop = rect.top;
      }, 400)
    };
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!state) return;

    if (!state.active) {
      const touch = e.touches[0];
      const dist = Math.abs(touch.clientY - state.startY) + Math.abs(touch.clientX - state.startX);
      if (dist > 10) {
        clearTimeout(state.timer);
        state = null;
      }
      return;
    }

    e.preventDefault();
    const touch = e.touches[0];
    const deltaY = touch.clientY - state.startY;

    if (state.clone) {
      state.clone.style.top = (state.cloneBaseTop + deltaY) + 'px';
    }

    removeLine();
    const before = getInsertPosition(touch.clientY);
    const line = document.createElement('div');
    line.className = 'layer-drop-line';
    if (before) {
      container.insertBefore(line, before);
    } else {
      container.appendChild(line);
    }

    const sp = getScrollParent(container);
    const sr = sp.getBoundingClientRect();
    const margin = 40;
    if (touch.clientY - sr.top < margin) sp.scrollTop -= 10;
    else if (sr.bottom - touch.clientY < margin) sp.scrollTop += 10;
  }, { passive: false });

  container.addEventListener('touchend', () => {
    if (!state) return;
    clearTimeout(state.timer);

    if (state.active) {
      if (state.clone && state.clone.parentNode) state.clone.parentNode.removeChild(state.clone);
      state.element.classList.remove('layer-dragging');

      const line = container.querySelector('.layer-drop-line');
      if (line) {
        const next = line.nextElementSibling;
        removeLine();

        let targetIdx;
        if (next && next.dataset && next.dataset.layerIndex !== undefined) {
          targetIdx = parseInt(next.dataset.layerIndex);
        } else {
          targetIdx = imgList.length;
        }

        const srcIdx = state.index;
        if (srcIdx < targetIdx) targetIdx--;

        if (srcIdx !== targetIdx) {
          saveHistory();
          const [moved] = imgList.splice(srcIdx, 1);
          imgList.splice(targetIdx, 0, moved);
          updateLayersList();
          renderCollage();
          showToast('图层顺序已更新', 'success');
        }
      }
    }
    state = null;
  }, { passive: true });

  container.addEventListener('touchcancel', () => {
    if (!state) return;
    clearTimeout(state.timer);
    if (state.active) {
      if (state.clone && state.clone.parentNode) state.clone.parentNode.removeChild(state.clone);
      state.element.classList.remove('layer-dragging');
      state.element.style.transform = '';
    }
    state = null;
  }, { passive: true });
}

function initMobileSliders() {
  const mY = document.getElementById('mobileGlobalYPercentSlider');
  const mH = document.getElementById('mobileGlobalHPercentSlider');
  const mG = document.getElementById('mobileGapSizeSlider');
  if (!mY) return;

  mY.addEventListener('input', () => {
    document.getElementById('globalYPercentSlider').value = mY.value;
    debouncedRenderCollage();
  });

  mH.addEventListener('input', () => {
    document.getElementById('globalHPercentSlider').value = mH.value;
    debouncedRenderCollage();
  });

  mG.addEventListener('input', () => {
    document.getElementById('gapSizeSlider').value = mG.value;
    debouncedRenderCollage();
  });
}

function initMobileDragHandle() {
  const handle = document.getElementById('mobileDragHandle');
  if (!handle) return;

  let startY, startHeight, mainRect;

  function onStart(e) {
    const touch = e.touches ? e.touches[0] : e;
    startY = touch.clientY;
    const tabContent = document.getElementById('mobileTabContent');
    startHeight = tabContent.offsetHeight;
    mainRect = document.getElementById('mobileMain').getBoundingClientRect();
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
  }

  function onMove(e) {
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const tabBar = document.getElementById('mobileTabBar');
    const tabBarHeight = tabBar ? tabBar.offsetHeight : 48;
    const handleHeight = handle.offsetHeight;
    const available = mainRect.height - tabBarHeight - handleHeight;
    const minTab = 60;
    const minPreview = 80;
    const maxTab = available - minPreview;

    const deltaY = startY - touch.clientY;
    let newHeight = startHeight + deltaY;
    newHeight = Math.max(minTab, Math.min(newHeight, maxTab));

    const tabContent = document.getElementById('mobileTabContent');
    const tabPanels = document.getElementById('mobileTabPanels');
    const previewSection = document.getElementById('mobilePreviewSection');
    const previewStrip = document.getElementById('mobilePreviewStrip');

    tabContent.classList.remove('hidden');
    tabContent.classList.add('flex-none');
    tabContent.style.height = newHeight + 'px';
    if (tabPanels) {
      tabPanels.classList.remove('hidden');
      tabPanels.style.overflowY = 'auto';
    }
    previewSection.classList.remove('shrink-0');
    previewSection.classList.add('flex-1', 'flex', 'flex-col', 'overflow-hidden');
    previewStrip.classList.add('flex-1');
  }

  function onEnd() {
    _mobilePanelState = -1; // 标记为自定义拖拽状态
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
  }

  handle.addEventListener('touchstart', onStart, { passive: false });
  handle.addEventListener('mousedown', onStart);
}

function initDesktopDragHandle() {
  const handle = document.getElementById('desktopDragHandle');
  const panel = document.getElementById('desktopPanel');
  if (!handle || !panel) return;

  let startX, startWidth;

  function onStart(e) {
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX;
    startWidth = panel.offsetWidth;
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
  }

  function onMove(e) {
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const deltaX = touch.clientX - startX;
    const main = document.getElementById('desktopMain');
    const maxWidth = Math.round(main.clientWidth / 2);
    const minWidth = 384;
    let newWidth = startWidth + deltaX;
    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
    panel.style.width = newWidth + 'px';
  }

  function onEnd() {
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
  }

  handle.addEventListener('touchstart', onStart, { passive: false });
  handle.addEventListener('mousedown', onStart);
}

let _mobilePanelState = 1; // -1=自定义拖拽, 0=展开, 1=半展开, 2=收起

function applyMobilePanelState() {
  if (_mobilePanelState === -1) return;
  const tabContent = document.getElementById('mobileTabContent');
  const previewSection = document.getElementById('mobilePreviewSection');
  const previewStrip = document.getElementById('mobilePreviewStrip');
  const tabPanels = document.getElementById('mobileTabPanels');
  tabContent.classList.remove('flex-none');
  tabContent.style.height = '';
  if (tabPanels) {
    tabPanels.classList.remove('hidden');
    tabPanels.style.height = '';
    tabPanels.style.overflowY = '';
  }
  previewSection.classList.remove('flex-1', 'flex', 'flex-col', 'overflow-hidden');
  previewStrip.classList.remove('flex-1');
  previewStrip.style.height = '';
  previewSection.classList.add('shrink-0');

  switch (_mobilePanelState) {
    case 0: // 展开 - tab 占大部分
      previewStrip.style.height = '100px';
      break;
    case 1: // 半展开 - 固定区域，各自滚动
      previewSection.classList.remove('shrink-0');
      previewSection.classList.add('flex-1', 'flex', 'flex-col', 'overflow-hidden');
      previewStrip.classList.add('flex-1');
      tabContent.classList.add('flex-none');
      tabContent.style.height = '35vh';
      if (tabPanels) {
        tabPanels.style.overflowY = 'auto';
      }
      break;
    case 2: // 收起 - 预览独占
      if (tabPanels) tabPanels.classList.add('hidden');
      tabContent.classList.add('flex-none');
      previewSection.classList.remove('shrink-0');
      previewSection.classList.add('flex-1', 'flex', 'flex-col', 'overflow-hidden');
      previewStrip.classList.add('flex-1');
      break;
  }
}


function initMobileFullscreen() {
  const openBtn = document.getElementById('mobileFullscreenBtn');
  const closeBtn = document.getElementById('mobileFullscreenClose');
  const overlay = document.getElementById('mobileFullscreenOverlay');
  if (!openBtn) return;

  openBtn.addEventListener('click', () => {
    overlay.classList.remove('hidden');
    const fsPreview = document.getElementById('mobileFullscreenPreview');
    const availWidth = fsPreview.clientWidth || (window.innerWidth - 32);
    if (imgList.length > 0) {
      renderCollageInto(fsPreview, Math.min(availWidth, 800));
    } else {
      fsPreview.innerHTML = '';
    }
  });

  closeBtn.addEventListener('click', () => {
    overlay.classList.add('hidden');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
}

function initMobileExport() {
  const exportBtn = document.getElementById('mobileExportBtn');
  if (!exportBtn) return;

  exportBtn.addEventListener('click', generateHighResCanvas);

  const mFormat = document.getElementById('mobileExportFormat');
  const mWidth = document.getElementById('mobileExportWidth');
  const mQualityWrap = document.getElementById('mobileExportQualityWrap');

  if (mFormat) {
    // 初始隐藏质量选择（PNG 默认）
    if (mQualityWrap) {
      mQualityWrap.classList.toggle('hidden', mFormat.value === 'png');
    }
    mFormat.addEventListener('change', () => {
      document.getElementById('exportFormat').value = mFormat.value;
      if (mQualityWrap) {
        mQualityWrap.classList.toggle('hidden', mFormat.value === 'png');
      }
    });
  }

  if (mWidth) {
    mWidth.addEventListener('change', () => {
      document.getElementById('exportWidth').value = mWidth.value;
    });
  }
}

function initMobileClearAll() {
  const btn = document.getElementById('mobileClearAllBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (imgList.length === 0) return;
    saveHistory();
    imgList = [];
    copiedCrop = null;
    updateLayersList();
    renderCollage();
    showToast('已清空所有图层', 'success');
  });
}

function initMobileUI() {
  initMobileTabs();
  initMobileImport();
  initMobileLayerEvents();
  initMobileLayerDrag();
  initMobileSliders();
  initMobileDragHandle();
  initMobileFullscreen();
  initMobileExport();
  initMobileClearAll();
  syncMobileSliders();
  applyMobilePanelState();
}

// ========== 初始化 ==========
initMobileUI();
initDesktopDragHandle();
saveHistory();
updateLayersList();
renderCollage();

