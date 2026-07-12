/**
 * One-shot: register the Zuke webhook receiver with Juke's developer webhook
 * API (POST /v1/developer/webhooks).
 *
 *   npx tsx scripts/register-juke-webhook.ts [url]
 *
 * Reads JUKE_API_KEY from `.env.local`. URL defaults to `${getBaseUrl()}/api/juke/webhooks`
 * (same resolution the live admin route uses), matching the current deploy
 * instead of a hardcoded domain.
 *
 * Juke generates the HMAC secret server-side and rejects a client-supplied
 * `secret` with 422 extra_forbidden - we do NOT send one. On success this
 * script writes the returned secret into `.env.local` as JUKE_WEBHOOK_SECRET
 * (creating or replacing the line) so there's no manual copy-paste step for
 * local dev.
 *
 * Idempotent per llms.txt: Juke uniques subscriptions by (app_id, url), so
 * re-running with the same URL does not create a duplicate. If Juke's
 * response on a re-run omits `secret` (i.e. the subscription already
 * existed and no fresh secret was issued), this script leaves any existing
 * JUKE_WEBHOOK_SECRET in `.env.local` untouched and says so - it will NOT
 * clobber a working secret with an empty one.
 */
import * as fs from 'fs';
import { getBaseUrl } from '../src/zuke.config';

interface JukeWebhookRegisterResponse {
  id?: string;
  url?: string;
  events?: string[];
  enabled?: boolean;
  secret?: string;
  [k: string]: unknown;
}

const ENV_PATH = '.env.local';

function loadEnv(): Record<string, string> {
  let raw: string;
  try {
    raw = fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    console.error(`Could not read ${ENV_PATH} - run this from the repo root.`);
    process.exit(1);
  }
  const env: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  }
  return env;
}

/** Set or replace JUKE_WEBHOOK_SECRET in `.env.local`, preserving every other line. */
function writeWebhookSecret(secret: string): void {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const lines = raw.split('\n');
  const key = 'JUKE_WEBHOOK_SECRET';
  let found = false;
  const next = lines.map((line) => {
    if (line.match(new RegExp(`^${key}=`))) {
      found = true;
      return `${key}=${secret}`;
    }
    return line;
  });
  if (!found) {
    if (next.length && next[next.length - 1] !== '') next.push('');
    next.push(`${key}=${secret}`);
  }
  fs.writeFileSync(ENV_PATH, next.join('\n'));
}

async function main(): Promise<void> {
  const env = loadEnv();
  const apiKey = env.JUKE_API_KEY;
  if (!apiKey) {
    console.error('Missing JUKE_API_KEY in .env.local.');
    process.exit(1);
  }

  const url = process.argv[2] ?? `${getBaseUrl()}/api/juke/webhooks`;
  console.log('Registering Juke webhook for', url);

  const res = await fetch('https://api.juke.audio/v1/developer/webhooks', {
    method: 'POST',
    headers: {
      'X-Juke-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    // No `secret` field - Juke generates and returns it; sending one gets a
    // 422 extra_forbidden rejection.
    body: JSON.stringify({
      url,
      events: [
        'room.started',
        'room.finished',
        'participant.joined',
        'participant.left',
        'recording.ready',
      ],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`FAILED - status ${res.status}`);
    console.error(text);
    process.exit(1);
  }

  let body: JukeWebhookRegisterResponse;
  try {
    body = JSON.parse(text);
  } catch {
    console.log('OK - Juke returned non-JSON body (logged below):');
    console.log(text);
    return;
  }

  console.log('OK - webhook registered.');
  console.log('  id      ', body.id ?? '(not returned)');
  console.log('  url     ', body.url ?? url);
  console.log('  events  ', body.events ?? '(not returned)');
  console.log('  enabled ', body.enabled ?? '(not returned)');

  if (body.secret) {
    writeWebhookSecret(body.secret);
    console.log(`OK - wrote JUKE_WEBHOOK_SECRET into ${ENV_PATH}.`);
  } else {
    console.log(
      'No `secret` in the response - this subscription already existed and Juke ' +
        `did not issue a new one. Leaving JUKE_WEBHOOK_SECRET in ${ENV_PATH} untouched. ` +
        'If deliveries are 401ing, delete the existing subscription via ' +
        '/api/juke/admin/delete-webhook and re-run this script to get a fresh secret.',
    );
  }
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
