const FREEBOARD_SK_PATH = '/@signalk/freeboard-sk/';

/**
 * Builds the embedded Freeboard-SK iframe URL. SKip is served same-origin with its Signal K server,
 * so the iframe loads from the app origin and the same-origin session cookie authenticates it.
 */
export function buildFreeboardSkUrl(appOrigin: string): string {
  return `${appOrigin}${FREEBOARD_SK_PATH}`;
}
