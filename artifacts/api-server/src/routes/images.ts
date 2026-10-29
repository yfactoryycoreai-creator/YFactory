import { Router, type IRouter } from 'express';
import { GenerateStoryImagesBody } from '@workspace/api-zod';
import {
  generateImageWithFallback,
  type ImageProvider,
  type ProviderKeys,
} from '../lib/imageGeneration';

const router: IRouter = Router();
const MAX_STORY_IMAGES = 100;

type FirestoreDocument = {
  fields?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function firestoreStringArray(fields: Record<string, unknown>, key: string): string[] {
  const field = asRecord(fields[key]);
  const arrayValue = asRecord(field.arrayValue);
  const values = Array.isArray(arrayValue.values) ? arrayValue.values : [];
  return values
    .map((value) => asRecord(value).stringValue)
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
}

function firestoreNumber(fields: Record<string, unknown>, key: string): number {
  const field = asRecord(fields[key]);
  const value = Number(field.integerValue ?? field.doubleValue ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function verifyFirebaseToken(idToken: string): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('Firebase web API key is not configured on the server.');
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!response.ok) return null;
  const data: unknown = await response.json();
  const users = asRecord(data).users;
  const firstUser = Array.isArray(users) ? asRecord(users[0]) : {};
  return typeof firstUser.localId === 'string' ? firstUser.localId : null;
}

async function readFirestoreDocument(
  projectId: string,
  documentPath: string[],
  idToken: string,
): Promise<FirestoreDocument | null> {
  const encodedPath = documentPath.map(encodeURIComponent).join('/');
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/(default)/documents/${encodedPath}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Firestore read returned HTTP ${response.status}.`);
  }
  return (await response.json()) as FirestoreDocument;
}

function providerKeysFromDocument(document: FirestoreDocument | null): ProviderKeys {
  const fields = document?.fields ?? {};
  return {
    agnes: firestoreStringArray(fields, 'agnes_keys'),
    glm: firestoreStringArray(fields, 'glm_keys'),
  };
}

function imageCountFromStory(document: FirestoreDocument | null): number {
  return document ? Math.max(0, Math.floor(firestoreNumber(document.fields ?? {}, 'imageCount'))) : 0;
}

router.post('/images/generate', async (req, res): Promise<void> => {
  const parsed = GenerateStoryImagesBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.prompt.trim()) {
    res.status(400).json({
      error: 'Provide a prompt and an image count between 1 and 4.',
      code: 'invalid_request',
    });
    return;
  }

  const authorization = req.get('authorization') ?? '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch?.[1]) {
    res.status(401).json({ error: 'Sign in before generating images.', code: 'unauthorized' });
    return;
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    req.log.error('Firebase project ID is not configured on the server.');
    res.status(503).json({ error: 'Image generation is not configured.', code: 'server_configuration' });
    return;
  }

  try {
    const uid = await verifyFirebaseToken(tokenMatch[1]);
    if (!uid) {
      res.status(401).json({ error: 'Sign in again before generating images.', code: 'unauthorized' });
      return;
    }

    const { storyId, prompt, count } = parsed.data;
    if (storyId !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(storyId)) {
      res.status(400).json({ error: 'The story ID is invalid.', code: 'invalid_story_id' });
      return;
    }

    let storyCount = 0;
    if (storyId) {
      const story = await readFirestoreDocument(
        projectId,
        ['users', uid, 'stories', storyId],
        tokenMatch[1],
      );
      if (!story) {
        res.status(404).json({ error: 'This story could not be found.', code: 'story_not_found' });
        return;
      }
      storyCount = imageCountFromStory(story);
      if (storyCount >= MAX_STORY_IMAGES) {
        res.status(409).json({ error: 'This story has reached its 100-image limit.', code: 'story_limit' });
        return;
      }
    }

    let providerKeys: ProviderKeys = { agnes: [], glm: [] };
    try {
      const userDocument = await readFirestoreDocument(
        projectId,
        ['users', uid],
        tokenMatch[1],
      );
      providerKeys = providerKeysFromDocument(userDocument);
    } catch (keyReadError) {
      req.log.warn(
        { error: keyReadError instanceof Error ? keyReadError.message : 'unknown' },
        'Could not read saved image provider keys; using server secrets when available.',
      );
    }

    const allowedCount = storyId
      ? Math.min(count, MAX_STORY_IMAGES - storyCount)
      : count;
    const skippedCount = count - allowedCount;
    const settled = await Promise.allSettled(
      Array.from({ length: allowedCount }, () =>
        generateImageWithFallback(prompt.trim(), providerKeys, fetch, (provider: ImageProvider, error) => {
          req.log.warn(
            {
              provider,
              error: error instanceof Error ? error.message : 'unknown provider error',
            },
            'Image provider attempt failed.',
          );
        }),
      ),
    );
    const images = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const failedCount = allowedCount - images.length;

    if (!images.length) {
      res.status(502).json({
        error: 'Image generation failed. Please try again shortly.',
        code: 'all_providers_failed',
        failedCount,
        skippedCount,
      });
      return;
    }

    res.json({ images, failedCount, skippedCount });
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : 'unknown' },
      'Image generation request failed.',
    );
    res.status(500).json({
      error: 'Image generation failed. Please try again shortly.',
      code: 'image_generation_failed',
    });
  }
});

export default router;
