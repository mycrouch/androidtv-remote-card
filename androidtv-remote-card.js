/*
 * Android TV Remote Card v1.0.0
 * https://github.com/mycrouch/androidtv-remote-card
 *
 * One-card remote control + app launcher for a single Android TV / Google TV
 * connected via the androidtv_remote integration. Power, D-pad-style nav,
 * volume, and a GUI-editable grid of app shortcuts (Netflix, Prime Video,
 * Plex, whatever's installed) that launch by Android package name via
 * media_player.select_source. The currently-foregrounded app (from the
 * media_player's app_id attribute) is highlighted live.
 *
 * Companion card to heos-multiroom-card — same house style (Mushroom-ish
 * flat card, tinted background support, GUI editor, no YAML required).
 *
 * MIT License — Jason Crouch. Icons: Material Design Icons via ha-icon.
 */

const ATV_CARD_VERSION = '1.1.1';

// A sensible default app-shortcut set, offered as a one-click "Add common
// apps" button in the editor. Package names are the real, verified IDs for
// each app's universal Android TV / Google TV build. `color` is a Home
// Assistant named palette colour (red, light-blue, orange, cyan, grey, …),
// rendered via the theme's --rgb-<name> tokens so it stays theme-consistent.
const ATV_COMMON_APPS = [
  { name: 'Netflix', icon: 'mdi:netflix', package: 'com.netflix.ninja', color: 'red' },
  { name: 'Prime Video', icon: 'mdi:filmstrip', package: 'com.amazon.amazonvideo.livingroom', color: 'light-blue' },
  { name: 'Plex', icon: 'mdi:plex', package: 'com.plexapp.android', color: 'orange' },
  { name: 'YouTube', icon: 'mdi:youtube', package: 'com.google.android.youtube.tv', color: 'red' },
  { name: 'Disney+', icon: 'mdi:plus-circle', package: 'com.disney.disneyplus', color: 'indigo' },
  { name: 'Apple TV', icon: 'mdi:apple', package: 'com.apple.atve.androidtv.appletv', color: 'grey' },
  { name: 'Spotify', icon: 'mdi:spotify', package: 'com.spotify.tv.android', color: 'green' },
];

