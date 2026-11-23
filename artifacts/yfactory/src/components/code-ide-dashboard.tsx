import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  FileDiff,
  FolderGit2,
  KeyRound,
  Link2,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Unplug,
} from 'lucide-react';
import YCodeLogo from '@/components/ycode-logo';
import {
  cancelIdeCodingTask,
  clearIdeTaskHistory,
  deleteIdeCodingTask,
  disconnectIdeSession,
  fetchIdeCodingModels,
  fetchIdeSessions,
  fetchIdeTasks,
  generateIdePairingCode,
  IdeCodeApiError,
  type IdeCodingModelItem,
  type IdeSessionItem,
  type IdeTaskItem,
} from '@/lib/ideCodeApi';
import { isRtlLanguage } from '@/lib/languages';
import './code-ide-dashboard.css';

type CodeIdeDashboardProps = {
  locale: string;
  getIdToken?: () => Promise<string>;
  onOpenProviderCenter: (providerId?: string) => void;
  onOpenChat: () => void;
};

function getCopy(lang: string) {
  if (lang.startsWith('ar')) {
    return {
      title: 'YFactory Code — وكيل البرمجة المتصل بـ IDE',
      subtitle: 'تجربة شبيهة بـ Claude Code تعمل مباشرةً على مشروعك المفتوح في VS Code عبر إضافة YFactory Code (مع دعم تجريبي لـ Cursor بعد الاختبار).',
      sessionsBadge: (n: number) => (n > 0 ? `${n} بيئة IDE متصلة` : 'بانتظار ربط IDE'),
      pairTitle: 'ربط Visual Studio Code بحسابك',
      pairSub: 'أنشئ رمز ربط مؤقت (صالح 10 دقائق، للاستخدام مرة واحدة) وأدخله داخل إضافة YFactory Code في VS Code.',
      genCodeBtn: 'إنشاء رمز ربط IDE',
      generatingCode: 'جارٍ إنشاء الرمز...',
      copyCode: 'نسخ الرمز',
      copied: 'تم النسخ',
      serverUrlLbl: 'رابط خادم YFactory للإضافة:',
      copyUrl: 'نسخ الرابط',
      expiresIn: (sec: number) => `ينتهي خلال ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`,
      codeExpired: 'انتهت صلاحية الرمز — أنشئ رمزاً جديداً.',
      steps: [
        'ثبّت إضافة YFactory Code الرسمية في Visual Studio Code (تُسلّم في الدفعة 13 القادمة مباشرةً).',
        'افتح مجلد مشروعك (Workspace) في VS Code ثم افتح لوحة YFactory Code الجانبية.',
        'الصق رابط خادم YFactory ورمز الربط المؤقت لتسجيل الدخول الآمن وتخزين الجلسة في SecretStorage.',
        'اختر النموذج البرمجي من مركز المزودين، وراجع كل Diff وأمر Terminal قبل الموافقة.',
      ],
      sessionsTitle: 'جلسات IDE المتصلة حالياً',
      noSessions: 'لا توجد جلسة IDE متصلة بعد. أنشئ رمز ربط أعلاه لتوصيل VS Code.',
      disconnect: 'فصل الجلسة',
      lastActive: 'آخر نشاط:',
      cursorNote: 'تجريبي (يتطلب اختباراً فعلياً في Cursor)',
      vscodeSupported: 'VS Code مدعوم',
      modelsTitle: 'النماذج البرمجية الجاهزة (من مركز المزودين)',
      modelsSub: 'يستخدم YFactory Code مفاتيحك المشفّرة في Provider Center دون تكرار المفاتيح ودون إرسال أي مفتاح للإضافة.',
      manageModels: 'إدارة النماذج في Provider Center',
      noModels: 'لا توجد نماذج برمجية مفعّلة بعد. فعّل نموذجاً من Gemini أو OpenAI أو Anthropic أو OpenRouter أو Groq في مركز المزودين.',
      tasksTitle: 'سجل المهام البرمجية (Task History)',
      refresh: 'تحديث',
      clearAll: 'مسح السجل',
      noTasks: 'لا توجد مهام برمجية مسجلة بعد. عند تشغيل أي مهمة من إضافة IDE ستظهر هنا مع الملفات المتأثرة ونتائج الاختبارات.',
      stopTask: 'إيقاف',
      delTask: 'حذف',
      filesReadLbl: 'ملفات تمت قراءتها:',
      filesModLbl: 'ملفات تم تعديلها:',
      cmdsLbl: 'أوامر Terminal:',
      statusLabels: {
        running: 'قيد التنفيذ',
        awaiting_approval: 'بانتظار موافقتك في IDE',
        completed: 'مكتملة',
        cancelled: 'ملغاة',
        failed: 'فشلت',
      } as Record<IdeTaskItem['status'], string>,
      guardrailsTitle: 'حدود الأمان والنطاق (Architecture Guardrails)',
      guardrails: [
        { t: 'ليس App Builder', d: 'لا يبني تطبيقات مستقلة من وصف نصي ولا يضيف محرر أكواد مكرراً داخل المتصفح.' },
        { t: 'حماية الأسرار والملفات الحساسة', d: 'استبعاد .env وnode_modules و.git والمفاتيح تلقائياً، وعدم حفظ محتوى الملفات الحساسة في السجل.' },
        { t: 'موافقة صريحة على Diff وTerminal', d: 'لا يُطبّق تعديلاً ولا يشغّل أمراً محلياً قبل مراجعتك وموافقتك الصريحة داخل IDE.' },
        { t: 'مفاتيح API لا تغادر الخادم', d: 'تخزن الإضافة رمز جلسة قصير العمر فقط، وتمر طلبات الذكاء الاصطناعي عبر خادم YFactory.' },
      ],
      openChatBtn: 'فتح Chat',
    };
  }
  return {
    title: 'YFactory Code — IDE-Connected AI Coding Agent',
    subtitle: 'Claude-Code-style workflow directly inside your open VS Code workspace via the official YFactory Code Extension (Cursor compatibility tested separately).',
    sessionsBadge: (n: number) => (n > 0 ? `${n} IDE session${n > 1 ? 's' : ''} connected` : 'No IDE connected'),
    pairTitle: 'Connect Visual Studio Code',
    pairSub: 'Generate a single-use pairing code (valid 10 minutes) and paste it into the YFactory Code Extension sidebar.',
    genCodeBtn: 'Generate IDE Pairing Code',
    generatingCode: 'Generating code...',
    copyCode: 'Copy Code',
    copied: 'Copied',
    serverUrlLbl: 'YFactory Backend URL for Extension:',
    copyUrl: 'Copy URL',
    expiresIn: (sec: number) => `Expires in ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`,
    codeExpired: 'Pairing code expired — generate a fresh code.',
    steps: [
      'Install the official YFactory Code Extension in Visual Studio Code (delivered next in Batch 13).',
      'Open your project folder (Workspace) in VS Code and open the YFactory Code sidebar.',
      'Paste the YFactory Backend URL and temporary pairing code to sign in using VS Code SecretStorage.',
      'Select a coding model from Provider Center, review every Diff, and approve terminal commands locally.',
    ],
    sessionsTitle: 'Connected IDE Sessions',
    noSessions: 'No IDE workspace connected yet. Generate a pairing code above to connect VS Code.',
    disconnect: 'Disconnect',
    lastActive: 'Last active:',
    cursorNote: 'Experimental (pending Cursor verification)',
    vscodeSupported: 'VS Code supported',
    modelsTitle: 'Authorized Coding Models (from Provider Center)',
    modelsSub: 'Reuses your encrypted Provider Center keys directly on the backend — zero API keys in the extension.',
    manageModels: 'Manage Models in Provider Center',
    noModels: 'No coding models enabled yet. Enable a model from Anthropic, OpenAI, Gemini, OpenRouter, or Groq in Provider Center.',
    tasksTitle: 'Coding Task History',
    refresh: 'Refresh',
    clearAll: 'Clear History',
    noTasks: 'No coding tasks recorded yet. Tasks run from your connected IDE will appear here with impacted files and command results.',
    stopTask: 'Stop',
    delTask: 'Delete',
    filesReadLbl: 'Files read:',
    filesModLbl: 'Files modified:',
    cmdsLbl: 'Terminal commands:',
    statusLabels: {
      running: 'Running',
      awaiting_approval: 'Awaiting IDE Approval',
      completed: 'Completed',
      cancelled: 'Cancelled',
      failed: 'Failed',
    } as Record<IdeTaskItem['status'], string>,
    guardrailsTitle: 'Security & Strict Scope Guardrails',
    guardrails: [
      { t: 'Strictly Not an App Builder', d: 'Never generates standalone apps from prompts or duplicates an IDE inside YFactory Web.' },
      { t: 'Sensitive Files Excluded', d: 'Excludes .env, private keys, node_modules, and .git by default; never stores sensitive file contents in logs.' },
      { t: 'Explicit Diff & Terminal Approval', d: 'Every file edit shows a diff and every local terminal command requires explicit approval.' },
      { t: 'Zero API Keys in Extension', d: 'Extension holds short-lived session tokens only; all model calls run through YFactory Backend.' },
    ],
    openChatBtn: 'Open Chat',
  };
}

