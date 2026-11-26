import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  Camera,
  Check,
  LoaderCircle,
  RotateCcw,
  SwitchCamera,
  Upload,
  Video,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { isRtlLanguage } from "@/lib/languages";
import "./in-app-camera.css";

type InAppCameraModalProps = {
  open: boolean;
  locale: string;
  mode?: "document" | "photo" | "video";
  onClose: () => void;
  onCapture: (file: File) => void;
  onCaptureVideoFrames?: (files: File[], durationSec: number) => void;
};

type CapturedFrameItem = {
  file: File;
  url: string;
  sec: number;
};

const MAX_VIDEO_SECONDS = 20;
const MAX_VIDEO_KEYFRAMES = 4;

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      titleDoc: "كاميرا تصوير الامتحان / الدرس",
      titlePhoto: "كاميرا YFactory المدمجة",
      titleVideo: "تسجيل فيديو ذكي للمحادثة",
      guideDoc: "وجّه الكاميرا لورقة الامتحان أو الدرس داخل الإطار",
      guidePhoto: "وجّه الكاميرا ثم اضغط زر الالتقاط",
      guideVideoIdle: "اضغط زر التسجيل الأحمر (حتى 20 ثانية) ليُحلل النموذج الفيديو بخفة",
      guideVideoRec: "جارٍ التسجيل... اضغط إيقاف عند الانتهاء",
      videoSummary: (sec: number, count: number) =>
        `تم التقاط ${count} لقطات زمنية واضحة من فيديو مدته ${sec} ثانية (خفيف جداً على الخادم).`,
      extractingFile: "جارٍ استخراج لقطات الفيديو على جهازك...",
      loading: "جارٍ تشغيل عدسة الكاميرا...",
      switchCam: "تبديل العدسة",
      flash: "الفلاش",
      retake: "إعادة التصوير",
      usePhoto: "اعتماد الصورة",
      useVideo: "إرفاق الفيديو للمحادثة",
      fallbackBtn: "فتح كاميرا الهاتف / المعرض",
      fallbackVideoBtn: "اختيار فيديو من الهاتف",
      retryBtn: "إعادة المحاولة",
      permDenied:
        "تعذّر فتح الكاميرا داخل المتصفح (ربما تم رفض الإذن أو النافذة مقيّدة). اسمح بإذن الكاميرا من إعدادات المتصفح أو استخدم الزر أدناه.",
      unsupported:
        "المتصفح الحالي لا يدعم البث المباشر للكاميرا داخل الصفحة. يمكنك استخدام كاميرا الهاتف مباشرةً أدناه.",
    };
  }
  return {
    titleDoc: "In-App Exam & Lesson Scanner",
    titlePhoto: "YFactory In-App Camera",
    titleVideo: "Smart Video Recording for Chat",
    guideDoc: "Align the exam sheet or textbook page inside the frame",
    guidePhoto: "Frame your subject and tap capture",
    guideVideoIdle: "Tap the red button to record (up to 20s) — smart lightweight frame sampling",
    guideVideoRec: "Recording... tap Stop when finished",
    videoSummary: (sec: number, count: number) =>
      `Captured ${count} crisp timeline keyframes from your ${sec}s video (zero heavy server upload).`,
    extractingFile: "Sampling video frames on your device...",
    loading: "Starting camera...",
    switchCam: "Switch Camera",
    flash: "Flash",
    retake: "Retake",
    usePhoto: "Use Photo",
    useVideo: "Attach Video to Chat",
    fallbackBtn: "Open Device Camera / Gallery",
    fallbackVideoBtn: "Pick Video from Device",
    retryBtn: "Try Again",
    permDenied:
      "Could not start the in-app camera (permission denied or restricted preview). Allow camera access in browser settings or use the fallback button below.",
    unsupported:
      "Live in-app camera is not supported in this browser context. Use your device camera directly below.",
  };
}

