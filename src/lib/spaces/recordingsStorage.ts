/**
 * Supabase Storage helper for uploaded recordings — SERVER ONLY.
 *
 * Uploaded audio lands in the public `recordings` bucket (created by
 * migration #4). The bucket is public so the <audio> player can stream the
 * file without a signed URL; the upload ROUTE is gated (admin/host) so only
 * authorized users can write. Never import this from a client component — it
 * uses the service-role Supabase client.
 */
import { supabaseAdmin } from '@/lib/db/supabase';

/** Bucket created in migration #4. */
export const RECORDINGS_BUCKET = 'recordings';

/** Audio MIME types we accept for upload. */
export const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg', // mp3
  'audio/mp4', // m4a / aac
  'audio/aac',
  'audio/ogg', // ogg / opus (Juke recordings are .ogg)
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
] as const;

/** Max upload size: 200 MB. A 2-hour ogg space is comfortably under this. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Map a MIME type to a file extension for the storage object name. */
function extForType(contentType: string): string {
  switch (contentType) {
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
    case 'audio/aac':
      return 'm4a';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/webm':
      return 'webm';
    default:
      return 'bin';
  }
}

export interface StoredRecording {
  /** Path inside the bucket, persisted as juke_recordings.storage_path. */
  path: string;
  /** Public, streamable URL for the <audio> player. */
  publicUrl: string;
}

export type UploadRecordingResult =
  | { ok: true; stored: StoredRecording }
  | { ok: false; status: number; error: string };

/**
 * Upload an audio file to the `recordings` bucket under a space-scoped path.
 * Does not throw: storage/config failures are returned as `{ ok: false }`.
 */
export async function uploadRecordingFile(input: {
  spaceId: string;
  bytes: ArrayBuffer;
  contentType: string;
}): Promise<UploadRecordingResult> {
  const ext = extForType(input.contentType);
  // Path is server-derived (not from user input) so a crafted filename cannot
  // traverse the bucket. spaceId is already validated by the calling route.
  const objectName = `${crypto.randomUUID()}.${ext}`;
  const path = `${input.spaceId}/${objectName}`;

  const { error } = await supabaseAdmin.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, input.bytes, {
      contentType: input.contentType,
      upsert: false,
    });

  if (error) {
    const message = error.message ?? 'upload failed';
    // Bucket missing = migration #4 storage step not applied.
    if (/bucket.*not.*found|not found/i.test(message)) {
      return {
        ok: false,
        status: 503,
        error: "Storage bucket 'recordings' is not configured. Run migration #4.",
      };
    }
    return { ok: false, status: 502, error: `Storage upload failed: ${message}` };
  }

  const { data } = supabaseAdmin.storage.from(RECORDINGS_BUCKET).getPublicUrl(path);
  return { ok: true, stored: { path, publicUrl: data.publicUrl } };
}