export default function CodeIdeDashboard({
  locale,
  getIdToken,
  onOpenProviderCenter,
  onOpenChat,
}: CodeIdeDashboardProps) {
  const isRtl = isRtlLanguage(locale);
  const ui = getCopy(locale);

  const [sessions, setSessions] = useState<IdeSessionItem[]>([]);
  const [models, setModels] = useState<IdeCodingModelItem[]>([]);
  const [tasks, setTasks] = useState<IdeTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [remainingSec, setRemainingSec] = useState(0);
  const [copiedKey, setCopiedKey] = useState<'code' | 'url' | null>(null);

  const backendOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';

  const loadAll = useCallback(async () => {
    if (!getIdToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const token = await getIdToken();
      const [sList, mList, tList] = await Promise.all([
        fetchIdeSessions(token),
        fetchIdeCodingModels(token),
        fetchIdeTasks(token),
      ]);
      setSessions(sList);
      setModels(mList);
      setTasks(tList);
    } catch (err) {
      setError(
        err instanceof IdeCodeApiError
          ? err.message
          : 'Could not load YFactory Code status.',
      );
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!pairing) {
      setRemainingSec(0);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000));
      setRemainingSec(left);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [pairing]);

  const handleGenerateCode = async () => {
    if (!getIdToken || pairBusy) return;
    setPairBusy(true);
    setError('');
    try {
      const token = await getIdToken();
      const created = await generateIdePairingCode(token);
      setPairing({ code: created.code, expiresAt: created.expiresAt });
    } catch (err) {
      setError(
        err instanceof IdeCodeApiError
          ? err.message
          : 'Could not generate pairing code.',
      );
    } finally {
      setPairBusy(false);
    }
  };

  const handleCopy = async (text: string, which: 'code' | 'url') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(which);
      window.setTimeout(() => setCopiedKey((c) => (c === which ? null : c)), 1800);
    } catch {
      // ignore clipboard error
    }
  };

  const handleDisconnect = async (sessionId: string) => {
    if (!getIdToken) return;
    try {
      const token = await getIdToken();
      await disconnectIdeSession(token, sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      setError('Could not disconnect IDE session.');
    }
  };

  const handleCancelTask = async (taskId: string) => {
    if (!getIdToken) return;
    try {
      const token = await getIdToken();
      const updated = await cancelIdeCodingTask(token, taskId);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch {
      setError('Could not cancel task.');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!getIdToken) return;
    try {
      const token = await getIdToken();
      await deleteIdeCodingTask(token, taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch {
      setError('Could not delete task.');
    }
  };

  const handleClearTasks = async () => {
    if (!getIdToken) return;
    try {
      const token = await getIdToken();
      await clearIdeTaskHistory(token);
      setTasks([]);
    } catch {
      setError('Could not clear task history.');
    }
  };

  const statusTone = (st: IdeTaskItem['status']) => {
    if (st === 'completed') return 'is-ok';
    if (st === 'failed' || st === 'cancelled') return 'is-err';
    return 'is-gold';
  };

  return (
    <section
      className="yc-root"
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-label="YFactory Code"
      data-testid="code-ide-dashboard"
    >
      <header className="yc-hero">
        <YCodeLogo size={68} showWordmark />
        <div className="yc-hero-copy">
          <div className="yc-pill-row">
            <span className="yc-pill is-gold">YFactory Code</span>
            <span className={`yc-pill ${sessions.length > 0 ? 'is-ok' : ''}`}>
              {sessions.length > 0 ? (
                <CheckCircle2 size={12} aria-hidden="true" />
              ) : (
                <Link2 size={12} aria-hidden="true" />
              )}
              <span>{ui.sessionsBadge(sessions.length)}</span>
            </span>
          </div>
          <h1>{ui.title}</h1>
          <p>{ui.subtitle}</p>
          <div className="yc-pill-row" style={{ marginTop: 4 }}>
            <button
              type="button"
              className="yc-btn is-primary"
              disabled={pairBusy || !getIdToken}
              onClick={() => void handleGenerateCode()}
              data-testid="button-generate-ide-pairing"
            >
              {pairBusy ? (
                <LoaderCircle className="loading-spinner" size={15} />
              ) : (
                <Link2 size={15} />
              )}
              <span>{pairBusy ? ui.generatingCode : ui.genCodeBtn}</span>
            </button>
            <button
              type="button"
              className="yc-btn"
              onClick={() => onOpenProviderCenter()}
            >
              <KeyRound size={14} />
              <span>{ui.manageModels}</span>
            </button>
            <button type="button" className="yc-btn" onClick={onOpenChat}>
              <MessageCircle size={14} />
              <span>{ui.openChatBtn}</span>
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="yc-alert" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Pairing Panel */}
      <section className="yc-panel">
        <div className="yc-head-row">
          <div>
            <h2>{ui.pairTitle}</h2>
            <small>{ui.pairSub}</small>
          </div>
          <button
            type="button"
            className="yc-btn"
            disabled={loading}
            onClick={() => void loadAll()}
          >
            <RefreshCw size={14} className={loading ? 'loading-spinner' : ''} />
            <span>{ui.refresh}</span>
          </button>
        </div>

        {pairing && (
          <div className="yc-pairing-box" data-testid="ide-pairing-code-box">
            <div className="yc-code-display">
              <span className="yc-code-value" dir="ltr">
                {pairing.code}
              </span>
              <div className="yc-pill-row">
                <span className={`yc-pill ${remainingSec > 0 ? 'is-gold' : 'is-err'}`}>
                  <Clock size={12} />
                  <span>
                    {remainingSec > 0 ? ui.expiresIn(remainingSec) : ui.codeExpired}
                  </span>
                </span>
                <button
                  type="button"
                  className="yc-btn is-primary"
                  disabled={remainingSec === 0}
                  onClick={() => void handleCopy(pairing.code, 'code')}
                >
                  {copiedKey === 'code' ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedKey === 'code' ? ui.copied : ui.copyCode}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="yc-endpoint-line">
          <span>
            {ui.serverUrlLbl} <code dir="ltr">{backendOrigin}</code>
          </span>
          <button
            type="button"
            className="yc-btn"
            onClick={() => void handleCopy(backendOrigin, 'url')}
          >
            {copiedKey === 'url' ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedKey === 'url' ? ui.copied : ui.copyUrl}</span>
          </button>
        </div>

        <ol className="yc-steps-list">
          {ui.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </section>

      {/* Connected IDE Sessions */}
      <section className="yc-panel">
        <div className="yc-head-row">
          <h2>
            {ui.sessionsTitle} ({sessions.length})
          </h2>
        </div>

        {loading ? (
          <div className="yc-empty">
            <LoaderCircle className="loading-spinner" size={20} />
          </div>
        ) : sessions.length === 0 ? (
          <div className="yc-empty">{ui.noSessions}</div>
        ) : (
          <div className="yc-list">
            {sessions.map((sess) => (
              <article key={sess.id} className="yc-item-card">
                <div className="yc-item-top">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div className="yc-pill-row">
                      <FolderGit2 size={15} />
                      <strong dir="auto">{sess.workspaceName}</strong>
                      <span className="yc-pill is-ok">
                        {sess.ideName === 'vscode'
                          ? `${ui.vscodeSupported} (${sess.ideVersion})`
                          : `${sess.ideName.toUpperCase()} · ${ui.cursorNote}`}
                      </span>
                    </div>
                    <small style={{ color: 'var(--app-secondary)' }}>
                      {sess.machineLabel} · {ui.lastActive}{' '}
                      {new Date(sess.lastSeenAt).toLocaleString(locale)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="yc-btn is-danger"
                    onClick={() => void handleDisconnect(sess.id)}
                  >
                    <Unplug size={14} />
                    <span>{ui.disconnect}</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Coding Models from Provider Center */}
      <section className="yc-panel">
        <div className="yc-head-row">
          <div>
            <h2>
              {ui.modelsTitle} ({models.length})
            </h2>
            <small>{ui.modelsSub}</small>
          </div>
          <button
            type="button"
            className="yc-btn"
            onClick={() => onOpenProviderCenter()}
          >
            <Cpu size={14} />
            <span>{ui.manageModels}</span>
          </button>
        </div>

        {models.length === 0 ? (
          <div className="yc-empty">{ui.noModels}</div>
        ) : (
          <div className="yc-model-chips">
            {models.map((m) => (
              <span
                key={`${m.provider}:${m.keyId}:${m.modelName}`}
                className="yc-model-chip"
                dir="ltr"
              >
                <strong>{m.modelName}</strong>
                <small>{m.providerName}</small>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Coding Task History */}
      <section className="yc-panel">
        <div className="yc-head-row">
          <h2>
            {ui.tasksTitle} ({tasks.length})
          </h2>
          {tasks.length > 0 && (
            <button
              type="button"
              className="yc-btn is-danger"
              onClick={() => void handleClearTasks()}
            >
              <Trash2 size={13} />
              <span>{ui.clearAll}</span>
            </button>
          )}
        </div>

        {tasks.length === 0 ? (
          <div className="yc-empty">{ui.noTasks}</div>
        ) : (
          <div className="yc-list">
            {tasks.map((task) => (
              <article key={task.id} className="yc-item-card">
                <div className="yc-item-top">
                  <div className="yc-pill-row">
                    <span className={`yc-pill ${statusTone(task.status)}`}>
                      {ui.statusLabels[task.status]}
                    </span>
                    <span className="yc-pill" dir="ltr">
                      {task.modelName}
                    </span>
                    <span className="yc-pill">{task.workspaceName}</span>
                  </div>
                  <div className="yc-pill-row">
                    {(task.status === 'running' ||
                      task.status === 'awaiting_approval') && (
                      <button
                        type="button"
                        className="yc-btn"
                        onClick={() => void handleCancelTask(task.id)}
                      >
                        <Square size={12} />
                        <span>{ui.stopTask}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="yc-btn is-danger"
                      onClick={() => void handleDeleteTask(task.id)}
                    >
                      <Trash2 size={13} />
                      <span>{ui.delTask}</span>
                    </button>
                  </div>
                </div>

                <strong dir="auto" style={{ fontSize: 13.5 }}>
                  {task.prompt}
                </strong>

                {task.summary && (
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--app-secondary)' }} dir="auto">
                    {task.summary}
                  </p>
                )}

                {task.filesRead.length > 0 && (
                  <div className="yc-files-strip">
                    <small style={{ color: 'var(--app-secondary)' }}>
                      {ui.filesReadLbl}
                    </small>
                    {task.filesRead.slice(0, 8).map((f) => (
                      <span className="yc-file-tag" key={`r-${f}`} dir="ltr">
                        {f}
                      </span>
                    ))}
                  </div>
                )}

                {task.filesModified.length > 0 && (
                  <div className="yc-files-strip">
                    <small style={{ color: 'var(--app-success-text)' }}>
                      <FileDiff size={11} style={{ verticalAlign: 'middle' }} />{' '}
                      {ui.filesModLbl}
                    </small>
                    {task.filesModified.slice(0, 8).map((f) => (
                      <span className="yc-file-tag" key={`m-${f}`} dir="ltr">
                        {f}
                      </span>
                    ))}
                  </div>
                )}

                {task.commandsRun.length > 0 && (
                  <div className="yc-files-strip">
                    <small style={{ color: 'var(--app-secondary)' }}>
                      <Terminal size={11} style={{ verticalAlign: 'middle' }} />{' '}
                      {ui.cmdsLbl}
                    </small>
                    {task.commandsRun.map((c, idx) => (
                      <span className="yc-file-tag" key={idx} dir="ltr">
                        {c.command} ({c.exitCode === 0 ? 'OK' : `exit ${c.exitCode ?? '?'}`})
                      </span>
                    ))}
                  </div>
                )}

                {task.errorMessage && (
                  <div className="yc-alert" role="alert">
                    <AlertCircle size={14} />
                    <span>{task.errorMessage}</span>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Security & Strict Exclusions */}
      <section className="yc-panel">
        <div className="yc-head-row">
          <div className="yc-pill-row">
            <ShieldCheck size={16} />
            <h2>{ui.guardrailsTitle}</h2>
          </div>
        </div>
        <div className="yc-guardrail-grid">
          {ui.guardrails.map((g) => (
            <div key={g.t} className="yc-guardrail-card">
              <strong>{g.t}</strong>
              <span>{g.d}</span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
