import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  updateStorySettings,
  type StoryAspectRatio,
  type StoryRecord,
} from '@/lib/stories';

type StorySettingsPanelProps = {
  story: StoryRecord;
  getIdToken: () => Promise<string>;
};

const ratios: StoryAspectRatio[] = ['16:9', '9:16', '1:1'];

export default function StorySettingsPanel({
  story,
  getIdToken,
}: StorySettingsPanelProps) {
  const { t } = useTranslation();
  const [aspectRatio, setAspectRatio] = useState<StoryAspectRatio>(story.aspectRatio);
  const [traits, setTraits] = useState<[string, string, string]>([
    story.characterTraits[0] ?? '',
    story.characterTraits[1] ?? '',
    story.characterTraits[2] ?? '',
  ]);
  const [keepOneProvider, setKeepOneProvider] = useState(story.keepOneProvider);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (dirtyRef.current) return;
    setAspectRatio(story.aspectRatio);
    setTraits([
      story.characterTraits[0] ?? '',
      story.characterTraits[1] ?? '',
      story.characterTraits[2] ?? '',
    ]);
    setKeepOneProvider(story.keepOneProvider);
  }, [story.id, story.aspectRatio, story.characterTraits, story.keepOneProvider]);

  const markDirty = () => {
    dirtyRef.current = true;
    setSaved(false);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await updateStorySettings(
        story.id,
        {
          aspectRatio,
          characterTraits: traits.map((trait) => trait.trim()).filter(Boolean),
          keepOneProvider,
        },
        await getIdToken(),
      );
      dirtyRef.current = false;
      setSaved(true);
    } catch {
      setError(t('stories.settingsSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="story-settings-panel" aria-labelledby="story-settings-title">
      <div className="story-settings-heading">
        <div>
          <h2 id="story-settings-title">{t('stories.storySettings')}</h2>
          <p>{t('stories.storySettingsSubtitle')}</p>
        </div>
        <button
          className="factory-quiet-button"
          type="button"
          onClick={() => void save()}
          disabled={saving}
          aria-busy={saving}
          data-testid="button-save-story-settings"
        >
          {saving ? <LoaderCircle className="loading-spinner" size={15} /> : <Save size={15} />}
          {saving ? t('stories.savingSettings') : t('stories.saveSettings')}
        </button>
      </div>

      <fieldset className="story-setting-fieldset">
        <legend>{t('stories.aspectRatio')}</legend>
        <div className="story-ratio-options">
          {ratios.map((ratio) => (
            <button
              key={ratio}
              className={aspectRatio === ratio ? 'story-target-preset is-active' : 'story-target-preset'}
              type="button"
              aria-pressed={aspectRatio === ratio}
              onClick={() => {
                markDirty();
                setAspectRatio(ratio);
              }}
              data-testid={`button-story-ratio-${ratio.replace(':', '-')}`}
            >
              {ratio}
            </button>
          ))}
        </div>
        <small>{t('stories.aspectRatioNotApplied')}</small>
      </fieldset>

      <fieldset className="story-setting-fieldset">
        <legend>{t('stories.characterTraits')}</legend>
        <div className="story-character-fields">
          {traits.map((trait, index) => (
            <input
              key={index}
              type="text"
              maxLength={80}
              value={trait}
              onChange={(event) => {
                const next = [...traits] as [string, string, string];
                next[index] = event.currentTarget.value;
                markDirty();
                setTraits(next);
              }}
              placeholder={t('stories.characterTraitPlaceholder', { index: index + 1 })}
              aria-label={t('stories.characterTraitLabel', { index: index + 1 })}
              data-testid={`input-story-character-trait-${index + 1}`}
            />
          ))}
        </div>
        <small>{t('stories.characterTraitsHint')}</small>
      </fieldset>

      <label className="story-provider-lock">
        <input
          type="checkbox"
          checked={keepOneProvider}
          onChange={(event) => {
            markDirty();
            setKeepOneProvider(event.currentTarget.checked);
          }}
          data-testid="toggle-story-provider-lock"
        />
        <span>
          <strong>{t('stories.keepOneProvider')}</strong>
          <small>{t('stories.keepOneProviderHint')}</small>
          {keepOneProvider && story.lockedProvider && (
            <small>{t('stories.providerLockedTo', { provider: story.lockedProvider })}</small>
          )}
        </span>
      </label>

      {error && <p className="story-settings-error" role="alert">{error}</p>}
      {dirtyRef.current && !saved && !error && (
        <p className="story-settings-saved" role="status">{t('stories.settingsUnsaved')}</p>
      )}
      {saved && <p className="story-settings-saved" role="status">{t('stories.settingsSaved')}</p>}
    </section>
  );
}
