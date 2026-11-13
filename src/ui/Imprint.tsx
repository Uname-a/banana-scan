// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Stefan Hermann (CNC Kitchen) <stefan@cnckitchen.com>

// About and privacy, opened from the status strip: what Banana Scan is and
// where it comes from, its license (the notices the AGPL asks a user
// interface to show), the third-party notices, and what the app keeps and
// fetches.
//
// rebrand:off
// ScanRuler's version of this was its imprint, naming CNC Kitchen as the
// site's operator, as German law asks of a site run from Germany. A fork must
// not name them, so whoever serves Banana Scan to the public adds their own
// operator details and privacy contact here.
// rebrand:on

import { plugins } from '../plugins/registry'
import { useStore } from '../state/store'
import { APP_VERSION, SOURCE_URL } from '../version'
import { useDismiss } from './useDismiss'

export function ImprintModal() {
  const open = useStore((s) => s.imprintOpen)
  const close = useStore((s) => s.openImprint)

  // Escape closes it. Captured, so the workspace's own Escape handling — which
  // would discard the draft behind the dialog — never sees the key.
  useDismiss(open, () => close(false))

  if (!open) return null
  // The plugins' notices on the third-party software they ship.
  const notices = plugins().flatMap((p) => (p.notices ? [{ id: p.id, Notices: p.notices }] : []))
  return (
    <div className="modalback" onClick={() => close(false)}>
      <div className="modal imprint" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead">
          <h2>About &amp; Privacy</h2>
          <button className="x" onClick={() => close(false)} aria-label="Close">
            ×
          </button>
        </div>
        <p className="dim" data-test="imprint-version">
          Banana Scan v{APP_VERSION} — quote the number when reporting a problem.
        </p>

        <h3>About</h3>
        {/* rebrand:off */}
        <p data-test="about-origin">
          Banana Scan is a modified version of{' '}
          <a href="https://github.com/CNCKitchen/ScanRuler" target="_blank" rel="noopener noreferrer">
            ScanRuler
          </a>{' '}
          by Stefan Hermann (CNC Kitchen), changed from its version 0.11.2 on 13 November 2026.
          It is not made or endorsed by CNC Kitchen; ScanRuler and CNC Kitchen are their
          trademarks.
        </p>
        {/* rebrand:on */}
        <p>
          Copyright © 2026 Stefan Hermann and the Banana Scan contributors. Banana Scan is free
          software under the{' '}
          <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">
            GNU Affero General Public License, version 3
          </a>{' '}
          (AGPL-3.0-only), and comes with no warranty. Its{' '}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            source code
          </a>{' '}
          is under the same license.
        </p>

        {notices.length > 0 && (
          <>
            <h3>Third-party software</h3>
            {notices.map(({ id, Notices }) => (
              <Notices key={id} />
            ))}
          </>
        )}

        <h3>Privacy</h3>
        <ul>
          <li>
            Your scans, reference models, fitted elements and every measurement made from them
            are processed entirely in your browser and are never uploaded. So that unsaved work
            survives a closed or crashed tab, a recovery copy of it, the files included, is kept
            on your device in your browser’s IndexedDB storage. Copies left by closed tabs are
            offered back when you open Banana Scan again, and are deleted when you discard them,
            after 14 days, once more than ten have built up, or when you clear this site’s data
            in your browser.
            The one exception is the optional agent connection: if you switch it on and accept its warning,
            what the AI agent you connected reads is processed by that agent and, unless its model
            runs on your computer, by the model’s provider, under that provider’s terms. Banana Scan
            itself sends none of this anywhere and has no part in that processing.
          </li>
          <li>
            Besides that recovery copy, this tool stores your settings on your device, in your
            browser’s localStorage: preferences such as the navigation scheme, colours, units,
            export and fit options, the guided hints and the Beta switch, and, if you use the
            agent connection, its port and the token that pairs it with the agent server. No
            personal data is stored.
          </li>
          <li>
            A link that opens a file (an address with <code>?open=</code> or <code>/s/</code>)
            makes your browser fetch that file from where the link points: for <code>/s/</code>{' '}
            the file store this copy was built with, if it has one, and for <code>?open=</code>{' '}
            any server the link names, which may belong to someone else and sees your IP address
            as any website does.
          </li>
          <li>
            The server this page comes from may log what your browser asks it for — your IP
            address, the time and the files fetched — as any web server can. Banana Scan has no
            cookies, analytics or tracking of its own.
          </li>
          {/* rebrand:off */}
          <li>
            Links to other websites — GitHub, and, if you switch on the card crediting ScanRuler,
            CNC Kitchen’s store, PayPal and Ko-fi — lead to sites with their own privacy policies.
          </li>
          {/* rebrand:on */}
        </ul>
      </div>
    </div>
  )
}
