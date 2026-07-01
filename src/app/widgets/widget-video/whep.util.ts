/** Minimal fetch signature so the WHEP exchange can be unit-tested with a fake. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers: { get(name: string): string | null };
}>;

export interface IWhepAnswer {
  answerSdp: string;
  /** The session resource URL to DELETE on teardown (from the Location header, resolved absolute). */
  resourceUrl: string;
}

/** Default request deadlines: a gateway that accepts the socket but never answers must not hang the
 *  negotiation forever, which would leave the widget stuck on "Connecting…" with no error or Retry. */
const WHEP_NEGOTIATE_TIMEOUT_MS = 10_000;
const WHEP_DELETE_TIMEOUT_MS = 5_000;

/** AbortSignal that fires after `ms`, or undefined where the platform lacks AbortSignal.timeout. */
function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

/**
 * Performs the WHEP signaling exchange: POSTs the SDP offer and returns the SDP answer plus the
 * session resource URL (resolved from the Location header) used to end the session.
 */
export async function whepNegotiate(
  endpoint: string,
  offerSdp: string,
  fetchImpl: FetchLike,
  timeoutMs: number = WHEP_NEGOTIATE_TIMEOUT_MS
): Promise<IWhepAnswer> {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offerSdp,
    signal: timeoutSignal(timeoutMs)
  });
  if (!res.ok) {
    throw new Error(`WHEP negotiation failed: ${res.status}`);
  }
  const answerSdp = await res.text();
  const location = res.headers.get('Location');
  const resourceUrl = location ? new URL(location, endpoint).href : endpoint;
  return { answerSdp, resourceUrl };
}

/** Ends a WHEP session by DELETE-ing its resource URL (best-effort, bounded). */
export async function whepDelete(
  resourceUrl: string,
  fetchImpl: FetchLike,
  timeoutMs: number = WHEP_DELETE_TIMEOUT_MS
): Promise<void> {
  await fetchImpl(resourceUrl, { method: 'DELETE', signal: timeoutSignal(timeoutMs) });
}
