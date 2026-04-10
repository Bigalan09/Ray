import { serve } from "bun";
import path from "path";

const API_URL = process.env.API_URL || "http://localhost:8000";
const WS_URL = API_URL.replace(/^http/, "ws");
const isProd = process.env.NODE_ENV === "production";

async function apiProxy(req: Request) {
  const url = new URL(req.url);
  const target = `${API_URL}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");

  const resp = await fetch(target, {
    method: req.method,
    headers,
    body: req.body,
    // @ts-ignore - Bun supports duplex
    duplex: "half",
  });

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  });
}

// WebSocket proxy handler shared by both modes
const websocket = {
  open(ws: any) {
    const upstream = new WebSocket(`${WS_URL}/ws`);
    ws.data.upstream = upstream;
    upstream.addEventListener("message", (e: MessageEvent) => {
      try { ws.send(e.data); } catch {}
    });
    upstream.addEventListener("close", () => {
      try { ws.close(); } catch {}
    });
    upstream.addEventListener("error", () => {
      try { ws.close(); } catch {}
    });
  },
  message(ws: any, msg: string | Buffer) {
    const upstream = ws.data.upstream as WebSocket | undefined;
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(msg);
    }
  },
  close(ws: any) {
    const upstream = ws.data.upstream as WebSocket | undefined;
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  },
};

if (isProd) {
  const distDir = path.resolve(import.meta.dir, "../dist");

  const server = serve({
    port: Number(process.env.PORT) || 3000,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        if (server.upgrade(req, { data: {} })) return;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
        return apiProxy(req);
      }

      // Serve static files from dist/, with SPA fallback
      const filePath = path.join(distDir, path.normalize(url.pathname));
      if (filePath.startsWith(distDir)) {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }
      }

      return new Response(Bun.file(path.join(distDir, "index.html")), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    websocket,
  });

  console.log(`Ray UI running at ${server.url}`);
} else {
  // Development: Bun resolves the HTML import and enables HMR
  const index = (await import("./index.html")).default;

  const server = serve({
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        if (server.upgrade(req, { data: {} })) return;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
        return apiProxy(req);
      }

      // Fall through to Bun's dev server for HMR + static files
      return new Response(null, { status: 404 });
    },
    routes: {
      "/*": index,
    },
    websocket,
    development: {
      hmr: true,
      console: true,
    },
  });

  console.log(`Ray UI running at ${server.url}`);
}
