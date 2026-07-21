# Android TV Remote Card

One-card remote control + app launcher for a single Android TV / Google TV connected to Home Assistant via the **androidtv_remote** integration.

- Power, Home, Back, Volume −/+ in a single row
- GUI-editable grid of app shortcuts (Netflix, Prime Video, Plex, YouTube, Disney+, Apple TV, Spotify, or anything installed) that launch by Android package name via `media_player.select_source`
- The currently-foregrounded app (from the media_player's `app_id` attribute) is highlighted live
- Mushroom-ish flat card style, full GUI editor, no YAML required

Companion card to [heos-multiroom-card](https://github.com/mycrouch/heos-multiroom-card).

## Installation (HACS)

1. HACS → three-dot menu → **Custom repositories**
2. Add `https://github.com/mycrouch/androidtv-remote-card`, category **Dashboard** (Lovelace)
3. Install, then hard-refresh the browser.

The resource is served at `/hacsfiles/androidtv-remote-card/androidtv-remote-card.js`.

## Configuration

| Option   | Required | Description                                         |
| -------- | -------- | --------------------------------------------------- |
| `entity` | yes      | The TV `media_player` entity                        |
| `remote` | no       | The `remote.` entity, for nav/volume commands       |
| `name`   | no       | Card title override                                 |
| `apps`   | no       | List of `{ name, icon, package, color }` app shortcuts |

Each app's `color` is an optional Home Assistant named palette colour (`red`, `light-blue`, `orange`, `cyan`, `green`, `grey`, …), rendered through the theme's `--rgb-<name>` tokens so it stays consistent with your theme. Omit it for the default icon colour.

### Example

```yaml
type: custom:androidtv-remote-card
entity: media_player.lounge_tv
remote: remote.lounge_tv
apps:
  - name: Netflix
    icon: mdi:netflix
    package: com.netflix.ninja
    color: red
  - name: Plex
    icon: mdi:plex
    package: com.plexapp.android
    color: orange
```

## License

MIT — Jason Crouch. Icons: Material Design Icons via `ha-icon`.