// Named palette colours resolve to Home Assistant's core theme tokens,
// which are `--<name>-color` (e.g. --red-color, --light-blue-color). Only
// allow safe characters when interpolating into the custom-property name so
// a stray config value can't break out of the rule. A hex/rgb value is
// passed through verbatim.
function atvColorStyle(color) {
  if (!color) return '';
  const raw = String(color).trim();
  if (/^(#|rgb|hsl|var\()/i.test(raw)) return ` style="color: ${raw.replace(/"/g, '')}"`;
  const safe = raw.replace(/[^a-z0-9-]/gi, '');
  return safe ? ` style="color: var(--${safe}-color)"` : '';
}

class AndroidTvRemoteCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('androidtv-remote-card-editor');
  }

  static getStubConfig(hass) {
    const players = Object.keys(hass.states).filter((e) => e.startsWith('media_player.'));
    let entity = '';
    let remote = '';
    for (const p of players) {
      const objectId = p.split('.')[1];
      const candidateRemote = `remote.${objectId}`;
      if (hass.states[candidateRemote]) {
        entity = p;
        remote = candidateRemote;
        break;
      }
    }
    if (!entity && players.length) entity = players[0];
    return { entity, remote, apps: ATV_COMMON_APPS.slice(0, 4) };
  }

  setConfig(config) {
    if (!config.entity) throw new Error('Define entity (a media_player)');
    this._config = config;
    this._entity = config.entity;
    this._remote = config.remote || '';
    this._apps = Array.isArray(config.apps) ? config.apps : [];
    this._name = config.name || '';
    this._built = false;
  }

  getCardSize() {
    return 3 + Math.ceil(this._apps.length / 3);
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._build();
      this._built = true;
    }
    this._update();
  }

  _call(service, entityId, data) {
    const [domain, svc] = service.split('.');
    this._hass.callService(domain, svc, { entity_id: entityId, ...data });
  }

  _build() {
    const root = document.createElement('ha-card');
    root.innerHTML = `
      <style>
        :host { display: block; }
        .atv-card { padding: 16px; }
        .atv-header {
          display: flex; align-items: baseline; gap: 6px;
          font-size: 20px; font-weight: 500; margin-bottom: 12px;
          color: var(--primary-text-color);
        }
        .atv-sub { font-size: 0.85rem; font-weight: 400; color: var(--secondary-text-color); margin-left: 4px; }
        .atv-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 14px; }
        .atv-btn {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 4px; padding: 10px 4px; border-radius: 12px;
          background: var(--card-background-color, #fff);
          border: 1px solid var(--divider-color, rgba(0,0,0,0.08));
          cursor: pointer; user-select: none; transition: background 0.15s ease;
          min-height: 64px;
        }
        .atv-btn:hover { background: var(--secondary-background-color, #f2f2f2); }
        .atv-btn:active { background: var(--divider-color, #e0e0e0); }
        .atv-btn ha-icon { --mdc-icon-size: 22px; color: var(--state-icon-color, var(--paper-item-icon-color)); }
        .atv-btn.power ha-icon { color: var(--error-color, #db4437); }
        .atv-btn span { font-size: 0.78rem; font-weight: 500; color: var(--primary-text-color); }
        .atv-apps-label { font-size: 0.85rem; font-weight: 500; color: var(--secondary-text-color); margin: 4px 0 8px; }
        .atv-apps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .atv-app {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 6px; padding: 14px 6px; border-radius: 12px;
          background: var(--card-background-color, #fff);
          border: 1px solid var(--divider-color, rgba(0,0,0,0.08));
          cursor: pointer; user-select: none; transition: background 0.15s ease, border-color 0.15s ease;
          min-height: 76px;
        }
        .atv-app:hover { background: var(--secondary-background-color, #f2f2f2); }
        .atv-app.active {
          border-color: var(--primary-color, #03a9f4);
          background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, var(--card-background-color, #fff));
        }
        .atv-app ha-icon { --mdc-icon-size: 26px; color: var(--state-icon-color, var(--paper-item-icon-color)); }
        .atv-app span { font-size: 0.78rem; font-weight: 500; text-align: center; color: var(--primary-text-color); }
        .atv-empty { font-size: 0.85rem; color: var(--secondary-text-color); padding: 8px 0; }
      </style>
      <div class="atv-card">
        <div class="atv-header">
          <span class="atv-title"></span>
          <span class="atv-sub"></span>
        </div>
        <div class="atv-row">
          <div class="atv-btn power" data-action="power">
            <ha-icon icon="mdi:power"></ha-icon><span>Power</span>
          </div>
          <div class="atv-btn" data-action="home">
            <ha-icon icon="mdi:home"></ha-icon><span>Home</span>
          </div>
          <div class="atv-btn" data-action="back">
            <ha-icon icon="mdi:arrow-left"></ha-icon><span>Back</span>
          </div>
          <div class="atv-btn" data-action="vol_down">
            <ha-icon icon="mdi:volume-minus"></ha-icon><span>Vol -</span>
          </div>
          <div class="atv-btn" data-action="vol_up">
            <ha-icon icon="mdi:volume-plus"></ha-icon><span>Vol +</span>
          </div>
        </div>
        <div class="atv-apps-label">Apps</div>
        <div class="atv-apps"></div>
        <div class="atv-empty" style="display:none;">No apps configured — add some in the card editor.</div>
      </div>
    `;
    root.querySelectorAll('.atv-btn').forEach((btn) => {
      btn.addEventListener('click', () => this._onButton(btn.dataset.action));
    });
    this._root = root;
    this.innerHTML = '';
    this.appendChild(root);
    this._appsEl = root.querySelector('.atv-apps');
    this._emptyEl = root.querySelector('.atv-empty');
    this._titleEl = root.querySelector('.atv-title');
    this._subEl = root.querySelector('.atv-sub');
    this._renderApps();
  }

  _onButton(action) {
    const remote = this._remote;
    if (action === 'power') {
      this._call('media_player.toggle', this._entity, {});
      return;
    }
    if (!remote) return;
    const commandMap = {
      home: 'HOME',
      back: 'BACK',
      vol_down: 'VOLUME_DOWN',
      vol_up: 'VOLUME_UP',
    };
    this._call('remote.send_command', remote, { command: commandMap[action] });
  }

  _renderApps() {
    if (!this._appsEl) return;
    this._appsEl.innerHTML = '';
    this._emptyEl.style.display = this._apps.length ? 'none' : 'block';
    this._apps.forEach((app) => {
      const el = document.createElement('div');
      el.className = 'atv-app';
      el.dataset.package = app.package;
      el.innerHTML = `<ha-icon icon="${app.icon || 'mdi:application'}"${atvColorStyle(app.color)}></ha-icon><span>${app.name}</span>`;
      el.addEventListener('click', () => {
        this._call('media_player.select_source', this._entity, { source: app.package });
      });
      this._appsEl.appendChild(el);
    });
  }

  _update() {
    const state = this._hass.states[this._entity];
    if (!state) return;
    const friendly = (this._config && this._config.name) || state.attributes.friendly_name || this._entity;
    if (this._titleEl) this._titleEl.textContent = friendly;
    const appId = state.attributes.app_id || state.attributes.app_name || '';
    let appLabel = '';
    const match = this._apps.find((a) => a.package === appId);
    if (match) appLabel = match.name;
    if (this._subEl) this._subEl.textContent = appLabel ? `· ${appLabel}` : '';
    if (this._appsEl) {
      this._appsEl.querySelectorAll('.atv-app').forEach((el) => {
        el.classList.toggle('active', el.dataset.package === appId);
      });
    }
  }
}

class AndroidTvRemoteCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._form = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  setConfig(config) {
    const normalized = JSON.stringify({ ...config, type: undefined });
    if (this._normalized === normalized) return;
    this._normalized = normalized;
    this._config = { ...config, apps: Array.isArray(config.apps) ? [...config.apps] : [] };
    this._render();
  }

  _emit(config) {
    this._normalized = JSON.stringify({ ...config, type: undefined });
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _buildConfig() {
    const config = {
      type: (this._config && this._config.type) || 'custom:androidtv-remote-card',
      entity: this._config.entity,
    };
    if (this._config.remote) config.remote = this._config.remote;
    if (this._config.name) config.name = this._config.name;
    if (this._config.apps && this._config.apps.length) config.apps = this._config.apps;
    return config;
  }

  _schema() {
    return [
      { name: 'entity', selector: { entity: { domain: 'media_player' } }, required: true, label: 'TV (media_player)' },
      { name: 'remote', selector: { entity: { domain: 'remote' } }, label: 'Remote entity (optional, for nav/volume)' },
      { name: 'name', selector: { text: {} }, label: 'Card title (optional)' },
    ];
  }

  _render() {
    if (!this._config) return;
    this.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.padding = '12px';

    if (!this._form) this._form = document.createElement('ha-form');
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    this._form.data = {
      entity: this._config.entity || '',
      remote: this._config.remote || '',
      name: this._config.name || '',
    };
    this._form.computeLabel = (s) => s.label || s.name;
    this._form.addEventListener('value-changed', (ev) => {
      this._config = { ...this._config, ...ev.detail.value };
      this._emit(this._buildConfig());
    });
    wrap.appendChild(this._form);

    const appsHeader = document.createElement('div');
    appsHeader.textContent = 'Apps';
    appsHeader.style.cssText = 'font-weight:500;margin:16px 0 8px;';
    wrap.appendChild(appsHeader);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    (this._config.apps || []).forEach((app, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;';

      const nameInput = document.createElement('ha-textfield');
      nameInput.label = 'Name';
      nameInput.value = app.name || '';
      nameInput.style.flex = '1';
      nameInput.addEventListener('input', (e) => {
        const apps = [...this._config.apps];
        apps[idx] = { ...apps[idx], name: e.target.value };
        this._config = { ...this._config, apps };
        this._emit(this._buildConfig());
      });

      const iconInput = document.createElement('ha-icon-picker');
      iconInput.label = 'Icon';
      iconInput.value = app.icon || '';
      iconInput.hass = this._hass;
      iconInput.style.flex = '1';
      iconInput.addEventListener('value-changed', (e) => {
        const apps = [...this._config.apps];
        apps[idx] = { ...apps[idx], icon: e.detail.value };
        this._config = { ...this._config, apps };
        this._emit(this._buildConfig());
      });

      const pkgInput = document.createElement('ha-textfield');
      pkgInput.label = 'Package name';
      pkgInput.value = app.package || '';
      pkgInput.style.flex = '1.4';
      pkgInput.addEventListener('input', (e) => {
        const apps = [...this._config.apps];
        apps[idx] = { ...apps[idx], package: e.target.value };
        this._config = { ...this._config, apps };
        this._emit(this._buildConfig());
      });

      const colorInput = document.createElement('ha-textfield');
      colorInput.label = 'Colour';
      colorInput.value = app.color || '';
      colorInput.placeholder = 'e.g. red';
      colorInput.style.flex = '0.9';
      colorInput.addEventListener('input', (e) => {
        const apps = [...this._config.apps];
        apps[idx] = { ...apps[idx], color: e.target.value };
        this._config = { ...this._config, apps };
        this._emit(this._buildConfig());
      });

      const removeBtn = document.createElement('ha-icon-button');
      removeBtn.path = 'M19,13H5V11H19V13Z';
      removeBtn.addEventListener('click', () => {
        const apps = [...this._config.apps];
        apps.splice(idx, 1);
        this._config = { ...this._config, apps };
        this._emit(this._buildConfig());
        this._render();
      });

      row.appendChild(nameInput);
      row.appendChild(iconInput);
      row.appendChild(pkgInput);
      row.appendChild(colorInput);
      row.appendChild(removeBtn);
      list.appendChild(row);
    });
    wrap.appendChild(list);

    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;';

    const addBlankBtn = document.createElement('mwc-button');
    addBlankBtn.outlined = true;
    addBlankBtn.textContent = '+ Add app';
    addBlankBtn.addEventListener('click', () => {
      const apps = [...(this._config.apps || []), { name: '', icon: 'mdi:application', package: '' }];
      this._config = { ...this._config, apps };
      this._emit(this._buildConfig());
      this._render();
    });
    addRow.appendChild(addBlankBtn);

    const addCommonBtn = document.createElement('mwc-button');
    addCommonBtn.outlined = true;
    addCommonBtn.textContent = 'Add common apps';
    addCommonBtn.title = 'Adds Netflix, Prime Video, Plex, YouTube, Disney+, Apple TV, Spotify (skips ones already added)';
    addCommonBtn.addEventListener('click', () => {
      const existing = new Set((this._config.apps || []).map((a) => a.package));
      const toAdd = ATV_COMMON_APPS.filter((a) => !existing.has(a.package));
      const apps = [...(this._config.apps || []), ...toAdd];
      this._config = { ...this._config, apps };
      this._emit(this._buildConfig());
      this._render();
    });
    addRow.appendChild(addCommonBtn);

    wrap.appendChild(addRow);
    this.appendChild(wrap);
  }
}

customElements.define('androidtv-remote-card', AndroidTvRemoteCard);
customElements.define('androidtv-remote-card-editor', AndroidTvRemoteCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'androidtv-remote-card',
  name: 'Android TV Remote Card',
  preview: true,
  documentationURL: 'https://github.com/mycrouch/androidtv-remote-card',
  description:
    'One-card remote + app launcher for a single Android TV / Google TV (androidtv_remote integration): power, home, back, volume, and a GUI-editable grid of app shortcuts that launch by package name, with the currently-open app highlighted live.',
});

console.info(
  `%c ANDROIDTV-REMOTE-CARD %c v${ATV_CARD_VERSION} `,
  'color: white; background: #03a9f4; font-weight: 700;',
  'color: #03a9f4; background: white; font-weight: 700;'
);
