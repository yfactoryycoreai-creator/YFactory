import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StoryImageRecord } from '@/lib/stories';

type StoryImageLightboxProps = {
  images: StoryImageRecord[];
  initialIndex: number;
  onClose: () => void;
  onDownload: (image: StoryImageRecord) => void;
  downloadingImageId: string | null;
};

type Point = { x: number; y: number };
type GestureStart = Point & { offsetX: number; offsetY: number; scale: number };

function distance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export default function StoryImageLightbox({
  images,
  initialIndex,
  onClose,
  onDownload,
  downloadingImageId,
}: StoryImageLightboxProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureStartRef = useRef<GestureStart | null>(null);
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);
  const hadPinchRef = useRef(false);
  const pointerDownOnStageRef = useRef(false);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const onCloseRef = useRef(onClose);
  const imagesLengthRef = useRef(images.length);
  const image = images[index];
  onCloseRef.current = onClose;
  imagesLengthRef.current = images.length;

  const applyTransform = (nextScale: number, nextOffset: Point) => {
    const boundedScale = Math.min(4, Math.max(1, nextScale));
    const rect = stageRef.current?.getBoundingClientRect();
    const maxX = rect ? (rect.width * (boundedScale - 1)) / 2 : Infinity;
    const maxY = rect ? (rect.height * (boundedScale - 1)) / 2 : Infinity;
    const boundedOffset = {
      x: boundedScale === 1 ? 0 : Math.max(-maxX, Math.min(maxX, nextOffset.x)),
      y: boundedScale === 1 ? 0 : Math.max(-maxY, Math.min(maxY, nextOffset.y)),
    };
    scaleRef.current = boundedScale;
    offsetRef.current = boundedOffset;
    setScale(boundedScale);
    setOffset(boundedOffset);
  };

  const moveImage = (delta: -1 | 1) => {
    setIndex((current) =>
      (current + delta + imagesLengthRef.current) % imagesLengthRef.current,
    );
  };

  const zoomAt = (clientX: number, clientY: number) => {
    if (scaleRef.current > 1.05) {
      applyTransform(1, { x: 0, y: 0 });
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    const nextScale = 2.5;
    const focusX = rect ? clientX - rect.left - rect.width / 2 : 0;
    const focusY = rect ? clientY - rect.top - rect.height / 2 : 0;
    applyTransform(nextScale, {
      x: -focusX * (nextScale - 1),
      y: -focusY * (nextScale - 1),
    });
  };

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      else if (scaleRef.current <= 1.05 && event.key === 'ArrowLeft') moveImage(-1);
      else if (scaleRef.current <= 1.05 && event.key === 'ArrowRight') moveImage(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    applyTransform(1, { x: 0, y: 0 });
    pointersRef.current.clear();
    gestureStartRef.current = null;
    pinchStartRef.current = null;
    hadPinchRef.current = false;
  }, [index]);

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, images.length - 1)));
  }, [images.length]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size === 0) {
      pointerDownOnStageRef.current = event.target === event.currentTarget;
    }
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setDragging(true);
    if (pointers.size === 2) {
      const [first, second] = [...pointers.values()];
      if (first && second) pinchStartRef.current = {
        distance: distance(first, second),
        scale: scaleRef.current,
      };
      hadPinchRef.current = true;
      gestureStartRef.current = null;
    } else {
      gestureStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        offsetX: offsetRef.current.x,
        offsetY: offsetRef.current.y,
        scale: scaleRef.current,
      };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const [first, second] = [...pointers.values()];
      const start = pinchStartRef.current;
      if (first && second && start?.distance) {
        applyTransform(start.scale * (distance(first, second) / start.distance), offsetRef.current);
      }
      return;
    }
    const start = gestureStartRef.current;
    if (!start || start.scale <= 1.05) return;
    applyTransform(start.scale, {
      x: start.offsetX + event.clientX - start.x,
      y: start.offsetY + event.clientY - start.y,
    });
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const start = gestureStartRef.current;
    const point = pointersRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    setDragging(false);
    if (pointersRef.current.size > 0) {
      const remaining = [...pointersRef.current.values()][0];
      if (remaining) {
        gestureStartRef.current = {
          ...remaining,
          offsetX: offsetRef.current.x,
          offsetY: offsetRef.current.y,
          scale: scaleRef.current,
        };
      }
      pinchStartRef.current = null;
      return;
    }
    gestureStartRef.current = null;
    pinchStartRef.current = null;
    if (cancelled) {
      hadPinchRef.current = false;
      return;
    }
    if (hadPinchRef.current) {
      hadPinchRef.current = false;
      return;
    }
    if (!start || !point) return;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    if (start.scale <= 1.05 && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      moveImage(dx < 0 ? 1 : -1);
      lastTapRef.current = null;
      return;
    }
    if (pointerDownOnStageRef.current && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      pointerDownOnStageRef.current = false;
      onCloseRef.current();
      return;
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const now = Date.now();
    const previousTap = lastTapRef.current;
    if (previousTap && now - previousTap.at < 320 &&
        Math.hypot(point.x - previousTap.x, point.y - previousTap.y) < 36) {
      zoomAt(point.x, point.y);
      lastTapRef.current = null;
    } else {
      lastTapRef.current = { at: now, x: point.x, y: point.y };
    }
  };

  if (!image) return null;

  return (
    <div
      className="story-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('stories.imagePreview')}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        className="story-lightbox-close"
        type="button"
        autoFocus
        aria-label={t('stories.closePreview')}
        onClick={onClose}
      >
        <X size={21} />
      </button>
      <button
        className="story-lightbox-nav story-lightbox-previous"
        type="button"
        aria-label={t('stories.previousImage')}
        onClick={() => moveImage(-1)}
        disabled={images.length < 2}
      >
        <ChevronLeft size={25} />
      </button>
      <div
        ref={stageRef}
        className={`story-lightbox-stage${dragging ? ' is-dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)}
      >
        <img
          className="story-lightbox-image"
          src={image.url}
          alt={image.prompt || t('labels.generatedImage')}
          draggable={false}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          }}
        />
      </div>
      <button
        className="story-lightbox-nav story-lightbox-next"
        type="button"
        aria-label={t('stories.nextImage')}
        onClick={() => moveImage(1)}
        disabled={images.length < 2}
      >
        <ChevronRight size={25} />
      </button>
      <div className="story-lightbox-toolbar">
        <span aria-live="polite">{index + 1} / {images.length}</span>
        <button
          type="button"
          aria-label={t('stories.downloadPreview')}
          disabled={downloadingImageId === image.id}
          onClick={() => onDownload(image)}
        >
          <Download size={18} />
          <span>{downloadingImageId === image.id ? t('settings.saving') : t('stories.downloadPreview')}</span>
        </button>
      </div>
    </div>
  );
}
