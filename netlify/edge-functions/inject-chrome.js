// Netlify Edge Function: inject site-chrome.js into all HTML pages
// This automatically adds the shared nav (with Live Demo) and footer sitemap
// to every HTML page served from tradolux.com

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  // Only process HTML responses
  if (!contentType.includes('text/html')) return response;

  // Skip the trading platform app — it has its own nav
  const url = new URL(request.url);
  if (url.pathname.startsWith('/app') || url.pathname.startsWith('/apex-platform')) {
    return response;
  }

  const html = await response.text();

  // Skip if already has site-chrome or Live Demo
  if (html.includes('site-chrome.js') || html.includes('Live Demo')) {
    return new Response(html, response);
  }

  // Inject before </body>
  const injected = html.replace(
    '</body>',
    '<script src="/site-chrome.js"><\/script>\n</body>'
  );

  return new Response(injected, {
    status: response.status,
    headers: response.headers,
  });
}

export const config = { path: '/*' };
