import { useEffect, useRef, useState } from 'react';
import { Copy, LoaderCircle, RefreshCw, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  confirmStoryProviderSwitch,
  regenerateStorySceneText,
  updateStorySceneText,
  type StoryImageRecord,
} from '@/lib/stories';

type StorySceneTextProps = {
  storyId: string;
  image: StoryImageRecord;
  getIdToken: () => Promise<string>;
};

const MOTION_SUFFIX = 'No distortion, no morphing face, no watermark, no text.';

function withMotionSuffix(value: string): string {
  const body = value.trim().replaceAll(MOTION_SUFFIX, '').trim().replace(/[. ]+$/u, '');
  return body ? `${body} ${MOTION_SUFFIX}` : MOTION_SUFFIX;
}

export default function StorySceneText({
  storyId,
  image,
  getIdToken,
}: StorySceneTextProps) {
  const { t } = useTranslation();
  const [motionPrompt, setMotionPrompt] = useState(image.motionPrompt);
  const [narration, setNarration] = useState(image.narration);
  const [negativeText, setNegativeText] = useState(image.negativeText);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmingProvider, setConfirmingProvider] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (dirtyRef.current) return;
    setMotionPrompt(image.motionPrompt);
    setNarration(image.narration);
    setNegativeText(image.negativeText);
  }, [image.id, image.motionPrompt, image.narration, image.negativeText]);

  const save = async () => {
    if (saving || !dirtyRef.current) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const savedText = await updateStorySceneText(
        storyId,
        image.id,
        {
          motionPrompt: withMotionSuffix(motionPrompt),
          narration: narration.replace(/[\r\n]+/gu, ' ').trim(),
          negativeText,
        },
        await getIdToken(),
      );
      setMotionPrompt(savedText.motionPrompt);
      setNarration(savedText.narration);
      setNegativeText(savedText.negativeText);
      dirtyRef.current = false;
      setStatus(t('stories.sceneTextSaved'));
    } catch {
      setError(t('stories.sceneTextSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    setError('');
    setStatus('');
    try {
      const copy = await regenerateStorySceneText(
        storyId,
        image.id,
        await getIdToken(),
      );
      setMotionPrompt(copy.motionPrompt);
      setNarration(copy.narration);
      dirtyRef.current = false;
      setStatus(t('stories.sceneTextRegenerated'));
    } catch {
      setError(t('stories.sceneTextRegenerateFailed'));
    } finally {
      setRegenerating(false);
    }
  };

  const copyText = async (value: string, label: string) => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      setStatus(label);
      setError('');
    } catch {
      setError(t('stories.clipboardUnavailable'));
    }
  };

  const approveProvider = async () => {
    if (confirmingProvider) return;
    setConfirmingProvider(true);
    setError('');
    setStatus('');
    try {
      await confirmStoryProviderSwitch(
        storyId,
        image.id,
        await getIdToken(),
      );
      dirtyRef.current = false;
      setStatus(t('stories.providerSwitchApproved'));
    } catch {
      setError(t('stories.providerSwitchFailed'));
    } finally {
      setConfirmingProvider(false);
    }
  };

  const updateText = (
    setter: (value: string) => void,
    value: string,
  ) => {
    dirtyRef.current = true;
    setStatus('');
    setError('');
    setter(value);
  };

  return (
    <div className="story-scene-text" data-testid={`story-scene-text-${image.index ?? image.id}`}>
      <label>
        <span>
          {t('stories.motionPrompt')}
          {image.motionPromptSource === 'template' && <small className="story-template-tag">{t('stories.template')}</small>}
        </span>
        <textarea
          value={motionPrompt}
          maxLength={500}
          rows={3}
          onChange={(event) => updateText(setMotionPrompt, event.currentTarget.value)}
          onBlur={() => void save()}
          aria-label={t('stories.motionPrompt')}
          data-testid={`input-motion-prompt-${image.index ?? image.id}`}
        />
      </label>
      <div className="story-scene-text-actions">
        <button type="button" onClick={() => void regenerate()} disabled={regenerating || saving} aria-busy={regenerating}>
          {regenerating
            ? <LoaderCircle className="loading-spinner" size={14} />
            : <RefreshCw size={14} />}
          {regenerating ? t('stories.regeneratingText') : t('stories.regenerateText')}
        </button>
        <button type="button" onClick={() => void copyText(motionPrompt, t('stories.motionPromptCopied'))} disabled={!motionPrompt}>
          <Copy size={14} />{t('stories.copyMotionPrompt')}
        </button>
      </div>

      <label>
        <span>
          {t('stories.narration')}
          {image.narrationSource === 'template' && <small className="story-template-tag">{t('stories.template')}</small>}
        </span>
        <textarea
          value={narration}
          maxLength={300}
          rows={2}
          onChange={(event) => updateText(setNarration, event.currentTarget.value)}
          onBlur={() => void save()}
          aria-label={t('stories.narration')}
          data-testid={`input-narration-${image.index ?? image.id}`}
        />
      </label>
      <div className="story-scene-text-actions">
        <button type="button" onClick={() => void copyText(narration, t('stories.narrationCopied'))} disabled={!narration}>
          <Copy size={14} />{t('stories.copyNarration')}
        </button>
        {dirtyRef.current && (
          <button type="button" onClick={() => void save()} disabled={saving} aria-busy={saving}>
            {saving ? <LoaderCircle className="loading-spinner" size={14} /> : <Save size={14} />}
            {saving ? t('stories.savingSceneText') : t('stories.saveSceneText')}
          </button>
        )}
      </div>

      <label>
        <span>{t('stories.negativeText')}</span>
        <input
          type="text"
          value={negativeText}
          maxLength={200}
          onChange={(event) => updateText(setNegativeText, event.currentTarget.value)}
          onBlur={() => void save()}
          placeholder={t('stories.negativeTextPlaceholder')}
          aria-label={t('stories.negativeText')}
          data-testid={`input-negative-text-${image.index ?? image.id}`}
        />
      </label>

      {image.error === 'provider_switch_pending' && image.suggestedProvider && (
        <div className="story-provider-switch" role="status">
          <span>{t('stories.providerSwitchPrompt', { provider: image.suggestedProvider })}</span>
          <button type="button" onClick={() => void approveProvider()} disabled={confirmingProvider} aria-busy={confirmingProvider}>
            {confirmingProvider && <LoaderCircle className="loading-spinner" size={14} />}
            {confirmingProvider ? t('stories.approvingProvider') : t('stories.approveProviderSwitch')}
          </button>
        </div>
      )}
      {error && <p className="story-scene-text-message is-error" role="alert">{error}</p>}
      {(status || saving) && (
        <p className="story-scene-text-message" role="status" aria-live="polite">
          {saving ? t('stories.savingSceneText') : status}
        </p>
      )}
    </div>
  );
}
