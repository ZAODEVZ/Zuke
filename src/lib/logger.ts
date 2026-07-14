type LogLevel = 'info' | 'warn' | 'error';

/**
 * Structured logger - same call signature as before (logger.info/warn/error
 * take a message + arbitrary context args) so no call site changes, but each
 * call now emits one JSON line instead of console's default multi-arg
 * concatenation. Vercel captures stdout/stderr per line; a JSON line is
 * immediately parseable by any future log drain (Better Stack, Axiom,
 * Datadog all auto-detect JSON stdout) and is more useful even just
 * eyeballing Vercel's raw log viewer, since every line self-describes its
 * level and timestamp instead of relying on the human eye to spot "[zuke]".
 *
 * Does not add error tracking/alerting (see the 2026-07 prod-readiness
 * audit) - that needs a real APM SDK (Sentry) with a DSN, which is a
 * product/account decision, not something this file can wire on its own.
 */
function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack };
  }
  return arg;
}

function emit(level: LogLevel, args: unknown[]): void {
  const [message, ...rest] = args;
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    message: typeof message === 'string' ? message : String(message),
    ...(rest.length > 0 ? { context: rest.map(serializeArg) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
};
