export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json(
        {
          ok: true,
          service: "matchcamera",
          platform: "cloudflare-workers",
          time: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return env.ASSETS.fetch(request);
  },
};
