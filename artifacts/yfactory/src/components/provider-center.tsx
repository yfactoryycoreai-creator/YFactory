import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Layers,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  addProviderKey,
  addProviderKeyModel,
  deleteProviderKey,
  fetchProviderCatalog,
  fetchProviderDetails,
  fetchProviderLiveModels,
  ProviderCenterApiError,
  removeProviderKeyModel,
  setDefaultProviderKey,
  updateProviderKey,
  type CatalogAuditSummary,
  type LiveDiscoveredModel,
  type ProviderDetailResponse,
  type ProviderSummaryItem,
} from '@/lib/providerCenterApi';
import { isRtlLanguage } from '@/lib/languages';
import {
  ProviderConnectionTester,
  ProviderDiagnosticsBar,
} from '@/components/provider-diagnostics';
import './provider-center.css';

type ProviderCenterProps = {
  userId: string | null;
  getIdToken?: () => Promise<string>;
  initialModelTarget?: { provider: string; id: string } | null;
};

type FilterTab =
  | 'all'
  | 'connected'
  | 'chat'
  | 'code'
  | 'image'
  | 'video'
  | 'free_tier'
  | 'paid';

type ModelFilterTab = 'all' | 'free' | 'paid' | 'enabled';

function providerInitials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getCopy(lang: string) {
  if (lang.startsWith('ar')) {
    return {
      title: `مركز المزودين والنماذج`,
      subtitle: `جميع شركات الذكاء الاصطناعي ومفاتيحك والنماذج المجانية والمدفوعة في مكان واحد.`,
      basic: `الوضع المبسط`,
      advanced: `الوضع المتقدم`,
      statProviders: `إجمالي الشركات`,
      statConnected: `متصلة بمفتاح`,
      statModels: `نماذج الكتالوج`,
      searchPh: `ابحث عن شركة أو نموذج أو خدمة من أول حرف...`,
      fAll: `الكل`,
      fConn: `المتصلة`,
      fChat: `شات`,
      fCode: `برمجة`,
      fImage: `صور`,
      fVideo: `فيديو`,
      fFree: `باقة مجانية`,
      fPaid: `مدفوع`,
      keysCount: (c: number, m: number) => `${c}/${m} مفاتيح`,
      modelsCount: (c: number) => `${c} نموذج`,
      stConnected: `متصل`,
      stNotConf: `غير مهيأ`,
      stFailing: `تحقق من المفتاح`,
      stCooldown: `تهدئة مؤقتة`,
      stUnavail: `بلا API عامة`,
      backToCenter: `العودة لمركز المزودين`,
      loading: `جارٍ تحميل مركز المزودين...`,
      emptySearch: `لا يوجد مزود مطابق للبحث أو الفلتر الحالي.`,
      keysSection: `مفاتيح API الخاصة بك`,
      keyLimitHint: (c: number, m: number) => `${c} من ${m} مفاتيح مستخدمة (مشفر بـ AES-256-GCM ومخفي دائماً)`,
      addKeyBtn: `إضافة مفتاح API`,
      keyLabelPh: `اسم اختياري للمفتاح (مثلاً: المفتاح الرئيسي)`,
      keyValPh: `الصق مفتاح API هنا...`,
      makeDef: `تعيين كمفتاح افتراضي`,
      saveKey: `حفظ المفتاح`,
      cancel: `إلغاء`,
      defBadge: `افتراضي`,
      setDef: `تعيين كافتراضي`,
      rename: `تسمية`,
      replace: `استبدال`,
      del: `حذف`,
      replacePh: `أدخل مفتاح API الجديد...`,
      renamePh: `الاسم الجديد للمفتاح...`,
      save: `حفظ`,
      modelsSection: `النماذج المتاحة (مجانية ومدفوعة)`,
      refreshLive: `تحديث النماذج من المزود`,
      loadingLive: `جارٍ جلب النماذج المباشرة من المزود...`,
      liveLoaded: (n: number) => `تم جلب ${n} نموذجاً مباشرة من واجهة المزود الرسمية.`,
      liveAddKeyHint: `أضف مفتاح API أعلاه لجلب جميع النماذج المجانية والمدفوعة من المزود تلقائياً وتفعيلها في الشات.`,
      modelSearchPh: `ابحث في نماذج هذه الشركة...`,
      mfAll: `الكل`,
      mfFree: `مجاني / Free`,
      mfPaid: `مدفوع / Paid`,
      mfEnabled: `المفعّلة في الشات`,
      enableChat: `تفعيل للشات`,
      enabledChat: `مفعّل في الشات`,
      manualModelPh: `أضف معرّف نموذج يدوياً (مثل openrouter/free أو llama-3.3-70b-versatile)`,
      addModel: `إضافة نموذج`,
      noModelsMatch: `لا توجد نماذج مطابقة.`,
      inactiveToggle: (n: number) => `نماذج متوقفة أو قديمة غير مفعّلة (${n})`,
      officialLinks: `الروابط الرسمية والتوثيق`,
      transparency: `شفافية الاتصال الرسمي (How YFactory Connects)`,
      notAvail: `غير متاح`,
      linkWebsite: `الموقع الرسمي`,
      linkPlatform: `منصة API الرسمية`,
      linkDocs: `توثيق API الرسمي`,
      linkKeyPage: `صفحة إنشاء المفتاح`,
      linkUsage: `لوحة الاستخدام`,
      linkBilling: `لوحة الفوترة`,
      linkModels: `توثيق النماذج`,
      lblBaseUrl: `عنوان API الأساسي`,
      lblChatEp: `نقطة اتصال الشات`,
      lblAuth: `طريقة المصادقة`,
      lblVerStatus: `حالة التحقق`,
      lblRoute: `مسار الطلبات`,
      routeDesc: `تمر الطلبات عبر خادم YFactory Backend باستخدام مفتاحك المشفر فقط، بدون أي Proxy خارجي.`,
      lblPricing: `التسعير`,
      lblLimits: `حدود الاستخدام`,
      verOfficial: `نطاق رسمي متحقق منه`,
      verPending: `قيد التحقق`,
      verNoApi: `لا توجد API عامة رسمية`,
      openWeightsNote: `Open Weights (يتطلب استضافة API — ليس مجانياً تلقائياً)`,
      savedOk: `تم حفظ التغيير بنجاح.`,
      keySavedOk: `تم حفظ المفتاح المشفر بنجاح وجارٍ تحميل النماذج...`,
      delConfirm: `هل تريد حذف هذا المفتاح نهائياً؟`,
      noPublicApiMsg: `هذه الشركة لا توفر API عامة رسمية حالياً ولا يمكن إضافة مفتاح لها.`,
    };
  }
  return {
    title: `Provider Center`,
    subtitle: `All AI companies, encrypted API keys, and free & paid models in one unified center.`,
    basic: `Basic`,
    advanced: `Advanced`,
    statProviders: `Providers`,
    statConnected: `Connected`,
    statModels: `Catalog models`,
    searchPh: `Search providers, models, or services from the 1st letter...`,
    fAll: `All`,
    fConn: `Connected`,
    fChat: `Chat`,
    fCode: `Code`,
    fImage: `Image`,
    fVideo: `Video`,
    fFree: `Free Tier`,
    fPaid: `Paid`,
    keysCount: (c: number, m: number) => `${c}/${m} keys`,
    modelsCount: (c: number) => `${c} models`,
    stConnected: `Connected`,
    stNotConf: `Not configured`,
    stFailing: `Check key`,
    stCooldown: `Cooling down`,
    stUnavail: `No public API`,
    backToCenter: `Back to Provider Center`,
    loading: `Loading Provider Center...`,
    emptySearch: `No providers match your current search or filter.`,
    keysSection: `Your API Keys`,
    keyLimitHint: (c: number, m: number) => `${c} of ${m} keys saved (AES-256-GCM encrypted & hidden)`,
    addKeyBtn: `Add API Key`,
    keyLabelPh: `Optional key label (e.g. Primary key)`,
    keyValPh: `Paste your API key...`,
    makeDef: `Set as default key`,
    saveKey: `Save Key`,
    cancel: `Cancel`,
    defBadge: `Default`,
    setDef: `Set default`,
    rename: `Rename`,
    replace: `Replace`,
    del: `Delete`,
    replacePh: `Paste replacement API key...`,
    renamePh: `New key label...`,
    save: `Save`,
    modelsSection: `Available Models (Free & Paid)`,
    refreshLive: `Refresh Live Models`,
    loadingLive: `Fetching live models from provider API...`,
    liveLoaded: (n: number) => `Loaded ${n} live models directly from the official provider API.`,
    liveAddKeyHint: `Add your API key above to automatically load all free & paid models from this provider.`,
    modelSearchPh: `Search models for this provider...`,
    mfAll: `All`,
    mfFree: `Free`,
    mfPaid: `Paid`,
    mfEnabled: `Enabled in Chat`,
    enableChat: `Enable`,
    enabledChat: `Enabled`,
    manualModelPh: `Add exact model ID manually (e.g. openrouter/free, llama-3.3-70b-versatile)`,
    addModel: `Add model`,
    noModelsMatch: `No matching models found.`,
    inactiveToggle: (n: number) => `Deprecated / unavailable models (${n})`,
    officialLinks: `Official Links & Documentation`,
    transparency: `Official API Transparency (How YFactory Connects)`,
    notAvail: `Not available`,
    linkWebsite: `Official Website`,
    linkPlatform: `API Platform`,
    linkDocs: `API Documentation`,
    linkKeyPage: `API Key Creation Page`,
    linkUsage: `Usage Dashboard`,
    linkBilling: `Billing Dashboard`,
    linkModels: `Models Documentation`,
    lblBaseUrl: `Official API Base URL`,
    lblChatEp: `Chat Endpoint`,
    lblAuth: `Authentication Method`,
    lblVerStatus: `Verification Status`,
    lblRoute: `Request Routing`,
    routeDesc: `Requests pass through YFactory Backend using your encrypted key only. No third-party proxy is used.`,
    lblPricing: `Pricing`,
    lblLimits: `Usage Limits`,
    verOfficial: `Verified Official Endpoint`,
    verPending: `Verification Pending`,
    verNoApi: `No Official Public API`,
    openWeightsNote: `Open weights (hosted API — not automatically free)`,
    savedOk: `Saved successfully.`,
    keySavedOk: `Encrypted key saved. Loading provider models...`,
    delConfirm: `Permanently delete this API key?`,
    noPublicApiMsg: `This provider does not offer an official public API.`,
  };
}

