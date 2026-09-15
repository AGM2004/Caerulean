# Caerulean Website

First-draft marketing site for Caerulean, a static HTML/CSS/JS page deployed via GitHub Pages.

## Structure

- `index.html` — page markup
- `css/styles.css` — styles
- `js/main.js` — mobile nav toggle + footer year
- `favicon.svg` — tab icon
- `.nojekyll` — tells GitHub Pages to serve files as-is (no Jekyll processing)

## Local preview

Open `index.html` directly in a browser, or serve it locally:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deployment

Served via GitHub Pages from the `main` branch. Push to `main` to update the live site.

## TODO

- [ ] Replace placeholder copy in the hero, About, and feature sections with real content
- [ ] Swap `hello@caerulean.co` for the real contact address
- [ ] Add real logo / favicon artwork
