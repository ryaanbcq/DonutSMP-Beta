import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isSafeImageUrl } from './url.js';
/**
 * Images des giveaways envoyées depuis Discord ou le dashboard. Elles sont gardées
 * à côté de la base de données (data/images) : les liens de fichiers Discord expirent,
 * alors le bot garde sa propre copie et la renvoie avec le message.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FILE_RE = /^[a-f0-9-]{36}\.(png|jpg|gif|webp)$/;
/** Dossier des images (un dossier temporaire si la base est en mémoire, pour les tests). */
export function imagesDir(databasePath) {
    if (!databasePath || databasePath === ':memory:')
        return join(tmpdir(), 'orbit-images');
    return join(dirname(databasePath), 'images');
}
/** Reconnaît le format à partir des premiers octets (on ne fait pas confiance au nom du fichier). */
export function detectImageType(buf) {
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return 'png';
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
        return 'jpg';
    if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a'))
        return 'gif';
    if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')
        return 'webp';
    return null;
}
/** Enregistre l'image et retourne son nom de fichier, ou une erreur lisible. */
export function saveImage(dir, buf) {
    if (buf.length > MAX_IMAGE_BYTES)
        return { error: 'Image trop lourde (8 Mo maximum).' };
    const type = detectImageType(buf);
    if (!type)
        return { error: 'Ce fichier n\'est pas une image (PNG, JPG, GIF ou WEBP).' };
    mkdirSync(dir, { recursive: true });
    const file = `${randomUUID()}.${type}`;
    writeFileSync(join(dir, file), buf);
    return { file };
}
export function readImage(dir, file) {
    if (!FILE_RE.test(file))
        return null;
    const path = join(dir, file);
    return existsSync(path) ? readFileSync(path) : null;
}
export const isImageFileName = (file) => FILE_RE.test(file);
export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
/** Télécharge une image (pièce jointe Discord) avec une limite de taille. */
export async function downloadImage(url) {
    if (!isSafeImageUrl(url))
        return { error: 'Lien d\'image non autorisé.' };
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok)
            return { error: 'Impossible de télécharger l\'image.' };
        const size = Number(res.headers.get('content-length') ?? 0);
        if (size > MAX_IMAGE_BYTES)
            return { error: 'Image trop lourde (8 Mo maximum).' };
        const buf = Buffer.from(await res.arrayBuffer());
        return { buf };
    }
    catch {
        return { error: 'Impossible de télécharger l\'image.' };
    }
}
/**
 * Valeur d'image stockée dans les options d'un giveaway :
 * « https://… » (lien) ou « file:<nom> » (image gardée par le bot). Vide = pas d'image.
 */
export function normalizeImageRef(value) {
    if (typeof value !== 'string')
        return '';
    const v = value.trim();
    if (v.startsWith('file:'))
        return isImageFileName(v.slice(5)) ? v : '';
    return v && /^https:\/\//i.test(v) && isSafeImageUrl(v) && v.length <= 1000 ? v : '';
}
