import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Film,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  deleteVideoHistoryJob,
  fetchProxiedVideoBlobUrl,
  fetchVideoJobs,
  fetchVideoModels,
  pollVideoJob,
  prepareVideoImageDataUrl,
  startVideoGeneration,
  VideoApiError,
  type VideoJobItem,
  type VideoMode,
  type VideoModelOption,
} from '@/lib/videoApi';
import { isRtlLanguage } from '@/lib/languages';
import './video-studio.css';

type VideoStudioProps = {
  locale: string;
  getIdToken?: () => Promise<string>;
  onOpenProviderCenter: (providerId?: string) => void;
};

function getCopy(lang: string) {
  if (lang.startsWith('ar')) {
    return {
      title: 'استوديو توليد الفيديو',
      subtitle: 'تحويل النص أو الصورة إلى فيديو عبر نماذج الفيديو الحقيقية ومفاتيحك في مركز المزودين.',
      openKeys: 'إدارة مفاتيح الفيديو',
      t2v: 'نص إلى فيديو (Text to Video)',
      i2v: 'صورة إلى فيديو (Image to Video)',
      providerLbl: 'المزود (Provider)',
      modelLbl: 'نموذج الفيديو',
      connected: 'مفتاح جاهز',
      missingKey: 'أضف المفتاح في مركز المزودين',
      addKeyNow: 'إضافة مفتاح لهذا المزود',
      ratioLbl: 'الأبعاد (Aspect Ratio)',
      durLbl: 'المدة (Duration)',
      resLbl: 'الدقة (Resolution)',
      secUnit: 'ثانية',
      promptLbl: 'وصف مشهد الفيديو (Prompt)',
      promptPh: 'صف حركة الكاميرا، الإضاءة، والمشهد السينمائي المطلوب...',
      refTitle: 'الصورة المرجعية (Image to Video)',
      uploadImg: 'رفع صورة (JPG / PNG / WebP)',
      orUrlPh: 'أو الصق رابط صورة HTTPS مباشر...',
      httpsOnlyNote: 'هذا النموذج يتطلب رابط صورة HTTPS مباشر.',
      generateBtn: 'بدء توليد الفيديو',
      generatingBtn: 'جارٍ الإرسال للمزود...',
      historyTitle: 'سجل التوليد ومتابعة التقدم',
      refreshBtn: 'تحديث الحالة',
      noJobs: 'لا توجد فيديوهات مولّدة بعد. اختر نموذجاً متصلاً وابدأ التوليد أعلاه.',
      stQueued: 'في قائمة الانتظار',
      stProcessing: 'جارٍ المعالجة...',
      stCompleted: 'مكتمل',
      stFailed: 'فشل التوليد',
      loadVideo: 'عرض الفيديو',
      download: 'تنزيل الفيديو',
      del: 'حذف',
      loading: 'جارٍ تحميل نماذج الفيديو وسجل التوليد...',
      noModelForMode: 'لا يوجد نموذج متاح لهذا الوضع لدى المزود المختار.',
    };
  }
  return {
    title: 'AI Video Studio',
    subtitle: 'Text-to-Video and Image-to-Video powered by verified video models and your Provider Center keys.',
    openKeys: 'Manage Video Keys',
    t2v: 'Text to Video',
    i2v: 'Image to Video',
    providerLbl: 'Provider',
    modelLbl: 'Video Model',
    connected: 'Key Ready',
    missingKey: 'Add key in Provider Center',
    addKeyNow: 'Add Key for Provider',
    ratioLbl: 'Aspect Ratio',
    durLbl: 'Duration',
    resLbl: 'Resolution',
    secUnit: 'sec',
    promptLbl: 'Video Prompt',
    promptPh: 'Describe the scene, camera motion, lighting, and atmosphere...',
    refTitle: 'Reference Image (Image to Video)',
    uploadImg: 'Upload Image (JPG / PNG / WebP)',
    orUrlPh: 'Or paste a direct HTTPS image URL...',
    httpsOnlyNote: 'This model requires a public HTTPS image URL.',
    generateBtn: 'Generate Video',
    generatingBtn: 'Submitting to provider...',
    historyTitle: 'Generation Progress & History',
    refreshBtn: 'Refresh Status',
    noJobs: 'No video jobs yet. Pick a connected provider model and start generating above.',
    stQueued: 'Queued',
    stProcessing: 'Processing...',
    stCompleted: 'Completed',
    stFailed: 'Failed',
    loadVideo: 'Load Video',
    download: 'Download',
    del: 'Delete',
    loading: 'Loading video models & history...',
    noModelForMode: 'No model supports this mode for the selected provider.',
  };
}

