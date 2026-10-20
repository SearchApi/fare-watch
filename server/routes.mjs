// HTTP handlers for the local API. The browser sends the SearchApi key in a
// header on each request; the server never stores it.

export function createRoutes({ client, envKeyPresent }) {
  async function readJson(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  function send(res, status, body) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  }

  function keyFrom(req) {
    const header = req.headers["x-searchapi-key"];
    if (typeof header === "string" && header.trim()) return header.trim();
    return process.env.SEARCHAPI_API_KEY || "";
  }

  return async function handle(req, res, url) {
    try {
      if (req.method === "GET" && url.pathname === "/api/status") {
        return send(res, 200, { envKey: envKeyPresent, usage: await client.usage() });
      }
      if (req.method === "GET" && url.pathname === "/api/library") {
        return send(res, 200, { items: await client.library() });
      }
      if (req.method === "POST" && url.pathname === "/api/search") {
        const body = await readJson(req);
        const result = await client.search({
          engine: body.engine,
          params: body.params || {},
          refresh: Boolean(body.refresh),
          cacheOnly: Boolean(body.cacheOnly),
          apiKey: keyFrom(req),
        });
        return send(res, 200, { ...result, usage: await client.usage() });
      }
      return send(res, 404, { error: "Not found" });
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      return send(res, status, { error: err.message || "Unexpected error" });
    }
  };
}
