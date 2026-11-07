import assert from "node:assert/strict";
import test from "node:test";
import {
  generateStorySceneCopy,
  MOTION_PROMPT_SUFFIX,
  templateSceneCopy,
} from "./storyTextGeneration";
import { createStoryPackTextFiles } from "./storyPack";
import { planStoryScenePrompts } from "./storyPlanner";

const twoScenes = [
  {
    index: 1,
    scenePrompt: "Depict one frozen visual moment from this story segment: a lantern swings in the rain. Keep the progression from beginning to end.",
  },
  {
    index: 2,
    scenePrompt: "Depict one frozen visual moment from this story segment: a shadow crosses the doorway. Keep the progression from beginning to end.",
  },
];

test("generates and validates two scenes in one model call", async () => {
  let calls = 0;
  const copy = await generateStorySceneCopy(twoScenes, async () => {
    calls += 1;
    return JSON.stringify([
      {
        index: 1,
        motionPrompt: `A lantern sways as rain slides down the window; one slow camera push-in. ${MOTION_PROMPT_SUFFIX}`,
        narration: "The lantern swings, though no hand is near it.",
      },
      {
        index: 2,
        motionPrompt: `A shadow crosses the doorway; one slow camera pan follows it. ${MOTION_PROMPT_SUFFIX}`,
        narration: "Something waits just beyond the light.",
      },
    ]);
  });

  assert.equal(calls, 1);
  assert.deepEqual(copy.map((scene) => scene.index), [1, 2]);
  assert.deepEqual(copy.map((scene) => scene.motionPromptSource), ["glm", "glm"]);
  assert.deepEqual(copy.map((scene) => scene.narrationSource), ["glm", "glm"]);
  assert.equal(copy[0]?.motionPrompt.endsWith(MOTION_PROMPT_SUFFIX), true);
  assert.equal(copy[1]?.narration, "Something waits just beyond the light.");
});

test("uses marked templates when GLM text generation fails", async () => {
  const copy = await generateStorySceneCopy(twoScenes, async () => {
    throw new Error("test provider unavailable");
  });
  assert.deepEqual(copy.map((scene) => scene.motionPromptSource), ["template", "template"]);
  assert.deepEqual(copy.map((scene) => scene.narrationSource), ["template", "template"]);
  assert.match(copy[0]?.motionPrompt ?? "", /lantern swings/u);
});

test("invalid model JSON also falls back for every supplied scene", async () => {
  const copy = await generateStorySceneCopy(twoScenes, async () => "not-json");
  assert.equal(copy.length, twoScenes.length);
  assert.deepEqual(copy.map((scene) => scene.motionPromptSource), ["template", "template"]);
  assert.deepEqual(copy.map((scene) => scene.narrationSource), ["template", "template"]);
});

test("story pack manifests sort by scene index and use play order", () => {
  const files = createStoryPackTextFiles(
    [
      { index: 2, motionPrompt: "Second motion.", narration: "Second line." },
      { index: 1, motionPrompt: "First motion.", narration: "First line." },
    ],
    2,
  );
  const contents = new Map(files.map((file) => [file.name, file.data.toString("utf8")]));
  assert.equal(contents.get("order.txt"), "scene_01.jpg\nscene_02.jpg");
  assert.match(contents.get("prompts.txt") ?? "", /^scene_01\.jpg\nFirst motion\./u);
  assert.equal(
    contents.get("narration.txt"),
    "00:00 | First line.\n00:08 | Second line.",
  );
});

test("uses three-digit scene filenames for stories over 99 scenes", () => {
  const files = createStoryPackTextFiles(
    [{ index: 100, motionPrompt: "Move.", narration: "Wait." }],
    100,
  );
  assert.equal(files.find((file) => file.name === "order.txt")?.data.toString("utf8"), "scene_100.jpg");
});

test("story planner keeps a long style lead separate from numbered scenes", () => {
  const prompts = planStoryScenePrompts({
    scenario: [
      "Visual style direction: cinematic illustrated storybook, muted blue palette, soft grain, painterly shadows, dramatic lighting, wide framing, and a restrained suspenseful mood throughout.",
      "Scene 1: Mara finds a brass key beneath the flooded station clock.",
      "Scene 2: She opens the locked platform gate as a train arrives without a driver.",
    ].join("\n"),
    count: 2,
    characterTraits: ["short silver hair", "green coat"],
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0] ?? "", /Mara finds a brass key/u);
  assert.match(prompts[1] ?? "", /train arrives without a driver/u);
  assert.doesNotMatch(prompts[0] ?? "", /Depict one frozen visual moment from this story segment: Visual style direction/u);
  assert.match(prompts[0] ?? "", /Character traits to keep consistent: short silver hair; green coat/u);
  assert.match(prompts[1] ?? "", /Visual style direction:/u);
});

test("story planner partitions an unnumbered script into exactly the requested scenes", () => {
  const script = "A bell rings below the empty church. Nora follows the sound through rain. The cellar door opens by itself. A wet footprint appears behind her.";
  const prompts = planStoryScenePrompts({ scenario: script, count: 3 });
  assert.equal(prompts.length, 3);
  assert.match(prompts[0] ?? "", /A bell rings/u);
  assert.match(prompts[1] ?? "", /Nora follows the sound/u);
  assert.match(prompts[2] ?? "", /footprint appears behind her/u);
});

test("story planner returns exactly 100 prompts for a short script", () => {
  const scriptWords = ["A", "candle", "flickers."];
  const prompts = planStoryScenePrompts({ scenario: scriptWords.join(" "), count: 100 });
  assert.equal(prompts.length, 100);
  assert.ok(scriptWords.every((word) => prompts.some((prompt) => prompt.includes(word))));
});

assert.equal(templateSceneCopy(twoScenes[0]!).motionPrompt.endsWith(MOTION_PROMPT_SUFFIX), true);
