/*
 * Android TV Remote Card v1.4.0
 * https://github.com/mycrouch/androidtv-remote-card
 *
 * One-card remote control + app launcher for a single Android TV / Google TV
 * connected via the androidtv_remote integration.
 *
 * Collapsed by default it shows just the Power button and the app grid:
 *   - tapping an app powers the TV on (if off) and launches the app
 *   - tapping Power toggles the TV on/off
 * When the TV is on the card auto-expands to the full remote (Home, Back,
 * Keyboard, volume, D-pad, and an optional Live TV section); a chevron lets
 * you expand/collapse manually at any time.
 *
 * Apps launch by application ID or deep link via media_player.play_media.
 * Nav / volume / channels / on-screen typing all go through
 * remote.send_command. The Keyboard button types into whatever field is
 * focused on the TV (needs "Enable IME" in the integration options). The
 * currently-foregrounded app (media_player app_id) is highlighted live, and
 * the Power button lights when the TV is on.
 *
 * Companion card to heos-multiroom-card — same house style (Mushroom-ish
 * flat card, tinted background support, GUI editor, no YAML required).
 *
 * MIT License — Jason Crouch. Icons: Material Design Icons via ha-icon.
 */

const ATV_CARD_VERSION = '1.4.1';

// A sensible default app-shortcut set, offered as a one-click "Add common
// apps" button in the editor. `package` accepts an application ID (com.foo.bar)
// or a deep link (contains "://"). A couple of apps don't resolve a launch
// intent from their package on many devices (they open the Play Store page
// instead), so they default to deep links here.
const ATV_COMMON_APPS = [
  { name: 'Netflix', icon: 'mdi:netflix', package: 'com.netflix.ninja', color: 'red' },
  { name: 'Prime Video', icon: 'mdi:filmstrip', package: 'https://app.primevideo.com', color: 'light-blue' },
  { name: 'Plex', icon: 'mdi:plex', package: 'com.plexapp.android', color: 'orange' },
  { name: 'YouTube', icon: 'mdi:youtube', package: 'com.google.android.youtube.tv', color: 'red' },
  { name: 'Disney+', icon: 'mdi:plus-circle', package: 'https://www.disneyplus.com', color: 'indigo' },
  { name: 'Apple TV', icon: 'mdi:apple', package: 'https://tv.apple.com', color: 'grey' },
  { name: 'Spotify', icon: 'mdi:spotify', package: 'com.spotify.tv.android', color: 'green' },
];

const ATV_OFF_STATES = ['off', 'unavailable', 'standby', 'unknown', 'none'];

