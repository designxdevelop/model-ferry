import type { APIRoute } from "astro";
import installSh from "../../../install.sh?raw";

export const prerender = false;

export const GET: APIRoute = () => {
  return new Response(installSh, {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
