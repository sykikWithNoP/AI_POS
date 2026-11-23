// Google Calendar via OAuth2 with the user's own client ID/secret (BYOK).
import { httpJson, badRequest, HttpError, randomToken } from '../lib.js';
import { getGroup, setGroup } from './settings.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
let pendingState = null;
let accessToken = null; // { token, exp }

export const redirectUri = (baseUrl) => `${baseUrl}/api/google/callback`;

export function authUrl(baseUrl) {
  const g = getGroup('google');
  if (!g.clientId || !g.clientSecret) throw badRequest('Add your Google OAuth client ID and secret first');
  pendingState = randomToken(16);
  const qs = new URLSearchParams({
    client_id: g.clientId, redirect_uri: redirectUri(baseUrl), response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state: pendingState,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`;
}

export async function handleCallback(baseUrl, { code, state }) {
  if (!pendingState || state !== pendingState) throw badRequest('OAuth state mismatch, start again');
  pendingState = null;
  const g = getGroup('google');
  const r = await httpJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: redirectUri(baseUrl), grant_type: 'authorization_code' }).toString(),
  });
  if (!r.ok || !r.json?.refresh_token) throw new HttpError(502, `Google token exchange failed: ${r.json?.error_description || r.json?.error || r.status}`);
  setGroup('google', { refreshToken: r.json.refresh_token });
  accessToken = { token: r.json.access_token, exp: Date.now() + (r.json.expires_in - 60) * 1000 };
}

export const isConnected = () => !!getGroup('google').refreshToken;

export function disconnect() {
  accessToken = null;
  setGroup('google', {}, { clearSecrets: ['refreshToken'] });
}

async function token() {
  if (accessToken && accessToken.exp > Date.now()) return accessToken.token;
  const g = getGroup('google');
  if (!g.refreshToken) throw badRequest('Google Calendar is not connected');
  const r = await httpJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, refresh_token: g.refreshToken, grant_type: 'refresh_token' }).toString(),
  });
  if (!r.ok) throw new HttpError(502, `Google refresh failed: ${r.json?.error || r.status}`);
  accessToken = { token: r.json.access_token, exp: Date.now() + (r.json.expires_in - 60) * 1000 };
  return accessToken.token;
}

const calUrl = () => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(getGroup('google').calendarId || 'primary')}/events`;

export async function upcoming(days = 14) {
  const t = await token();
  const qs = new URLSearchParams({ timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + days * 86400_000).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '20' });
  const r = await httpJson(`${calUrl()}?${qs}`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new HttpError(502, `Google Calendar error: ${r.json?.error?.message || r.status}`);
  return (r.json.items || []).map((e) => ({ id: e.id, summary: e.summary, start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, link: e.htmlLink }));
}

/** Create an event. allDay events take date strings (YYYY-MM-DD). */
export async function createEvent({ summary, description = '', start, end, allDay = false }) {
  if (!summary || !start) throw badRequest('summary and start are required');
  const t = await token();
  const body = allDay
    ? { summary, description, start: { date: start }, end: { date: end || start } }
    : { summary, description, start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end || Date.parse(start) + 30 * 60_000).toISOString() } };
  const r = await httpJson(calUrl(), { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new HttpError(502, `Google Calendar error: ${r.json?.error?.message || r.status}`);
  return { id: r.json.id, link: r.json.htmlLink };
}
