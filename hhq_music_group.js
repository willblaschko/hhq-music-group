/* HHQ Music Group — one self-contained Sonos session console.
   Config: { slot: 1 }. Render N instances for N groups.
   State computed client-side from hass.states (instant, no template rate limits);
   mutations via script.music_slot_toggle / music_slot_play (fire-and-forget,
   executed by a Node-RED SOAP sequencer against the speakers directly). */

class HhqMusicGroup extends HTMLElement {
  static getStubConfig() { return { slot: 1 }; }

  setConfig(config) {
    if (!config.slot) throw new Error("slot (1-10) required");
    this._config = { search_entity: "media_player.spotifyplus_will", ...config };
    this._data = null;
  }

  connectedCallback() {}
  disconnectedCallback() {}

  set hass(hass) {
    this._hass = hass;
    if (!this._root) {
      this._root = this.attachShadow({ mode: "open" });
      this._shell();
    }
    this._ensureRoster().then(() => {
      const d = this._compute();
      const key = JSON.stringify(d);
      if (key !== this._key) { this._key = key; this._data = d; this._reconcile(d); this._render(); }
    });
  }

  async _ensureRoster() {
    if (this._rosterIds) return;
    if (!this._rosterFetch) {
      this._rosterFetch = this._hass.connection
        .sendMessagePromise({ type: "config/entity_registry/list" })
        .then((ents) => {
          this._rosterIds = ents
            .filter((e) => e.platform === "sonos" && e.entity_id.startsWith("media_player.")
              && !/surround|back_left|back_right/.test(e.entity_id)
              && !e.disabled_by && !e.hidden_by)
            .map((e) => e.entity_id);
        });
    }
    return this._rosterFetch;
  }

  _st(e) { return this._hass.states[e]; }
  _grp(e) { const s = this._st(e); return (s && s.attributes.group_members) || [e]; }

  _coordOf(anchor) {
    if (!anchor || !anchor.startsWith("media_player.")) return "";
    const s = this._st(anchor);
    if (!s || ["unknown", "unavailable"].includes(s.state)) return "";
    return this._grp(anchor)[0];
  }

  _compute() {
    const n = this._config.slot;
    const anchor = (this._st(`input_text.music_slot_${n}`) || {}).state || "";
    let coord = this._coordOf(anchor);
    let merged = 0;
    for (let j = 1; j < n; j++) {
      const c2 = this._coordOf((this._st(`input_text.music_slot_${j}`) || {}).state || "");
      if (c2 && c2 === coord) { merged = j; break; }
    }
    const cs = coord ? this._st(coord) : null;
    const mem = coord && cs ? this._grp(coord) : [];
    const roster = (this._rosterIds || [])
      .filter((e) => { const s = this._st(e); return s && s.state !== "unavailable"; })
      .sort()
      .map((e) => ({ e, n: (this._st(e).attributes.friendly_name || e), lit: mem.includes(e) }));
    return {
      coord, merged, roster,
      state: cs ? cs.state : "",
      title: cs ? cs.attributes.media_title : null,
      artist: cs ? cs.attributes.media_artist : null,
      art: cs ? cs.attributes.entity_picture : null,
      vol: cs ? cs.attributes.volume_level : null,
      members: mem,
    };
  }

  _reconcile(d) {
    const now = Date.now();
    this._optimistic = this._optimistic || {};
    for (const [e, o] of Object.entries(this._optimistic)) {
      const actual = d.roster.find((r) => r.e === e);
      if (!actual || actual.lit === o.lit || now - o.ts > 25000) delete this._optimistic[e];
    }
  }

