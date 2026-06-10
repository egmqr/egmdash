// egm-api — replaces Gallery/Code.js, QR/Code.js, and Drive-touching parts of Dashboard/Code.js.
// All non-Drive Apps Script logic (Sheets, FCM, Firestore CRUD on dashboard_events) is
// reimplemented here, since you opted to retire Apps Script entirely.

import { handleGalleryRoutes } from './gallery.js';
import { handleQRRoutes } from './qr.js';
import { handleDashboardRoutes } from './dashboard.js';
import { handleHotfolder } from './hotfolder.js';
import { handleSignedUpload } from './uploads.js';
import { json, cors } from './util.js';

export default {
  async fetch(request, env, ctx) {
    // Global CORS — frontends are on createdbyegm.com subdomains, plus we want OPTIONS to short-circuit
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ── Photo gallery (replaces Gallery/Code.js doGet) ──────────────────
      if (path.startsWith('/api/gallery') ||
          path.startsWith('/api/stream') ||  // <-- ADD THIS LINE
          path.startsWith('/api/template') ||
          path.startsWith('/api/upload-community')) {
        return cors(await handleGalleryRoutes(request, env, ctx));
      }

      // ── QR session APIs (replaces QR/Code.js doGet) ─────────────────────
      if (path.startsWith('/api/photo') ||
          path.startsWith('/api/session-gallery') ||
          path.startsWith('/api/toggle-session') ||
          path.startsWith('/api/next-photo-id') ||
          path.startsWith('/api/recent-photos')) {
        return cors(await handleQRRoutes(request, env, ctx));
      }

      // ── Hotfolder (replaces processDailyBoothJsons + getHotfolder) ─────
      if (path === '/api/hotfolder' || path === '/api/hotfolder/push' || path === '/api/hotfolder/ack') {
        return cors(await handleHotfolder(request, env, ctx));
      }

      // ── Booth presigned uploads (NEW — direct WPF→R2) ──────────────────
      if (path === '/api/sign-upload') {
        return cors(await handleSignedUpload(request, env));
      }

      // ── Mint next egm##### event ID (used by ProBooth standalone) ──────
      if (path === '/api/next-event-id') {
        return cors(await handleDashboardRoutes(request, env, ctx));
      }

      // ── Dashboard ops (replaces Dashboard/Code.js doPost actions) ──────
      if (path.startsWith('/api/dashboard/')) {
        return cors(await handleDashboardRoutes(request, env, ctx));
      }

      // ── Cron-target for daily reminders + hotfolder rotation ───────────
      if (path === '/api/cron/daily') {
        const { runDailyTasks } = await import('./cron.js');
        return cors(await runDailyTasks(env));
      }

      return cors(json({ error: 'Not found', path }, 404));
    } catch (err) {
      console.error('Worker error:', err.stack || err.message);
      return cors(json({ success: false, error: err.message }, 500));
    }
  },

  // Cloudflare cron trigger
  async scheduled(event, env, ctx) {
    const { runDailyTasks } = await import('./cron.js');
    ctx.waitUntil(runDailyTasks(env));
  }
};