# Changelog

## 0.1.20

### New
- **Progress around the edge.** A thin, glowing accent line traces the notch's outline, leaving out the side docked against the screen. It shows whatever has progress right now: a file conversion or background removal, an app update download, the focus timer, or the playing song. Drawn like a comet: a dot leads at the head and the tail thins out at the start. Turn it off in Settings → Widgets → *Progress around the edge*.
- **Live Captions when there are no lyrics (Windows 11).** For songs and videos without synced lyrics, TopNotch shows what Windows Live Captions hears, line by line, in the pill and the Music tab. Turn Live Captions on with **Win + Ctrl + L** (the first time, Windows asks you to accept its setup). TopNotch only reads Live Captions; it never starts it. Works best on speech; sung lyrics are often misheard. Turn it off in Settings → Widgets → *Live Captions when no lyrics*.

### Improved
- **Lyrics match the right song more often.** A candidate by another artist, or a cut of very different length, is now skipped instead of shown with drifting lines. Clips under 30 seconds (notifications, browser tabs) no longer get lyrics.
- **Messy video titles are cleaned up better:** "Artist: Song", "starring …", hashtags, and "Official Video" without brackets.

## 0.1.19

### Improved
- **Uses about 40% less memory on Windows** (about 240 MB instead of 400 MB while music plays, about 190 MB with nothing playing).
  - The system helper ships as a small program instead of being compiled by PowerShell at every start.
  - Now playing is read by that helper, so a separate media process is gone.
  - The notch is drawn on the CPU, which costs no extra CPU for a window this small and frees about 90 MB. Set `"hardwareAcceleration": true` in `config.json` to draw on the GPU again.