function grabVideoFrameToBlob(
  vid: HTMLVideoElement,
  maxEdge = 1024,
  quality = 0.84,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (vid.videoWidth <= 0 || vid.videoHeight <= 0) {
      resolve(null);
      return;
    }
    const scale = Math.min(1, maxEdge / Math.max(vid.videoWidth, vid.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(vid.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(vid.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

function pickEvenlySpaced<T>(items: T[], maxCount: number): T[] {
  if (items.length <= maxCount) return items;
  const out: T[] = [];
  for (let i = 0; i < maxCount; i += 1) {
    const idx = Math.round((i * (items.length - 1)) / (maxCount - 1));
    out.push(items[idx]!);
  }
  return out;
}

async function sampleKeyframesFromVideoFile(
  videoFile: File,
): Promise<{ frames: CapturedFrameItem[]; durationSec: number }> {
  const objUrl = URL.createObjectURL(videoFile);
  try {
    const vid = document.createElement("video");
    vid.src = objUrl;
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = "auto";

    await new Promise<void>((resolve, reject) => {
      vid.onloadedmetadata = () => resolve();
      vid.onerror = () => reject(new Error("Could not decode video file."));
    });

    const rawDur =
      Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 4;
    const durationSec = Math.max(1, Math.min(MAX_VIDEO_SECONDS, Math.round(rawDur)));
    const targetTimes = [0.1, 0.35, 0.65, 0.92].map((r) =>
      Math.min(Math.max(0, rawDur - 0.1), rawDur * r),
    );

    const frames: CapturedFrameItem[] = [];
    for (let i = 0; i < targetTimes.length; i += 1) {
      const t = targetTimes[i]!;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          vid.removeEventListener("seeked", onSeeked);
          resolve();
        };
        vid.addEventListener("seeked", onSeeked);
        vid.currentTime = t;
      });
      const blob = await grabVideoFrameToBlob(vid);
      if (blob) {
        const sec = Math.round(t);
        const file = new File(
          [blob],
          `video-frame-${i + 1}-${sec}s.jpg`,
          { type: "image/jpeg" },
        );
        frames.push({ file, url: URL.createObjectURL(blob), sec });
      }
    }
    return { frames, durationSec };
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

export default function InAppCameraModal({
  open,
  locale,
  mode = "photo",
  onClose,
  onCapture,
  onCaptureVideoFrames,
}: InAppCameraModalProps) {
  const isRtl = isRtlLanguage(locale);
  const ui = getCopy(locale);

  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [starting, setStarting] = useState(false);
  const [camError, setCamError] = useState("");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Photo review state
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);

  // Video recording & keyframes review state
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [extractingVideo, setExtractingVideo] = useState(false);
  const [videoFrames, setVideoFrames] = useState<CapturedFrameItem[]>([]);
  const [videoDurationSec, setVideoDurationSec] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const recTimerRef = useRef<number | null>(null);
  const sampleTimerRef = useRef<number | null>(null);
  const recStartRef = useRef<number>(0);
  const rawFramesRef = useRef<CapturedFrameItem[]>([]);

  const clearTimers = useCallback(() => {
    if (recTimerRef.current !== null) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    if (sampleTimerRef.current !== null) {
      window.clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    clearTimers();
    setRecording(false);
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchOn(false);
    setTorchSupported(false);
  }, [clearTimers]);

  const clearPreview = useCallback(() => {
    setCapturedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setCapturedFile(null);
    setVideoFrames((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });
    rawFramesRef.current.forEach((f) => URL.revokeObjectURL(f.url));
    rawFramesRef.current = [];
    setVideoDurationSec(0);
    setRecSeconds(0);
  }, []);

  const startCamera = useCallback(
    async (targetFacing: "environment" | "user") => {
      stopStream();
      setCamError("");
      setStarting(true);

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        setStarting(false);
        setCamError(ui.unsupported);
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: targetFacing },
              width: { ideal: mode === "video" ? 1280 : 1920 },
              height: { ideal: mode === "video" ? 720 : 1080 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (track && typeof track.getCapabilities === "function") {
          const caps = track.getCapabilities() as MediaTrackCapabilities & {
            torch?: boolean;
          };
          setTorchSupported(Boolean(caps.torch));
        }

        const vid = videoRef.current;
        if (vid) {
          vid.srcObject = stream;
          await vid.play().catch(() => undefined);
        }
      } catch {
        setCamError(ui.permDenied);
      } finally {
        setStarting(false);
      }
    },
    [stopStream, ui.permDenied, ui.unsupported, mode],
  );

  useEffect(() => {
    if (!open) {
      stopStream();
      clearPreview();
      return;
    }
    void startCamera(facing);
    return () => {
      stopStream();
    };
  }, [open, facing, startCamera, stopStream, clearPreview]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const captureOneVideoKeyframe = useCallback(async () => {
    const vid = videoRef.current;
    if (!vid) return;
    const blob = await grabVideoFrameToBlob(vid, 1024, 0.82);
    if (!blob) return;
    const sec = Math.max(
      0,
      Math.round((Date.now() - recStartRef.current) / 1000),
    );
    const idx = rawFramesRef.current.length + 1;
    const file = new File([blob], `video-frame-${idx}-${sec}s.jpg`, {
      type: "image/jpeg",
    });
    rawFramesRef.current.push({
      file,
      url: URL.createObjectURL(blob),
      sec,
    });
  }, []);

  const stopVideoRecording = useCallback(async () => {
    clearTimers();
    setRecording(false);
    await captureOneVideoKeyframe();

    const elapsed = Math.max(
      1,
      Math.min(
        MAX_VIDEO_SECONDS,
        Math.round((Date.now() - recStartRef.current) / 1000),
      ),
    );

    const allCaptured = [...rawFramesRef.current];
    rawFramesRef.current = [];
    const selected = pickEvenlySpaced(allCaptured, MAX_VIDEO_KEYFRAMES);
    const selectedSet = new Set(selected);
    allCaptured.forEach((item) => {
      if (!selectedSet.has(item)) URL.revokeObjectURL(item.url);
    });

    stopStream();
    setVideoDurationSec(elapsed);
    setVideoFrames(selected);
  }, [clearTimers, captureOneVideoKeyframe, stopStream]);

  const startVideoRecording = useCallback(() => {
    if (recording) return;
    rawFramesRef.current.forEach((f) => URL.revokeObjectURL(f.url));
    rawFramesRef.current = [];
    recStartRef.current = Date.now();
    setRecSeconds(0);
    setRecording(true);

    void captureOneVideoKeyframe();
    sampleTimerRef.current = window.setInterval(() => {
      void captureOneVideoKeyframe();
    }, 2200);

    recTimerRef.current = window.setInterval(() => {
      const sec = Math.floor((Date.now() - recStartRef.current) / 1000);
      setRecSeconds(sec);
      if (sec >= MAX_VIDEO_SECONDS) {
        void stopVideoRecording();
      }
    }, 250);
  }, [recording, captureOneVideoKeyframe, stopVideoRecording]);

  if (!open) return null;

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // Ignore if device refuses torch constraint
    }
  };

  const handleCapturePhoto = () => {
    const vid = videoRef.current;
    if (!vid || vid.videoWidth <= 0 || vid.videoHeight <= 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = vid.videoWidth;
    canvas.height = vid.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `yfactory-camera-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        const preview = URL.createObjectURL(blob);
        stopStream();
        setCapturedFile(file);
        setCapturedUrl(preview);
      },
      "image/jpeg",
      0.92,
    );
  };

  const handleConfirmPhoto = () => {
    if (!capturedFile) return;
    const fileToSend = capturedFile;
    clearPreview();
    stopStream();
    onCapture(fileToSend);
    onClose();
  };

  const handleConfirmVideo = () => {
    if (videoFrames.length === 0) return;
    const files = videoFrames.map((f) => f.file);
    const dur = videoDurationSec || 1;
    clearPreview();
    stopStream();
    if (onCaptureVideoFrames) {
      onCaptureVideoFrames(files, dur);
    } else if (files[0]) {
      onCapture(files[0]);
    }
    onClose();
  };

  const handleRetake = () => {
    clearPreview();
    void startCamera(facing);
  };

  const handleFallbackFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;

    if (mode === "video" && file.type.startsWith("video/")) {
      stopStream();
      setExtractingVideo(true);
      try {
        const res = await sampleKeyframesFromVideoFile(file);
        if (res.frames.length > 0) {
          setVideoFrames(res.frames);
          setVideoDurationSec(res.durationSec);
        } else {
          setCamError("Could not extract frames from this video.");
        }
      } catch {
        setCamError("Could not read this video file.");
      } finally {
        setExtractingVideo(false);
      }
      return;
    }

    stopStream();
    clearPreview();
    onCapture(file);
    onClose();
  };

  const title =
    mode === "document"
      ? ui.titleDoc
      : mode === "video"
        ? ui.titleVideo
        : ui.titlePhoto;

  const isReviewing = Boolean(capturedUrl) || videoFrames.length > 0;

  return (
    <div
      className="ycam-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      dir={isRtl ? "rtl" : "ltr"}
      data-testid="in-app-camera-modal"
    >
      <input
        ref={fallbackInputRef}
        type="file"
        accept={mode === "video" ? "video/*" : "image/*"}
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => void handleFallbackFile(e)}
      />

      <header className="ycam-topbar">
        <h2 className="ycam-title">{title}</h2>
        <div className="ycam-top-actions">
          {!isReviewing && torchSupported && (
            <button
              type="button"
              className={`ycam-icon-btn${torchOn ? " is-active" : ""}`}
              onClick={() => void toggleTorch()}
              aria-label={ui.flash}
              title={ui.flash}
            >
              {torchOn ? <Zap size={17} /> : <ZapOff size={17} />}
            </button>
          )}
          {!isReviewing && !camError && !recording && (
            <button
              type="button"
              className="ycam-icon-btn"
              onClick={() =>
                setFacing((cur) => (cur === "environment" ? "user" : "environment"))
              }
              aria-label={ui.switchCam}
              title={ui.switchCam}
            >
              <SwitchCamera size={18} />
            </button>
          )}
          <button
            type="button"
            className="ycam-icon-btn"
            onClick={() => {
              stopStream();
              clearPreview();
              onClose();
            }}
            aria-label="Close"
            data-testid="button-camera-close"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="ycam-stage">
        {extractingVideo ? (
          <div className="ycam-error-box">
            <LoaderCircle className="loading-spinner" size={26} />
            <p>{ui.extractingFile}</p>
          </div>
        ) : videoFrames.length > 0 ? (
          <div className="ycam-frames-review">
            <div className="ycam-frames-grid">
              {videoFrames.map((fr, idx) => (
                <div key={fr.url} className="ycam-frame-card">
                  <img src={fr.url} alt="" />
                  <span dir="ltr">
                    #{idx + 1} · {fr.sec}s
                  </span>
                </div>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#cbd5e1", textAlign: "center" }}>
              {ui.videoSummary(videoDurationSec, videoFrames.length)}
            </p>
          </div>
        ) : capturedUrl ? (
          <img className="ycam-preview-img" src={capturedUrl} alt="" />
        ) : camError ? (
          <div className="ycam-error-box">
            <AlertCircle size={28} color="#f87171" />
            <p>{camError}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                type="button"
                className="ycam-cta is-primary"
                onClick={() => fallbackInputRef.current?.click()}
              >
                <Upload size={15} />
                <span>
                  {mode === "video" ? ui.fallbackVideoBtn : ui.fallbackBtn}
                </span>
              </button>
              <button
                type="button"
                className="ycam-cta"
                onClick={() => void startCamera(facing)}
              >
                <RotateCcw size={15} />
                <span>{ui.retryBtn}</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="ycam-video"
              autoPlay
              playsInline
              muted
            />
            {mode === "video" && recording && (
              <div className="ycam-rec-badge" dir="ltr">
                <span className="ycam-rec-dot" aria-hidden="true" />
                <span>
                  00:{String(recSeconds).padStart(2, "0")} / 00:{MAX_VIDEO_SECONDS}
                </span>
              </div>
            )}
            {starting && (
              <div className="ycam-guide-label">
                <LoaderCircle
                  className="loading-spinner"
                  size={14}
                  style={{ verticalAlign: "middle", marginInlineEnd: 6 }}
                />
                {ui.loading}
              </div>
            )}
            {!starting && mode === "document" && (
              <div className="ycam-guide-frame" aria-hidden="true" />
            )}
            {!starting && (
              <div className="ycam-guide-label">
                {mode === "document"
                  ? ui.guideDoc
                  : mode === "video"
                    ? recording
                      ? ui.guideVideoRec
                      : ui.guideVideoIdle
                    : ui.guidePhoto}
              </div>
            )}
          </>
        )}
      </div>

      <footer className="ycam-controls">
        {videoFrames.length > 0 ? (
          <>
            <button
              type="button"
              className="ycam-cta"
              onClick={handleRetake}
              data-testid="button-camera-retake"
            >
              <RotateCcw size={16} />
              <span>{ui.retake}</span>
            </button>
            <button
              type="button"
              className="ycam-cta is-primary"
              onClick={handleConfirmVideo}
              data-testid="button-camera-confirm-video"
            >
              <Check size={17} />
              <span>{ui.useVideo}</span>
            </button>
          </>
        ) : capturedUrl ? (
          <>
            <button
              type="button"
              className="ycam-cta"
              onClick={handleRetake}
              data-testid="button-camera-retake"
            >
              <RotateCcw size={16} />
              <span>{ui.retake}</span>
            </button>
            <button
              type="button"
              className="ycam-cta is-primary"
              onClick={handleConfirmPhoto}
              data-testid="button-camera-confirm"
            >
              <Check size={17} />
              <span>{ui.usePhoto}</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="ycam-icon-btn"
              disabled={recording}
              onClick={() => fallbackInputRef.current?.click()}
              title={mode === "video" ? ui.fallbackVideoBtn : ui.fallbackBtn}
            >
              <Upload size={17} />
            </button>
            <button
              type="button"
              className={`ycam-shutter${mode === "video" ? " is-video" : ""}${
                recording ? " is-recording" : ""
              }`}
              disabled={starting || Boolean(camError)}
              onClick={() => {
                if (mode === "video") {
                  if (recording) void stopVideoRecording();
                  else startVideoRecording();
                } else {
                  handleCapturePhoto();
                }
              }}
              aria-label={mode === "video" ? (recording ? "Stop recording" : "Start recording") : "Capture photo"}
              data-testid="button-camera-shutter"
            >
              <span />
            </button>
            <button
              type="button"
              className="ycam-icon-btn"
              disabled={starting || Boolean(camError) || recording}
              onClick={() =>
                setFacing((cur) => (cur === "environment" ? "user" : "environment"))
              }
              title={ui.switchCam}
            >
              {mode === "video" ? <Video size={17} /> : <Camera size={17} />}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}