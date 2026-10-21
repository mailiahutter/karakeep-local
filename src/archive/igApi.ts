import { normalizePost, parseEmbedContext, type IgPost } from "./igParse";
import { canonicalPostUrl, instagramShortcode, isInstagramShare } from "./instagram";

/**
 * Récupération d'une publication Instagram par ses adresses de données.
 *
 * Trois voies, dans l'ordre où Cobalt (github.com/imputnet/cobalt) les a
 * éprouvées : la page d'intégration, l'API de l'application mobile, puis
 * l'API GraphQL du site. Aucune ne demande de compte. Ce sont de simples
 * requêtes réseau, sans WebView : elles fonctionnent aussi quand le système
 * réveille l'application en arrière-plan.
 *
 * Quand Instagram change ses adresses ou ses identifiants, Cobalt corrige en
 * général en quelques jours : c'est la source à surveiller pour reporter le
 * correctif ici.
 */

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const EMBED_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "User-Agent": DESKTOP_UA,
};

const MOBILE_HEADERS: Record<string, string> = {
  "x-ig-app-locale": "en_US",
  "x-ig-device-locale": "en_US",
  "user-agent":
    "Instagram 275.0.0.27.98 Android (33/13; 280dpi; 720x1423; Xiaomi; Redmi 7; onclite; qcom; en_US; 458229237)",
  "accept-language": "en-US",
  "x-fb-http-engine": "Liger",
};

/** Identifiant public de l'application web d'Instagram. */
const WEB_APP_ID = "936619743392459";
/** Requête GraphQL « PolarisPostActionLoadPostQueryQuery », relevée par Cobalt. */
const POST_QUERY_DOC_ID = "8845758582119845";

const TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function viaEmbed(shortcode: string, cookie?: string): Promise<IgPost | null> {
  const res = await fetchWithTimeout(
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    { headers: { ...EMBED_HEADERS, ...(cookie ? { cookie } : {}) } },
  );
  if (!res.ok) return null;
  return normalizePost(parseEmbedContext(await res.text()));
}

async function viaMobileApi(shortcode: string, cookie?: string): Promise<IgPost | null> {
  const headers = { ...MOBILE_HEADERS, ...(cookie ? { cookie } : {}) };
  const oembed = new URL("https://i.instagram.com/api/v1/oembed/");
  oembed.searchParams.set("url", `https://www.instagram.com/p/${shortcode}/`);
  const meta = await fetchWithTimeout(oembed.toString(), { headers })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const mediaId = meta && typeof meta.media_id === "string" ? meta.media_id : null;
  if (!mediaId) return null;

  const info = await fetchWithTimeout(
    `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
    { headers },
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return normalizePost(info?.items?.[0]);
}

/** Valeur d'une entrée de configuration embarquée dans la page du site. */
function siteEntry(name: string, html: string): Record<string, unknown> | null {
  const raw = html.match(new RegExp('\\["' + name + '",.*?,({.*?}),\\d+\\]'))?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function randomToken(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function viaGraphql(shortcode: string, cookie?: string): Promise<IgPost | null> {
  const page = await fetchWithTimeout(`https://www.instagram.com/p/${shortcode}/`, {
    headers: { ...EMBED_HEADERS, ...(cookie ? { cookie } : {}) },
  });
  const html = await page.text();
  const site = siteEntry("SiteData", html);
  const polaris = siteEntry("PolarisSiteData", html);
  const web = siteEntry("DGWWebConfig", html);
  const lsd = (siteEntry("LSD", html)?.token as string | undefined) ?? randomToken(11);
  const csrf = siteEntry("InstagramSecurityConfig", html)?.csrf_token as string | undefined;

  const anonCookie = [
    csrf && `csrftoken=${csrf}`,
    polaris?.device_id && `ig_did=${polaris.device_id}`,
    polaris?.machine_id && `mid=${polaris.machine_id}`,
    "ig_nrcb=1",
  ]
    .filter(Boolean)
    .join("; ");

  const body = new URLSearchParams({
    __d: "www",
    __a: "1",
    __user: "0",
    av: "0",
    lsd,
    __comet_req: "7",
    __hsi: String(site?.hsi ?? "7436540909012459023"),
    __spin_r: String(site?.__spin_r ?? "1019933358"),
    __spin_b: "trunk",
    __spin_t: String(site?.__spin_t ?? Math.floor(Date.now() / 1000)),
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "PolarisPostActionLoadPostQueryQuery",
    variables: JSON.stringify({
      shortcode,
      fetch_tagged_user_count: null,
      hoisted_comment_id: null,
      hoisted_reply_id: null,
    }),
    server_timestamps: "true",
    doc_id: POST_QUERY_DOC_ID,
  });

  const res = await fetchWithTimeout("https://www.instagram.com/graphql/query", {
    method: "POST",
    headers: {
      ...EMBED_HEADERS,
      "x-ig-app-id": String(web?.appId ?? WEB_APP_ID),
      "X-FB-LSD": lsd,
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
      "x-asbd-id": "129477",
      cookie: cookie ?? anonCookie,
      "content-type": "application/x-www-form-urlencoded",
      "X-FB-Friendly-Name": "PolarisPostActionLoadPostQueryQuery",
    },
    body: body.toString(),
  });
  const json = await res.json().catch(() => null);
  return normalizePost(json?.data?.xdt_shortcode_media ?? json?.data?.shortcode_media);
}

export interface IgFetchResult {
  post: IgPost;
  /** La voie qui a répondu, pour le journal. */
  via: "embed" | "mobile" | "graphql";
}

/**
 * Essaie chaque voie jusqu'à obtenir une publication avec au moins un média.
 *
 * Sans cookie d'abord ; avec la session Instagram de l'application ensuite,
 * si elle existe — certaines publications ne s'obtiennent qu'ainsi.
 */
export async function fetchInstagramPost(
  shortcode: string,
  cookie?: string,
): Promise<IgFetchResult | null> {
  const attempts: [IgFetchResult["via"], () => Promise<IgPost | null>][] = [
    ["embed", () => viaEmbed(shortcode)],
    ["mobile", () => viaMobileApi(shortcode)],
    ["graphql", () => viaGraphql(shortcode)],
  ];
  if (cookie) {
    attempts.push(
      ["embed", () => viaEmbed(shortcode, cookie)],
      ["mobile", () => viaMobileApi(shortcode, cookie)],
      ["graphql", () => viaGraphql(shortcode, cookie)],
    );
  }

  for (const [via, attempt] of attempts) {
    try {
      const post = await attempt();
      if (post && post.items.length > 0) return { post, via };
    } catch {
      // Voie suivante.
    }
  }
  return null;
}

/**
 * Suit un lien « Partager » (`instagram.com/share/…`) jusqu'à la publication.
 *
 * Comme Cobalt : avec un agent de navigateur, Instagram sert une page au lieu
 * de rediriger ; avec celui de curl, il redirige. Si une page arrive quand
 * même, l'adresse canonique y est lue. Renvoie l'adresse d'origine quand
 * rien n'aboutit — la capture tentera sa chance avec.
 */
export async function resolveInstagramUrl(url: string, cookie?: string | null): Promise<string> {
  if (!isInstagramShare(url)) return url;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "curl/7.88.1", ...(cookie ? { cookie } : {}) },
      redirect: "follow",
    });
    if (res.url && instagramShortcode(res.url)) return res.url;
    const canonical = canonicalPostUrl(await res.text());
    if (canonical && instagramShortcode(canonical)) return canonical;
  } catch {
    // Adresse d'origine.
  }
  return url;
}
