import CodeAgentWorkspace from '@/components/code-agent-workspace';
import StudentsWorkspace from '@/components/students-workspace';

export type SectionHubProps = {
  locale: string;
  getIdToken?: () => Promise<string>;
  onOpenProviderCenter: (providerId?: string) => void;
  onOpenChat: () => void;
  onOpenConnectors?: () => void;
};

export function CodeSectionHub({
  locale,
  getIdToken,
  onOpenProviderCenter,
  onOpenChat,
  onOpenConnectors,
}: SectionHubProps) {
  return (
    <div style={{ width: '100%', maxWidth: 960, margin: '0 auto' }}>
      <CodeAgentWorkspace
        locale={locale}
        getIdToken={getIdToken}
        onOpenProviderCenter={onOpenProviderCenter}
        onOpenChat={onOpenChat}
        onOpenConnectors={onOpenConnectors}
      />
    </div>
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