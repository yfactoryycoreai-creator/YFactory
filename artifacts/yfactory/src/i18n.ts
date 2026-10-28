import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const getInitialLanguage = () => {
  try {
    const savedLanguage =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('yfactory.locale')
        : null;
    return savedLanguage === 'ar' || savedLanguage === 'fr'
      ? savedLanguage
      : 'en';
  } catch {
    return 'en';
  }
};

const initialLanguage = getInitialLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: {
        tabs: { image: 'Image', video: 'Video', audio: 'Audio' },
        prompt: {
          image: 'Describe the image you want to generate...',
          video: 'Describe the video you want to generate...',
          audio: 'Enter the text you want the AI to speak...',
        },
        generate: {
          button: 'Generate',
          loading: 'Preparing audio...',
        },
        labels: {
          language: 'Language',
          settings: 'Settings',
          profile: 'Profile',
          prompt: 'Generation prompt',
          tabs: 'Media generation type',
          results: 'Generated results',
          duration: 'Duration',
          aspectRatio: 'Aspect Ratio',
          quality: 'Quality',
          voice: 'Voice',
          style: 'Style',
          play: 'Play audio preview',
          volume: 'Audio volume',
          upload: 'Upload a source image',
          characterCount: '{{count}}/{{max}}',
        },
        options: {
          video5: '5 seconds',
          video10: '10 seconds',
          video15: '15 seconds',
          audio30: '30 seconds',
          audio60: '60 seconds',
          audio90: '90 seconds',
          landscape: '16:9 (Landscape)',
          portrait: '9:16 (Portrait)',
          square: '1:1 (Square)',
          hd: 'HD (720p)',
          fullHd: 'Full HD (1080p)',
          uhd: '4K (2160p)',
          defaultVoice: 'Default Voice',
          warmVoice: 'Warm Voice',
          brightVoice: 'Bright Voice',
          natural: 'Natural',
          cinematic: 'Cinematic',
          energetic: 'Energetic',
        },
        empty: {
          video: 'Your generated video will appear here',
          audio: 'Your generated audio will appear here',
        },
        status: {
          image: 'Your image prompt is ready. Generation is a UI preview only.',
          video: 'Your video prompt is ready. Generation is a UI preview only.',
          audioReady: 'Sample audio is ready to play.',
          invalidImage: 'Please choose an image file.',
          profile: 'Profile menu is not available in this preview.',
        },
        upload: {
          title: 'Drag & Drop or Click to Upload Image',
          helper: 'PNG, JPG, or WEBP',
          selected: 'Image selected',
          replace: 'Click to replace image',
        },
        settings: {
          title: 'Settings',
          close: 'Close settings',
        },
        audio: {
          samplePlayer: 'Sample generated audio player',
          unsupported: 'Your browser does not support audio playback.',
        },
      },
    },
    fr: {
      translation: {
        tabs: { image: 'Image', video: 'Vidéo', audio: 'Audio' },
        prompt: {
          image: 'Décrivez l’image que vous souhaitez générer...',
          video: 'Décrivez la vidéo que vous souhaitez générer...',
          audio: 'Saisissez le texte que l’IA doit prononcer...',
        },
        generate: {
          button: 'Générer',
          loading: 'Préparation de l’audio...',
        },
        labels: {
          language: 'Langue',
          settings: 'Paramètres',
          profile: 'Profil',
          prompt: 'Prompt de génération',
          tabs: 'Type de média à générer',
          results: 'Résultats générés',
          duration: 'Durée',
          aspectRatio: 'Format',
          quality: 'Qualité',
          voice: 'Voix',
          style: 'Style',
          play: 'Lire l’aperçu audio',
          volume: 'Volume audio',
          upload: 'Importer une image source',
          characterCount: '{{count}}/{{max}}',
        },
        options: {
          video5: '5 secondes',
          video10: '10 secondes',
          video15: '15 secondes',
          audio30: '30 secondes',
          audio60: '60 secondes',
          audio90: '90 secondes',
          landscape: '16:9 (Paysage)',
          portrait: '9:16 (Portrait)',
          square: '1:1 (Carré)',
          hd: 'Haute définition (720p)',
          fullHd: 'Très haute définition (1080p)',
          uhd: '4K (2160p)',
          defaultVoice: 'Voix par défaut',
          warmVoice: 'Voix chaleureuse',
          brightVoice: 'Voix claire',
          natural: 'Naturel',
          cinematic: 'Cinématique',
          energetic: 'Énergique',
        },
        empty: {
          video: 'Votre vidéo générée apparaîtra ici',
          audio: 'Votre audio généré apparaîtra ici',
        },
        status: {
          image: 'Votre prompt image est prêt. La génération est une simple prévisualisation.',
          video: 'Votre prompt vidéo est prêt. La génération est une simple prévisualisation.',
          audioReady: 'L’audio de démonstration est prêt à être lu.',
          invalidImage: 'Veuillez choisir un fichier image.',
          profile: 'Le profil n’est pas disponible dans cet aperçu.',
        },
        upload: {
          title: 'Glissez-déposez ou cliquez pour importer une image',
          helper: 'PNG, JPG ou WEBP',
          selected: 'Image sélectionnée',
          replace: 'Cliquez pour remplacer l’image',
        },
        settings: {
          title: 'Paramètres',
          close: 'Fermer les paramètres',
        },
        audio: {
          samplePlayer: 'Lecteur audio de démonstration',
          unsupported: 'Votre navigateur ne prend pas en charge la lecture audio.',
        },
      },
    },
    ar: {
      translation: {
        tabs: { image: 'صورة', video: 'فيديو', audio: 'صوت' },
        prompt: {
          image: 'صِف الصورة التي تريد إنشاءها...',
          video: 'صِف الفيديو الذي تريد إنشاءه...',
          audio: 'أدخل النص الذي تريد أن ينطقه الذكاء الاصطناعي...',
        },
        generate: {
          button: 'إنشاء',
          loading: 'جارٍ تجهيز الصوت...',
        },
        labels: {
          language: 'اللغة',
          settings: 'الإعدادات',
          profile: 'الملف الشخصي',
          prompt: 'وصف الإنشاء',
          tabs: 'نوع الوسائط للإنشاء',
          results: 'النتائج المُنشأة',
          duration: 'المدة',
          aspectRatio: 'نسبة العرض',
          quality: 'الجودة',
          voice: 'الصوت',
          style: 'النمط',
          play: 'تشغيل معاينة الصوت',
          volume: 'مستوى الصوت',
          upload: 'تحميل صورة مصدر',
          characterCount: '{{count}}/{{max}}',
        },
        options: {
          video5: '٥ ثوانٍ',
          video10: '١٠ ثوانٍ',
          video15: '١٥ ثانية',
          audio30: '٣٠ ثانية',
          audio60: '٦٠ ثانية',
          audio90: '٩٠ ثانية',
          landscape: '16:9 (أفقي)',
          portrait: '9:16 (عمودي)',
          square: '1:1 (مربع)',
          hd: 'دقة عالية (720p)',
          fullHd: 'دقة عالية جدًا (1080p)',
          uhd: '4K (2160p)',
          defaultVoice: 'الصوت الافتراضي',
          warmVoice: 'صوت دافئ',
          brightVoice: 'صوت مشرق',
          natural: 'طبيعي',
          cinematic: 'سينمائي',
          energetic: 'حيوي',
        },
        empty: {
          video: 'سيظهر الفيديو الذي تم إنشاؤه هنا',
          audio: 'سيظهر الصوت الذي تم إنشاؤه هنا',
        },
        status: {
          image: 'وصف الصورة جاهز. الإنشاء هنا للمعاينة فقط.',
          video: 'وصف الفيديو جاهز. الإنشاء هنا للمعاينة فقط.',
          audioReady: 'الصوت التجريبي جاهز للتشغيل.',
          invalidImage: 'يرجى اختيار ملف صورة.',
          profile: 'الملف الشخصي غير متاح في هذه المعاينة.',
        },
        upload: {
          title: 'اسحب الصورة وأفلتها أو انقر لتحميلها',
          helper: 'PNG أو JPG أو WEBP',
          selected: 'تم اختيار الصورة',
          replace: 'انقر لاستبدال الصورة',
        },
        settings: {
          title: 'الإعدادات',
          close: 'إغلاق الإعدادات',
        },
        audio: {
          samplePlayer: 'مشغل الصوت التجريبي المُنشأ',
          unsupported: 'متصفحك لا يدعم تشغيل الصوت.',
        },
      },
    },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  supportedLngs: ['en', 'ar', 'fr'],
  interpolation: { escapeValue: false },
});

export default i18n;