function capLabel(cap: string, isAr: boolean): string {
  const map: Record<string, [string, string]> = {
    chat: ['Chat', 'شات'],
    code: ['Code', 'برمجة'],
    image_generation: ['Image', 'صور'],
    image_editing: ['Image Edit', 'تعديل صور'],
    image_understanding: ['Vision', 'رؤية'],
    video_generation: ['Video', 'فيديو'],
    image_to_video: ['Img→Video', 'صورة→فيديو'],
  };
  const pair = map[cap];
  return pair ? (isAr ? pair[1] : pair[0]) : cap;
}

export default function ProviderCenter({
  userId,
  getIdToken,
  initialModelTarget = null,
}: ProviderCenterProps) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const isRtl = isRtlLanguage(locale);
  const isAr = locale.startsWith('ar');
  const ui = getCopy(locale);

  const [mode, setMode] = useState<'basic' | 'advanced'>('basic');
  const [providers, setProviders] = useState<ProviderSummaryItem[]>([]);
  const [audit, setAudit] = useState<CatalogAuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');

  const [selectedId, setSelectedId] = useState<string | null>(
    initialModelTarget?.provider ?? null,
  );
  const [detail, setDetail] = useState<ProviderDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailNotice, setDetailNotice] = useState('');

  const [liveModels, setLiveModels] = useState<LiveDiscoveredModel[]>([]);
  const [liveSupported, setLiveSupported] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [modelFilter, setModelFilter] = useState<ModelFilterTab>('all');
  const [manualModelId, setManualModelId] = useState('');
  const [modelBusyId, setModelBusyId] = useState<string | null>(null);

  const [addFormOpen, setAddFormOpen] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyDefault, setNewKeyDefault] = useState(true);
  const [keyBusy, setKeyBusy] = useState(false);
  const [editKeyState, setEditKeyState] = useState<{
    keyId: string;
    kind: 'rename' | 'replace';
    value: string;
  } | null>(null);

  const loadCatalog = useCallback(async () => {
    if (!getIdToken) return;
    setLoading(true);
    setError('');
    try {
      const token = await getIdToken();
      const data = await fetchProviderCatalog(token);
      setProviders(data.providers);
      setAudit(data.auditSummary);
    } catch (err) {
      setError(
        err instanceof ProviderCenterApiError
          ? err.message
          : 'Could not load Provider Center.',
      );
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog, userId]);

  const loadLiveModels = useCallback(
    async (providerId: string, preferredKeyId?: string) => {
      if (!getIdToken) return;
      setLiveLoading(true);
      setLiveError('');
      try {
        const token = await getIdToken();
        const res = await fetchProviderLiveModels(token, providerId, preferredKeyId);
        setLiveSupported(res.supported);
        setLiveModels(res.models);
        if (res.error) setLiveError(res.error);
      } catch (err) {
        setLiveModels([]);
        setLiveError(
          err instanceof ProviderCenterApiError
            ? err.message
            : 'Could not fetch live models.',
        );
      } finally {
        setLiveLoading(false);
      }
    },
    [getIdToken],
  );

  const openProvider = useCallback(
    async (providerId: string) => {
      if (!getIdToken) return;
      setSelectedId(providerId);
      setDetailLoading(true);
      setDetailError('');
      setDetailNotice('');
      setLiveModels([]);
      setLiveError('');
      setLiveSupported(false);
      setModelSearch('');
      setModelFilter('all');
      setManualModelId('');
      setAddFormOpen(false);
      setEditKeyState(null);
      try {
        const token = await getIdToken();
        const data = await fetchProviderDetails(token, providerId);
        setDetail(data);
        if (data.keys.length > 0) {
          const defKey = data.keys.find((k) => k.isDefault) ?? data.keys[0];
          void loadLiveModels(providerId, defKey?.id);
        }
      } catch (err) {
        setDetailError(
          err instanceof ProviderCenterApiError
            ? err.message
            : 'Could not load provider details.',
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [getIdToken, loadLiveModels],
  );

  useEffect(() => {
    if (initialModelTarget?.provider) {
      void openProvider(initialModelTarget.provider);
    }
  }, [initialModelTarget?.provider, openProvider]);

  const filteredProviders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return providers.filter((p) => {
      if (filter === 'connected' && p.connectionStatus !== 'connected') return false;
      if (filter === 'chat' && !p.capabilities.includes('chat')) return false;
      if (filter === 'code' && !p.capabilities.includes('code')) return false;
      if (
        filter === 'image' &&
        !p.capabilities.includes('image_generation') &&
        !p.capabilities.includes('image_editing')
      ) {
        return false;
      }
      if (
        filter === 'video' &&
        !p.capabilities.includes('video_generation') &&
        !p.capabilities.includes('image_to_video')
      ) {
        return false;
      }
      if (
        filter === 'free_tier' &&
        !p.accessTypes.includes('free_tier') &&
        !p.accessTypes.includes('free')
      ) {
        return false;
      }
      if (filter === 'paid' && !p.accessTypes.includes('paid')) return false;
      if (!q) return true;
      const hay = [
        p.id,
        p.name,
        p.shortDescription,
        ...p.capabilities,
        ...p.modelNamesPreview,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [providers, search, filter]);

  const connectedCount = useMemo(
    () => providers.filter((p) => p.connectionStatus === 'connected').length,
    [providers],
  );

  const activeKey = useMemo(() => {
    if (!detail || detail.keys.length === 0) return null;
    return detail.keys.find((k) => k.isDefault) ?? detail.keys[0] ?? null;
  }, [detail]);

  const enabledModelSet = useMemo(
    () => new Set(activeKey?.models ?? []),
    [activeKey],
  );

  const mergedModels = useMemo(() => {
    const list: Array<{
      modelId: string;
      modelName: string;
      pricingTier: 'free' | 'paid' | 'open_weights' | 'unknown';
      category: string;
      source: 'live' | 'catalog' | 'saved';
      hosts?: string[];
      notes?: string;
    }> = [];
    const seen = new Set<string>();

    // 1. Live discovered models first
    for (const lm of liveModels) {
      if (seen.has(lm.modelId)) continue;
      seen.add(lm.modelId);
      list.push({
        modelId: lm.modelId,
        modelName: lm.modelName,
        pricingTier: lm.pricingTier,
        category: 'text_chat',
        source: 'live',
      });
    }

    // 2. Saved models on the key (if not already in live)
    for (const savedId of activeKey?.models ?? []) {
      if (seen.has(savedId)) continue;
      seen.add(savedId);
      list.push({
        modelId: savedId,
        modelName: savedId,
        pricingTier: savedId.includes(':free') || savedId === 'openrouter/free' ? 'free' : 'unknown',
        category: 'text_chat',
        source: 'saved',
      });
    }

    // 3. Catalog models for this provider
    for (const cm of detail?.models ?? []) {
      if (cm.modelId === 'various' || seen.has(cm.modelId)) continue;
      seen.add(cm.modelId);
      const tier =
        cm.accessType === 'free' || cm.accessType === 'free_tier'
          ? 'free'
          : cm.accessType === 'open_weights_hosted' || cm.accessType === 'paid_open_weights'
            ? 'open_weights'
            : 'paid';
      list.push({
        modelId: cm.modelId,
        modelName: cm.modelName,
        pricingTier: tier,
        category: cm.category,
        source: 'catalog',
        hosts: cm.apiHosts,
        notes: cm.notes,
      });
    }

    const q = modelSearch.trim().toLowerCase();
    return list.filter((item) => {
      if (modelFilter === 'free' && item.pricingTier !== 'free') return false;
      if (modelFilter === 'paid' && item.pricingTier !== 'paid') return false;
      if (modelFilter === 'enabled' && !enabledModelSet.has(item.modelId)) return false;
      if (!q) return true;
      return (
        item.modelId.toLowerCase().includes(q) ||
        item.modelName.toLowerCase().includes(q)
      );
    });
  }, [liveModels, activeKey, detail, modelSearch, modelFilter, enabledModelSet]);

  const handleAddKey = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!detail || !getIdToken || !newKeyValue.trim() || keyBusy) return;
    setKeyBusy(true);
    setDetailError('');
    setDetailNotice('');
    try {
      const token = await getIdToken();
      const created = await addProviderKey(token, detail.provider.id, {
        label: newKeyLabel.trim() || undefined,
        value: newKeyValue.trim(),
        makeDefault: newKeyDefault,
      });
      setNewKeyLabel('');
      setNewKeyValue('');
      setAddFormOpen(false);
      setDetailNotice(ui.keySavedOk);
      const refreshed = await fetchProviderDetails(token, detail.provider.id);
      setDetail(refreshed);
      void loadCatalog();
      void loadLiveModels(detail.provider.id, created.id);
    } catch (err) {
      setDetailError(
        err instanceof ProviderCenterApiError ? err.message : 'Could not save API key.',
      );
    } finally {
      setKeyBusy(false);
    }
  };

  const handleSetDefault = async (keyId: string) => {
    if (!detail || !getIdToken || keyBusy) return;
    setKeyBusy(true);
    setDetailError('');
    try {
      const token = await getIdToken();
      await setDefaultProviderKey(token, detail.provider.id, keyId);
      const refreshed = await fetchProviderDetails(token, detail.provider.id);
      setDetail(refreshed);
      setDetailNotice(ui.savedOk);
      void loadCatalog();
    } catch (err) {
      setDetailError(
        err instanceof ProviderCenterApiError ? err.message : 'Could not update default key.',
      );
    } finally {
      setKeyBusy(false);
    }
  };

  const handleEditKeySubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!detail || !editKeyState || !getIdToken || !editKeyState.value.trim() || keyBusy) {
      return;
    }
    setKeyBusy(true);
    setDetailError('');
    try {
      const token = await getIdToken();
      await updateProviderKey(
        token,
        detail.provider.id,
        editKeyState.keyId,
        editKeyState.kind === 'rename'
          ? { label: editKeyState.value.trim() }
          : { value: editKeyState.value.trim() },
      );
      setEditKeyState(null);
      const refreshed = await fetchProviderDetails(token, detail.provider.id);
      setDetail(refreshed);
      setDetailNotice(ui.savedOk);
      void loadCatalog();
    } catch (err) {
      setDetailError(
        err instanceof ProviderCenterApiError ? err.message : 'Could not update key.',
      );
    } finally {
      setKeyBusy(false);
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    if (!detail || !getIdToken || keyBusy) return;
    if (!window.confirm(ui.delConfirm)) return;
    setKeyBusy(true);
    setDetailError('');
    try {
      const token = await getIdToken();
      await deleteProviderKey(token, detail.provider.id, keyId);
      const refreshed = await fetchProviderDetails(token, detail.provider.id);
      setDetail(refreshed);
      if (refreshed.keys.length === 0) setLiveModels([]);
      setDetailNotice(ui.savedOk);
      void loadCatalog();
    } catch (err) {
      setDetailError(
        err instanceof ProviderCenterApiError ? err.message : 'Could not delete key.',
      );
    } finally {
      setKeyBusy(false);
    }
  };

  const handleToggleModel = async (modelId: string) => {
    if (!detail || !activeKey || !getIdToken || modelBusyId) return;
    setModelBusyId(modelId);
    setDetailError('');
    try {
      const token = await getIdToken();
      const updatedKey = enabledModelSet.has(modelId)
        ? await removeProviderKeyModel(token, detail.provider.id, activeKey.id, modelId)
        : await addProviderKeyModel(token, detail.provider.id, activeKey.id, modelId);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              keys: prev.keys.map((k) => (k.id === updatedKey.id ? updatedKey : k)),
            }
          : prev,
      );
    } catch (err) {
      setDetailError(
        err instanceof ProviderCenterApiError ? err.message : 'Could not update model.',
      );
    } finally {
      setModelBusyId(null);
    }
  };

  const handleAddManualModel = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const id = manualModelId.trim();
    if (!detail || !activeKey || !getIdToken || !id || modelBusyId) return;
    setModelBusyId(id);
    setDetailError('');
    try {
      const token = await getIdToken();
      const updatedKey = await addProviderKeyModel(token, detail.provider.id, activeKey.id, id);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              keys: prev.keys.map((k) => (k.id === updatedKey.id ? updatedKey : k)),
            }
          : prev,
      );
      setManualModelId('');
      setDetailNotice(ui.savedOk);
    } catch (err) {
      setDetailError(
        err instanceof ProviderCenterApiError ? err.message : 'Could not add model.',
      );
    } finally {
      setModelBusyId(null);
    }
  };

  const statusText = (st: ProviderSummaryItem['connectionStatus']) => {
    if (st === 'connected') return ui.stConnected;
    if (st === 'failing') return ui.stFailing;
    if (st === 'cooldown') return ui.stCooldown;
    if (st === 'unavailable') return ui.stUnavail;
    return ui.stNotConf;
  };

  if (selectedId) {
    const p = detail?.provider;
    return (
      <section className="pc-root" dir={isRtl ? 'rtl' : 'ltr'} data-testid="provider-detail-view">
        <div className="pc-detail-header">
          <button
            type="button"
            className="pc-back-btn"
            onClick={() => {
              setSelectedId(null);
              setDetail(null);
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>{ui.backToCenter}</span>
          </button>
          <div className="pc-mode-switch" role="group" aria-label="View mode">
            <button
              type="button"
              className={mode === 'basic' ? 'is-active' : ''}
              onClick={() => setMode('basic')}
            >
              {ui.basic}
            </button>
            <button
              type="button"
              className={mode === 'advanced' ? 'is-active' : ''}
              onClick={() => setMode('advanced')}
            >
              {ui.advanced}
            </button>
          </div>
        </div>

        {detailLoading ? (
          <div className="pc-empty-box">
            <LoaderCircle className="loading-spinner" size={22} />
          </div>
        ) : !p ? (
          <div className="pc-banner-err" role="alert">
            <AlertCircle size={16} />
            <span>{detailError || 'Provider not found.'}</span>
          </div>
        ) : (
          <>
            <div className="pc-panel">
              <div className="pc-card-head">
                <span className="pc-logo" aria-hidden="true">
                  {providerInitials(p.name)}
                </span>
                <div className="pc-card-title-wrap">
                  <div className="pc-card-name-row">
                    <strong>{p.name}</strong>
                    {p.connectionDetails.verificationStatus === 'verified_official' && (
                      <ShieldCheck size={16} className="pc-verified-dot" />
                    )}
                    <span className={`pc-status-badge is-${p.connectionStatus}`}>
                      {statusText(p.connectionStatus)}
                    </span>
                  </div>
                  <p className="pc-card-desc">{p.shortDescription}</p>
                </div>
              </div>
              <div className="pc-badge-row">
                {p.capabilities.map((cap) => (
                  <span className="pc-cap-badge is-gold" key={cap}>
                    {capLabel(cap, isAr)}
                  </span>
                ))}
                <span className="pc-cap-badge">{p.pricingSummary}</span>
              </div>
            </div>

            {detailNotice && (
              <div className="pc-banner-ok" role="status">
                <CheckCircle2 size={16} />
                <span>{detailNotice}</span>
              </div>
            )}
            {detailError && (
              <div className="pc-banner-err" role="alert">
                <AlertCircle size={16} />
                <span>{detailError}</span>
              </div>
            )}

            {/* API Keys Management */}
            <div className="pc-panel">
              <div className="pc-panel-head">
                <div>
                  <h2>{ui.keysSection}</h2>
                  <small>{ui.keyLimitHint(detail.keys.length, p.maxKeys)}</small>
                </div>
                {p.role !== 'no_public_api' && detail.keys.length < p.maxKeys && (
                  <button
                    type="button"
                    className="pc-btn is-primary"
                    onClick={() => setAddFormOpen((v) => !v)}
                    data-testid="button-pc-add-key"
                  >
                    <Plus size={15} />
                    <span>{ui.addKeyBtn}</span>
                  </button>
                )}
              </div>

              {p.role === 'no_public_api' && (
                <div className="pc-banner-err">
                  <AlertCircle size={16} />
                  <span>{ui.noPublicApiMsg}</span>
                </div>
              )}

              {addFormOpen && (
                <form className="pc-form" onSubmit={(e) => void handleAddKey(e)}>
                  <input
                    className="pc-input"
                    type="text"
                    maxLength={80}
                    placeholder={ui.keyLabelPh}
                    value={newKeyLabel}
                    onChange={(e) => setNewKeyLabel(e.currentTarget.value)}
                  />
                  <input
                    className="pc-input"
                    type="password"
                    required
                    maxLength={4096}
                    dir="ltr"
                    autoComplete="new-password"
                    placeholder={ui.keyValPh}
                    value={newKeyValue}
                    onChange={(e) => setNewKeyValue(e.currentTarget.value)}
                    data-testid="input-pc-key-value"
                  />
                  <label className="pc-checkbox-row">
                    <input
                      type="checkbox"
                      checked={newKeyDefault}
                      onChange={(e) => setNewKeyDefault(e.currentTarget.checked)}
                    />
                    <span>{ui.makeDef}</span>
                  </label>
                  <div className="pc-key-actions">
                    <button
                      type="submit"
                      className="pc-btn is-primary"
                      disabled={keyBusy || !newKeyValue.trim()}
                      data-testid="button-pc-save-key"
                    >
                      {keyBusy && <LoaderCircle className="loading-spinner" size={14} />}
                      <span>{ui.saveKey}</span>
                    </button>
                    <button
                      type="button"
                      className="pc-btn"
                      onClick={() => setAddFormOpen(false)}
                    >
                      {ui.cancel}
                    </button>
                  </div>
                </form>
              )}

              {detail.keys.length > 0 && (
                <div className="pc-key-list">
                  {detail.keys.map((k) => (
                    <div
                      key={k.id}
                      className={`pc-key-row ${k.isDefault ? 'is-default' : ''}`}
                    >
                      <div className="pc-key-top">
                        <div className="pc-key-meta">
                          <div className="pc-card-name-row">
                            <KeyRound size={14} />
                            <strong>{k.label}</strong>
                            {k.isDefault && (
                              <span className="pc-cap-badge is-gold">
                                <Star size={10} />
                                {ui.defBadge}
                              </span>
                            )}
                          </div>
                          <code dir="ltr">{k.maskedValue}</code>
                        </div>
                        <div className="pc-key-actions">
                          {!k.isDefault && (
                            <button
                              type="button"
                              className="pc-btn"
                              disabled={keyBusy}
                              onClick={() => void handleSetDefault(k.id)}
                            >
                              <Star size={13} />
                              <span>{ui.setDef}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="pc-btn"
                            disabled={keyBusy}
                            onClick={() =>
                              setEditKeyState({
                                keyId: k.id,
                                kind: 'rename',
                                value: k.label,
                              })
                            }
                          >
                            <Pencil size={13} />
                            <span>{ui.rename}</span>
                          </button>
                          <button
                            type="button"
                            className="pc-btn"
                            disabled={keyBusy}
                            onClick={() =>
                              setEditKeyState({
                                keyId: k.id,
                                kind: 'replace',
                                value: '',
                              })
                            }
                          >
                            <RefreshCw size={13} />
                            <span>{ui.replace}</span>
                          </button>
                          <button
                            type="button"
                            className="pc-btn is-danger"
                            disabled={keyBusy}
                            onClick={() => void handleDeleteKey(k.id)}
                          >
                            <Trash2 size={13} />
                            <span>{ui.del}</span>
                          </button>
                        </div>
                      </div>

                      {editKeyState?.keyId === k.id && (
                        <form
                          className="pc-inline-add-model"
                          onSubmit={(e) => void handleEditKeySubmit(e)}
                        >
                          <input
                            className="pc-input"
                            type={editKeyState.kind === 'replace' ? 'password' : 'text'}
                            dir={editKeyState.kind === 'replace' ? 'ltr' : 'auto'}
                            placeholder={
                              editKeyState.kind === 'replace'
                                ? ui.replacePh
                                : ui.renamePh
                            }
                            value={editKeyState.value}
                            onChange={(e) =>
                              setEditKeyState({
                                ...editKeyState,
                                value: e.currentTarget.value,
                              })
                            }
                            autoFocus
                          />
                          <button
                            type="submit"
                            className="pc-btn is-primary"
                            disabled={keyBusy || !editKeyState.value.trim()}
                          >
                            {ui.save}
                          </button>
                          <button
                            type="button"
                            className="pc-btn"
                            onClick={() => setEditKeyState(null)}
                          >
                            {ui.cancel}
                          </button>
                        </form>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Official API Verification & Provider Ping Test */}
            <ProviderConnectionTester
              provider={p}
              activeKeyId={activeKey?.id ?? null}
              activeModelId={activeKey?.models[0] ?? null}
              locale={locale}
              getIdToken={getIdToken}
              onTestFinished={() => void loadCatalog()}
            />

            {/* Live + Catalog Models */}
            <div className="pc-panel">
              <div className="pc-panel-head">
                <div>
                  <h2>{ui.modelsSection}</h2>
                  {liveModels.length > 0 && (
                    <small>{ui.liveLoaded(liveModels.length)}</small>
                  )}
                </div>
                {activeKey && (
                  <button
                    type="button"
                    className="pc-btn"
                    disabled={liveLoading}
                    onClick={() => void loadLiveModels(p.id, activeKey.id)}
                    data-testid="button-pc-refresh-models"
                  >
                    <RefreshCw
                      size={14}
                      className={liveLoading ? 'loading-spinner' : ''}
                    />
                    <span>{ui.refreshLive}</span>
                  </button>
                )}
              </div>

              {!activeKey && p.role !== 'no_public_api' && (
                <p className="pc-card-desc">{ui.liveAddKeyHint}</p>
              )}

              {liveLoading && (
                <div className="pc-banner-ok">
                  <LoaderCircle className="loading-spinner" size={15} />
                  <span>{ui.loadingLive}</span>
                </div>
              )}

              {liveError && (
                <div className="pc-banner-err" role="alert">
                  <AlertCircle size={15} />
                  <span>{liveError}</span>
                </div>
              )}

              {activeKey && (
                <form
                  className="pc-inline-add-model"
                  onSubmit={(e) => void handleAddManualModel(e)}
                >
                  <input
                    className="pc-input"
                    type="text"
                    dir="ltr"
                    maxLength={200}
                    placeholder={ui.manualModelPh}
                    value={manualModelId}
                    onChange={(e) => setManualModelId(e.currentTarget.value)}
                    data-testid="input-pc-manual-model"
                  />
                  <button
                    type="submit"
                    className="pc-btn is-primary"
                    disabled={!manualModelId.trim() || Boolean(modelBusyId)}
                    data-testid="button-pc-add-manual-model"
                  >
                    <Plus size={14} />
                    <span>{ui.addModel}</span>
                  </button>
                </form>
              )}

              <div className="pc-search-box">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.currentTarget.value)}
                  placeholder={ui.modelSearchPh}
                />
                {modelSearch && (
                  <button
                    type="button"
                    className="pc-clear-btn"
                    onClick={() => setModelSearch('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="pc-filter-strip">
                {(
                  [
                    ['all', ui.mfAll],
                    ['free', ui.mfFree],
                    ['paid', ui.mfPaid],
                    ['enabled', ui.mfEnabled],
                  ] as const
                ).map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    className={`pc-filter-pill ${modelFilter === k ? 'is-active' : ''}`}
                    onClick={() => setModelFilter(k)}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div className="pc-model-list">
                {mergedModels.length === 0 ? (
                  <div className="pc-empty-box">{ui.noModelsMatch}</div>
                ) : (
                  mergedModels.map((m) => {
                    const enabled = enabledModelSet.has(m.modelId);
                    const busy = modelBusyId === m.modelId;
                    return (
                      <div
                        key={m.modelId}
                        className={`pc-model-row ${enabled ? 'is-enabled' : ''}`}
                      >
                        <div className="pc-model-info">
                          <strong dir="ltr">{m.modelName}</strong>
                          <code dir="ltr">{m.modelId}</code>
                          <div className="pc-badge-row">
                            {m.pricingTier === 'free' && (
                              <span className="pc-cap-badge is-free">Free</span>
                            )}
                            {m.pricingTier === 'paid' && (
                              <span className="pc-cap-badge">Paid</span>
                            )}
                            {m.pricingTier === 'open_weights' && (
                              <span className="pc-cap-badge">
                                {ui.openWeightsNote}
                              </span>
                            )}
                            {m.source === 'live' && liveSupported && (
                              <span className="pc-cap-badge is-gold">Live API</span>
                            )}
                          </div>
                        </div>
                        {activeKey && (
                          <button
                            type="button"
                            className={`pc-model-toggle ${enabled ? 'is-enabled' : ''}`}
                            disabled={Boolean(modelBusyId)}
                            onClick={() => void handleToggleModel(m.modelId)}
                          >
                            {busy ? (
                              <LoaderCircle className="loading-spinner" size={14} />
                            ) : enabled ? (
                              <Check size={14} />
                            ) : (
                              <Plus size={14} />
                            )}
                            <span>{enabled ? ui.enabledChat : ui.enableChat}</span>
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {detail.inactiveModels.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--app-secondary)' }}>
                    {ui.inactiveToggle(detail.inactiveModels.length)}
                  </summary>
                  <div className="pc-model-list" style={{ marginTop: 8 }}>
                    {detail.inactiveModels.map((im) => (
                      <div key={im.id} className="pc-model-row">
                        <div className="pc-model-info">
                          <strong dir="ltr">{im.modelName}</strong>
                          <code dir="ltr">{im.modelId}</code>
                        </div>
                        <span className="pc-status-badge is-unavailable">
                          {im.rawAccessType}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>

            {/* Advanced Mode: Official Links + API Transparency */}
            {mode === 'advanced' && (
              <>
                <div className="pc-panel">
                  <div className="pc-panel-head">
                    <h2>{ui.officialLinks}</h2>
                  </div>
                  <div className="pc-links-grid">
                    {(
                      [
                        [ui.linkWebsite, p.officialLinks.website],
                        [ui.linkPlatform, p.officialLinks.apiPlatform],
                        [ui.linkDocs, p.officialLinks.docsUrl],
                        [ui.linkKeyPage, p.officialLinks.apiKeyPage],
                        [ui.linkUsage, p.officialLinks.usageDashboard],
                        [ui.linkBilling, p.officialLinks.billingDashboard],
                        [ui.linkModels, p.officialLinks.modelsDocsUrl],
                      ] as const
                    ).map(([label, href]) =>
                      href ? (
                        <a
                          key={label}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pc-link-tile"
                        >
                          <span>{label}</span>
                          <ExternalLink size={14} aria-hidden="true" />
                        </a>
                      ) : (
                        <span key={label} className="pc-link-tile is-missing">
                          <span>{label}</span>
                          <small>{ui.notAvail}</small>
                        </span>
                      ),
                    )}
                  </div>
                </div>

                <div className="pc-panel">
                  <div className="pc-panel-head">
                    <h2>{ui.transparency}</h2>
                  </div>
                  <dl className="pc-tech-dl">
                    <div className="pc-tech-row">
                      <dt>{ui.lblVerStatus}</dt>
                      <dd>
                        {p.connectionDetails.verificationStatus === 'verified_official'
                          ? ui.verOfficial
                          : p.connectionDetails.verificationStatus === 'no_public_api'
                            ? ui.verNoApi
                            : ui.verPending}
                      </dd>
                    </div>
                    <div className="pc-tech-row">
                      <dt>{ui.lblBaseUrl}</dt>
                      <dd dir="ltr">{p.connectionDetails.apiBaseUrl ?? ui.notAvail}</dd>
                    </div>
                    <div className="pc-tech-row">
                      <dt>{ui.lblChatEp}</dt>
                      <dd dir="ltr">{p.connectionDetails.chatEndpoint ?? ui.notAvail}</dd>
                    </div>
                    <div className="pc-tech-row">
                      <dt>{ui.lblAuth}</dt>
                      <dd dir="ltr">{p.connectionDetails.authMethod ?? ui.notAvail}</dd>
                    </div>
                    <div className="pc-tech-row">
                      <dt>{ui.lblRoute}</dt>
                      <dd>{ui.routeDesc}</dd>
                    </div>
                    <div className="pc-tech-row">
                      <dt>{ui.lblPricing}</dt>
                      <dd>{p.pricingSummary}</dd>
                    </div>
                    <div className="pc-tech-row">
                      <dt>{ui.lblLimits}</dt>
                      <dd>{p.usageLimitsNote}</dd>
                    </div>
                  </dl>
                </div>
              </>
            )}
          </>
        )}
      </section>
    );
  }

  return (
    <section className="pc-root" dir={isRtl ? 'rtl' : 'ltr'} data-testid="provider-center">
      <div className="pc-top-bar">
        <div className="pc-title-block">
          <h1>{ui.title}</h1>
          <p>{ui.subtitle}</p>
        </div>
        <div className="pc-mode-switch" role="group" aria-label="View mode">
          <button
            type="button"
            className={mode === 'basic' ? 'is-active' : ''}
            onClick={() => setMode('basic')}
          >
            {ui.basic}
          </button>
          <button
            type="button"
            className={mode === 'advanced' ? 'is-active' : ''}
            onClick={() => setMode('advanced')}
          >
            {ui.advanced}
          </button>
        </div>
      </div>

      <div className="pc-stats-row">
        <div className="pc-stat-card">
          <strong>{providers.length}</strong>
          <span>{ui.statProviders}</span>
        </div>
        <div className="pc-stat-card">
          <strong>{connectedCount}</strong>
          <span>{ui.statConnected}</span>
        </div>
        <div className="pc-stat-card">
          <strong>{audit?.verifiedActiveModels ?? 0}</strong>
          <span>{ui.statModels}</span>
        </div>
      </div>

      <ProviderDiagnosticsBar
        locale={locale}
        getIdToken={getIdToken}
        onSelectProvider={(pid) => void openProvider(pid)}
      />

      <label className="pc-search-box">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder={ui.searchPh}
          aria-label={ui.searchPh}
          data-testid="input-pc-search"
        />
        {search && (
          <button
            type="button"
            className="pc-clear-btn"
            onClick={() => setSearch('')}
            aria-label={ui.cancel}
          >
            <X size={14} />
          </button>
        )}
      </label>

      <div className="pc-filter-strip" role="tablist">
        {(
          [
            ['all', ui.fAll],
            ['connected', ui.fConn],
            ['chat', ui.fChat],
            ['code', ui.fCode],
            ['image', ui.fImage],
            ['video', ui.fVideo],
            ['free_tier', ui.fFree],
            ['paid', ui.fPaid],
          ] as const
        ).map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={filter === k}
            className={`pc-filter-pill ${filter === k ? 'is-active' : ''}`}
            onClick={() => setFilter(k)}
          >
            {lbl}
          </button>
        ))}
      </div>

      {error && (
        <div className="pc-banner-err" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="pc-empty-box">
          <LoaderCircle className="loading-spinner" size={22} />
          <p>{ui.loading}</p>
        </div>
      ) : filteredProviders.length === 0 ? (
        <div className="pc-empty-box">
          <Layers size={24} />
          <p>{ui.emptySearch}</p>
        </div>
      ) : (
        <div className="pc-grid">
          {filteredProviders.map((provider) => (
            <button
              type="button"
              key={provider.id}
              className={`pc-card ${
                provider.connectionStatus === 'connected' ? 'is-connected' : ''
              }`}
              onClick={() => void openProvider(provider.id)}
              data-testid={`card-provider-${provider.id}`}
            >
              <div className="pc-card-head">
                <span className="pc-logo" aria-hidden="true">
                  {providerInitials(provider.name)}
                </span>
                <div className="pc-card-title-wrap">
                  <div className="pc-card-name-row">
                    <strong>{provider.name}</strong>
                    {provider.connectionDetails.verificationStatus ===
                      'verified_official' && (
                      <ShieldCheck size={14} className="pc-verified-dot" />
                    )}
                  </div>
                  <span className={`pc-status-badge is-${provider.connectionStatus}`}>
                    {statusText(provider.connectionStatus)}
                  </span>
                </div>
              </div>

              <p className="pc-card-desc">{provider.shortDescription}</p>

              <div className="pc-badge-row">
                {provider.capabilities.slice(0, 4).map((cap) => (
                  <span className="pc-cap-badge" key={cap}>
                    {capLabel(cap, isAr)}
                  </span>
                ))}
                {(provider.accessTypes.includes('free_tier') ||
                  provider.accessTypes.includes('free')) && (
                  <span className="pc-cap-badge is-free">{ui.fFree}</span>
                )}
              </div>

              {mode === 'advanced' && provider.connectionDetails.apiBaseUrl && (
                <code
                  dir="ltr"
                  style={{
                    fontSize: 10.5,
                    color: 'var(--app-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {provider.connectionDetails.apiBaseUrl}
                </code>
              )}

              <div className="pc-card-foot">
                <span>{ui.modelsCount(provider.modelCount)}</span>
                <span>{ui.keysCount(provider.keyCount, provider.maxKeys)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
