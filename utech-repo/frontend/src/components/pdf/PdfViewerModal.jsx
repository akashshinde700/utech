import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, Minimize,
  Download, PanelLeft, AlertTriangle, ListChecks, Check, Lock,
} from 'lucide-react';
import api from '../../lib/api';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const iconBtn = 'w-8 h-8 rounded-lg inline-flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-25 disabled:pointer-events-none';

// Full-screen, page-by-page PDF viewer (Google Drive / Adobe style) — renders
// pages lazily to <canvas> via pdf.js, one page in memory at a time. Thumbnails
// render on demand (IntersectionObserver) so 100+ page docs stay light.
export default function PdfViewerModal({
  attachmentId, filename, onClose, onDownload, onAssign, initialSelectMode = false, allowedPages = null,
  takenPages = null,
}) {
  // when set, this viewer only ever shows/navigates the given page numbers —
  // used when a Department/Operator opens a PDF that was only partially
  // assigned to them (specific pages), not the whole document.
  const restricted = Array.isArray(allowedPages) && allowedPages.length > 0;
  const pageList = restricted ? [...allowedPages].sort((a, b) => a - b) : null;

  // { [pageNumber]: label } — pages already handed out to someone, shown
  // locked in select mode so the same page can't be double-assigned by accident
  const takenMap = takenPages || {};

  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(restricted ? pageList[0] : 1);
  const [scale, setScale] = useState(1.2);
  const [fitWidth, setFitWidth] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [renderingPage, setRenderingPage] = useState(false);
  const [error, setError] = useState(null);
  // tablets/phones open without the thumbnail rail — it eats ~1/3 of an 8" screen
  const [showThumbs, setShowThumbs] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectMode, setSelectMode] = useState(initialSelectMode);
  const [selectedPages, setSelectedPages] = useState(new Set());

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const renderTaskRef = useRef(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const renderedScaleRef = useRef(1.2); // actual scale last painted (fit-width resolves to a number)
  const pinchRef = useRef(null);        // { startDist, startScale } during a 2-finger gesture

  useEffect(() => {
    let cancelled = false;
    setLoadingDoc(true); setError(null);
    api.get(`/attachments/file/${attachmentId}`, { responseType: 'arraybuffer' })
      .then((r) => pdfjsLib.getDocument({ data: r.data }).promise)
      .then((doc) => {
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(restricted ? pageList[0] : 1);
      })
      .catch(() => { if (!cancelled) setError('Could not load this PDF — it may be corrupted.'); })
      .finally(() => { if (!cancelled) setLoadingDoc(false); });
    return () => { cancelled = true; };
  }, [attachmentId]);

  const renderPage = useCallback(async (n, sc, fit) => {
    if (!pdfDoc) return;
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch { /* ignore */ } }
    setRenderingPage(true);
    try {
      const page = await pdfDoc.getPage(n);
      let useScale = sc;
      if (fit && containerRef.current) {
        const unscaled = page.getViewport({ scale: 1 });
        // small screens use tighter gutters so the page isn't needlessly shrunk
        const gutter = containerRef.current.clientWidth < 640 ? 12 : 32;
        useScale = Math.max(0.2, (containerRef.current.clientWidth - gutter) / unscaled.width);
      }
      renderedScaleRef.current = useScale;
      // render at the device pixel ratio so text stays crisp on retina / tablet
      // panels, then scale the canvas back down with CSS to its layout size
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const viewport = page.getViewport({ scale: useScale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const task = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      renderTaskRef.current = task;
      await task.promise;
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') setError('Could not render this page.');
    } finally {
      setRenderingPage(false);
    }
  }, [pdfDoc]);

  // re-render on page/zoom/fit changes and whenever the thumbnail rail toggles
  // (that changes the canvas column width, so fit-width must recompute)
  useEffect(() => { renderPage(pageNum, scale, fitWidth); }, [pageNum, scale, fitWidth, showThumbs, renderPage]);

  useEffect(() => {
    if (!fitWidth) return;
    const onResize = () => renderPage(pageNum, scale, true);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitWidth, pageNum, scale, renderPage]);

  const prev = useCallback(() => setPageNum((p) => {
    if (!restricted) return Math.max(1, p - 1);
    const idx = pageList.indexOf(p);
    return idx > 0 ? pageList[idx - 1] : p;
  }), [restricted, pageList]);
  const next = useCallback(() => setPageNum((p) => {
    if (!restricted) return Math.min(numPages || p, p + 1);
    const idx = pageList.indexOf(p);
    return idx >= 0 && idx < pageList.length - 1 ? pageList[idx + 1] : p;
  }), [restricted, pageList, numPages]);
  const canPrev = restricted ? pageList.indexOf(pageNum) > 0 : pageNum > 1;
  const canNext = restricted ? pageList.indexOf(pageNum) < pageList.length - 1 : !!numPages && pageNum < numPages;

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose]);

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function zoomIn() { setFitWidth(false); setScale((s) => Math.min(3, +(s + 0.2).toFixed(2))); }
  function zoomOut() { setFitWidth(false); setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(2))); }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) await viewerRef.current?.requestFullscreen?.();
    else await document.exitFullscreen?.();
  }

  function togglePageSelect(n) {
    if (takenMap[n]) return; // already assigned to someone — not selectable again
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }

  const takenCount = Object.keys(takenMap).length;

  function handleAssign() {
    if (selectedPages.size) { onAssign([...selectedPages].sort((a, b) => a - b)); return; }
    // no explicit selection: restricted viewers can only ever hand off what
    // was given to them (their full allowed page set), never "whole document"
    if (restricted) { onAssign(pageList); return; }
    // if some pages are already taken, "no selection" means "everything still
    // free" rather than the whole document (which would re-assign taken pages)
    if (takenCount && numPages) {
      const free = Array.from({ length: numPages }, (_, i) => i + 1).filter((p) => !takenMap[p]);
      onAssign(free);
      return;
    }
    onAssign(null);
  }

  const touchDist = (t) => Math.hypot(
    t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY
  );

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      pinchRef.current = { startDist: touchDist(e.touches), startScale: renderedScaleRef.current };
      touchStartX.current = null;
      return;
    }
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function onTouchMove(e) {
    if (e.touches.length !== 2 || !pinchRef.current) return;
    if (e.cancelable) e.preventDefault(); // stop the browser's own page zoom fighting us
    const ratio = touchDist(e.touches) / pinchRef.current.startDist;
    const nextScale = Math.min(5, Math.max(0.3, +(pinchRef.current.startScale * ratio).toFixed(3)));
    setFitWidth(false);
    setScale(nextScale);
  }

  function onTouchEnd(e) {
    if (pinchRef.current) { pinchRef.current = null; return; }
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    // only treat it as a page-turn swipe when the page is at fit-width (not
    // zoomed/panning) and the motion is clearly horizontal
    if (fitWidth && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      (dx > 0 ? prev() : next());
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col" ref={viewerRef}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2 sm:px-3 py-2 bg-slate-900 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button type="button" className={iconBtn} onClick={() => setShowThumbs((v) => !v)} title="Toggle thumbnails">
            <PanelLeft className="w-4 h-4" />
          </button>
          <span className="hidden sm:block text-sm font-medium text-white truncate">{filename}</span>
          {restricted && (
            <span className="text-[10px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5 shrink-0">
              Assigned pages only
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-white shrink-0">
          <button type="button" className={iconBtn} onClick={prev} disabled={!canPrev}><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-xs tabular-nums px-1 min-w-[64px] text-center">
            {restricted
              ? (pageList.length ? `${pageList.indexOf(pageNum) + 1} / ${pageList.length}` : '—')
              : (numPages ? `${pageNum} / ${numPages}` : '—')}
          </span>
          <button type="button" className={iconBtn} onClick={next} disabled={!canNext}><ChevronRight className="w-4 h-4" /></button>
          {selectMode && (
            <button
              type="button"
              onClick={() => togglePageSelect(pageNum)}
              className={`ml-1 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                selectedPages.has(pageNum)
                  ? 'bg-emerald-500 border-emerald-500 text-white'
                  : 'bg-white/5 border-white/20 text-white/80 hover:bg-white/10'
              }`}
              title="Select/unselect this page"
            >
              <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${selectedPages.has(pageNum) ? 'border-white' : 'border-white/50'}`}>
                {selectedPages.has(pageNum) && <Check className="w-3 h-3" />}
              </span>
              {selectedPages.has(pageNum) ? 'Selected' : 'Select this page'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button type="button" className={iconBtn} onClick={zoomOut} title="Zoom out"><ZoomOut className="w-4 h-4" /></button>
          <button type="button" className="text-[11px] text-white/80 hover:text-white px-1.5 min-w-[42px]" onClick={() => setFitWidth(true)} title="Fit width">
            {fitWidth ? 'Fit' : `${Math.round(scale * 100)}%`}
          </button>
          <button type="button" className={iconBtn} onClick={zoomIn} title="Zoom in"><ZoomIn className="w-4 h-4" /></button>
          <button type="button" className={`${iconBtn} hidden sm:inline-flex`} onClick={toggleFullscreen} title="Full screen">
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
          {onDownload && <button type="button" className={iconBtn} onClick={onDownload} title="Download"><Download className="w-4 h-4" /></button>}
          {onAssign && (
            <button
              type="button"
              className={`${iconBtn} ${selectMode ? 'bg-brand-600 text-white hover:bg-brand-700' : ''}`}
              onClick={() => { setSelectMode((v) => !v); setSelectedPages(new Set()); }}
              title="Select pages to assign"
            >
              <ListChecks className="w-4 h-4" />
            </button>
          )}
          <button type="button" className={iconBtn} onClick={onClose} title="Close (Esc)"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {showThumbs && pdfDoc && numPages > 0 && (
          <div className="w-20 sm:w-28 lg:w-32 shrink-0 bg-slate-950/70 overflow-y-auto p-2 space-y-2 flex flex-col">
            {(restricted ? pageList : Array.from({ length: numPages }, (_, i) => i + 1)).map((pn) => (
              <PdfThumbButton
                key={pn} pdfDoc={pdfDoc} pageNum={pn}
                active={pageNum === pn}
                selectMode={selectMode}
                selected={selectedPages.has(pn)}
                takenLabel={selectMode ? takenMap[pn] : null}
                onClick={() => (selectMode ? togglePageSelect(pn) : setPageNum(pn))}
              />
            ))}
            {selectMode && (
              <button type="button" className="w-full mt-1 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium sticky bottom-0" onClick={handleAssign}>
                {selectedPages.size
                  ? `Assign ${selectedPages.size} page${selectedPages.size > 1 ? 's' : ''}`
                  : restricted ? `Assign all ${pageList.length} assigned page${pageList.length > 1 ? 's' : ''}`
                  : takenCount && numPages ? `Assign remaining ${numPages - takenCount} page${numPages - takenCount === 1 ? '' : 's'}`
                  : 'Assign whole document'}
              </button>
            )}
          </div>
        )}

        <div
          ref={containerRef}
          className="flex-1 overflow-auto flex items-start justify-center p-2 sm:p-4 relative touch-pan-y"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {loadingDoc && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          )}

          {error && !loadingDoc && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 gap-2 px-6 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
              <div className="text-sm">{error}</div>
            </div>
          )}

          {!loadingDoc && !error && (
            <div className="relative shrink-0">
              {renderingPage && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
                  <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                </div>
              )}
              <canvas ref={canvasRef} className="shadow-2xl bg-white block" />
            </div>
          )}

          {!loadingDoc && !error && (
            <>
              <button
                type="button" onClick={prev} disabled={!canPrev}
                className="hidden sm:flex absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 text-white items-center justify-center disabled:opacity-20"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button" onClick={next} disabled={!canNext}
                className="hidden sm:flex absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 text-white items-center justify-center disabled:opacity-20"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PdfThumbButton({ pdfDoc, pageNum, active, onClick, selectMode, selected, takenLabel }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '300px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || rendered) return;
    let cancelled = false;
    pdfDoc.getPage(pageNum).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const viewport = page.getViewport({ scale: 0.3 * dpr });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      return page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }).then(() => { if (!cancelled) setRendered(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, rendered, pdfDoc, pageNum]);

  return (
    <button
      ref={wrapRef} type="button" onClick={onClick}
      title={takenLabel ? `Already assigned to ${takenLabel}` : undefined}
      className={`w-full block rounded-lg overflow-hidden relative ${takenLabel ? 'cursor-not-allowed' : ''}`}
    >
      <div className={`border-2 rounded-t-lg overflow-hidden bg-white min-h-[40px] ${selected ? 'border-emerald-500' : active ? 'border-brand-500' : 'border-transparent'}`}>
        <canvas ref={canvasRef} className={`w-full block ${takenLabel ? 'opacity-35' : ''}`} />
        {selectMode && !takenLabel && (
          <div className={`absolute top-1 right-1 w-4 h-4 rounded flex items-center justify-center ${selected ? 'bg-emerald-500' : 'bg-black/40 border border-white/60'}`}>
            {selected && <Check className="w-3 h-3 text-white" />}
          </div>
        )}
        {takenLabel && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/10">
            <Lock className="w-4 h-4 text-amber-600" />
          </div>
        )}
      </div>
      <div className={`text-[10px] text-center py-0.5 rounded-b-lg truncate px-0.5 ${
        takenLabel ? 'bg-amber-500 text-white' : selected ? 'bg-emerald-500 text-white' : active ? 'bg-brand-500 text-white' : 'bg-slate-800 text-slate-300'
      }`}>{takenLabel ? takenLabel : pageNum}</div>
    </button>
  );
}