  _shell() {
    this._root.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: 14px; padding: 10px;
          border: 1px solid var(--divider-color, rgba(120,120,120,.2));
        }
        .hdr { display: flex; align-items: center; gap: 10px; min-height: 56px; }
        .art { width: 56px; height: 56px; border-radius: 10px; object-fit: cover;
               background: var(--secondary-background-color); flex: none; }
        .meta { flex: 1; min-width: 0; }
        .t { font-size: 14px; font-weight: 600; color: var(--primary-text-color);
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .a { font-size: 12px; color: var(--secondary-text-color);
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .btn { border: none; background: var(--secondary-background-color);
               border-radius: 50%; width: 40px; height: 40px; cursor: pointer;
               color: var(--primary-text-color); flex: none;
               display: flex; align-items: center; justify-content: center; }
        .btn ha-icon { --mdc-icon-size: 22px; }
        .vol { display: flex; align-items: center; gap: 8px; margin: 8px 2px 2px; }
        .vol ha-icon { color: var(--secondary-text-color); --mdc-icon-size: 18px; flex: none; }
        input[type=range] { flex: 1; accent-color: var(--primary-color); height: 22px; }
        .roster { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .chip { font-size: 12px; padding: 6px 10px; border-radius: 16px; cursor: pointer;
                background: var(--secondary-background-color); color: var(--secondary-text-color);
                border: 1px solid transparent; user-select: none; }
        .chip.lit { background: rgba(102,187,106,.22); color: var(--primary-text-color);
                    border-color: rgba(102,187,106,.6); font-weight: 600; }
        .chip.pending { opacity: .45; }
        .empty { font-size: 13px; color: var(--secondary-text-color); padding: 8px 2px; }
        .merged { font-size: 13px; color: var(--secondary-text-color); padding: 14px 2px;
                  text-align: center; }
        .ov { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 12;
              display: flex; align-items: center; justify-content: center; }
        .panel { background: var(--card-background-color, #fff); border-radius: 16px;
                 width: min(440px, 92vw); max-height: 82vh; overflow-y: auto;
                 padding: 14px; box-shadow: 0 8px 40px rgba(0,0,0,.4); }
        .sbox { display: flex; align-items: center; gap: 8px;
                background: var(--secondary-background-color); border-radius: 12px;
                padding: 6px 12px; margin-bottom: 6px; }
        .sbox input { flex: 1; border: none; outline: none; background: transparent;
                      color: var(--primary-text-color); font: inherit; font-size: 14px; }
        .sbox ha-icon { color: var(--secondary-text-color); --mdc-icon-size: 20px; }
        .lbl { font-size: 11px; letter-spacing: .5px; text-transform: uppercase;
               color: var(--secondary-text-color); margin: 10px 2px 4px; }
        .row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px;
               scrollbar-width: none; }
        .row::-webkit-scrollbar { display: none; }
        .tile { flex: none; width: 76px; cursor: pointer; }
        .tile img { width: 76px; height: 76px; border-radius: 10px; object-fit: cover;
                    background: var(--secondary-background-color); display: block; }
        .tile.played img { outline: 3px solid var(--success-color, #4caf50); }
        .tt { font-size: 11px; line-height: 1.25; margin-top: 3px;
              color: var(--primary-text-color); display: -webkit-box;
              -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .ts { font-size: 10px; color: var(--secondary-text-color); white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; }
      </style>
      <div class="card"><div id="body"><div class="empty">…</div></div></div>`;
  }

  _svc(domain, service, data) { this._hass.callService(domain, service, data); }

  _toggle(entity, currentLit) {
    this._optimistic = this._optimistic || {};
    this._optimistic[entity] = { lit: !currentLit, ts: Date.now() };
    const data = { slot: this._config.slot, player: entity };
    if (this._data && this._data.coord) data.seen_coord = this._data.coord;
    this._svc("script", "music_slot_toggle", data);
    this._render();
  }

  _render() {
    const d = this._data, body = this._root.getElementById("body");
    if (!d) return;
    body.innerHTML = "";

    this._optimistic = this._optimistic || {};
    const empty = !d.coord || d.merged;
    const seedPending = empty && Object.values(this._optimistic).some((o) => o.lit);

    if (!empty) {
      const hdr = document.createElement("div"); hdr.className = "hdr";
      const art = d.art ? `<img class="art" src="${d.art}">`
                        : `<div class="art"></div>`;
      const playing = d.state === "playing";
      hdr.innerHTML = `${art}
        <div class="meta">
          <div class="t">${d.title || (d.state === "paused" ? "Paused" : "Nothing playing")}</div>
          <div class="a">${d.artist || d.members.length + " speaker" + (d.members.length > 1 ? "s" : "")}</div>
        </div>
        <button class="btn" id="pp"><ha-icon icon="${playing ? "mdi:pause" : "mdi:play"}"></ha-icon></button>
        <button class="btn" id="find"><ha-icon icon="mdi:magnify"></ha-icon></button>`;
      body.appendChild(hdr);
      hdr.querySelector("#pp").addEventListener("click", () =>
        this._svc("media_player", "media_play_pause", { entity_id: d.coord }));
      hdr.querySelector("#find").addEventListener("click", () => this._openModal());

      if (d.vol !== null && d.vol !== undefined) {
        const vol = document.createElement("div"); vol.className = "vol";
        vol.innerHTML = `<ha-icon icon="mdi:volume-high"></ha-icon>
          <input type="range" min="0" max="0.7" step="0.01" value="${d.vol}">`;
        vol.querySelector("input").addEventListener("change", (e) =>
          this._svc("media_player", "volume_set",
            { entity_id: d.members, volume_level: parseFloat(e.target.value) }));
        body.appendChild(vol);
      }
    } else {
      body.innerHTML = `<div class="empty">${seedPending
        ? "Starting group…" : "Empty — tap a speaker to start a group here."}</div>`;
    }
    if (empty) for (const r of d.roster) r.lit = false;

    const roster = document.createElement("div"); roster.className = "roster";
    for (const r of d.roster) {
      const o = this._optimistic[r.e];
      const lit = o ? o.lit : r.lit;
      const c = document.createElement("div");
      c.className = "chip" + (lit ? " lit" : "") + (o ? " pending" : "");
      c.textContent = r.n;
      c.addEventListener("click", () => this._toggle(r.e, lit));
      roster.appendChild(c);
    }
    body.appendChild(roster);
  }

  _openModal() {
    if (this._root.querySelector(".ov")) return;
    const ov = document.createElement("div"); ov.className = "ov";
    ov.innerHTML = `
      <div class="panel">
        <div class="sbox"><ha-icon id="micon" icon="mdi:magnify"></ha-icon>
          <input id="q" type="search" placeholder="Play something here…"
                 autocomplete="off" spellcheck="false" enterkeyhint="search">
        </div>
        <div id="mout"></div>
      </div>`;
    ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
    this._escHandler = (e) => { if (e.key === "Escape") ov.remove(); };
    ov.addEventListener("keydown", this._escHandler);
    this._root.querySelector(".card").appendChild(ov);
    const q = ov.querySelector("#q");
    q.addEventListener("input", () => {
      clearTimeout(this._deb);
      const v = q.value.trim();
      if (v.length < 2) { this._renderRecents(ov); return; }
      this._deb = setTimeout(() => this._search(ov, v), 650);
    });
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && q.value.trim().length >= 2) this._search(ov, q.value.trim());
    });
    this._renderRecents(ov);
    setTimeout(() => q.focus(), 50);
  }

  _renderRecents(ov) {
    const out = ov.querySelector("#mout");
    const ctx = this._hass.states["sensor.spotify_recently_played"]?.attributes?.contexts || [];
    const playable = ctx.filter((c) => c.id && c.id.startsWith("spotify:") && c.kind !== "artist");
    out.innerHTML = "";
    if (!playable.length) {
      out.innerHTML = `<div class="empty">Type to search Spotify.</div>`; return;
    }
    out.appendChild(this._group(ov, "Recently played",
      playable.map((c) => [c.id, c.img, c.t, c.kind])));
  }

  async _svcSearch(service, criteria) {
    const r = await this._hass.connection.sendMessagePromise({
      type: "call_service", domain: "spotifyplus", service,
      service_data: { entity_id: this._config.search_entity, criteria, limit: 6 },
      return_response: true,
    });
    return (r?.response?.result?.items) || [];
  }

  async _search(ov, criteria) {
    clearTimeout(this._deb);
    const icon = ov.querySelector("#micon");
    icon.icon = "mdi:loading";
    try {
      const [tracks, playlists, albums] = await Promise.all([
        this._svcSearch("search_tracks", criteria),
        this._svcSearch("search_playlists", criteria),
        this._svcSearch("search_albums", criteria),
      ]);
      const out = ov.querySelector("#mout"); out.innerHTML = "";
      const groups = [
        ["Songs", tracks.map((t) => [t.uri, t.album?.image_url, t.name,
          (t.artists || []).map((a) => a.name).join(", ")])],
        ["Playlists", playlists.filter(Boolean).map((p) => [p.uri, p.image_url, p.name, ""])],
        ["Albums", albums.map((a) => [a.uri, a.image_url, a.name,
          (a.artists || []).map((x) => x.name).join(", ")])],
      ];
      let any = false;
      for (const [label, items] of groups) {
        if (!items.length) continue;
        any = true;
        out.appendChild(this._group(ov, label, items));
      }
      if (!any) out.innerHTML = `<div class="empty">No results.</div>`;
    } catch (e) {
      ov.querySelector("#mout").innerHTML =
        `<div class="empty">Search failed: ${e.message || e}</div>`;
    } finally { icon.icon = "mdi:magnify"; }
  }

  _group(ov, label, items) {
    const g = document.createElement("div");
    g.innerHTML = `<div class="lbl">${label}</div>`;
    const row = document.createElement("div"); row.className = "row";
    for (const [uri, img, title, sub] of items) {
      const t = document.createElement("div"); t.className = "tile";
      t.innerHTML = `<img loading="lazy" src="${img || ""}">
        <div class="tt">${title}</div><div class="ts">${sub || ""}</div>`;
      t.addEventListener("click", async () => {
        try {
          await this._hass.callService("script", "music_slot_play",
            { slot: this._config.slot, context_id: uri });
          t.classList.add("played");
          setTimeout(() => ov.remove(), 700);
        } catch (e) { t.querySelector(".ts").textContent = "play failed"; }
      });
      row.appendChild(t);
    }
    g.appendChild(row);
    return g;
  }

  getCardSize() { return 4; }
}

customElements.define("hhq-music-group", HhqMusicGroup);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "hhq-music-group",
  name: "HHQ Music Group",
  description: "Self-contained Sonos session console (slot-based).",
});
