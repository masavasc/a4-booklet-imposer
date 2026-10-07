(() => {
  'use strict';

  const A4_LANDSCAPE = { width: 841.8897638, height: 595.2755906 }; // pt
  const PAGE_ROLES = ['表紙', '本文', '本文', '本文', '本文', '本文', '本文', '裏表紙'];
  const MAPPINGS = {
    left: {
      name: '横書き・左開き',
      // top row rotated 180°, bottom row upright
      slots: [5, 4, 3, 2, 6, 7, 8, 1]
    },
    right: {
      name: '縦書き・右開き',
      slots: [2, 3, 4, 5, 1, 8, 7, 6]
    }
  };

  const state = {
    pages: Array(8).fill(null),
    sources: new Map(),
    binding: 'left',
    scaleMode: 'fit',
    includeGuides: true
  };

  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    setBusy(false); // Fail-safe: the overlay must never be visible on initial load.
    renderPageCards();
    renderImposition();
    bindEvents();
    configurePdfJs();
    updateUI();
  }

  function cacheElements() {
    els.pageCards = document.getElementById('pageCards');
    els.bulkPdfInput = document.getElementById('bulkPdfInput');
    els.bulkDropzone = document.getElementById('bulkDropzone');
    els.bindingSelect = document.getElementById('bindingSelect');
    els.scaleModeSelect = document.getElementById('scaleModeSelect');
    els.guidesCheck = document.getElementById('guidesCheck');
    els.impositionPreview = document.getElementById('impositionPreview');
    els.readyBadge = document.getElementById('readyBadge');
    els.exportBtn = document.getElementById('exportBtn');
    els.exportHelp = document.getElementById('exportHelp');
    els.resetBtn = document.getElementById('resetBtn');
    els.toast = document.getElementById('toast');
    els.busyOverlay = document.getElementById('busyOverlay');
    els.busyText = document.getElementById('busyText');
  }

  function configurePdfJs() {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
  }

  function bindEvents() {
    els.bulkPdfInput.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) await loadEightPagePdf(file);
    });

    bindDropzone(els.bulkDropzone, async (files) => {
      const pdf = files.find((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
      if (!pdf) return showToast('8ページPDFを指定してください。', true);
      await loadEightPagePdf(pdf);
    });

    els.bindingSelect.addEventListener('change', () => {
      state.binding = els.bindingSelect.value;
      renderImposition();
    });
    els.scaleModeSelect.addEventListener('change', () => { state.scaleMode = els.scaleModeSelect.value; });
    els.guidesCheck.addEventListener('change', () => { state.includeGuides = els.guidesCheck.checked; });
    els.exportBtn.addEventListener('click', exportImposedPdf);
    els.resetBtn.addEventListener('click', resetAll);
  }

  function bindDropzone(element, handler) {
    ['dragenter', 'dragover'].forEach((name) => element.addEventListener(name, (event) => {
      event.preventDefault();
      element.classList.add('is-dragover');
    }));
    ['dragleave', 'drop'].forEach((name) => element.addEventListener(name, (event) => {
      event.preventDefault();
      element.classList.remove('is-dragover');
    }));
    element.addEventListener('drop', (event) => handler([...event.dataTransfer.files]));
  }

  function renderPageCards() {
    els.pageCards.innerHTML = '';
    for (let index = 0; index < 8; index++) {
      const card = document.createElement('article');
      card.className = 'page-card';
      card.dataset.index = index;
      card.innerHTML = `
        <div class="page-card__preview" id="pagePreview${index}">
          <span class="page-no">P${index + 1}</span>
          <span class="page-card__empty">PDF / PNG / JPG<br>をドロップ</span>
        </div>
        <div class="page-card__body">
          <div class="page-card__title">
            <strong>ページ ${index + 1}</strong>
            <span class="page-card__role">${PAGE_ROLES[index]}</span>
          </div>
          <p class="page-card__filename" id="pageFilename${index}">未設定</p>
          <div class="page-card__actions">
            <label class="btn btn--secondary btn--small" for="pageInput${index}">選択</label>
            <input id="pageInput${index}" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" hidden />
            <button class="btn btn--ghost btn--small" type="button" data-remove="${index}" disabled>削除</button>
          </div>
        </div>`;
      els.pageCards.appendChild(card);

      const input = card.querySelector(`#pageInput${index}`);
      input.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) await loadSinglePage(index, file);
      });

      card.querySelector(`[data-remove="${index}"]`).addEventListener('click', () => removePage(index));
      bindDropzone(card, async (files) => {
        const file = files[0];
        if (file) await loadSinglePage(index, file);
      });
    }
  }

  async function ensureLibraries(requirePdfLib = false) {
    if (!window.pdfjsLib) {
      throw new Error('PDF表示ライブラリを読み込めませんでした。インターネット接続を確認して再読み込みしてください。');
    }
    if (requirePdfLib && !window.PDFLib) {
      throw new Error('PDF作成ライブラリを読み込めませんでした。インターネット接続を確認して再読み込みしてください。');
    }
  }

  async function loadEightPagePdf(file) {
    setBusy(true, '8ページPDFを読み込んでいます…');
    try {
      await ensureLibraries();
      const bytes = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
      if (pdf.numPages < 8) throw new Error(`このPDFは${pdf.numPages}ページです。8ページ以上のPDFを指定してください。`);

      clearSources();
      const sourceId = createSource(file, bytes, 'pdf');
      for (let i = 0; i < 8; i++) {
        const pdfPage = await pdf.getPage(i + 1);
        const viewport = pdfPage.getViewport({ scale: 1 });
        const thumbUrl = await renderPdfThumbnail(pdfPage);
        state.pages[i] = {
          sourceId,
          type: 'pdf',
          pageIndex: i,
          name: `${file.name} — ${i + 1}ページ`,
          thumbUrl,
          width: viewport.width,
          height: viewport.height
        };
      }
      updateUI();
      showToast('8ページを読み込みました。');
      if (pdf.numPages > 8) showToast(`先頭8ページを使用しています（全${pdf.numPages}ページ）。`);
    } catch (error) {
      console.error(error);
      showToast(error.message || 'PDFを読み込めませんでした。', true);
    } finally {
      setBusy(false);
    }
  }

  async function loadSinglePage(index, file) {
    setBusy(true, `ページ${index + 1}を読み込んでいます…`);
    try {
      const lower = file.name.toLowerCase();
      const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');
      const isPng = file.type === 'image/png' || lower.endsWith('.png');
      const isJpg = file.type === 'image/jpeg' || /\.jpe?g$/.test(lower);
      if (!isPdf && !isPng && !isJpg) throw new Error('PDF、PNG、JPGのいずれかを指定してください。');

      removePage(index, false);
      const bytes = await file.arrayBuffer();
      if (isPdf) {
        await ensureLibraries();
        const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const sourceId = createSource(file, bytes, 'pdf');
        state.pages[index] = {
          sourceId, type: 'pdf', pageIndex: 0, name: file.name,
          thumbUrl: await renderPdfThumbnail(page), width: viewport.width, height: viewport.height
        };
        if (pdf.numPages > 1) showToast(`${file.name}: 1ページ目だけを使用します。`);
      } else {
        const imageInfo = await inspectImage(file);
        const sourceId = createSource(file, bytes, isPng ? 'png' : 'jpg');
        state.pages[index] = {
          sourceId, type: isPng ? 'png' : 'jpg', pageIndex: 0, name: file.name,
          thumbUrl: imageInfo.url, width: imageInfo.width, height: imageInfo.height
        };
      }
      updateUI();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'ファイルを読み込めませんでした。', true);
    } finally {
      setBusy(false);
    }
  }

  function newSourceId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  }

  function createSource(file, bytes, type, id = newSourceId()) {
    state.sources.set(id, { id, name: file.name, type, bytes });
    return id;
  }

  function sourceStillUsed(sourceId) {
    return state.pages.some((page) => page?.sourceId === sourceId);
  }

  function releaseThumbnail(page) {
    if (page?.type !== 'pdf' && page?.thumbUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(page.thumbUrl);
    }
  }

  function removePage(index, refresh = true) {
    const old = state.pages[index];
    state.pages[index] = null;
    releaseThumbnail(old);
    if (old && !sourceStillUsed(old.sourceId)) state.sources.delete(old.sourceId);
    if (refresh) updateUI();
  }

  function clearSources() {
    state.pages.forEach(releaseThumbnail);
    state.pages = Array(8).fill(null);
    state.sources.clear();
  }

  function resetAll() {
    clearSources();
    updateUI();
    showToast('すべてのページを消去しました。');
  }

  async function renderPdfThumbnail(page) {
    const base = page.getViewport({ scale: 1 });
    const targetWidth = 300;
    const scale = Math.min(targetWidth / base.width, 420 / base.height) * Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.88);
  }

  function inspectImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした。')); };
      img.src = url;
    });
  }

  function updateUI() {
    state.pages.forEach((page, index) => updatePageCard(index, page));
    renderImposition();
    const count = state.pages.filter(Boolean).length;
    els.readyBadge.textContent = `${count} / 8 ページ`;
    els.readyBadge.classList.toggle('is-ready', count === 8);
    els.exportBtn.disabled = count !== 8;
    els.exportHelp.textContent = count === 8
      ? `${MAPPINGS[state.binding].name}としてA4横1枚へ面付けします。`
      : `あと${8 - count}ページ読み込むと出力できます。`;
  }

  function updatePageCard(index, page) {
    const preview = document.getElementById(`pagePreview${index}`);
    const filename = document.getElementById(`pageFilename${index}`);
    const remove = document.querySelector(`[data-remove="${index}"]`);
    preview.innerHTML = `<span class="page-no">P${index + 1}</span>`;
    if (page) {
      const img = document.createElement('img');
      img.src = page.thumbUrl;
      img.alt = `ページ${index + 1}のプレビュー`;
      preview.appendChild(img);
      filename.textContent = page.name;
      remove.disabled = false;
    } else {
      const empty = document.createElement('span');
      empty.className = 'page-card__empty';
      empty.innerHTML = 'PDF / PNG / JPG<br>をドロップ';
      preview.appendChild(empty);
      filename.textContent = '未設定';
      remove.disabled = true;
    }
  }

  function renderImposition() {
    if (!els.impositionPreview) return;
    const mapping = MAPPINGS[state.binding].slots;
    els.impositionPreview.innerHTML = '';
    mapping.forEach((pageNo, slotIndex) => {
      const page = state.pages[pageNo - 1];
      const slot = document.createElement('div');
      slot.className = `imposition-slot${slotIndex < 4 ? ' is-rotated' : ''}`;
      const inner = document.createElement('div');
      inner.className = 'imposition-slot__inner';
      if (page) {
        const img = document.createElement('img');
        img.src = page.thumbUrl;
        img.alt = `ページ${pageNo}`;
        inner.appendChild(img);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'imposition-slot__placeholder';
        placeholder.textContent = `P${pageNo}`;
        inner.appendChild(placeholder);
      }
      const label = document.createElement('span');
      label.className = 'imposition-slot__label';
      label.textContent = `P${pageNo}${PAGE_ROLES[pageNo - 1] !== '本文' ? ' ' + PAGE_ROLES[pageNo - 1] : ''}`;
      inner.appendChild(label);
      slot.appendChild(inner);
      els.impositionPreview.appendChild(slot);
    });
  }

  async function exportImposedPdf() {
    if (state.pages.some((page) => !page)) return;
    setBusy(true, 'A4面付けPDFを作成しています…');
    try {
      await ensureLibraries(true);
      const { PDFDocument, degrees, rgb } = window.PDFLib;
      const out = await PDFDocument.create();
      const sheet = out.addPage([A4_LANDSCAPE.width, A4_LANDSCAPE.height]);
      const slotW = A4_LANDSCAPE.width / 4;
      const slotH = A4_LANDSCAPE.height / 2;
      const mapping = MAPPINGS[state.binding].slots;
      const embedCache = new Map();

      for (let slotIndex = 0; slotIndex < 8; slotIndex++) {
        const logicalPageNo = mapping[slotIndex];
        const entry = state.pages[logicalPageNo - 1];
        const source = state.sources.get(entry.sourceId);
        if (!source) throw new Error(`ページ${logicalPageNo}の元データが見つかりません。`);

        let embedded;
        let sourceW = entry.width;
        let sourceH = entry.height;
        const cacheKey = `${entry.sourceId}:${entry.pageIndex}`;

        if (embedCache.has(cacheKey)) {
          embedded = embedCache.get(cacheKey);
        } else if (entry.type === 'pdf') {
          let inputDoc = source.pdfLibDoc;
          if (!inputDoc) {
            inputDoc = await PDFDocument.load(source.bytes.slice(0));
            source.pdfLibDoc = inputDoc;
          }
          const inputPage = inputDoc.getPage(entry.pageIndex);
          const size = inputPage.getSize();
          sourceW = size.width;
          sourceH = size.height;
          [embedded] = await out.embedPages([inputPage]);
          embedCache.set(cacheKey, embedded);
        } else if (entry.type === 'png') {
          embedded = await out.embedPng(source.bytes.slice(0));
          embedCache.set(cacheKey, embedded);
          sourceW = embedded.width;
          sourceH = embedded.height;
        } else {
          embedded = await out.embedJpg(source.bytes.slice(0));
          embedCache.set(cacheKey, embedded);
          sourceW = embedded.width;
          sourceH = embedded.height;
        }

        const col = slotIndex % 4;
        const topRow = slotIndex < 4;
        const slotX = col * slotW;
        const slotY = topRow ? slotH : 0;
        const placement = computePlacement(sourceW, sourceH, slotX, slotY, slotW, slotH, state.scaleMode);

        const options = {
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height
        };
        if (topRow) {
          options.x = placement.x + placement.width;
          options.y = placement.y + placement.height;
          options.rotate = degrees(180);
        }

        if (entry.type === 'pdf') sheet.drawPage(embedded, options);
        else sheet.drawImage(embedded, options);
      }

      if (state.includeGuides) drawGuides(sheet, slotW, slotH, rgb);

      const bytes = await out.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `A4_8page_booklet_${state.binding === 'left' ? 'left-open' : 'right-open'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('A4面付けPDFを作成しました。');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'PDFの作成に失敗しました。', true);
    } finally {
      setBusy(false);
    }
  }

  function computePlacement(sourceW, sourceH, slotX, slotY, slotW, slotH, mode) {
    if (mode === 'stretch') {
      return { x: slotX, y: slotY, width: slotW, height: slotH };
    }
    const scale = Math.min(slotW / sourceW, slotH / sourceH);
    const width = sourceW * scale;
    const height = sourceH * scale;
    return {
      x: slotX + (slotW - width) / 2,
      y: slotY + (slotH - height) / 2,
      width,
      height
    };
  }

  function drawGuides(sheet, slotW, slotH, rgb) {
    const foldColor = rgb(0.72, 0.70, 0.67);
    const cutColor = rgb(0.78, 0.16, 0.12);
    const dash = [3, 3];

    // Vertical fold lines
    for (let i = 1; i < 4; i++) {
      sheet.drawLine({
        start: { x: i * slotW, y: 0 },
        end: { x: i * slotW, y: A4_LANDSCAPE.height },
        thickness: 0.45,
        color: foldColor,
        dashArray: dash,
        opacity: 0.7
      });
    }
    // Horizontal fold line, excluding the cut section so the cut is visually unambiguous.
    sheet.drawLine({
      start: { x: 0, y: slotH }, end: { x: slotW, y: slotH },
      thickness: 0.45, color: foldColor, dashArray: dash, opacity: 0.7
    });
    sheet.drawLine({
      start: { x: 3 * slotW, y: slotH }, end: { x: 4 * slotW, y: slotH },
      thickness: 0.45, color: foldColor, dashArray: dash, opacity: 0.7
    });
    // Standard one-cut slit across the middle two panels.
    sheet.drawLine({
      start: { x: slotW, y: slotH },
      end: { x: 3 * slotW, y: slotH },
      thickness: 1.2,
      color: cutColor,
      opacity: 0.9
    });
  }

  function setBusy(on, text = '処理中…') {
    if (!els.busyOverlay || !els.busyText) return;
    els.busyText.textContent = text;
    els.busyOverlay.hidden = !on;
    els.busyOverlay.setAttribute('aria-hidden', on ? 'false' : 'true');
    els.busyOverlay.classList.toggle('is-active', on);
    // Inline display is intentional: it remains reliable even if an older CSS file is cached.
    els.busyOverlay.style.display = on ? 'grid' : 'none';
  }

  let toastTimer;
  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.toggle('error', isError);
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
  }

  // Expose pure helpers for simple verification in the browser console/tests.
  window.BookletImposer = {
    mappings: MAPPINGS,
    computePlacement
  };
})();
