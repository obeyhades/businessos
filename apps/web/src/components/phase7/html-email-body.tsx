'use client';

import { useMemo, useRef, useState } from 'react';

const MIN_HEIGHT = 60;
const MAX_HEIGHT = 1200;

/**
 * Renders an untrusted HTML email body inside a sandboxed iframe.
 *
 * Safety model (defense in depth — the HTML is never injected into our DOM):
 * - `sandbox="allow-same-origin"` deliberately OMITS `allow-scripts`, so no
 *   script in the email can ever execute; `allow-same-origin` only lets the
 *   parent read the (inert) document to auto-size the frame.
 * - A CSP `<meta>` inside the srcdoc blocks scripts, frames, forms and
 *   plugins even if the sandbox were bypassed; only images/styles/fonts load.
 * - `referrerPolicy="no-referrer"` keeps our URL out of remote image requests.
 */
export function HtmlEmailBody({ html, title }: { html: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);

  const srcDoc = useMemo(
    () =>
      [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src http: https: data: cid:; style-src \'unsafe-inline\' http: https:; font-src http: https: data:">',
        '<style>body{margin:0;padding:12px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;background:#ffffff;word-break:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>',
        '</head><body>',
        html,
        '</body></html>',
      ].join(''),
    [html],
  );

  function resize(): void {
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    setHeight(Math.min(Math.max(body.scrollHeight + 8, MIN_HEIGHT), MAX_HEIGHT));
  }

  return (
    <iframe
      ref={frameRef}
      title={title}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      onLoad={resize}
      style={{ height }}
      className="w-full rounded-md border border-border bg-white"
    />
  );
}