export default function VideoStudio({
  locale,
  getIdToken,
  onOpenProviderCenter,
}: VideoStudioProps) {
  const isRtl = isRtlLanguage(locale);
  const ui = getCopy(locale);

  const [mode, setMode] = useState<VideoMode>('text_to_video');
  const [models, setModels] = useState<VideoModelOption[]>([]);
  const [jobs, setJobs] = useState<VideoJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedSpecId, setSelectedSpecId] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [durationSec, setDurationSec] = useState<number | undefined>(undefined);
  const [resolution, setResolution] = useState('');
  const [prompt, setPrompt] = useState('');

  const [imageUrlInput, setImageUrlInput] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [imageFileName, setImageFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pollingIds, setPollingIds] = useState<Record<string, boolean>>({});
  const [proxiedUrls, setProxiedUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const proxiedRef = useRef<Record<string, string>>({});

  useEffect(() => {
    proxiedRef.current = proxiedUrls;
  }, [proxiedUrls]);

  useEffect(
    () => () => {
      Object.values(proxiedRef.current).forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const loadInitial = useCallback(async () => {
    if (!getIdToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const token = await getIdToken();
      const [mList, jList] = await Promise.all([
        fetchVideoModels(token),
        fetchVideoJobs(token),
      ]);
      setModels(mList);
      setJobs(jList);
    } catch (err) {
      setError(err instanceof VideoApiError ? err.message : 'Could not load Video Studio.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const modeModels = useMemo(
    () => models.filter((m) => m.modes.includes(mode)),
    [models, mode],
  );

  const providerChoices = useMemo(() => {
    const map = new Map<string, { id: string; name: string; connected: boolean }>();
    for (const m of modeModels) {
      if (!map.has(m.providerId)) {
        map.set(m.providerId, {
          id: m.providerId,
          name: m.providerName,
          connected: m.providerConnected,
        });
      }
    }
    return [...map.values()].sort((a, b) =>
      a.connected !== b.connected ? (a.connected ? -1 : 1) : a.name.localeCompare(b.name),
    );
  }, [modeModels]);

  useEffect(() => {
    if (providerChoices.length === 0) {
      setSelectedProvider('');
      return;
    }
    if (!providerChoices.some((p) => p.id === selectedProvider)) {
      setSelectedProvider(providerChoices[0]!.id);
    }
  }, [providerChoices, selectedProvider]);

  const providerModels = useMemo(
    () => modeModels.filter((m) => m.providerId === selectedProvider),
    [modeModels, selectedProvider],
  );

  useEffect(() => {
    if (providerModels.length === 0) {
      setSelectedSpecId('');
      return;
    }
    if (!providerModels.some((m) => m.id === selectedSpecId)) {
      setSelectedSpecId(providerModels[0]!.id);
    }
  }, [providerModels, selectedSpecId]);

  const activeModel = useMemo(
    () => providerModels.find((m) => m.id === selectedSpecId) ?? null,
    [providerModels, selectedSpecId],
  );

  // Sync supported model-only settings whenever model changes
  useEffect(() => {
    if (!activeModel) return;
    setAspectRatio(activeModel.aspectRatios?.[0] ?? '');
    setDurationSec(activeModel.durations?.[0]);
    setResolution(activeModel.resolutions?.[0] ?? '');
  }, [activeModel?.id]);

  const refreshJob = useCallback(
    async (jobId: string) => {
      if (!getIdToken) return;
      setPollingIds((cur) => ({ ...cur, [jobId]: true }));
      try {
        const token = await getIdToken();
        const updated = await pollVideoJob(token, jobId);
        setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
      } catch {
        // Keep current status on transient poll failure.
      } finally {
        setPollingIds((cur) => {
          const next = { ...cur };
          delete next[jobId];
          return next;
        });
      }
    },
    [getIdToken],
  );

  const hasActiveJobs = jobs.some(
    (j) => j.status === 'queued' || j.status === 'processing',
  );

  useEffect(() => {
    if (!hasActiveJobs || !getIdToken) return;
    const timer = window.setInterval(() => {
      const pending = jobs.filter(
        (j) => j.status === 'queued' || j.status === 'processing',
      );
      for (const j of pending.slice(0, 3)) {
        void refreshJob(j.id);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, jobs, getIdToken, refreshJob]);

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setError('');
    try {
      const dataUrl = await prepareVideoImageDataUrl(file);
      setImageDataUrl(dataUrl);
      setImageFileName(file.name);
      setImageUrlInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read image.');
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!getIdToken || !activeModel || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const token = await getIdToken();
      const imageInput =
        mode === 'image_to_video'
          ? (activeModel.acceptsDataUrlImage && imageDataUrl ? imageDataUrl : imageUrlInput.trim())
          : undefined;
      const created = await startVideoGeneration(token, {
        specId: activeModel.id,
        mode,
        prompt: prompt.trim(),
        ...(activeModel.aspectRatios && aspectRatio ? { aspectRatio } : {}),
        ...(activeModel.durations && durationSec ? { durationSec } : {}),
        ...(activeModel.resolutions && resolution ? { resolution } : {}),
        ...(imageInput ? { imageInput } : {}),
      });
      setJobs((prev) => [created, ...prev]);
      setPrompt('');
    } catch (err) {
      setError(err instanceof VideoApiError ? err.message : 'Video generation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoadProxiedMedia = async (jobId: string) => {
    if (!getIdToken) return;
    setPollingIds((cur) => ({ ...cur, [jobId]: true }));
    try {
      const token = await getIdToken();
      const url = await fetchProxiedVideoBlobUrl(token, jobId);
      setProxiedUrls((prev) => ({ ...prev, [jobId]: url }));
    } catch (err) {
      setError(err instanceof VideoApiError ? err.message : 'Could not load video media.');
    } finally {
      setPollingIds((cur) => {
        const next = { ...cur };
        delete next[jobId];
        return next;
      });
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!getIdToken) return;
    try {
      const token = await getIdToken();
      await deleteVideoHistoryJob(token, jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch {
      setError('Could not delete video item.');
    }
  };

  const statusBadge = (job: VideoJobItem) => {
    if (job.status === 'completed') {
      return (
        <span className="vs-pill is-ok">
          <CheckCircle2 size={12} />
          {ui.stCompleted}
        </span>
      );
    }
    if (job.status === 'failed') {
      return (
        <span className="vs-pill is-err">
          <AlertCircle size={12} />
          {ui.stFailed}
        </span>
      );
    }
    return (
      <span className="vs-pill is-warn">
        <LoaderCircle className="loading-spinner" size={12} />
        {job.status === 'processing' ? ui.stProcessing : ui.stQueued}
      </span>
    );
  };

  return (
    <section
      className="vs-root"
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-label={ui.title}
      data-testid="video-studio"
    >
      <header className="vs-header-card">
        <div className="vs-head-row">
          <div className="vs-title-group">
            <span className="vs-icon-badge" aria-hidden="true">
              <Film size={21} />
            </span>
            <div>
              <h1>{ui.title}</h1>
              <p>{ui.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            className="vs-btn"
            onClick={() => onOpenProviderCenter(selectedProvider || undefined)}
          >
            <KeyRound size={15} aria-hidden="true" />
            <span>{ui.openKeys}</span>
          </button>
        </div>

        <div className="vs-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'text_to_video'}
            className={`vs-mode-tab${mode === 'text_to_video' ? ' is-active' : ''}`}
            onClick={() => setMode('text_to_video')}
            data-testid="video-mode-t2v"
          >
            <Film size={15} aria-hidden="true" />
            <span>{ui.t2v}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'image_to_video'}
            className={`vs-mode-tab${mode === 'image_to_video' ? ' is-active' : ''}`}
            onClick={() => setMode('image_to_video')}
            data-testid="video-mode-i2v"
          >
            <ImageIcon size={15} aria-hidden="true" />
            <span>{ui.i2v}</span>
          </button>
        </div>
      </header>

      {loading ? (
        <div className="vs-panel vs-empty">
          <LoaderCircle className="loading-spinner" size={22} />
          <p>{ui.loading}</p>
        </div>
      ) : (
        <form className="vs-panel" onSubmit={(e) => void handleSubmit(e)}>
          <div className="vs-field-grid">
            <div className="vs-field">
              <label htmlFor="vs-provider">{ui.providerLbl}</label>
              <select
                id="vs-provider"
                className="vs-select"
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.currentTarget.value)}
                data-testid="select-video-provider"
              >
                {providerChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.connected ? '✓' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="vs-field">
              <label htmlFor="vs-model">{ui.modelLbl}</label>
              <select
                id="vs-model"
                className="vs-select"
                value={selectedSpecId}
                onChange={(e) => setSelectedSpecId(e.currentTarget.value)}
                data-testid="select-video-model"
              >
                {providerModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.modelName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {activeModel ? (
            <>
              <div className="vs-model-meta">
                <div>
                  <code dir="ltr">{activeModel.modelId}</code> · {activeModel.pricingNote}
                </div>
                {activeModel.providerConnected ? (
                  <span className="vs-pill is-ok">
                    <CheckCircle2 size={12} />
                    {ui.connected}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="vs-btn"
                    onClick={() => onOpenProviderCenter(activeModel.providerId)}
                  >
                    <KeyRound size={13} />
                    <span>{ui.addKeyNow}</span>
                  </button>
                )}
              </div>

              {/* Render ONLY settings supported by the chosen video model */}
              {(activeModel.aspectRatios || activeModel.durations || activeModel.resolutions) && (
                <div className="vs-field-grid">
                  {activeModel.aspectRatios && (
                    <div className="vs-field">
                      <label htmlFor="vs-ratio">{ui.ratioLbl}</label>
                      <select
                        id="vs-ratio"
                        className="vs-select"
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.currentTarget.value)}
                      >
                        {activeModel.aspectRatios.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {activeModel.durations && (
                    <div className="vs-field">
                      <label htmlFor="vs-dur">{ui.durLbl}</label>
                      <select
                        id="vs-dur"
                        className="vs-select"
                        value={durationSec ?? activeModel.durations[0]}
                        onChange={(e) => setDurationSec(Number(e.currentTarget.value))}
                      >
                        {activeModel.durations.map((d) => (
                          <option key={d} value={d}>
                            {d} {ui.secUnit}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {activeModel.resolutions && (
                    <div className="vs-field">
                      <label htmlFor="vs-res">{ui.resLbl}</label>
                      <select
                        id="vs-res"
                        className="vs-select"
                        value={resolution}
                        onChange={(e) => setResolution(e.currentTarget.value)}
                      >
                        {activeModel.resolutions.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {mode === 'image_to_video' && (
                <div className="vs-ref-box">
                  <strong style={{ fontSize: 12.5 }}>{ui.refTitle}</strong>
                  {activeModel.acceptsDataUrlImage ? (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style={{ display: 'none' }}
                        onChange={(e) => void handleImageUpload(e)}
                      />
                      <div className="vs-job-actions">
                        <button
                          type="button"
                          className="vs-btn"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload size={14} />
                          <span>{ui.uploadImg}</span>
                        </button>
                        {imageDataUrl && (
                          <button
                            type="button"
                            className="vs-btn"
                            onClick={() => {
                              setImageDataUrl('');
                              setImageFileName('');
                            }}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      {imageDataUrl && (
                        <div className="vs-ref-preview">
                          <img src={imageDataUrl} alt={imageFileName} />
                          <small>{imageFileName}</small>
                        </div>
                      )}
                    </>
                  ) : (
                    <small style={{ color: 'var(--app-secondary)' }}>{ui.httpsOnlyNote}</small>
                  )}
                  <input
                    className="vs-input"
                    type="url"
                    dir="ltr"
                    placeholder={ui.orUrlPh}
                    value={imageUrlInput}
                    onChange={(e) => {
                      setImageUrlInput(e.currentTarget.value);
                      if (e.currentTarget.value.trim()) {
                        setImageDataUrl('');
                        setImageFileName('');
                      }
                    }}
                  />
                </div>
              )}

              <div className="vs-field">
                <label htmlFor="vs-prompt">{ui.promptLbl}</label>
                <textarea
                  id="vs-prompt"
                  className="vs-textarea"
                  maxLength={4000}
                  dir="auto"
                  placeholder={ui.promptPh}
                  value={prompt}
                  onChange={(e) => setPrompt(e.currentTarget.value)}
                  data-testid="input-video-prompt"
                />
              </div>

              {error && (
                <div className="vs-alert" role="alert">
                  <AlertCircle size={15} />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="vs-btn is-primary"
                disabled={
                  submitting ||
                  !activeModel.providerConnected ||
                  !prompt.trim() ||
                  (mode === 'image_to_video' && !imageDataUrl && !imageUrlInput.trim())
                }
                data-testid="button-generate-video"
              >
                {submitting ? (
                  <LoaderCircle className="loading-spinner" size={17} />
                ) : (
                  <Sparkles size={17} />
                )}
                <span>{submitting ? ui.generatingBtn : ui.generateBtn}</span>
              </button>
            </>
          ) : (
            <div className="vs-empty">{ui.noModelForMode}</div>
          )}
        </form>
      )}

      <section className="vs-panel" aria-label={ui.historyTitle}>
        <div className="vs-head-row">
          <strong style={{ fontSize: 15 }}>
            {ui.historyTitle} ({jobs.length})
          </strong>
          <button
            type="button"
            className="vs-btn"
            onClick={() => void loadInitial()}
          >
            <RefreshCw size={14} />
            <span>{ui.refreshBtn}</span>
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="vs-empty">{ui.noJobs}</div>
        ) : (
          <div className="vs-jobs-list">
            {jobs.map((job) => {
              const playableUrl = job.requiresMediaProxy
                ? proxiedUrls[job.id] ?? null
                : job.videoUrl;
              const isBusy = Boolean(pollingIds[job.id]);
              return (
                <article key={job.id} className="vs-job-card">
                  <div className="vs-job-top">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {statusBadge(job)}
                      <span className="vs-pill">{job.providerName}</span>
                      <span className="vs-pill" dir="ltr">{job.modelName}</span>
                      {job.aspectRatio && <span className="vs-pill" dir="ltr">{job.aspectRatio}</span>}
                      {job.durationSec && (
                        <span className="vs-pill">{job.durationSec}s</span>
                      )}
                    </div>
                    <small style={{ color: 'var(--app-secondary)' }}>
                      {new Date(job.createdAt).toLocaleString(locale)}
                    </small>
                  </div>

                  <p className="vs-job-prompt" dir="auto">
                    {job.prompt}
                  </p>

                  {(job.status === 'queued' || job.status === 'processing') && (
                    <div className="vs-progress-track">
                      <div
                        className="vs-progress-fill"
                        style={{ width: `${Math.max(10, job.progress ?? 25)}%` }}
                      />
                    </div>
                  )}

                  {job.errorMessage && (
                    <div className="vs-alert" role="alert">
                      <AlertCircle size={14} />
                      <span>{job.errorMessage}</span>
                    </div>
                  )}

                  {playableUrl && (
                    <video
                      className="vs-video-player"
                      src={playableUrl}
                      controls
                      playsInline
                    />
                  )}

                  <div className="vs-job-actions">
                    {(job.status === 'queued' || job.status === 'processing') && (
                      <button
                        type="button"
                        className="vs-btn"
                        disabled={isBusy}
                        onClick={() => void refreshJob(job.id)}
                      >
                        <RefreshCw
                          size={14}
                          className={isBusy ? 'loading-spinner' : ''}
                        />
                        <span>{ui.refreshBtn}</span>
                      </button>
                    )}

                    {job.status === 'completed' &&
                      job.requiresMediaProxy &&
                      !playableUrl && (
                        <button
                          type="button"
                          className="vs-btn is-primary"
                          disabled={isBusy}
                          onClick={() => void handleLoadProxiedMedia(job.id)}
                        >
                          {isBusy ? (
                            <LoaderCircle className="loading-spinner" size={14} />
                          ) : (
                            <Play size={14} />
                          )}
                          <span>{ui.loadVideo}</span>
                        </button>
                      )}

                    {playableUrl && (
                      <a
                        className="vs-btn"
                        href={playableUrl}
                        download={`yfactory-video-${job.id}.mp4`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download size={14} />
                        <span>{ui.download}</span>
                      </a>
                    )}

                    <button
                      type="button"
                      className="vs-btn is-danger"
                      onClick={() => void handleDeleteJob(job.id)}
                    >
                      <Trash2 size={14} />
                      <span>{ui.del}</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
