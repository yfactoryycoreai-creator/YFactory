import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Bell,
  Globe2,
  HardDrive,
  Info,
  LogOut,
  LockKeyhole,
  Moon,
  Sparkles,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
} from 'lucide-react';
import ConfirmActionDialog, {
  type ConfirmActionDialogHandle,
} from '@/components/confirm-action-dialog';
import LanguagePickerDialog from '@/components/language-picker-dialog';
import ProviderCenter from '@/components/provider-center';
import {
  loadKeyPoolStatus,
  loadProviders,
  loadStorageUsage,
  type KeyPoolProviderStatus,
} from '@/lib/apiKeyVault';
import {
  getNotificationAvailability,
  readAppTheme,
  readNotificationsEnabled,
  toggleAppNotifications,
  writeAppTheme,
  type AppTheme,
  type NotificationAvailability,
} from '@/lib/appPreferences';
import {
  readChatAutoNavigate,
  writeChatAutoNavigate,
} from '@/lib/chatAgent';
import {
  changeAppLanguage,
  findLanguageOption,
  isRtlLanguage,
} from '@/lib/languages';
import './auth-pages.css';

export type SettingsUser = {
  uid: string | null;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

export type SettingsPageProps = {
  user: SettingsUser;
  getIdToken?: () => Promise<string>;
  initialSubview?: 'api-keys' | null;
  initialModelTarget?: { provider: string; id: string } | null;
  onBack: () => void;
  onLogout: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

type ExtraSettingsCopy = {
  autoNavTitle: string;
  autoNavOn: string;
  autoNavOff: string;
  themeDark: string;
  themeLight: string;
  themeHintDark: string;
  themeHintLight: string;
  notifOn: string;
  notifOff: string;
  notifDenied: string;
  notifUnsupported: string;
  notifTestTitle: string;
  notifTestBody: string;
  aboutDetails: string;
  premiumDetails: string;
};

const EXTRA_SETTINGS_COPY: Record<string, ExtraSettingsCopy> = {
  ar: {
    autoNavTitle: `الانتقال التلقائي من الشات`,
    autoNavOn: `ينقلك تلقائياً لصفحة الصور أو قصصي عند تنفيذ الأمر`,
    autoNavOff: `تبقى داخل الشات أثناء التوليد والتنفيذ`,
    themeDark: `الوضع الداكن`,
    themeLight: `الوضع الفاتح`,
    themeHintDark: `مظهر داكن مريح مع لمسات ذهبية`,
    themeHintLight: `مظهر فاتح واضح للقراءة النهارية`,
    notifOn: `مفعّلة — تصلك تنبيهات عند اكتمال التوليد`,
    notifOff: `تنبيهك عند اكتمال توليد الصور والمشاهد`,
    notifDenied: `محظورة من إعدادات المتصفح`,
    notifUnsupported: `غير مدعومة في هذا المتصفح`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `تم تفعيل الإشعارات بنجاح.`,
    aboutDetails: `منصة ويب متكاملة لإنتاج القصص والصور والمحادثة بالذكاء الاصطناعي بنظام مفاتيح المستخدم المشفّرة (BYOK).`,
    premiumDetails: `تعمل المنصة حالياً بنظام BYOK (تضيف مفاتيحك الخاصة وتتحكم بتكلفتك مباشرةً). خطط الاشتراك والمزايا المتقدمة ستتوفر عند الإطلاق الرسمي.`,
  },
  fr: {
    autoNavTitle: `Navigation auto depuis le chat`,
    autoNavOn: `Ouvre Images ou Mes histoires lors d'une action`,
    autoNavOff: `Reste dans le chat pendant l'exécution`,
    themeDark: `Mode sombre`,
    themeLight: `Mode clair`,
    themeHintDark: `Interface sombre avec accents dorés`,
    themeHintLight: `Interface claire et lumineuse`,
    notifOn: `Activées — alertes à la fin des générations`,
    notifOff: `Être alerté quand vos images sont prêtes`,
    notifDenied: `Bloqué dans les paramètres du navigateur`,
    notifUnsupported: `Non pris en charge sur ce navigateur`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `Les notifications sont maintenant activées.`,
    aboutDetails: `Plateforme web unifiée pour le chat IA, les images et vos histoires avec gestion chiffrée de vos clés API (BYOK).`,
    premiumDetails: `YFactory fonctionne en mode BYOK avec vos propres clés API. Les formules avancées arriveront lors du lancement public.`,
  },
  es: {
    autoNavTitle: `Navegación auto desde Chat`,
    autoNavOn: `Abre Imagen o Mis historias al ejecutar acciones`,
    autoNavOff: `Permanecer en Chat durante la generación`,
    themeDark: `Modo oscuro`,
    themeLight: `Modo claro`,
    themeHintDark: `Tema oscuro elegante con detalles dorados`,
    themeHintLight: `Tema claro y nítido para el día`,
    notifOn: `Activadas — avisos al completar generaciones`,
    notifOff: `Recibe avisos cuando tus imágenes estén listas`,
    notifDenied: `Bloqueadas en el navegador`,
    notifUnsupported: `No compatible en este navegador`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `Las notificaciones están activadas.`,
    aboutDetails: `Plataforma web integrada de chat IA, imágenes e historias con almacenamiento cifrado de tus claves API (BYOK).`,
    premiumDetails: `YFactory funciona con tus propias claves API (BYOK). Los planes avanzados estarán disponibles en el lanzamiento público.`,
  },
  de: {
    autoNavTitle: `Auto-Wechsel aus dem Chat`,
    autoNavOn: `Öffnet Bild oder Meine Geschichten bei Aktionen`,
    autoNavOff: `Während der Generierung im Chat bleiben`,
    themeDark: `Dunkelmodus`,
    themeLight: `Hellmodus`,
    themeHintDark: `Dunkles Design mit goldenen Akzenten`,
    themeHintLight: `Helles Design für alle Seiten`,
    notifOn: `Aktiv — Benachrichtigung bei Fertigstellung`,
    notifOff: `Benachrichtigen, wenn Bilder fertig sind`,
    notifDenied: `In den Browsereinstellungen blockiert`,
    notifUnsupported: `In diesem Browser nicht unterstützt`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `Benachrichtigungen wurden aktiviert.`,
    aboutDetails: `Einheitliches Web-Studio für KI-Chat, Bildgenerierung und Story-Produktion mit verschlüsselten BYOK-Schlüsseln.`,
    premiumDetails: `YFactory nutzt deine eigenen API-Schlüssel (BYOK). Erweiterte Pläne folgen zum öffentlichen Start.`,
  },
  it: {
    autoNavTitle: `Navigazione auto dalla Chat`,
    autoNavOn: `Apre Immagine o Le mie storie all'esecuzione`,
    autoNavOff: `Resta nella Chat durante la generazione`,
    themeDark: `Modalità scura`,
    themeLight: `Modalità chiara`,
    themeHintDark: `Tema scuro con accenti dorati`,
    themeHintLight: `Tema chiaro per tutte le pagine`,
    notifOn: `Attive — avvisi al termine delle generazioni`,
    notifOff: `Avvisami quando le immagini sono pronte`,
    notifDenied: `Bloccate nelle impostazioni del browser`,
    notifUnsupported: `Non supportate su questo browser`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `Le notifiche sono state attivate.`,
    aboutDetails: `Studio web integrato per chat IA, immagini e storie con gestione cifrata delle tue chiavi API (BYOK).`,
    premiumDetails: `YFactory funziona in modalità BYOK con le tue chiavi API. I piani avanzati arriveranno al lancio pubblico.`,
  },
  pt: {
    autoNavTitle: `Navegação auto do Chat`,
    autoNavOn: `Abre Imagem ou Minhas histórias ao executar ações`,
    autoNavOff: `Permanecer no Chat durante a execução`,
    themeDark: `Modo escuro`,
    themeLight: `Modo claro`,
    themeHintDark: `Tema escuro com detalhes dourados`,
    themeHintLight: `Tema claro em todas as páginas`,
    notifOn: `Ativadas — alertas ao concluir gerações`,
    notifOff: `Avisar quando suas imagens estiverem prontas`,
    notifDenied: `Bloqueadas nas permissões do navegador`,
    notifUnsupported: `Não suportado neste navegador`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `Notificações ativadas com sucesso.`,
    aboutDetails: `Estúdio web unificado para chat IA, imagens e histórias com chaves API criptografadas do usuário (BYOK).`,
    premiumDetails: `O YFactory opera no modelo BYOK com suas próprias chaves API. Planos avançados chegarão no lançamento público.`,
  },
  tr: {
    autoNavTitle: `Sohbetten otomatik geçiş`,
    autoNavOn: `İşlemde Görsel veya Hikayelerim sayfasına geçer`,
    autoNavOff: `Üretim sırasında Sohbette kal`,
    themeDark: `Karanlık Mod`,
    themeLight: `Aydınlık Mod`,
    themeHintDark: `Altın vurgulu koyu çalışma alanı`,
    themeHintLight: `Tüm sayfalarda aydınlık görünüm`,
    notifOn: `Etkin — üretim tamamlandığında bildirim`,
    notifOff: `Görseller hazır olduğunda bildirim al`,
    notifDenied: `Tarayıcı izinlerinde engellendi`,
    notifUnsupported: `Bu tarayıcıda desteklenmiyor`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `Bildirimler etkinleştirildi.`,
    aboutDetails: `Şifreli kullanıcı API anahtarlarıyla (BYOK) çalışan birleşik yapay zeka sohbet, görsel ve hikaye stüdyosu.`,
    premiumDetails: `YFactory kendi API anahtarlarınızla (BYOK) çalışır. Gelişmiş paketler genel lansmanda sunulacaktır.`,
  },
  ru: {
    autoNavTitle: `Автопереход из чата`,
    autoNavOn: `Открывать Изображения или Истории при действии`,
    autoNavOff: `Оставаться в чате во время генерации`,
    themeDark: `Тёмная тема`,
    themeLight: `Светлая тема`,
    themeHintDark: `Тёмный интерфейс с золотыми акцентами`,
    themeHintLight: `Светлая тема на всех страницах`,
    notifOn: `Включены — уведомления о завершении`,
    notifOff: `Уведомлять, когда изображения готовы`,
    notifDenied: `Заблокировано в настройках браузера`,
    notifUnsupported: `Не поддерживается в этом браузере`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `Уведомления успешно включены.`,
    aboutDetails: `Единая веб-студия для ИИ-чата, изображений и историй с шифрованием ваших API-ключей (BYOK).`,
    premiumDetails: `YFactory работает по модели BYOK с вашими API-ключами. Расширенные тарифы появятся при запуске.`,
  },
  ur: {
    autoNavTitle: `چیٹ سے خودکار منتقلی`,
    autoNavOn: `عمل پر تصویر یا میری کہانیاں صفحہ خود کھولتا ہے`,
    autoNavOff: `تخلیق کے دوران چیٹ میں رہیں`,
    themeDark: `ڈارک موڈ`,
    themeLight: `لائٹ موڈ`,
    themeHintDark: `سنہری جھلک کے ساتھ تاریک تھیم`,
    themeHintLight: `تمام صفحات پر روشن لائٹ تھیم`,
    notifOn: `فعال — تخلیق مکمل ہونے پر اطلاع`,
    notifOff: `تصاویر تیار ہونے پر اطلاع حاصل کریں`,
    notifDenied: `براؤزر کی ترتیبات میں مسدود`,
    notifUnsupported: `اس براؤزر میں دستیاب نہیں`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `اطلاعات کامیابی سے فعال ہو گئیں۔`,
    aboutDetails: `انکرپٹڈ BYOK API کلیدوں کے ساتھ AI چیٹ، تصاویر اور کہانیوں کا مربوط ویب اسٹوڈیو۔`,
    premiumDetails: `YFactory فی الحال BYOK (آپ کی اپنی API کلیدوں) پر کام کرتا ہے۔ پریمیم پلانز جلد آئیں گے۔`,
  },
  fa: {
    autoNavTitle: `انتقال خودکار از گفتگو`,
    autoNavOn: `باز کردن خودکار تصویر یا داستان‌های من هنگام اجرا`,
    autoNavOff: `ماندن در گفتگو هنگام تولید`,
    themeDark: `حالت تاریک`,
    themeLight: `حالت روشن`,
    themeHintDark: `تم تاریک با جزئیات طلایی`,
    themeHintLight: `تم روشن و شفاف در همه صفحات`,
    notifOn: `فعال — هشدار پس از پایان تولید`,
    notifOff: `اطلاع‌رسانی هنگام آماده شدن تصاویر`,
    notifDenied: `در تنظیمات مرورگر مسدود شده`,
    notifUnsupported: `در این مرورگر پشتیبانی نمی‌شود`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `اعلان‌ها با موفقیت فعال شدند.`,
    aboutDetails: `استودیوی وب یکپارچه برای گفتگوی هوش مصنوعی، تصویرسازی و داستان‌نویسی با کلیدهای رمزنگاری‌شده (BYOK).`,
    premiumDetails: `YFactory با کلیدهای API شخصی شما (BYOK) کار می‌کند. طرح‌های ویژه هم‌زمان با انتشار عمومی ارائه می‌شوند.`,
  },
  'zh-cn': {
    autoNavTitle: `聊天自动跳转`,
    autoNavOn: `执行命令时自动跳转至图像或我的故事页面`,
    autoNavOff: `执行期间停留在聊天界面`,
    themeDark: `深色模式`,
    themeLight: `浅色模式`,
    themeHintDark: `深色界面配金色点缀`,
    themeHintLight: `全局明亮浅色主题`,
    notifOn: `已开启 — 生成完成时发送提醒`,
    notifOff: `图像或故事生成完成时提醒您`,
    notifDenied: `已在浏览器权限中被禁止`,
    notifUnsupported: `当前浏览器不支持通知`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `通知已成功开启。`,
    aboutDetails: `集成 AI 聊天、图像生成与故事创作的一体化平台，采用加密用户自带密钥 (BYOK) 架构。`,
    premiumDetails: `YFactory 当前采用 BYOK 模式，直接使用您的个人 API 密钥。订阅计划将在正式发布时推出。`,
  },
  'zh-tw': {
    autoNavTitle: `聊天自動跳轉`,
    autoNavOn: `執行指令時自動跳轉至圖片或我的故事頁面`,
    autoNavOff: `執行期間停留在聊天畫面`,
    themeDark: `深色模式`,
    themeLight: `淺色模式`,
    themeHintDark: `深色介面搭配金色點綴`,
    themeHintLight: `全站明亮淺色主題`,
    notifOn: `已開啟 — 生成完成時傳送提醒`,
    notifOff: `圖片或故事生成完成時提醒您`,
    notifDenied: `已在瀏覽器權限中被封鎖`,
    notifUnsupported: `此瀏覽器不支援通知`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `通知已成功開啟。`,
    aboutDetails: `整合 AI 聊天、圖片生成與故事創作的一體化平台，採用加密使用者自備金鑰 (BYOK) 架構。`,
    premiumDetails: `YFactory 目前採用 BYOK 模式，直接使用您的個人 API 金鑰。訂閱方案將於正式發布時推出。`,
  },
  ja: {
    autoNavTitle: `チャットから自動移動`,
    autoNavOn: `実行時に画像またはマイストーリー画面へ移動`,
    autoNavOff: `生成中もチャット画面にとどまる`,
    themeDark: `ダークモード`,
    themeLight: `ライトモード`,
    themeHintDark: `ゴールドアクセントのダークテーマ`,
    themeHintLight: `全ページ対応の明るいライトテーマ`,
    notifOn: `有効 — 生成完了時に通知`,
    notifOff: `画像やシーンの完成時に通知する`,
    notifDenied: `ブラウザ設定でブロックされています`,
    notifUnsupported: `このブラウザでは非対応です`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `通知が有効になりました。`,
    aboutDetails: `暗号化された BYOK API キーで動作する、AI チャット・画像生成・ストーリー制作の統合スタジオです。`,
    premiumDetails: `YFactory はご自身の API キー（BYOK）で利用できます。プレミアムプランは正式公開時に提供予定です。`,
  },
  ko: {
    autoNavTitle: `채팅에서 자동 이동`,
    autoNavOn: `작업 실행 시 이미지 또는 내 스토리로 이동`,
    autoNavOff: `생성 중에도 채팅 화면 유지`,
    themeDark: `다크 모드`,
    themeLight: `라이트 모드`,
    themeHintDark: `골드 포인트가 있는 다크 테마`,
    themeHintLight: `모든 페이지에 적용되는 밝은 테마`,
    notifOn: `켜짐 — 생성 완료 시 알림`,
    notifOff: `이미지나 장면이 완성되면 알림 받기`,
    notifDenied: `브라우저 권한에서 차단됨`,
    notifUnsupported: `이 브라우저에서는 지원되지 않음`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `알림이 활성화되었습니다.`,
    aboutDetails: `암호화된 BYOK API 키로 동작하는 통합 AI 채팅·이미지·스토리 웹 스튜디오입니다.`,
    premiumDetails: `YFactory는 개인 API 키(BYOK)로 작동합니다. 프리미엄 요금제는 정식 출시와 함께 제공됩니다.`,
  },
  hi: {
    autoNavTitle: `चैट से ऑटो-नेविगेट`,
    autoNavOn: `कार्य चलने पर छवि या मेरी कहानियाँ पेज खोलें`,
    autoNavOff: `निर्माण के दौरान चैट में ही रहें`,
    themeDark: `डार्क मोड`,
    themeLight: `लाइट मोड`,
    themeHintDark: `गोल्ड एक्सेंट के साथ डार्क थीम`,
    themeHintLight: `सभी पेजों के लिए उज्ज्वल लाइट थीम`,
    notifOn: `सक्षम — निर्माण पूर्ण होने पर सूचना`,
    notifOff: `छवियाँ तैयार होने पर सूचित करें`,
    notifDenied: `ब्राउज़र अनुमतियों में अवरुद्ध`,
    notifUnsupported: `इस ब्राउज़र में समर्थित नहीं`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `सूचनाएँ सफलतापूर्वक सक्षम हो गईं।`,
    aboutDetails: `एन्क्रिप्टेड BYOK API कुंजियों के साथ AI चैट, छवि निर्माण और कहानी उत्पादन का एकीकृत वेब स्टूडियो।`,
    premiumDetails: `YFactory आपकी स्वयं की API कुंजियों (BYOK) पर चलता है। प्रीमियम प्लान आधिकारिक लॉन्च पर आएंगे।`,
  },
  id: {
    autoNavTitle: `Navigasi otomatis dari Obrolan`,
    autoNavOn: `Buka halaman Gambar atau Cerita Saya saat aksi berjalan`,
    autoNavOff: `Tetap di dalam Obrolan selama proses`,
    themeDark: `Mode Gelap`,
    themeLight: `Mode Terang`,
    themeHintDark: `Tema gelap elegan dengan aksen emas`,
    themeHintLight: `Tema terang bersih di semua halaman`,
    notifOn: `Aktif — beri tahu saat pembuatan selesai`,
    notifOff: `Beri tahu saat gambar atau adegan selesai`,
    notifDenied: `Diblokir di izin browser`,
    notifUnsupported: `Tidak didukung di browser ini`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `Notifikasi berhasil diaktifkan.`,
    aboutDetails: `Studio web terpadu untuk obrolan AI, pembuatan gambar, dan produksi cerita dengan kunci API BYOK terenkripsi.`,
    premiumDetails: `YFactory berjalan dengan kunci API Anda sendiri (BYOK). Paket premium akan hadir saat peluncuran publik.`,
  },
  bn: {
    autoNavTitle: `চ্যাট থেকে অটো-নেভিগেট`,
    autoNavOn: `অ্যাকশন চললে ছবি বা আমার গল্প পেজে যান`,
    autoNavOff: `তৈরি চলার সময় চ্যাটেই থাকুন`,
    themeDark: `ডার্ক মোড`,
    themeLight: `লাইট মোড`,
    themeHintDark: `সোনালি অ্যাকসেন্টসহ ডার্ক থিম`,
    themeHintLight: `সব পেজের জন্য উজ্জ্বল লাইট থিম`,
    notifOn: `চালু — তৈরি শেষ হলে নোটিফিকেশন`,
    notifOff: `ছবি বা দৃশ্য তৈরি হলে জানান`,
    notifDenied: `ব্রাউজার অনুমতিতে ব্লক করা`,
    notifUnsupported: `এই ব্রাউজারে সমর্থিত নয়`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `নোটিফিকেশন সফলভাবে চালু হয়েছে।`,
    aboutDetails: `এনক্রিপ্টেড BYOK API কী-সহ AI চ্যাট, ছবি তৈরি ও গল্প নির্মাণের সমন্বিত ওয়েব স্টুডিও।`,
    premiumDetails: `YFactory আপনার নিজস্ব API কী (BYOK) দিয়ে চলে। প্রিমিয়াম প্ল্যান পাবলিক লঞ্চে আসবে।`,
  },
  en: {
    autoNavTitle: `Auto-navigate from Chat`,
    autoNavOn: `Jump to Image or My Stories when Chat runs an action`,
    autoNavOff: `Stay inside Chat while actions run`,
    themeDark: `Dark Mode`,
    themeLight: `Light Mode`,
    themeHintDark: `Dark workspace with gold accents`,
    themeHintLight: `Bright light theme across all pages`,
    notifOn: `Enabled — alerts when generations finish`,
    notifOff: `Notify when image or story generation completes`,
    notifDenied: `Blocked in browser permissions`,
    notifUnsupported: `Unsupported in this browser`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `Notifications are now enabled.`,
    aboutDetails: `Unified web studio for AI chat, image generation, and story production powered by encrypted BYOK user API keys.`,
    premiumDetails: `YFactory runs on BYOK (bring your own API keys). Subscription plans and expanded key slots will launch with the public release.`,
  },
};

function getExtraSettingsCopy(lang: string): ExtraSettingsCopy {
  const lower = lang.trim().toLowerCase();
  const base = lower.split('-')[0] ?? 'en';
  return EXTRA_SETTINGS_COPY[lower] ?? EXTRA_SETTINGS_COPY[base] ?? EXTRA_SETTINGS_COPY.en!;
}

export default function SettingsPage({
  user,
  getIdToken,
  initialSubview = null,
  initialModelTarget = null,
  onBack,
  onLogout,
  onDeleteAccount,
}: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const isRtl = isRtlLanguage(locale);
  const currentLang = findLanguageOption(locale);
  const extraCopy = getExtraSettingsCopy(locale);

  const [storageUsage, setStorageUsage] = useState<{
    configured: boolean;
    usedBytes: number | null;
    limitBytes: number | null;
  } | null>(null);
  const [storageUsageError, setStorageUsageError] = useState('');
  const [keyPoolStatus, setKeyPoolStatus] = useState<KeyPoolProviderStatus[] | null>(null);
  const [keyPoolStatusError, setKeyPoolStatusError] = useState('');
  const [cloudinaryEnabled, setCloudinaryEnabled] = useState(true);
  const [chatAutoNavigate, setChatAutoNavigate] = useState<boolean>(readChatAutoNavigate);
  const [theme, setTheme] = useState<AppTheme>(readAppTheme);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(readNotificationsEnabled);
  const [notifStatus, setNotifStatus] = useState<NotificationAvailability>(getNotificationAvailability);
  const [notifBusy, setNotifBusy] = useState(false);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [settingsSubview, setSettingsSubview] = useState<'about' | 'premium' | 'api-keys' | null>(initialSubview);

  const signOutDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const deleteAccountDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const displayName = user.displayName || user.email || t('settings.creator');
  const initials = (user.displayName || user.email || 'Y')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const toggleChatAutoNavigate = () => {
    setChatAutoNavigate((current) => {
      const next = !current;
      writeChatAutoNavigate(next);
      return next;
    });
  };

  const handleToggleTheme = () => {
    setTheme((current) => {
      const next: AppTheme = current === 'dark' ? 'light' : 'dark';
      writeAppTheme(next);
      return next;
    });
  };

  const handleToggleNotifications = async () => {
    if (notifBusy || notifStatus === 'unsupported') return;
    setNotifBusy(true);
    try {
      const result = await toggleAppNotifications(!notificationsEnabled, {
        title: extraCopy.notifTestTitle,
        body: extraCopy.notifTestBody,
      });
      setNotificationsEnabled(result.enabled);
      setNotifStatus(result.status);
    } finally {
      setNotifBusy(false);
    }
  };

  useEffect(() => {
    if (!getIdToken) {
      setKeyPoolStatusError(t('settings.keyPoolLoadFailed'));
      return;
    }
    let active = true;
    void (async () => {
      try {
        const token = await getIdToken();
        const [providersResult, usageResult, keyStatusResult] = await Promise.allSettled([
          loadProviders(token),
          loadStorageUsage(token),
          loadKeyPoolStatus(token),
        ]);
        if (!active) return;
        if (providersResult.status === 'fulfilled') {
          setCloudinaryEnabled(
            providersResult.value.some((provider) => provider.id === 'cloudinary' && provider.enabled),
          );
        }
        if (keyStatusResult.status === 'fulfilled') {
          setKeyPoolStatus(keyStatusResult.value);
          setKeyPoolStatusError('');
        } else {
          setKeyPoolStatus(null);
          setKeyPoolStatusError(t('settings.keyPoolLoadFailed'));
        }
        if (usageResult.status === 'rejected') {
          setStorageUsage(null);
          setStorageUsageError(t('settings.storageLoadFailed'));
          return;
        }
        setStorageUsage(usageResult.value);
        setStorageUsageError('');
      } catch {
        if (active) {
          setStorageUsageError(t('settings.storageLoadFailed'));
          setKeyPoolStatusError(t('settings.keyPoolLoadFailed'));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [getIdToken, t]);

  if (settingsSubview === 'api-keys') {
    return (
      <main className="auth-screen settings-screen" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="settings-shell">
          <header className="settings-topbar">
            <button
              className="settings-back"
              type="button"
              onClick={() => setSettingsSubview(null)}
              data-testid="button-secrets-back"
            >
              <ArrowLeft size={17} aria-hidden="true" />
              <span>{t('settings.backToSettings')}</span>
            </button>
            <div className="settings-brand" aria-label="YFactory">
              <span className="settings-brand-mark">Y</span>
              <span>YFactory</span>
            </div>
            <span className="settings-back-spacer" aria-hidden="true" />
          </header>
          <div className="settings-content api-keys-page-content">
            <ProviderCenter
              userId={user.uid}
              getIdToken={getIdToken}
              initialModelTarget={initialModelTarget}
            />
          </div>
        </div>
      </main>
    );
  }

  if (settingsSubview === 'about' || settingsSubview === 'premium') {
    const isPremium = settingsSubview === 'premium';
    return (
      <main className="auth-screen settings-screen" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="settings-shell">
          <header className="settings-topbar">
            <button
              className="settings-back"
              type="button"
              onClick={() => setSettingsSubview(null)}
              data-testid="button-settings-subpage-back"
            >
              <ArrowLeft size={17} aria-hidden="true" />
              <span>{t('settings.backToSettings')}</span>
            </button>
            <div className="settings-brand" aria-label="YFactory">
              <span className="settings-brand-mark">Y</span>
              <span>YFactory</span>
            </div>
            <span className="settings-back-spacer" aria-hidden="true" />
          </header>
          <section className="settings-info-card" data-testid={`settings-info-${settingsSubview}`}>
            <span className="settings-info-icon" aria-hidden="true">
              {isPremium ? <Sparkles size={24} /> : <Info size={24} />}
            </span>
            <h1>{isPremium ? t('settings.premiumFeatures') : t('settings.aboutYFactory')}</h1>
            <p>{isPremium ? extraCopy.premiumDetails : extraCopy.aboutDetails}</p>
            <span className="settings-status-pill">
              {isPremium ? t('settings.comingSoon') : 'YFactory AI · Web Studio'}
            </span>
          </section>
        </div>
      </main>
    );
  }

  const notifHint =
    notifStatus === 'unsupported'
      ? extraCopy.notifUnsupported
      : notifStatus === 'denied'
        ? extraCopy.notifDenied
        : notificationsEnabled
          ? extraCopy.notifOn
          : extraCopy.notifOff;

  return (
    <main className="auth-screen settings-screen" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="settings-shell">
        <header className="settings-topbar">
          <button className="settings-back" type="button" onClick={onBack} data-testid="button-settings-back">
            <ArrowLeft size={17} aria-hidden="true" />
            <span>{t('settings.backToDashboard')}</span>
          </button>
          <div className="settings-brand" aria-label="YFactory">
            <span className="settings-brand-mark">Y</span>
            <span>YFactory</span>
          </div>
          <button
            className="settings-logout"
            type="button"
            onClick={() => signOutDialogRef.current?.open()}
            data-testid="button-settings-logout"
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{t('settings.logout')}</span>
          </button>
        </header>

        <div className="settings-content">
          <div className="settings-heading">
            <div>
              <div className="settings-eyebrow"><span /> {t('settings.accountEyebrow')}</div>
              <h1>{t('settings.title')}</h1>
              <p>{t('settings.subtitle')}</p>
            </div>
            <button className="settings-mobile-back" type="button" onClick={onBack} aria-label={t('settings.backToDashboard')} data-testid="button-settings-mobile-back">
              <ArrowLeft size={18} />
            </button>
          </div>

          <section className="account-panel" aria-labelledby="account-title">
            <div className="section-kicker">{t('settings.account')}</div>
            <div className="account-info">
              {user.photoURL ? (
                <img className="account-avatar" src={user.photoURL} alt="" loading="lazy" data-testid="img-account-avatar" />
              ) : (
                <div className="account-avatar account-avatar-fallback" aria-hidden="true">
                  {initials || <UserRound size={21} />}
                </div>
              )}
              <div className="account-copy">
                <h2 id="account-title" data-testid="text-account-name">{displayName}</h2>
                {user.email && <p data-testid="text-account-email">{user.email}</p>}
              </div>
              <span className="account-verified"><ShieldCheck size={15} /> <span>{t('settings.signedIn')}</span></span>
            </div>
          </section>

          <section className="settings-preferences-panel" aria-label={t('settings.language')}>
            <div className="settings-preference-row">
              <div className="settings-preference-copy">
                <Globe2 size={19} aria-hidden="true" />
                <strong>{t('settings.language')}</strong>
              </div>
              <button
                type="button"
                className="settings-language-trigger"
                onClick={() => setLanguagePickerOpen(true)}
                aria-haspopup="dialog"
                data-testid="select-language"
              >
                <span dir="auto">{currentLang.nativeName}</span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </div>
          </section>

          <section className="settings-preferences-panel" aria-label={t('settings.apiKeysTitle')}>
            <button
              className="settings-preference-link settings-secrets-link"
              type="button"
              onClick={() => setSettingsSubview('api-keys')}
              data-testid="button-open-api-keys"
            >
              <span className="settings-preference-copy">
                <LockKeyhole size={19} aria-hidden="true" />
                <span className="settings-secrets-link-copy">
                  <strong>{t('settings.apiKeysTitle')}</strong>
                  <small>{t('settings.apiKeysEntryDescription')}</small>
                </span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </section>

          <section className="settings-preferences-panel" aria-label={t('settings.preferences')}>
            <div className="settings-preference-row">
              <div className="settings-preference-copy">
                <ArrowUpRight size={19} aria-hidden="true" />
                <span className="settings-secrets-link-copy">
                  <strong>{extraCopy.autoNavTitle}</strong>
                  <small>
                    {chatAutoNavigate ? extraCopy.autoNavOn : extraCopy.autoNavOff}
                  </small>
                </span>
              </div>
              <div className="settings-preference-state">
                <button
                  type="button"
                  className={chatAutoNavigate ? 'settings-switch is-on' : 'settings-switch'}
                  role="switch"
                  aria-checked={chatAutoNavigate}
                  aria-label={extraCopy.autoNavTitle}
                  onClick={toggleChatAutoNavigate}
                  data-testid="toggle-chat-auto-navigate"
                >
                  <span />
                </button>
              </div>
            </div>

            <div className="settings-preference-row">
              <div className="settings-preference-copy">
                <Bell size={19} aria-hidden="true" />
                <span className="settings-secrets-link-copy">
                  <strong>{t('settings.notifications')}</strong>
                  <small>{notifHint}</small>
                </span>
              </div>
              <div className="settings-preference-state">
                <button
                  type="button"
                  className={notificationsEnabled ? 'settings-switch is-on' : 'settings-switch'}
                  role="switch"
                  aria-checked={notificationsEnabled}
                  aria-label={t('settings.notifications')}
                  disabled={notifBusy || notifStatus === 'unsupported'}
                  onClick={() => void handleToggleNotifications()}
                  data-testid="toggle-notifications"
                >
                  <span />
                </button>
              </div>
            </div>

            <div className="settings-preference-row">
              <div className="settings-preference-copy">
                {theme === 'dark' ? (
                  <Moon size={19} aria-hidden="true" />
                ) : (
                  <Sun size={19} aria-hidden="true" />
                )}
                <span className="settings-secrets-link-copy">
                  <strong>
                    {theme === 'dark' ? extraCopy.themeDark : extraCopy.themeLight}
                  </strong>
                  <small>
                    {theme === 'dark' ? extraCopy.themeHintDark : extraCopy.themeHintLight}
                  </small>
                </span>
              </div>
              <div className="settings-preference-state">
                <button
                  type="button"
                  className={theme === 'dark' ? 'settings-switch is-on' : 'settings-switch'}
                  role="switch"
                  aria-checked={theme === 'dark'}
                  aria-label={t('settings.darkMode')}
                  onClick={handleToggleTheme}
                  data-testid="toggle-dark-mode"
                >
                  <span />
                </button>
              </div>
            </div>

            <button
              className="settings-preference-link"
              type="button"
              onClick={() => setSettingsSubview('about')}
              data-testid="button-about-yfactory"
            >
              <span className="settings-preference-copy">
                <Info size={19} aria-hidden="true" />
                <strong>{t('settings.aboutYFactory')}</strong>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button
              className="settings-preference-link"
              type="button"
              onClick={() => setSettingsSubview('premium')}
              data-testid="button-premium-features"
            >
              <span className="settings-preference-copy">
                <Sparkles size={19} aria-hidden="true" />
                <strong>{t('settings.premiumFeatures')}</strong>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </section>

          <details className="account-panel key-pool-status-panel" data-testid="key-pool-status-panel" hidden>
            <summary className="key-pool-status-summary">
              <h2>{t('settings.keyPoolTitle')}</h2>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <div className="key-pool-status-content">
              {keyPoolStatusError ? (
                <p className="settings-inline-error" role="status">{keyPoolStatusError}</p>
              ) : !keyPoolStatus ? (
                <p role="status">{t('settings.keyPoolLoading')}</p>
              ) : keyPoolStatus.filter((provider) => provider.credentialCount > 0).length === 0 ? (
                <p>{t('settings.keyPoolEmpty')}</p>
              ) : (
                <div className="key-pool-provider-list">
                  {keyPoolStatus.filter((provider) => provider.credentialCount > 0).map((provider) => (
                  <div className="key-pool-provider" key={provider.provider}>
                    <div className="key-pool-provider-heading">
                      <strong>{t(`settings.keyPoolProviders.${provider.provider}`)}</strong>
                      <span>{t('settings.keyPoolCount', { count: provider.credentialCount })}</span>
                    </div>
                    {provider.credentials.length > 0 && (
                      <ul>
                        {provider.credentials.map((credential) => (
                          <li key={`${provider.provider}-${credential.index}`}>
                            <span>{t('settings.keyPoolIndex', { index: credential.index })}</span>
                            <span>
                              {credential.state === 'ready'
                                ? t('settings.statusReady')
                                : credential.state === 'disabled'
                                  ? t('settings.statusDisabled')
                                  : t('settings.keyPoolCooldownUntil', {
                                      time: typeof credential.until === 'number'
                                        ? new Date(credential.until).toLocaleString(locale)
                                        : '—',
                                    })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  ))}
                </div>
              )}
            </div>
          </details>
          <section className="account-panel storage-usage-panel" aria-labelledby="cloudinary-usage-title">
            <div className="section-kicker"><HardDrive size={14} /> {t('settings.cloudinaryStorage')}</div>
            <h2 id="cloudinary-usage-title">{t('settings.storageUsage')}</h2>
            {!storageUsage && storageUsageError ? (
              <p className="settings-inline-error">{storageUsageError}</p>
            ) : !cloudinaryEnabled ? (
              <p>{t('settings.storageDisabled')}</p>
            ) : storageUsage && !storageUsage.configured ? (
              <p>{t('settings.storageCredentialsMissing')}</p>
            ) : storageUsage?.configured && storageUsage.usedBytes !== null && storageUsage.limitBytes !== null ? (
              <>
                <div className="storage-usage-copy">
                  <span>{formatBytes(storageUsage.usedBytes)} {t('settings.storageUsed')}</span>
                  <span>{formatBytes(storageUsage.limitBytes)} {t('settings.storageLimit')}</span>
                </div>
                <div className="factory-storage-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) * 100))}>
                  <span className={storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) >= 0.8 ? 'storage-warning' : ''} style={{ width: `${Math.min(100, storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) * 100)}%` }} />
                </div>
                {storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) >= 0.8 && <p className="settings-inline-warning">{t('settings.storageWarning')}</p>}
              </>
            ) : (
              <p>{t('settings.storageUsageUnavailable')}</p>
            )}
          </section>
          <section className="danger-zone" aria-labelledby="danger-zone-title">
            <div>
              <h2 id="danger-zone-title">{t('settings.dangerZone')}</h2>
              <p>{t('settings.deleteAccountDescription')}</p>
            </div>
            <button
              className="settings-delete-account"
              type="button"
              onClick={() => deleteAccountDialogRef.current?.open()}
              data-testid="button-delete-account"
            >
              <Trash2 size={16} aria-hidden="true" />
              <span>{t('settings.deleteAccount')}</span>
            </button>
          </section>
        </div>
        <footer className="settings-footer">
          <span>YFactory</span>
          <span className="footer-separator" />
          <span>{t('settings.creatorWorkspace')}</span>
        </footer>
      </div>

      <LanguagePickerDialog
        open={languagePickerOpen}
        currentCode={currentLang.code}
        onClose={() => setLanguagePickerOpen(false)}
        onSelect={(lang) => changeAppLanguage(lang.code)}
      />

      <ConfirmActionDialog
        ref={signOutDialogRef}
        title={t('confirmation.signOutTitle')}
        description={t('confirmation.logoutDescription')}
        confirmLabel={t('confirmation.signOut')}
        busyLabel={t('confirmation.loggingOut')}
        cancelLabel={t('confirmation.cancel')}
        failureMessage={t('confirmation.logoutFailed')}
        onConfirm={onLogout}
        dir={isRtl ? 'rtl' : 'ltr'}
      />
      <ConfirmActionDialog
        ref={deleteAccountDialogRef}
        title={t('confirmation.deleteTitle')}
        description={t('confirmation.deleteDescription')}
        confirmLabel={t('confirmation.deleteConfirm')}
        busyLabel={t('confirmation.deleting')}
        cancelLabel={t('confirmation.cancel')}
        failureMessage={t('confirmation.deleteFailed')}
        recentLoginMessage={t('confirmation.recentLogin')}
        onConfirm={onDeleteAccount}
        danger
        confirmationPhrase="DELETE"
        confirmationPhraseLabel={t('confirmation.typeDelete')}
        dir={isRtl ? 'rtl' : 'ltr'}
      />
    </main>
  );
}
