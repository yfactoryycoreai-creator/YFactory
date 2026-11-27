import { useState } from 'react';
import CodeIdeDashboard from '@/components/code-ide-dashboard';
import { WorkspaceSkillsBar } from '@/components/skills-hub-modal';
import StudentsWorkspace from '@/components/students-workspace';
import { buildSkillsSystemDirective, type SkillScope } from '@/lib/skillsStore';

export type SectionHubProps = {
  locale: string;
  getIdToken?: () => Promise<string>;
  onOpenProviderCenter: (providerId?: string) => void;
  onOpenChat: () => void;
  onOpenSkills?: (scope?: SkillScope) => void;
};

export function CodeSectionHub({
  locale,
  getIdToken,
  onOpenProviderCenter,
  onOpenChat,
  onOpenSkills,
}: SectionHubProps) {
  const [copiedCodeSkills, setCopiedCodeSkills] = useState(false);

  const handleCopyCodeSkills = async () => {
    const directive = buildSkillsSystemDirective('code');
    if (!directive) return;
    try {
      await navigator.clipboard.writeText(directive);
      setCopiedCodeSkills(true);
      window.setTimeout(() => setCopiedCodeSkills(false), 2000);
    } catch {
      // ignore clipboard restriction
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: 960, margin: '0 auto' }}>
      <WorkspaceSkillsBar
        scope="code"
        locale={locale}
        getIdToken={getIdToken}
        onOpenHub={onOpenSkills}
        extraAction={{
          label: copiedCodeSkills
            ? locale.startsWith('ar')
              ? 'تم النسخ للـ IDE!'
              : 'Copied for IDE!'
            : locale.startsWith('ar')
              ? 'نسخ مهارات البرمجة لـ VS Code'
              : 'Copy Code Skills for IDE',
          onClick: () => void handleCopyCodeSkills(),
        }}
      />
      <CodeIdeDashboard
        locale={locale}
        getIdToken={getIdToken}
        onOpenProviderCenter={onOpenProviderCenter}
        onOpenChat={onOpenChat}
      />
    </div>
  );
}

export function StudentsSectionHub({
  locale,
  getIdToken,
  onOpenProviderCenter,
  onOpenSkills,
}: SectionHubProps) {
  return (
    <StudentsWorkspace
      locale={locale}
      getIdToken={getIdToken}
      onOpenProviderCenter={onOpenProviderCenter}
      onOpenSkills={onOpenSkills}
    />
  );
}