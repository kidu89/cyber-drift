(function () {
  'use strict';
  var API = "https://api.mindblown.ai", DEDUPE_MS = 1800000;
  var WEB = "https://mindblown.ai";

  function currentScript() {
    if (document.currentScript) return document.currentScript;
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].getAttribute('data-game')) return all[i];
    }
    return null;
  }

  var tag = currentScript();
  var gameId = tag ? tag.getAttribute('data-game') : '';
  var gameSlug = tag ? (tag.getAttribute('data-slug') || '') : '';
  // The game on the screen. It is this page's own until the shell says the
  // reader has scrolled to a neighbour.
  var current = gameId;

  // A session id for THIS browser, kept in localStorage so a reload is
  // recognised as the same visit rather than a new player. It identifies a
  // browser and nothing else: there is no login on a published game, and
  // nothing here is sent anywhere except with the play it belongs to.
  function sessionId() {
    try {
      var key = 'mb.sid';
      var existing = window.localStorage.getItem(key);
      if (existing) return existing;
      var minted = (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 32);
      window.localStorage.setItem(key, minted);
      return minted;
    } catch (e) {
      // Private mode, a blocked cookie jar, a file:// page. Report the play
      // without a session rather than not at all.
      return '';
    }
  }

  // WHO IS LOOKING AT THIS PAGE.
  //
  // A page holds no session of ours and never will: it is HTML a model wrote,
  // on its own origin, and handing it a token would let any published page read
  // the signed-in surface of anybody who opened it. So it is TOLD, and the
  // telling comes from the rail's embed -- the app's own origin, inside a frame
  // this script cannot read into. The page receives three fields and no
  // credential.
  //
  // THE ID IS THE KEY AND THE USERNAME IS A LABEL. That split is the whole
  // contract (Sasun, 2026-09-09: "keep anything user specific with persistent
  // id, because usernames can change"). A handle really does move -- the API
  // rate-limits the change and files the old one in username_aliases so the old
  // profile URL still resolves -- so a page that keys on a username loses that
  // person's saved things the moment they rename, silently and for good.
  //
  // THE ID IS THE SAME ON EVERY PAGE. It is the account id, so a page may
  // recognise somebody it has seen before elsewhere. An earlier draft sent a
  // per-page derivation to prevent exactly that, and it was removed because the
  // username sitting beside it is one value across every page already: the
  // derivation prevented a linkage the field next to it hands over.
  //
  // SIGNED OUT IS NOT NOBODY. Most people who open a page have never signed in,
  // and they still deserve their own progress kept. They get an id derived from
  // the same per-browser session the play beacon already uses. It identifies a
  // BROWSER: clearing site data mints a new one. That is enough to remember
  // somebody and not enough to stop one person being two, which is why nothing
  // ranked may rest on it.
  //
  // IT ARRIVES LATE, ALWAYS. The frame has to load and ask the API, so a page
  // reading `viewer.id` on its first line gets the anonymous answer. `onchange`
  // is how it finds out, and it fires immediately with the current value so a
  // page needs one code path rather than two.
  var viewerState = { id: '', username: '', signedIn: false };
  var viewerWatchers = [];

  function anonID() {
    var session = sessionId();
    // No storage at all means no continuity to offer. An empty id is honest;
    // a minted-per-load one would look stable and silently not be.
    return session ? 'anon:' + session : '';
  }

  function tellViewer() {
    for (var i = 0; i < viewerWatchers.length; i++) {
      try {
        viewerWatchers[i](viewerSnapshot());
      } catch (e) { /* one bad listener is not the others' problem */ }
    }
  }

  function viewerSnapshot() {
    return { id: viewerState.id, username: viewerState.username, signedIn: viewerState.signedIn };
  }

  // What the frame said, checked before it is believed. The frame is trusted
  // for this and nothing else, and only the shape below is read off it.
  function setViewer(data) {
    if (data && data.signed_in === false) {
      if (!viewerState.signedIn && !viewerState.username) return;
      viewerState = { id: anonID(), username: '', signedIn: false };
      tellViewer();
      return;
    }
    if (!data || data.signed_in !== true) return;
    if (typeof data.id !== 'string' || !data.id) return;
    var username = typeof data.username === 'string' ? data.username : '';
    if (viewerState.id === data.id && viewerState.username === username &&
        viewerState.signedIn) {
      return;
    }
    viewerState = { id: data.id, username: username, signedIn: true };
    tellViewer();
  }

  var viewer = {
    get id() { return viewerState.id; },
    get username() { return viewerState.username; },
    get signedIn() { return viewerState.signedIn; },
    // Called at once with the current value, then again on every change.
    // Returns the unsubscribe, like sound.onchange does.
    onchange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      viewerWatchers.push(fn);
      try { fn(viewerSnapshot()); } catch (e) { /* see tellViewer */ }
      return function () {
        for (var i = 0; i < viewerWatchers.length; i++) {
          if (viewerWatchers[i] === fn) { viewerWatchers.splice(i, 1); return; }
        }
      };
    }
  };

  // WHICH LINK BROUGHT THIS PERSON, when the link said so.
  //
  // It is a query parameter and it has to be, because nothing else survives the
  // trip. Every published game is served under Referrer-Policy: no-referrer, so
  // this fetch sends no Referer and document.referrer is empty; short-form apps
  // open links in an in-app browser that strips the referrer anyway. Measured
  // on the prod table: 2 of 11,260 link plays carry a referrer. What IS in the
  // URL a creator posted arrives intact in every browser there is.
  //
  // READ ONCE, AT LOAD, AND NEVER REMEMBERED. Keeping the tag in storage would
  // attribute a later organic visit to whichever post first sent this browser
  // here, and there is no expiry that is right for everybody's posting rhythm.
  // A visit with no tag on its own URL is untagged, which is the truth about it.
  //
  // THE SHAPE IS CHECKED HERE AS WELL AS AT THE API, for the reason the signal
  // name is: a value that cannot be stored should not cost a request, and the
  // page must behave the same whichever end refused it.
  function linkSource() {
    try {
      var found = /[?&]s=([^&#]*)/.exec(window.location.search || '');
      if (!found) return '';
      var tag = decodeURIComponent(found[1]).toLowerCase();
      return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag) ? tag : '';
    } catch (e) {
      // A malformed escape in somebody's URL. No tag, never a throw.
      return '';
    }
  }

  // ONE VISIT, ONE ID, minted when this page loads and never stored. The
  // browser id above says "the same device"; this says "the same sitting",
  // which is what a session in a chart means. UUIDv7 because that is the
  // shape PostHog accepts for $session_id: 48 bits of milliseconds, then
  // random, so ids sort by time and never collide.
  var PLAYER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var visit = (function () {
    try {
      var t = Date.now();
      var hex = ('000000000000' + t.toString(16)).slice(-12);
      var r = new Uint8Array(10);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(r);
      else for (var i = 0; i < 10; i++) r[i] = Math.floor(Math.random() * 256);
      r[0] = (r[0] & 0x0f) | 0x70;   // version 7
      r[2] = (r[2] & 0x3f) | 0x80;   // RFC 4122 variant
      var tail = '';
      for (var j = 0; j < 10; j++) tail += ('0' + r[j].toString(16)).slice(-2);
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + tail.slice(0, 4) + '-' + tail.slice(4, 8) + '-' + tail.slice(8, 20);
    } catch (e) { return ''; }
  })();

  // THE CAMPAIGN TAGS, read the way `?s=` is: lowercased, bounded, and
  // dropped rather than trusted when they do not look like a tag. A link
  // shared from a post carries these; a link typed by hand carries none.
  function utmTags() {
    var out = {};
    try {
      var search = window.location.search || '';
      var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
      for (var i = 0; i < keys.length; i++) {
        var found = new RegExp('[?&]' + keys[i] + '=([^&#]*)').exec(search);
        if (!found) continue;
        var tag = decodeURIComponent(found[1]).toLowerCase();
        if (/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(tag)) out[keys[i]] = tag;
      }
    } catch (e) { /* a malformed escape: no tags, never a throw */ }
    return out;
  }

  // WHO IS READING, FOR COUNTING, told by the session frame.
  //
  // THE PROBLEM IT SOLVES. This script's `mb.sid` lives on THIS page's origin
  // and the site's own analytics id lives on the app's. Nothing joined them, so
  // a reader who browsed mindblown.ai and then opened a page was two people:
  // measured 2026-09-15, 28 of 1,129 site visitors had a play against their
  // name. The session frame is the app's origin inside this page and can read
  // the one id both sides now share (src/playerId.ts). It is a browser id, not
  // a name, and it grants nothing -- it is told to this page, so it cannot be
  // treated as proof of anything.
  var player = '';
  var playerWatchers = [];
  var playerSettled = false;

  function playerIsKnown(id) {
    if (playerSettled) return;
    if (typeof id === 'string' && PLAYER_ID.test(id)) player = id;
    playerSettled = true;
    var waiting = playerWatchers;
    playerWatchers = [];
    for (var i = 0; i < waiting.length; i++) {
      try { waiting[i](); } catch (e) { /* one bad beacon is not the others' problem */ }
    }
  }

  // A beacon waits for the frame to say who is reading, and not for long.
  //
  // The open beacon fires on load and the frame is made by a second script that
  // has not run yet, so without this the first and most important event of the
  // visit is the one event with nobody on it. The wait is bounded the way the
  // rail's held asks are: a frame that never answers must not silence the page
  // for ever, so after the grace every beacon goes as it always did, without a
  // player id, which is exactly the behaviour before this existed.
  // AND NOTHING WAITS FOR A FRAME THAT IS NOT COMING. The wait is only ever
  // for the rail's session frame, and the rail is a script the SHELL puts in
  // the document before this one runs -- so a page without that tag will never
  // have a frame, and a page that holds its first beacon for a second and a
  // half to learn that has been made slower for nothing. A page framed by the
  // app is told by its parent instead, which is a message and not a wait.
  function railIsComing() {
    try {
      if (document.getElementById('mb-session')) return true;
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].getAttribute('src') || '';
        if (src.indexOf(WEB + '/embed/rail') === 0) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  function whenPlayer(fn) {
    if (playerSettled || playerWatchers.length >= 20) { fn(); return; }
    if (!railIsComing()) { playerIsKnown(''); fn(); return; }
    playerWatchers.push(fn);
    if (playerWatchers.length === 1) {
      window.setTimeout(function () { playerIsKnown(''); }, 1500);
    }
  }

  // What every beacon says about WHERE this visit came from, beside what it
  // says about the game. Nothing here is a claim by the page.
  // THE BROWSER'S TIME ZONE, as the clock settings say it. It is where the
  // browser says it is, read once, and the API keeps only the closed shape
  // of a zone name. A country would need an edge header this host does not
  // have.
  var zone = (function () {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return typeof tz === 'string' && tz.length <= 40 ? tz : '';
    } catch (e) { return ''; }
  })();

  function attribution(body) {
    if (visit) body.visit_id = visit;
    if (player) body.player_id = player;
    if (zone) body.tz = zone;
    var tags = utmTags();
    for (var key in tags) if (Object.prototype.hasOwnProperty.call(tags, key)) body[key] = tags[key];
    return body;
  }

  // The tag alongside whatever the page said, when the link carried one.
  //
  // NEVER OVERWRITTEN. A game that already reports a prop called `source` is
  // describing something of its own, and taking that name from it would put our
  // fact under its label and lose both.
  function withSource(props) {
    var tag = linkSource();
    if (!tag) return props;
    var out = {};
    try {
      for (var key in props) {
        if (Object.prototype.hasOwnProperty.call(props, key)) out[key] = props[key];
      }
      if (out.source === undefined) out.source = tag;
      return out;
    } catch (e) {
      return props;
    }
  }

  // A play, for THIS page's game or for another one on it.
  //
  // IT TAKES AN ID because the entry document is a feed: the game the link
  // named is the first thing on it and the ones under it are its neighbours,
  // and a neighbour scrolled to is played by the same person on the same
  // screen. The frames themselves report nothing -- pod.js stands down inside
  // a frame -- so this document is the only place a play can be counted at all.
  function reportPlay(which) {
    var subject = which || gameId;
    if (!subject) return;
    try {
      // One beacon per game per window, whatever else the page does. A game
      // that re-injects the script, or a bundler that includes it twice, must
      // not double-count a single visit -- and a feed scrolled up and back down
      // must not count the same game twice either.
      var fired = window.__mbPlayed || (window.__mbPlayed = {});
      if (fired[subject]) return;
      var now = Date.now();
      try {
        var last = parseInt(window.localStorage.getItem('mb.p.' + subject) || '0', 10);
        if (last && now - last < DEDUPE_MS) { fired[subject] = true; playLanded(); return; }
        window.localStorage.setItem('mb.p.' + subject, String(now));
      } catch (e) { /* no storage: the server deduplicates too */ }
      fired[subject] = true;
      whenPlayer(function () {
        fetch(API + '/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attribution({
            game_id: subject,
            anon_session: sessionId(),
            source: linkSource()
          })),
          keepalive: true,
          mode: 'cors',
          credentials: 'omit'
        }).then(function () {
          // THE ROW EXISTS NOW, AND IT NAMES NOBODY. This beacon carries no
          // credential and must not: it is called from a stranger's browser
          // and an account named in its body would be a claim anybody could
          // make about anybody. The SHELL around this page holds a session --
          // the frame at /embed/session, on the app's own origin -- so it is
          // told what was just reported and says, with the bearer, that the
          // play was its reader's. See rail/shell.tsx and gamesapi.ClaimPlay.
          //
          // ON THE SEAM AS WELL AS IN AN EVENT, because the two can arrive in
          // either order: the shell may still be deciding whether anybody is
          // signed in when this lands, and a listener attached afterwards
          // would never hear it.
          var said = { id: subject, session: sessionId() };
          try { (window.mindblown || {}).lastPlay = said; } catch (e) { /* no seam yet */ }
          playLanded();
          try {
            window.dispatchEvent(new CustomEvent('mb:play-reported', { detail: said }));
          } catch (e) { /* never throw inside somebody's game */ }
        }, function () { /* a play we could not report is not the game's problem */ });
      });
    } catch (e) { /* never throw inside somebody's game */ }
  }

  // THE BOTTOM INSET, WITH A CEILING ON IT.
  //
  // iOS reports env(safe-area-inset-bottom) as the room the browser's own
  // furniture needs, and on a FIRST load in Safari -- address bar expanded,
  // toolbar full -- that is the toolbar as well as the home indicator.
  // Measured off the live page, iPhone 15 Pro, relic-runner.mindblown.ai: the
  // inset came back at about 109px, so the dock stood 109px off the bottom of
  // the screen and the band asked of the shell was a 152px strip to hold a row
  // of 30px buttons. The game ended a third of the way up the purple. Sasun saw
  // it as "the bottom bar is ugly big", and a reload cured it because by then
  // Safari reports the indicator alone.
  //
  // THE TOOLBAR IS NOT OURS TO RESERVE FOR. It is drawn OVER the page and it
  // goes away on its own; the only inset this bar has to clear is the home
  // indicator, which is 34px and has never been more. So the value is capped
  // there: on every device where the browser tells the truth this is exactly
  // what it said, and it can no longer take a hundred pixels of somebody's
  // game on the strength of one bad read.
  var INSET = 'min(34px,env(safe-area-inset-bottom,0px))';

  // The stylesheet for what this script draws. Every selector is scoped under
  // our own ids, because these rules land in somebody else's page.
  //
  // TWO THINGS AT ONE EDGE. The sound switch sits above the rail's handle, on
  // the right, and the rail comes in beside it when somebody reaches for it.
  // There is no bar across the top any more: what it held is in the rail, and
  // the 46px it took is back with the game.
  var CSS = [
    // -- THE SOUND SWITCH ---------------------------------------------------
    //
    // It is the one control here that belongs to whoever is holding the phone
    // rather than to us or to the creator, and it is the one that has to be
    // reachable without looking for it -- a page making a noise somebody wants
    // stopped is not a moment to go hunting behind a handle. So it is always on
    // screen, in the TOP LEFT corner (Sasun, 2026-09-07).
    //
    // IT IS A SMALL PILL AND NOT A PANEL. At rest it costs a 34px circle in one
    // corner and nothing else: the game keeps its whole viewport, which is the
    // reason the bar across the top was removed.
    //
    // THE CORNER IS NOT EMPTY ON EVERY GAME, and that is the trade. Measured
    // across eight published games when the bar was placed (panel-proof/README):
    // the top strip holds READ-OUTS -- score, timer, health -- and no tappable
    // control in any of the eight, while the bottom held sixteen. A circle in
    // this corner can sit over a number; it cannot sit over a button.
    //
    // THE SAFE AREA IS PART OF THE POSITION. A notch or a rounded corner would
    // otherwise cut the one control somebody reaches for in a hurry.
    //
    // -- THE RAIL IS NOT HERE (spec 38) --------------------------------------
    //
    // It was: a dock and a cross-origin frame, positioned and clipped by this
    // script to the shape the rail reported. The rail is ordinary DOM in the
    // shell now, drawn by the app's own bundle from its own sheet, and this
    // script draws nothing for it. What is left below is the one control the
    // recorder puts on the page.
    // -- THE CLIP, WHEN THERE IS ONE ----------------------------------------
    //
    // The recorder draws nothing while it runs: a control that says RECORDING
    // over somebody's game is our furniture on their screen, and the rail
    // already says it on the rail's own strip. This appears ONCE, when a run
    // has ended and there is a file to keep, and it goes away the moment it is
    // used -- so the game is never sharing the screen with a control nobody
    // needs yet.
    //
    // ABOVE THE BAR, NOT IN IT. --mb-rail-h is the strip the shell holds open
    // for the rail on a phone; sitting inside it would put this on top of the
    // controls somebody is playing with.
    // ONE CONTROL, and it appears only when there is a file to keep.
    // ABOVE THE RAIL'S OWN DOCK, which is 2147483646 and full width at the
    // bottom of a phone. Underneath it this control was drawn and could not be
    // pressed -- the frame took the tap -- on any page that had not yet
    // reserved its band.
    '#mb-clip{position:fixed;z-index:2147483647;left:12px;',
      'bottom:calc(var(--mb-rail-h,0px) + 12px);',
      'display:flex;align-items:center;gap:8px;',
      'margin:0;padding:10px 16px;border:0;border-radius:999px;',
      'font:600 13px/1 system-ui,-apple-system,sans-serif;',
      'color:#fff;background:rgba(18,18,20,.92);',
      'box-shadow:0 8px 24px rgba(0,0,0,.4);cursor:pointer;',
      'padding-bottom:calc(10px + ' + INSET + ');}',
    '#mb-clip:hover{background:rgba(30,30,34,.96)}',
    '#mb-clip:focus-visible{outline:2px solid #ff5a18;outline-offset:2px}',
    '#mb-clip[hidden]{display:none}',
  ].join('');

  // What Mindblown puts on somebody's published page, which is now TWO THINGS
  // AT ONE EDGE and no longer a strip across the top.
  //
  // THE STRIP IS GONE. It carried the way to make your own, the version picker
  // and the creator; the rail at the right edge is the panel this page already
  // had, and all three live there now (mindblown-web/src/gameRail.ts). What the
  // strip cost was the top 46px of every published page -- real layout, taken
  // from the game, on a page whose whole job is the game.
  //
  // THE SOUND SWITCH STAYS HERE and cannot move into the rail. What silences a
  // page is a policy on THIS origin, injected by the resolver as the first
  // script of the document; the rail is the app's origin inside a frame, and a
  // frame cannot reach across that line. So it sits above the rail's handle, on
  // the same edge, drawn by this script.
  function banner() {
    try {
      if (!document.body || document.getElementById('mb-panel-css')) return;

      // Style first: a throw here means no chrome, never unstyled chrome
      // sprawled across the middle of somebody's game.
      var head = document.head || document.documentElement;
      if (!document.getElementById('mb-panel-css')) {
        var css = document.createElement('style');
        css.id = 'mb-panel-css';
        css.appendChild(document.createTextNode(CSS));
        head.appendChild(css);
      }

      // THERE IS NO SWITCH IN THE CORNER ANY MORE. Sasun, 2026-09-09: "remove
      // that sound icon from the top left when sidebar is folded. we don't need
      // that separately."
      //
      // It existed for a drawer somebody had pushed away: the rail carries the
      // sound control, and a folded rail took it off the screen with it. What
      // this costs is one tap -- a muted page is now reached by opening the
      // rail rather than by a control already on screen -- and that is the
      // trade he made. The POLICY is untouched: the rail's own button moves it,
      // and the rail is in this document now, so it calls the policy directly.

      // AND THE SHELL IS TOLD THERE IS NO BAR.
      //
      // A ROLLOUT CROSSES TWO DEPLOYS. This script is served by the API and the
      // shell around it by the resolver, and they ship separately -- so for the
      // minutes between them a shell that still reserves 46px for a bar would
      // hold that band open above a page that no longer draws one. The old
      // shell reads this variable and falls back to 46px only until it is set;
      // set to zero it gives the game the whole window, which is what the new
      // shell does by having no band at all.
      //
      // It stays after the rollout because it is TRUE and it is cheap: this
      // script draws no strip, and it says so to whatever is holding it.
      try {
        document.documentElement.style.setProperty('--mb-panel-h', '0px');
      } catch (e) { /* not in a shell, or no style to set */ }

      sessionSeam();
    } catch (e) { /* chrome that will not render is not worth a broken game */ }
  }

  // THE RAIL IS ORDINARY DOM IN THE SHELL (spec 38), drawn by the app's own
  // bundle -- mindblown-web/src/rail/shell.tsx -- which the shell loads beside
  // this script. It used to be a frame this script placed and clipped, for
  // one reason: a like is a write against whoever is looking, and only the
  // app's origin may hold a session. That reason still holds and it is met
  // by a frame that DRAWS NOTHING -- #mb-session, made by the bundle -- so it
  // has no shape and nothing has to be clipped around it. What this script
  // keeps is the seam between that frame and the page: who is looking, and
  // the asks a page makes that need a session.
  //
  // creator.
  //
  // HIDDEN UNTIL THE PAGE INSIDE SAYS IT HAS A CARD. A game that is unpublished
  // or unknown, or an API that is down, leaves no handle on the edge — a
  // control that opens an empty pane is worse than no control.
  /* -- THE CLIP RECORDER ---------------------------------------------------
   *
   * A person who has to press record before a run and stop after it does not
   * have a recording of the run; they have two more things to do while they
   * are playing. So this is armed by a SETTING, started by the first input,
   * and ended when the picture stops moving.
   *
   * WHAT IT RECORDS IS NOT THE SCREEN, and cannot be: no browser API
   * rasterises a page's DOM, so a HUD, the on-screen controls and the rail are
   * not in the file. What is recordable is the canvas the content draws into.
   *
   * IT DOES NOT RECORD THAT CANVAS EITHER. Each frame is drawn into a canvas
   * of OUR own at half the backing store, and that is what is recorded. Three
   * things come out of owning the surface: the mark goes on it, the pixel
   * count the encoder is paid for is ours to choose, and the frame the motion
   * check reads is already in hand. Measured on relic-runner, 10s phases: the
   * game canvas straight into MediaRecorder cost 4.6 CPU-seconds, this costs
   * 0.95, and neither dropped a frame.
   *
   * THE END IS A MEASUREMENT, NOT A GUESS. Frame-to-frame difference at 48x96,
   * over 6000 frames of the live product: median 19.67 while a run was going,
   * 0.22 once it was over. A floor of 1.0 held for 15 frames fired six times
   * at the end of a run and not once during one, and it cut 0.53s after the
   * page's own state said the run had ended.
   *
   * WHAT IT WILL GET WRONG, said plainly: a page that genuinely stops moving --
   * a turn waiting on a person, a screen somebody is reading -- reads as an
   * ending, and the clip ends early. MIN_MOVING is why a menu cannot end a
   * recording that has nothing in it yet, and nothing here ever throws away a
   * run that is still going.
   */
  // THE MARK, 48px AND INLINE.
  //
  // AN IMAGE FROM ANOTHER ORIGIN TAINTS A CANVAS, and a tainted canvas cannot
  // be recorded at all -- captureStream on one throws. So the badge cannot
  // fetch this from the app the way the rail fetches an avatar: it travels in
  // the bytes. WebP at 64px, which is 3.7KB of the file every published page
  // loads -- a third less than the same mark as a PNG, and sharper. WebP is
  // read by every browser that has MediaRecorder, so it costs no reach: both
  // arrived in Safari 14.
  var MARK = 'data:image/webp;base64,UklGRtQKAABXRUJQVlA4WAoAAAAQAAAAPwAAPwAAQUxQSLUDAAABoLVtmyFJntD7RURjbdu2bdu2vXtu27Zt27Zts3usiu/73oOsrsqMjogJQL0hBUmCnZ//Q/MvT+wJpBhTRLkRVbnC2P72aVANUkrAAic88ea5V9DNSTflTTs89vApa6DUgANHs6ocUtn2pimClBCxH5lVs7FDN9WsvBaxgJRmGzRlrd6yDVJvYwHYl5k1Z14KSEOCZS/+1r0u958v2RCQJgLOarHpW1OQ+lLYk569Cc+Zx0mqTQQfWGbDaj8BUpNIOD47G3c/MYjUE+Q2GgtU3ohQS8DSzF6CK5dBqCNhH1cWqb43Uj17F8PdEesIWIbZSrBsiyLUgYAHSfem3Mh7EFCryFTXDpJZVa0eU9VMjrxpGpHuYkTb2Tf+nQ3/v+OcaBtjJyEAIQASgfkvf+O+XV8w685bT+/y0JtXLAQEAUIAJAwRgVXXBQSA9KC67A6f0zozvr3z0qj2CAAB1l0biBWJWOwO8uSlIEAAZl/lyN/1L2XXkwb8pwOXnxEIgGDJU8gHlkMUQHDoWLrRdkYK2PGNATbpf7+0OULCTkozto6FIMkZpJItviMhLPUPSTX3OtxNSf6ysITwLieRSl7Uk3Ays5N0HzWLPKdUZ5PuytaTmHmUO0nPPA/rjFFnhaOn2prubNydm005mhV6HrvhszRWlc/gXVMWmO1lPE+tUPnYla5tbNL6Uyu9BOe43o0nWTu/cDNaxfg69jNjkZ63x5u0ivmGvZ9QSTpHrTtAL4R/rD6GTlL5XsL6E81Z/cVZrH7Pqtv41RGxH63NMDTujihhyv/pFSvJKsY/e4Mg4CHXSvnZ70YEEg5jHh7K/ZCAgLnG0oeDc9RsEAARj1keDtkeQASAhO2pw0G5TTuEnluo5Slv6wloh1nHmJfmNnZWDIGIs5hLyzwbEUNKmO4vt7LMf58myFCI2JNalnI3RHQa8TC1JOXDiOg4YL6x7uW4j5wLoTNB+JxWjvJtCLqMuNVzOdmvlNRNwp7UcpTbInaD0P+aaynKp3uDdJWwPa2cTRHRtUjfd25lqH/eE1BjwlFsldHi/kh1SJj8a2oJyg97g9SBgJV+cWvO+PMyCKg3YsmJ6k25TlgcEXUnHMZszVjmAehB/RGnkdqEkicgocmIXX5g9ro88/tdENFsxIzPkNnr8Ew+OT0imk5I50wkVb0zVyUnnBGR0LwAS17zD0lXcyfdTJ3kP9ctCQhKlAjMeNhT/7PjgacOnhGIgkJDBDD3Dpe/+NWA+cDnz166w9wAYkCtAFZQOCD4BgAAsB4AnQEqQABAAD5dJI1Fo6IhHP2NVDgFxLYATpl7QBfjfMxpj9X/DfCFkj7N/Kf4q/Qf0AeYB+pnpV/03qg8xv7Ver76OvQA/bLrBvQA/bv03P3D+DP9r/23+AD9lP/vnDv9A/AD9K+/Z4K+If25JfpY34ZYbYDvef7fjW0w2gB+ffVc/xfH79W+wN/Lf7L/yPXG9jPodftA51CR9Pb8N2/TMmaH7yyhzk5mhu3g2GIwJsLBm6ARYorLqy59LM/MsCxbvzXPFAmexeZZpe9+dLrppz2v8wk0tk6egBrT5/RcAckiv4K7PBWL6JG5tq0X26MSHpwffCBXZDGisgAA/g3jGWwpzfcHt3n87D7lZItbex9uQAiPsw+lt3DsQb/4awAMDQzORHlIDpCZ2esDgNm8FuP7Ti+9jxli5eCL+Z+CzSbE3g2gVTtCx6BZhK692iec9eoVJ9/Brn+1gStmbDKs43u045I+q6OzdDDPRh01GBO4OKQ2Zd3KMzhCnCboOZ1lkqeXn7eu8BcblmN+nIrpei5gzOO8pXCYf0PRP+lAChbs9HVLeObDm/2VUIXQcJz2ZipdIA4Em2D0c1ts5Stjtdb7U3dUxO3fHCTGoKhv6ffL2LC8YIk8fsTBpKOJBKeraK9ez4URiUIt1kWLYdvAbWRPU7+Q1+cDJUpsb3gsOxz1KTC5DjFb/O/i/daXhlKTg/6PwW55RHAAs8n9Hm3oxvqBsvOftIv9eFA3P7T/w03LbIWJwD90Z2K8iNCjKV/pRHypWURXT8AxDez+MsIE7a38lREVMUyHh3guYBeSJtweXLq8va0mnaqw66E8mj7FXgkeXAbjMPn3e1q/RRXaOdvCHk8iEmPtZkFqhW8Kjc5oWApfFBPeYLct0kTHMWS46G2rd/5iTxwnUcan307iCKQxg5pf//IRo+zP/G+Wodgk3fSp7SGTSqDR8sN89Kn/tdetSlBL0smWIHgzhviptNV4ND/aaRJdB+Ppf5aifXurEhiOM+jMdqO2Y+39TUzU54E4bqMRPGrYNGGbCodjiyypsEnbrInaG/MU/DTYyBGj1m1zfUnOoVo7dNGTJ46MDwb3GGJnFUi6MGXqCSihmBjjpPHo8yaSQJxcaz5qeVL9hYSFYhpqP/3rCA4+H6HXfhJ05PvjR6hqbP4Bwhsgt5DHxPu+bfdtarD3H8U32ILaZpBpvSfWBa8a+eLobj16UsEO4k5SGxKqkosuugjOOsA1I4pmZcCjp+ToLOLo4mz/ORQHGmIZNwxwd9iDcaIKuEiaLvaT38j0iuiM7fZGQk4ct47CW5U11oZULHO9ylOMrD6gQY5r3R/HxaLLdT4ceM1HEY8sMA8iPzW5kWo3V/W8J05CdApE3t9cuN3qoBlSSvMX8q93pQ99yTjXgEBjheiSzKR/wDGcarOzZpnqeRtc9xmwuEcDQVcJJtRx+0RXLOH2MmbWpzt5dmKmWhoGmXr1yEZUi9vTbvFOraJ0Geb/zoHJuFSxucePssGlKips47t8TXv4CgxDdFZ0qeGNazZ6A70hT5V7zgPfR/wL5lNzfi//rzqHx2kRWAQ1zXVDl6AJuQVtVZTH9NlyeUA8QyIOa/GPBfg3xA6MQZ9gEDoTQK4Jmd1hS9pLeNnV2mgvRwA2aDxKteb38vvy7GYH/+vPmRXAoCD9KKIyETf3PG0Zdxq00/z4aqGYR6Qr8TsMcoxvXJ+3F8gtejix+fb86fYvQtd6hP85j54w/vCX5GEaUmmh4LkJ/PYYkEgB8uVxWEHEeu48P0b9T3Cek/I2+vbO5NVc11PvzyneLktXEcJ1ChX8kASOvIDu5IZOowIOcsgbq9dCXsqtkMP0cXt84AH1+0SKIqkOx05IszCdVMmo5WUu7fjGlAS39r14Uq54m3ZpVCQcIAMWN55fUi99+o41p2hPBdnYl82QwM2FKDq0aaJ6qgGdM31zJP5sX+qvC6y4VG7rCyFH2B1UmtHfBi1EdJOebNQbni7XaQL6UOg+xG1oM51f7YW/ZZaJ5cfV8gwAGu5pfxXr2oo+oXjtK0uPCXrc0Q0CfzVImAQoYoSVYoQv+fDAErwx6sd6WiwiIRWwxkCR38ZvAys9vUuUhqP91JsA6tK/+VjijFFyGzutiD5hLkXN9A/UeuOWXAN2KDPbgX0QvnPqaUo7euSYa88hNjLI0rwpssXEDa6wrR0XTtMTwzh0bRdYUKN//z963FDwg3OhMhgDw1JUcz6ZXE0u/rrJc9xhf7lnqHV9cquVG4fsCNQzV2tzXYCdHygAFnDiiFHux39kQFS0p3o+XXlIgRZZzD3GA/JNHYg9gAf56AyWMXexIhsqm2JIEKe43F2gSdHNFmO1xEWdJHnluNOvgAA=';

  //: The one recorder on this page, once something has armed it. The seam at
  //: the foot of this file hands it what the game says about its own run.
  var recorder = null;

  function clipRecorder(tell) {
    // THE CANVAS'S OWN RESOLUTION, NOT HALF OF IT.
    //
    // Half the backing store is 390x844 on a phone -- CSS pixels, a quarter of
    // the picture the person is actually looking at -- and it showed: Sasun,
    // "recording quality is low". The measured cost of the whole thing is 3.6
    // CPU-seconds per 10 against 0.95, with the frame rate holding at 60 and no
    // dropped frames either way, and this is a recording somebody is going to
    // send to another person.
    //
    // The cap is on the LONGEST SIDE rather than the scale: a desktop canvas
    // can be 3000px, and nobody needs a 3000px clip of a phone game.
    var MAX_SIDE = 1920, FPS = 30, BPS = 6000000;
    // Memory is the ceiling here, not CPU: the parts are held in the tab until
    // the run ends. 60s at 6Mbps is about 45MB, which is where the two numbers
    // balance -- a run that goes past a minute is not the clip anybody shares.
    var MAX_MS = 60000;
    var HOLD = 15, FLOOR = 1.0, MIN_MOVING = 60;
    // A RUN THAT NEVER MOVED IS NOT A RUN, and this is what ends it.
    //
    // The entry document is a feed: somebody can scroll to a neighbour's game
    // and play THAT, and the canvas this recorder holds -- the one on this
    // host -- then sits still for as long as they do. Without this the
    // recording would run to the cap and offer them ninety seconds of a frozen
    // picture of a game they were not playing.
    var DEAD_MS = 6000;

    // THE WINDOW THAT OWNS THE CANVAS, which is not always this one.
    //
    // A WebGL canvas is drawn with preserveDrawingBuffer false by default: its
    // buffer is valid inside the frame that drew it and cleared after. Read
    // from THIS document's animation frame, a canvas one document below is
    // therefore black -- measured on the live product, 90 frames, every one of
    // them empty, while the same read driven by the game's own window came back
    // with content in all 91. The recording that came out of it said
    // "nothing moved" and was thrown away, which was the only honest thing left
    // to do with it.
    //
    // So the loop runs in the canvas's own window: registered after the game's
    // own callback, in the same frame, before the buffer goes.
    var owner = window, odoc = document;
    // Decoded once, when the setting is armed rather than when a run starts:
    // a picture that is still loading is a badge missing from the first
    // seconds of somebody's clip.
    var mark = null;

    var state = 'off';
    // WHETHER THE SETTING IS STILL ON, which is not the same question as what
    // the recorder is doing this second. It is what a finished clip goes back
    // to: one run ending is not the person turning the feature off, and a
    // recorder that stayed at "ready" would record the first run of a session
    // and none of the rest.
    var armed = false;
    // Whether the page has said anything about its own run. The guess below is
    // switched off by the first word, so the two can never disagree.
    var spoken = false;
    // Whether the game said it was paused. A held recording is not a finished
    // one, and it must not be ended by the stillness of its own pause screen.
    var held = false;
    var mr = null, out = null, ctx = null, tiny = null, tctx = null, game = null;
    var parts = [], prev = null, still = 0, moving = 0, startedAt = 0, raf = 0;
    // The recording type, chosen at start and used when the tape opens.
    var kind = '', waited = 0;
    // How many frames the tape waits for a picture before it opens anyway.
    var WAIT = 20;

    function say(next, extra) {
      state = next;
      var body = extra || {};
      body.state = next;
      try { tell('mb-record-state', body); } catch (e) { /* the clip is the point */ }
    }

    // THE BIGGEST CANVAS ANYWHERE THIS DOCUMENT CAN REACH.
    //
    // TWO PLACES, BECAUSE THERE ARE TWO SHAPES. A game opened at its own URL
    // draws into a canvas in this document. A game opened at its own HOST gets
    // the shell -- the entry document is a FEED, and the game itself is in an
    // iframe of the same origin with mb=game on it, where this script runs but
    // stands down. So the canvas being played in is one document below the one
    // holding the rail that arms this.
    //
    // Measured on the live product rather than reasoned about: relic-runner's
    // page frames relic-runner (same origin, one canvas, reachable) AND its
    // neighbour astra (another origin, and not reachable at all). A neighbour
    // is somebody else's game and cannot be recorded from here, which is the
    // right answer as well as the only one.
    //
    // A page may hold several canvases -- a minimap, a gauge, an offscreen
    // scratch -- and the one being played in is the one with the pixels.
    function biggest(doc, best) {
      try {
        var all = doc.getElementsByTagName('canvas');
        for (var i = 0; i < all.length; i++) {
          var c = all[i], size = (c.width || 0) * (c.height || 0);
          if (size > best.area) { best.area = size; best.canvas = c; }
        }
      } catch (e) { /* a document we may not read holds nothing for us */ }
      return best;
    }

    function surface() {
      var best = biggest(document, { canvas: null, area: 0 });
      try {
        var frames = document.getElementsByTagName('iframe');
        for (var i = 0; i < frames.length; i++) {
          // Cross-origin throws on access, and that IS the answer: it is not
          // this game, and nothing here may look inside it.
          try {
            var inner = frames[i].contentDocument;
            if (inner) best = biggest(inner, best);
          } catch (e) { /* another origin; not ours to record */ }
        }
      } catch (e) { /* no frames to look in */ }
      return best.area >= 4096 ? best.canvas : null;
    }

    // WHAT THIS BROWSER WILL WRITE. Safari records MP4 and reads no WebM;
    // Chrome records WebM and offers no MP4. Asking in this order means the
    // file a phone produces is the file that phone can also play and send.
    function mime() {
      var want = ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp8', 'video/webm'];
      for (var i = 0; i < want.length; i++) {
        try {
          if (owner.MediaRecorder && owner.MediaRecorder.isTypeSupported(want[i])) {
            return want[i];
          }
        } catch (e) { /* ask the next one */ }
      }
      return '';
    }

    // THE MARK AND THE WORDS, on a ground of their own.
    //
    // WHERE IT ENDED UP, after trying the rest: the rounded pill it started as,
    // the mark, italic text, dark ground -- moved to the TOP RIGHT and grown
    // from 0.021 of the width to 0.030. Sasun, 2026-09-09: "We keep initial
    // design - rounded rect, icon, italic text. Just move to top and make it a
    // bit bigger."
    //
    // WHAT WAS TRIED AND DROPPED, so nobody spends the afternoon again: an
    // orange ground read beautifully on sky and shouted over every other frame;
    // a parallelogram leaning with the italic looked sharp on its own and like
    // a sticker on somebody's game. The dark pill sits UNDER the picture, which
    // is what a mark on another person's run should do.
    //
    // TOP RIGHT CONTRADICTS THIS FILE'S OWN RULE, deliberately. The rest of
    // pod.js keeps furniture off the top edge because across eight published
    // games that strip is where a score, a timer and a health bar live -- but
    // that rule is about the PAGE. A clip is canvas pixels and a HUD is DOM, so
    // no HUD has ever been in a recording: the top of a clip is scene.
    //
    // THE MARK TRAVELS AS A DATA URI because an image from another origin taints
    // a canvas, and a tainted canvas cannot be recorded at all.
    function badge() {
      // ONE INSET, SO THE TWO GAPS MATCH.
      //
      // It was 3% of the WIDTH from the right and 3.5% of the HEIGHT from the
      // top, which are only equal on a square. On a phone's portrait canvas the
      // top gap came out more than twice the side one; on a landscape canvas it
      // is the side that runs long. Off the shorter side, both are the same
      // number of pixels whatever shape the canvas is.
      var pad = Math.round(Math.min(out.width, out.height) * 0.03);
      var size = Math.round(out.width * 0.030);
      ctx.font = 'italic 600 ' + size + 'px system-ui,-apple-system,sans-serif';
      var text = 'mindblown.ai';
      var face = mark && mark.complete && mark.naturalWidth ? size * 1.5 : 0;
      var w = ctx.measureText(text).width + size * 1.6 + (face ? face + size * 0.5 : 0);
      var h = size * 2.0;
      var x = out.width - w - pad;
      var y = pad;
      var r = h / 2;

      ctx.globalAlpha = 0.72;
      ctx.fillStyle = '#0b0b0e';
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.96;
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      if (face) {
        ctx.drawImage(mark, x + size * 0.55, y + (h - face) / 2, face, face);
        ctx.textAlign = 'left';
        ctx.fillText(text, x + size * 0.55 + face + size * 0.5, y + h / 2 + 1);
      } else {
        ctx.textAlign = 'center';
        ctx.fillText(text, x + w / 2, y + h / 2 + 1);
      }
      ctx.globalAlpha = 1;
    }

    // How much this frame differs from the one before it, on a 48x96 copy. The
    // small canvas is separate from the recorded one: reading pixels back out
    // of the surface an encoder is consuming is work nobody asked for.
    function motion() {
      tctx.drawImage(game, 0, 0, tiny.width, tiny.height);
      var now = tctx.getImageData(0, 0, tiny.width, tiny.height).data;
      var diff = -1;
      if (prev) {
        var sum = 0;
        for (var i = 0; i < now.length; i += 4) sum += Math.abs(now[i] - prev[i]);
        diff = sum / (now.length / 4);
      }
      prev = now;
      return diff;
    }

    // IS THERE A PICTURE ON THE GAME'S CANVAS YET?
    //
    // The brightest sample of the last frame read. A WebGL canvas is drawn
    // with preserveDrawingBuffer false: it holds a picture inside the frame
    // that drew it and reads black outside one. Zero here means the read came
    // back empty, whatever the game has on screen.
    function ink() {
      var top = 0;
      for (var i = 0; i < prev.length; i += 4) {
        if (prev[i] > top) top = prev[i];
        if (prev[i + 1] > top) top = prev[i + 1];
        if (prev[i + 2] > top) top = prev[i + 2];
      }
      return top;
    }

    // WHERE THE TAPE OPENS.
    //
    // captureStream takes whatever is on the canvas the moment it is called,
    // so the tape must open on a frame that HAS the game in it. That frame can
    // only be painted from inside the game's own animation frame -- a copy
    // taken from an input handler, which is where this used to be, is one
    // frame of black with our mark on it, which is the picture Sasun was sent.
    //
    // So the loop below paints first and calls this second, and this runs only
    // once the paint came back with something on it. A page whose opening
    // frame is genuinely black is not held up for longer than WAIT frames.
    function open() {
      mr = new owner.MediaRecorder(out.captureStream(FPS),
        { mimeType: kind, videoBitsPerSecond: BPS });
      mr.ondataavailable = function (e) { if (e.data && e.data.size) parts.push(e.data); };
      mr.onerror = function () { stop('error'); };
      mr.start(1000);
      startedAt = Date.now();
      // Told about a pause before the tape was open: hold it from the start.
      if (held) { try { mr.pause(); } catch (e) { /* it keeps going */ } }
    }

    function frame() {
      if (state !== 'recording') return;
      raf = owner.requestAnimationFrame(frame);
      try {
        ctx.drawImage(game, 0, 0, out.width, out.height);
        badge();
        var diff = motion();
        if (!mr) {
          if (ink() <= 8 && ++waited < WAIT) return;
          open();
        }
        if (diff >= 0) {
          if (diff < FLOOR) still++; else { still = 0; moving++; }
        }
        // A HELD RUN IS NOT A FINISHED ONE. Nothing about a pause screen is
        // evidence, so nothing is read off it.
        if (held) return;
        if (!spoken && still >= HOLD && moving >= MIN_MOVING) return stop('still');
        if (!spoken && !moving && Date.now() - startedAt >= DEAD_MS) return stop('nothing');
        if (Date.now() - startedAt >= MAX_MS) return stop('capped');
      } catch (e) {
        stop('error');
      }
    }

  function start() {
      if (state !== 'armed') return;
      game = surface();
      if (!game) return say('unsupported');
      // Everything below is built in the canvas's own realm -- see `owner`.
      odoc = game.ownerDocument || document;
      owner = odoc.defaultView || window;
      var type = mime();
      if (!type || !game.captureStream) return say('unsupported');
      try {
        out = odoc.createElement('canvas');
        var fit = Math.min(1, MAX_SIDE / Math.max(game.width, game.height, 1));
        // Even numbers: an odd dimension is refused by some encoders.
        out.width = Math.max(2, Math.round(game.width * fit) & ~1);
        out.height = Math.max(2, Math.round(game.height * fit) & ~1);
        ctx = out.getContext('2d', { alpha: false });
        tiny = odoc.createElement('canvas');
        tiny.width = 48; tiny.height = 96;
        tctx = tiny.getContext('2d', { willReadFrequently: true });
        parts = []; prev = null; still = 0; moving = 0; held = false;
        mr = null; kind = type; waited = 0;
        startedAt = Date.now();
        say('recording', { width: out.width, height: out.height });
        // THE TAPE IS OPENED BY THE LOOP, not here. See open().
        raf = owner.requestAnimationFrame(frame);
      } catch (e) {
        say('unsupported');
      }
    }

    function stop(why) {
      if (state !== 'recording') return;
      var ms = Date.now() - startedAt;
      say('finishing', { reason: why });
      try { owner.cancelAnimationFrame(raf); } catch (e) { /* it was the last frame */ }
      // The run ended before the tape ever opened: there is nothing to write.
      if (!mr) return say(armed ? 'armed' : 'off');
      try {
        mr.onstop = function () {
          var blob = new Blob(parts, { type: (mr.mimeType || 'video/webm').split(';')[0] });
          parts = [];
          say('ready', { reason: why, ms: ms, bytes: blob.size });
          // NOTHING TO OFFER FOR A PICTURE THAT NEVER MOVED. The file exists
          // and is dropped here rather than put in front of somebody as their
          // run.
          if (why !== 'nothing') offerClip(blob, ms);
          // And straight back to waiting for the next run, or to off if the
          // setting was turned off while this one was being written.
          say(armed ? 'armed' : 'off');
        };
        mr.stop();
      } catch (e) {
        say('armed');
      }
    }

    function firstInput() { if (state === 'armed') start(); }

    /* WHAT THE GAME SAYS ABOUT ITSELF, which beats anything this can infer.
     *
     * The end of a run is guessed here, from the picture going still, because
     * nothing in a published page has ever said so. A page that DOES say so is
     * exact, and a page that says nothing keeps the guess -- first speaker
     * wins, and the guess is switched off the moment one speaks so that the two
     * can never disagree about the same run.
     *
     * PAUSE IS WHY THIS IS NOT OPTIONAL. A paused game is a still picture,
     * which is the one thing the guess reads as "over": every paused run would
     * end its own clip. Told about a pause, the recorder holds -- MediaRecorder
     * has pause() and resume(), so the clip closes over the gap instead of
     * carrying it.
     */
    function told(name) {
      if (name === 'game_start') {
        spoken = true;
        if (state === 'armed') start();
        return;
      }
      if (name === 'game_pause') {
        spoken = true;
        if (state !== 'recording' || held) return;
        held = true;
        try { mr.pause(); } catch (e) { /* a recorder that will not pause keeps going */ }
        return;
      }
      if (name === 'game_resume') {
        spoken = true;
        if (state !== 'recording' || !held) return;
        held = false;
        still = 0;
        prev = null;
        try { mr.resume(); } catch (e) { /* it never paused */ }
        return;
      }
      if (name === 'game_end') {
        spoken = true;
        if (state === 'recording') stop('ended');
      }
    }

    var INPUTS = ['pointerdown', 'keydown', 'touchstart'];

    // EVERY WINDOW THE PERSON MIGHT BE PLAYING IN, which is not only this one.
    //
    // An event in a child document does not bubble to the document around it.
    // On a game's own host the shell is the document this script runs in and
    // the game is in a frame below it, so a listener on this window alone hears
    // a tap on the bar and NEVER hears a tap on the game. Measured on the live
    // page 2026-09-09: armed, played, and still armed at the end of the run.
    //
    // The same reach as surface(), and for the same reason: same-origin only,
    // because a neighbour's game is neither ours to read nor ours to record.
    function windows() {
      var all = [window];
      try {
        var frames = document.getElementsByTagName('iframe');
        for (var i = 0; i < frames.length; i++) {
          try {
            var w = frames[i].contentWindow;
            // Touching a cross-origin document throws; that is the test.
            if (w && frames[i].contentDocument) all.push(w);
          } catch (e) { /* another origin; not ours to listen to */ }
        }
      } catch (e) { /* this window is the only one */ }
      return all;
    }

    function listen(on) {
      var all = windows();
      for (var w = 0; w < all.length; w++) {
        for (var i = 0; i < INPUTS.length; i++) {
          try {
            if (on) all[w].addEventListener(INPUTS[i], firstInput, true);
            else all[w].removeEventListener(INPUTS[i], firstInput, true);
          } catch (e) { /* a window that will not listen is one we do not hear */ }
        }
      }
    }

    // A PAGE NOBODY IS LOOKING AT IS NOT A RUN. Backgrounding stops the frame
    // callbacks anyway; ending here is what keeps one clip from spanning the
    // gap, and what stops a recorder living on in a hidden tab.
    try {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden && state === 'recording') stop('hidden');
      });
    } catch (e) { /* a page without the event relies on the cap */ }

    return {
      told: told,
      arm: function () {
        armed = true;
        if (!mark) { mark = new Image(); mark.src = MARK; }
        if (state === 'recording' || state === 'armed') return;
        listen(true);
        say('armed');
      },
      disarm: function () {
        armed = false;
        listen(false);
        // A run that was being recorded still produces its clip: the person
        // turned the setting off, which is not the same as throwing away what
        // they had already played.
        if (state === 'recording') stop('disarmed'); else say('off');
      },
      state: function () { return state; }
    };
  }

  /* THE ONE CONTROL THE RECORDER EVER DRAWS, and it is drawn after the run.
   *
   * THE SHARE SHEET NEEDS A TAP AND AN AUTOMATIC ENDING HAS NONE. navigator.share
   * throws without user activation, so a recording that stopped by itself cannot
   * open anything -- which is the whole reason this button exists rather than a
   * sheet appearing on its own.
   *
   * SHARE FIRST, SAVE SECOND. A share sheet is where a phone keeps WhatsApp,
   * Photos and AirDrop; a download is what a desktop understands. Nothing is
   * uploaded anywhere in either case: the file is in the tab until this button
   * hands it to something.
   */
  /* THE CLIP, AND THE ONE THING THAT CAN BE DONE WITH IT HERE.
   *
   * IT IS A DOWNLOAD AND NOTHING ELSE, and the reason is not taste.
   *
   * X's API sends no Access-Control-Allow-Origin -- measured against
   * api.x.com, api.twitter.com and upload.twitter.com from this origin -- so a
   * browser blocks every call to it from a page before a token is even asked
   * for, and their media upload wants an authorised server-side call on a paid
   * tier. The one door a browser can open is x.com/intent/post, and an intent
   * carries TEXT AND A LINK, never a file. A blob: URL is no way round it
   * either: it lives and dies inside the tab that made it, and nothing outside
   * that tab -- least of all a crawler -- can open one.
   *
   * That leaves a hosted clip, which is a service, or the file.
   *
   * BUT A PHONE HAS ONE MORE DOOR, and it is the one that matters: the system
   * share sheet takes a FILE and hands it to an app -- X, Instagram, WhatsApp,
   * Photos. It is the only way a video reaches any of them from a page, and it
   * needs no server at all. So this control is the sheet where there is a
   * sheet and the file where there is not, and it says which it is rather than
   * promising one and doing the other.
   *
   * NOTHING IS UPLOADED EITHER WAY. The clip is in the tab until the person
   * hands it somewhere themselves.
   */
  function offerClip(blob, ms) {
    try {
      var old = document.getElementById('mb-clip');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      if (!document.body || !blob || !blob.size) return;

      var seconds = Math.round(ms / 1000);
      var mp4 = (blob.type || '').indexOf('mp4') > -1;
      var name = 'mindblown-' + (gameId || 'clip') + '-' + seconds + 's.' +
        (mp4 ? 'mp4' : 'webm');
      var url = '';

      var carry = null;
      try { carry = new File([blob], name, { type: blob.type }); } catch (e) { carry = null; }

      // ASKED WITH THE ACTUAL FILE, because that is the question. A browser
      // that shares links and not files answers false to this and true to a
      // bare navigator.share check -- which is how a Share button ends up
      // sharing nothing on a desktop.
      var sheet = false;
      try {
        sheet = !!(carry && navigator.canShare && navigator.canShare({ files: [carry] }));
      } catch (e) { sheet = false; }

      var button = document.createElement('button');
      button.id = 'mb-clip';
      button.type = 'button';
      button.textContent = (sheet ? 'Share \u00b7 ' : 'Download \u00b7 ') + seconds + 's';
      button.setAttribute('aria-label', sheet
        ? 'Share the recording of that run'
        : 'Download the recording of that run');

      function gone() {
        try { if (url) URL.revokeObjectURL(url); } catch (e) { /* the tab is closing */ }
        try { if (button.parentNode) button.parentNode.removeChild(button); } catch (e) { /* gone */ }
      }

      function save() {
        try {
          url = URL.createObjectURL(blob);
          var link = document.createElement('a');
          link.href = url;
          link.download = name;
          document.body.appendChild(link);
          link.click();
          if (link.parentNode) link.parentNode.removeChild(link);
        } catch (e) { /* nothing more this end can do */ }
        gone();
      }

      button.addEventListener('click', function () {
        if (!sheet) return save();
        try {
          navigator.share({ files: [carry] }).then(gone, function (err) {
            // A SHEET SOMEBODY CLOSED IS NOT A FAILURE, and it must not turn
            // into a download they did not ask for. The control stays where it
            // is so they can open it again.
            if (err && err.name === 'AbortError') return;
            save();
          });
        } catch (e) {
          save();
        }
      });

      document.body.appendChild(button);
    } catch (e) { /* a clip nobody can be offered is not the game's problem */ }
  }

  // WHO THE ZONE SAYS IS SIGNED IN, read from the top document.
  //
  // The rail is a FRAME, and a browser may decide a frame gets its own storage
  // -- Sasun asked exactly that: "maybe it's mobile issue? not sharing identity
  // from mindblown.ai to subdomain?". This page is not a frame. A cookie on
  // mindblown.ai reaches it because a published game is a sibling host, and it
  // is the same channel the sound switch has always used.
  //
  // THE SHAPE IS CHECKED BEFORE IT IS PASSED ON, because this value ends up in
  // a URL and a cookie is written by whoever holds the browser. It buys the
  // drawing of a control and nothing else -- the rail asks the API for anything
  // that matters.
  function whoSignedIn() {
    try {
      var found = /(?:^|;\s*)mb_who=([^;]*)/.exec(document.cookie || '');
      var handle = found ? decodeURIComponent(found[1]).toLowerCase() : '';
      return /^[a-z0-9_]{1,32}$/.test(handle) ? handle : '';
    } catch (e) {
      return '';
    }
  }

  // The frame the shell's bundle made for the session, when it has.
  function sessionFrame() {
    try {
      var frame = document.getElementById('mb-session');
      return frame && frame.contentWindow ? frame : null;
    } catch (e) { return null; }
  }

  // THE SEAM BETWEEN THE SESSION FRAME AND THIS PAGE (spec 38).
  //
  // The rail is drawn by the app's bundle in this document, and the session it
  // needs is in a hidden frame on the app's origin that the bundle made. Two
  // things cross from that frame into here, and both are checked the way every
  // message from a frame is: the ORIGIN must be the app's and the SOURCE must
  // be that frame's window. A page cannot forge either.
  //
  //   mb-session-ready  the frame is listening; release the asks held for it
  //   mb-viewer         who is looking -- the same message the app sends a
  //                     page it frames, so there is one setViewer here, and it
  //                     is handed DOWN to the page's own frame as well
  //
  // AND THE RECORDER. The setting is the rail's and the capture is this
  // script's, and they are one window now: a CustomEvent each way, no origin
  // to cross.
  // THE PAGE ASKS WHO IS LOOKING when it starts listening, because a page
  // whose pod.js runs after the viewer was passed down heard nothing, and
  // showed a signed-in person as signed out until the next reload (measured
  // on prod, 1 reload in 10, 2026-09-27).
  var lastViewer = null;

  function answerViewerAsks() {
    window.addEventListener('message', function (event) {
      try {
        if (!lastViewer || event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== 'mb-viewer-ask') return;
        if (!framesOfThisDocument(event.source)) return;
        event.source.postMessage(lastViewer, window.location.origin);
      } catch (e) { /* a malformed message is not the game's problem */ }
    });
  }

  function sessionSeam() {
    try {
      answerViewerAsks();
      window.addEventListener('message', function (event) {
        try {
          var frame = sessionFrame();
          if (!frame) return;
          if (event.origin !== WEB || event.source !== frame.contentWindow) return;
          var data = event.data;
          if (!data) return;
          if (data.type === 'mb-session-ready') {
            railReady = true;
            flushHeldAsks();
            return;
          }
          // WHO IS READING, FOR COUNTING. The frame is the app's origin, so it
          // is the only thing on this page that can read the id the site's own
          // events carry. A page cannot forge this: the origin and the source
          // window are both checked above.
          if (data.type === 'mb-session-state') {
            playerIsKnown(data.player_id);
            return;
          }
          if (data.type === 'mb-viewer') {
            setViewer(data);
            playerIsKnown(data.player_id);
            lastViewer = data;
            // DOWN TO THE PAGE. It is a frame of this document on this
            // document's own origin; a neighbour on another origin drops a
            // message addressed here, which is the right outcome.
            var frames = document.getElementsByTagName('iframe');
            for (var i = 0; i < frames.length; i++) {
              if (frames[i] === frame) continue;
              try { frames[i].contentWindow.postMessage(data, window.location.origin); } catch (e) { /* not ours */ }
            }
          }
        } catch (e) { /* a malformed message is not the game's problem */ }
      });

      var clip = null;
      function tellRail(type, body) {
        try {
          window.dispatchEvent(new CustomEvent('mb:record-state', { detail: body || {} }));
        } catch (e) { /* the clip is the point */ }
      }
      // ARMED IS NOT RECORDING. Arming waits for the person's first input, so
      // turning the setting on between runs does not produce a clip of a menu.
      window.addEventListener('mb:record-arm', function (event) {
        try {
          var on = event && event.detail && event.detail.on;
          if (typeof on !== 'boolean') return;
          if (!clip) clip = recorder = clipRecorder(tellRail);
          if (on) clip.arm(); else clip.disarm();
        } catch (e) { /* a page that cannot record simply does not */ }
      });
    } catch (e) { /* no seam is a rail that can read and cannot write */ }
  }

  // THE PANEL BELONGS TO THE TOP WINDOW, AND ONLY TO IT.
  //
  // A published game is served inside a SHELL: the resolver returns a small
  // document that holds the panel and frames the game underneath it, so the
  // game gets a viewport that is 46px shorter and the bar covers nothing. See
  // deploy/podbot/resolver/worker.js.
  //
  // Both documents load this script -- the shell because it needs the panel,
  // the game because the tag was injected into its own HTML at publish time and
  // is still there. Without this line the game would draw a SECOND bar across
  // the top of its own frame, and report a second play.
  //
  // FRAMED BY US, AND ONLY THAT. Every frame of ours -- the shell's, the app's
  // feed and studio (gameFrame.ts) -- loads the page as `?mb=game`. A shell
  // with no marker in somebody else's frame is an X card, which
  // frame-ancestors has already let in: it is still the shell, and it must
  // relay, count and draw exactly as it does on its own host. Read as framed,
  // it stood down and every room, save and sign-in in the card went nowhere.
  function framed() {
    if (!/[?&]mb=game(&|$)/.test(window.location.search || '')) return false;
    try {
      return window.top !== window.self;
    } catch (e) {
      // A cross-origin top throws on access, which is itself the answer.
      return true;
    }
  }

  // A MARKER DOCUMENT OPENED BY A PERSON IS A LINK THEY WERE SENT.
  //
  // `mb=game` tells the resolver to serve the page WITHOUT the shell -- no
  // rail, no sign-in, nothing of ours. That is right for the frame the shell
  // makes, and wrong for everything else, because the only way a person reaches
  // this URL is that somebody sent it to them.
  //
  // AND PAGES DO SEND IT. A page inside the frame sees the marker on its own
  // `location`, so an invitation built from `location.href` carries it out into
  // somebody's chat. `shareUrl` exists so a page need not, and the first page
  // to build an invitation did it by hand anyway -- twice, after we added it.
  // The link opened, the page ran, and the person could not sign in or take a
  // seat because there was no panel on the page to ask them.
  //
  // SO THE PAGE SENDS THEM WHERE THEY MEANT TO GO. `replace`, not `assign`: the
  // address they were given is not somewhere to go back to.
  //
  // IT CANNOT LOOP. The address this leaves for has no marker, so the resolver
  // answers it with the shell, and the frame the shell makes is a frame -- the
  // check below is false there and this never runs again.
  function sendOnIfThisWasShared() {
    try {
      if (framed()) return false;
      if (!/[?&]mb=game(&|$)/.test(window.location.search || '')) return false;
      var whole = shareUrl();
      if (!whole || whole === window.location.href) return false;
      window.location.replace(whole);
      return true;
    } catch (e) {
      // A redirect that cannot be made leaves the page exactly as it was,
      // which is the behaviour this replaced.
      return false;
    }
  }

  // A DOCUMENT THAT ASKED FOR THE PAGE ALONE GETS THE PAGE ALONE.
  //
  // The resolver serves the entry document under a marker: mb=game is the
  // frame the shell puts the game in, mb=pure is the page with this tag taken
  // out of it entirely. Inside the shell the frame check below already answers,
  // but either marker can be opened DIRECTLY -- and opened that way the frame
  // check says "top window", so the bar was drawn and a play was reported on a
  // URL whose whole purpose is to carry neither. Measured on the live page,
  // 2026-09-03.
  //
  // Read off location, not off the tag: the marker belongs to the request, and
  // the tag is the same bytes on both.
  function bare() {
    try {
      return /[?&]mb=(game|pure)(&|$)/.test(window.location.search || '');
    } catch (e) {
      // Reading location cannot normally throw. If it ever does, the safe
      // answer is the ordinary one: this is a normal load, so behave normally.
      return false;
    }
  }

  // WHAT THE PAGE SAYS ABOUT ITSELF, on whichever road is open to it.
  //
  // TWO TRANSPORTS, ONE CALL. On a game's own URL this posts to the API, the
  // way a play does. Inside the app it CANNOT usefully: the frame is a
  // different origin from the page hosting it, so the reader's session is
  // invisible here -- and a signal that could not say who was watching would be
  // the poorer half of the pair. So it is handed UP, and the app sends it on
  // with the account attached.
  //
  // IT SENDS NO GAME ID UPWARDS, deliberately. The app knows which game it
  // framed. A page a model wrote naming its own id would be a claim, and the
  // one thing worse than an unattributed signal is one attributed to somebody
  // else's game.
  //
  // THE NAME IS CHECKED HERE AS WELL AS AT THE API. A game gets silence rather
  // than a rejection it has no way to see, and a bad name never costs a
  // request.
  /* THE RUN WORDS, TO WHOEVER IS DRAWING ON THIS PAGE (spec 39).
   *
   * A run that ended is the moment the rail has something to offer, and the
   * page is the only thing that knows it happened. Same document, so a
   * CustomEvent and not a message: on a page's own host this script and the
   * rail's bundle are both in the shell.
   *
   * NOT WHEN THIS COPY IS FRAMED. Inside the app the rail is a component of
   * the app itself and hears these through `watchGameSignals`; inside the
   * shell's own frame there is nobody listening at all. Both of those relay
   * upward a line below, and the copy that is NOT framed is the one standing
   * beside a rail.
   */
  var RAIL_HEARS = { game_start: 'mb:run-start', game_end: 'mb:run-end' };

  function tellTheRail(name) {
    try {
      var word = RAIL_HEARS[name];
      if (!word) return;
      window.dispatchEvent(new CustomEvent(word, { detail: { id: current } }));
    } catch (e) { /* a document with no CustomEvent draws no card */ }
  }

  /* WHAT THIS PAGE WANTS COUNTED, so its maker can see it.
   *
   * A page may send any event it likes and always could. This is the short
   * list -- at most five names -- that the maker's numbers are drawn from,
   * each with a KIND that says how to read it and a LABEL for the person.
   * The API keeps it (migrations/69, POST /signals) and pins each kind the
   * first time, so a page that changes its mind about a name is refused
   * rather than silently re-read.
   *
   * IT WAITS FOR THE PLAY. The API accepts a declaration only from a visit it
   * has recorded, the same gate a score passes, and the play beacon is in
   * flight when a page's own script runs. A deduped load counts as landed:
   * the row is from an earlier visit of this browser. If nothing lands in a
   * few seconds it is sent anyway, and the API's refusal costs nothing.
   *
   * ONCE PER LOAD. The list is the same every time, and a second send is a
   * second row-lock on the API for no change.
   *
   * FRAMED, IT GOES UP like a signal does: the shell around a page on its own
   * host reports the play, so the shell holds the session the API will look
   * for, and it is the shell that sends the list.
   */
  /* THE PAGE'S PARAMETERS (spec 51).
   *
   * THE FILE IS THE DECLARATION AND THE VALUES. It rides in the version, so a
   * new value is a new sha and a rollback takes the values back with the code.
   * Nothing here asks the API: a published page's values never change while it
   * runs.
   *
   * CHECKED HERE, NEVER THROWN. A bad entry is left out and a value outside its
   * range is clamped into it, so a page always gets an answer it can use.
   *
   * THE OWNER'S TRY is the one way a value changes while the page runs: the
   * Studio panel posts `mb-tune` from the app's origin, from the window directly
   * above. A page cannot forge either, the wall the viewer message stands
   * behind. Only a frame the panel marked with `mb_tune=1` waits for that
   * answer before its first read -- the feed frames pages from the same origin,
   * and no page in it may start later for a panel it does not have. */
  var TUNE_FILE = 'tune.json';
  var TUNE_MAX = 40;
  var TUNE_TEXT_MAX = 200;
  var TUNE_WAIT_MS = 2000;
  // WHO MAY TRY VALUES ON A PAGE: the app, and the web app's sandbox, where
  // the Studio that draws the panel is built and tested (Sasun, 2026-10-02).
  // Ours and gated, and trusted for THESE messages only: the viewer and the
  // session still answer to the app alone. An answer goes back to the origin
  // that asked, never to one it did not.
  var TUNE_APPS = [WEB, 'https://next.mindblown.ai'];
  var TUNE_NAME = /^[a-z][a-z0-9_]{0,39}$/;
  var TUNE_COLOR = /^#[0-9a-fA-F]{6}$/;
  var tuneFile = null;
  var tuneTrying = null;
  var tuneListeners = [];
  var tuneHeard = null;
  var tuneHeardNow = function () {};

  function tuneEntry(spec) {
    if (!spec || typeof spec !== 'object') return null;
    var value = spec.value;
    var label = typeof spec.label === 'string' ? spec.label.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    if (spec.options && typeof spec.options.length === 'number') {
      var options = [];
      for (var i = 0; i < spec.options.length && options.length < TUNE_MAX; i++) {
        if (typeof spec.options[i] === 'string') options.push(spec.options[i]);
      }
      if (!options.length) return null;
      return { kind: 'choice', options: options, value: options.indexOf(value) >= 0 ? value : options[0], label: label };
    }
    if (spec.kind === 'color') {
      return typeof value === 'string' && TUNE_COLOR.test(value) ? { kind: 'color', value: value, label: label } : null;
    }
    if (spec.kind === 'text') {
      return typeof value === 'string' ? { kind: 'text', value: value.slice(0, TUNE_TEXT_MAX), label: label } : null;
    }
    if (typeof value === 'boolean') return { kind: 'boolean', value: value, label: label };
    if (typeof value !== 'number' || !isFinite(value)) return null;
    if (typeof spec.min !== 'number' || typeof spec.max !== 'number' || !(spec.min <= spec.max)) return null;
    var entry = { kind: 'number', min: spec.min, max: spec.max, value: 0, label: label };
    if (typeof spec.step === 'number' && spec.step > 0) entry.step = spec.step;
    entry.value = tuneChecked(entry, value);
    return entry;
  }

  function tuneChecked(entry, raw) {
    switch (entry.kind) {
      case 'number':
        if (typeof raw !== 'number' || !isFinite(raw)) return entry.value;
        return Math.min(entry.max, Math.max(entry.min, raw));
      case 'boolean':
        return typeof raw === 'boolean' ? raw : entry.value;
      case 'color':
        return typeof raw === 'string' && TUNE_COLOR.test(raw) ? raw : entry.value;
      case 'choice':
        return entry.options.indexOf(raw) >= 0 ? raw : entry.value;
      default:
        return typeof raw === 'string' ? raw.slice(0, TUNE_TEXT_MAX) : entry.value;
    }
  }

  function cleanTune(file) {
    var declared = {};
    if (!file || typeof file !== 'object' || typeof file.length === 'number') return declared;
    var count = 0;
    for (var name in file) {
      if (!Object.prototype.hasOwnProperty.call(file, name) || !TUNE_NAME.test(name)) continue;
      var entry = tuneEntry(file[name]);
      if (!entry) continue;
      declared[name] = entry;
      if (++count >= TUNE_MAX) break;
    }
    return declared;
  }

  function tuneDeclared() {
    if (!tuneFile) {
      tuneFile = new Promise(function (resolve) {
        try {
          fetch(new URL(TUNE_FILE, window.location.href).href, { credentials: 'omit' })
            .then(function (response) { return response.ok ? response.json() : {}; })
            .then(function (file) { resolve(cleanTune(file)); }, function () { resolve({}); });
        } catch (e) { resolve({}); }
      });
    }
    return tuneFile;
  }

  function tuneValues(declared) {
    var values = {};
    for (var name in declared) {
      var trying = tuneTrying && Object.prototype.hasOwnProperty.call(tuneTrying, name);
      values[name] = trying ? tuneChecked(declared[name], tuneTrying[name]) : declared[name].value;
    }
    return values;
  }

  function tuneAsked() {
    try {
      return framed() && new URLSearchParams(window.location.search).get('mb_tune') === '1';
    } catch (e) { return false; }
  }

  // THE PANEL'S ANSWER, waited for at most TUNE_WAIT_MS. A panel that never
  // answers costs a page two seconds once, never a read that does not come.
  function tuneAnswer() {
    if (!tuneHeard) {
      tuneHeard = new Promise(function (resolve) {
        var settle = function () { resolve(); };
        tuneHeardNow = settle;
        setTimeout(settle, TUNE_WAIT_MS);
        // EVERY APP THAT MAY ANSWER is asked; a target that is not the
        // parent's origin is dropped by the browser, unread.
        for (var a = 0; a < TUNE_APPS.length; a++) {
          try { window.parent.postMessage({ type: 'mb-tune-ask' }, TUNE_APPS[a]); } catch (e) { /* not that app */ }
        }
      });
    }
    return tuneHeard;
  }

  function listenForTune() {
    try {
      window.addEventListener('message', function (event) {
        try {
          if (TUNE_APPS.indexOf(event.origin) < 0 || !event.data) return;
          var app = event.origin;
          var asked = event.data.type;
          if (asked !== 'mb-tune' && asked !== 'mb-tune-list') return;
          var parent = null;
          try { parent = window.parent !== window ? window.parent : null; } catch (e) { parent = null; }
          if (!parent || event.source !== parent) return;
          // WHAT THE PAGE DECLARES, for the Studio panel to draw. The panel
          // cannot read tune.json itself: a page's host sends no CORS headers,
          // and it should not have to. Only the app asks, so a page in the
          // feed never fetches the file for this.
          if (asked === 'mb-tune-list') {
            tuneDeclared().then(function (declared) {
              try {
                parent.postMessage({ type: 'mb-tune-declared', declared: declared,
                                     values: tuneValues(declared) }, app);
              } catch (e) { /* the app went away */ }
            });
            return;
          }
          var values = event.data.values;
          tuneTrying = values && typeof values === 'object' ? values : null;
          tuneHeardNow();
          tuneDeclared().then(function (declared) {
            var now = tuneValues(declared);
            for (var i = 0; i < tuneListeners.length; i++) {
              try { tuneListeners[i](now); } catch (e) { /* the page's own handler */ }
            }
          });
        } catch (e) { /* a malformed message is not the page's problem */ }
      });
    } catch (e) { /* no listener: the published values are all there is */ }
  }

  /* A STILL OF THE PAGE, FOR THE OWNER TO POINT AT (Studio's Point).
   *
   * The Studio cannot read a frame on another origin, so it asks the page
   * (`mb-point`) and the page answers with one JPEG of its biggest canvas
   * (`mb-point-still`), to the app that asked and the window above only: the
   * apps that may try values may ask for this too.
   *
   * READ INSIDE THE PAGE'S OWN ANIMATION FRAME. A WebGL canvas is drawn with
   * preserveDrawingBuffer false and reads black outside the frame that drew it
   * -- the clip recorder learned that on the live product. A frame callback
   * asked for now runs after the page's own, so it reads what was just drawn;
   * a black read is tried again for a few frames before it is answered.
   *
   * A PAGE WITH NO CANVAS, or one whose canvas holds another origin's picture,
   * answers why instead, and the Studio lets the owner mark the live page. */
  var POINT_FRAMES = 12;
  var POINT_WIDTH = 1280;

  function pointCanvas() {
    var all = document.getElementsByTagName('canvas'), best = null, area = 0;
    for (var i = 0; i < all.length; i++) {
      var size = (all[i].width || 0) * (all[i].height || 0);
      if (size > area) { area = size; best = all[i]; }
    }
    return area >= 4096 ? best : null;
  }

  function pointStill(done) {
    var canvas = pointCanvas();
    if (!canvas) { done({ reason: 'no-canvas' }); return; }
    var scale = Math.min(1, POINT_WIDTH / canvas.width);
    var out = document.createElement('canvas');
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    var ctx = out.getContext('2d');
    var tries = 0;
    function read() {
      try {
        ctx.drawImage(canvas, 0, 0, out.width, out.height);
        var sample = ctx.getImageData(0, 0, out.width, out.height).data, ink = 0;
        for (var i = 0; i < sample.length; i += 4 * 97) {
          ink = Math.max(ink, sample[i], sample[i + 1], sample[i + 2]);
        }
        if (ink === 0 && ++tries < POINT_FRAMES) { window.requestAnimationFrame(read); return; }
        done({ image: out.toDataURL('image/jpeg', 0.85), width: out.width, height: out.height });
      } catch (e) {
        // A canvas holding a picture from another origin cannot be read back.
        done({ reason: 'unreadable' });
      }
    }
    window.requestAnimationFrame(read);
  }

  function listenForPoint() {
    try {
      window.addEventListener('message', function (event) {
        try {
          if (TUNE_APPS.indexOf(event.origin) < 0 || !event.data || event.data.type !== 'mb-point') return;
          var parent = null;
          try { parent = window.parent !== window ? window.parent : null; } catch (e) { parent = null; }
          if (!parent || event.source !== parent) return;
          var app = event.origin, id = String(event.data.id || '').slice(0, 64);
          pointStill(function (still) {
            try { parent.postMessage({ type: 'mb-point-still', id: id, still: still }, app); } catch (e) { /* gone */ }
          });
        } catch (e) { /* a malformed message is not the page's problem */ }
      });
    } catch (e) { /* no listener: the Studio marks the live page instead */ }
  }

  var MEASURE_KINDS = { count: true, value: true, step: true };
  var measured = false;
  var landed = false;
  var landedWatchers = [];

  function playLanded() {
    landed = true;
    var waiting = landedWatchers;
    landedWatchers = [];
    for (var i = 0; i < waiting.length; i++) {
      try { waiting[i](); } catch (e) { /* the watcher owns its failure */ }
    }
  }

  function whenLanded(fn) {
    if (landed) { fn(); return; }
    var sent = false;
    var once = function () { if (!sent) { sent = true; fn(); } };
    landedWatchers.push(once);
    window.setTimeout(once, 4000);
  }

  function cleanMeasure(list) {
    if (!list || typeof list.length !== 'number' || !list.length || list.length > 5) return null;
    var clean = [];
    for (var i = 0; i < list.length; i++) {
      var one = list[i] || {};
      if (typeof one.name !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(one.name)) return null;
      if (!MEASURE_KINDS[one.kind]) return null;
      var label = typeof one.label === 'string' ? one.label.replace(/\s+/g, ' ').trim() : '';
      clean.push({ name: one.name, kind: one.kind, label: label.slice(0, 40) });
    }
    return clean;
  }

  function declareMeasure(list) {
    try {
      if (!list || !current) return;
      whenLanded(function () {
        fetch(API + '/signals/' + encodeURIComponent(current), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ anon_session: sessionId(), signals: list }),
          keepalive: true,
          mode: 'cors',
          credentials: 'omit'
        }).catch(function () { /* a list we could not send is not the page's problem */ });
      });
    } catch (e) { /* never throw inside somebody's page */ }
  }

  /* A VISIT COSTS A BOUNDED NUMBER OF REQUESTS (spec 50).
   *
   * A signal used to be one request. A page that says fifty things in a
   * visit cost fifty, and a hundred viral pages would have cost billions a
   * day. So what the page says is QUEUED, and the queue leaves at most four
   * times: at the three marks and on leaving. Every row keeps the page's
   * clock, so the API dates it when it happened and not when it left.
   *
   * TWO THINGS DO NOT WAIT. `page_error` goes at once, because a page that
   * broke may not live to the next flush and a marker document never has
   * one. `left` is the last row of the last batch and leaves at once, since
   * hidden is the last moment a phone promises.
   *
   * THE QUEUE IS BOUNDED. A page in a loop fills it to MOST_PENDING and the
   * rest is dropped here, before it costs a request; the API keeps its own
   * budget per visit behind this one.
   */
  var MOST_PENDING = 80;
  var pending = [];

  function queueSignal(name, body) {
    if (!current) return;
    if (pending.length >= MOST_PENDING) return;
    pending.push({ name: name, props: withSource(body), at: Date.now() });
    if (name === 'page_error' || name === 'left') flushSignals();
  }

  function flushSignals() {
    try {
      if (!pending.length || !current) return;
      var rows = pending;
      pending = [];
      var subject = current;
      whenPlayer(function () {
        fetch(API + '/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attribution({
            game_id: subject,
            anon_session: sessionId(),
            sent: Date.now(),
            events: rows
          })),
          keepalive: true,
          mode: 'cors',
          credentials: 'omit'
        }).catch(function () { /* a batch we could not send is not the page's problem */ });
      });
    } catch (e) { /* never throw inside somebody's page */ }
  }

  function sendSignal(name, props) {
    try {
      if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(name)) return;
      // EVERY ROUTE PASSES HERE: what this page said itself, and what the page
      // it frames said and `relaySignals` carried up. One hook, so the card
      // cannot be told about one surface and not the other.
      if (!framed()) tellTheRail(name);
      var body = props && typeof props === 'object' ? props : undefined;
      if (framed()) {
        // TWO PARENTS ARE POSSIBLE, AND ONLY ONE OF THEM WAS EVER ADDRESSED.
        //
        // Inside the app, the parent is mindblown.ai and WEB is its origin.
        // On a game's OWN HOST the parent is the resolver's SHELL, whose origin
        // is the game's own -- so a message addressed to WEB was refused by the
        // browser and every signal from a page on its own host went nowhere.
        // Not rejected and not logged: discarded between two frames of ours.
        //
        // A targetOrigin that does not match is a message the recipient never
        // sees, so BOTH are addressed and at most one is delivered. It is two
        // calls rather than a guess about which parent this is, and a guess
        // that was wrong is what made a whole surface silent.
        //
        // NEVER '*'. That would hand every page that frames this game a copy of
        // what its players do.
        var message = { type: 'mb-signal', name: name, props: body };
        try { window.parent.postMessage(message, WEB); } catch (e) { /* not the app */ }
        try { window.parent.postMessage(message, window.location.origin); } catch (e) { /* not the shell */ }
        return;
      }
      queueSignal(name, body);
    } catch (e) { /* never throw inside somebody's game */ }
  }

  // PLAYED, AND NOBODY HAS TO REMEMBER TO SEND IT.
  //
  // A play is a LOAD. It cannot tell somebody who played from somebody who saw
  // the first frame and left, and counting loads harder will never separate
  // them. The first real input is the difference, and it is a fact this script
  // can observe on its own -- so it does not depend on the model that wrote the
  // game remembering anything, which is the same reason the beacon and the card
  // are injected rather than asked for.
  //
  // ONCE, AND ON THE FIRST OF WHICHEVER ARRIVES. `once` on each listener is not
  // enough: one tap fires pointerdown AND touchstart, and that is one person
  // starting to play rather than two.
  //
  // PASSIVE AND CAPTURE. Passive so a listener of ours can never be the reason
  // a game's scrolling stutters; capture so a game that stops an event before
  // it bubbles does not stop us seeing it.
  // HOW LONG SOMEBODY STAYED, which is the number a play count cannot hold.
  //
  // WHY THIS IS IN THE PAGE AND NOT IN OUR ANALYTICS. On mindblown.ai a page
  // analytics tool measures dwell for us. A game opened from a LINK somebody
  // pasted into a chat has no such thing on it and never will — that is most of
  // where games are played, and it is the half nobody was measuring. This
  // script is on every one of those pages already.
  //
  // VISIBLE TIME, NOT WALL TIME. A tab left open behind a phone call is not ten
  // minutes of play, and counting it as such would make the number worthless in
  // exactly the cases somebody would want to look at.
  var visibleMs = 0;
  var visibleSince = 0;

  function visible() {
    try {
      return document.visibilityState !== 'hidden';
    } catch (e) {
      // No Page Visibility API. Treating the page as visible is the honest
      // default: it is the ordinary state, and the alternative records zero.
      return true;
    }
  }

  function heldFor() {
    var held = visibleMs;
    if (visibleSince) held += Date.now() - visibleSince;
    return Math.round(held / 1000);
  }

  // A FLOOR THAT SURVIVES THE TAB DYING, which is why these exist at all beside
  // the exit below. A phone reclaims a backgrounded tab without running any of
  // the leave events, so an exit-only design loses exactly the sessions worth
  // measuring, and loses them unevenly — phones more than desktops. A mark that
  // arrived is a fact: they stayed at least that long.
  //
  // THREE OF THEM, AND NO MORE. This is an append-only table and a game is a
  // page somebody may leave open all day; a ticking heartbeat would be a row
  // every minute for ever. Fifteen seconds tells a scroll-past from a look, a
  // minute tells a look from a session, five minutes says they are properly in
  // it, and anything past that is what the exit is for.
  var MARKS = [15, 60, 300];
  var marked = 0;
  var timer = null;

  function tick() {
    try {
      if (marked >= MARKS.length) return;
      if (heldFor() >= MARKS[marked]) {
        var reached = MARKS[marked];
        marked++;
        sendSignal('still_here', { seconds: reached });
        flushSignals();
      }
      schedule();
    } catch (e) { /* never throw inside somebody's game */ }
  }

  function schedule() {
    try {
      if (timer) { clearTimeout(timer); timer = null; }
      if (marked >= MARKS.length || !visible()) return;
      var wait = (MARKS[marked] - heldFor()) * 1000;
      timer = setTimeout(tick, wait > 250 ? wait : 250);
    } catch (e) { /* the marks are a bonus; the game is the page */ }
  }

  // THE EXIT, WHICH IS THE PRECISE NUMBER WHEN IT ARRIVES AND IS ALLOWED NOT TO.
  //
  // pagehide, not unload: unload is ignored by every browser that keeps a page
  // in the back-forward cache, so a listener on it fires for some readers and
  // not others — which is the worst shape a measurement can have.
  //
  // ONCE. A page can be hidden and shown several times, and each of those is
  // the same visit; the seconds already counted go with the one report.
  var left = false;

  function reportLeaving() {
    try {
      if (left) return;
      left = true;
      if (timer) { clearTimeout(timer); timer = null; }
      sendSignal('left', { seconds: heldFor(), played: playedAlready });
    } catch (e) { /* never throw inside somebody's game */ }
  }

  function watchTime() {
    try {
      visibleSince = visible() ? Date.now() : 0;
      schedule();
      document.addEventListener('visibilitychange', function () {
        try {
          if (visible()) {
            if (!visibleSince) visibleSince = Date.now();
            schedule();
            return;
          }
          if (visibleSince) {
            visibleMs += Date.now() - visibleSince;
            visibleSince = 0;
          }
          if (timer) { clearTimeout(timer); timer = null; }
          // HIDDEN IS THE LAST MOMENT WE ARE CERTAIN OF. On a phone the tab may
          // never be given another one, so the report goes now rather than at
          // an exit that is not promised.
          reportLeaving();
        } catch (e) { /* nothing here may break the page */ }
      });
      window.addEventListener('pagehide', reportLeaving);
    } catch (e) { /* the clock is a bonus; the game is the page */ }
  }

  // WHEN THE PAGE IS BROKEN, WHICH IT CURRENTLY TELLS NOBODY.
  //
  // A published page that throws on load looks identical to one nobody opened:
  // the play is recorded, the person leaves, and there is nothing anywhere
  // saying the game never started. The person who made it finds out when they
  // open their own link, if they ever do.
  //
  // ONE PER PAGE. A broken render loop throws sixty times a second, and the
  // second error says nothing the first did not.
  var toldAboutError = false;

  function watchForErrors() {
    function tell(message, source, line, col) {
      try {
        if (toldAboutError) return;
        toldAboutError = true;
        // BOUNDED HERE TOO, not only at the API. The text is a stranger's, it
        // can be a whole stack, and the column it lands in is 120 characters.
        var props = {
          message: String(message == null ? '' : message).slice(0, 120),
          source: String(source || '').slice(0, 120)
        };
        // WHERE IN THE FILE (spec 60). The builder that wrote the file goes to
        // the line; a message alone can be any of a dozen.
        if (line > 0) props.line = Math.floor(line);
        if (col > 0) props.col = Math.floor(col);
        sendSignal('page_error', props);
      } catch (e) { /* an error about an error helps nobody */ }
    }
    try {
      window.addEventListener('error', function (event) {
        // A FAILED IMAGE OR SCRIPT IS NOT A THROWN ERROR, and it is the more
        // common break: an asset the publish did not carry. It arrives here as
        // an event with a target and no message.
        var target = event && event.target;
        if (target && target !== window && (target.src || target.href)) {
          tell('failed to load', target.src || target.href);
          return;
        }
        tell(event && event.message, event && event.filename, event && event.lineno, event && event.colno);
      }, true);
      window.addEventListener('unhandledrejection', function (event) {
        var reason = event && event.reason;
        tell(reason && reason.message ? reason.message : reason, '');
      });
    } catch (e) { /* nothing here may break the page */ }
  }

  // Whether anybody touched this page. Read by the exit report, so a visit can
  // be told apart from a look without joining two tables to find out.
  var playedAlready = false;

  function watchForPlay() {
    function played() {
      if (playedAlready) return;
      playedAlready = true;
      sendSignal('played', { seconds: heldFor() });
    }
    var kinds = ['pointerdown', 'keydown', 'touchstart'];
    for (var i = 0; i < kinds.length; i++) {
      try {
        document.addEventListener(kinds[i], played, { capture: true, passive: true });
      } catch (e) {
        // A browser too old for an options object. The listener matters more
        // than the options do.
        try {
          document.addEventListener(kinds[i], played, true);
        } catch (e2) { /* give up on this one kind */ }
      }
    }
  }

    // WHO IS LOOKING, TOLD BY WHOEVER IS ENTITLED TO SAY.
  //
  // THIS LISTENER IS NOT INSIDE banner(), and that is the whole point of it
  // existing separately. banner() stands down inside a frame, so the app -- the
  // one surface that knows for certain who is looking, because it holds the
  // session in its own top document -- had nothing to say it to. A game played
  // at mindblown.ai/games/<slug> could only ever fall back to the zone cookie,
  // while the same game on its own host had that AND the rail. The surface with
  // the most certain answer was the one with the fewest ways to deliver it.
  //
  // TWO SENDERS, BOTH NAMED BY THE BROWSER AND NEITHER BY THE PAGE:
  //
  //   the rail's frame   a window this script created, on the app's origin;
  //   the app itself     window.parent, when this document is framed by it.
  //
  // A game cannot forge either. `event.origin` is the browser's word for who
  // sent it and `event.source` is its word for which window, so a page that
  // posts to itself, or frames something of its own to post from, is refused --
  // the same wall the sound switch stands behind, and it matters more here.
  function listenForViewer() {
    try {
      window.addEventListener('message', function (event) {
        try {
          // TWO PARENTS CAN SAY IT, and the browser names both: the app, on
          // its own origin, when it frames this page; and the shell, on THIS
          // page's origin, which relays what the session frame told it
          // (spec 38). Either way it is the window directly above this one.
          if (event.origin !== WEB && event.origin !== window.location.origin) return;
          if (!event.data || event.data.type !== 'mb-viewer') return;
          var parent = null;
          try { parent = window.parent !== window ? window.parent : null; } catch (e) { parent = null; }
          if (event.source !== parent) return;
          setViewer(event.data);
          playerIsKnown(event.data.player_id);
        } catch (e) { /* a malformed message is not the game's problem */ }
      });
      // The shell answers this; the app names the page again on its load
      // event, and a parent on another origin never receives it.
      window.parent.postMessage({ type: 'mb-viewer-ask' }, window.location.origin);
    } catch (e) { /* no listener is the cookie-only page we already had */ }
  }

  // WHICH WINDOW SENT IT, ASKED OF THE DOCUMENT RATHER THAN OF ONE ID.
  //
  // This looked for `mb-game`, and the shell the resolver actually serves gives
  // its game iframe NO id -- the game is a slide in a deck (worker.js gameShell)
  // and the deck names the section, not the frame. So the lookup found nothing,
  // every relayed message was refused, and the surface stayed silent in exactly
  // the way the relay was written to stop.
  //
  // The id was never the wall anyway. The wall is the pair the browser fills
  // in: the message must come from this document's own origin AND from a
  // window this document frames. Both are unforgeable, and neither needs the
  // frame to be named.
  function framesOfThisDocument(source) {
    try {
      if (!source) return false;
      var frames = document.getElementsByTagName('iframe');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === source) return true;
      }
    } catch (e) { /* a frame we may not touch is not one of ours */ }
    return false;
  }

  // THE SHELL CARRIES ITS GAME'S SIGNALS OUT.
  //
  // The resolver serves a game's entry document as a SHELL that frames the game
  // (worker.js gameShell). Both documents load this script: the shell is the
  // top window and can reach the API; the framed game cannot report for itself,
  // because pod.js stands down inside a frame.
  //
  // Nothing joined the two. The game posted, nobody listened, and the message
  // was addressed to an origin its parent did not have -- so a page on its own
  // host could say `played`, `left` or that a run had started, and none of it
  // arrived. The app surface worked, which is why the counts looked plausible.
  //
  // ONLY ITS OWN GAME, and the browser is what says so: the message must come
  // from this document's own origin (one origin per game) and from a window
  // this document frames. A page cannot forge either.
  function relaySignals() {
    try {
      window.addEventListener('message', function (event) {
        try {
          if (event.origin !== window.location.origin) return;
          var data = event.data;
          if (!data) return;
          if (!framesOfThisDocument(event.source)) return;
          if (data.type === 'mb-measure') { declareMeasure(cleanMeasure(data.signals)); return; }
          if (data.type !== 'mb-signal') return;
          if (typeof data.name !== 'string') return;
          // THE FRAME SAW THE INPUT AND THIS DOCUMENT CANNOT: its exit
          // report carries the frame's answer.
          if (data.name === 'played') playedAlready = true;
          sendSignal(data.name, data.props);
        } catch (e) { /* a malformed message is not the game's problem */ }
      });
    } catch (e) { /* no relay is the surface we already had */ }
  }

  // THE SHELL CARRIES ITS GAME'S ASKS TO THE RAIL.
  //
  // Same shape as relaySignals, one hop further. The framed game holds no
  // session and the shell holds none either -- the rail's frame is the only
  // window on this host that does, and the framed game cannot address it: a
  // frame may only post to its parent or to a frame it created itself.
  //
  // So the shell stands between them. It takes a submission from the game it
  // frames, hands it to the SESSION FRAME the rail's bundle made (spec 38), and
  // hands the answer back down. `railWindow` below is that frame.
  //
  // ONLY ITS OWN GAME AND ONLY ITS OWN RAIL, and the browser says so both
  // ways: the submission must come from this document's origin and from the
  // window this document frames; the answer must come from WEB and from the
  // rail frame this document created. Neither can be forged by a page.
  var railReady = false;
  var heldAsks = [];
  // HOW LONG AN ASK WAITS FOR THE SESSION FRAME: to be made, and to say hello.
  // Under the page's own eight seconds, so a held ask is still answered in time.
  // An ask made before the frame EXISTS is held too: the page's saves can now be
  // asked for on its first line, before this document has made the frame, and
  // an ask dropped then waited the full eight seconds for STORAGE_UNAVAILABLE
  // (measured on prod, 2026-09-26, signed out on a page's own host).
  var HOLD_MS = 5000;

  function holdForTheRail(send) {
    if (heldAsks.length >= 20) return false;
    heldAsks.push(send);
    if (heldAsks.length === 1) {
      window.setTimeout(function () {
        if (!railReady) flushHeldAsks();
      }, HOLD_MS);
    }
    return true;
  }

  // Everything the shell was asked to relay before the rail was listening, in
  // the order it was asked. Bounded, because a rail that never arrives must not
  // grow a list for ever -- and a page whose ask is dropped still has its own
  // timeout, which is the behaviour it had before any of this.
  //
  // AND BOUNDED IN TIME, WHICH THE FIRST VERSION WAS NOT. Holding until the
  // rail says hello assumes it always does; a rail that never sends the hello
  // held every ask for ever, and the page's own four seconds could not save it
  // because nothing was ever sent. So the wait has its own clock: a short grace
  // for the frame to mount, then send anyway and let the asker time out the way
  // it always could.
  function flushHeldAsks() {
    var waiting = heldAsks;
    heldAsks = [];
    for (var i = 0; i < waiting.length; i++) {
      try { waiting[i](); } catch (e) { /* one bad ask is not the others' problem */ }
    }
  }

  function relayBrokeredAsks() {
    var asked = {};
    var askedBy = {};
    // Live channels: the window that opened each, for as long as it is open.
    var liveBy = {};
    // The window that asked for the invite sheet, until the sheet is closed.
    var inviteBy = {};

    // THE SHEET ANSWERS THE FRAME THAT ASKED, AND NO OTHER. The shell's bundle
    // says it has the card, and later says what happened; both are events in
    // this document, so neither can be forged by the page.
    function fromTheSheet(name, answer) {
      try {
        window.addEventListener(name, function (event) {
          try {
            var detail = (event && event.detail) || {};
            var who = inviteBy[detail.id];
            if (!who) return;
            var said = answer(detail);
            if (name === 'mb:invite-done') {
              delete inviteBy[detail.id];
              delete pickBy[detail.id];
            }
            who.postMessage(said, window.location.origin);
          } catch (e) { /* the frame went away; the page has its own answer */ }
        });
      } catch (e) { /* no listener, so the page hears nothing and closes */ }
    }
    // THE ITEM PICKER (spec 59) is drawn by the same lazy bundle on the same
    // event, so its asks are remembered here and answered in its own words.
    var pickBy = {};
    fromTheSheet('mb:invite-ack', function (detail) {
      return { type: pickBy[detail.id] ? 'mb-items-pick-opened' : 'mb-invite-opened', id: detail.id };
    });
    fromTheSheet('mb:invite-done', function (detail) {
      if (pickBy[detail.id]) {
        return detail.cancelled === true || !('picked' in detail)
          ? { type: 'mb-items-pick-done', id: detail.id, cancelled: true }
          : { type: 'mb-items-pick-done', id: detail.id, picked: detail.picked };
      }
      return {
        type: 'mb-invite-done',
        id: detail.id,
        sent: Number(detail.sent) || 0,
        closed: !detail.sent
      };
    });
    function railWindow() {
      var frame = sessionFrame();
      return frame ? frame.contentWindow : null;
    }
    try {
      window.addEventListener('message', function (event) {
        try {
          var data = event.data;
          if (!data || typeof data.id !== 'string') return;

          if (data.type === 'mb-storage-ask' || data.type === 'mb-creations-ask' || data.type === 'mb-live-create' || data.type === 'mb-matches-ask' || data.type === 'mb-world-ask' || data.type === 'mb-push-ask' || data.type === 'mb-items-ask' || data.type === 'mb-generate-ask') {
            if (event.ports.length !== 1) {
              event.ports.forEach(function (port) { port.close(); });
              return;
            }
            var storagePort = event.ports[0];
            if (event.origin !== window.location.origin || !framesOfThisDocument(event.source) ||
                typeof data.document !== 'string' || data.game_id !== gameId) {
              storagePort.close();
              return;
            }
            var storageSource = event.source;
            var storagePage = storageSource.document;
            var sendStorage = function () {
              var storageTarget = railWindow();
              try {
                if (storageTarget && storageSource.document === storagePage) {
                  storageTarget.postMessage(data, WEB, [storagePort]);
                } else storagePort.close();
              } catch (e) { storagePort.close(); }
            };
            if (railReady || !holdForTheRail(sendStorage)) sendStorage();
            return;
          }

          // A ROOM IS RELAYED THE SAME WAY (spec 37). One relay for both,
          // because "the shell stands between its game and the rail" is one
          // rule, and two relays is how one of them gets written and the
          // other is remembered a month later.
          if (data.type === 'mb-room-ask') {
            if (event.origin !== window.location.origin) return;
            if (!framesOfThisDocument(event.source)) return;
            var roomAsker = event.source;
            asked[data.id] = true;
            askedBy[data.id] = roomAsker;
            var sendIt = function () {
              try {
                var now = railWindow();
                if (now) { now.postMessage(data, WEB); return; }
                delete asked[data.id];
                delete askedBy[data.id];
                roomAsker.postMessage({ type: 'mb-room-result', id: data.id, ok: false }, window.location.origin);
              } catch (e) { /* the asker has its own timeout */ }
            };
            if (railReady || !holdForTheRail(sendIt)) sendIt();
            return;
          }

          // THE INVITE SHEET IS DRAWN IN THIS DOCUMENT (spec 40), not in the
          // session frame: it is a card over the page, and the shell's own
          // bundle draws it. So this is not a relay to the rail -- it is a
          // relay to the other half of this window, over events, the way the
          // recorder's two halves already talk.
          if (data.type === 'mb-items-pick-open') {
            if (event.origin !== window.location.origin) return;
            if (!framesOfThisDocument(event.source)) return;
            inviteBy[data.id] = event.source;
            pickBy[data.id] = true;
            try {
              window.dispatchEvent(new CustomEvent('mb:invite-open', {
                detail: {
                  id: data.id, game_id: gameId, sheet: 'pick',
                  kind: String(data.kind || ''),
                  current: typeof data.current === 'string' ? data.current : null,
                  own: Array.isArray(data.own) ? data.own : [],
                  title: typeof data.title === 'string' ? data.title : '',
                  quality: qualityOf(data.quality)
                }
              }));
            } catch (e) {
              delete inviteBy[data.id];
              delete pickBy[data.id];
            }
            return;
          }

          if (data.type === 'mb-invite-open') {
            if (event.origin !== window.location.origin) return;
            if (!framesOfThisDocument(event.source)) return;
            inviteBy[data.id] = event.source;
            try {
              window.dispatchEvent(new CustomEvent('mb:invite-open', {
                // THE PAGE'S ID TRAVELS WITH THE ASK. This document already
                // holds it and checked it; the half that draws the card then
                // needs nothing of its own to know which page asked.
                detail: { id: data.id, room: String(data.room || ''), game_id: gameId }
              }));
            } catch (e) {
              delete inviteBy[data.id];
            }
            return;
          }

          if (data.type === 'mb-room-result') {
            if (event.origin !== WEB) return;
            if (event.source !== railWindow()) return;
            if (!asked[data.id]) return;
            delete asked[data.id];
            var who = askedBy[data.id];
            delete askedBy[data.id];
            if (!who) return;
            who.postMessage(data, window.location.origin);
            return;
          }

          // A LIVE CHANNEL IS RELAYED THE SAME WAY (spec 39), for the life of
          // the channel rather than for one answer: the page opens it, the
          // session frame holds the socket, and every message either way is
          // matched to the window that opened it by the channel's id.
          if (data.type === 'mb-live-open' || data.type === 'mb-live-send' ||
              data.type === 'mb-live-close') {
            if (event.origin !== window.location.origin) return;
            if (!framesOfThisDocument(event.source)) return;
            var toSession = railWindow();
            if (data.type === 'mb-live-open') {
              if (!toSession) {
                try {
                  event.source.postMessage(
                    { type: 'mb-live-opened', id: data.id, ok: false, status: 0,
                      reason: '', error: 'live rooms need the mindblown panel on this page' },
                    window.location.origin);
                } catch (e) { /* the page has its own timeout */ }
                return;
              }
              liveBy[data.id] = event.source;
            } else if (liveBy[data.id] !== event.source) {
              return;   // not the window that opened this channel
            }
            if (data.type === 'mb-live-close') delete liveBy[data.id];
            try { if (toSession) toSession.postMessage(data, WEB); } catch (e) { /* closing */ }
            return;
          }
          if (data.type === 'mb-live-opened' || data.type === 'mb-live-tick' ||
              data.type === 'mb-live-closed') {
            if (event.origin !== WEB) return;
            if (event.source !== railWindow()) return;
            var owner = liveBy[data.id];
            if (!owner) return;
            if (data.type === 'mb-live-closed' || (data.type === 'mb-live-opened' && !data.ok)) {
              delete liveBy[data.id];
            }
            try { owner.postMessage(data, window.location.origin); } catch (e) { /* gone */ }
            return;
          }

          // THE READ AND THE WRITE TAKE ONE ROAD. A board read made by the
          // page carries no session, so the server keys the caller by browser
          // while a signed-in person's row is keyed by account -- and `mine`
          // compares the two, so it was false for exactly the people who were
          // signed in. Relayed here, the rail reads it as the person.
          if (data.type === 'mb-leaderboard-submit' || data.type === 'mb-leaderboard-top') {
            var answerType = data.type === 'mb-leaderboard-top'
              ? 'mb-leaderboard-rows' : 'mb-leaderboard-result';
            if (event.origin !== window.location.origin) return;
            if (!framesOfThisDocument(event.source)) return;
            var rail = railWindow();
            // No rail is no broker: say so now rather than let the game wait
            // out its timeout for an answer nobody is going to send.
            if (!rail) {
              try {
                event.source.postMessage(
                  { type: answerType, id: data.id, ok: false },
                  window.location.origin);
              } catch (e) { /* the game falls back on its own clock */ }
              return;
            }
            asked[data.id] = true;
            // The answer goes back to the window that asked, and to no other.
            askedBy[data.id] = event.source;
            rail.postMessage(data, WEB);
            return;
          }

          if (data.type === 'mb-leaderboard-result' || data.type === 'mb-leaderboard-rows') {
            if (event.origin !== WEB) return;
            if (event.source !== railWindow()) return;
            if (!asked[data.id]) return;
            delete asked[data.id];
            var back = askedBy[data.id];
            delete askedBy[data.id];
            if (!back) return;
            back.postMessage(data, window.location.origin);
          }
        } catch (e) { /* a malformed message is not the game's problem */ }
      });
    } catch (e) { /* no relay is the surface we already had */ }
  }

  // A LEADERBOARD FOR THIS PAGE.
  //
  // THE READ IS A PLAIN FETCH AND THE WRITE IS NOT, and that asymmetry is the
  // whole design. A board is public, so anybody may read it with no credential.
  // A submission has to say WHO, and this page holds no token and never will --
  // so it posts to the API and the API takes the account from the route when
  // there is one. Inside the app that is the reader's session; on a game's own
  // host it is nobody yet, and the row is keyed on the browser instead.
  //
  // THE VALUE IS A CLAIM AND THE SDK SAYS SO. It is computed here, on a machine
  // we do not own, by code a person can read and change. What the server can
  // promise is who submitted and that everybody on one board played under the
  // same rules.
  function leaderboardURL(metric, extra) {
    return API + '/games/' + encodeURIComponent(gameId) +
      '/leaderboard/' + encodeURIComponent(metric) + (extra || '');
  }

  // WHO GETS THE ROW, AND WHY THE PAGE CANNOT SAY.
  //
  // The API takes the account from the ROUTE and ignores the body: a body that
  // could name its own subject would let any page write anybody onto any board.
  // So a page has nothing it is ALLOWED to send, and it holds no token, so it
  // has nothing to prove anything WITH either. On its own that leaves every row
  // anonymous, which is what shipped: a board that says `guest` for somebody who
  // is signed in.
  //
  // The way across is the channel the viewer already uses, run backwards:
  // something that HOLDS the session does the POST. There are two, and the
  // browser names both.
  //
  //   the rail's frame   a window this script created, on the app's origin
  //   the app itself     window.parent, when the app is framing this game
  //
  // A CORRELATION ID, because this is a request and an answer rather than a
  // notification, and two submissions can be in flight at once.
  //
  // Only a page without a broker can submit directly. A failed broker request
  // must not change the score's owner through an anonymous retry.
  var brokerWaiting = {};
  var brokerSeq = 0;

  function brokerWindow() {
    // THE SESSION FRAME, when this document has one (spec 38): the shell's
    // bundle made it, and it is the one window on this host that holds a
    // session. A framed page has no such frame and asks its parent, which is
    // the shell on its own host or the app inside the app; both relay or
    // answer.
    try {
      var session = document.getElementById('mb-session');
      if (session && session.contentWindow) return session.contentWindow;
    } catch (e) { /* no session frame on this surface */ }
    try {
      if (window.parent && window.parent !== window) return window.parent;
    } catch (e) { /* no reachable parent */ }
    return null;
  }

  var storageDocument = '';
  try { storageDocument = crypto.randomUUID(); } catch (e) { /* no secure document identity */ }
  var storageSeq = 0;

  function storageFailure(reason, message, status, limits) {
    var error = new Error(message);
    error.reason = reason;
    error.status = status || 0;
    error.needsAccount = status === 401;
    if (limits) error.limits = limits;
    return error;
  }

  function documentAsk(ask, resultType, timeoutMs, unavailable, timeoutMessage) {
    return new Promise(function (resolve, reject) {
      var target = brokerWindow();
      if (!target || !gameId || !storageDocument || typeof MessageChannel !== 'function') {
        return reject(storageFailure(unavailable, 'this request needs the mindblown panel'));
      }
      ask.id = storageDocument + ':' + (++storageSeq);
      ask.document = storageDocument;
      ask.game_id = gameId;
      var channel = new MessageChannel();
      var settled = false;
      function closeRequest() {
        settled = true;
        window.clearTimeout(timer);
        channel.port1.close();
        channel.port2.close();
      }
      var timer = window.setTimeout(function () {
        closeRequest();
        reject(storageFailure(unavailable, timeoutMessage));
      }, timeoutMs);
      channel.port1.onmessage = function (event) {
        var data = event.data;
        if (settled || !data || data.type !== resultType || data.id !== ask.id || data.document !== storageDocument) return;
        closeRequest();
        if (data.ok) resolve(data.result);
        else reject(storageFailure(data.reason || unavailable, data.error || 'the request failed', data.status, data.limits));
      };
      var targetOrigin = WEB;
      try {
        if (target.location.origin === window.location.origin) targetOrigin = window.location.origin;
      } catch (e) { /* the app or session owns the cross-origin broker */ }
      try {
        target.postMessage(ask, targetOrigin, [channel.port2]);
      } catch (e) {
        closeRequest();
        reject(storageFailure('INVALID_REQUEST', 'the value could not be sent', 400));
      }
    });
  }

  function storageAsk(op, key, value, options) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(key)) {
      return Promise.reject(storageFailure('INVALID_REQUEST', 'invalid save key', 400));
    }
    var ask = { type: 'mb-storage-ask', op: op, key: key };
    if (op !== 'load') {
      if (!options || typeof options.binding !== 'string' ||
          !(typeof options.ifRevision === 'string' || op === 'save' && options.ifRevision === null)) {
        return Promise.reject(storageFailure('INVALID_REQUEST', 'load the save before changing it', 400));
      }
      ask.binding = options.binding;
      ask.ifRevision = options.ifRevision;
      if (op === 'save') ask.value = value;
    }
    return documentAsk(ask, 'mb-storage-result', 8000, 'STORAGE_UNAVAILABLE',
      'the save did not answer; load it before trying again');
  }

  function creationID(id) {
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  var creations = {
    publish: function (input) {
      if (!input || typeof input !== 'object' || !creationID(input.requestId) ||
          typeof input.kind !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.kind) ||
          !Number.isInteger(input.schemaVersion) || input.schemaVersion < 1 || input.schemaVersion > 2147483647 ||
          Object.keys(input).some(function (key) { return ['kind', 'schemaVersion', 'value', 'requestId'].indexOf(key) < 0; })) {
        return Promise.reject(storageFailure('INVALID_REQUEST', 'publish needs a kind, schemaVersion, JSON value, and UUID requestId', 400));
      }
      return documentAsk({ type: 'mb-creations-ask', op: 'publish', kind: input.kind,
        schemaVersion: input.schemaVersion, value: input.value, requestId: input.requestId },
        'mb-creations-result', 30000, 'SERVICE_UNAVAILABLE',
        'the publication did not answer; it may have succeeded; retry with the same requestId and content');
    },
    get: function (id) {
      if (!creationID(id)) return Promise.reject(storageFailure('INVALID_REQUEST', 'use a UUID creation identifier', 400));
      if (!gameId) return Promise.reject(storageFailure('SERVICE_UNAVAILABLE', 'this page has no identifier'));
      id = id.toLowerCase();
      return fetch(API + '/games/' + encodeURIComponent(gameId) + '/creations/' + encodeURIComponent(id),
        { credentials: 'omit', cache: 'no-store' }).then(function (response) {
          return response.json().catch(function () { return null; }).then(function (body) {
            if (!response.ok) throw storageFailure(body && body.code || 'SERVICE_UNAVAILABLE', body && body.error || 'the document could not be read', response.status, body && body.limits);
            if (!body || body.id !== id || !Object.prototype.hasOwnProperty.call(body, 'value')) {
              throw storageFailure('SERVICE_UNAVAILABLE', 'the document response was invalid');
            }
            return body;
          });
        }).catch(function (error) {
          if (error && error.reason) throw error;
          throw storageFailure('SERVICE_UNAVAILABLE', 'the document could not be reached');
        });
    },
    remove: function (id) {
      if (!creationID(id)) return Promise.reject(storageFailure('INVALID_REQUEST', 'use a UUID creation identifier', 400));
      return documentAsk({ type: 'mb-creations-ask', op: 'remove', creationId: id },
        'mb-creations-result', 30000, 'SERVICE_UNAVAILABLE', 'the removal did not answer; check the document before trying again');
    }
  };

  try {
    window.addEventListener('message', function (event) {
      try {
        // Two senders, two origins. The rail's frame and the app both answer
        // from WEB; the SHELL relays an answer from the game's own origin.
        if (event.origin !== WEB && event.origin !== window.location.origin) return;
        var data = event.data;
        if (!data) return;
        if (data.type !== 'mb-leaderboard-result' && data.type !== 'mb-leaderboard-rows') return;
        var waiting = brokerWaiting[data.id];
        if (!waiting || event.source !== waiting.target) return;
        waiting.done(data);
      } catch (e) { /* ignore a malformed answer */ }
    });
  } catch (e) { /* the caller receives a timeout */ }

  // Resolve false only when no broker or account is present.
  function brokeredSubmit(payload) {
    return new Promise(function (resolve, reject) {
      var target = brokerWindow();
      if (!target) {
        if (viewerState.signedIn || whoSignedIn()) {
          return reject(new Error('score submission needs the mindblown session'));
        }
        return resolve(false);
      }
      var id = 'lb' + (++brokerSeq) + '-' + Date.now();
      var settled = false;
      var timer;
      function done(answer) {
        if (settled) return;
        settled = true;
        delete brokerWaiting[id];
        window.clearTimeout(timer);
        if (answer && answer.ok) return resolve(true);
        reject(new Error(answer && answer.status
          ? 'score submission failed: ' + answer.status
          : 'score submission could not be confirmed; retry'));
      }
      brokerWaiting[id] = { target: target, done: done };
      // A broker that is not listening never answers, so the wait is bounded.
      timer = window.setTimeout(function () { done(null); }, 4000);
      var message = {
        type: 'mb-leaderboard-submit',
        id: id,
        game_id: gameId,
        metric: payload.metric,
        value: payload.value,
        lower: payload.lower,
        anon_session: sessionId()
      };
      // THE SAME TWO PARENTS sendSignal addresses, and for the same reason.
      // The rail's frame is on WEB. The parent is WEB inside the app and the
      // game's OWN origin on its own host, where the parent is the resolver's
      // shell -- so a submission addressed to WEB alone was discarded by the
      // browser, waited out its four seconds and fell through to the plain
      // POST. A board that named the reader in the app said `guest` on the
      // page's own host, which is the surface a person shares.
      //
      // NEVER '*': a submission carries what somebody scored.
      var sent = false;
      try { target.postMessage(message, WEB); sent = true; } catch (e) { /* not WEB */ }
      try {
        target.postMessage(message, window.location.origin);
        sent = true;
      } catch (e) { /* not the shell */ }
      if (!sent) done(null);
    });
  }

  // The plain POST: an anonymous visitor on a surface without a broker. The
  // API keys the row on the browser instead of on a person.
  function anonymousSubmit(payload) {
    return new Promise(function (resolve, reject) {
      try {
        fetch(API + '/leaderboard/' + encodeURIComponent(gameId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metric: payload.metric,
            value: payload.value,
            lower: payload.lower,
            anon_session: sessionId()
          }),
          mode: 'cors',
          credentials: 'omit',
          keepalive: true
        }).then(function (answer) {
          if (answer.ok) return resolve();
          reject(new Error('submit failed: ' + answer.status));
        }).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  // THE BOARD READ, ASKED OF WHATEVER HOLDS THE SESSION.
  //
  // Same door as the submission, and it had to be. A row is stored under the
  // subject that wrote it -- `u:<account>` signed in, `a:<browser>` signed out
  // -- and `mine` is the server comparing that to whoever is ASKING. Read from
  // the page, with no session to send, the asker is always `a:<browser>`; so
  // for exactly the people who are signed in the two could never match, and
  // nobody signed in was ever shown their own row. `mb.leaderboard.mine()`
  // answered null for them every single time.
  //
  // A FAILED READ IS NOT A FAILED CALL. Unlike a submission -- where falling
  // back would change who owns a score -- a board that comes back without the
  // caller's row marked is still the board. So this resolves null on any
  // trouble and the plain read answers instead.
  function brokeredTop(metric, limit) {
    return new Promise(function (resolve) {
      var target = brokerWindow();
      if (!target) return resolve(null);
      var id = 'lbt' + (++brokerSeq) + '-' + Date.now();
      var settled = false;
      var timer;
      function done(answer) {
        if (settled) return;
        settled = true;
        delete brokerWaiting[id];
        window.clearTimeout(timer);
        resolve(answer && answer.ok && answer.rows ? answer.rows : null);
      }
      brokerWaiting[id] = { target: target, done: done };
      timer = window.setTimeout(function () { done(null); }, 4000);
      var message = {
        type: 'mb-leaderboard-top',
        id: id,
        game_id: gameId,
        metric: String(metric || ''),
        limit: limit,
        anon_session: sessionId()
      };
      // BOTH PARENTS, as everything else here addresses them: the app on WEB,
      // and the shell on the game's own origin. At most one is delivered.
      var sent = false;
      try { target.postMessage(message, WEB); sent = true; } catch (e) { /* not WEB */ }
      try {
        target.postMessage(message, window.location.origin);
        sent = true;
      } catch (e) { /* not the shell */ }
      if (!sent) done(null);
    });
  }

  // The plain read: no broker, or one that did not answer. The board is right;
  // only `mine` is missing from it.
  function anonymousTop(metric, limit) {
    var query = '?anon_session=' + encodeURIComponent(sessionId()) +
      (limit > 0 ? '&limit=' + limit : '');
    return fetch(leaderboardURL(metric, query), { mode: 'cors', credentials: 'omit' })
      .then(function (answer) {
        if (!answer.ok) throw new Error('leaderboard failed: ' + answer.status);
        return answer.json();
      })
      .then(function (body) { return (body && body.data) || []; });
  }

  var leaderboard = {
    // submit(metric, value, opts) -> Promise<void>
    //
    // `opts.lower` asks for a board where small wins, and it is read ONLY the
    // first time a metric is used. After that the name owns its meaning and a
    // contradiction is refused, because accepting one would silently reorder
    // every entry ever recorded.
    submit: function (metric, value, opts) {
      if (!gameId) return Promise.reject(new Error('no game'));
      if (typeof value !== 'number' || !isFinite(value)) {
        return Promise.reject(new Error('value must be a number'));
      }
      var payload = {
        metric: String(metric || ''),
        value: value,
        lower: !!(opts && opts.lower)
      };
      // THE BROKER FIRST, because a row with a name on it is the point.
      return brokeredSubmit(payload).then(function (named) {
        if (named) return;
        return anonymousSubmit(payload);
      });
    },

    // top(metric, opts) -> Promise<Array<{username, value, rank, at, mine}>>
    top: function (metric, opts) {
      var limit = opts && opts.limit ? parseInt(opts.limit, 10) : 0;
      // THE BROKER FIRST, so the row that is yours comes back saying so.
      return brokeredTop(metric, limit).then(function (rows) {
        return rows || anonymousTop(metric, limit);
      });
    },

    // mine(metric) -> Promise<entry|null>. The caller's own row, which top()
    // already marks, so this is the same read narrowed rather than a new one.
    mine: function (metric) {
      return leaderboard.top(metric, { limit: 100 }).then(function (rows) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].mine) return rows[i];
        }
        return null;
      });
    }
  };

  // THE SEAT ASK IS THE BUNDLE'S NOW (spec 38). It was a second frame of the
  // rail's page over the whole window, because the sign-in click had to land
  // on the app's origin for the window it opens to have a gesture behind it.
  // The click is in the shell now, so the shell opens it -- see SeatPrompt.tsx.

  // A ROOM TWO PEOPLE SHARE (spec 37).
  //
  // THE SAME DOOR THE BOARD USES, and deliberately so. A page holds no
  // credential, so whatever holds the session makes the call: the rail's frame
  // on a page's own host, the app's own document inside the app. This end asks
  // and waits; it never holds a token and never sees one.
  //
  // WHAT THE SERVER DECIDES AND THE PAGE CANNOT. Which seat you are, whose turn
  // it is, what is in a hidden hand, and what a die landed on. A page that
  // wants to cheat at any of those is asking the wrong machine.
  //
  // AND WHEN NOBODY BROKERS: a visitor with no session still gets a seat, keyed
  // on their browser the way a board row is. A room that only worked for
  // somebody signed in would be a room most people cannot enter.
  var roomWaiting = {};
  var roomSeq = 0;

  // THE INVITATION IS IN THE ADDRESS, AND WE PUT IT THERE.
  //
  // A link somebody shares carries `?room=`, we forward it into this document,
  // and then every page has to remember to read it back out before it joins. A
  // page that forgets opens a fresh room instead, so the person who followed
  // the invitation sits alone and the person who sent it waits -- which is what
  // two people reported as "the invite did not work", twice this week on two
  // different pages.
  //
  // That is bookkeeping about OUR OWN convention, so it is ours to do. Naming a
  // room still wins. `public` still means "find me people", and the linked room
  // is the first place the finder looks, because a person who followed a link
  // to somebody's public room is exactly who that room was waiting for.
  // This only fills in the answer the page would otherwise have had to look up.
  function roomInTheAddress() {
    try {
      return new URLSearchParams(window.location.search).get('room') || '';
    } catch (e) {
      return '';
    }
  }

  function roomAsk(op, fields, holdFor, onwait) {
    if (!gameId) return Promise.reject(new Error('no game'));
    var ask = {
      type: 'mb-room-ask',
      id: 'rm' + (++roomSeq) + '-' + Date.now(),
      game_id: gameId,
      op: op
    };
    for (var key in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) ask[key] = fields[key];
    }
    return brokeredAsk(ask, holdFor).then(function (answer) {
      // NO BROKER IS NO ROOM, and there is no anonymous path to fall back to.
      // A seat needs an account, and this page holds no credential and never
      // will -- so the surface that holds the session is the only way in.
      if (!answer) throw new Error('rooms need the mindblown panel on this page');
      if (answer.ok) {
        // A ROOM MAY ANSWER "NOT YET" (`46`). Nothing sends this today, and
        // that is the point of having it now: a published page is not
        // recompiled, so a `wait_ms` a page had never heard of would land on
        // every page already out there the day we first hold an arrival back --
        // to pair somebody with the next person instead of putting them in a
        // room alone, or to keep a page from opening rooms faster than people
        // fill them. Tolerated here, so that day is a change to one server.
        var said = answer.room;
        if (said && said.wait_ms > 0 && !holdFor) return roomWait(op, fields, said, 0, onwait);
        return said;
      }
      var refused = new Error(answer.error || 'the room refused that');
      // WHY, IN A WORD A PAGE CAN SWITCH ON: "ROOM_FULL", "NOT_YOUR_TURN",
      // "ROOM_CLOSED" and the rest. The message is what a page SHOWS; this is
      // what it acts on, and matching our English was the only way before.
      refused.reason = answer.reason || '';
      // 401 IS A DOOR, NOT A FAULT: it means sign in, and the panel is already
      // asking. A page can tell the two apart without reading the sentence.
      refused.needsAccount = answer.status === 401;
      throw refused;
    });
  }

  // THE ASK GOES BACK, ONCE THE ROOM SAYS WHEN. Bounded, because a server that
  // said "not yet" for ever would be a page that never starts and never says
  // why: after this long the page is told, in the same shape every other
  // refusal takes, and may show something or ask again itself.
  var ROOM_WAIT_CAP = 300000;
  function roomWait(op, fields, said, waited, onwait) {
    var so_far = waited || 0;
    var pause = Math.max(250, Math.min(30000, said.wait_ms));
    if (so_far + pause > ROOM_WAIT_CAP) {
      var gaveUp = new Error('nobody else is here yet');
      gaveUp.reason = 'NOBODY_YET';
      return Promise.reject(gaveUp);
    }
    // A page that asked to be told gets told, every time we go back. It is
    // NOT one of the fields: those are posted to the panel, and a function
    // cannot be sent through a window message.
    if (typeof onwait === 'function') {
      try { onwait({ ms: pause, waited: so_far }); } catch (e) { /* the page's own */ }
    }
    return new Promise(function (again) { setTimeout(again, pause); }).then(function () {
      return roomAsk(op, fields, 0, onwait).then(function (room) {
        if (room && room.wait_ms > 0) return roomWait(op, fields, room, so_far + pause, onwait);
        return room;
      });
    });
  }

  function brokeredAsk(ask, holdFor) {
    return new Promise(function (resolve) {
      var target = brokerWindow();
      if (!target) return resolve(null);
      var settled = false;
      function done(answer) {
        if (settled) return;
        settled = true;
        resolve(answer || null);
      }
      roomWaiting[ask.id] = done;
      // A broker that is not listening never answers, so the wait is bounded.
      window.setTimeout(function () { delete roomWaiting[ask.id]; done(null); }, 8000);
      var sent = false;
      try { target.postMessage(ask, WEB); sent = true; } catch (e) { /* not WEB */ }
      try { target.postMessage(ask, window.location.origin); sent = true; } catch (e) { /* not the shell */ }
      if (!sent) done(null);
    });
  }

  try {
    window.addEventListener('message', function (event) {
      try {
        if (event.origin !== WEB && event.origin !== window.location.origin) return;
        var data = event.data;
        if (!data || data.type !== 'mb-room-result') return;
        var waiting = roomWaiting[data.id];
        if (!waiting) return;
        delete roomWaiting[data.id];
        waiting(data);
      } catch (e) { /* a malformed answer is a fallback, not a crash */ }
    });
  } catch (e) { /* no listener, so every ask takes the plain path */ }

  // INVITE A FRIEND, WITHOUT EVER LEARNING WHO (spec 40).
  //
  // THE SHEET IS OURS AND THE PAGE NEVER SEES INSIDE IT. mb.room.invite() takes
  // no address and returns none: the person types into OUR card, on OUR
  // surface, and the page is told one number -- how many invitations went out.
  // A page that could pass an address could harvest one, and a page that was
  // handed the two lists would be handed everybody the reader knows. This is
  // the one rule in spec 40 with no exception.
  //
  // TWO ANSWERS, AND THE FIRST ONE IS ONLY AN ACKNOWLEDGEMENT. A surface that
  // cannot draw the sheet says so in a moment; a surface that can takes as long
  // as the person does, so nothing here times out the sheet itself -- a person
  // typing a handle must not have their card closed under them.
  var inviteWaiting = {};
  var inviteAcked = {};
  var inviteSeq = 0;

  function askForTheSheet(name) {
    if (!gameId) return Promise.reject(new Error('no game'));
    return new Promise(function (resolve) {
      var target = brokerWindow();
      if (!target) return resolve({ closed: true });
      var id = 'iv' + (++inviteSeq) + '-' + Date.now();
      var settled = false;
      function done(answer) {
        if (settled) return;
        settled = true;
        delete inviteWaiting[id];
        delete inviteAcked[id];
        resolve(answer);
      }
      inviteWaiting[id] = done;
      var ask = {
        type: 'mb-invite-open',
        id: id,
        game_id: gameId,
        room: String(name || '')
      };
      var sent = false;
      try { target.postMessage(ask, WEB); sent = true; } catch (e) { /* not WEB */ }
      try { target.postMessage(ask, window.location.origin); sent = true; } catch (e) { /* not the shell */ }
      if (!sent) return done({ closed: true });
      // NOBODY DREW IT. No panel on this page, or a surface that has no sheet:
      // the page hears "closed" rather than waiting on a card that is not there.
      window.setTimeout(function () {
        if (!inviteAcked[id]) done({ closed: true });
      }, 2500);
    });
  }

  // CHOOSE AN ITEM, WITHOUT EVER SEEING THE INVENTORY (spec 59).
  //
  // THE SAME SHAPE AS THE INVITE: our sheet, an acknowledgement, then one
  // answer. The sheet only chooses; mb.items.pick then equips the choice for
  // THIS page through the broker, so who may equip what is decided in one place.
  var pickWaiting = {};
  var pickAcked = {};

  function askForThePicker(kind, current, own, quality) {
    return new Promise(function (resolve) {
      var target = brokerWindow();
      if (!gameId || !target) return resolve({ cancelled: true });
      var id = 'pk' + (++inviteSeq) + '-' + Date.now();
      var settled = false;
      function done(answer) {
        if (settled) return;
        settled = true;
        delete pickWaiting[id];
        delete pickAcked[id];
        resolve(answer);
      }
      pickWaiting[id] = done;
      // THE PAGE'S OWN THINGS AND ITS TITLE go with the ask: the sheet heads
      // their section with the title and draws their pictures.
      // AND THE SLOT'S QUALITY: a high slot's card offers only items that
      // carry a high model.
      var ask = { type: 'mb-items-pick-open', id: id, game_id: gameId, kind: kind, current: current,
                  own: own || [], title: String(document.title || '').slice(0, 60), quality: qualityOf(quality) };
      var sent = false;
      try { target.postMessage(ask, WEB); sent = true; } catch (e) { /* not WEB */ }
      try { target.postMessage(ask, window.location.origin); sent = true; } catch (e) { /* not the shell */ }
      if (!sent) return done({ cancelled: true });
      // NOBODY DREW IT: the page hears "cancelled", not silence.
      window.setTimeout(function () {
        if (!pickAcked[id]) done({ cancelled: true });
      }, 2500);
    });
  }

  try {
    window.addEventListener('message', function (event) {
      try {
        if (event.origin !== WEB && event.origin !== window.location.origin) return;
        var data = event.data;
        if (!data || typeof data.id !== 'string') return;
        if (data.type === 'mb-items-pick-opened') {
          if (pickWaiting[data.id]) pickAcked[data.id] = true;
          return;
        }
        if (data.type === 'mb-items-pick-done') {
          var picking = pickWaiting[data.id];
          if (!picking) return;
          // AN ITEM ID OR ONE OF THE PAGE'S OWN, AND NOTHING ELSE the surface
          // put in the message.
          var picked = data.picked;
          var ownPick = picked && typeof picked === 'object' && typeof picked.own === 'string' && OWN_ID.test(picked.own);
          var chose = ownPick || typeof picked === 'string' && ITEM_ID.test(picked);
          picking(data.cancelled === true || !chose
            ? { cancelled: true }
            : { picked: ownPick ? { own: picked.own } : picked });
          return;
        }
        if (data.type === 'mb-invite-opened') {
          if (inviteWaiting[data.id]) inviteAcked[data.id] = true;
          return;
        }
        if (data.type !== 'mb-invite-done') return;
        var waiting = inviteWaiting[data.id];
        if (!waiting) return;
        // THE NUMBER AND NOTHING ELSE. Whatever else the surface put in this
        // message, a page is handed a count and a flag.
        waiting(data.closed
          ? { closed: true, sent: Number(data.sent) || 0 }
          : { sent: Number(data.sent) || 0 });
      } catch (e) { /* a malformed answer is a closed sheet, not a crash */ }
    });
  } catch (e) { /* no listener, so the sheet can never be opened from here */ }

  // THE ADDRESS A PERSON MAY BE SENT (spec 37).
  //
  // A PAGE CANNOT WORK THIS OUT. Inside the shell its own `location.href` ends
  // in `?mb=game` -- our marker, put there by the resolver -- and the document
  // that holds the real address is the shell, on the same origin but not
  // reachable from a frame that did not create it. So a page building an
  // invitation out of `location.href` hands somebody the MARKER document: the
  // page alone, with no shell, no rail, and therefore nothing that can ask them
  // to sign in. Measured on the first page to try it: the link opened and
  // simply never asked.
  //
  // It is ours to give, because `mb` is ours. This strips it, keeps everything
  // else the page had, and adds what the page asks for.
  function shareUrl(extra) {
    try {
      var here = new URL(window.location.href);
      // The marker, and only the marker. A page's own query is its business.
      here.searchParams.delete('mb');
      if (extra && typeof extra === 'object') {
        for (var key in extra) {
          if (!Object.prototype.hasOwnProperty.call(extra, key)) continue;
          var value = extra[key];
          if (value === null || value === undefined || value === '') {
            here.searchParams.delete(key);
          } else {
            here.searchParams.set(key, String(value));
          }
        }
      }
      here.hash = '';
      var query = here.searchParams.toString();
      return here.origin + here.pathname + (query ? '?' + query : '');
    } catch (e) {
      try { return window.location.href; } catch (e2) { return ''; }
    }
  }

  // A LINK TO US OPENS US, NOT A FRAME OF US.
  //
  // A board row links a name to `profile_url` (sdk.md says to), and a plain link
  // is followed by the frame it is in: the whole app then opened inside the
  // page, as a page within a page. So a click on an address of ours is sent to
  // the window around the page. On the page's own host that window is the
  // shell, which is this page's own origin, so it is moved from here. Inside the
  // app it is not ours to move -- the frame is sandboxed so that a page cannot
  // take the tab -- so the app is asked, and it checks the address itself.
  function openOurs(event) {
    if (event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || (link.target && link.target !== '_self')) return;
    var url;
    try { url = new URL(link.href, window.location.href); } catch (e) { return; }
    if (url.origin !== WEB || window.parent === window) return;
    event.preventDefault();
    try {
      if (window.parent.location.origin === window.location.origin) {
        window.parent.location.href = url.href;
        return;
      }
    } catch (e) { /* the parent is the app, on its own origin */ }
    try { window.parent.postMessage({ type: 'mb-open', url: url.href }, WEB); } catch (e) { /* no app */ }
  }
  try { document.addEventListener('click', openOurs); } catch (e) { /* no document */ }

  // THE TURN WIRE IS DEPRECATED (spec 39, 2026-09-15): turn-based is a rules
  // file on a live room now. `join` and `leave` stay -- they are the seat --
  // and `look` and `act` keep working for the pages already on them, and say
  // so once, in the console the page's author is looking at.
  var turnWireWarned = false;
  function turnWireDeprecated(call) {
    if (turnWireWarned) return;
    turnWireWarned = true;
    try {
      // THE SITE IS WEB, never written in: this file is a template and beta
      // and production are different hosts (see podjs_test.go).
      console.warn('mindblown: mb.room.' + call + ' is deprecated. Turn-based is a rules file on ' +
        'a live room now -- see ' + WEB + '/live.md. join and leave stay.');
    } catch (e) { /* no console */ }
  }

  var room = {
    // join(opts) -> Promise<room>
    //
    // `opts.room` is the room's name. LEAVE IT OUT and we mint one: the name is
    // what goes in the link somebody shares, so a name a page invented would be
    // a name a stranger can type. `opts.seats` is the capacity, pinned by
    // whoever opens the room.
    //
    // JOINING TWICE IS THE SAME SEAT. A reload is not a new person.
    // `opts.public` ASKS TO BE PUT SOMEWHERE WITH PEOPLE rather than in a room
    // you name (`44`): we find an open room of this page with a seat, and open
    // one when there is nowhere to sit. A room named by the address is tried
    // first, and taken only while it is public and has a seat -- the person
    // followed a link to somebody, and the finder must not send them elsewhere.
    // `seats` is still the size, and is used only if this is the ask that opens
    // a room.
    //
    // ASKING TWICE IS THE SAME ROOM. A reload returns the one you are in.
    join: function (opts) {
      var settings = opts || {};
      if (Object.prototype.hasOwnProperty.call(settings, 'resources')) {
        return Promise.reject(storageFailure('INVALID_REQUEST', 'use live.create to attach resources', 400));
      }
      var fields = {
        room: String(settings.room || roomInTheAddress()),
        seats: settings.seats ? parseInt(settings.seats, 10) : 2
      };
      if (settings.public) fields.public = true;
      // `opts.onwait` is called if we are ever asked to hold you back. Nothing
      // sends that today; a page that passes one is ready for the day it does.
      return roomAsk('join', fields, 0, settings.onwait);
    },

    // look(name, opts) -> Promise<room>
    //
    // `opts.since` is the last sequence this page has seen, so a reconnect asks
    // for what it missed rather than for everything.
    // `opts.wait` holds the answer open until the room moves, up to thirty
    // seconds. A page that uses it makes one request a turn instead of one
    // every second and a half, and hears about a move as it happens rather
    // than at the next poll.
    look: function (name, opts) {
      turnWireDeprecated('look');
      var hold = (opts && opts.wait) || 0;
      return roomAsk('look', {
        room: String(name || ''),
        since: (opts && opts.since) || 0,
        wait: hold
      }, hold);
    },

    // leave(name) -> Promise<void>
    //
    // GIVE THE SEAT BACK. Without this a seat is held for life: somebody who
    // opens an invitation by accident fills a two-seat room and nobody else can
    // ever get in. Leaving twice is not an error, and the log keeps what they
    // did -- what happened, happened.
    leave: function (name) {
      return roomAsk('leave', { room: String(name || '') }).then(function () {});
    },

    // act(name, turn) -> Promise<room>
    //
    // `turn` is the whole turn: `move` is yours and we never read it; `state`
    // patches what everybody sees; `mine` patches your own hidden state and
    // there is no field for anybody else's; `next` hands the turn to a seat,
    // which is how a trade works; `close` ends the room.
    //
    // AND THE THINGS YOU MAY NOT DO FOR YOURSELF: `roll` throws dice, `deck`
    // loads a supply nobody can read, `deal` deals off it, `give` moves items
    // out of YOUR OWN hand, `take` moves items nobody chooses.
    act: function (name, turn) {
      turnWireDeprecated('act');
      return roomAsk('act', { room: String(name || ''), act: turn || {} });
    },

    // invite(name) -> Promise<{ sent: n } | { closed: true }>
    //
    // OPENS OUR SHEET. It takes no username and no address, and it returns
    // none: the two lists a person picks from -- who they played with, who they
    // follow -- are drawn by us, over your page, and nothing in them crosses
    // back. Your page learns that a sheet was opened and how many invitations
    // went out.
    //
    // `name` is the room to invite to. There is no accept step anywhere behind
    // this: the person who was asked takes the seat, and taking it is the
    // acceptance.
    invite: function (name) {
      return askForTheSheet(name);
    }
  };

  function start() {
    // BEFORE ANYTHING ELSE, because there may be nothing else to do here: a
    // marker document opened by a person is a link they were sent, and the
    // page they wanted is one navigation away.
    if (sendOnIfThisWasShared()) return;
    // THE ANONYMOUS ANSWER IS READY BEFORE THE PAGE'S FIRST LINE. Most people
    // who open a page are not signed in and never will be, so the id that
    // remembers them must not wait on a frame, a network call or a session
    // that is not coming.
    if (!viewerState.id) {
      viewerState.id = anonID();
      // AND THE NAME, IF THE ZONE ALREADY KNOWS IT.
      //
      // The frame is the only thing here that can prove who somebody is, and it
      // is also the thing a browser may cut off from its own storage -- the
      // failure Sasun named as "maybe it's mobile issue? not sharing identity
      // from mindblown.ai to subdomain?". When that happens the frame holds no
      // token, asks nothing, and the page is never told a name at all.
      //
      // THIS DOCUMENT IS NOT A FRAME. The handle the app wrote to a cookie on
      // the zone reaches it directly, and it is the same channel the sound
      // switch has always used. So the NAME is known immediately and without a
      // session, and the frame's answer refines it.
      //
      // signedIn STAYS FALSE UNTIL THE API SAYS OTHERWISE. A cookie is written
      // by whoever holds the browser: it is good enough to decide what to CALL
      // somebody, which is all #738 ever claimed for it, and not good enough to
      // assert that they are signed in. So a page may know a name before it
      // knows a person -- show the one, key on the other.
      viewerState.username = whoSignedIn();
    }

    // The app may name this person outright, and it is framed-only: on its own
    // host there is no parent to hear from and the rail does the naming.
    if (framed()) {
      listenForViewer();
      // No listeners can exist yet -- this runs before the seam is published --
      // so there is nobody to tell.
      listenForTune();
      listenForPoint();
    }

    // The shell is the top document of a game's own host. It is the only thing
    // that can carry the framed game's signals to the API.
    if (!framed()) {
      relaySignals();
    }

    // A PAGE ERROR IS A FACT ABOUT THE PAGE, so it is reported from every
    // document that loads this script, whatever the document is FOR. A game
    // that throws throws for everybody.
    watchForErrors();

    // EVERYTHING ELSE HERE IS ABOUT A VISIT, and a visit needs somebody making
    // it. Two documents carry this script without being one:
    //
    //   - a FRAMED page is a real view, and its signals are handed up for the
    //     app to send with the reader attached. It reports;
    //   - a BARE page -- `mb=game` or `mb=pure` opened at the TOP level -- is
    //     the marker document, and the marker means "the page alone". Nobody is
    //     looking at it. The play has always stood down there; the clock must
    //     agree, or the two disagree about the same document.
    //
    // MEASURED, NOT REASONED ABOUT. In the first forty minutes of these signals
    // on prod, 24 of 31 `left` rows had NO play row for their session: link
    // preview crawlers follow the shell's own frame URL, load it top-level,
    // and close it. Every one said one second and never played, which is a
    // truthful description of a crawler and a lie about our players.
    if (bare() && !framed()) return;

    watchForPlay();
    // ONE CLOCK PER VISIT, in the document whose queue posts. A framed page's
    // parent is our shell or our app, and each runs this clock itself AND
    // forwarded the frame's marks beside its own: measured on prod on
    // 2026-10-03, nine visits in ten said fifteen seconds twice and half
    // said left twice. The frame still says `played`, which only it can see;
    // the host takes it (relaySignals here, markPlayed in the app).
    if (framed()) return;
    watchTime();
    reportPlay();
    banner();
  }

  // THE SHELL LISTENS FOR ITS PAGE FROM ITS FIRST MOMENT, not from its own
  // DOMContentLoaded. That event waits for the deferred rail bundle, while the
  // page's frame is already in the shell's HTML and loading beside it -- so a
  // page that asked early (a save on its first line, a room on arrival) asked a
  // shell that was not listening yet. The message went nowhere, the page waited
  // its eight seconds, and a saved garden was drawn empty: measured on prod,
  // 2026-09-26, 8 of 10 reloads of one page on a warm cache.
  if (!framed()) relayBrokeredAsks();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // The seam every later feature hangs off: a score submit, a sign-in, a
  // multiplayer room are each another method here, and the game keeps loading
  // ONE script.
  // MERGED, NEVER ASSIGNED. The sound policy puts its own key on this object
  // and it runs FIRST -- it is the resolver's script at the top of the head,
  // and this is the publish step's tag at the end of the body. An assignment
  // here would take the player's switch off the page it is standing on.
  var seam = window.mindblown || (window.mindblown = {});
  seam.gameId = gameId;
  seam.api = API;
  seam.reportPlay = reportPlay;
  // THE SEAM THIS OBJECT WAS ALWAYS FOR, and the comment above says so: "a
  // score submit, a sign-in, a multiplayer room are each another method here".
  // A game says what happened in it -- window.mindblown.event('score', { value:
  // 1200 }) -- and this script decides how that reaches us.
  /* A GAME SAYS WHAT HAPPENED IN IT, and two things listen.
   *
   * The signal goes where signals go -- the API on a game's own host, the app
   * when this page is framed. That has always been here.
   *
   * AND THE RECORDER HEARS IT FIRST, in this document, without a round trip:
   * game_start, game_pause, game_resume, game_end. A page that says these is
   * exact about its own run; a page that says nothing keeps the guess the
   * recorder makes from the picture. See told() above.
   *
   * THE RECORDER NEVER SEES A NAME IT WAS NOT GIVEN. It is handed the name only
   * after sendSignal's own check, so a page cannot reach past this seam by
   * inventing one. */
  seam.event = function (name, props) {
    try {
      if (recorder && typeof name === 'string' && name.indexOf('game_') === 0) {
        recorder.told(name);
      }
    } catch (e) { /* a recorder that will not listen is not the game's problem */ }
    return sendSignal(name, props);
  };

  // WHAT THIS PAGE WANTS COUNTED. See declareMeasure above.
  seam.measure = function (list) {
    try {
      var clean = cleanMeasure(list);
      if (!clean || measured) return;
      measured = true;
      if (framed()) {
        var message = { type: 'mb-measure', signals: clean };
        try { window.parent.postMessage(message, WEB); } catch (e) { /* not the app */ }
        try { window.parent.postMessage(message, window.location.origin); } catch (e) { /* not the shell */ }
        return;
      }
      declareMeasure(clean);
    } catch (e) { /* never throw inside somebody's page */ }
  };

  // THE PAGE'S PARAMETERS (spec 51): `tune.json` beside the page, read here.
  seam.tune = function () {
    return tuneDeclared().then(function (declared) {
      if (!tuneAsked()) return tuneValues(declared);
      return tuneAnswer().then(function () { return tuneValues(declared); });
    });
  };
  seam.tune.on = function (fn) {
    if (typeof fn !== 'function') return function () {};
    tuneListeners.push(fn);
    return function () {
      var at = tuneListeners.indexOf(fn);
      if (at >= 0) tuneListeners.splice(at, 1);
    };
  };

  /* THE SAME FOUR WORDS, UNDER A NAME OUR OWN BUILDER MAY BE TOLD.
   *
   * The wire vocabulary is game_start / game_pause / game_resume / game_end,
   * and that is what reaches the API and what an outside agent is handed in
   * skill.md. It cannot be what our BUILDER's brief teaches: that brief is
   * generated under a standing rule -- not one word about what is being made --
   * and a test in this repository fails if the word appears in it at all. A
   * word in a prompt is an instruction, not documentation.
   *
   * So the page may say it either way and both are the same call. One
   * implementation, one place the mapping lives, and a test that says
   * run.start() reaches game_start.
   */
  seam.run = {
    start: function () { return seam.event('game_start'); },
    pause: function () { return seam.event('game_pause'); },
    resume: function () { return seam.event('game_resume'); },
    end: function (props) { return seam.event('game_end', props); },
  };

  /* WHAT THE PAGE SAID BEFORE THIS SCRIPT EXISTED.
   *
   * This tag is the LAST thing in the body and a game's own code runs before
   * it, so a page that starts a run at load speaks into a seam that is not
   * there yet. Anything an earlier script queued on window.mindblown.events is
   * played through now, in order. Nothing else in this system writes that
   * array; it is a place for the page and for whatever is put in front of it.
   */
  try {
    var waiting = seam.events;
    if (waiting && waiting.length) {
      seam.events = [];
      for (var q = 0; q < waiting.length; q++) {
        try {
          var said = waiting[q];
          if (typeof said === 'string') seam.event(said);
          else if (said && said.length) seam.event(said[0], said[1]);
        } catch (e) { /* one bad entry is not the rest */ }
      }
    }
  } catch (e) { /* nothing was waiting */ }

  /* AND WHAT IT DECLARED BEFORE THIS SCRIPT EXISTED. The page's early script
   * (the resolver's SIGNALS_SCRIPT) keeps the first list a page hands measure()
   * before we load, because a page that waits for window.mindblown finds that
   * object on its first line and declares at once. It is declared now, through
   * the same call a page makes, so the same rules refuse a bad one. */
  try {
    var declaredEarly = seam.__queuedMeasure;
    if (declaredEarly) {
      try { delete seam.__queuedMeasure; } catch (e) { seam.__queuedMeasure = undefined; }
      seam.measure(declaredEarly);
    }
  } catch (e) { /* nothing was declared early */ }
  // WHO IS LOOKING: { id, username, signedIn } and onchange(fn). The id is what
  // a page keys its saved things on; the username is only ever shown. See the
  // notes on viewerState for why that is not a preference.
  seam.viewer = viewer;
  // THE SIMPLE CALL IS THE SAFE ONE.
  //
  // Every change used to need the revision and binding of the last read, and a
  // page that did not carry them had its save refused. Pages found that hard and
  // kept progress in their own browser storage instead. So this script carries
  // them: it remembers the last answer for each key, reads first when it has
  // none, and a change is checked against what THIS page last saw. A value
  // somebody else changed in the meantime is never overwritten silently: the
  // save is refused with the newer value on the error, and the next save is
  // checked against that. A change of account is never written across.
  //
  // Passing ifRevision or binding keeps the strict form, unchanged.
  var lastSeen = {};

  function remember(key, result) {
    if (result && typeof result.binding === 'string') {
      lastSeen[key] = { revision: result.revision, binding: result.binding };
    }
    return result;
  }

  function strict(options) {
    return !!options && typeof options === 'object' &&
      (Object.prototype.hasOwnProperty.call(options, 'ifRevision') ||
       Object.prototype.hasOwnProperty.call(options, 'binding'));
  }

  // A PAGE THAT HAS NOT READ A KEY MAY NOT WRITE IT. Reading on its behalf
  // would write whatever it holds over whatever the account has: a fresh start
  // on a new device over a season of progress, or play from before a sign-in
  // over the account the person just signed in to.
  function seen(key) {
    if (lastSeen[key]) return Promise.resolve(lastSeen[key]);
    return Promise.reject(storageFailure('LOAD_FIRST', 'load this key before changing it', 409));
  }

  function change(op, key, value) {
    return seen(key).then(function (held) {
      if (op === 'remove' && held.revision === null) {
        return { value: null, revision: null, bytes: 0, binding: held.binding };
      }
      return storageAsk(op, key, value, { ifRevision: held.revision, binding: held.binding });
    }).then(function (result) {
      return remember(key, result);
    }, function (error) {
      var reason = error && error.reason;
      // Refused before anything was written: what this page last saw still holds.
      if (reason === 'QUOTA_EXCEEDED' || reason === 'RATE_LIMITED' ||
          reason === 'INVALID_REQUEST' || reason === 'LOAD_FIRST') throw error;
      // Anything else -- another account, or an answer that never came -- leaves
      // the stored value unknown, so the page reads it again before writing.
      delete lastSeen[key];
      if (reason !== 'REVISION_CONFLICT') throw error;
      return storageAsk('load', key).then(function (current) {
        remember(key, current);
        error.current = current;
        throw error;
      }, function () { throw error; });
    });
  }

  seam.load = function (key) {
    return storageAsk('load', key).then(function (result) { return remember(key, result); });
  };
  seam.save = function (key, value, options) {
    if (strict(options)) {
      return storageAsk('save', key, value, options).then(function (result) { return remember(key, result); });
    }
    return change('save', key, value);
  };
  seam.remove = function (key, options) {
    if (strict(options)) {
      return storageAsk('remove', key, undefined, options).then(function (result) { return remember(key, result); });
    }
    return change('remove', key);
  };

  // WHAT THE PAGE ASKED BEFORE THIS SCRIPT ARRIVED. The page's shell defines
  // these three calls at the top of the document and queues them; they are
  // answered here, in order.
  (function answerTheEarlyCalls() {
    var early = seam.__queuedSaves;
    if (!early || typeof early.splice !== 'function') return;
    try { delete seam.__queuedSaves; } catch (e) { seam.__queuedSaves = undefined; }
    early.splice(0).forEach(function (call) {
      var run = seam[call[0]];
      Promise.resolve()
        .then(function () { return run.apply(seam, call[1]); })
        .then(call[2], call[3]);
    });
  })();
  // The board for this page: submit(), top(), mine(). See sdk.md.
  seam.creations = creations;
  seam.leaderboard = leaderboard;
  seam.room = room;

  // A ROOM WHERE EVERYBODY MOVES AT ONCE (spec 39).
  //
  // THE SAME SEAT, A DIFFERENT WIRE. `live.join` takes the seat exactly as
  // `room.join` does -- same room, same account, same sign-in card -- and then
  // asks the surface that holds the session to open a socket to the room. The
  // socket lives THERE. This page never sees the ticket that opened it or the
  // address it went to; what it gets is a channel: `send` for its own input,
  // `on('tick')` for what the room says everybody may see.
  var liveSeq = 0;
  var liveChannels = {};
  var livePorts = {};

  function liveMessage(data) {
    var channel = liveChannels[data.id];
    if (!channel) return;
    if (data.type === 'mb-live-opened') {
      if (channel.opened) channel.opened(data);
      return;
    }
    if (data.type === 'mb-live-tick') {
      var said = null;
      try { said = JSON.parse(data.text); } catch (e) { return; }
      channel.emit('tick', said);
      return;
    }
    if (data.type === 'mb-live-closed') {
      delete liveChannels[data.id];
      channel.emit('close', { code: data.code, reason: data.reason || '' });
    }
  }

  try {
    window.addEventListener('message', function (event) {
      try {
        if (event.origin !== WEB && event.origin !== window.location.origin) return;
        var data = event.data;
        if (!data || typeof data.id !== 'string') return;
        if (data.type !== 'mb-live-opened' && data.type !== 'mb-live-tick' &&
            data.type !== 'mb-live-closed') return;
        if (!livePorts[data.id]) liveMessage(data);
      } catch (e) { /* a malformed message is not the page's problem */ }
    });
  } catch (e) { /* no listener, so no live rooms on this surface */ }

  function liveHandle(id, transmit) {
    var handlers = {};
    return {
      id: id, room: null, seat: 0, page: gameId,
      on: function (event, fn) {
        (handlers[event] = handlers[event] || []).push(fn);
        return function () {
          var list = handlers[event] || [];
          var at = list.indexOf(fn);
          if (at >= 0) list.splice(at, 1);
        };
      },
      emit: function (event, payload) {
        var list = (handlers[event] || []).slice();
        for (var i = 0; i < list.length; i++) {
          try { list[i](payload); } catch (e) { /* the page owns its handler */ }
        }
      },
      send: function (data) {
        if (liveChannels[id]) transmit({ type: 'mb-live-send', id: id, data: data });
      },
      close: function () {
        delete liveChannels[id];
        transmit({ type: 'mb-live-close', id: id });
      }
    };
  }

  function openChannel(name) {
    return new Promise(function (resolve, reject) {
      var target = brokerWindow();
      if (!target) return reject(new Error('live rooms need the mindblown panel on this page'));
      var id = 'lv' + (++liveSeq) + '-' + Date.now();
      var channel = liveHandle(id, function (message) {
        var to = brokerWindow();
        if (!to) return;
        try { to.postMessage(message, WEB); } catch (e) { /* not WEB */ }
        try { to.postMessage(message, window.location.origin); } catch (e) { /* not the shell */ }
      });
      var settled = false;
      channel.opened = function (answer) {
        if (settled) return;
        settled = true;
        channel.opened = null;
        if (answer.ok) {
          channel.seat = answer.seat || 0;
          return resolve(channel);
        }
        delete liveChannels[id];
        var refused = new Error(answer.error || 'the room refused the socket');
        refused.reason = answer.reason || '';
        refused.needsAccount = answer.status === 401;
        reject(refused);
      };
      liveChannels[id] = channel;
      window.setTimeout(function () {
        if (settled) return;
        settled = true;
        delete liveChannels[id];
        reject(new Error('the room did not answer'));
      }, 10000);
      var ask = { type: 'mb-live-open', id: id, game_id: gameId, room: String(name || '') };
      var sent = false;
      try { target.postMessage(ask, WEB); sent = true; } catch (e) { /* not WEB */ }
      try { target.postMessage(ask, window.location.origin); sent = true; } catch (e) { /* not the shell */ }
      if (!sent) { settled = true; delete liveChannels[id]; reject(new Error('no broker')); }
    });
  }

  function createResourceRoom(input) {
    if (!input || typeof input !== 'object' || !creationID(input.requestId) ||
        !Number.isInteger(input.seats) || input.seats < 2 || input.seats > 16 ||
        !input.resources || typeof input.resources !== 'object' || Array.isArray(input.resources) ||
        Object.keys(input).some(function (key) { return ['seats', 'resources', 'requestId'].indexOf(key) < 0; })) {
      return Promise.reject(storageFailure('INVALID_REQUEST', 'use seats, resources, and a UUID requestId', 400));
    }
    var names = Object.keys(input.resources);
    if (!names.length || names.length > 4 || names.some(function (name) {
      return !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name) || !creationID(input.resources[name]);
    })) return Promise.reject(storageFailure('INVALID_REQUEST', 'use one through four named UUID resources', 400));
    var requestId = input.requestId;
    var captured = Object.keys(liveChannels).map(function (id) { return liveChannels[id]; })
      .filter(function (channel) { return channel.page === gameId; });
    return new Promise(function (resolve, reject) {
      var target = brokerWindow();
      if (!target || !gameId || !storageDocument || typeof MessageChannel !== 'function') {
        return reject(storageFailure('SERVICE_UNAVAILABLE', 'live rooms need the mindblown panel'));
      }
      var id = storageDocument + ':live:' + (++liveSeq);
      var ports = new MessageChannel();
      var settled = false;
      var closed = false;
      var received = false;
      function release() {
        closed = true;
        window.clearTimeout(timer);
        ports.port1.close();
        ports.port2.close();
        delete livePorts[id];
        delete liveChannels[id];
      }
      var channel = liveHandle(id, function (message) {
        if (closed) return;
        message.document = storageDocument;
        ports.port1.postMessage(message);
        if (message.type === 'mb-live-close') {
          release();
          rejectStart({ reason: 'CANCELLED', error: 'the room connection was closed during startup' });
        }
      });
      function rejectStart(answer) {
        if (settled) return;
        settled = true;
        var error = storageFailure(answer.reason || 'SERVICE_UNAVAILABLE', answer.error || 'the room did not answer', answer.status, answer.limits);
        error.room = channel.room;
        error.requestId = requestId;
        reject(error);
      }
      function fail(answer) {
        if (settled) return;
        rejectStart(answer);
        channel.close();
      }
      channel.opened = function (answer) {
        if (settled) return;
        if (!answer.ok) return fail(answer);
        settled = true;
        window.clearTimeout(timer);
        channel.seat = answer.seat || 0;
        resolve(channel);
      };
      var timer = window.setTimeout(function () {
        fail({ reason: 'SERVICE_UNAVAILABLE', error: 'the room did not answer; retry with the same requestId' });
      }, 30000);
      liveChannels[id] = channel;
      livePorts[id] = ports.port1;
      ports.port1.onmessage = function (event) {
        var data = event.data;
        if (closed || !data || data.id !== id || data.document !== storageDocument) return;
        if (data.type === 'mb-live-created') {
          if (received || !data.room || typeof data.room.name !== 'string') return;
          received = true;
          channel.room = data.room;
          if (!data.replayed && Array.isArray(data.replacedRooms)) captured.forEach(function (old) {
            if (liveChannels[old.id] === old && old.room && data.replacedRooms.indexOf(old.room.name) >= 0) old.close();
          });
          return;
        }
        if (data.type === 'mb-live-closed' && !settled) return fail(data);
        liveMessage(data);
        if (data.type === 'mb-live-closed') release();
      };
      var targetOrigin = WEB;
      try { if (target.location.origin === window.location.origin) targetOrigin = window.location.origin; } catch (e) { /* cross-origin broker */ }
      try {
        target.postMessage({ type: 'mb-live-create', id: id, document: storageDocument, game_id: gameId,
          seats: input.seats, resources: input.resources, requestId: requestId }, targetOrigin, [ports.port2]);
      } catch (e) { fail({ reason: 'INVALID_REQUEST', error: 'the room request could not be sent', status: 400 }); }
    });
  }

  window.addEventListener('pagehide', function () {
    Object.keys(livePorts).forEach(function (id) { if (liveChannels[id]) liveChannels[id].close(); });
  });

  var live = {
    create: createResourceRoom,
    // join(opts) -> Promise<channel>
    //
    // `opts` is exactly `room.join`'s: the room's name, or `seats` when opening
    // one. The seat comes back on `channel.seat`, the room on `channel.room`.
    // A refusal is the same refusal `room.join` gives -- `reason`, and
    // `needsAccount` when the panel is asking somebody to sign in.
    join: function (opts) {
      return room.join(opts).then(function (r) {
        return openChannel(r.name).then(function (channel) {
          channel.room = r;
          return channel;
        });
      });
    },
    lobby: function (fn) {
      if (typeof fn === 'function') lobbyFns.push(fn);
      if (lobbyLast) tellOne(fn, lobbyLast);
    },
    match: function (fn) {
      if (typeof fn !== 'function') return;
      matchFn = fn;
      if (started) return tellOne(fn, started);
      var linked = roomInTheAddress();
      if (linked && !playing) live.play({ room: linked }).catch(function () { /* told through lobby */ });
    },
    play: play,
    // waiting() -> Promise<[{ room, seats, present: [{ username, waited_s }] }]>
    //
    // WHO IS WAITING ON THIS PAGE NOW (spec 55), for a page that says so before
    // anybody presses its button. Public rooms with a free seat only; a named
    // room is never in it. It is to SHOW, not to pick from: play({ public: true })
    // seats them in the first room listed, which is the fullest (`46`).
    //
    // NOT YOURSELF. The read holds no credential, so the viewer's own name is
    // taken out here, and a room left with nobody in it is not offered.
    waiting: function () {
      return fetch(API + '/rooms/' + encodeURIComponent(gameId), { mode: 'cors', credentials: 'omit' })
        .then(function (answer) { return answer.ok ? answer.json() : { waiting: [] }; })
        .then(function (said) {
          var me = viewer.username;
          return (said.waiting || []).map(function (r) {
            return { room: r.room, seats: r.seats, present: (r.present || []).filter(function (p) { return !me || p.username !== me; }) };
          }).filter(function (r) { return r.present.length > 0; });
        })
        .catch(function () { return []; });
    },
    leave: function () {
      var had = playing;
      playing = null;
      started = null;
      lobbyLast = null;
      if (!had) return Promise.resolve();
      return had.then(function (channel) {
        channel.close();
        return room.leave(channel.room.name);
      }, function () { /* never seated */ });
    }
  };

  // THE PAGE DRAWS THE ROOM; WE RUN IT (spec 48).
  //
  // Which room, the join, the socket, who is present and when the match starts
  // were written again on every page, and every page got one of them wrong. So
  // they are here: the address wins as soon as a page registers `match`, and
  // `match` is called once, when every seat is connected. The page draws the
  // lobby from `lobby`'s state and the match from the channel, in its own look.
  var lobbyFns = [];
  var lobbyLast = null;
  var matchFn = null;
  var playing = null;
  var started = null;
  var rejoins = 0;
  var MAX_REJOINS = 5;

  function tellOne(fn, value) {
    try { fn(value); } catch (e) { /* the page owns its handler */ }
  }

  function tellLobby(state) {
    lobbyLast = state;
    lobbyFns.slice().forEach(function (fn) { tellOne(fn, state); });
  }

  function keepRoomInAddress(name) {
    try {
      var here = new URL(window.location.href);
      if (here.searchParams.get('room') === name) return;
      here.searchParams.set('room', name);
      window.history.replaceState(window.history.state, '', here.toString());
    } catch (e) { /* an address we cannot write is still a room we are in */ }
  }

  function play(opts) {
    if (playing) return playing;
    var mine = playing = live.join(opts || { seats: 2 }).then(function (channel) {
      if (playing !== mine) {
        channel.close();
        return channel;
      }
      var r = channel.room;
      var names = {};
      (r.seated || []).forEach(function (s) { names[s.seat] = s.username || ''; });
      var shown = '';
      var asking = null;
      keepRoomInAddress(r.name);
      function present(seats) {
        return seats.map(function (seat) {
          return { seat: seat, username: names[seat] || '', mine: seat === channel.seat };
        });
      }
      function tell(seats) {
        tellLobby({
          room: r.name,
          seats: r.seats,
          mine: channel.seat,
          present: present(seats),
          link: shareUrl({ room: r.name })
        });
      }
      // A NAME IS ASKED FOR ONCE PER ARRIVAL. The tick carries seat numbers,
      // and the room's seated list is where a number becomes a person.
      function learnNames(seats) {
        if (seats.every(function (seat) { return names[seat] !== undefined; })) return Promise.resolve();
        if (asking) return asking;
        asking = room.join({ room: r.name }).then(function (fresh) {
          (fresh.seated || []).forEach(function (s) { names[s.seat] = s.username || ''; });
          channel.room = fresh;
          seats.forEach(function (seat) { if (names[seat] === undefined) names[seat] = ''; });
        }, function () {
          seats.forEach(function (seat) { if (names[seat] === undefined) names[seat] = ''; });
        }).then(function () { asking = null; });
        return asking;
      }
      function start(seats) {
        // THE MATCH OPENS WITH EVERYBODY NAMED. A page drawing "Them" over the
        // other person is what STACK showed; one round trip is the price.
        learnNames(seats).then(function () {
          if (playing !== mine || started) return;
          tell(seats);
          rejoins = 0;
          started = channel;
          if (matchFn) tellOne(matchFn, channel);
        });
      }
      tell([channel.seat]);
      // A CHANNEL THAT CLOSES BEFORE THE MATCH IS A LOBBY THAT WOULD WAIT FOR
      // EVER. Measured 2026-09-26: a person waiting in a lobby lost the socket
      // and the page drew "waiting" until it was reloaded. So the room is joined
      // again, a few times and more slowly each time. Closed because this seat
      // opened in another window (4001) is not a fault: that window is the one
      // the person is looking at, and joining back would take the seat from it.
      channel.on('close', function (closed) {
        if (playing !== mine || started) return;
        playing = null;
        if (closed && closed.code === 4001) {
          tellLobby({ room: r.name, refused: { reason: 'OPENED_ELSEWHERE', needsAccount: false } });
          return;
        }
        if (rejoins >= MAX_REJOINS) {
          tellLobby({ room: r.name, refused: { reason: 'ROOM_UNREACHABLE', needsAccount: false } });
          return;
        }
        var wait = 500 * Math.pow(2, rejoins++);
        window.setTimeout(function () {
          if (!playing && !started) play({ room: r.name }).catch(function () { /* told through lobby */ });
        }, wait);
      });
      var off = channel.on('tick', function (tick) {
        if (playing !== mine || started) return off();
        var seats = (tick.seats || []).slice().sort(function (a, b) { return a - b; });
        var key = seats.join(',');
        if (key === shown) return;
        // A SEAT THAT EMPTIES FORGETS ITS NAME: the next person to take that
        // number is somebody else (`46`).
        (shown ? shown.split(',').map(Number) : []).forEach(function (seat) {
          if (seats.indexOf(seat) < 0 && seat !== channel.seat) delete names[seat];
        });
        shown = key;
        if (seats.length >= r.seats) return start(seats);
        tell(seats);
        learnNames(seats).then(function () {
          if (playing === mine && !started && shown === key) tell(seats);
        });
      });
      return channel;
    });
    mine.catch(function (e) {
      if (playing !== mine) return;
      playing = null;
      var needsAccount = !!(e && e.needsAccount);
      tellLobby({
        room: (opts && opts.room) || '',
        refused: { reason: (e && (e.reason || e.message)) || '', needsAccount: needsAccount }
      });
      if (needsAccount) afterSignIn(opts);
    });
    return mine;
  }

  // A SEAT NEEDS AN ACCOUNT, AND THE PANEL ASKS FOR ONE. The ask that was
  // refused is made again once they are signed in, so a page never waits for
  // the sign-in itself.
  function afterSignIn(opts) {
    var off = null;
    var fresh = true;
    off = viewer.onchange(function (now) {
      if (fresh) { fresh = false; return; }
      if (!now.signedIn) return;
      if (off) off();
      if (!playing) play(opts).catch(function () { /* told through lobby */ });
    });
  }
  seam.live = live;
  seam.matches = {
    list: function (options) {
      options = options === undefined ? {} : options;
      if (!options || typeof options !== 'object' || Array.isArray(options) ||
          Object.keys(options).some(function (key) { return key !== 'limit' && key !== 'cursor'; }) ||
          options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) ||
          options.cursor !== undefined && (typeof options.cursor !== 'string' || !options.cursor || new TextEncoder().encode(options.cursor).length > 1024)) {
        return Promise.reject(storageFailure('INVALID_REQUEST', 'use limit from 1 through 100 and an optional cursor', 400));
      }
      var ask = { type: 'mb-matches-ask', op: 'list' };
      if (options.limit !== undefined) ask.limit = options.limit;
      if (options.cursor !== undefined) ask.cursor = options.cursor;
      return documentAsk(ask, 'mb-matches-result', 8000, 'SERVICE_UNAVAILABLE', 'the history did not answer');
    }
  };
  // A WORLD THAT KEEPS GOING (spec 57): one act, one answer, decided by the
  // page's own world.js on our side.
  seam.world = {
    act: function (input) {
      return documentAsk({ type: 'mb-world-ask', op: 'act', input: input === undefined ? null : input },
        'mb-world-result', 30000, 'SERVICE_UNAVAILABLE', 'the world did not answer');
    }
  };
  // TELL THIS PERSON ON THEIR PHONE (web push). The browser asks; the broker,
  // which holds the session, keeps the subscription. On iOS a page can be told
  // things only once it is on the home screen.
  seam.push = {
    enable: function () {
      var worker = navigator.serviceWorker;
      if (!worker || !window.PushManager || !window.Notification) {
        return Promise.reject(storageFailure('UNSUPPORTED', 'this browser cannot show notices; on an iPhone, add the page to the home screen first', 501));
      }
      return Notification.requestPermission().then(function (allowed) {
        if (allowed !== 'granted') throw storageFailure('DENIED', 'notices are not allowed in this browser', 403);
        return Promise.all([worker.ready, fetch(API + '/push/key').then(function (r) { return r.json(); })]);
      }).then(function (both) {
        var raw = atob(String(both[1].key || '').replace(/-/g, '+').replace(/_/g, '/'));
        var key = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
        return both[0].pushManager.getSubscription().then(function (kept) {
          return kept || both[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        });
      }).then(function (subscription) {
        return documentAsk({ type: 'mb-push-ask', op: 'enable', subscription: subscription.toJSON(), origin: location.origin },
          'mb-push-result', 15000, 'SERVICE_UNAVAILABLE', 'push did not answer');
      });
    }
  };
  /* WHAT A PAGE MAKES FROM WHAT A PERSON TYPES (spec 62). The person signed
   * in pays, from their own allowance. A refusal is a value the page shows in
   * its own words -- `{ refused: "sign_in" | "allowance" | "too_fast" |
   * "not_allowed" | "unavailable" }` -- and only a malformed call throws. */
  function generateAsk(ask) {
    return documentAsk(ask, 'mb-generate-result', 90000, 'SERVICE_UNAVAILABLE', 'nothing was made in time')
      .catch(function (e) {
        if (e && (e.reason === 'INVALID_REQUEST' || e.reason === 'WRONG_PAGE')) throw e;
        return { refused: 'unavailable' };
      });
  }
  function generatePrompt(prompt) {
    return typeof prompt === 'string' && prompt.trim() !== '' && Array.from(prompt).length <= 4000;
  }
  seam.generate = {
    text: function (prompt, options) {
      options = options === undefined ? {} : options;
      if (!generatePrompt(prompt) || !options || typeof options !== 'object' || Array.isArray(options) ||
          Object.keys(options).some(function (key) { return key !== 'max'; }) ||
          options.max !== undefined && (!Number.isInteger(options.max) || options.max < 1 || options.max > 4000)) {
        return Promise.reject(storageFailure('INVALID_REQUEST', 'a prompt is 1 to 4000 characters, and max is 1 to 4000', 400));
      }
      var ask = { type: 'mb-generate-ask', op: 'text', prompt: prompt };
      if (options.max !== undefined) ask.max = options.max;
      return generateAsk(ask);
    },
    // `url` is on this page's own origin, so a canvas draws it.
    image: function (prompt, options) {
      options = options === undefined ? {} : options;
      if (!generatePrompt(prompt) || !options || typeof options !== 'object' || Array.isArray(options) ||
          Object.keys(options).some(function (key) { return key !== 'size'; }) ||
          options.size !== undefined && ['square', 'wide', 'tall'].indexOf(options.size) < 0) {
        return Promise.reject(storageFailure('INVALID_REQUEST', 'a prompt is 1 to 4000 characters, and size is square, wide or tall', 400));
      }
      var ask = { type: 'mb-generate-ask', op: 'image', prompt: prompt };
      if (options.size !== undefined) ask.size = options.size;
      return generateAsk(ask);
    }
  };
  /* THE ITEMS A PERSON BRINGS (spec 59).
   *
   * The page declares its slots in `slots.json` beside it: a name and the kind
   * of item it accepts. It reads ONE item per slot, the one this person
   * equipped, and never the inventory. null means "draw your own default" --
   * for an anonymous visitor, for a slot nobody filled, and when the panel is
   * not there to ask. A page that always gets an answer is a page that never
   * shows an empty garage because a read failed.
   *
   * THE FILES ARE SERVED ON THIS PAGE'S OWN ORIGIN, under /__mb/items/, named
   * by their hash. The page CSP admits nothing else, and needs nothing else. */
  var SLOTS_FILE = 'slots.json';
  var ITEM_NAME = /^[a-z][a-z0-9_]{0,39}$/;
  var ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var ITEM_HASH = /^[0-9a-f]{64}$/;
  // ONE OF THE PAGE'S OWN THINGS, by the id the page gave it in slots.json.
  var OWN_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  var ITEM_EXT = { 'model/gltf-binary': 'glb', 'image/png': 'png' };
  var slotsFile = null;
  var itemWatchers = {};
  var itemViewer = null;

  function slotsDeclared() {
    if (!slotsFile) {
      slotsFile = new Promise(function (resolve) {
        try {
          fetch(new URL(SLOTS_FILE, window.location.href).href, { credentials: 'omit' })
            .then(function (response) { return response.ok ? response.json() : {}; })
            .then(function (file) {
              var slots = {};
              if (file && typeof file === 'object' && !Array.isArray(file)) {
                Object.keys(file).forEach(function (name) {
                  var spec = file[name];
                  if (ITEM_NAME.test(name) && spec && typeof spec.kind === 'string' && ITEM_NAME.test(spec.kind)) {
                    slots[name] = { kind: spec.kind, own: ownOf(spec.own), quality: qualityOf(spec.quality) };
                  }
                });
              }
              resolve(slots);
            }, function () { resolve({}); });
        } catch (e) { resolve({}); }
      });
    }
    return slotsFile;
  }

  // THE PAGE'S OWN THINGS FOR ONE SLOT, as the page declared them: an id, a
  // name, and a picture the page serves itself. They are not platform items;
  // the page draws them. A picture is kept only on this page's own origin.
  function ownOf(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    list.slice(0, 24).forEach(function (o) {
      if (!o || typeof o.id !== 'string' || !OWN_ID.test(o.id) || typeof o.name !== 'string' ||
          !o.name.trim() || o.name.length > 40) return;
      var icon = '';
      try {
        var at = new URL(String(o.icon || ''), window.location.href);
        if (o.icon && at.origin === window.location.origin) icon = at.href;
      } catch (e) { /* no picture */ }
      out.push({ id: o.id, name: o.name.trim(), icon: icon });
    });
    return out;
  }

  function slotSpec(slot) {
    return slotsDeclared().then(function (slots) {
      if (typeof slot !== 'string' || !Object.prototype.hasOwnProperty.call(slots, slot)) {
        throw storageFailure('UNKNOWN_SLOT', 'declare this slot in slots.json beside the page', 400);
      }
      return slots[slot];
    });
  }

  function slotKind(slot) {
    return slotsDeclared().then(function (slots) {
      if (typeof slot !== 'string' || !Object.prototype.hasOwnProperty.call(slots, slot)) {
        throw storageFailure('UNKNOWN_SLOT', 'declare this slot in slots.json beside the page', 400);
      }
      return slots[slot].kind;
    });
  }

  function itemFiles(found) {
    var files = {};
    Object.keys(found.files || {}).forEach(function (role) {
      var file = found.files[role];
      if (!file || typeof file !== 'object') return;
      var copy = {};
      Object.keys(file).forEach(function (key) { copy[key] = file[key]; });
      var ext = ITEM_EXT[file.type];
      if (ext && typeof file.sha256 === 'string' && ITEM_HASH.test(file.sha256)) {
        copy.url = '/__mb/items/' + file.sha256 + '.' + ext;
      }
      files[role] = copy;
    });
    var item = {};
    Object.keys(found).forEach(function (key) { item[key] = found[key]; });
    item.files = files;
    // WHERE AN ITEM CAME FROM IS NOT THE PAGE'S CONCERN (spec 61): a candidate
    // not kept yet fills a slot like any item. Our picker reads it; a page never.
    delete item.in_progress;
    return item;
  }

  // THE QUALITY IS THE PAGE'S (spec 59). Sasun, 2026-10-08: "If its ok with
  // simple we pick simple and build simple for user. If its real high quality
  // then we pick high and build high". Anything else a page writes is simple.
  function qualityOf(value) {
    return value === 'high' ? 'high' : 'simple';
  }

  // THE RENDITION THE SLOT ASKED FOR, under the usual names. A high slot gets
  // the high model as `files.glb` and its facts as the kind's own facts, and
  // never sees an item without one: that answers null, and the page draws its
  // own. A simple slot never sees the high model. Page code does not change.
  function rendition(found, quality) {
    if (!found || found.own || !found.files) return found;
    var key = found.kind + '_high';
    var files = {};
    Object.keys(found.files).forEach(function (role) { files[role] = found.files[role]; });
    var item = {};
    Object.keys(found).forEach(function (name) { item[name] = found[name]; });
    if (quality === 'high') {
      if (!files.glb_high || !found[key]) return null;
      files.glb = files.glb_high;
      item[found.kind] = found[key];
    }
    delete files.glb_high;
    delete item[key];
    item.files = files;
    return item;
  }

  function itemIn(slot) {
    return slotSpec(slot).then(function (spec) {
      return documentAsk({ type: 'mb-items-ask', op: 'get', slot: slot, kind: spec.kind },
        'mb-items-result', 8000, 'SERVICE_UNAVAILABLE', 'the item did not answer')
        .then(function (result) {
          if (result && typeof result.own === 'string' && OWN_ID.test(result.own)) return { own: result.own };
          return result && result.item ? rendition(itemFiles(result.item), spec.quality) : null;
        }, function () { return null; });
    });
  }

  function tellItem(slot, found) {
    (itemWatchers[slot] || []).slice().forEach(function (fn) {
      try { fn(found); } catch (e) { /* the page's own handler */ }
    });
  }

  function watchItemViewer() {
    if (itemViewer !== null) return;
    itemViewer = '';
    viewer.onchange(function (now) {
      var who = (now && now.signedIn ? 'in:' : 'out:') + (now && now.id || '');
      if (itemViewer === '') { itemViewer = who; return; }
      if (who === itemViewer) return;
      itemViewer = who;
      Object.keys(itemWatchers).forEach(function (slot) {
        if (!itemWatchers[slot].length) return;
        itemIn(slot).then(function (found) { tellItem(slot, found); }, function () { /* not declared */ });
      });
    });
  }

  seam.items = {
    get: itemIn,
    equip: function (slot, itemId, options) {
      // ONE OF THE PAGE'S OWN THINGS is { own: id }, and only for this page.
      var own = itemId && typeof itemId === 'object' ? itemId.own : null;
      if (own !== null) {
        if (typeof own !== 'string' || !OWN_ID.test(own) || options && options.everywhere) {
          return Promise.reject(storageFailure('INVALID_REQUEST', 'own is one of this page\'s own ids, for this page only', 400));
        }
        return slotSpec(slot).then(function (spec) {
          if (!spec.own.some(function (o) { return o.id === own; })) {
            throw storageFailure('UNKNOWN_OWN', 'declare it in the own list of this slot in slots.json', 400);
          }
          return documentAsk({ type: 'mb-items-ask', op: 'equip', slot: slot, kind: spec.kind, item: null, own: own },
            'mb-items-result', 15000, 'SERVICE_UNAVAILABLE', 'the choice did not answer; read the slot again');
        }).then(function () {
          return itemIn(slot);
        }).then(function (found) {
          tellItem(slot, found);
          return found;
        });
      }
      if (itemId !== null && (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) ||
          options !== undefined && (!options || typeof options !== 'object' ||
            Object.keys(options).some(function (key) { return key !== 'everywhere'; }) ||
            options.everywhere !== undefined && typeof options.everywhere !== 'boolean')) {
        return Promise.reject(storageFailure('INVALID_REQUEST', 'equip a UUID item, or null to clear the slot', 400));
      }
      return slotKind(slot).then(function (kind) {
        var ask = { type: 'mb-items-ask', op: 'equip', slot: slot, kind: kind,
                    item: itemId === null ? null : itemId.toLowerCase() };
        if (options && options.everywhere) ask.everywhere = true;
        return documentAsk(ask, 'mb-items-result', 15000, 'SERVICE_UNAVAILABLE', 'the choice did not answer; read the slot again');
      }).then(function () {
        return itemIn(slot);
      }).then(function (found) {
        tellItem(slot, found);
        return found;
      });
    },
    // A PICTURE mb.generate.image MADE, kept in the person's inventory (spec
    // 62, stage 3). It answers the item, which an image slot can then hold.
    keep: function (sha, kind, options) {
      var name = options && typeof options === 'object' ? options.name : undefined;
      if (typeof sha !== 'string' || !ITEM_HASH.test(sha) || kind !== 'image' ||
          typeof name !== 'string' || !name.trim() || name.length > 60) {
        return Promise.reject(storageFailure('INVALID_REQUEST',
          'keep(sha, "image", { name }) with the sha mb.generate.image answered and a name of 1 to 60 characters', 400));
      }
      return documentAsk({ type: 'mb-items-ask', op: 'keep', sha: sha, kind: kind, name: name },
        'mb-items-result', 30000, 'SERVICE_UNAVAILABLE', 'the picture was not kept; keep it again')
        .then(function (result) {
          if (!result || !result.item || result.item.kind !== kind) {
            throw storageFailure('SERVICE_UNAVAILABLE', 'the keep response was invalid');
          }
          return itemFiles(result.item);
        });
    },
    // OUR SHEET OVER THE PAGE; the answer is { picked: item or null } or
    // { cancelled: true }. The choice is for this page only (Sasun, 2026-10-07).
    pick: function (slot) {
      return slotSpec(slot).then(function (spec) {
        var kind = spec.kind;
        // WHAT IS IN THE SLOT NOW only marks a card, so it is not waited on: a
        // surface that cannot answer must not hold the sheet back.
        var now = Promise.race([
          itemIn(slot).catch(function () { return null; }),
          new Promise(function (resolve) { window.setTimeout(function () { resolve(null); }, 1500); })
        ]);
        return now.then(function (found) {
          var mark = found && found.own ? 'own:' + found.own : found && found.id || null;
          return askForThePicker(kind, mark, spec.own, spec.quality);
        });
      }).then(function (answer) {
        if (!answer || answer.cancelled) return { cancelled: true };
        return seam.items.equip(slot, answer.picked).then(function (found) {
          return { picked: found };
        });
      });
    },
    // `shared(kind)` answers every shared item as it is. `shared(kind,
    // { quality })` answers only those with that rendition, under the usual
    // names, the way a slot of that quality reads them.
    shared: function (kind, options) {
      if (typeof kind !== 'string' || !ITEM_NAME.test(kind)) {
        return Promise.reject(storageFailure('INVALID_REQUEST', 'name a kind, such as "vehicle"', 400));
      }
      var quality = options && options.quality;
      if (options !== undefined && (!options || typeof options !== 'object' ||
          Object.keys(options).some(function (key) { return key !== 'quality'; }) ||
          quality !== undefined && quality !== 'simple' && quality !== 'high')) {
        return Promise.reject(storageFailure('INVALID_REQUEST', 'quality is "simple" or "high"', 400));
      }
      return fetch(API + '/items/shared?kind=' + encodeURIComponent(kind), { credentials: 'omit' })
        .then(function (response) {
          return response.json().catch(function () { return null; }).then(function (body) {
            if (!response.ok) throw storageFailure(body && body.code || 'SERVICE_UNAVAILABLE', body && body.error || 'the shared items could not be read', response.status);
            var list = body && Array.isArray(body.data) ? body.data : null;
            if (!list) throw storageFailure('SERVICE_UNAVAILABLE', 'the shared items response was invalid');
            var items = list.filter(function (found) {
              return found && typeof found === 'object' && found.kind === kind && found.files && typeof found.files === 'object';
            }).map(itemFiles);
            if (!quality) return items;
            return items.map(function (found) { return rendition(found, quality); }).filter(Boolean);
          });
        }).catch(function (error) {
          if (error && error.reason) throw error;
          throw storageFailure('SERVICE_UNAVAILABLE', 'the shared items could not be reached');
        });
    },
    on: function (slot, fn) {
      if (typeof fn !== 'function' || typeof slot !== 'string') return function () {};
      (itemWatchers[slot] = itemWatchers[slot] || []).push(fn);
      watchItemViewer();
      return function () {
        var list = itemWatchers[slot] || [];
        var at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
      };
    }
  };
  seam.shareUrl = shareUrl;
  // WHICH GAME THE READER IS LOOKING AT, told by the shell as it scrolls.
  //
  // The entry document is a feed: the game the link named is the first thing on
  // it, and its neighbours are under it. The rail belongs to whichever one is
  // on the screen -- its likes, its share, its history are that game's -- so it
  // is re-pointed here rather than rebuilt, and the play is counted for the
  // same game at the same moment.
  //
  // SAME DOCUMENT, SO A CALL AND NOT A MESSAGE. The shell and this script are
  // one page; a postMessage between them would be a protocol invented for two
  // halves of the same window. The rail's bundle is in the same document too,
  // and it hears the event this dispatches.
  seam.showGame = function (which) {
    if (!which || which === current) return;
    current = which;
    reportPlay(which);
    try {
      // THE RAIL FOLLOWS. It is DOM in this document (spec 38), so it is told
      // with an event rather than by re-pointing a frame.
      window.dispatchEvent(new CustomEvent('mb:show', { detail: { id: which } }));
    } catch (e) { /* the rail is a bonus; the game is the page */ }
  };
})();
