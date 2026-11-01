export const SCENE_DURATION_SECONDS = 8;

export type StoryPackScene = {
  index: number;
  motionPrompt: string;
  narration: string;
};

export type StoryPackTextFile = {
  name: "prompts.txt" | "narration.txt" | "order.txt";
  data: Buffer;
};

export function storySceneFilename(index: number, width: number): string {
  return `scene_${String(index).padStart(width, "0")}.jpg`;
}

function timestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function createStoryPackTextFiles(
  input: StoryPackScene[],
  targetCount = input.length,
): StoryPackTextFile[] {
  const scenes = [...input].sort((left, right) => left.index - right.index);
  const width = targetCount > 99 || scenes.some((scene) => scene.index > 99) ? 3 : 2;
  const filenames = scenes.map((scene) => storySceneFilename(scene.index, width));
  const prompts = scenes.map((scene, index) => [
    filenames[index],
    scene.motionPrompt.trim(),
  ].join("\n")).join("\n\n------------------------------\n\n");
  const narration = scenes
    .map((scene, index) =>
      `${timestamp(index * SCENE_DURATION_SECONDS)} | ${scene.narration.trim()}`,
    )
    .join("\n");
  const order = filenames.join("\n");

  return [
    { name: "prompts.txt", data: Buffer.from(prompts, "utf8") },
    { name: "narration.txt", data: Buffer.from(narration, "utf8") },
    { name: "order.txt", data: Buffer.from(order, "utf8") },
  ];
}
