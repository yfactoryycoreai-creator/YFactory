import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  clearProviderDiagnosticsHistory,
  fetchProviderDiagnosticsHistory,
  fetchSmartProviderRecommendations,
  ProviderCenterApiError,
  testOfficialProviderConnection,
  type ProviderConnectionTestRecord,
  type ProviderRecommendationItem,
  type ProviderSummaryItem,
  type RecommendationPriority,
  type RecommendationTask,
} from '@/lib/providerCenterApi';
import './provider-diagnostics.css';

function formatMs(val: number | null): string {
  return val === null ? '—' : `${val} ms`;
}

function formatTime(ts: number | null, locale: string): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(ts).toLocaleTimeString();
  }
}

function getDiagCopy(lang: string) {
  if (lang.startsWith('ar')) {
    return {
      officialTitle: `اختبار الاتصال الرسمي والـ Ping`,
      officialSub: `يفحص الاتصال الحقيقي بنقطة API الرسمية ويتحقق من المصادقة دون كشف مفتاحك.`,
      testBtn: `اختبار الاتصال الرسمي (Test Official API)`,
      testingBtn: `جارٍ اختبار الاتصال...`,
      optGenLabel: `إضافة قياس زمن توليد النموذج (يرسل رسالة قصيرة جداً وقد يستهلك رصيداً بسيطاً في النماذج المدفوعة)`,
      netLatency: `زمن الشبكة (Network)`,
      apiResp: `استجابة API (Auth)`,
      genTime: `زمن التوليد (Generation)`,
      zeroCost: `بدون تكلفة توليد`,
      optInNote: `اختياري بموافقتك`,
      howTitle: `كيف يتصل YFactory:`,
      howRoute: `الطلبات تمر عبر خادم YFactory Backend باستخدام مفتاحك المشفّر فقط، ولا يوجد أي وسيط Proxy خارجي.`,
      endpointLbl: `عنوان الاختبار:`,
      lastTestLbl: `آخر اختبار:`,
      httpLbl: `رمز HTTP:`,
      outAuthOk: `المصادقة ناجحة`,
      outTested: `الشبكة متاحة (تم الفحص)`,
      outFailed: `فشل الاتصال`,
      outUnavail: `المزود غير متاح`,
      verOfficial: `نطاق رسمي متحقق منه`,
      verPending: `قيد التحقق الرسمي`,
      verNoApi: `لا توجد API عامة`,
      tabSmart: `التوصية الذكية للمزود`,
      tabPing: `مقارنة الـ Ping وسجل الاختبارات`,
      taskChat: `شات`,
      taskCode: `برمجة`,
      taskImage: `صور`,
      taskVideo: `فيديو`,
      prioBalanced: `متوازن`,
      prioSpeed: `الأسرع`,
      prioCost: `الأوفر تكلفة`,
      openProvider: `فتح المزود`,
      noRecs: `لا يوجد مزود مطابق لهذه المهمة حالياً.`,
      untested: `لم يُختبر بعد`,
      clearHist: `مسح السجل`,
      refresh: `تحديث`,
      colProvider: `المزود`,
      colStatus: `الحالة`,
      colNet: `الشبكة`,
      colApi: `استجابة API`,
      colGen: `التوليد`,
      colTested: `آخر اختبار`,
      emptyHistory: `لم تُجرِ أي اختبارات اتصال بعد. افتح أي مزود واضغط «اختبار الاتصال الرسمي» لمقارنة السرعات.`,
      historyTitle: `آخر الاختبارات المسجلة`,
      reasonLabels: {
        key_ready: `مفتاح جاهز`,
        key_cooldown: `تهدئة مؤقتة`,
        key_failing: `المفتاح يحتاج مراجعة`,
        key_missing: `بدون مفتاح بعد`,
        adapter_ready: `محوّل مباشر جاهز`,
        verified_official: `نطاق رسمي`,
        free_tier: `يدعم باقة مجانية`,
        auth_verified_live: `مصادقة مُثبتة`,
        last_test_failed: `آخر اختبار فشل`,
      } as Record<string, string>,
    };
  }
  return {
    officialTitle: `Official API Connection & Ping Test`,
    officialSub: `Runs a real reachability & authentication check against the official endpoint without exposing your API key.`,
    testBtn: `Test Official API Connection`,
    testingBtn: `Testing connection...`,
    optGenLabel: `Also measure Model Generation Time (sends a minimal prompt — may use paid tokens on paid models)`,
    netLatency: `Network Latency`,
    apiResp: `API Response Time`,
    genTime: `Model Generation Time`,
    zeroCost: `No generation tokens`,
    optInNote: `Opt-in only`,
    howTitle: `How YFactory Connects:`,
    howRoute: `Requests pass through YFactory Backend using your encrypted key only. No external third-party proxy is used.`,
    endpointLbl: `Tested Endpoint:`,
    lastTestLbl: `Last Tested:`,
    httpLbl: `HTTP Status:`,
    outAuthOk: `Authentication Successful`,
    outTested: `Connection Tested`,
    outFailed: `Connection Failed`,
    outUnavail: `Provider Unavailable`,
    verOfficial: `Verified Official Endpoint`,
    verPending: `Verification Pending`,
    verNoApi: `No Public API`,
    tabSmart: `Smart Provider Recommendation`,
    tabPing: `Provider Ping Comparison & History`,
    taskChat: `Chat`,
    taskCode: `Code`,
    taskImage: `Image`,
    taskVideo: `Video`,
    prioBalanced: `Balanced`,
    prioSpeed: `Fastest`,
    prioCost: `Lowest Cost`,
    openProvider: `Open`,
    noRecs: `No providers currently support this task.`,
    untested: `Not tested yet`,
    clearHist: `Clear History`,
    refresh: `Refresh`,
    colProvider: `Provider`,
    colStatus: `Status`,
    colNet: `Network`,
    colApi: `API Resp`,
    colGen: `Generation`,
    colTested: `Last Test`,
    emptyHistory: `No connection tests recorded yet. Open any provider and click Test Official API Connection to compare speeds.`,
    historyTitle: `Recent Connection Test Log`,
    reasonLabels: {
      key_ready: `Ready key`,
      key_cooldown: `Key cooling down`,
      key_failing: `Key needs attention`,
      key_missing: `No key added`,
      adapter_ready: `Live adapter`,
      verified_official: `Official endpoint`,
      free_tier: `Free tier`,
      auth_verified_live: `Auth verified`,
      last_test_failed: `Last test failed`,
    } as Record<string, string>,
  };
}

