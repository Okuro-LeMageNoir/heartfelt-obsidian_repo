/*
 * Simple-Timeline — rendu web pour Obsidian Digital Garden
 * Remplace les codeblocks `timeline-cal` (vertical) et `timeline-h` (horizontal)
 * par un rendu HTML construit à partir des événements émis par le .njk.
 *
 * Source des événements : window.__STL_EVENTS__ (construit côté serveur depuis
 * le frontmatter de toutes les notes : fc-date, fc-end, timelines, tl-title,
 * tl-image, tl-summary). Gère le cas où ces propriétés sont nichées dans
 * `dg-note-properties` (sérialisées par le plugin Digital Garden).
 */
(function () {
  "use strict";

  // === Configuration ===
  // Préfixe utilisé pour résoudre un nom de fichier simple provenant de `tl-image`.
  // Si tu utilises `tl-image` avec un chemin complet (ex. /img/cover.webp) ou une URL,
  // il est utilisé tel quel. Sinon on préfixe avec IMG_BASE.
  var IMG_BASE = "/img/user/Images/";

  var EVENTS = window.__STL_EVENTS__ || [];

  // --- utilitaires ---

  function asArray(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return String(v).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // Normalise une date (chaîne "yyyy-mm-dd" ou objet Date sérialisé en ISO par jsonify)
  // en { label, sortKey }. Gère les années à moins de 4 chiffres (ex. 627) en
  // rembourrant à 4 chiffres pour permettre un tri lexicographique correct.
  function normDate(v) {
    if (!v) return null;
    var s = (v instanceof Date) ? v.toISOString() : String(v).trim();
    var m = s.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    var year = ("0000" + m[1]).slice(-4);
    var month = ("0" + m[2]).slice(-2);
    var day = ("0" + m[3]).slice(-2);
    return {
      label: s.slice(0, 10),        // affichage : valeur d'origine (ex. "627-05-16")
      sortKey: year + "-" + month + "-" + day  // tri : "0627-05-16"
    };
  }

  function cmpDate(a, b) {
    if (a.sortKey < b.sortKey) return -1;
    if (a.sortKey > b.sortKey) return 1;
    return 0;
  }

  function resolveImage(image) {
    if (!image) return null;
    var s = String(image).trim();
    if (!s) return null;
    // URL absolue, chemin absolu ou data URI → tel quel
    if (/^(https?:)?\/\//.test(s) || s.charAt(0) === "/" || s.startsWith("data:")) return s;
    // Sinon on préfixe (en retirant un éventuel ./ )
    return IMG_BASE + s.replace(/^\.?\//, "");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

  // Parse le contenu d'un codeblock (clé: valeur, une par ligne).
  // Les clés sont normalisées en minuscules pour tolérer "Names" / "names".
  function parseOptions(raw) {
    var opts = {};
    (raw || "").split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.indexOf(":") === -1) return;
      var idx = line.indexOf(":");
      var key = line.slice(0, idx).trim().toLowerCase();
      var val = line.slice(idx + 1).trim();
      opts[key] = val;
    });
    opts.names = opts.names
      ? opts.names.split(",").map(function (s) { return s.trim(); }).filter(Boolean)
      : [];
    return opts;
  }

  // Événements appartenant à une timeline donnée (champ `timelines` du frontmatter),
  // triés par date de début.
  function eventsForTimeline(name) {
    return EVENTS.filter(function (e) {
      return asArray(e.timelines).indexOf(name) !== -1;
    }).map(function (e) {
      return {
        title: e.title || e.path || "Sans titre",
        url: e.url,
        start: normDate(e.fcDate),
        end: normDate(e.fcEnd),
        summary: e.summary || "",
        image: resolveImage(e.image)
      };
    }).filter(function (e) { return e.start; })
      .sort(function (a, b) { return cmpDate(a.start, b.start); });
  }

  function renderEvent(ev) {
    var img = ev.image
      ? '<div class="stl-event-img"><img src="' + escapeAttr(ev.image) +
        '" alt="' + escapeAttr(ev.title) + '" loading="lazy"/></div>'
      : "";
    var date = '<div class="stl-event-date">' + escapeHtml(ev.start.label) +
      (ev.end ? " – " + escapeHtml(ev.end.label) : "") + "</div>";
    var sum = ev.summary
      ? '<div class="stl-event-summary">' + escapeHtml(ev.summary) + "</div>"
      : "";
    var title = ev.url
      ? '<a class="stl-event-title" href="' + escapeAttr(ev.url) + '">' + escapeHtml(ev.title) + "</a>"
      : '<span class="stl-event-title">' + escapeHtml(ev.title) + "</span>";
    return '<div class="stl-event">' + img +
      '<div class="stl-event-body">' + title + date + sum + "</div></div>";
  }

  // --- rendus ---

  // Vertical "cross" : un événement par ligne (image + callout)
  function renderVertical(names) {
    var events = [];
    names.forEach(function (n) { events = events.concat(eventsForTimeline(n)); });
    events.sort(function (a, b) { return cmpDate(a.start, b.start); });
    return '<div class="stl stl-vertical">' + events.map(renderEvent).join("") + "</div>";
  }

  // Horizontal : stacked = une ligne par timeline, mixed = tout sur une ligne
  function renderHorizontal(names, mode) {
    if (mode === "stacked") {
      // Grille partagée : une colonne par date unique (toutes timelines confondues),
      // une ligne par timeline. Les événements à la même date s'alignent verticalement.
      var perTimeline = names.map(function (n) { return eventsForTimeline(n); });
      var dateList = [];
      var seen = {};
      perTimeline.forEach(function (evs) {
        evs.forEach(function (e) {
          var k = e.start.sortKey;
          if (!(k in seen)) { seen[k] = true; dateList.push({ key: k, label: e.start.label }); }
        });
      });
      dateList.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });

      var nDates = dateList.length;
      var cols = "auto " + (nDates ? Array(nDates).fill("minmax(130px, max-content)").join(" ") : "");
      var html = '<div class="stl-grid" style="grid-template-columns:' + cols + ';">';

      // Une ligne par timeline (pas d'en-tête de dates : elles sont déjà dans chaque événement)
      names.forEach(function (n, r) {
        html += '<div class="stl-row-label">' + escapeHtml(n) + '</div>';
        var byDate = {};
        perTimeline[r].forEach(function (e) {
          var k = e.start.sortKey;
          (byDate[k] = byDate[k] || []).push(e);
        });
        dateList.forEach(function (d) {
          var cell = byDate[d.key];
          html += cell && cell.length
            ? '<div class="stl-cell">' + cell.map(renderEvent).join("") + '</div>'
            : '<div class="stl-cell stl-cell-empty"></div>';
        });
      });

      html += '</div>';
      return '<div class="stl stl-horizontal stl-stacked">' + html + '</div>';
    }
    var all = [];
    names.forEach(function (n) { all = all.concat(eventsForTimeline(n)); });
    all.sort(function (a, b) { return cmpDate(a.start, b.start); });
    return '<div class="stl stl-horizontal stl-mixed"><div class="stl-track">' +
      all.map(renderEvent).join("") + "</div></div>";
  }

  function processCodeblocks() {
    var blocks = document.querySelectorAll(
      "pre > code.language-timeline-cal, pre > code.language-timeline-h"
    );
    blocks.forEach(function (code) {
      var pre = code.parentElement;
      var opts = parseOptions(code.textContent);
      var html;
      if (code.classList.contains("language-timeline-cal")) {
        html = renderVertical(opts.names);
      } else {
        html = renderHorizontal(opts.names, opts.mode || "stacked");
      }
      var container = document.createElement("div");
      container.innerHTML = html;
      pre.replaceWith(container.firstElementChild || container);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", processCodeblocks);
  } else {
    processCodeblocks();
  }
})();
