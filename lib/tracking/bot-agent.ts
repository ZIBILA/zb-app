/**
 * Non-human traffic that must not feed the ad platforms' funnel events
 * (crawlers, link-preview fetchers, headless browsers, load tools). Meta and
 * Snap discard known crawlers themselves, but a relayed server event carries
 * our IP / cookies and would be counted. Server-only helper; pure.
 */
const BOT_UA_RE = /bot|crawler|spider|crawling|headless|lighthouse|puppeteer|playwright|phantomjs|selenium|slurp|facebookexternalhit|facebot|whatsapp|telegrambot|twitterbot|linkedinbot|pinterestbot|embedly|quora link preview|link preview|skypeuripreview|curl\/|wget\/|python-requests|python-urllib|httpclient|go-http-client|java\/|okhttp|axios\/|node-fetch|libwww|scrapy|ahrefs|semrush|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|applebot|bingpreview/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  const s = String(ua || '').trim();
  return !s || BOT_UA_RE.test(s);
}
