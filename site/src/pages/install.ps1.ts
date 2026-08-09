import type { APIRoute } from "astro";
import installPs1 from "../../../install.ps1?raw";

export const prerender = false;

export const GET: APIRoute = () => {
  return new Response(installPs1, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
