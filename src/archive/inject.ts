/**
 * Script injecté dans la page, une fois le JavaScript du site exécuté.
 *
 * C'est l'équivalent de ce que Karakeep obtient de son Chrome sans interface :
 * le DOM *rendu*, pas le HTML brut du serveur. La différence est décisive sur
 * les sites dont le contenu n'existe qu'après exécution du JavaScript.
 *
 * Le script produit aussi une archive autonome : chaque feuille de style et
 * chaque image est convertie en URI de données et réinjectée dans le document.
 * Le fichier obtenu reste lisible même si le site disparaît — c'est le rôle que
 * Karakeep confie à `monolith`.
 */

export interface ArchiveOptions {
  /** Octets au-delà desquels une ressource n'est pas intégrée. */
  maxResourceBytes: number;
  /** Poids total maximal de l'archive. */
  maxTotalBytes: number;
  /** Intégrer les ressources, ou se contenter du DOM rendu. */
  inlineResources: boolean;
  /** Nature de la source : déclenche une extraction ciblée. */
  sourceKind: "website" | "youtube" | "instagram";
}

/**
 * Construit le script à injecter. Le résultat est renvoyé à l'application par
 * `window.ReactNativeWebView.postMessage`.
 */
export function buildInjectedScript(opts: ArchiveOptions): string {
  // Le script est sérialisé dans une WebView : il ne peut rien capturer de la
  // portée TypeScript, d'où les options passées en JSON littéral.
  return `
(function () {
  var OPTS = ${JSON.stringify(opts)};
  var send = function (payload) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (e) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ ok: false, error: 'postMessage: ' + e.message })
      );
    }
  };

  function meta(names) {
    for (var i = 0; i < names.length; i++) {
      var el = document.querySelector(
        'meta[property="' + names[i] + '"], meta[name="' + names[i] + '"]'
      );
      if (el && el.content && el.content.trim()) return el.content.trim();
    }
    return null;
  }

  function absolute(url) {
    try { return new URL(url, document.baseURI).href; } catch (e) { return null; }
  }

  // Texte lisible : on écarte ce qui n'appartient pas à l'article avant de
  // lire textContent, sinon menus et pieds de page polluent le tagging.
  function readableText() {
    var clone = document.body ? document.body.cloneNode(true) : null;
    if (!clone) return '';
    var drop = clone.querySelectorAll(
      'script,style,noscript,svg,canvas,iframe,form,button,select,textarea,nav,header,footer,aside,[aria-hidden="true"]'
    );
    for (var i = 0; i < drop.length; i++) {
      if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]);
    }
    var main = clone.querySelector('article') || clone.querySelector('main') || clone;
    var text = (main.innerText || main.textContent || '');
    return text.replace(/[ \\t\\u00a0]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
  }

  function collectImages() {
    var out = [];
    var seen = {};
    var imgs = document.images || [];
    for (var i = 0; i < imgs.length && out.length < 40; i++) {
      var src = imgs[i].currentSrc || imgs[i].src;
      if (!src || src.indexOf('data:') === 0) continue;
      var abs = absolute(src);
      // Les pixels de suivi et les icônes ne valent pas d'être conservés.
      if (!abs || seen[abs]) continue;
      if (imgs[i].naturalWidth < 150 || imgs[i].naturalHeight < 150) continue;
      seen[abs] = true;
      out.push({
        url: abs,
        width: imgs[i].naturalWidth,
        height: imgs[i].naturalHeight,
        alt: imgs[i].alt || null
      });
    }
    return out;
  }

  function collectVideos() {
    var out = [];
    var seen = {};
    var vids = document.querySelectorAll('video source[src], video[src]');
    for (var i = 0; i < vids.length; i++) {
      var abs = absolute(vids[i].getAttribute('src'));
      if (abs && !seen[abs]) { seen[abs] = true; out.push({ url: abs, kind: 'file' }); }
    }
    // Lecteurs embarqués : on garde l'adresse de la page, un outil dédié
    // saura la traiter même si le flux lui-même n'est pas accessible ici.
    var frames = document.querySelectorAll('iframe[src]');
    for (var j = 0; j < frames.length; j++) {
      var f = absolute(frames[j].getAttribute('src'));
      if (!f || seen[f]) continue;
      if (/youtube|youtu\\.be|vimeo|dailymotion|peertube/i.test(f)) {
        seen[f] = true; out.push({ url: f, kind: 'embed' });
      }
    }
    return out;
  }

  function fetchAsDataUri(url) {
    return fetch(url, { credentials: 'omit', mode: 'cors' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var len = parseInt(r.headers.get('content-length') || '0', 10);
        if (len > OPTS.maxResourceBytes) throw new Error('trop volumineux');
        return r.blob();
      })
      .then(function (blob) {
        if (blob.size > OPTS.maxResourceBytes) throw new Error('trop volumineux');
        return new Promise(function (resolve, reject) {
          var fr = new FileReader();
          fr.onload = function () { resolve({ uri: fr.result, size: blob.size }); };
          fr.onerror = function () { reject(new Error('lecture impossible')); };
          fr.readAsDataURL(blob);
        });
      });
  }

  // Construit une copie autonome du document : styles et images intégrés.
  function buildArchive() {
    var doc = document.documentElement.cloneNode(true);
    var drop = doc.querySelectorAll('script,noscript');
    for (var i = 0; i < drop.length; i++) {
      if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]);
    }

    if (!OPTS.inlineResources) {
      return Promise.resolve('<!DOCTYPE html>' + doc.outerHTML);
    }

    var budget = { used: 0 };
    var jobs = [];

    // Feuilles de style externes -> balises <style> intégrées.
    var links = doc.querySelectorAll('link[rel~="stylesheet"][href]');
    for (var l = 0; l < links.length; l++) {
      (function (link) {
        var href = absolute(link.getAttribute('href'));
        if (!href) return;
        jobs.push(
          fetch(href, { credentials: 'omit' })
            .then(function (r) { return r.ok ? r.text() : null; })
            .then(function (css) {
              if (!css || budget.used + css.length > OPTS.maxTotalBytes) return;
              budget.used += css.length;
              var style = doc.ownerDocument.createElement('style');
              style.textContent = css;
              if (link.parentNode) link.parentNode.replaceChild(style, link);
            })
            .catch(function () {})
        );
      })(links[l]);
    }

    // Images -> URI de données.
    var imgs = doc.querySelectorAll('img[src]');
    for (var m = 0; m < imgs.length; m++) {
      (function (img) {
        var src = absolute(img.getAttribute('src'));
        if (!src || src.indexOf('data:') === 0) return;
        jobs.push(
          fetchAsDataUri(src)
            .then(function (res) {
              if (budget.used + res.size > OPTS.maxTotalBytes) return;
              budget.used += res.size;
              img.setAttribute('src', res.uri);
              img.removeAttribute('srcset');
            })
            .catch(function () {})
        );
      })(imgs[m]);
    }

    return Promise.all(jobs).then(function () {
      return '<!DOCTYPE html>' + doc.outerHTML;
    });
  }


  // --- Extraction ciblée par plateforme -------------------------------
  // Les og: suffisent pour le titre et l'image, mais la description utile est
  // ailleurs : tronquée chez YouTube, absente du HTML initial chez Instagram.

  function youtubeExtras() {
    var out = {};
    // La description complète vit dans ytInitialPlayerResponse, que la page
    // dépose sur window ; l'attribut og: est coupé à ~160 caractères.
    try {
      var pr = window.ytInitialPlayerResponse;
      if (pr && pr.videoDetails) {
        if (pr.videoDetails.shortDescription) out.description = pr.videoDetails.shortDescription;
        if (pr.videoDetails.title) out.title = pr.videoDetails.title;
        if (pr.videoDetails.author) out.author = pr.videoDetails.author;
        if (pr.videoDetails.lengthSeconds) out.durationSec = parseInt(pr.videoDetails.lengthSeconds, 10);
      }
    } catch (e) {}
    // Repli sur le DOM si l'objet n'est pas exposé.
    if (!out.description) {
      var d = document.querySelector('#description-inline-expander, #description');
      if (d && d.innerText && d.innerText.trim()) out.description = d.innerText.trim();
    }
    return out;
  }

  function instagramExtras() {
    var out = {};
    var media = [];
    // Instagram sert bien les og: sur les publications publiques : c'est ce qui
    // alimente les aperçus de lien, et c'est la voie la plus stable.
    var ogVideo = meta(['og:video', 'og:video:secure_url']);
    if (ogVideo) media.push({ url: absolute(ogVideo), kind: 'file', isVideo: true });

    // Carrousel : les <img> et <video> rendus dans l'article.
    var art = document.querySelector('article') || document;
    var imgs = art.querySelectorAll('img[srcset], img[src]');
    for (var i = 0; i < imgs.length; i++) {
      var s = imgs[i].currentSrc || imgs[i].src;
      if (!s || s.indexOf('data:') === 0) continue;
      if (imgs[i].naturalWidth < 300) continue;
      media.push({ url: absolute(s), kind: 'image', isVideo: false });
    }
    var vids = art.querySelectorAll('video');
    for (var j = 0; j < vids.length; j++) {
      var vs = vids[j].currentSrc || vids[j].src;
      if (vs && vs.indexOf('blob:') !== 0) media.push({ url: absolute(vs), kind: 'file', isVideo: true });
    }
    out.media = media;

    // La légende : og:description la contient, sinon on la cherche dans le DOM.
    var cap = meta(['og:description']);
    if (cap) out.description = cap;
    return out;
  }

  try {
    var base = {
      url: location.href,
      title: (meta(['og:title', 'twitter:title']) || document.title || '').trim() || null,
      description: meta(['og:description', 'twitter:description', 'description']),
      siteName: meta(['og:site_name', 'application-name']),
      author: meta(['author', 'article:author']),
      publishedAt: meta(['article:published_time', 'datePublished']),
      imageUrl: (function () { var i = meta(['og:image', 'twitter:image']); return i ? absolute(i) : null; })(),
      content: readableText(),
      images: collectImages(),
      videos: collectVideos()
    };

    if (OPTS.sourceKind === 'youtube') {
      var yt = youtubeExtras();
      if (yt.title) base.title = yt.title;
      if (yt.description) base.description = yt.description;
      if (yt.author) base.author = yt.author;
      if (yt.durationSec) base.durationSec = yt.durationSec;
      // Chez YouTube, la description EST le contenu : sans elle le tagging
      // n'aurait que le titre à se mettre sous la dent.
      if (yt.description) base.content = yt.description;
    } else if (OPTS.sourceKind === 'instagram') {
      var ig = instagramExtras();
      if (ig.description) { base.description = ig.description; base.content = ig.description; }
      if (ig.media && ig.media.length) {
        for (var k = 0; k < ig.media.length; k++) {
          var m = ig.media[k];
          if (!m.url) continue;
          if (m.isVideo) base.videos.push({ url: m.url, kind: 'file' });
          else base.images.push({ url: m.url, width: 0, height: 0, alt: null });
        }
      }
    }

    buildArchive()
      .then(function (html) { send({ ok: true, data: base, archive: html }); })
      // L'archive est un bonus : son échec ne doit pas faire perdre le texte.
      .catch(function (e) { send({ ok: true, data: base, archive: null, archiveError: e.message }); });
  } catch (e) {
    send({ ok: false, error: e.message });
  }
})();
true;
`;
}
