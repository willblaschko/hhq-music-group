/* HHQ Music Group — one self-contained Sonos session console.
   Config: { slot: 1 }. Render N instances for N groups.
   State via a single render_template subscription (Sonos-truth-adjacent);
   mutations via script.music_slot_toggle / music_slot_play (fire-and-forget,
   executed by a Node-RED SOAP sequencer against the speakers directly). */

class HhqMusicGroup extends HTMLElement {
  static getStubConfig() { return { slot: 1 }; }

  setConfig(config) {
    if (!config.slot) throw new Error("slot (1-10) required");
    this._config = { search_entity: "media_player.spotifyplus_will", ...config };
    this._data = null;
  }

  connectedCallback() { this._maybeSubscribe(); }
  disconnectedCallback() {
    if (this._unsub) { this._unsub.then((u) => u()).catch(() => {}); this._unsub = null; }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._root) {
      this._root = this.attachShadow({ mode: "open" });
      this._shell();
    }
    this._maybeSubscribe();
  }

  _template() {
    const n = this._config.slot;
    return `
{% set spk = integration_entities('sonos') | select('match','media_player')
   | reject('search','surround|back_left|back_right') | select('has_value')
   | reject('is_state','unavailable') | list | sort %}
{% set anchor = states('input_text.music_slot_${n}') %}
{% set ok = anchor.startswith('media_player.') and states(anchor) not in ['unknown','unavailable'] %}
{% set coord = ((state_attr(anchor,'group_members') or [anchor]) | first) if ok else '' %}
{% set merged = namespace(v=0) %}
{% for j in range(1, ${n}) %}
  {% set a2 = states('input_text.music_slot_' ~ j) %}
  {% set ok2 = a2.startswith('media_player.') and states(a2) not in ['unknown','unavailable'] %}
  {% set c2 = ((state_attr(a2,'group_members') or [a2]) | first) if ok2 else '' %}
  {% if merged.v == 0 and c2 != '' and c2 == coord %}{% set merged.v = j %}{% endif %}
{% endfor %}
{% set mem = (state_attr(coord,'group_members') or [coord]) if coord != '' else [] %}
{% set ros = namespace(l=[]) %}
{% for p in spk %}
  {% set g = state_attr(p,'group_members') or [p] %}
  {% set ns2 = namespace(x=state_attr(p,'friendly_name') or p) %}
  {% set ros.l = ros.l + [{'e': p, 'n': ns2.x, 'lit': p in mem}] %}
{% endfor %}
{{ {'coord': coord, 'merged': merged.v, 'roster': ros.l,
    'state': states(coord) if coord != '' else '',
    'title': state_attr(coord,'media_title') if coord != '' else none,
    'artist': state_attr(coord,'media_artist') if coord != '' else none,
    'art': state_attr(coord,'entity_picture') if coord != '' else none,
    'vol': state_attr(coord,'volume_level') if coord != '' else none,
    'members': mem} | to_json }}`;
  }

  _maybeSubscribe() {
    if (!this._hass || this._unsub || !this._root) return;
    this._unsub = this._hass.connection.subscribeMessage(
      (msg) => {
        try { this._data = JSON.parse(msg.result); } catch (e) { return; }
        const now = Date.now();
        this._optimistic = this._optimistic || {};
        for (const [e, o] of Object.entries(this._optimistic)) {
          const actual = this._data.roster.find((r) => r.e === e);
          if (!actual || actual.lit === o.lit || now - o.ts > 25000) delete this._optimistic[e];
        }
        this._render();
      },
      { type: "render_template", template: this._template(), report_errors: false }
    );
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
      </style>
      <div class="card"><div id="body"><div class="empty">…</div></div></div>`;
  }

  _svc(domain, service, data) { this._hass.callService(domain, service, data); }

  _toggle(entity, currentLit) {
    this._optimistic = this._optimistic || {};
    this._optimistic[entity] = { lit: !currentLit, ts: Date.now() };
    this._svc("script", "music_slot_toggle", { slot: this._config.slot, player: entity });
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
    // Phase 3 fills this in (search + recents dialog).
    console.info("hhq-music-group: search modal ships in phase 3");
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
