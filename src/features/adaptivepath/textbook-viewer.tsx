"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LocateFixed, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import locations from "./textbook-locations.json";

export function referenceLocations(referenceIds: string[]) {
  const legacy = locations.legacy_reference_ids as Record<string, string[]>;
  const ids = new Set(referenceIds.flatMap(id => legacy[id] ?? [id]));
  return locations.chunks.filter(chunk => ids.has(chunk.id));
}

/** Rasterize the original PDF at the current zoom, never a pre-extracted page image. */
function PdfPage({ document, page, width, renderKey, onReady, onError }: {
  document: PDFDocumentProxy; page: number; width: number; renderKey: string;
  onReady: (key: string) => void; onError: (message: string) => void;
}) {
  const target = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | undefined;
    void document.getPage(page).then(async pdfPage => {
      if (cancelled || !target.current) return;
      const viewport = pdfPage.getViewport({ scale: width / pdfPage.getViewport({ scale: 1 }).width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = target.current;
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      task = pdfPage.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
      if (!cancelled) onReady(renderKey);
    }).catch(() => { if (!cancelled) onError("This PDF page could not be rendered."); });
    return () => { cancelled = true; task?.cancel(); };
  }, [document, page, width, renderKey, onReady, onError]);
  return <canvas ref={target} role="img" aria-label={`Biology 2e PDF, printed page ${315 + page}`} className="block h-auto w-full" data-testid="textbook-pdf-page" data-page={page}/>;
}

/** A fixed, first-column PDF preview. PDF pages and reference boxes share one coordinate plane. */
export function TextbookViewer({ referenceIds }: { referenceIds: string[] }) {
  const references = useMemo(() => referenceLocations(referenceIds), [referenceIds]);
  const first = references[0];
  const [page, setPage] = useState(first?.page ?? 1);
  const [zoom, setZoom] = useState(1);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [renderedKey, setRenderedKey] = useState("");
  const [width, setWidth] = useState(300);
  const [focusId, setFocusId] = useState(first?.id);
  const [focusSequence, setFocusSequence] = useState(0);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const sheet = locations.pages[page - 1];
  const visible = references.filter(ref => ref.page === page);
  const canvasWidth = Math.max(180, width - 24) * zoom;
  const renderKey = `${page}:${canvasWidth}:${retry}`;

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    void import("pdfjs-dist").then(async pdfjs => {
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = "/api/adaptivepath/textbook/worker";
      task = pdfjs.getDocument({ url: "/api/adaptivepath/textbook/document", disableRange: true });
      const pdf = await task.promise;
      if (!cancelled) setDocument(pdf);
    }).catch(() => { if (!cancelled) setError("The textbook PDF could not be opened."); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [retry]);

  useEffect(() => {
    const element = viewport;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);

  useEffect(() => {
    const element = viewport;
    if (!element || renderedKey !== renderKey) return;
    const ref = references.find(item => item.id === focusId && item.page === page);
    const scale = canvasWidth / sheet.width_pixels;
    element.scrollTo({
      top: ref ? Math.max(0, ref.bbox[1] * scale - 24) : 0,
      left: ref ? Math.max(0, (canvas.current?.offsetLeft ?? 0) + ref.bbox[0] * scale - 16) : 0,
      behavior: "instant",
    });
  }, [page, renderedKey, renderKey, canvasWidth, focusId, focusSequence, viewport, references, sheet.width_pixels]);

  function locate(id = first?.id) {
    const ref = references.find(item => item.id === id);
    if (!ref) return;
    setPage(ref.page); setFocusId(ref.id); setFocusSequence(value => value + 1);
  }

  const reader = <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50" data-testid="textbook-reader">
    <p className="border-b border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">Biology 2e · PDF</p>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white p-2">
      <div className="flex items-center gap-1">
        <button aria-label="Previous textbook page" disabled={page === 1} onClick={() => setPage(value => value - 1)} className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={16}/></button>
        <select aria-label="Textbook page" value={page} onChange={event => setPage(Number(event.target.value))} className="min-w-0 rounded border border-slate-200 bg-white px-1 py-1 text-xs">
          {locations.pages.map(item => <option key={item.page} value={item.page}>p. {item.printed_page} · {item.page}/12</option>)}
        </select>
        <button aria-label="Next textbook page" disabled={page === 12} onClick={() => setPage(value => value + 1)} className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={16}/></button>
      </div>
      <div className="flex items-center gap-1">
        <button aria-label="Zoom out textbook" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))} className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-30"><Minus size={15}/></button>
        <button aria-label="Fit textbook to width" onClick={() => setZoom(1)} className="min-w-10 rounded p-1 text-xs hover:bg-slate-100">{Math.round(zoom * 100)}%</button>
        <button aria-label="Zoom in textbook" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + .5))} className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-30"><Plus size={15}/></button>
      </div>
    </div>
    {references.length > 0 && <div className="flex flex-wrap gap-1.5 border-b border-slate-200 p-2">
      {references.map((ref, index) => <button key={ref.id} aria-label={`Locate reference ${index + 1} on page ${ref.printed_page}`} onClick={() => locate(ref.id)} className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"><LocateFixed size={12}/>Reference {index + 1} · p. {ref.printed_page}</button>)}
    </div>}
    <div ref={setViewport} tabIndex={0} aria-label="Textbook page viewport" className="relative h-[420px] overflow-auto overscroll-contain">
      {renderedKey !== renderKey && !error && <p role="status" className="absolute left-3 top-3 z-10 rounded bg-white p-2 text-xs">Loading PDF page…</p>}
      {error ? <p role="alert" className="p-4 text-sm">{error} <button onClick={() => { setError(""); setDocument(null); setRetry(value => value + 1); }} className="text-teal-700 underline">Retry</button></p> : <div className="min-w-full p-3">
        <div ref={canvas} className="relative mx-auto bg-white shadow-sm" style={{ width: canvasWidth, aspectRatio: `${sheet.width_pixels}/${sheet.height_pixels}` }}>
          {document && <PdfPage key={renderKey} document={document} page={page} width={canvasWidth} renderKey={renderKey} onReady={setRenderedKey} onError={setError}/>}
          {visible.map((ref, index) => <div key={ref.id} data-testid="textbook-highlight" data-chunk-id={ref.id} aria-label={`Highlighted reference on page ${ref.printed_page}: ${ref.subsection}`} className="pointer-events-none absolute rounded-sm border-2 border-amber-500 bg-amber-200/20" style={{ left: `${ref.bbox[0] / sheet.width_pixels * 100}%`, top: `${ref.bbox[1] / sheet.height_pixels * 100}%`, width: `${(ref.bbox[2] - ref.bbox[0]) / sheet.width_pixels * 100}%`, height: `${(ref.bbox[3] - ref.bbox[1]) / sheet.height_pixels * 100}%` }}>
            <span aria-hidden="true" className="absolute -top-4 left-0 rounded bg-amber-500 px-1 text-[10px] font-bold text-white">{references.indexOf(visible[index]) + 1}</span>
          </div>)}
        </div>
      </div>}
    </div>
    <p aria-live="polite" className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-600">{visible.length ? "Amber boxes mark this question’s source passages." : "No reference on this page. Use a reference button to return."}</p>
  </div>;

  if (!first) return <p className="text-sm text-slate-500">No page location is available for this reference.</p>;
  return reader;
}