// Only allow safe characters when interpolating a palette name into a CSS
// custom-property name. Home Assistant's core palette tokens are
// `--<name>-color` (e.g. --red-color). A hex/rgb/var value is passed through.
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
    this._dpad = config.dpad !== false; // on by default (needs a remote entity)
    this._livetv = config.livetv === true; // off by default
    this._collapsible = config.collapsible !== false; // on by default
    this._built = false;
    this._lastOn = undefined;
  }

  getCardSize() {
    let controls = 0;
    if (this._remote) {
      controls += 1; // nav row
      if (this._dpad) controls += 3;
      if (this._livetv) controls += 2;
    }
    return 3 + controls + Math.ceil(this._apps.length / 3);
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
    if (!entityId) return;
    const [domain, svc] = service.split('.');
    this._hass.callService(domain, svc, { entity_id: entityId, ...data });
  }

  _send(command) {
    if (this._remote && command) this._call('remote.send_command', this._remote, { command });
  }

  _sendText(text) {
    if (this._remote && text) this._call('remote.send_command', this._remote, { command: `text:${text}` });
  }

  _isOn() {
    const st = this._hass && this._hass.states[this._entity];
    return !!(st && !ATV_OFF_STATES.includes(st.state));
  }

  _build() {
    const hasControls = !!this._remote;
    const root = document.createElement('ha-card');
    root.innerHTML = `
      <style>
        :host { display: block; }
        .atv-card, .atv-card * { box-sizing: border-box; }
        .atv-card { padding: 16px; }
        .atv-header {
          display: flex; align-items: baseline; gap: 6px;
          font-size: 20px; font-weight: 500; margin-bottom: 12px;
          color: var(--primary-text-color);
        }
        .atv-sub { font-size: 0.85rem; font-weight: 400; color: var(--secondary-text-color); }
        .atv-expand {
          margin-left: auto; cursor: pointer; align-self: center;
          color: var(--secondary-text-color); --mdc-icon-size: 24px;
          border-radius: 50%; padding: 2px;
        }
        .atv-expand:hover { background: var(--secondary-background-color, #f2f2f2); }
        .tile {
          display: flex; align-items: center; justify-content: center;
          gap: 6px; border-radius: 12px;
          background: var(--card-background-color, #fff);
          border: 1px solid var(--divider-color, rgba(0,0,0,0.08));
          cursor: pointer; user-select: none; transition: background 0.15s ease, border-color 0.15s ease;
        }
        .tile:hover { background: var(--secondary-background-color, #f2f2f2); }
        .tile:active { background: var(--divider-color, #e0e0e0); }
        .tile ha-icon { color: var(--state-icon-color, var(--paper-item-icon-color)); }
        .atv-powerbar { margin-bottom: 14px; }
        .atv-power { width: 100%; padding: 10px 12px; min-height: 46px; font-weight: 600; }
        .atv-power ha-icon { --mdc-icon-size: 22px; color: var(--state-icon-color, var(--paper-item-icon-color)); }
        .atv-power span { color: var(--primary-text-color); }
        .atv-power.on ha-icon { color: var(--error-color, #db4437); }
        .atv-power.on { border-color: color-mix(in srgb, var(--error-color, #db4437) 45%, var(--divider-color, #e0e0e0)); }
        .atv-controls { margin-bottom: 14px; }
        .atv-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 14px; }
        .atv-row .tile { flex-direction: column; padding: 10px 4px; min-height: 64px; }
        .atv-row .tile ha-icon { --mdc-icon-size: 22px; }
        .atv-row .tile span { font-size: 0.78rem; font-weight: 500; color: var(--primary-text-color); }
        .atv-kbd { display: flex; gap: 8px; align-items: stretch; margin-bottom: 14px; }
        .atv-kbd-input {
          flex: 1 1 auto; min-width: 0; min-height: 46px; padding: 0 12px;
          border: 1px solid var(--divider-color, #e0e0e0); border-radius: 12px;
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
          font: inherit; font-size: 0.95rem;
        }
        .atv-kbd-input:focus { outline: none; border-color: var(--primary-color, #03a9f4); }
        .atv-kbd .tile { padding: 0 14px; min-height: 46px; }
        .atv-kbd .tile ha-icon { --mdc-icon-size: 22px; }
        .atv-kbd .tile span { font-weight: 600; color: var(--primary-text-color); }
        .atv-cluster { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 6px; margin-bottom: 14px; }
        .atv-rocker { display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .atv-rocker .tile { width: 54px; height: 54px; }
        .atv-rocker .tile ha-icon { --mdc-icon-size: 24px; }
        .atv-rocker .rk-label { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.5px; color: var(--secondary-text-color); }
        .atv-dpad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; width: 176px; margin: 0 auto; }
        .atv-dbtn {
          display: flex; align-items: center; justify-content: center;
          aspect-ratio: 1 / 1; border-radius: 50%;
          background: var(--secondary-background-color, #f2f2f2);
          cursor: pointer; user-select: none; transition: background 0.15s ease;
        }
        .atv-dbtn:hover { background: var(--divider-color, #e0e0e0); }
        .atv-dbtn:active { background: var(--primary-color, #03a9f4); }
        .atv-dbtn ha-icon { --mdc-icon-size: 24px; color: var(--primary-text-color); }
        .atv-dbtn.ok { background: var(--primary-color, #03a9f4); }
        .atv-dbtn.ok span { color: var(--text-primary-color, #fff); font-weight: 600; font-size: 0.9rem; }
        .atv-dbtn.spacer { background: none; cursor: default; }
        .atv-section-label { font-size: 0.85rem; font-weight: 500; color: var(--secondary-text-color); margin: 4px 0 8px; }
        .atv-livetv { margin-top: 14px; }
        .atv-livetv-row { grid-template-columns: repeat(3, 1fr); }
        .atv-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
        .atv-keypad .tile { min-height: 52px; font-size: 1.1rem; font-weight: 600; color: var(--primary-text-color); }
        .atv-keypad .tile ha-icon { --mdc-icon-size: 22px; }
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
          <ha-icon class="atv-expand" icon="mdi:chevron-down"></ha-icon>
        </div>
        <div class="atv-powerbar">
          <div class="tile atv-power" data-action="power">
            <ha-icon icon="mdi:power"></ha-icon><span>Power</span>
          </div>
        </div>
        <div class="atv-controls">
          <div class="atv-row">
            <div class="tile" data-cmd="HOME"><ha-icon icon="mdi:home"></ha-icon><span>Home</span></div>
            <div class="tile" data-cmd="BACK"><ha-icon icon="mdi:arrow-left"></ha-icon><span>Back</span></div>
            <div class="tile" data-cmd="TV"><ha-icon icon="mdi:television"></ha-icon><span>TV</span></div>
            <div class="tile atv-kbd-toggle"><ha-icon icon="mdi:keyboard-outline"></ha-icon><span>Keyboard</span></div>
            <div class="tile" data-cmd="MUTE"><ha-icon icon="mdi:volume-mute"></ha-icon><span>Mute</span></div>
          </div>
          <div class="atv-kbd" style="display:none;">
            <input class="atv-kbd-input" type="text" placeholder="Type, then Send…" enterkeyhint="send" />
            <div class="tile atv-kbd-btn" data-kbd="del" title="Backspace"><ha-icon icon="mdi:backspace-outline"></ha-icon></div>
            <div class="tile atv-kbd-btn" data-kbd="send" title="Type onto TV"><span>Send</span></div>
            <div class="tile atv-kbd-btn" data-kbd="enter" title="Enter"><ha-icon icon="mdi:keyboard-return"></ha-icon></div>
          </div>
          <div class="atv-cluster">
            <div class="atv-rocker">
              <div class="tile rk" data-cmd="CHANNEL_UP"><ha-icon icon="mdi:plus"></ha-icon></div>
              <div class="rk-label">CH</div>
              <div class="tile rk" data-cmd="CHANNEL_DOWN"><ha-icon icon="mdi:minus"></ha-icon></div>
            </div>
            <div class="atv-dpad">
              <div class="atv-dbtn spacer"></div>
              <div class="atv-dbtn" data-cmd="DPAD_UP"><ha-icon icon="mdi:chevron-up"></ha-icon></div>
              <div class="atv-dbtn spacer"></div>
              <div class="atv-dbtn" data-cmd="DPAD_LEFT"><ha-icon icon="mdi:chevron-left"></ha-icon></div>
              <div class="atv-dbtn ok" data-cmd="DPAD_CENTER"><span>OK</span></div>
              <div class="atv-dbtn" data-cmd="DPAD_RIGHT"><ha-icon icon="mdi:chevron-right"></ha-icon></div>
              <div class="atv-dbtn spacer"></div>
              <div class="atv-dbtn" data-cmd="DPAD_DOWN"><ha-icon icon="mdi:chevron-down"></ha-icon></div>
              <div class="atv-dbtn spacer"></div>
            </div>
            <div class="atv-rocker">
              <div class="tile rk" data-cmd="VOLUME_UP"><ha-icon icon="mdi:plus"></ha-icon></div>
              <div class="rk-label">VOL</div>
              <div class="tile rk" data-cmd="VOLUME_DOWN"><ha-icon icon="mdi:minus"></ha-icon></div>
            </div>
          </div>
          <div class="atv-livetv">
            <div class="atv-section-label">Live TV</div>
            <div class="atv-row atv-livetv-row">
              <div class="tile" data-cmd="GUIDE"><ha-icon icon="mdi:television-guide"></ha-icon><span>Guide</span></div>
              <div class="tile" data-cmd="INFO"><ha-icon icon="mdi:information-outline"></ha-icon><span>Info</span></div>
              <div class="tile atv-keypad-toggle"><ha-icon icon="mdi:dialpad"></ha-icon><span>Keypad</span></div>
            </div>
            <div class="atv-keypad" style="display:none;">
              <div class="tile" data-cmd="1"><span>1</span></div>
              <div class="tile" data-cmd="2"><span>2</span></div>
              <div class="tile" data-cmd="3"><span>3</span></div>
              <div class="tile" data-cmd="4"><span>4</span></div>
              <div class="tile" data-cmd="5"><span>5</span></div>
              <div class="tile" data-cmd="6"><span>6</span></div>
              <div class="tile" data-cmd="7"><span>7</span></div>
              <div class="tile" data-cmd="8"><span>8</span></div>
              <div class="tile" data-cmd="9"><span>9</span></div>
              <div class="tile" data-cmd="DEL"><ha-icon icon="mdi:backspace-outline"></ha-icon></div>
              <div class="tile" data-cmd="0"><span>0</span></div>
              <div class="tile" data-cmd="ENTER"><ha-icon icon="mdi:keyboard-return"></ha-icon></div>
            </div>
          </div>
        </div>
        <div class="atv-section-label">Apps</div>
        <div class="atv-apps"></div>
        <div class="atv-empty" style="display:none;">No apps configured — add some in the card editor.</div>
      </div>
    `;

    this._root = root;
    this.innerHTML = '';
    this.appendChild(root);

    this._titleEl = root.querySelector('.atv-title');
    this._subEl = root.querySelector('.atv-sub');
    this._powerBtn = root.querySelector('.atv-power');
    this._controlsEl = root.querySelector('.atv-controls');
    this._chevronEl = root.querySelector('.atv-expand');
    this._appsEl = root.querySelector('.atv-apps');
    this._emptyEl = root.querySelector('.atv-empty');

    this._powerBtn.addEventListener('click', () => this._onButton('power'));

    if (!hasControls) {
      this._controlsEl.remove();
      this._controlsEl = null;
      this._chevronEl.remove();
      this._chevronEl = null;
    } else {
      // Every button that maps to a raw remote command.
      this._controlsEl.querySelectorAll('[data-cmd]').forEach((btn) => {
        btn.addEventListener('click', () => this._send(btn.dataset.cmd));
      });

      // Keyboard panel.
      const kbdToggle = this._controlsEl.querySelector('.atv-kbd-toggle');
      const kbdPanel = this._controlsEl.querySelector('.atv-kbd');
      const kbdInput = this._controlsEl.querySelector('.atv-kbd-input');
      kbdToggle.addEventListener('click', () => {
        const show = kbdPanel.style.display === 'none';
        kbdPanel.style.display = show ? '' : 'none';
        if (show) kbdInput.focus();
      });
      const sendText = () => {
        this._sendText(kbdInput.value);
        kbdInput.value = '';
        kbdInput.focus();
      };
      this._controlsEl.querySelector('[data-kbd="send"]').addEventListener('click', sendText);
      this._controlsEl.querySelector('[data-kbd="del"]').addEventListener('click', () => this._send('DEL'));
      this._controlsEl.querySelector('[data-kbd="enter"]').addEventListener('click', () => this._send('ENTER'));
      kbdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendText();
        }
      });

      // D-pad on/off.
      const dpadEl = this._controlsEl.querySelector('.atv-dpad');
      if (dpadEl && !this._dpad) dpadEl.remove();

      // Live TV section on/off + keypad toggle.
      const liveEl = this._controlsEl.querySelector('.atv-livetv');
      if (liveEl && !this._livetv) {
        liveEl.remove();
      } else if (liveEl) {
        const keypadToggle = liveEl.querySelector('.atv-keypad-toggle');
        const keypad = liveEl.querySelector('.atv-keypad');
        keypadToggle.addEventListener('click', () => {
          keypad.style.display = keypad.style.display === 'none' ? '' : 'none';
        });
      }

      if (this._collapsible) {
        this._chevronEl.addEventListener('click', () => {
          this._expanded = !this._expanded;
          this._applyExpanded();
        });
      } else {
        this._chevronEl.remove();
        this._chevronEl = null;
      }
    }

    this._expanded = this._collapsible && this._controlsEl ? this._isOn() : true;
    this._applyExpanded();

    this._renderApps();
  }

  _applyExpanded() {
    if (!this._controlsEl) return;
    this._controlsEl.style.display = this._expanded ? '' : 'none';
    if (this._chevronEl) {
      this._chevronEl.setAttribute('icon', this._expanded ? 'mdi:chevron-up' : 'mdi:chevron-down');
    }
  }

  _onButton(action) {
    if (action === 'power') {
      this._call('media_player.toggle', this._entity, {});
    }
  }

  _launchApp(app) {
    const id = app.package || '';
    if (!id) return;
    const isLink = id.includes('://');
    const doLaunch = () =>
      this._call('media_player.play_media', this._entity, {
        media_content_type: isLink ? 'url' : 'app',
        media_content_id: id,
      });
    if (this._isOn()) {
      doLaunch();
    } else {
      this._call('media_player.turn_on', this._entity, {});
      setTimeout(doLaunch, 2000);
    }
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
      el.addEventListener('click', () => this._launchApp(app));
      this._appsEl.appendChild(el);
    });
  }

  _update() {
    const state = this._hass.states[this._entity];
    if (!state) return;
    const friendly = (this._config && this._config.name) || state.attributes.friendly_name || this._entity;
    if (this._titleEl) this._titleEl.textContent = friendly;

    const isOn = this._isOn();
    if (this._powerBtn) this._powerBtn.classList.toggle('on', isOn);

    if (this._collapsible && this._controlsEl) {
      if (this._lastOn === undefined || isOn !== this._lastOn) {
        this._expanded = isOn;
        this._applyExpanded();
      }
    }
    this._lastOn = isOn;

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
    if (this._config.collapsible === false) config.collapsible = false;
    if (this._config.dpad === false) config.dpad = false;
    if (this._config.livetv === true) config.livetv = true;
    if (this._config.apps && this._config.apps.length) config.apps = this._config.apps;
    return config;
  }

  _schema() {
    return [
      { name: 'entity', selector: { entity: { domain: 'media_player' } }, required: true, label: 'TV (media_player)' },
      { name: 'remote', selector: { entity: { domain: 'remote' } }, label: 'Remote entity (optional, for nav/volume/D-pad)' },
      { name: 'name', selector: { text: {} }, label: 'Card title (optional)' },
      { name: 'collapsible', selector: { boolean: {} }, label: 'Collapse to Power + apps when TV is off' },
      { name: 'dpad', selector: { boolean: {} }, label: 'Show D-pad (needs remote entity)' },
      { name: 'livetv', selector: { boolean: {} }, label: 'Show Live TV controls (channel, guide, keypad)' },
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
      collapsible: this._config.collapsible !== false,
      dpad: this._config.dpad !== false,
      livetv: this._config.livetv === true,
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

    const colorOptions = [
      'red', 'pink', 'purple', 'deep-purple', 'indigo', 'blue', 'light-blue', 'cyan', 'teal',
      'green', 'light-green', 'lime', 'yellow', 'amber', 'orange', 'deep-orange', 'brown', 'grey', 'blue-grey',
    ].map((c) => ({ value: c, label: c.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) }));

    const appSchema = [
      {
        name: '',
        type: 'grid',
        schema: [
          { name: 'name', selector: { text: {} } },
          { name: 'package', selector: { text: {} } },
          { name: 'icon', selector: { icon: {} } },
          { name: 'color', selector: { select: { mode: 'dropdown', custom_value: true, options: colorOptions } } },
        ],
      },
    ];
    const appLabels = {
      name: 'Name',
      package: 'Package name or deep link',
      icon: 'Icon',
      color: 'Colour',
    };

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    (this._config.apps || []).forEach((app, idx) => {
      const block = document.createElement('div');
      block.style.cssText = 'border:1px solid var(--divider-color, #e0e0e0);border-radius:10px;padding:10px;';

      const appForm = document.createElement('ha-form');
      appForm.hass = this._hass;
      appForm.schema = appSchema;
      appForm.data = {
        name: app.name || '',
        package: app.package || '',
        icon: app.icon || '',
        color: app.color || '',
      };
      appForm.computeLabel = (s) => appLabels[s.name] || s.name;
      appForm.addEventListener('value-changed', (ev) => {
        const apps = [...this._config.apps];
        apps[idx] = { ...apps[idx], ...ev.detail.value };
        this._config = { ...this._config, apps };
        this._emit(this._buildConfig());
      });
      block.appendChild(appForm);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove app';
      removeBtn.style.cssText =
        'margin-top:8px;background:none;border:none;color:var(--error-color, #db4437);cursor:pointer;font:inherit;padding:0;';
      removeBtn.addEventListener('click', () => {
        const apps = [...this._config.apps];
        apps.splice(idx, 1);
        this._config = { ...this._config, apps };
        this._emit(this._buildConfig());
        this._render();
      });
      block.appendChild(removeBtn);

      list.appendChild(block);
    });
    wrap.appendChild(list);

    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;';

    const mkButton = (label, title, handler) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (title) b.title = title;
      b.style.cssText =
        'padding:8px 14px;border:1px solid var(--primary-color, #03a9f4);border-radius:8px;' +
        'background:none;color:var(--primary-color, #03a9f4);cursor:pointer;font:inherit;';
      b.addEventListener('click', handler);
      return b;
    };

    addRow.appendChild(
      mkButton('+ Add app', '', () => {
        const apps = [...(this._config.apps || []), { name: '', icon: 'mdi:application', package: '', color: '' }];
        this._config = { ...this._config, apps };
        this._emit(this._buildConfig());
        this._render();
      })
    );

    addRow.appendChild(
      mkButton(
        'Add common apps',
        'Adds Netflix, Prime Video, Plex, YouTube, Disney+, Apple TV, Spotify (skips ones already added)',
        () => {
          const existing = new Set((this._config.apps || []).map((a) => a.package));
          const toAdd = ATV_COMMON_APPS.filter((a) => !existing.has(a.package));
          const apps = [...(this._config.apps || []), ...toAdd];
          this._config = { ...this._config, apps };
          this._emit(this._buildConfig());
          this._render();
        }
      )
    );

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
    'Collapsible one-card remote + app launcher for a single Android TV / Google TV (androidtv_remote): power + app tiles when off, full remote (Home, Back, keyboard, volume, D-pad, optional Live TV) when on, with GUI-editable coloured app shortcuts.',
});

console.info(
  `%c ANDROIDTV-REMOTE-CARD %c v${ATV_CARD_VERSION} `,
  'color: white; background: #03a9f4; font-weight: 700;',
  'color: #03a9f4; background: white; font-weight: 700;'
);
