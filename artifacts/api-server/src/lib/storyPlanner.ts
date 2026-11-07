type PlannerInput = {
  scenario: string;
  count: number;
  characterTraits?: string[];
};

type ParsedStory = {
  styleNotes: string;
  storyText: string;
};

const IMAGE_RESTRICTION =
  "single image, one scene only, no grid, no collage, no panels, no text overlay";
const STYLE_CUES =
  /\b(?:style|visual|aesthetic|palette|lighting|cinematic|illustrated|art direction|tone|look|grain|colour|color|rendering|mood|photorealistic|storybook)\b/iu;
const SCENE_HEADING =
  /^\s*(?:#{1,6}\s*)?(?:(?:scene|chapter)\s+(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b|(?:\d{1,3})\s*[.):\-])\s*[:.)\-]?\s*(.*)$/iu;

function isRecordStyleParagraph(paragraph: string): boolean {
  const words = paragraph.match(/\S+/gu) ?? [];
  return words.length >= 22 && STYLE_CUES.test(paragraph);
}

function parseStory(scenario: string): ParsedStory {
  const lines = scenario.trim().split(/\r?\n/u);
  const headings = lines
    .map((line, index) => ({ line, index, match: SCENE_HEADING.exec(line) }))
    .filter((item): item is typeof item & { match: RegExpExecArray } => Boolean(item.match));

  if (headings.length) {
    const styleNotes = lines.slice(0, headings[0]!.index).join(" ").trim();
    const sceneBodies = headings.map((heading, index) => {
      const nextStart = headings[index + 1]?.index ?? lines.length;
      const headingText = heading.match[1]?.trim() ?? "";
      const followingLines = lines.slice(heading.index + 1, nextStart).join(" ").trim();
      return [headingText, followingLines].filter(Boolean).join(" ");
    }).filter(Boolean);
    return {
      styleNotes,
      storyText: sceneBodies.join(" "),
    };
  }

  const paragraphs = scenario
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length > 1 && isRecordStyleParagraph(paragraphs[0] ?? "")) {
    return {
      styleNotes: paragraphs[0] ?? "",
      storyText: paragraphs.slice(1).join("\n"),
    };
  }
  return { styleNotes: "", storyText: scenario.trim() };
}

function splitIntoSceneSegments(storyText: string, count: number): string[] {
  const units = storyText
    .split(/(?:\r?\n+|(?<=[.!?؟。])\s+)/u)
    .map((unit) => unit.trim())
    .filter(Boolean);
  if (units.length >= count) {
    return Array.from({ length: count }, (_, index) => {
      const start = Math.floor(index * units.length / count);
      const end = Math.max(start + 1, Math.floor((index + 1) * units.length / count));
      return units.slice(start, end).join(" ");
    });
  }

  const words = storyText.match(/\S+/gu) ?? [];
  if (!words.length) return Array.from({ length: count }, () => "");
  if (words.length >= count) {
    return Array.from({ length: count }, (_, index) => {
      const start = Math.floor(index * words.length / count);
      const end = Math.max(start + 1, Math.floor((index + 1) * words.length / count));
      return words.slice(start, end).join(" ");
    });
  }
  return Array.from({ length: count }, (_, index) =>
    words[Math.min(words.length - 1, Math.floor(index * words.length / count))] ?? "",
  );
}

export function planStoryScenePrompts({
  scenario,
  count,
  characterTraits = [],
}: PlannerInput): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new RangeError("Scene count must be from 1 to 100.");
  }
  const parsed = parseStory(scenario);
  const storyText = parsed.storyText || scenario.trim();
  const moments = splitIntoSceneSegments(storyText, count);
  const characterDetails = scenario
    .split(/(?:\r?\n+|(?<=[.!?؟。])\s+|(?<=[,،;؛])\s+)/u)
    .map((part) => part.trim())
    .filter((part) =>
      /(?:\b(?:hair|eyes?|skin|clothes|clothing|shirt|jacket|dress|coat|uniform|beard|glasses)\b|(?:شعر|عيون|عين|ملابس|معطف|قميص|فستان|لحية|نظارة|الملابس)|(?:cheveux|yeux|vêtements|veste|robe|manteau|barbe|lunettes))/iu.test(part),
    )
    .slice(0, 8)
    .map((part) => part.slice(0, 240))
    .join("; ")
    .slice(0, 1200);
  const styleAndCharacterBible = [
    "Shared style + character bible: create a cohesive illustrated storybook image with cinematic composition, " +
      "clear subject focus, consistent rendering, lighting, color treatment, and visual language throughout this story.",
    parsed.styleNotes ? `Visual style direction: ${parsed.styleNotes}` : "",
    characterDetails
      ? `Recurring character appearance details from the full story: ${characterDetails}.`
      : "Keep every recurring character's face, age, hair, clothing, proportions, and distinguishing features consistent; follow the roles and appearance implied by the full story without inventing conflicting designs.",
  ].filter(Boolean).join(" ");
  const traits = characterTraits.map((trait) => trait.trim()).filter(Boolean).slice(0, 3);
  const characterTraitPrefix = traits.length
    ? `Character traits to keep consistent: ${traits.join("; ")}.\n`
    : "";

  return moments.map((moment, index) => {
    const focus = count === 1
      ? "Choose the single defining moment that best represents the complete story."
      : count === 2
        ? index === 0
          ? "Choose the most important opening moment from the first part of the story."
          : "Choose the most important climax or resolution moment from the final part of the story."
        : "Choose one important moment from this chronological portion of the full story.";
    return `${characterTraitPrefix}${styleAndCharacterBible}\nScene ${index + 1} of ${count}: ${focus} Depict one frozen visual moment from this story segment: ${moment}. Keep the progression from beginning to end and show no other time or event. ${IMAGE_RESTRICTION}.`;
  });
}
