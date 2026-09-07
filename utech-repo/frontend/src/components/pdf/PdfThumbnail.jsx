import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { FileText } from 'lucide-react';
import api from '../../lib/api';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const THUMB_WIDTH = 220;

export default function PdfThumbnail({ attachmentId, className, onLoaded }) {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api.get(`/attachments/file/${attachmentId}`, { responseType: 'arraybuffer' })
      .then(async (r) => {
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: r.data }).promise;
        if (!cancelled) onLoaded?.(pdf.numPages);
        const page = await pdf.getPage(1);
        const unscaled = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const viewport = page.getViewport({ scale: (THUMB_WIDTH / unscaled.width) * dpr });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        // CSS keeps the on-screen size; the extra pixels just sharpen it
        canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attachmentId]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-slate-50 text-slate-300 ${className || ''}`}>
        <FileText className="w-10 h-10" />
      </div>
    );
  }
  return <canvas ref={canvasRef} className={className} />;
}
