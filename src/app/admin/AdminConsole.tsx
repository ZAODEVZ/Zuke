'use client';

import { useState } from 'react';

type Result = {
  ok: boolean;
  status: number;
  body: unknown;
};

async function callJson(url: string, body?: unknown): Promise<Result> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = await res.text();
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

function ResultBox({ result }: { result: Result | null }) {
  if (!result) return null;
  return (
    <pre
      className={`mt-3 max-h-72 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap ${
        result.ok
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
          : 'border-red-500/30 bg-red-500/5 text-red-200'
      }`}
    >
      HTTP {result.status}
      {'\n\n'}
      {typeof result.body === 'string'
        ? result.body
        : JSON.stringify(result.body, null, 2)}
    </pre>
  );
}

export function AdminConsole() {
  const [createTitle, setCreateTitle] = useState('Zuke test space');
  const [announceCast, setAnnounceCast] = useState(false);
  const [allowAgents, setAllowAgents] = useState(true);
  const [record, setRecord] = useState(true);
  const [createResult, setCreateResult] = useState<Result | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  const [endId, setEndId] = useState('');
  const [endResult, setEndResult] = useState<Result | null>(null);
  const [endBusy, setEndBusy] = useState(false);

  const [hookResult, setHookResult] = useState<Result | null>(null);
  const [hookBusy, setHookBusy] = useState(false);

  async function onCreate() {
    setCreateBusy(true);
    setCreateResult(null);
    try {
      const result = await callJson('/api/juke/space', {
        title: createTitle,
        announceCast,
        allowAgents,
        record,
      });
      setCreateResult(result);
      const id = (result.body as { data?: { id?: string } })?.data?.id;
      if (id) setEndId(id);
    } finally {
      setCreateBusy(false);
    }
  }

  async function onEnd() {
    if (!endId.trim()) return;
    setEndBusy(true);
    setEndResult(null);
    try {
      setEndResult(
        await callJson('/api/juke/admin/end-space', { spaceId: endId.trim() }),
      );
    } finally {
      setEndBusy(false);
    }
  }

  async function onRegister() {
    setHookBusy(true);
    setHookResult(null);
    try {
      setHookResult(await callJson('/api/juke/admin/register-webhook'));
    } finally {
      setHookBusy(false);
    }
  }

  async function onDeleteHook() {
    setHookBusy(true);
    setHookResult(null);
    try {
      setHookResult(await callJson('/api/juke/admin/delete-webhook'));
    } finally {
      setHookBusy(false);
    }
  }

  const sectionClass =
    'rounded-lg border border-white/10 bg-white/[0.02] p-5 flex flex-col gap-3';

  return (
    <div className="flex flex-col gap-5">
      <section className={sectionClass}>
        <h2 className="text-lg font-medium">Create space</h2>
        <label className="text-xs text-gray-400">Title</label>
        <input
          value={createTitle}
          onChange={(e) => setCreateTitle(e.target.value)}
          className="rounded-md bg-black/40 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-purple-400"
        />
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={announceCast}
              onChange={(e) => setAnnounceCast(e.target.checked)}
            />
            Announce cast
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowAgents}
              onChange={(e) => setAllowAgents(e.target.checked)}
            />
            Allow agents
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={record}
              onChange={(e) => setRecord(e.target.checked)}
            />
            Recording
          </label>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCreate}
            disabled={createBusy}
            className="rounded-md bg-purple-500 hover:bg-purple-400 disabled:opacity-50 px-4 py-2 text-sm font-medium"
          >
            {createBusy ? 'Creating...' : 'Create'}
          </button>
          {(() => {
            const id = (createResult?.body as { data?: { id?: string } })?.data?.id;
            return id ? (
              <a
                href={`/live/${id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
              >
                Open /live/{id.slice(0, 8)}...
              </a>
            ) : null;
          })()}
        </div>
        <ResultBox result={createResult} />
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-medium">End space</h2>
        <label className="text-xs text-gray-400">Space ID</label>
        <input
          value={endId}
          onChange={(e) => setEndId(e.target.value)}
          placeholder="paste space UUID"
          className="rounded-md bg-black/40 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-purple-400 font-mono"
        />
        <div>
          <button
            onClick={onEnd}
            disabled={endBusy || !endId.trim()}
            className="rounded-md bg-red-500 hover:bg-red-400 disabled:opacity-50 px-4 py-2 text-sm font-medium"
          >
            {endBusy ? 'Ending...' : 'End space'}
          </button>
        </div>
        <ResultBox result={endResult} />
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-medium">Webhook</h2>
        <p className="text-xs text-gray-400">
          Register/delete the Juke webhook for this Zuke deployment. Paste the
          returned <code className="text-purple-300">whsec_</code> into the
          Vercel <code className="text-purple-300">JUKE_WEBHOOK_SECRET</code>{' '}
          env, then redeploy.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onRegister}
            disabled={hookBusy}
            className="rounded-md bg-purple-500 hover:bg-purple-400 disabled:opacity-50 px-4 py-2 text-sm font-medium"
          >
            {hookBusy ? 'Working...' : 'Register webhook'}
          </button>
          <button
            onClick={onDeleteHook}
            disabled={hookBusy}
            className="rounded-md border border-red-400/40 text-red-300 hover:bg-red-500/10 disabled:opacity-50 px-4 py-2 text-sm font-medium"
          >
            Delete webhook
          </button>
        </div>
        <ResultBox result={hookResult} />
      </section>
    </div>
  );
}
