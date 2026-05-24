Use this folder as the only frontend source of truth.

Edit here:
- `frontend/src`
- `frontend/public`

This workspace was reconstructed from the currently working live build.
Backup of the older local source:
- `frontend/src_backup_before_live_reconstruct/`

Build:
```bash
npm run build
```

After build, upload everything inside:
- `frontend/build/`

to:
- `public_html/`

Recommended deploy workflow:
1. Edit files in `frontend/src`
2. Run `npm run build`
3. Open `frontend/build`
4. Replace Hostinger `public_html` contents with the new build contents
5. Hard refresh the website with `Ctrl + Shift + R`

Do not use these as main editing targets:
- `homepage/build`
- `legacy-root-frontend`
- live `static/js` or `static/css` files on Hostinger