function outcomeLabel(
  outcome: ProviderConnectionTestRecord['outcome'],
  ui: ReturnType<typeof getDiagCopy>,
) {
  if (outcome === 'auth_successful') return ui.outAuthOk;
  if (outcome === 'connection_tested') return ui.outTested;
  if (outcome === 'provider_unavailable') return ui.outUnavail;
  return ui.outFailed;
}

function outcomeTone(outcome: ProviderConnectionTestRecord['outcome']): string {
  if (outcome === 'auth_successful') return 'is-ok';
  if (outcome === 'connection_tested') return 'is-gold';
  return 'is-err';
}

type ProviderConnectionTesterProps = {
  provider: ProviderSummaryItem;
  activeKeyId?: string | null;
  activeModelId?: string | null;
  locale: string;
  getIdToken?: () => Promise<string>;
  onTestFinished?: () => void;
};

export function ProviderConnectionTester({
  provider,
  activeKeyId,
  activeModelId,
  locale,
  getIdToken,
  onTestFinished,
}: ProviderConnectionTesterProps) {
  const ui = getDiagCopy(locale);
  const [testing, setTesting] = useState(false);
  const [includeGen, setIncludeGen] = useState(false);
  const [result, setResult] = useState<ProviderConnectionTestRecord | null>(null);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    setResult(null);
    setErrMsg('');
    setIncludeGen(false);
    if (!getIdToken) return;
    let active = true;
    void (async () => {
      try {
        const token = await getIdToken();
        const data = await fetchProviderDiagnosticsHistory(token, 25);
        if (!active) return;
        const match = data.latestByProvider.find(
          (item) => item.providerId === provider.id,
        );
        if (match) setResult(match);
      } catch {
        // Ignore silent history hydration failure.
      }
    })();
    return () => {
      active = false;
    };
  }, [provider.id, getIdToken]);

  const handleRunTest = async () => {
    if (!getIdToken || testing) return;
    setTesting(true);
    setErrMsg('');
    try {
      const token = await getIdToken();
      const rec = await testOfficialProviderConnection(token, provider.id, {
        ...(activeKeyId ? { keyId: activeKeyId } : {}),
        includeGenerationTest: includeGen,
        ...(includeGen && activeModelId ? { modelId: activeModelId } : {}),
      });
      setResult(rec);
      onTestFinished?.();
    } catch (err) {
      setErrMsg(
        err instanceof ProviderCenterApiError
          ? err.message
          : 'Connection test failed.',
      );
    } finally {
      setTesting(false);
    }
  };

  const verStatus = provider.connectionDetails.verificationStatus;

  return (
    <section className="pd-card" data-testid="provider-connection-tester">
      <div className="pd-head">
        <div>
          <div className="pd-title-row">
            <Activity size={17} aria-hidden="true" />
            <h2>{ui.officialTitle}</h2>
          </div>
          <p className="pd-subtitle">{ui.officialSub}</p>
        </div>
        <div className="pd-badges">
          <span
            className={`pd-pill ${
              verStatus === 'verified_official'
                ? 'is-ok'
                : verStatus === 'no_public_api'
                  ? 'is-err'
                  : 'is-gold'
            }`}
          >
            <ShieldCheck size={13} aria-hidden="true" />
            <span>
              {verStatus === 'verified_official'
                ? ui.verOfficial
                : verStatus === 'no_public_api'
                  ? ui.verNoApi
                  : ui.verPending}
            </span>
          </span>
          {result && (
            <span className={`pd-pill ${outcomeTone(result.outcome)}`}>
              {result.outcome === 'auth_successful' ? (
                <CheckCircle2 size={13} aria-hidden="true" />
              ) : (
                <Activity size={13} aria-hidden="true" />
              )}
              <span>{outcomeLabel(result.outcome, ui)}</span>
            </span>
          )}
        </div>
      </div>

      <div className="pd-connect-note">
        <strong>{ui.howTitle}</strong>
        <span>{ui.howRoute}</span>
        {provider.connectionDetails.apiBaseUrl && (
          <span dir="ltr">
            <code>{provider.connectionDetails.apiBaseUrl}</code>
            {provider.connectionDetails.authMethod
              ? ` · ${provider.connectionDetails.authMethod}`
              : ''}
          </span>
        )}
      </div>

      <div className="pd-controls-row">
        {provider.chatAdapterReady && Boolean(activeKeyId) && (
          <label className="pd-optin-label">
            <input
              type="checkbox"
              checked={includeGen}
              onChange={(e) => setIncludeGen(e.currentTarget.checked)}
              disabled={testing}
            />
            <span>{ui.optGenLabel}</span>
          </label>
        )}
        <button
          type="button"
          className="pc-btn is-primary"
          disabled={testing || !getIdToken}
          onClick={() => void handleRunTest()}
          data-testid="button-test-official-api"
        >
          {testing ? (
            <LoaderCircle className="loading-spinner" size={15} />
          ) : (
            <Zap size={15} />
          )}
          <span>{testing ? ui.testingBtn : ui.testBtn}</span>
        </button>
      </div>

      {errMsg && (
        <div className="pc-banner-err" role="alert">
          <AlertCircle size={15} />
          <span>{errMsg}</span>
        </div>
      )}

      {result && (
        <>
          <div className="pd-metrics-grid">
            <div className="pd-metric-box">
              <span>{ui.netLatency}</span>
              <strong dir="ltr">{formatMs(result.networkLatencyMs)}</strong>
              <small>{ui.zeroCost}</small>
            </div>
            <div className="pd-metric-box">
              <span>{ui.apiResp}</span>
              <strong dir="ltr">{formatMs(result.apiResponseTimeMs)}</strong>
              <small>
                {result.httpStatus ? `${ui.httpLbl} ${result.httpStatus}` : ui.zeroCost}
              </small>
            </div>
            <div className="pd-metric-box">
              <span>{ui.genTime}</span>
              <strong dir="ltr">{formatMs(result.modelGenerationTimeMs)}</strong>
              <small>
                {result.generationModel ? result.generationModel : ui.optInNote}
              </small>
            </div>
          </div>

          {result.errorMessage && (
            <div
              className={
                result.outcome === 'connection_tested'
                  ? 'pd-connect-note'
                  : 'pc-banner-err'
              }
              role="status"
            >
              <span>{result.errorMessage}</span>
            </div>
          )}

          <div className="pd-connect-note">
            {result.endpointUrl && (
              <span>
                {ui.endpointLbl} <code dir="ltr">{result.endpointUrl}</code>
              </span>
            )}
            <span>
              <Clock size={12} style={{ verticalAlign: 'middle' }} />{' '}
              {ui.lastTestLbl} {formatTime(result.testedAt, locale)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

type ProviderDiagnosticsBarProps = {
  locale: string;
  getIdToken?: () => Promise<string>;
  onSelectProvider: (providerId: string) => void;
};

export function ProviderDiagnosticsBar({
  locale,
  getIdToken,
  onSelectProvider,
}: ProviderDiagnosticsBarProps) {
  const ui = getDiagCopy(locale);
  const [activeTab, setActiveTab] = useState<'none' | 'smart' | 'ping'>('none');

  const [task, setTask] = useState<RecommendationTask>('chat');
  const [priority, setPriority] = useState<RecommendationPriority>('balanced');
  const [recs, setRecs] = useState<ProviderRecommendationItem[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recErr, setRecErr] = useState('');

  const [history, setHistory] = useState<ProviderConnectionTestRecord[]>([]);
  const [latest, setLatest] = useState<ProviderConnectionTestRecord[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histErr, setHistErr] = useState('');

  const loadRecommendations = useCallback(async () => {
    if (!getIdToken) return;
    setRecLoading(true);
    setRecErr('');
    try {
      const token = await getIdToken();
      const data = await fetchSmartProviderRecommendations(token, task, priority);
      setRecs(data.recommendations);
    } catch (err) {
      setRecErr(
        err instanceof ProviderCenterApiError
          ? err.message
          : 'Could not load recommendations.',
      );
    } finally {
      setRecLoading(false);
    }
  }, [getIdToken, task, priority]);

  const loadHistory = useCallback(async () => {
    if (!getIdToken) return;
    setHistLoading(true);
    setHistErr('');
    try {
      const token = await getIdToken();
      const data = await fetchProviderDiagnosticsHistory(token, 40);
      setHistory(data.history);
      setLatest(data.latestByProvider);
    } catch (err) {
      setHistErr(
        err instanceof ProviderCenterApiError
          ? err.message
          : 'Could not load ping history.',
      );
    } finally {
      setHistLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    if (activeTab === 'smart') void loadRecommendations();
    else if (activeTab === 'ping') void loadHistory();
  }, [activeTab, loadRecommendations, loadHistory]);

  const handleClearHistory = async () => {
    if (!getIdToken) return;
    try {
      const token = await getIdToken();
      await clearProviderDiagnosticsHistory(token);
      setHistory([]);
      setLatest([]);
    } catch {
      // ignore
    }
  };

  const renderReason = (code: string): string => {
    if (code.startsWith('measured_')) {
      return code.replace('measured_', '');
    }
    return ui.reasonLabels[code] ?? code;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="pd-bar-tabs">
        <button
          type="button"
          className={`pd-bar-tab ${activeTab === 'smart' ? 'is-active' : ''}`}
          onClick={() => setActiveTab((t) => (t === 'smart' ? 'none' : 'smart'))}
          data-testid="button-open-smart-routing"
        >
          <Sparkles size={15} aria-hidden="true" />
          <span>{ui.tabSmart}</span>
        </button>
        <button
          type="button"
          className={`pd-bar-tab ${activeTab === 'ping' ? 'is-active' : ''}`}
          onClick={() => setActiveTab((t) => (t === 'ping' ? 'none' : 'ping'))}
          data-testid="button-open-ping-comparison"
        >
          <Activity size={15} aria-hidden="true" />
          <span>{ui.tabPing}</span>
        </button>
      </div>

      {activeTab === 'smart' && (
        <section className="pd-card" data-testid="smart-routing-panel">
          <div className="pd-selector-row">
            <div className="pd-seg-group" role="tablist">
              {(
                [
                  ['chat', ui.taskChat],
                  ['code', ui.taskCode],
                  ['image_generation', ui.taskImage],
                  ['video_generation', ui.taskVideo],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  className={`pc-filter-pill ${task === k ? 'is-active' : ''}`}
                  onClick={() => setTask(k)}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="pd-seg-group">
              {(
                [
                  ['balanced', ui.prioBalanced],
                  ['speed', ui.prioSpeed],
                  ['cost', ui.prioCost],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  className={`pc-filter-pill ${priority === k ? 'is-active' : ''}`}
                  onClick={() => setPriority(k)}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {recErr && (
            <div className="pc-banner-err" role="alert">
              <AlertCircle size={15} />
              <span>{recErr}</span>
            </div>
          )}

          {recLoading ? (
            <div className="pc-empty-box">
              <LoaderCircle className="loading-spinner" size={20} />
            </div>
          ) : recs.length === 0 ? (
            <div className="pc-empty-box">{ui.noRecs}</div>
          ) : (
            <div className="pd-rec-list">
              {recs.map((rec, idx) => (
                <div
                  key={rec.providerId}
                  className={`pd-rec-row ${idx === 0 ? 'is-top' : ''}`}
                >
                  <div className="pd-rec-main">
                    <div className="pd-rec-title">
                      <span className="pd-rank-badge">#{idx + 1}</span>
                      <strong>{rec.providerName}</strong>
                      <span
                        className={`pc-status-badge is-${rec.connectionStatus}`}
                      >
                        {rec.connectionStatus}
                      </span>
                      {rec.measuredApiMs !== null ? (
                        <span className="pd-pill is-ok" dir="ltr">
                          API {rec.measuredApiMs} ms
                        </span>
                      ) : rec.measuredNetworkMs !== null ? (
                        <span className="pd-pill is-gold" dir="ltr">
                          Net {rec.measuredNetworkMs} ms
                        </span>
                      ) : (
                        <span className="pd-pill">{ui.untested}</span>
                      )}
                    </div>
                    <div className="pd-badges">
                      {rec.reasons.map((r) => (
                        <span className="pc-cap-badge" key={r}>
                          {renderReason(r)}
                        </span>
                      ))}
                    </div>
                    {rec.suggestedModels.length > 0 && (
                      <small style={{ color: 'var(--app-secondary)', fontSize: 11.5 }} dir="ltr">
                        {rec.suggestedModels.map((m) => m.modelId).join(' · ')}
                      </small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="pc-btn"
                    onClick={() => onSelectProvider(rec.providerId)}
                  >
                    <span>{ui.openProvider}</span>
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'ping' && (
        <section className="pd-card" data-testid="ping-comparison-panel">
          <div className="pd-head">
            <div className="pd-title-row">
              <Activity size={16} aria-hidden="true" />
              <h2>{ui.tabPing}</h2>
            </div>
            <div className="pc-key-actions">
              <button
                type="button"
                className="pc-btn"
                disabled={histLoading}
                onClick={() => void loadHistory()}
              >
                <RefreshCw
                  size={13}
                  className={histLoading ? 'loading-spinner' : ''}
                />
                <span>{ui.refresh}</span>
              </button>
              {history.length > 0 && (
                <button
                  type="button"
                  className="pc-btn is-danger"
                  onClick={() => void handleClearHistory()}
                >
                  <Trash2 size={13} />
                  <span>{ui.clearHist}</span>
                </button>
              )}
            </div>
          </div>

          {histErr && (
            <div className="pc-banner-err" role="alert">
              <AlertCircle size={15} />
              <span>{histErr}</span>
            </div>
          )}

          {histLoading ? (
            <div className="pc-empty-box">
              <LoaderCircle className="loading-spinner" size={20} />
            </div>
          ) : latest.length === 0 ? (
            <div className="pc-empty-box">{ui.emptyHistory}</div>
          ) : (
            <>
              <div className="pd-table-wrap">
                <table className="pd-table">
                  <thead>
                    <tr>
                      <th>{ui.colProvider}</th>
                      <th>{ui.colStatus}</th>
                      <th>{ui.colNet}</th>
                      <th>{ui.colApi}</th>
                      <th>{ui.colGen}</th>
                      <th>{ui.colTested}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.map((row) => (
                      <tr key={row.providerId}>
                        <td>
                          <button
                            type="button"
                            className="pc-btn"
                            onClick={() => onSelectProvider(row.providerId)}
                          >
                            {row.providerName}
                          </button>
                        </td>
                        <td>
                          <span className={`pd-pill ${outcomeTone(row.outcome)}`}>
                            {outcomeLabel(row.outcome, ui)}
                          </span>
                        </td>
                        <td dir="ltr">{formatMs(row.networkLatencyMs)}</td>
                        <td dir="ltr">{formatMs(row.apiResponseTimeMs)}</td>
                        <td dir="ltr">{formatMs(row.modelGenerationTimeMs)}</td>
                        <td>{formatTime(row.testedAt, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pd-title-row">
                <Clock size={14} aria-hidden="true" />
                <strong style={{ fontSize: 13 }}>{ui.historyTitle}</strong>
              </div>
              <div className="pd-history-list">
                {history.slice(0, 15).map((item) => (
                  <div key={item.id} className="pd-history-row">
                    <span>
                      <strong>{item.providerName}</strong> ·{' '}
                      <span className={`pd-pill ${outcomeTone(item.outcome)}`}>
                        {outcomeLabel(item.outcome, ui)}
                      </span>
                    </span>
                    <span dir="ltr" style={{ color: 'var(--app-secondary)' }}>
                      Net {formatMs(item.networkLatencyMs)} | API{' '}
                      {formatMs(item.apiResponseTimeMs)}
                      {item.generationTested
                        ? ` | Gen ${formatMs(item.modelGenerationTimeMs)}`
                        : ''}
                    </span>
                    <small style={{ color: 'var(--app-secondary)' }}>
                      {formatTime(item.testedAt, locale)}
                    </small>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
