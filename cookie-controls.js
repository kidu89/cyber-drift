(() => {
  const parentOrigin = document.body.dataset.cookieParent === 'self'
    ? location.origin : document.body.dataset.cookieParent;
  if (parentOrigin && window.parent !== window) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') window.parent.postMessage({ type: 'mb-cookie-close' }, parentOrigin);
    });
    document.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = new URLSearchParams(new FormData(form, event.submitter));
      const buttons = [...form.querySelectorAll('button')];
      const disabled = buttons.map((button) => button.disabled);
      buttons.forEach((button) => { button.disabled = true; });
      const error = document.querySelector('[role="alert"]');
      error.hidden = true;
      try {
        const response = await fetch(form.action, {
          method: 'POST', headers: { accept: 'application/json' }, body,
        });
        if (!response.ok) throw new Error('Cookie preference failed');
        window.parent.postMessage({ type: 'mb-cookie-saved', choice: body.get('choice') }, parentOrigin);
      } catch {
        error.textContent = 'Could not save your choice. Please try again.';
        error.hidden = false;
        buttons.forEach((button, index) => { button.disabled = disabled[index]; });
      }
    });
    document.querySelectorAll('button').forEach((button) => {
      button.disabled = button.value === 'accept' && document.body.dataset.cookieLocked === 'true';
    });
    return;
  }

  let dialog;
  let frame;
  let source;
  let opener;
  function close() {
    dialog.close();
  }
  function dismiss() {
    const zone = "localhost" === 'mindblown.ai' || "localhost".endsWith('.mindblown.ai');
    document.cookie = 'mb_cookie_notice=1; Path=/; Max-Age=15552000; SameSite=Lax' +
      (zone ? '; Domain=mindblown.ai' : '') + (location.protocol === 'https:' ? '; Secure' : '');
    document.querySelector('.mb-cookie-notice')?.remove();
  }
  function open(link) {
    if (dialog) return;
    const url = new URL(link.href);
    url.searchParams.set('return_to', url.origin === location.origin
      ? location.pathname + location.search + location.hash : location.href);
    url.searchParams.set('embed', '1');
    source = url.origin;
    opener = document.activeElement;
    dismiss();
    dialog = document.createElement('dialog');
    dialog.className = 'mb-cookie-dialog';
    dialog.setAttribute('aria-label', 'Cookie Preferences');
    frame = document.createElement('iframe');
    frame.title = 'Cookie Preferences';
    frame.src = url.href;
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-top-navigation-by-user-activation');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mb-cookie-close';
    button.setAttribute('aria-label', 'Close cookie preferences');
    button.textContent = '×';
    button.addEventListener('click', close);
    dialog.append(frame, button);
    dialog.addEventListener('close', () => {
      dialog.remove();
      dialog = null;
      frame = null;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    });
    document.body.append(dialog);
    dialog.showModal();
    button.focus();
  }
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('.mb-cookie-notice a');
    if (!link || new URL(link.href).pathname !== '/cookie-preferences') return;
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(link);
  });
  // A RELOAD THROWS AWAY THE RUN on the page, so Accept saves in place and the
  // tags it permits start with the next page. A failed save falls back to the
  // plain form, which navigates.
  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('.mb-cookie-notice')) return;
    form.elements.namedItem('return_to').value = location.pathname + location.search + location.hash;
    if (form.dataset.navigate) return;
    event.preventDefault();
    const submitter = event.submitter;
    try {
      const response = await fetch(form.action, {
        method: 'POST', headers: { accept: 'application/json' },
        body: new URLSearchParams(new FormData(form, submitter)),
      });
      if (!response.ok) throw new Error('Cookie preference failed');
      form.remove();
    } catch {
      form.dataset.navigate = '1';
      form.requestSubmit(submitter);
    }
  });
  // THE NOTICE INSIDE ANOTHER SITE'S FRAME (an X card). The answer is a cookie
  // the browser will not store there, so the shell would never see it and the
  // notice would never go. A new load of the notice's frame while focus is in
  // it IS the reader's answer, and it is remembered in this page's own
  // storage, which a card keeps.
  const NOTICE_KEY = 'mb.cookieNotice';
  const noticeFrame = document.querySelector('iframe.mb-cookie-notice');
  try {
    if (noticeFrame && localStorage.getItem(NOTICE_KEY) === '1') noticeFrame.remove();
  } catch { /* no storage: the cookie is the only record */ }
  // X SANDBOXES ITS CARD WITHOUT allow-forms, and a frame inherits that, so
  // the notice's own form cannot submit there. In a card the shell draws the
  // same notice itself, and the check mark is answered here.
  if (noticeFrame?.isConnected && inACard()) noticeFrame.replaceWith(cardNotice(noticeFrame.src));
  noticeFrame?.addEventListener('load', () => {
    // Focus is in the notice only after the reader clicked into it.
    if (document.activeElement === noticeFrame) {
      try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* nothing to keep it in */ }
      noticeFrame.remove();
      return;
    }
    if (document.cookie.split(';').some((pair) => pair.trim() === 'mb_cookie_notice=1')) noticeFrame.remove();
  });
  function inACard() {
    try {
      return window.top !== window.self;
    } catch {
      return true;
    }
  }
  function cardNotice(src) {
    const app = new URL(src);
    app.searchParams.delete('embed');
    const notice = document.createElement('div');
    notice.className = 'mb-cookie-notice';
    notice.setAttribute('role', 'region');
    notice.setAttribute('aria-label', 'Cookie choices');
    const text = document.createElement('p');
    const link = (href, label, name) => {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = label;
      if (name) a.setAttribute('aria-label', name);
      return a;
    };
    text.append('We use cookies to improve mindblown. See our ', link(new URL('/privacy', app).href, 'Privacy Policy'),
      ' and ', link(app.href, 'choices', 'Cookie Preferences'), '.');
    const accept = document.createElement('button');
    accept.className = 'mb-cookie-accept';
    accept.type = 'button';
    accept.setAttribute('aria-label', 'Accept');
    accept.title = 'Accept';
    accept.textContent = '\u2713';
    accept.addEventListener('click', () => {
      try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* nothing to keep it in */ }
      notice.remove();
    });
    notice.append(text, accept);
    return notice;
  }
  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== source) return;
    if (event.data?.type === 'mb-cookie-close') close();
    // A RELOAD ONLY TAKES TAGS BACK. The edge adds them to the next page after
    // an Accept, so only a tagged page that is now refused has work for it.
    if (event.data?.type === 'mb-cookie-saved' && event.data.choice !== 'accept' && tagged()) location.reload();
  });
  // A page restored from the back-forward cache keeps the tags it had. Reload
  // only a tagged page, because the choice can have changed to reject; an
  // untagged page has nothing to take back.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && tagged()) location.reload();
  });
  function tagged() {
    return Boolean(document.querySelector('meta[name="mb-measured"]') || 'dataLayer' in window || 'fbq' in window);
  }
})();
