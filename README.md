# HHQ Music Group

A self-contained Sonos "session console" card for Home Assistant: one card
per music group slot — now-playing header, group volume, and the full
speaker roster with tap-to-add/steal/remove membership. Built to render N
instances (one per group) with mutations executed against Sonos directly
(via an MQTT → Node-RED UPnP step sequencer) for ~1-2 s eventual
consistency instead of waiting on integration state.

Requires house-specific scripts/helpers (`music_slot_toggle`,
`music_slot_play`, `input_text.music_slot_N`). Public because HACS
requires it; built for one specific home.

```yaml
type: custom:hhq-music-group
slot: 1
```
