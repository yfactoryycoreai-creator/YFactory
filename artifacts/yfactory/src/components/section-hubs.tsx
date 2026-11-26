import CodeIdeDashboard from '@/components/code-ide-dashboard';
import StudentsWorkspace from '@/components/students-workspace';

export type SectionHubProps = {
  locale: string;
  getIdToken?: () => Promise<string>;
  onOpenProviderCenter: (providerId?: string) => void;
  onOpenChat: () => void;
};

export function CodeSectionHub({
  locale,
  getIdToken,
  onOpenProviderCenter,
  onOpenChat,
}: SectionHubProps) {
  return (
    <CodeIdeDashboard
      locale={locale}
      getIdToken={getIdToken}
      onOpenProviderCenter={onOpenProviderCenter}
      onOpenChat={onOpenChat}
    />
  );
}

export function StudentsSectionHub({
  locale,
  getIdToken,
  onOpenProviderCenter,
}: SectionHubProps) {
  return (
    <StudentsWorkspace
      locale={locale}
      getIdToken={getIdToken}
      onOpenProviderCenter={onOpenProviderCenter}
    />
  );
}