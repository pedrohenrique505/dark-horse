Place player avatar images in this folder.

Current placeholders:
- local-player.svg
- opponent-player.svg
- stockfish.svg

Recommended formats:
- svg for simple illustrated placeholders
- png or webp for real avatars

Recommended sizing:
- square images
- at least 96x96

To replace them, keep the same filenames or update the paths in:
- src/components/ChessBoard.tsx

For correct cropping:
- use square assets
- keep the subject centered
- `object-fit: cover` is already applied in the UI
