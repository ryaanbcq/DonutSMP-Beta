/**
 * Refuse les adresses qui pourraient viser le réseau local (protection SSRF basique)
 * quand le bot télécharge une image choisie depuis le dashboard.
 */
export function isSafeImageUrl(value) {
    if (!value)
        return true;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:')
            return false;
        const host = url.hostname.toLowerCase();
        if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal'))
            return false;
        if (/^\[?(::1|f[cd][0-9a-f]{2}:|fe80:)/.test(host))
            return false;
        if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))
            return false;
        return true;
    }
    catch {
        return false;
    }
}
