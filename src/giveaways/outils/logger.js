const order = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = process.env.LOG_LEVEL ?? 'info';
function log(level, scope, message, extra) {
    if (order[level] < order[minLevel])
        return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
    const out = level === 'error' || level === 'warn' ? console.error : console.log;
    if (extra !== undefined)
        out(line, extra);
    else
        out(line);
}
export function createLogger(scope) {
    return {
        debug: (msg, extra) => log('debug', scope, msg, extra),
        info: (msg, extra) => log('info', scope, msg, extra),
        warn: (msg, extra) => log('warn', scope, msg, extra),
        error: (msg, extra) => log('error', scope, msg, extra),
    };
}
